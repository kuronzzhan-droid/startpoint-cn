require("ts-node/register/transpile-only")

const assert = require("node:assert/strict")
const { randomUUID } = require("node:crypto")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mission-periodic-runtime-"))
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
    const {
        getPlayerCategoryMissionsSync,
        updatePlayerCategoryMissionSync,
    } = require("../src/data/domains/mission")
    const {
        dailyResetPlayerDataSync,
        getPlayerSync,
        insertDefaultPlayerSync,
        updatePlayerSync,
    } = require("../src/data/domains/player")
    const { getComputer } = require("../src/lib/mission/registry")
    const { PassComputer } = require("../src/lib/mission/pass")
    const { RegularComputer } = require("../src/lib/mission/computer-regular")
    const { getSnapshot, takeSnapshot } = require("../src/lib/mission/snapshot")

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

    assert.equal(getComputer(6), PassComputer)
    assert.equal(getComputer(7), PassComputer)
    assert.equal(getComputer(8), PassComputer)
    assert.equal(getComputer(10), RegularComputer)

    const manualContext = {
        category: 6,
        playerId: 1,
        player: { totalDashes: 14, totalStaminaUsed: 40 },
        questProgress: {},
        totalQuestClears: 0,
        totalStories: 0,
        rankCounts: {},
        battleCounters: { singleClearCount: 8, multiClearCount: 6 },
        snapshot: { singleClearCount: 5, multiClearCount: 2, dashCount: 10, staminaUsed: 25 },
    }
    assert.equal(PassComputer.compute(1, manualContext, 0), 3)
    assert.equal(PassComputer.compute(2, manualContext, 0), 4)
    assert.equal(PassComputer.compute(3, manualContext, 0), 4)
    assert.equal(PassComputer.compute(4, manualContext, 0), 15)

    const legacyPlayerId = createPlayer("legacy-pass-week")
    const legacyWeek = PassComputer.buildContext(
        legacyPlayerId,
        7,
        new Date("2024-08-14T12:00:00.000Z"),
    )
    assert.notEqual(legacyWeek.snapshot, null)
    assert.deepEqual(
        getSnapshot(legacyPlayerId, "pass-week:3"),
        legacyWeek.snapshot,
        "an existing player without an event snapshot must start from the current baseline",
    )
    updatePlayerSync({ id: legacyPlayerId, totalLoginDays: 3 })
    const legacyLogin = PassComputer.buildContext(
        legacyPlayerId,
        8,
        new Date("2024-08-14T12:00:00.000Z"),
    )
    assert.equal(Object.keys(legacyLogin.passEventLoginProgress).length > 0, true)
    assert.equal(Object.values(legacyLogin.passEventLoginProgress).every(value => value === 1), true)
    assert.throws(() => PassComputer.buildContext(legacyPlayerId, 8), /evaluationTime/)

    const snapshotPlayerId = createPlayer("snapshot")
    const snapshot = {
        questClears: 1,
        staminaUsed: 2,
        rankSs: 3,
        rankS: 4,
        rankA: 5,
        rankB: 6,
        singlePlayCount: 7,
        singleClearCount: 8,
        multiPlayCount: 9,
        multiClearCount: 10,
        multiHostClearCount: 11,
        multiGuestClearCount: 12,
        dashCount: 13,
        powerFlipCount: 14,
        loginDays: 15,
    }
    takeSnapshot(snapshotPlayerId, "pass-week:3", snapshot)
    assert.deepEqual(getSnapshot(snapshotPlayerId, "pass-week:3"), snapshot)
    assert.throws(() => takeSnapshot(snapshotPlayerId, "pass-week:03", snapshot), /periodType/)

    const resetPlayerId = createPlayer("reset")
    updatePlayerSync({
        id: resetPlayerId,
        lastLoginTime: new Date("2024-08-13T12:00:00.000Z"),
        totalLoginDays: 2,
        totalDashes: 10,
        totalStaminaUsed: 40,
    })
    for (const category of [2, 6, 7, 10]) {
        updatePlayerCategoryMissionSync(resetPlayerId, category, 1, 1)
    }
    assert.equal(
        dailyResetPlayerDataSync(
            getPlayerSync(resetPlayerId),
            new Date("2024-08-14T12:00:00.000Z"),
        ),
        true,
    )
    assert.deepEqual(getPlayerCategoryMissionsSync(resetPlayerId, 2), {})
    assert.deepEqual(getPlayerCategoryMissionsSync(resetPlayerId, 6), {})
    assert.notDeepEqual(getPlayerCategoryMissionsSync(resetPlayerId, 7), {})
    assert.notDeepEqual(getPlayerCategoryMissionsSync(resetPlayerId, 10), {})
    assert.equal(getSnapshot(resetPlayerId, "daily").dashCount, 10)

    updatePlayerCategoryMissionSync(resetPlayerId, 2, 1, 1)
    updatePlayerCategoryMissionSync(resetPlayerId, 6, 1, 1)
    assert.equal(
        dailyResetPlayerDataSync(
            getPlayerSync(resetPlayerId),
            new Date("2024-08-19T12:00:00.000Z"),
        ),
        true,
    )
    for (const category of [2, 6, 7, 10]) {
        assert.deepEqual(getPlayerCategoryMissionsSync(resetPlayerId, category), {})
    }

    const rollbackPlayerId = createPlayer("rollback")
    const rollbackLogin = new Date("2024-08-14T12:00:00.000Z")
    updatePlayerSync({
        id: rollbackPlayerId,
        lastLoginTime: new Date("2024-08-13T12:00:00.000Z"),
        totalLoginDays: 2,
    })
    updatePlayerCategoryMissionSync(rollbackPlayerId, 2, 1, 1)
    updatePlayerCategoryMissionSync(rollbackPlayerId, 6, 1, 1)
    const before = getPlayerSync(rollbackPlayerId)
    database.exec(`
        CREATE TRIGGER reject_periodic_reset
        BEFORE DELETE ON players_category_missions
        WHEN OLD.player_id = ${rollbackPlayerId} AND OLD.category = 6
        BEGIN
            SELECT RAISE(ABORT, 'injected periodic reset failure');
        END
    `)
    assert.throws(
        () => dailyResetPlayerDataSync(getPlayerSync(rollbackPlayerId), rollbackLogin),
        /injected periodic reset failure/,
    )
    const after = getPlayerSync(rollbackPlayerId)
    assert.equal(after.lastLoginTime.toISOString(), before.lastLoginTime.toISOString())
    assert.equal(after.totalLoginDays, before.totalLoginDays)
    assert.notDeepEqual(getPlayerCategoryMissionsSync(rollbackPlayerId, 2), {})
    assert.notDeepEqual(getPlayerCategoryMissionsSync(rollbackPlayerId, 6), {})

    console.log("mission periodic runtime tests passed")
} finally {
    cleanup()
    process.removeListener("exit", cleanup)
}
