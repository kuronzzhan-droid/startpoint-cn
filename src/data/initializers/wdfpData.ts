import { Database } from "better-sqlite3";
import { ensureSchemaColumn } from "../schema";
import { assertStorageLayout, isCompactStorage } from "../../lib/storage-layout";

interface TableColumnInfo {
    name: string
    pk: number
}

interface CategoryMissionRepairRow {
    category: number
    id: number
    progress: number
    player_id: number
}

interface CategoryMissionStageRepairRow {
    category: number
    id: number
    status: number
    player_id: number
    mission_id: number
}

function getTableColumns(database: Database, tableName: string): TableColumnInfo[] {
    return database.prepare(`PRAGMA table_info("${tableName}")`).all() as TableColumnInfo[]
}

function hasPrimaryKey(columns: TableColumnInfo[], expected: readonly string[]): boolean {
    const actual = columns
        .filter(column => column.pk > 0)
        .sort((left, right) => left.pk - right.pk)
        .map(column => column.name)
    return actual.length === expected.length
        && actual.every((name, index) => name === expected[index])
}

/**
 * A short-lived upstream schema accidentally reused players_category_missions
 * as the detailed mission-counter table.  CREATE TABLE IF NOT EXISTS cannot
 * repair that shape, and its child table then fails every write with
 * "foreign key mismatch".  Preserve the four authoritative mission columns
 * and rebuild both tables before normal initialization continues.
 */
function repairCategoryMissionTables(database: Database): void {
    const missionColumns = getTableColumns(database, "players_category_missions")
    if (missionColumns.length === 0) return

    const stageColumns = getTableColumns(database, "players_category_mission_stages")
    const missionShapeValid = ["category", "id", "progress", "player_id"]
        .every(name => missionColumns.some(column => column.name === name))
        && hasPrimaryKey(missionColumns, ["category", "id", "player_id"])
    const stageShapeValid = stageColumns.length === 0 || (
        ["category", "id", "status", "player_id", "mission_id"]
            .every(name => stageColumns.some(column => column.name === name))
        && hasPrimaryKey(stageColumns, ["category", "id", "mission_id", "player_id"])
    )
    if (missionShapeValid && stageShapeValid) return

    const missionRows = ["category", "id", "progress", "player_id"]
        .every(name => missionColumns.some(column => column.name === name))
        ? database.prepare(`
            SELECT category, id, progress, player_id
            FROM players_category_missions
        `).all() as CategoryMissionRepairRow[]
        : []
    const stageRows = stageColumns.length > 0
        && ["category", "id", "status", "player_id", "mission_id"]
            .every(name => stageColumns.some(column => column.name === name))
        ? database.prepare(`
            SELECT category, id, status, player_id, mission_id
            FROM players_category_mission_stages
        `).all() as CategoryMissionStageRepairRow[]
        : []

    const foreignKeysEnabled = Number(database.pragma("foreign_keys", { simple: true })) !== 0
    if (foreignKeysEnabled) database.pragma("foreign_keys = OFF")
    try {
        database.transaction(() => {
            database.prepare(`DROP TABLE IF EXISTS players_category_mission_stages`).run()
            database.prepare(`DROP TABLE IF EXISTS players_category_missions`).run()
            database.prepare(`CREATE TABLE players_category_missions (
                category INTEGER NOT NULL,
                id INTEGER NOT NULL,
                progress INTEGER NOT NULL,
                player_id INTEGER NOT NULL,
                PRIMARY KEY (category, id, player_id),
                FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
            )`).run()
            database.prepare(`CREATE TABLE players_category_mission_stages (
                category INTEGER NOT NULL,
                id INTEGER NOT NULL,
                status INTEGER NOT NULL,
                player_id INTEGER NOT NULL,
                mission_id INTEGER NOT NULL,
                PRIMARY KEY (category, id, mission_id, player_id),
                FOREIGN KEY (category, mission_id, player_id)
                    REFERENCES players_category_missions (category, id, player_id) ON DELETE CASCADE,
                FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
            )`).run()

            const insertMission = database.prepare(`
                INSERT OR IGNORE INTO players_category_missions
                    (category, id, progress, player_id)
                VALUES (?, ?, ?, ?)
            `)
            const normalizedMissionRows = new Map<string, CategoryMissionRepairRow>()
            for (const row of missionRows) {
                const key = `${row.category}:${row.id}:${row.player_id}`
                const previous = normalizedMissionRows.get(key)
                if (previous === undefined || row.progress > previous.progress) {
                    normalizedMissionRows.set(key, row)
                }
            }
            const restoredMissionKeys = new Set<string>()
            for (const [key, row] of normalizedMissionRows) {
                insertMission.run(row.category, row.id, row.progress, row.player_id)
                restoredMissionKeys.add(key)
            }

            const insertStage = database.prepare(`
                INSERT OR IGNORE INTO players_category_mission_stages
                    (category, id, status, player_id, mission_id)
                VALUES (?, ?, ?, ?, ?)
            `)
            const normalizedStageRows = new Map<string, CategoryMissionStageRepairRow>()
            for (const row of stageRows) {
                const key = `${row.category}:${row.id}:${row.mission_id}:${row.player_id}`
                const previous = normalizedStageRows.get(key)
                if (previous === undefined || row.status > previous.status) {
                    normalizedStageRows.set(key, row)
                }
            }
            for (const row of normalizedStageRows.values()) {
                if (!restoredMissionKeys.has(`${row.category}:${row.mission_id}:${row.player_id}`)) continue
                insertStage.run(row.category, row.id, row.status, row.player_id, row.mission_id)
            }
        })()
    } finally {
        if (foreignKeysEnabled) database.pragma("foreign_keys = ON")
    }

    console.log(
        `[DB] repaired category mission schema: missions=${missionRows.length} stages=${stageRows.length}`,
    )
}


