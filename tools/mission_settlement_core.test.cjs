require("ts-node/register/transpile-only")

const assert = require("node:assert/strict")
const { randomUUID } = require("node:crypto")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mission-settlement-core-"))
const previousDatabaseDirectory = process.env.WF_DATABASE_DIR
process.env.WF_DATABASE_DIR = temporaryRoot
let database

function cleanup() {
    if (database?.open) database.close()
    if (previousDatabaseDirectory === undefined) delete process.env.WF_DATABASE_DIR
    else process.env.WF_DATABASE_DIR = previousDatabaseDirectory
    fs.rmSync(temporaryRoot, { recursive: true, force: true })
}

process.once("exit", cleanup)

try {
    const { getDb } = require("../src/data/db")
    database = getDb()
    const { insertAccountSync } = require("../src/data/domains/account")
    const { hasPlayerDegreeSync } = require("../src/data/domains/degree")
    const {
        getPlayerCategoryMissionsSync,
        updatePlayerCategoryMissionSync,
    } = require("../src/data/domains/mission")
    const { getPlayerSync, insertDefaultPlayerSync, updatePlayerSync } = require("../src/data/domains/player")
    const { settleMissionCategories } = require("../src/lib/mission/settlement")
    const {
        getCategoryMissionRewardStageDefinition,
    } = require("../src/lib/mission/rewards")
    const { getMissionIdsByCategory } = require("../src/lib/mission/stages")

    function createPlayer(label) {
        const account = insertAccountSync({
            appId: "wf_cn",
            idpAlias: "",
            idpCode: "test",
            idpId: `${label}-${randomUUID()}`,
            status: "normal",
        })
        return insertDefaultPlayerSync(account.id).id
    }

    const evaluationTime = new Date("2025-01-01T12:00:00.000Z")
    const playerId = createPlayer("regular")
    assert.throws(
        () => settleMissionCategories(
            playerId,
            [{ category: 1, missionIds: new Array(1) }],
            evaluationTime,
        ),
        /missionIds must be dense/,
    )
    assert.throws(
        () => settleMissionCategories(playerId, [1], new Date(Number.NaN)),
        /evaluationTime must be a valid Date/,
    )
    const initialVmoney = getPlayerSync(playerId).freeVmoney
    updatePlayerCategoryMissionSync(playerId, 1, 1, 30)

    const first = settleMissionCategories(playerId, [1], evaluationTime)
    assert.deepEqual(first.missionInfo, [
        { mission_category_id: 1, mission_id: 1, mission_reward_id: 1001 },
        { mission_category_id: 1, mission_id: 1, mission_reward_id: 1002 },
        { mission_category_id: 1, mission_id: 1, mission_reward_id: 1003 },
    ])
    assert.equal(first.userInfo.free_vmoney, initialVmoney + 15)
    assert.deepEqual(getPlayerCategoryMissionsSync(playerId, 1)[1], {
        progress: 30,
        stages: { 1: true, 2: true, 3: true },
    })
    assert.deepEqual(settleMissionCategories(playerId, [1], evaluationTime).missionInfo, [])
    assert.equal(getPlayerSync(playerId).freeVmoney, initialVmoney + 15)

    assert.equal(getMissionIdsByCategory(6).includes(1), true)
    assert.deepEqual(getCategoryMissionRewardStageDefinition(6, 1, 1), {
        missionRewardId: 1001,
        targetProgress: 1,
        rewards: [{ kind: 7, amount: 50 }],
    })

    const degreePlayerId = createPlayer("degree")
    updatePlayerCategoryMissionSync(degreePlayerId, 5, 1000, 50)
    const degree = settleMissionCategories(
        degreePlayerId,
        [{ category: 5, missionIds: [1000] }],
        evaluationTime,
    )
    assert.deepEqual(degree.degreeIds, [1000])
    assert.equal(hasPlayerDegreeSync(degreePlayerId, 1000), true)
    assert.equal(getPlayerSync(degreePlayerId).degreeId, 1, "earning a title must not equip it")

    const passPlayerId = createPlayer("pass")
    updatePlayerCategoryMissionSync(passPlayerId, 6, 9, 1)
    const pass = settleMissionCategories(
        passPlayerId,
        [{ category: 6, missionIds: [9] }],
        new Date("2024-08-14T12:00:00.000Z"),
    )
    assert.deepEqual(pass.passCardPoints, { 3: 50 })
    assert.equal(
        database.prepare("SELECT point FROM players_pass_cards WHERE player_id = ? AND event_id = 3")
            .get(passPlayerId).point,
        50,
    )

    const rollbackPlayerId = createPlayer("rollback")
    const rollbackVmoney = getPlayerSync(rollbackPlayerId).freeVmoney
    updatePlayerCategoryMissionSync(rollbackPlayerId, 1, 1, 30)
    database.exec(`
        CREATE TRIGGER reject_second_stage
        BEFORE INSERT ON players_category_mission_stages
        WHEN NEW.player_id = ${rollbackPlayerId} AND NEW.id = 2
        BEGIN
            SELECT RAISE(ABORT, 'injected settlement failure');
        END
    `)
    assert.throws(
        () => settleMissionCategories(rollbackPlayerId, [1], evaluationTime),
        /injected settlement failure/,
    )
    assert.equal(getPlayerSync(rollbackPlayerId).freeVmoney, rollbackVmoney)
    assert.deepEqual(getPlayerCategoryMissionsSync(rollbackPlayerId, 1)[1], {
        progress: 30,
        stages: [],
    })

    const overflowPlayerId = createPlayer("overflow")
    updatePlayerSync({ id: overflowPlayerId, freeVmoney: Number.MAX_SAFE_INTEGER })
    updatePlayerCategoryMissionSync(overflowPlayerId, 1, 1, 10)
    assert.throws(
        () => settleMissionCategories(overflowPlayerId, [1], evaluationTime),
        /freeVmoney cannot be updated safely/,
    )
    assert.equal(getPlayerSync(overflowPlayerId).freeVmoney, Number.MAX_SAFE_INTEGER)
    assert.deepEqual(getPlayerCategoryMissionsSync(overflowPlayerId, 1)[1], {
        progress: 10,
        stages: [],
    })

    console.log("mission settlement core tests passed")
} finally {
    cleanup()
    process.removeListener("exit", cleanup)
}
