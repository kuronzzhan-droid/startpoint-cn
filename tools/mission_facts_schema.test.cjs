require("ts-node/register/transpile-only")

const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const SqliteDatabase = require("better-sqlite3")

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wf-mission-facts-"))
const previousDatabaseDirectory = process.env.WF_DATABASE_DIR
process.env.WF_DATABASE_DIR = temporaryRoot
const databases = new Set()

function openDatabase(name) {
    const databasePath = path.join(temporaryRoot, `${name}.db`)
    assert.equal(path.dirname(databasePath), temporaryRoot)
    const database = new SqliteDatabase(databasePath)
    database.pragma("foreign_keys = ON")
    databases.add(database)
    return database
}

function insertPlayer(database, playerId, degreeId = 1) {
    database.prepare(`
        INSERT INTO accounts (
            id, app_id, first_login_time, idp_alias, idp_code, idp_id,
            reg_time, last_login_time, status
        ) VALUES (?, 'wf_cn', '2025-01-01', '', 'test', ?, '2025-01-01', '2025-01-01', 'normal')
    `).run(playerId, `mission-facts-${playerId}`)
    database.prepare(`
        INSERT INTO players (
            id, stamina, stamina_heal_time, boost_point, boss_boost_point,
            transition_state, role, name, last_login_time, comment,
            vmoney, free_vmoney, rank_point, star_crumb, bond_token,
            exp_pool, exp_pooled_time, leader_character_id, party_slot,
            degree_id, birth, free_mana, paid_mana, enable_auto_3x, account_id
        ) VALUES (
            ?, 0, 0, 0, 0, 0, 0, 'tester', '2025-01-01', '',
            0, 0, 0, 0, 0, 0, 0, 0, 1, ?, 0, 0, 0, 0, ?
        )
    `).run(playerId, degreeId, playerId)
}

function columnMap(database, tableName) {
    return Object.fromEntries(database.prepare(`PRAGMA table_info("${tableName}")`).all().map(column => [
        column.name,
        {
            type: column.type.toUpperCase(),
            notnull: column.notnull,
            defaultValue: column.dflt_value,
            pk: column.pk,
        },
    ]))
}

function tableNames(database) {
    return new Set(database.prepare(`
        SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    `).all().map(row => row.name))
}

function foreignKeyShapes(database, tableName) {
    const groups = new Map()
    for (const row of database.prepare(`PRAGMA foreign_key_list("${tableName}")`).all()) {
        const group = groups.get(row.id) ?? {
            table: row.table,
            onDelete: row.on_delete,
            from: [],
            to: [],
        }
        group.from[row.seq] = row.from
        group.to[row.seq] = row.to
        groups.set(row.id, group)
    }
    return [...groups.values()].map(group =>
        `${group.table}|${group.onDelete}|${group.from.join(",")}|${group.to.join(",")}`
    ).sort()
}

function assertIntegerZeroColumn(columns, name) {
    assert.deepEqual(columns[name], {
        type: "INTEGER",
        notnull: 1,
        defaultValue: "0",
        pk: 0,
    }, `${name} must be the canonical INTEGER NOT NULL DEFAULT 0 column`)
}

function assertNoForeignKeyViolations(database) {
    assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), [])
}

let initWdfpData
let categoryMissionMigration
let passCardMigration
let missionFactsMigration
let ensureSchemaColumn

