require("ts-node/register/transpile-only")

const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wave2a-8-category-domain-"))
const previousDatabaseDirectory = process.env.WF_DATABASE_DIR
const worktreeDatabase = path.resolve(__dirname, "..", ".database")
let database

function insertPlayer(playerId) {
    database.prepare(`
        INSERT INTO accounts (
            id, app_id, first_login_time, idp_alias, idp_code, idp_id,
            reg_time, last_login_time, status
        ) VALUES (?, 'wf_cn', '2025-01-01', '', 'test', ?, '2025-01-01', '2025-01-01', 'normal')
    `).run(playerId, `wave2a-8-category-${playerId}`)
    database.prepare(`
        INSERT INTO players (
            id, stamina, stamina_heal_time, boost_point, boss_boost_point,
            transition_state, role, name, last_login_time, comment,
            vmoney, free_vmoney, rank_point, star_crumb, bond_token,
            exp_pool, exp_pooled_time, leader_character_id, party_slot,
            degree_id, birth, free_mana, paid_mana, enable_auto_3x, account_id
        ) VALUES (
            ?, 0, 0, 0, 0, 0, 0, 'tester', '2025-01-01', '',
            0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, ?
        )
    `).run(playerId, playerId)
}

function assertContractError(callback) {
    assert.throws(callback, error => error instanceof TypeError || error instanceof RangeError)
}

function snapshotCategoryTables() {
    return {
        schema: database.prepare(`
            SELECT name, sql FROM sqlite_master
            WHERE type = 'table' AND name IN ('players_category_missions', 'players_category_mission_stages')
            ORDER BY name
        `).all(),
        missions: database.prepare(`
            SELECT * FROM players_category_missions ORDER BY player_id, category, id
        `).all(),
        stages: database.prepare(`
            SELECT * FROM players_category_mission_stages ORDER BY player_id, category, mission_id, id
        `).all(),
    }
}