export default function init(
    database: Database,
    exists: Boolean
) {
    // initialize the database

    // create players table
    database.prepare(`CREATE TABLE IF NOT EXISTS accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        app_id TEXT NOT NULL,
        first_login_time DATE NOT NULL,
        idp_alias TEXT NOT NULL,
        idp_code TEXT NOT NULL,
        idp_id TEXT NOT NULL,
        reg_time DATE NOT NULL,
        last_login_time DATE NOT NULL,
        status TEXT NOT NULL,
        username TEXT UNIQUE,
        password_hash TEXT,
        admin_note TEXT DEFAULT NULL,
        takeover_password TEXT DEFAULT NULL,
        takeover_udid TEXT DEFAULT NULL
    )`).run()

    // Account recovery metadata is account-scoped: neither a device rebind nor
    // deletion of an obsolete device row may discard the administrator note.
    try { database.prepare(`ALTER TABLE accounts ADD COLUMN admin_note TEXT DEFAULT NULL`).run(); } catch { /* column already exists */ }
    try { database.prepare(`ALTER TABLE accounts ADD COLUMN takeover_password TEXT DEFAULT NULL`).run(); } catch { /* column already exists */ }
    try { database.prepare(`ALTER TABLE accounts ADD COLUMN takeover_udid TEXT DEFAULT NULL`).run(); } catch { /* column already exists */ }

    // create zat session table
    database.prepare(`CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY NOT NULL,
        account_id INTEGER NOT NULL,
        expires DATE NOT NULL,
        type INTEGER NOT NULL,
        FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE CASCADE
    )`).run()

    // Account-scoped announcement receipts power both the unread indicator
    // and the "once per announcement" login popup policy. Announcement rows
    // live in assets/news.json, so news_id intentionally has no foreign key.
    database.prepare(`CREATE TABLE IF NOT EXISTS account_news_receipts (
        account_id INTEGER NOT NULL,
        news_id INTEGER NOT NULL,
        receipt_kind TEXT NOT NULL CHECK (receipt_kind IN ('list', 'popup')),
        seen_at INTEGER NOT NULL,
        PRIMARY KEY (account_id, news_id, receipt_kind),
        FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE CASCADE
    )`).run()
    database.prepare(`CREATE INDEX IF NOT EXISTS idx_account_news_receipts_news
        ON account_news_receipts (news_id, receipt_kind)
    `).run()

    // Payment callbacks may be retried after a network timeout. Keep a
    // player-scoped receipt so the same transaction can never credit vmoney
    // twice, even after the process restarts.
    database.prepare(`CREATE TABLE IF NOT EXISTS player_payment_receipts (
        player_id INTEGER NOT NULL,
        payment_key TEXT NOT NULL,
        product_id TEXT NOT NULL,
        paid_vmoney INTEGER NOT NULL,
        free_vmoney INTEGER NOT NULL,
        after_vmoney INTEGER NOT NULL,
        after_free_vmoney INTEGER NOT NULL,
        purchase_count INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (player_id, payment_key),
        FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
    )`).run()
    database.prepare(`CREATE INDEX IF NOT EXISTS idx_player_payment_receipts_product
        ON player_payment_receipts (player_id, product_id, created_at)
    `).run()

    // Durable request receipts let retryable player commands return their
    // original response without applying rewards a second time. The operation
    // name keeps request keys from different protocol endpoints separate.
    database.prepare(`CREATE TABLE IF NOT EXISTS player_operation_receipts (
        player_id INTEGER NOT NULL,
        operation TEXT NOT NULL,
        request_key TEXT NOT NULL,
        response_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (player_id, operation, request_key),
        FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
    )`).run()
    database.prepare(`CREATE INDEX IF NOT EXISTS idx_player_operation_receipts_created
        ON player_operation_receipts (player_id, created_at)
    `).run()

    // Permanent, compact payment facts outlive the bounded response replay cache.
    // Single and multiplayer share one identity so a mode switch cannot pay twice.
    database.exec(`CREATE TABLE IF NOT EXISTS battle_settlement_ledger (
        player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
        play_id TEXT NOT NULL,
        mode TEXT NOT NULL CHECK(mode IN ('single','multi','legacy-conflict')),
        settled_at INTEGER NOT NULL,
        version INTEGER NOT NULL DEFAULT 1 CHECK(version = 1),
        PRIMARY KEY(player_id,play_id)
    ) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS battle_receipt_payload_queue (
        player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
        play_id TEXT NOT NULL,
        operation TEXT NOT NULL CHECK(operation IN ('quest_finish.single','quest_finish.multi')),
        created_at INTEGER NOT NULL,
        PRIMARY KEY(player_id,play_id,operation),
        FOREIGN KEY(player_id,play_id) REFERENCES battle_settlement_ledger(player_id,play_id) ON DELETE CASCADE
    ) WITHOUT ROWID;
    CREATE INDEX IF NOT EXISTS idx_battle_receipt_payload_expiry
        ON battle_receipt_payload_queue(created_at,player_id,play_id,operation);`)

    // create players table
    database.prepare(`CREATE TABLE IF NOT EXISTS players (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        stamina INTEGER NOT NULL,
        stamina_heal_time INTEGER NOT NULL,
        boost_point INTEGER NOT NULL,
        boss_boost_point INTEGER NOT NULL,
        transition_state INTEGER NOT NULL,
        role INTEGER NOT NULL,
        name TEXT NOT NULL,
        last_login_time DATE NOT NULL,
        comment TEXT NOT NULL,
        vmoney INTEGER NOT NULL,
        free_vmoney INTEGER NOT NULL,
        rank_point INTEGER NOT NULL,
        star_crumb INTEGER NOT NULL,
        bond_token INTEGER NOT NULL,
        exp_pool INTEGER NOT NULL,
        exp_pooled_time INTEGER NOT NULL,
        leader_character_id INTEGER NOT NULL,
        party_slot INTEGER NOT NULL,
        degree_id INTEGER NOT NULL,
        birth INTEGER NOT NULL,
        free_mana INTEGER NOT NULL,
        paid_mana INTEGER NOT NULL,
        enable_auto_3x INTEGER NOT NULL,
        total_stamina_used INTEGER NOT NULL DEFAULT 0,
        total_powerflips INTEGER NOT NULL DEFAULT 0,
        total_dashes INTEGER NOT NULL DEFAULT 0,
        total_mana_obtained INTEGER NOT NULL DEFAULT 0,
        max_combo_achieved INTEGER NOT NULL DEFAULT 0,
        total_login_days INTEGER NOT NULL DEFAULT 0,
        account_id INTEGER NOT NULL,
        tutorial_step INTEGER,
        tutorial_skip_flag INTEGER,
        tutorial_gacha_character_id INTEGER DEFAULT NULL,
        time_offset INTEGER DEFAULT NULL,
        FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE CASCADE
    )`).run();

    // Persistent title ownership. Older saves only stored the equipped title
    // in players.degree_id, so preserve both that title and the default title.
    database.prepare(`CREATE TABLE IF NOT EXISTS players_degrees (
        player_id INTEGER NOT NULL,
        degree_id INTEGER NOT NULL,
        acquired_at INTEGER NOT NULL,
        PRIMARY KEY (player_id, degree_id),
        FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
    )`).run();
    database.prepare(`CREATE INDEX IF NOT EXISTS idx_players_degrees_player
        ON players_degrees (player_id, acquired_at, degree_id)`).run();
    database.prepare(`
        INSERT OR IGNORE INTO players_degrees (player_id, degree_id, acquired_at)
        SELECT id, 1, 0 FROM players
    `).run();
    database.prepare(`
        INSERT OR IGNORE INTO players_degrees (player_id, degree_id, acquired_at)
        SELECT id, degree_id, 0 FROM players WHERE degree_id > 0
    `).run();
    database.prepare(`CREATE TRIGGER IF NOT EXISTS trg_players_default_degrees
        AFTER INSERT ON players
        BEGIN
            INSERT OR IGNORE INTO players_degrees (player_id, degree_id, acquired_at)
            VALUES (NEW.id, 1, 0);
            INSERT OR IGNORE INTO players_degrees (player_id, degree_id, acquired_at)
            SELECT NEW.id, NEW.degree_id, 0 WHERE NEW.degree_id > 0;
        END
    `).run();

    // Persistent one-way follow edges. Mutual follows are represented by two
    // rows in opposite directions so deleting either side remains unambiguous.
    database.prepare(`CREATE TABLE IF NOT EXISTS players_follows (
        follower_player_id INTEGER NOT NULL,
        followed_player_id INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (follower_player_id, followed_player_id),
        CHECK (follower_player_id <> followed_player_id),
        FOREIGN KEY (follower_player_id) REFERENCES players (id) ON DELETE CASCADE,
        FOREIGN KEY (followed_player_id) REFERENCES players (id) ON DELETE CASCADE
    )`).run();
    database.prepare(`CREATE INDEX IF NOT EXISTS idx_players_follows_followed
        ON players_follows (followed_player_id)`).run();

    // Shareable party snapshots. Codes are intentionally stored server-side
    // so the existing client can publish and import a short (<= 20 char) code.
    database.prepare(`CREATE TABLE IF NOT EXISTS published_parties (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT NOT NULL UNIQUE,
        owner_player_id INTEGER NOT NULL,
        party_name TEXT NOT NULL,
        battle_party_json TEXT NOT NULL,
        schema_version INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (owner_player_id) REFERENCES players (id) ON DELETE CASCADE
    )`).run();
    database.prepare(`CREATE INDEX IF NOT EXISTS idx_published_parties_owner
        ON published_parties (owner_player_id, id DESC)`).run();

    // migration: add tutorial_gacha_character_id to existing tables
    try { database.prepare(`ALTER TABLE players ADD COLUMN tutorial_gacha_character_id INTEGER DEFAULT NULL`).run(); } catch { /* column already exists */ }
    // Timestamp basis used to keep real-time regeneration stable while the
    // server's virtual clock moves. Older databases may predate the column.
    try { database.prepare(`ALTER TABLE players ADD COLUMN time_offset INTEGER DEFAULT NULL`).run(); } catch { /* column already exists */ }

    // migration: add total_stamina_used for mission progress tracking
    try { database.prepare(`ALTER TABLE players ADD COLUMN total_stamina_used INTEGER NOT NULL DEFAULT 0`).run(); } catch { /* column already exists */ }

    // migration: add powerflip/dash counters for mission progress
    try { database.prepare(`ALTER TABLE players ADD COLUMN total_powerflips INTEGER NOT NULL DEFAULT 0`).run(); } catch { /* column already exists */ }
    try { database.prepare(`ALTER TABLE players ADD COLUMN total_dashes INTEGER NOT NULL DEFAULT 0`).run(); } catch { /* column already exists */ }

    // migration: add total_mana_obtained for mission progress tracking
    try { database.prepare(`ALTER TABLE players ADD COLUMN total_mana_obtained INTEGER NOT NULL DEFAULT 0`).run(); } catch { /* column already exists */ }
    // migration: max_combo_achieved was added to CREATE TABLE only — existing DBs need this ALTER
    try { database.prepare(`ALTER TABLE players ADD COLUMN max_combo_achieved INTEGER NOT NULL DEFAULT 0`).run(); } catch { /* column already exists */ }

    database.prepare(`CREATE TABLE IF NOT EXISTS players_character_quest_clears (
        player_id INTEGER NOT NULL,
        character_id INTEGER NOT NULL,
        clear_count INTEGER NOT NULL DEFAULT 0,
        multi_count INTEGER NOT NULL DEFAULT 0,
        leader_clear_count INTEGER NOT NULL DEFAULT 0,
        leader_multi_count INTEGER NOT NULL DEFAULT 0,
        leader_power_flip_count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (player_id, character_id),
        FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
    )`).run();

    // migration: add leader_clear_count for leader-specific awakening missions
    try { database.prepare(`ALTER TABLE players_character_quest_clears ADD COLUMN leader_clear_count INTEGER NOT NULL DEFAULT 0`).run(); } catch { /* column already exists */ }

    // migration: add leader_multi_count for co-op leader tracking
    try { database.prepare(`ALTER TABLE players_character_quest_clears ADD COLUMN leader_multi_count INTEGER NOT NULL DEFAULT 0`).run(); } catch { /* column already exists */ }

    // migration: add leader_character_id to quest_progress for quest-clear leader validation
    try { database.prepare(`ALTER TABLE players_quest_progress ADD COLUMN leader_character_id INTEGER`).run(); } catch { /* column already exists */ }

    // migration: add multi_clear_count for event mission multi-battle tracking
    try { database.prepare(`ALTER TABLE players_quest_progress ADD COLUMN multi_clear_count INTEGER NOT NULL DEFAULT 0`).run(); } catch { /* column already exists */ }
    // migration: unlocked was added to CREATE TABLE only — existing DBs need this ALTER (else /load SELECT fails)
    try { database.prepare(`ALTER TABLE players_quest_progress ADD COLUMN unlocked INTEGER NOT NULL DEFAULT 0`).run(); } catch { /* column already exists */ }

    // Persist co-op host clears. Advent-event unlock conditions distinguish a
    // normal clear from a clear completed while owning the room.
    try { database.prepare(`ALTER TABLE players_quest_progress ADD COLUMN host_finished INTEGER NOT NULL DEFAULT 0`).run(); } catch { /* column already exists */ }

    // migration: add leader_power_flip_count for per-character powerflip missions
    try { database.prepare(`ALTER TABLE players_character_quest_clears ADD COLUMN leader_power_flip_count INTEGER NOT NULL DEFAULT 0`).run(); } catch { /* column already exists */ }

    // migration: add total_login_days for weekly mission tracking
    try { database.prepare(`ALTER TABLE players ADD COLUMN total_login_days INTEGER NOT NULL DEFAULT 0`).run(); } catch { /* column already exists */ }

    database.prepare(`CREATE TABLE IF NOT EXISTS players_party_member_co_clears (
        player_id INTEGER NOT NULL,
        char_id_a INTEGER NOT NULL,
        char_id_b INTEGER NOT NULL,
        co_clear_count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (player_id, char_id_a, char_id_b),
        FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
    )`).run();

    database.prepare(`CREATE TABLE IF NOT EXISTS players_party_race_clears (
        player_id INTEGER NOT NULL,
        race_key TEXT NOT NULL,
        clear_count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (player_id, race_key),
        FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
    )`).run();

    database.prepare(`CREATE TABLE IF NOT EXISTS players_periodic_snapshots (
        player_id INTEGER NOT NULL,
        period_type TEXT NOT NULL,
        quest_clears INTEGER NOT NULL DEFAULT 0,
        stamina_used INTEGER NOT NULL DEFAULT 0,
        rank_ss INTEGER NOT NULL DEFAULT 0,
        rank_s INTEGER NOT NULL DEFAULT 0,
        rank_a INTEGER NOT NULL DEFAULT 0,
        rank_b INTEGER NOT NULL DEFAULT 0,
        single_play_count INTEGER NOT NULL DEFAULT 0,
        single_clear_count INTEGER NOT NULL DEFAULT 0,
        multi_play_count INTEGER NOT NULL DEFAULT 0,
        multi_clear_count INTEGER NOT NULL DEFAULT 0,
        multi_host_clear_count INTEGER NOT NULL DEFAULT 0,
        multi_guest_clear_count INTEGER NOT NULL DEFAULT 0,
        dash_count INTEGER NOT NULL DEFAULT 0,
        power_flip_count INTEGER NOT NULL DEFAULT 0,
        login_days INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (player_id, period_type),
        FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
    )`).run();

    ensureSchemaColumn(database, "players_periodic_snapshots.single_play_count")
    ensureSchemaColumn(database, "players_periodic_snapshots.single_clear_count")
    ensureSchemaColumn(database, "players_periodic_snapshots.multi_play_count")
    ensureSchemaColumn(database, "players_periodic_snapshots.multi_clear_count")
    ensureSchemaColumn(database, "players_periodic_snapshots.multi_host_clear_count")
    ensureSchemaColumn(database, "players_periodic_snapshots.multi_guest_clear_count")
    ensureSchemaColumn(database, "players_periodic_snapshots.dash_count")
    ensureSchemaColumn(database, "players_periodic_snapshots.power_flip_count")
    ensureSchemaColumn(database, "players_periodic_snapshots.login_days")

    database.prepare(`CREATE TABLE IF NOT EXISTS players_mission_battle_counters (
        player_id INTEGER PRIMARY KEY,
        single_play_count INTEGER NOT NULL DEFAULT 0,
        single_clear_count INTEGER NOT NULL DEFAULT 0,
        multi_play_count INTEGER NOT NULL DEFAULT 0,
        multi_clear_count INTEGER NOT NULL DEFAULT 0,
        multi_host_clear_count INTEGER NOT NULL DEFAULT 0,
        multi_guest_clear_count INTEGER NOT NULL DEFAULT 0,
        single_rank_ss_count INTEGER NOT NULL DEFAULT 0,
        rank_ss_count INTEGER NOT NULL DEFAULT 0,
        rank_s_count INTEGER NOT NULL DEFAULT 0,
        rank_a_count INTEGER NOT NULL DEFAULT 0,
        rank_b_count INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
    )`).run();

    ensureSchemaColumn(database, "players_mission_battle_counters.single_rank_ss_count")

    database.prepare(`CREATE TABLE IF NOT EXISTS device_bindings (
        device_id INTEGER PRIMARY KEY,
        account_id INTEGER NOT NULL,
        last_seen DATE NOT NULL,
        FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE CASCADE
    )`).run();

    // migration: device_bindings.name for admin panel identification
    try { database.prepare(`ALTER TABLE device_bindings ADD COLUMN name TEXT DEFAULT NULL`).run(); } catch { /* column already exists */ }

    // Older builds stored the administrator note on a replaceable device row.
    // Keep the newest non-empty value, then enforce one live device per account.
    database.prepare(`
        UPDATE accounts
        SET admin_note = (
            SELECT db.name
            FROM device_bindings AS db
            WHERE db.account_id = accounts.id
              AND db.name IS NOT NULL
              AND trim(db.name) <> ''
            ORDER BY datetime(db.last_seen) DESC, db.rowid DESC
            LIMIT 1
        )
        WHERE (admin_note IS NULL OR trim(admin_note) = '')
          AND EXISTS (
            SELECT 1 FROM device_bindings AS db
            WHERE db.account_id = accounts.id
              AND db.name IS NOT NULL
              AND trim(db.name) <> ''
          )
    `).run()
    // The legacy column is no longer authoritative. Clearing it also ensures
    // that an intentionally cleared account note is not resurrected next boot.
    database.prepare(`UPDATE device_bindings SET name = NULL WHERE name IS NOT NULL`).run()
    database.prepare(`
        DELETE FROM device_bindings
        WHERE rowid NOT IN (
            SELECT (
                SELECT newest.rowid
                FROM device_bindings AS newest
                WHERE newest.account_id = grouped.account_id
                ORDER BY datetime(newest.last_seen) DESC, newest.rowid DESC
                LIMIT 1
            )
            FROM device_bindings AS grouped
            GROUP BY grouped.account_id
        )
    `).run()
    database.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_device_bindings_one_per_account
        ON device_bindings (account_id)`).run()

    database.prepare(`CREATE TABLE IF NOT EXISTS account_transfer_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_account_id INTEGER,
        source_viewer_id TEXT,
        target_account_id INTEGER NOT NULL,
        target_viewer_id TEXT NOT NULL,
        old_device_id INTEGER,
        new_device_id INTEGER NOT NULL,
        source_player_count INTEGER NOT NULL DEFAULT 0,
        target_note TEXT,
        transferred_at TEXT NOT NULL,
        source TEXT NOT NULL
    )`).run()
    database.prepare(`CREATE INDEX IF NOT EXISTS idx_account_transfer_audit_target
        ON account_transfer_audit (target_account_id, id DESC)`).run()

    // migration: add awake_level for character awakening system
    try { database.prepare(`ALTER TABLE players_characters_mana_nodes ADD COLUMN awake_level INTEGER NOT NULL DEFAULT 0`).run(); } catch { /* column already exists */ }
    // migration: ex_boost / illustration columns were added to CREATE TABLE only — existing DBs need these ALTERs
    try { database.prepare(`ALTER TABLE players_characters ADD COLUMN ex_boost_status_id INTEGER`).run(); } catch { /* column already exists */ }
    try { database.prepare(`ALTER TABLE players_characters ADD COLUMN ex_boost_ability_id_list TEXT`).run(); } catch { /* column already exists */ }
    try { database.prepare(`ALTER TABLE players_characters ADD COLUMN illustration_settings TEXT`).run(); } catch { /* column already exists */ }

    database.prepare(`CREATE TABLE IF NOT EXISTS players_options (
        key TEXT NOT NULL,
        value INTEGER NOT NULL,
        player_id INTEGER NOT NULL,
        PRIMARY KEY (key, player_id),
        FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
    )`).run();

    database.prepare(`CREATE TABLE IF NOT EXISTS players_encyclopedia_keywords (
        encyclopedia_id INTEGER NOT NULL,
        read INTEGER NOT NULL DEFAULT 0,
        player_id INTEGER NOT NULL,
        PRIMARY KEY (encyclopedia_id, player_id),
        FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
    )`).run();

    database.prepare(`CREATE TABLE IF NOT EXISTS players_player_history_settings (
        player_id INTEGER PRIMARY KEY,
        player_history_id INTEGER NOT NULL DEFAULT 1,
        background_card_id INTEGER NOT NULL DEFAULT 1001,
        degree_id INTEGER NOT NULL DEFAULT 1,
        character_ids TEXT NOT NULL DEFAULT '[null,null,null]',
        unison_character_ids TEXT NOT NULL DEFAULT '[null,null,null]',
        topic_visibility TEXT NOT NULL DEFAULT '{}',
        FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
    )`).run();

    database.prepare(`CREATE TABLE IF NOT EXISTS players_triggered_tutorials (
        id INTEGER NOT NULL,
        player_id INTEGER NOT NULL,
        PRIMARY KEY (id, player_id),
        FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
    )`).run();

    database.prepare(`CREATE TABLE IF NOT EXISTS players_mails (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        player_id INTEGER NOT NULL,
        reason_id INTEGER NOT NULL DEFAULT 0,
        subject TEXT,
        description TEXT,
        type INTEGER NOT NULL,
        type_id INTEGER,
        number INTEGER NOT NULL DEFAULT 1,
        receive_time TEXT NOT NULL DEFAULT '0000-00-00 00:00:00',
        create_time TEXT NOT NULL,
        reward_period_limited INTEGER NOT NULL DEFAULT 0,
        reward_limit_time TEXT,
        FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
    )`).run();

    database.prepare(`CREATE TABLE IF NOT EXISTS daily_vmoney_mail_config (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        enabled INTEGER NOT NULL DEFAULT 0,
        amount INTEGER NOT NULL DEFAULT 150000,
        send_hour INTEGER NOT NULL DEFAULT 5,
        send_minute INTEGER NOT NULL DEFAULT 0,
        subject TEXT NOT NULL DEFAULT '每日千抽',
        description TEXT NOT NULL DEFAULT '每日星导石奖励，请查收。',
        updated_at_ms INTEGER NOT NULL DEFAULT 0
    )`).run();

    database.prepare(`CREATE TABLE IF NOT EXISTS daily_vmoney_mail_runs (
        bucket TEXT PRIMARY KEY,
        scheduled_at_ms INTEGER NOT NULL,
        executed_at_ms INTEGER NOT NULL,
        source TEXT NOT NULL,
        amount INTEGER NOT NULL,
        subject TEXT NOT NULL,
        description TEXT NOT NULL,
        sent_count INTEGER NOT NULL DEFAULT 0
    )`).run();

    database.prepare(`CREATE TABLE IF NOT EXISTS daily_vmoney_mail_grants (
        bucket TEXT NOT NULL,
        player_id INTEGER NOT NULL,
        mail_id INTEGER NOT NULL,
        created_at_ms INTEGER NOT NULL,
        PRIMARY KEY (bucket, player_id),
        FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
    )`).run();

    database.prepare(`CREATE TABLE IF NOT EXISTS players_receive_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        player_id INTEGER NOT NULL,
        type INTEGER NOT NULL,
        type_id INTEGER,
        number INTEGER NOT NULL DEFAULT 1,
        reason_id INTEGER NOT NULL DEFAULT 0,
        create_time TEXT NOT NULL,
        FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
    )`).run();

    database.prepare(`CREATE TABLE IF NOT EXISTS players_practice_battle_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        player_id INTEGER NOT NULL,
        play_id TEXT NOT NULL,
        ability_soul_id_1 INTEGER,
        ability_soul_id_2 INTEGER,
        ability_soul_id_3 INTEGER,
        category_id INTEGER NOT NULL,
        character_1_total_damage REAL,
        character_2_total_damage REAL,
        character_3_total_damage REAL,
        character_id_1 INTEGER,
        character_id_2 INTEGER,
        character_id_3 INTEGER,
        clear_rank INTEGER,
        create_time TEXT NOT NULL,
        elapsed_time_ms REAL NOT NULL,
        enhancement_level_1 INTEGER,
        enhancement_level_2 INTEGER,
        enhancement_level_3 INTEGER,
        equipment1_id INTEGER,
        equipment2_id INTEGER,
        equipment3_id INTEGER,
        equipment_level_1 INTEGER,
        equipment_level_2 INTEGER,
        equipment_level_3 INTEGER,
        finish_kind INTEGER NOT NULL,
        quest_id INTEGER NOT NULL,
        score REAL,
        total_damage REAL NOT NULL,
        unison_character_id_1 INTEGER,
        unison_character_id_2 INTEGER,
        unison_character_id_3 INTEGER,
        UNIQUE (player_id, play_id),
        FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
    )`).run();
    database.prepare(`CREATE INDEX IF NOT EXISTS idx_practice_history_player_id
        ON players_practice_battle_history (player_id, id DESC)
    `).run();

    database.prepare(`CREATE TABLE IF NOT EXISTS players_cleared_regular_missions (
        id INTEGER NOT NULL,
        value INTEGER NOT NULL,
        player_id INTEGER NOT NULL,
        PRIMARY KEY (id, player_id),
        FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
    )`).run();

    database.prepare(`CREATE TABLE IF NOT EXISTS players_items (
        id INTEGER NOT NULL,
        amount INTEGER NOT NULL,
        player_id INTEGER NOT NULL,
        PRIMARY KEY (id, player_id),
        FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
    )`).run();

    database.prepare(`CREATE TABLE IF NOT EXISTS players_collected_items (
        player_id INTEGER NOT NULL,
        item_id INTEGER NOT NULL,
        total_obtained INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (player_id, item_id),
        FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
    )`).run();

    database.prepare(`CREATE TABLE IF NOT EXISTS daily_challenge_point_list_entries (
        id INTEGER NOT NULL,
        point INTEGER NOT NULL,
        player_id INTEGER NOT NULL,
        PRIMARY KEY (id, player_id),
        FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
    )`).run();

    database.prepare(`CREATE TABLE IF NOT EXISTS daily_challenge_point_list_campaigns (
        campaign_id INTEGER NOT NULL,
        additional_point INTEGER NOT NULL,
        list_entry_id INTEGER NOT NULL,
        player_id INTEGER NOT NULL,
        PRIMARY KEY (player_id, campaign_id, list_entry_id),
        FOREIGN KEY (list_entry_id, player_id) REFERENCES daily_challenge_point_list_entries (id, player_id) ON DELETE CASCADE,
        FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
    )`).run();

    database.prepare(`CREATE TABLE IF NOT EXISTS players_characters (
        id INTEGER NOT NULL,
        entry_count INTEGER NOT NULL,
        evolution_level INTEGER NOT NULL,
        over_limit_step INTEGER NOT NULL,
        protection INTEGER NOT NULL,
        join_time DATE NOT NULL,
        update_time DATE NOT NULL,
        exp INTEGER NOT NULL,
        stack INTEGER NOT NULL,
        mana_board_index INTEGER NOT NULL,
        player_id INTEGER NOT NULL,
        ex_boost_status_id INTEGER,
        ex_boost_ability_id_list TEXT,
        illustration_settings TEXT,
        PRIMARY KEY (id, player_id),
        FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
    )`).run();

    database.prepare(`CREATE TABLE IF NOT EXISTS players_characters_bond_tokens (
        mana_board_index INTEGER NOT NULL,
        status INTEGER NOT NULL,
        player_id INTEGER NOT NULL,
        character_id INTEGER NOT NULL,
        PRIMARY KEY (mana_board_index, player_id, character_id),
        FOREIGN KEY (character_id, player_id) REFERENCES players_characters (id, player_id) ON DELETE CASCADE,
        FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
    )`).run();

    database.prepare(`CREATE TABLE IF NOT EXISTS players_characters_mana_nodes (
        value INTEGER NOT NULL,
        awake_level INTEGER NOT NULL DEFAULT 0,
        character_id INTEGER NOT NULL,
        player_id INTEGER NOT NULL,
        PRIMARY KEY (value, character_id, player_id),
        FOREIGN KEY (character_id, player_id) REFERENCES players_characters (id, player_id) ON DELETE CASCADE,
        FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
    )`).run();

    database.prepare(`CREATE TABLE IF NOT EXISTS players_party_groups (
        id INTEGER NOT NULL,
        color_id INTEGER NOT NULL,
        player_id INTEGER NOT NULL,
        category INTEGER NOT NULL,
        PRIMARY KEY (id, player_id, category),
        FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
    )`).run();

    database.prepare(`CREATE TABLE IF NOT EXISTS players_parties (
        slot INTEGER NOT NULL,
        name TEXT NOT NULL,
        character_id_1 INTEGER,
        character_id_2 INTEGER,
        character_id_3 INTEGER,
        unison_character_1 INTEGER,
        unison_character_2 INTEGER,
        unison_character_3 INTEGER,
        equipment_1 INTEGER,
        equipment_2 INTEGER,
        equipment_3 INTEGER,
        ability_soul_1 INTEGER,
        ability_soul_2 INTEGER,
        ability_soul_3 INTEGER,
        edited INTEGER NOT NULL,
        current_battle_power INTEGER NOT NULL DEFAULT 0,
        before_battle_power INTEGER NOT NULL DEFAULT 0,
        player_id INTEGER NOT NULL,
        group_id INTEGER NOT NULL,
        category INTEGER NOT NULL,
        PRIMARY KEY (slot, player_id, group_id, category),
        FOREIGN KEY (group_id, player_id, category) REFERENCES players_party_groups (id, player_id, category) ON DELETE CASCADE,
        FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
    )`).run();
    database.prepare(`CREATE INDEX IF NOT EXISTS idx_players_parties_player_category_order
        ON players_parties (player_id, category, group_id, slot)
    `).run();

    // migration: add current_battle_power and before_battle_power to existing tables
    try { database.prepare(`ALTER TABLE players_parties ADD COLUMN current_battle_power INTEGER NOT NULL DEFAULT 0`).run(); } catch { /* column already exists */ }
    try { database.prepare(`ALTER TABLE players_parties ADD COLUMN before_battle_power INTEGER NOT NULL DEFAULT 0`).run(); } catch { /* column already exists */ }

    // Historical successful-clear parties used by quest recommendations. The
    // payload is frozen at clear time, so later party edits cannot rewrite an
    // old recommendation. Multiplayer COM snapshots use a separate worker DB.
    database.prepare(`CREATE TABLE IF NOT EXISTS quest_npc_party_pool (
        quest_category INTEGER NOT NULL,
        quest_id INTEGER NOT NULL,
        source_player_id INTEGER NOT NULL,
        party_slot INTEGER NOT NULL,
        battle_power INTEGER NOT NULL,
        party_element INTEGER,
        party_payload TEXT NOT NULL,
        cleared_at INTEGER NOT NULL,
        PRIMARY KEY (quest_category, quest_id, source_player_id),
        FOREIGN KEY (source_player_id) REFERENCES players (id) ON DELETE CASCADE
    )`).run()
    database.prepare(`CREATE INDEX IF NOT EXISTS idx_quest_npc_party_pool_power
        ON quest_npc_party_pool (quest_category, quest_id, battle_power DESC, cleared_at DESC)
    `).run()
    database.prepare(`CREATE INDEX IF NOT EXISTS idx_quest_npc_party_pool_recent
        ON quest_npc_party_pool (quest_category, quest_id, cleared_at DESC)
    `).run()

    // database.prepare(`CREATE TABLE IF NOT EXISTS players_party_options (
    //     allow_other_players_to_heal_me INTEGER NOT NULL,
    //     slot INTEGER NOT NULL,
    //     player_id INTEGER NOT NULL,
    //     group_id INTEGER NOT NULL,
    //     category INTEGER NOT NULL,
    //     PRIMARY KEY (slot, player_id, group_id, category),
    //     FOREIGN KEY (slot, player_id, group_id, category) REFERENCES players_parties (slot, player_id, group_id, category) ON DELETE CASCADE,
    //     FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
    // )`).run();

    database.prepare(`CREATE TABLE IF NOT EXISTS players_equipment (
        id INTEGER NOT NULL,
        level INTEGER NOT NULL,
        enhancement_level INTEGER NOT NULL,
        protection INTEGER NOT NULL,
        stack INTEGER NOT NULL,
        player_id INTEGER NOT NULL,
        PRIMARY KEY (id, player_id),
        FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
    )`).run();

    database.prepare(`CREATE TABLE IF NOT EXISTS players_quest_progress (
        section INTEGER NOT NULL,
        quest_id INTEGER NOT NULL,
        finished INTEGER NOT NULL,
        host_finished INTEGER NOT NULL DEFAULT 0,
        unlocked INTEGER NOT NULL DEFAULT 0,
        high_score INTEGER,
        clear_rank INTEGER,
        best_elapsed_time_ms INTEGER,
        leader_character_id INTEGER,
        multi_clear_count INTEGER NOT NULL DEFAULT 0,
        s_plus_reward_received INTEGER NOT NULL DEFAULT 0,
        player_id INTEGER NOT NULL,
        PRIMARY KEY (section, quest_id, player_id),
        FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
    )`).run();

    database.prepare(`CREATE INDEX IF NOT EXISTS idx_players_quest_progress_player_section_finished
        ON players_quest_progress (player_id, section, finished)
    `).run()

    // migrations for quest progress columns added after the original schema
    ensureSchemaColumn(database, "players_quest_progress.leader_character_id")
    ensureSchemaColumn(database, "players_quest_progress.multi_clear_count")
    ensureSchemaColumn(database, "players_quest_progress.unlocked")
    ensureSchemaColumn(database, "players_quest_progress.s_plus_reward_received")


    database.prepare(`CREATE TABLE IF NOT EXISTS players_crazy_gacha (
        player_id INTEGER NOT NULL,
        gacha_id INTEGER NOT NULL,
        session_number INTEGER NOT NULL,
        state_json TEXT NOT NULL,
        PRIMARY KEY (player_id, gacha_id, session_number),
        FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE,
        CHECK (gacha_id = 100 AND session_number > 0)
    )`).run();

    database.prepare(`CREATE TABLE IF NOT EXISTS players_gacha_info (
        gacha_id INTEGER NOT NULL,
        is_daily_first INTEGER NOT NULL,
        is_account_first INTEGER NOT NULL,
        gacha_exchange_point INTEGER,
        player_id INTEGER NOT NULL,
        PRIMARY KEY (gacha_id, player_id),
        FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
    )`).run();

    database.prepare(`CREATE TABLE IF NOT EXISTS players_gacha_campaigns (
        gacha_id INTEGER NOT NULL,
        campaign_id INTEGER NOT NULL,
        count INTEGER NOT NULL,
        player_id INTEGER NOT NULL,
        PRIMARY KEY (gacha_id, campaign_id, player_id),
        FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
    )`).run();

    database.prepare(`CREATE TABLE IF NOT EXISTS players_drawn_quests (
        category_id INTEGER NOT NULL,
        quest_id INTEGER NOT NULL,
        odds_id INTEGER NOT NULL,
        player_id INTEGER NOT NULL,
        PRIMARY KEY (category_id, quest_id, player_id),
        FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
    )`).run();

    database.prepare(`CREATE TABLE IF NOT EXISTS players_periodic_reward_points (
        id INTEGER NOT NULL,
        point INTEGER NOT NULL,
        player_id INTEGER NOT NULL,
        PRIMARY KEY (id, player_id),
        FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
    )`).run();

    database.prepare(`CREATE TABLE IF NOT EXISTS players_active_missions (
        id INTEGER NOT NULL,
        progress INTEGER NOT NULL,
        player_id INTEGER NOT NULL,
        PRIMARY KEY (id, player_id),
        FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
    )`).run();

    database.prepare(`CREATE TABLE IF NOT EXISTS players_active_missions_stages (
        id INTEGER NOT NULL,
        status INTEGER NOT NULL,
        player_id INTEGER NOT NULL,
        mission_id INTEGER NOT NULL,
        PRIMARY KEY (id, mission_id, player_id),
        FOREIGN KEY (mission_id, player_id) REFERENCES players_active_missions (id, player_id) ON DELETE CASCADE,
        FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
    )`).run()

    database.prepare(`CREATE TABLE IF NOT EXISTS players_active_mission_counters (
        player_id INTEGER PRIMARY KEY,
        total_used_mana_count INTEGER NOT NULL DEFAULT 0,
        total_gacha_character_count INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
    )`).run()
    ensureSchemaColumn(database, "players_active_mission_counters.total_equipment_equip_count")
    ensureSchemaColumn(database, "players_active_mission_counters.total_unison_set_count")
    ensureSchemaColumn(database, "players_active_mission_counters.total_party_character_set_count")
    ensureSchemaColumn(database, "players_active_mission_counters.total_injected_exp_count")
    ensureSchemaColumn(database, "players_active_mission_counters.total_gacha_campaign_count")
    ensureSchemaColumn(database, "players_active_mission_counters.practice_quest_challenge_count")

    database.prepare(`CREATE TABLE IF NOT EXISTS players_active_mission_battle_condition_facts (
        player_id INTEGER NOT NULL,
        pattern INTEGER NOT NULL,
        character_id INTEGER NOT NULL,
        progress INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (player_id, pattern, character_id),
        FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
    )`).run()

    database.prepare(`CREATE TABLE IF NOT EXISTS players_active_mission_battle_facts (
        player_id INTEGER NOT NULL,
        mission_id INTEGER NOT NULL,
        progress INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (player_id, mission_id),
        FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
    )`).run()

    database.prepare(`CREATE TABLE IF NOT EXISTS players_character_awake_unlocks (
        player_id INTEGER NOT NULL,
        character_id INTEGER NOT NULL,
        board_index INTEGER NOT NULL,
        awake_level INTEGER NOT NULL,
        PRIMARY KEY (player_id, character_id, board_index),
        FOREIGN KEY (character_id, player_id)
            REFERENCES players_characters (id, player_id) ON DELETE CASCADE,
        FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
    )`).run()

    repairCategoryMissionTables(database)

    database.prepare(`CREATE TABLE IF NOT EXISTS players_category_missions (
        category INTEGER NOT NULL,
        id INTEGER NOT NULL,
        progress INTEGER NOT NULL,
        player_id INTEGER NOT NULL,
        PRIMARY KEY (category, id, player_id),
        FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
    )`).run()

    database.prepare(`CREATE TABLE IF NOT EXISTS players_category_mission_stages (
        category INTEGER NOT NULL,
        id INTEGER NOT NULL,
        status INTEGER NOT NULL,
        player_id INTEGER NOT NULL,
        mission_id INTEGER NOT NULL,
        PRIMARY KEY (category, id, mission_id, player_id),
        FOREIGN KEY (category, mission_id, player_id)
            REFERENCES players_category_missions (category, id, player_id) ON DELETE CASCADE,
        FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
    )`).run()

    // Compatibility repair for the Steam Robot decisive challenge tracker.
    // Older patched builds wrote mission_event entries 900809-900814 into the
    // unrelated active-mission table.  Preserve every legitimately recorded
    // clear by moving its monotonic progress into category 3 at startup.
    database.prepare(`
        INSERT INTO players_category_missions (category, id, progress, player_id)
        SELECT 3, id, progress, player_id
        FROM players_active_missions
        WHERE id BETWEEN 900809 AND 900814
        ON CONFLICT(category, id, player_id) DO UPDATE SET
            progress = MAX(progress, excluded.progress)
    `).run()

    assertStorageLayout(database)
    if (!isCompactStorage(database)) {
    database.prepare(`CREATE TABLE IF NOT EXISTS players_mission_counters (
        player_id INTEGER NOT NULL,
        counter_key TEXT NOT NULL,
        dimension TEXT NOT NULL,
        scope_type TEXT NOT NULL,
        scope_key TEXT NOT NULL,
        qualifier_json TEXT NOT NULL,
        value INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (player_id, counter_key),
        FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
    )`).run()
    database.prepare(`
        CREATE INDEX IF NOT EXISTS idx_players_mission_counters_dimension
        ON players_mission_counters (player_id, scope_type, scope_key, dimension)
    `).run()

    database.prepare(`CREATE TABLE IF NOT EXISTS players_mission_counter_snapshots (
        player_id INTEGER NOT NULL,
        period_type TEXT NOT NULL,
        counter_key TEXT NOT NULL,
        value INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (player_id, period_type, counter_key),
        FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
    )`).run()

    }

    database.prepare(`CREATE TABLE IF NOT EXISTS players_pass_cards (
        player_id INTEGER NOT NULL,
        event_id INTEGER NOT NULL,
        point INTEGER NOT NULL DEFAULT 0,
        is_buy INTEGER NOT NULL DEFAULT 0,
        login_baseline INTEGER,
        PRIMARY KEY (player_id, event_id),
        FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
    )`).run()

    database.prepare(`CREATE TABLE IF NOT EXISTS players_pass_card_rewards (
        player_id INTEGER NOT NULL,
        event_id INTEGER NOT NULL,
        reward_id INTEGER NOT NULL,
        is_received_1 INTEGER NOT NULL DEFAULT 0,
        is_received_2 INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (player_id, event_id, reward_id),
        FOREIGN KEY (player_id, event_id)
            REFERENCES players_pass_cards (player_id, event_id) ON DELETE CASCADE,
        FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
    )`).run()

    database.prepare(`CREATE TABLE IF NOT EXISTS players_box_gacha (
        id INTEGER NOT NULL,
        box_id INTEGER NOT NULL,
        reset_times INTEGER NOT NULL,
        remaining_number INTEGER NOT NULL,
        is_closed INTEGER NOT NULL,
        player_id INTEGER NOT NULL,
        PRIMARY KEY (id, box_id, player_id),
        FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
    )`).run();

    database.prepare(`CREATE TABLE IF NOT EXISTS players_box_gacha_drawn_rewards (
        id INTEGER NOT NULL,
        box_id INTEGER NOT NULL,
        gacha_id INTEGER NOT NULL,
        number INTEGER NOT NULL,
        player_id INTEGER NOT NULL,
        PRIMARY KEY (id, box_id, gacha_id, player_id),
        FOREIGN KEY (gacha_id, box_id, player_id) REFERENCES players_box_gacha (id, box_id, player_id) ON DELETE CASCADE,
        FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
    )`).run();

    database.prepare(`CREATE TABLE IF NOT EXISTS players_shop_quotas (
        player_id INTEGER NOT NULL,
        purchase_key INTEGER NOT NULL,
        period_kind TEXT NOT NULL CHECK(period_kind IN ('day','month','legacy')),
        period_key TEXT NOT NULL,
        count INTEGER NOT NULL CHECK(count >= 0),
        PRIMARY KEY (player_id, purchase_key, period_kind, period_key),
        FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
    )`).run();

    database.prepare(`CREATE TABLE IF NOT EXISTS players_exchange_campaign_receipts (
        campaign_type TEXT NOT NULL CHECK(campaign_type IN ('special','start_dash')),
        campaign_id INTEGER NOT NULL,
        reward_type INTEGER NOT NULL CHECK(reward_type IN (0,1)),
        reward_id INTEGER NOT NULL,
        player_id INTEGER NOT NULL,
        PRIMARY KEY (campaign_type, campaign_id, player_id),
        FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
    )`).run();

    database.prepare(`CREATE TABLE IF NOT EXISTS players_special_exchange_campaigns (
        campaign_id INTEGER NOT NULL,
        status INTEGER NOT NULL CHECK(status IN (1,2,3)),
        player_id INTEGER NOT NULL,
        PRIMARY KEY (campaign_id, player_id),
        FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
    )`).run();

    database.prepare(`CREATE TABLE IF NOT EXISTS players_start_dash_exchange_campaigns (
        campaign_id INTEGER NOT NULL,
        gacha_id INTEGER NOT NULL,
        term_index INTEGER NOT NULL,
        status INTEGER NOT NULL,
        period_start_time DATE NOT NULL,
        period_end_time DATE NOT NULL,
        player_id INTEGER NOT NULL,
        PRIMARY KEY (campaign_id, player_id),
        FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
    )`).run();

    database.prepare(`CREATE TABLE IF NOT EXISTS players_multi_special_exchange_campaigns (
        campaign_id INTEGER NOT NULL,
        status INTEGER NOT NULL,
        ticket_item_id INTEGER,
        player_id INTEGER NOT NULL,
        PRIMARY KEY (campaign_id, player_id),
        FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
    )`).run();
    try { database.prepare(`ALTER TABLE players_multi_special_exchange_campaigns ADD COLUMN ticket_item_id INTEGER`).run(); } catch { /* column already exists */ }

    database.prepare(`CREATE TABLE IF NOT EXISTS players_rush_events (
        player_id INTEGER NOT NULL,
        event_id INTEGER NOT NULL,
        active_rush_battle_folder_id INTEGER,
        endless_battle_max_round INTEGER,
        endless_battle_max_round_time INTEGER,
        endless_battle_max_round_character_id_1 INTEGER,
        endless_battle_max_round_character_id_2 INTEGER,
        endless_battle_max_round_character_id_3 INTEGER,
        endless_battle_max_round_character_evolution_img_lvl_1 INTEGER,
        endless_battle_max_round_character_evolution_img_lvl_2 INTEGER,
        endless_battle_max_round_character_evolution_img_lvl_3 INTEGER,
        PRIMARY KEY (player_id, event_id),
        FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
    )`).run()

    database.prepare(`CREATE TABLE IF NOT EXISTS players_rush_events_cleared_folders (
        player_id INTEGER NOT NULL,
        event_id INTEGER NOT NULL,
        folder_id INTEGER NOT NULL,
        PRIMARY KEY (player_id, event_id, folder_id),
        FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
    )`).run()

    database.prepare(`CREATE TABLE IF NOT EXISTS players_rush_events_played_parties (
        character_id_1 INTEGER,
        character_id_2 INTEGER,
        character_id_3 INTEGER,
        unison_character_id_1 INTEGER,
        unison_character_id_2 INTEGER,
        unison_character_id_3 INTEGER,
        equipment_id_1 INTEGER,
        equipment_id_2 INTEGER,
        equipment_id_3 INTEGER,
        ability_soul_id_1 INTEGER,
        ability_soul_id_2 INTEGER,
        ability_soul_id_3 INTEGER,
        evolution_img_level_1 INTEGER,
        evolution_img_level_2 INTEGER,
        evolution_img_level_3 INTEGER,
        unison_evolution_img_level_1 INTEGER,
        unison_evolution_img_level_2 INTEGER,
        unison_evolution_img_level_3 INTEGER,
        player_id INTEGER NOT NULL,
        event_id INTEGER NOT NULL,
        round INTEGER NOT NULL,
        battle_type INTEGER NOT NULL,
        PRIMARY KEY (player_id, event_id, round, battle_type),
        FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
    )`).run()

    database.prepare(`CREATE TABLE IF NOT EXISTS raid_event_global_state (
        event_id INTEGER PRIMARY KEY,
        total_kill_count INTEGER NOT NULL DEFAULT 0,
        weighted_kill_count INTEGER NOT NULL DEFAULT 0,
        calculation_version INTEGER NOT NULL DEFAULT 5,
        updated_at INTEGER NOT NULL
    )`).run()
    // Version 1 counted every clear as a full communal boss kill. Version 2
    // used the official 76000 threshold. Version 3 temporarily used the
    // private-server threshold 760. Version 4 restored the official threshold
    // and weights. Version 5 keeps those weights while lowering the communal
    // cycle threshold to 30000. Existing ledgers are replayed lazily when the
    // version is older.
    try { database.prepare(`ALTER TABLE raid_event_global_state ADD COLUMN weighted_kill_count INTEGER NOT NULL DEFAULT 0`).run(); } catch { /* column already exists */ }
    try { database.prepare(`ALTER TABLE raid_event_global_state ADD COLUMN calculation_version INTEGER NOT NULL DEFAULT 1`).run(); } catch { /* column already exists */ }

    database.prepare(`CREATE TABLE IF NOT EXISTS raid_event_global_kill_ledger (
        event_id INTEGER NOT NULL,
        play_id TEXT NOT NULL,
        player_id INTEGER NOT NULL,
        quest_id INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (event_id, play_id)
    )`).run()

    database.prepare(`CREATE INDEX IF NOT EXISTS idx_raid_event_global_kill_ledger_event_quest
        ON raid_event_global_kill_ledger (event_id, quest_id)`).run()
    database.prepare(`CREATE INDEX IF NOT EXISTS idx_raid_event_global_kill_ledger_player_event_quest
        ON raid_event_global_kill_ledger (player_id, event_id, quest_id)`).run()

    database.prepare(`CREATE TABLE IF NOT EXISTS players_raid_event_overall_rewards (
        player_id INTEGER NOT NULL,
        event_id INTEGER NOT NULL,
        received_up_to INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (player_id, event_id),
        FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
    )`).run()

    database.prepare(`CREATE TABLE IF NOT EXISTS players_carnival_event_records (
        player_id INTEGER NOT NULL,
        event_id INTEGER NOT NULL,
        folder_id INTEGER NOT NULL,
        best_score INTEGER,
        previous_score INTEGER,
        previous_character_ids TEXT,
        previous_unison_character_ids TEXT,
        PRIMARY KEY (player_id, event_id, folder_id),
        FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
    )`).run()

    database.prepare(`CREATE TABLE IF NOT EXISTS players_carnival_event_rewards (
        player_id INTEGER NOT NULL,
        event_id INTEGER NOT NULL,
        reward_id INTEGER NOT NULL,
        PRIMARY KEY (player_id, event_id, reward_id),
        FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
    )`).run()

    database.prepare(`CREATE TABLE IF NOT EXISTS players_carnival_event_reward_claims (
        player_id INTEGER NOT NULL,
        event_id INTEGER NOT NULL,
        reward_id INTEGER NOT NULL,
        claimed_at INTEGER NOT NULL,
        PRIMARY KEY (player_id, event_id, reward_id),
        FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
    )`).run()

    database.prepare(`CREATE TABLE IF NOT EXISTS players_shop_purchases (
        player_id INTEGER NOT NULL,
        shop_item_id INTEGER NOT NULL,
        count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (player_id, shop_item_id),
        FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
    )`).run()

    database.prepare(`CREATE TABLE IF NOT EXISTS players_active_quests (
        player_id INTEGER PRIMARY KEY,
        play_id TEXT NOT NULL,
        quest_id INTEGER NOT NULL,
        category INTEGER NOT NULL,
        use_boss_boost_point INTEGER NOT NULL DEFAULT 0,
        use_boost_point INTEGER NOT NULL DEFAULT 0,
        is_auto_start_mode INTEGER NOT NULL DEFAULT 0,
        is_multi INTEGER NOT NULL DEFAULT 0,
        is_multi_host INTEGER NOT NULL DEFAULT 0,
        room_number TEXT,
        entry_item_id INTEGER,
        event_id INTEGER,
        continue_count INTEGER NOT NULL DEFAULT 0,
        started_at_ms INTEGER,
        party_slot INTEGER,
        FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
    )`).run()
    ensureSchemaColumn(database, "players_active_quests.is_multi_host")
    ensureSchemaColumn(database, "players_active_quests.started_at_ms")
    ensureSchemaColumn(database, "players_active_quests.party_slot")
    ensureSchemaColumn(database, "players_active_quests.clock_version")
    ensureSchemaColumn(database, "players_active_quests.battle_roster_json")

    database.prepare(`CREATE TABLE IF NOT EXISTS leaderboard_seasons (
        competition_key TEXT PRIMARY KEY,
        season INTEGER NOT NULL DEFAULT 1,
        started_at_ms INTEGER NOT NULL,
        source TEXT NOT NULL DEFAULT 'initial',
        content_revision TEXT
    )`).run()
    ensureSchemaColumn(database, "leaderboard_seasons.content_revision")

    database.prepare(`CREATE TABLE IF NOT EXISTS leaderboard_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        competition_key TEXT NOT NULL,
        player_id INTEGER NOT NULL,
        player_name TEXT,
        season INTEGER NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('active', 'completed', 'abandoned')),
        started_at_ms INTEGER NOT NULL,
        finished_at_ms INTEGER,
        server_duration_ms INTEGER,
        client_battle_ms INTEGER NOT NULL DEFAULT 0,
        rounds_cleared INTEGER NOT NULL DEFAULT 0,
        total_rounds INTEGER NOT NULL,
        tracked_from_round INTEGER NOT NULL,
        pending_round INTEGER,
        pending_quest_id INTEGER,
        pending_started_at_ms INTEGER,
        character_id_1 INTEGER,
        character_id_2 INTEGER,
        character_id_3 INTEGER,
        unison_character_id_1 INTEGER,
        unison_character_id_2 INTEGER,
        unison_character_id_3 INTEGER,
        evolution_img_level_1 INTEGER,
        evolution_img_level_2 INTEGER,
        evolution_img_level_3 INTEGER,
        FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
    )`).run()
    database.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_leaderboard_runs_one_active
        ON leaderboard_runs (competition_key, player_id)
        WHERE status = 'active'`).run()
    database.prepare(`CREATE INDEX IF NOT EXISTS idx_leaderboard_runs_rank
        ON leaderboard_runs (
            competition_key, season, status, tracked_from_round,
            rounds_cleared, total_rounds, client_battle_ms, finished_at_ms, id
        )`).run()

    database.prepare(`CREATE TABLE IF NOT EXISTS leaderboard_run_rounds (
        run_id INTEGER NOT NULL,
        round_number INTEGER NOT NULL,
        quest_id INTEGER NOT NULL,
        client_battle_ms INTEGER NOT NULL,
        server_elapsed_ms INTEGER NOT NULL,
        started_at_ms INTEGER NOT NULL,
        finished_at_ms INTEGER NOT NULL,
        character_id_1 INTEGER,
        character_id_2 INTEGER,
        character_id_3 INTEGER,
        unison_character_id_1 INTEGER,
        unison_character_id_2 INTEGER,
        unison_character_id_3 INTEGER,
        equipment_id_1 INTEGER,
        equipment_id_2 INTEGER,
        equipment_id_3 INTEGER,
        ability_soul_id_1 INTEGER,
        ability_soul_id_2 INTEGER,
        ability_soul_id_3 INTEGER,
        evolution_img_level_1 INTEGER,
        evolution_img_level_2 INTEGER,
        evolution_img_level_3 INTEGER,
        unison_evolution_img_level_1 INTEGER,
        unison_evolution_img_level_2 INTEGER,
        unison_evolution_img_level_3 INTEGER,
        PRIMARY KEY (run_id, round_number),
        FOREIGN KEY (run_id) REFERENCES leaderboard_runs (id) ON DELETE CASCADE
    )`).run()

    database.prepare(`CREATE TABLE IF NOT EXISTS leaderboard_settlement_configs (
        competition_key TEXT PRIMARY KEY,
        auto_enabled INTEGER NOT NULL DEFAULT 0,
        freeze_enabled INTEGER NOT NULL DEFAULT 0 CHECK (freeze_enabled IN (0, 1)),
        settle_at_ms INTEGER,
        repeat_interval_ms INTEGER,
        reward_tiers_json TEXT NOT NULL,
        mail_subject TEXT NOT NULL,
        mail_body TEXT NOT NULL,
        exclude_bots INTEGER NOT NULL DEFAULT 1,
        updated_at_ms INTEGER NOT NULL
    )`).run()

    if (ensureSchemaColumn(database, "leaderboard_settlement_configs.freeze_enabled")) {
        // Preserve old automatic schedules; a disabled schedule stays disabled.
        database.prepare(`UPDATE leaderboard_settlement_configs
            SET freeze_enabled = CASE WHEN auto_enabled <> 0 THEN 1 ELSE 0 END`).run()
    }

    database.prepare(`CREATE TABLE IF NOT EXISTS leaderboard_availability (
        competition_key TEXT PRIMARY KEY,
        enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
        updated_at_ms INTEGER NOT NULL
    )`).run()

    database.prepare(`CREATE TABLE IF NOT EXISTS leaderboard_settlements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        competition_key TEXT NOT NULL,
        season INTEGER NOT NULL,
        source TEXT NOT NULL,
        settled_at_ms INTEGER NOT NULL,
        ranked_players INTEGER NOT NULL,
        rewarded_players INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL,
        summary_json TEXT NOT NULL DEFAULT '{}',
        UNIQUE (competition_key, season)
    )`).run()

    database.prepare(`CREATE TABLE IF NOT EXISTS leaderboard_settlement_results (
        settlement_id INTEGER NOT NULL,
        rank_number INTEGER NOT NULL,
        run_id INTEGER NOT NULL,
        player_id INTEGER NOT NULL,
        player_name TEXT,
        client_battle_ms INTEGER NOT NULL,
        item_id INTEGER,
        item_count INTEGER NOT NULL DEFAULT 0,
        degree_id INTEGER,
        skip_reason TEXT,
        mail_ids_json TEXT NOT NULL DEFAULT '[]',
        clear_count INTEGER CHECK (clear_count >= 1),
        PRIMARY KEY (settlement_id, rank_number),
        FOREIGN KEY (settlement_id) REFERENCES leaderboard_settlements (id) ON DELETE CASCADE
    )`).run()
    ensureSchemaColumn(database, "leaderboard_settlement_results.clear_count")
    database.prepare(`CREATE INDEX IF NOT EXISTS idx_leaderboard_settlements_key_season
        ON leaderboard_settlements (competition_key, season DESC)`).run()

    database.prepare(`CREATE TABLE IF NOT EXISTS players_repair_versions (
        player_id INTEGER NOT NULL,
        repair_key TEXT NOT NULL,
        repair_version INTEGER NOT NULL,
        applied_at TEXT NOT NULL,
        PRIMARY KEY (player_id, repair_key),
        FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
    )`).run();

    // Build potentially large performance indexes after the full schema exists.
    // On an upgraded cloud database this keeps an index failure from skipping
    // any later table initialization.
    database.prepare(`CREATE INDEX IF NOT EXISTS idx_players_mails_player_receive_id
        ON players_mails (player_id, receive_time, id DESC)`).run();
    database.prepare(`CREATE INDEX IF NOT EXISTS idx_daily_vmoney_mail_grants_player_bucket
        ON daily_vmoney_mail_grants (player_id, bucket)`).run();
    database.prepare(`CREATE INDEX IF NOT EXISTS idx_players_receive_history_player_created
        ON players_receive_history (player_id, create_time DESC, id DESC)`).run();
}