try {
    ;({ default: initWdfpData } = require("../src/data/initializers/wdfpData"))
    ;({ categoryMissionMigration } = require("../src/data/migrations/wdfp/category-mission"))
    ;({ passCardMigration } = require("../src/data/migrations/wdfp/pass-card"))
    ;({ missionFactsMigration } = require("../src/data/migrations/wdfp/mission-facts"))
    ;({ ensureSchemaColumn } = require("../src/data/schema"))

    function prepareBase(database, playerIds = [1]) {
        initWdfpData(database, false)
        for (const playerId of playerIds) insertPlayer(database, playerId)
        categoryMissionMigration.apply(database)
        passCardMigration.apply(database)
    }

    {
        const database = openDatabase("fresh")
        prepareBase(database)
        database.prepare(`
            INSERT INTO players_periodic_snapshots (
                player_id, period_type, quest_clears, stamina_used,
                rank_ss, rank_s, rank_a, rank_b, updated_at
            ) VALUES (1, 'daily', 7, 8, 9, 10, 11, 12, 'legacy-time')
        `).run()
        database.prepare(`
            INSERT INTO players_quest_progress (
                section, quest_id, finished, unlocked, player_id
            ) VALUES (1, 100, 1, 1, 1)
        `).run()

        const beforeTables = tableNames(database)
        missionFactsMigration.apply(database)
        assert.equal(missionFactsMigration.id, "wdfp/mission-facts/v1")

        const afterTables = tableNames(database)
        assert.deepEqual([...afterTables].filter(name => !beforeTables.has(name)).sort(), [
            "players_active_mission_battle_condition_facts",
            "players_active_mission_battle_facts",
            "players_active_mission_counters",
            "players_collected_items",
            "players_mission_battle_counters",
        ])

        const missionColumns = columnMap(database, "players_mission_battle_counters")
        assert.deepEqual(Object.keys(missionColumns), [
            "player_id", "single_play_count", "single_clear_count",
            "multi_play_count", "multi_clear_count", "multi_host_clear_count",
            "multi_guest_clear_count", "single_rank_ss_count", "rank_ss_count",
            "rank_s_count", "rank_a_count", "rank_b_count",
        ])
        assert.equal(missionColumns.player_id.pk, 1)
        for (const name of Object.keys(missionColumns).slice(1)) assertIntegerZeroColumn(missionColumns, name)
        assert.deepEqual(foreignKeyShapes(database, "players_mission_battle_counters"), [
            "players|CASCADE|player_id|id",
        ])

        const activeColumns = columnMap(database, "players_active_mission_counters")
        assert.deepEqual(Object.keys(activeColumns), [
            "player_id", "total_used_mana_count", "total_gacha_character_count",
            "total_equipment_equip_count", "total_unison_set_count",
            "total_party_character_set_count", "total_injected_exp_count",
            "total_gacha_campaign_count", "practice_quest_challenge_count",
        ])
        assert.equal(activeColumns.player_id.pk, 1)
        for (const name of Object.keys(activeColumns).slice(1)) assertIntegerZeroColumn(activeColumns, name)

        const conditionColumns = columnMap(database, "players_active_mission_battle_condition_facts")
        assert.deepEqual([
            conditionColumns.player_id.pk,
            conditionColumns.pattern.pk,
            conditionColumns.character_id.pk,
        ], [1, 2, 3])
        assertIntegerZeroColumn(conditionColumns, "progress")

        const battleColumns = columnMap(database, "players_active_mission_battle_facts")
        assert.deepEqual([battleColumns.player_id.pk, battleColumns.mission_id.pk], [1, 2])
        assertIntegerZeroColumn(battleColumns, "progress")

        const collectedColumns = columnMap(database, "players_collected_items")
        assert.deepEqual([collectedColumns.player_id.pk, collectedColumns.item_id.pk], [1, 2])
        assertIntegerZeroColumn(collectedColumns, "total_obtained")

        const periodicColumns = columnMap(database, "players_periodic_snapshots")
        for (const name of [
            "single_play_count", "single_clear_count", "multi_play_count",
            "multi_clear_count", "multi_host_clear_count", "multi_guest_clear_count",
            "dash_count", "power_flip_count", "login_days",
        ]) assertIntegerZeroColumn(periodicColumns, name)
        assert.deepEqual(database.prepare(`
            SELECT quest_clears, stamina_used, rank_ss, rank_s, rank_a, rank_b,
                   updated_at, single_play_count, multi_clear_count, login_days
            FROM players_periodic_snapshots WHERE player_id = 1 AND period_type = 'daily'
        `).get(), {
            quest_clears: 7,
            stamina_used: 8,
            rank_ss: 9,
            rank_s: 10,
            rank_a: 11,
            rank_b: 12,
            updated_at: "legacy-time",
            single_play_count: 0,
            multi_clear_count: 0,
            login_days: 0,
        })

        assertIntegerZeroColumn(columnMap(database, "players_quest_progress"), "host_finished")
        assert.equal(columnMap(database, "players_quest_progress").s_plus_reward_received, undefined)
        assert.equal(database.prepare(`
            SELECT host_finished FROM players_quest_progress
            WHERE player_id = 1 AND section = 1 AND quest_id = 100
        `).get().host_finished, 0)
        assert.equal(ensureSchemaColumn(database, "players_quest_progress.host_finished"), false)
        assert.throws(
            () => ensureSchemaColumn(database, "players_quest_progress.s_plus_reward_received"),
            /Unknown schema column/,
        )

        database.exec(`
            INSERT INTO players_mission_battle_counters (player_id, single_play_count) VALUES (1, 2);
            INSERT INTO players_active_mission_counters (player_id, total_used_mana_count) VALUES (1, 3);
            INSERT INTO players_active_mission_battle_condition_facts
                (player_id, pattern, character_id, progress) VALUES (1, 4, 5, 6);
            INSERT INTO players_active_mission_battle_facts
                (player_id, mission_id, progress) VALUES (1, 7, 8);
            INSERT INTO players_collected_items
                (player_id, item_id, total_obtained) VALUES (1, 9, 10);
        `)
        missionFactsMigration.apply(database)
        assertNoForeignKeyViolations(database)

        database.prepare("DELETE FROM players WHERE id = 1").run()
        for (const tableName of [
            "players_mission_battle_counters",
            "players_active_mission_counters",
            "players_active_mission_battle_condition_facts",
            "players_active_mission_battle_facts",
            "players_collected_items",
            "players_periodic_snapshots",
            "players_quest_progress",
        ]) {
            assert.equal(database.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get().count, 0)
        }
        assertNoForeignKeyViolations(database)
    }

    {
        const database = openDatabase("legacy")
        prepareBase(database)
        database.exec(`
            CREATE TABLE players_mission_battle_counters (
                player_id INTEGER PRIMARY KEY,
                single_play_count INTEGER NOT NULL DEFAULT 0,
                single_clear_count INTEGER NOT NULL DEFAULT 0,
                multi_play_count INTEGER NOT NULL DEFAULT 0,
                multi_clear_count INTEGER NOT NULL DEFAULT 0,
                multi_host_clear_count INTEGER NOT NULL DEFAULT 0,
                multi_guest_clear_count INTEGER NOT NULL DEFAULT 0,
                rank_ss_count INTEGER NOT NULL DEFAULT 0,
                rank_s_count INTEGER NOT NULL DEFAULT 0,
                rank_a_count INTEGER NOT NULL DEFAULT 0,
                rank_b_count INTEGER NOT NULL DEFAULT 0,
                FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
            );
            CREATE TABLE players_active_mission_counters (
                player_id INTEGER PRIMARY KEY,
                total_used_mana_count INTEGER NOT NULL DEFAULT 0,
                total_gacha_character_count INTEGER NOT NULL DEFAULT 0,
                FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
            );
            INSERT INTO players_mission_battle_counters
                (player_id, single_play_count, rank_ss_count) VALUES (1, 12, 4);
            INSERT INTO players_active_mission_counters
                (player_id, total_used_mana_count, total_gacha_character_count) VALUES (1, 20, 3);
        `)
        missionFactsMigration.apply(database)
        assert.deepEqual(database.prepare(`
            SELECT single_play_count, rank_ss_count, single_rank_ss_count
            FROM players_mission_battle_counters WHERE player_id = 1
        `).get(), { single_play_count: 12, rank_ss_count: 4, single_rank_ss_count: 0 })
        assert.deepEqual(database.prepare(`
            SELECT total_used_mana_count, total_gacha_character_count,
                   total_equipment_equip_count, practice_quest_challenge_count
            FROM players_active_mission_counters WHERE player_id = 1
        `).get(), {
            total_used_mana_count: 20,
            total_gacha_character_count: 3,
            total_equipment_equip_count: 0,
            practice_quest_challenge_count: 0,
        })
        missionFactsMigration.apply(database)
        assertNoForeignKeyViolations(database)
    }

    for (const [name, tableName, insertSql] of [
        ["periodic-orphan", "players_periodic_snapshots", `
            INSERT INTO players_periodic_snapshots (
                player_id, period_type, quest_clears, stamina_used,
                rank_ss, rank_s, rank_a, rank_b, updated_at
            ) VALUES (999, 'daily', 1, 2, 3, 4, 5, 6, 'orphan')
        `],
        ["quest-orphan", "players_quest_progress", `
            INSERT INTO players_quest_progress (
                section, quest_id, finished, unlocked, player_id
            ) VALUES (1, 100, 1, 1, 999)
        `],
    ]) {
        const database = openDatabase(name)
        prepareBase(database)
        database.pragma("foreign_keys = OFF")
        database.exec(insertSql)
        database.pragma("foreign_keys = ON")
        const beforeColumns = Object.keys(columnMap(database, tableName))
        assert.throws(() => missionFactsMigration.apply(database), /foreign key/)
        assert.deepEqual(Object.keys(columnMap(database, tableName)), beforeColumns)
        assert.equal(database.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get().count, 1)
        assert.equal(tableNames(database).has("players_mission_battle_counters"), false)
    }

    {
        const database = openDatabase("wrong-column")
        prepareBase(database)
        database.prepare("ALTER TABLE players_quest_progress ADD COLUMN host_finished TEXT").run()
        assert.throws(() => missionFactsMigration.apply(database), /non-canonical column/)
        assert.equal(tableNames(database).has("players_mission_battle_counters"), false)
        assert.equal(columnMap(database, "players_periodic_snapshots").single_play_count, undefined)
    }

    {
        const database = openDatabase("wrong-table")
        prepareBase(database)
        database.exec(`
            CREATE TABLE players_collected_items (
                player_id INTEGER NOT NULL,
                item_id INTEGER NOT NULL,
                total_obtained TEXT,
                PRIMARY KEY (item_id, player_id)
            )
        `)
        assert.throws(() => missionFactsMigration.apply(database), /players_collected_items/)
        assert.equal(tableNames(database).has("players_mission_battle_counters"), false)
        assert.equal(columnMap(database, "players_quest_progress").host_finished, undefined)
    }

    console.log("mission facts schema migration tests passed")
} finally {
    for (const database of databases) {
        if (database.open) database.close()
    }
    if (previousDatabaseDirectory === undefined) delete process.env.WF_DATABASE_DIR
    else process.env.WF_DATABASE_DIR = previousDatabaseDirectory
    fs.rmSync(temporaryRoot, { recursive: true, force: true })
}