try {
    process.env.WF_DATABASE_DIR = temporaryRoot
    const { getDb } = require("../src/data/db")
    database = getDb()
    const mainDatabase = database.pragma("database_list").find(entry => entry.name === "main")
    assert.equal(path.dirname(path.resolve(mainDatabase.file)), path.resolve(temporaryRoot))
    assert.equal(database.pragma("foreign_keys", { simple: true }), 1)
    insertPlayer(1)
    insertPlayer(2)
    insertPlayer(3)

    assert.throws(
        () => database.prepare("SELECT * FROM players_category_missions").get(),
        /no such table: players_category_missions/,
    )

    const mission = require("../src/data/domains/mission")
    for (const exportName of [
        "getPlayerCategoryMissionsSync",
        "getPlayerCategoryMissionListSync",
        "getPlayerClearedCollectItemEventMissionListSync",
        "insertPlayerCategoryMissionListSync",
        "updatePlayerCategoryMissionSync",
        "incrementPlayerCategoryMissionSync",
        "updatePlayerCategoryMissionStageSync",
        "deletePlayerCategoryMissionsSync",
    ]) {
        assert.equal(typeof mission[exportName], "function", `${exportName} must be exported`)
    }
    assert.throws(() => mission.getPlayerCategoryMissionsSync(1, 1), /no such table/)

    const { categoryMissionMigration } = require("../src/data/migrations/wdfp/category-mission")
    categoryMissionMigration.apply(database)

    assert.deepEqual(mission.getPlayerCategoryMissionsSync(1, 1), {})
    assert.deepEqual(mission.getPlayerCategoryMissionListSync(1), {})
    mission.updatePlayerCategoryMissionSync(1, 1, "10", 1.5)
    mission.updatePlayerCategoryMissionSync(1, 2, 10, Number.MAX_SAFE_INTEGER + 2)
    mission.updatePlayerCategoryMissionStageSync(1, 1, 1, 10, true)
    mission.updatePlayerCategoryMissionStageSync(1, 2, 1, 10, false)

    assert.deepEqual(mission.getPlayerCategoryMissionsSync(1, 1), {
        "10": { progress: 1.5, stages: { "1": true } },
    })
    assert.deepEqual(mission.getPlayerCategoryMissionsSync(1, 2), {
        "10": { progress: Number.MAX_SAFE_INTEGER + 2, stages: { "1": false } },
    })
    assert.deepEqual(mission.getPlayerCategoryMissionListSync(1), {
        "1": { "10": { progress: 1.5, stages: { "1": true } } },
        "2": { "10": { progress: Number.MAX_SAFE_INTEGER + 2, stages: { "1": false } } },
    })

    mission.incrementPlayerCategoryMissionSync(1, 1, 10, 0.25)
    assert.equal(mission.getPlayerCategoryMissionsSync(1, 1)["10"].progress, 1.75)
    mission.updatePlayerCategoryMissionSync(1, 1, 10, 4)
    assert.equal(mission.getPlayerCategoryMissionsSync(1, 1)["10"].progress, 4)

    for (const stageId of [1, 3, 2]) {
        mission.updatePlayerCategoryMissionSync(1, 4, 99, 1)
        mission.updatePlayerCategoryMissionStageSync(1, 4, stageId, 99, stageId !== 2)
    }
    assert.deepEqual(mission.getPlayerClearedCollectItemEventMissionListSync(1), { "99": 3 })

    const imported = {
        "6": {
            "100": { progress: 2.5, stages: { "1": true, "2": false } },
        },
        "7": {
            "100": { progress: Number.MAX_SAFE_INTEGER + 4, stages: [] },
        },
    }
    mission.insertPlayerCategoryMissionListSync(2, imported)
    assert.deepEqual(mission.getPlayerCategoryMissionListSync(2), imported)

    const beforeInvalidBatch = snapshotCategoryTables()
    assertContractError(() => mission.insertPlayerCategoryMissionListSync(2, {
        "8": { "1": { progress: 1, stages: { "1": true } } },
        "bad": { "2": { progress: 2, stages: [] } },
    }))
    assert.deepEqual(snapshotCategoryTables(), beforeInvalidBatch)
    assertContractError(() => mission.insertPlayerCategoryMissionListSync(2, {
        "8": { "1": { progress: 1, stages: [true] } },
    }))
    assert.deepEqual(snapshotCategoryTables(), beforeInvalidBatch)
    assertContractError(() => mission.insertPlayerCategoryMissionListSync(2, {
        "8": { "1": { progress: 1, stages: { "1": "yes" } } },
    }))
    assert.deepEqual(snapshotCategoryTables(), beforeInvalidBatch)

    const invalidIds = [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "01", " 1", "+1"]
    for (const invalid of invalidIds) {
        assertContractError(() => mission.getPlayerCategoryMissionsSync(1, invalid))
        assertContractError(() => mission.updatePlayerCategoryMissionSync(1, 9, invalid, 1))
        assertContractError(() => mission.updatePlayerCategoryMissionStageSync(1, 9, invalid, 1, true))
    }
    for (const invalid of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
        assertContractError(() => mission.updatePlayerCategoryMissionSync(1, 9, 1, invalid))
    }
    for (const invalid of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
        assertContractError(() => mission.incrementPlayerCategoryMissionSync(1, 9, 1, invalid))
    }
    assertContractError(() => mission.updatePlayerCategoryMissionStageSync(1, 9, 1, 1, 1))
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM players_category_missions WHERE category = 9").get().count, 0)

    assert.throws(
        () => mission.updatePlayerCategoryMissionStageSync(3, 10, 1, 999, true),
        /FOREIGN KEY/,
    )
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM players_category_mission_stages WHERE player_id = 3").get().count, 0)

    mission.updatePlayerCategoryMissionSync(3, 11, 1, Number.MAX_VALUE)
    assert.throws(() => mission.incrementPlayerCategoryMissionSync(3, 11, 1, Number.MAX_VALUE), RangeError)
    assert.equal(mission.getPlayerCategoryMissionsSync(3, 11)["1"].progress, Number.MAX_VALUE)

    assert.throws(() => database.transaction(() => {
        mission.updatePlayerCategoryMissionSync(3, 12, 1, 1)
        mission.updatePlayerCategoryMissionStageSync(3, 12, 1, 1, true)
        throw new Error("rollback category")
    })(), /rollback category/)
    assert.deepEqual(mission.getPlayerCategoryMissionsSync(3, 12), {})

    database.prepare("INSERT INTO players_active_missions (id, progress, player_id) VALUES (88, 7, 1)").run()
    mission.updatePlayerCategoryMissionSync(1, 13, 88, 9)
    mission.deletePlayerCategoryMissionsSync(1, 13)
    mission.deletePlayerCategoryMissionsSync(1, 13)
    assert.deepEqual(mission.getPlayerCategoryMissionsSync(1, 13), {})
    assert.deepEqual(database.prepare("SELECT * FROM players_active_missions WHERE id = 88 AND player_id = 1").get(), {
        id: 88,
        progress: 7,
        player_id: 1,
    })
    assert.notDeepEqual(mission.getPlayerCategoryMissionsSync(1, 2), {})

    database.prepare("UPDATE players_category_missions SET progress = -1 WHERE player_id = 1 AND category = 1").run()
    assert.throws(() => mission.getPlayerCategoryMissionsSync(1, 1), RangeError)
    database.prepare("UPDATE players_category_missions SET progress = 1 WHERE player_id = 1 AND category = 1").run()
    database.prepare("UPDATE players_category_mission_stages SET status = 2 WHERE player_id = 1 AND category = 1").run()
    assert.throws(() => mission.getPlayerCategoryMissionsSync(1, 1), TypeError)
} finally {
    if (database?.open) database.close()
    if (previousDatabaseDirectory === undefined) delete process.env.WF_DATABASE_DIR
    else process.env.WF_DATABASE_DIR = previousDatabaseDirectory
    fs.rmSync(temporaryRoot, { recursive: true, force: true })
}

assert.equal(fs.existsSync(temporaryRoot), false)
assert.equal(fs.existsSync(worktreeDatabase), false)
console.log("category mission domain tests passed")
