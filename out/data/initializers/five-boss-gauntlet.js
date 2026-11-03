"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initializeFiveBossGauntlet = void 0;
/** Additive ledger: existing inventory, quest progress and saves stay in place. */
function initializeFiveBossGauntlet(database) {
    database.exec(`
        CREATE TABLE IF NOT EXISTS five_boss_continue_receipts (
            player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
            play_id TEXT NOT NULL,
            is_multi INTEGER NOT NULL CHECK(is_multi IN (0, 1)),
            request_key TEXT NOT NULL,
            PRIMARY KEY(player_id, play_id, is_multi)
        );
        CREATE TABLE IF NOT EXISTS five_boss_solo_runs (
            player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
            play_id TEXT NOT NULL,
            status TEXT NOT NULL CHECK(status IN ('active', 'settled', 'aborted')),
            finish_request_key TEXT,
            response_json TEXT,
            PRIMARY KEY(player_id, play_id),
            UNIQUE(player_id, finish_request_key)
        );
        CREATE TABLE IF NOT EXISTS five_boss_gauntlet_runs (
            run_id TEXT PRIMARY KEY,
            host_player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
            route_id TEXT NOT NULL,
            room_number TEXT NOT NULL,
            ticket_item_id INTEGER NOT NULL,
            expected_member_count INTEGER NOT NULL CHECK(expected_member_count BETWEEN 1 AND 3),
            status TEXT NOT NULL CHECK(status IN ('active', 'settled', 'aborted')),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS five_boss_active_room
            ON five_boss_gauntlet_runs(room_number) WHERE status = 'active';
        CREATE TABLE IF NOT EXISTS five_boss_gauntlet_members (
            run_id TEXT NOT NULL REFERENCES five_boss_gauntlet_runs(run_id) ON DELETE CASCADE,
            player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
            client_play_id TEXT,
            is_auto_mode INTEGER CHECK(is_auto_mode IN (0, 1)),
            started_at TEXT,
            battle_entered_at TEXT,
            aborted_at TEXT,
            level_next_at TEXT,
            finalized_at TEXT,
            party_character_ids_json TEXT NOT NULL DEFAULT '[]',
            PRIMARY KEY(run_id, player_id),
            UNIQUE(player_id, client_play_id)
        );
        CREATE TABLE IF NOT EXISTS five_boss_gauntlet_receipts (
            run_id TEXT NOT NULL,
            player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
            reward_multiplier INTEGER NOT NULL CHECK(reward_multiplier IN (1, 2)),
            reward_json TEXT NOT NULL,
            settled_at TEXT NOT NULL,
            PRIMARY KEY(run_id, player_id),
            FOREIGN KEY(run_id, player_id)
                REFERENCES five_boss_gauntlet_members(run_id, player_id) ON DELETE CASCADE
        );
    `);
    // NULL/1 keeps runs started before this migration at their original 1x.
    const soloInfo = database.prepare("PRAGMA table_info(five_boss_solo_runs)").all();
    const soloColumns = new Set(soloInfo.map(column => column.name));
    if (!soloColumns.has("auto_at_start")) {
        database.exec("ALTER TABLE five_boss_solo_runs ADD COLUMN auto_at_start INTEGER CHECK(auto_at_start IN (0, 1))");
    }
    if (!soloColumns.has("auto_used")) {
        database.exec("ALTER TABLE five_boss_solo_runs ADD COLUMN auto_used INTEGER NOT NULL DEFAULT 1 CHECK(auto_used IN (0, 1))");
    }
    const memberInfo = database.prepare("PRAGMA table_info(five_boss_gauntlet_members)").all();
    if (!memberInfo.some(column => column.name === "battle_entered_at")) {
        database.exec("ALTER TABLE five_boss_gauntlet_members ADD COLUMN battle_entered_at TEXT");
    }
}
exports.initializeFiveBossGauntlet = initializeFiveBossGauntlet;
