require("ts-node/register/transpile-only")

const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const SqliteDatabase = require("better-sqlite3")

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wave2b-active-host-"))
const databases = new Set()

function openDatabase(name) {
    const database = new SqliteDatabase(path.join(temporaryRoot, `${name}.db`))
    databases.add(database)
    database.pragma("foreign_keys = OFF")
    require("../src/data/initializers/wdfpData").default(database, false)
    database.pragma("foreign_keys = ON")
    return database
}

function closeDatabase(database) {
    if (database?.open) database.close()
    databases.delete(database)
}

function insertPlayer(database, playerId) {
    database.prepare(`INSERT INTO accounts (
        id, app_id, first_login_time, idp_alias, idp_code, idp_id, reg_time, last_login_time, status
    ) VALUES (?, 'wf_cn', '2025-01-01', '', 'active-host', ?, '2025-01-01', '2025-01-01', 'normal')`)
        .run(playerId, `active-host-${playerId}`)
    database.prepare(`INSERT INTO players (
        id, stamina, stamina_heal_time, boost_point, boss_boost_point, transition_state, role, name,
        last_login_time, comment, vmoney, free_vmoney, rank_point, star_crumb, bond_token, exp_pool,
        exp_pooled_time, leader_character_id, party_slot, degree_id, birth, free_mana, paid_mana,
        enable_auto_3x, account_id
    ) VALUES (?, 0, 0, 0, 0, 0, 0, 'active-host', '2025-01-01', '', 0, 0, 0, 0, 0, 0,
        0, 0, 1, 1, 0, 0, 0, 0, ?)`)
        .run(playerId, playerId)
}

try {
    const { activeQuestHostMigration } = require("../src/data/migrations/wdfp/active-quest-host")

    const upgraded = openDatabase("upgraded")
    insertPlayer(upgraded, 1)
    upgraded.prepare(`INSERT INTO players_active_quests (
        player_id, play_id, quest_id, category, is_multi
    ) VALUES (1, 'old-play', 1001, 7, 1)`).run()
    activeQuestHostMigration.apply(upgraded)
    const column = upgraded.prepare(`PRAGMA table_info(players_active_quests)`).all()
        .find(entry => entry.name === "is_multi_host")
    assert.deepEqual(column && {
        type: column.type,
        notnull: column.notnull,
        defaultValue: column.dflt_value,
    }, { type: "INTEGER", notnull: 0, defaultValue: "NULL" })
    assert.equal(upgraded.prepare(`SELECT is_multi_host FROM players_active_quests
        WHERE player_id = 1`).get().is_multi_host, null, "legacy rows must remain unknown")
    upgraded.prepare(`UPDATE players_active_quests SET is_multi_host = 0 WHERE player_id = 1`).run()
    upgraded.prepare(`UPDATE players_active_quests SET is_multi_host = 1 WHERE player_id = 1`).run()
    assert.throws(() => upgraded.prepare(`UPDATE players_active_quests
        SET is_multi_host = 2 WHERE player_id = 1`).run(), /CHECK constraint failed/)
    const schemaAfterFirstApply = upgraded.prepare(`SELECT sql FROM sqlite_master
        WHERE type = 'table' AND name = 'players_active_quests'`).get().sql
    activeQuestHostMigration.apply(upgraded)
    assert.equal(upgraded.prepare(`SELECT sql FROM sqlite_master
        WHERE type = 'table' AND name = 'players_active_quests'`).get().sql, schemaAfterFirstApply)
    closeDatabase(upgraded)

    const wrongShape = openDatabase("wrong-shape")
    wrongShape.prepare(`ALTER TABLE players_active_quests ADD COLUMN is_multi_host TEXT`).run()
    const before = wrongShape.prepare(`SELECT sql FROM sqlite_master
        WHERE type = 'table' AND name = 'players_active_quests'`).get().sql
    assert.throws(() => activeQuestHostMigration.apply(wrongShape),
        /wdfp\/active-quest-host\/v1: incompatible is_multi_host column/)
    assert.equal(wrongShape.prepare(`SELECT sql FROM sqlite_master
        WHERE type = 'table' AND name = 'players_active_quests'`).get().sql, before)
    closeDatabase(wrongShape)

    console.log("active quest host schema tests passed")
} finally {
    for (const database of databases) closeDatabase(database)
    fs.rmSync(temporaryRoot, { recursive: true, force: true })
}
