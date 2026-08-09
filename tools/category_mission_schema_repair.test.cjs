require("ts-node/register/transpile-only")

const assert = require("node:assert/strict")
const { randomUUID } = require("node:crypto")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const databaseDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "category-mission-schema-repair-"))
const previousDataDirectory = process.env.DATA_DIR
const previousDatabaseDirectory = process.env.WDFP_DATABASE_DIR
process.env.DATA_DIR = databaseDirectory
delete process.env.WDFP_DATABASE_DIR
let db

function cleanup() {
    if (db?.open) db.close()
    fs.rmSync(databaseDirectory, { recursive: true, force: true })
    if (previousDataDirectory === undefined) delete process.env.DATA_DIR
    else process.env.DATA_DIR = previousDataDirectory
    if (previousDatabaseDirectory === undefined) delete process.env.WDFP_DATABASE_DIR
    else process.env.WDFP_DATABASE_DIR = previousDatabaseDirectory
}

process.once("exit", cleanup)

const { initializeDatabase } = require("../src/data")
const { getDb } = require("../src/data/db")
const { insertAccountSync } = require("../src/data/domains/account")
const { insertDefaultPlayerSync } = require("../src/data/domains/player")
const initWdfpData = require("../src/data/initializers/wdfpData").default

initializeDatabase()
db = getDb()
const account = insertAccountSync({
    appId: "wf_cn",
    idpAlias: "",
    idpCode: "test",
    idpId: `category-mission-schema-repair-${randomUUID()}`,
    status: "normal",
})
const playerId = insertDefaultPlayerSync(account.id).id

db.pragma("foreign_keys = OFF")
db.exec(`
    DROP TABLE players_category_mission_stages;
    DROP TABLE players_category_missions;
    CREATE TABLE players_category_missions (
        category INTEGER NOT NULL,
        id INTEGER NOT NULL,
        progress INTEGER NOT NULL,
        player_id INTEGER NOT NULL,
        counter_key TEXT NOT NULL,
        dimension TEXT NOT NULL,
        scope_type TEXT NOT NULL,
        scope_key TEXT NOT NULL,
        qualifier_json TEXT NOT NULL,
        value INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (player_id, counter_key)
    );
    CREATE TABLE players_category_mission_stages (
        category INTEGER NOT NULL,
        id INTEGER NOT NULL,
        status INTEGER NOT NULL,
        player_id INTEGER NOT NULL,
        mission_id INTEGER NOT NULL,
        PRIMARY KEY (category, id, mission_id, player_id),
        FOREIGN KEY (category, mission_id, player_id)
            REFERENCES players_category_missions (category, id, player_id) ON DELETE CASCADE
    );
`)
db.prepare(`
    INSERT INTO players_category_missions (
        category, id, progress, player_id, counter_key, dimension,
        scope_type, scope_key, qualifier_json, value, updated_at
    ) VALUES (9, 341005, 4, ?, 'legacy', 'legacy', 'global', '', '{}', 4, '2026-07-26 00:00:00')
`).run(playerId)
db.prepare(`
    INSERT INTO players_category_mission_stages
        (category, id, status, player_id, mission_id)
    VALUES (9, 1, 2, ?, 341005)
`).run(playerId)
db.prepare(`
    INSERT INTO players_active_missions (id, progress, player_id)
    VALUES (900814, 1, ?)
`).run(playerId)
db.pragma("foreign_keys = ON")

initWdfpData(db, true)
initWdfpData(db, true)

const missionPk = db.prepare(`PRAGMA table_info("players_category_missions")`).all()
    .filter(column => column.pk > 0)
    .sort((left, right) => left.pk - right.pk)
    .map(column => column.name)
assert.deepEqual(missionPk, ["category", "id", "player_id"])
assert.deepEqual(db.prepare(`
    SELECT category, id, progress, player_id
    FROM players_category_missions
    ORDER BY category, id
`).all(), [
    { category: 3, id: 900814, progress: 1, player_id: playerId },
    { category: 9, id: 341005, progress: 4, player_id: playerId },
])
assert.deepEqual(db.prepare(`
    SELECT category, id, status, player_id, mission_id
    FROM players_category_mission_stages
`).all(), [{ category: 9, id: 1, status: 2, player_id: playerId, mission_id: 341005 }])
assert.deepEqual(db.prepare(`PRAGMA foreign_key_check`).all(), [])

db.prepare(`
    DELETE FROM players_category_missions
    WHERE category = 3 AND id = 900814 AND player_id = ?
`).run(playerId)
const { trackSteamRobotChallengeMission } = require("../src/lib/mission/steam-robot-challenge")
assert.equal(trackSteamRobotChallengeMission({
    playerId,
    questCategory: 26,
    questId: 1006001,
    questAccomplished: true,
    clearRank: 5,
    statistics: {
        mission_client_checks: [{
            check_id: "hard_multi_steam_robot_dark",
            result: true,
        }],
    },
}), 900814)
assert.deepEqual(db.prepare(`
    SELECT category, id, progress, player_id
    FROM players_category_missions
    WHERE category = 3 AND id = 900814 AND player_id = ?
`).get(playerId), { category: 3, id: 900814, progress: 1, player_id: playerId })

console.log("category mission schema repair tests passed")
