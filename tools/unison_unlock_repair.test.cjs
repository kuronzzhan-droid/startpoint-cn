require("ts-node/register/transpile-only")

const assert = require("node:assert/strict")
const { randomUUID } = require("node:crypto")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const databaseDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "unison-unlock-repair-db-"))
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
const {
    getUnisonUnlockRepairStatusSync,
    repairUnisonUnlockProgressSync,
} = require("../src/lib/validate/unison-unlock")

initializeDatabase()
db = getDb()

function createPlayer(label) {
    const account = insertAccountSync({
        appId: "wf_cn",
        idpAlias: "",
        idpCode: "test",
        idpId: `unison-unlock-${label}-${randomUUID()}`,
        status: "normal",
    })
    return insertDefaultPlayerSync(account.id).id
}

function putQuest(playerId, questId, { finished, hostFinished, unlocked, clearRank }) {
    db.prepare(`
        INSERT OR REPLACE INTO players_quest_progress (
            section,
            quest_id,
            finished,
            host_finished,
            unlocked,
            clear_rank,
            player_id
        ) VALUES (1, ?, ?, ?, ?, ?, ?)
    `).run(questId, finished, hostFinished, unlocked, clearRank, playerId)
}

function getUnlockQuest(playerId) {
    return db.prepare(`
        SELECT finished, host_finished, unlocked, clear_rank
        FROM players_quest_progress
        WHERE player_id = ? AND section = 1 AND quest_id = 1006001
    `).get(playerId)
}

function hasUnisonTutorial(playerId) {
    return Boolean(db.prepare(`
        SELECT 1
        FROM players_triggered_tutorials
        WHERE player_id = ? AND id = 12
    `).get(playerId))
}

const legacyPlayerId = createPlayer("legacy")
putQuest(legacyPlayerId, 1006001, {
    finished: 1,
    hostFinished: 0,
    unlocked: 0,
    clearRank: 5,
})
assert.equal(getUnisonUnlockRepairStatusSync(legacyPlayerId), "needs_repair")
assert.equal(repairUnisonUnlockProgressSync(legacyPlayerId), 2)
assert.deepEqual(getUnlockQuest(legacyPlayerId), {
    finished: 1,
    host_finished: 1,
    unlocked: 1,
    clear_rank: 5,
})
assert.equal(hasUnisonTutorial(legacyPlayerId), true)
assert.equal(getUnisonUnlockRepairStatusSync(legacyPlayerId), "already_unlocked")
assert.equal(repairUnisonUnlockProgressSync(legacyPlayerId), 0, "repair must be idempotent")

const laterQuestPlayerId = createPlayer("later-quest")
putQuest(laterQuestPlayerId, 1006002, {
    finished: 1,
    hostFinished: 1,
    unlocked: 1,
    clearRank: 5,
})
assert.equal(getUnisonUnlockRepairStatusSync(laterQuestPlayerId), "needs_repair")
assert.equal(repairUnisonUnlockProgressSync(laterQuestPlayerId), 2)
assert.deepEqual(getUnlockQuest(laterQuestPlayerId), {
    finished: 1,
    host_finished: 1,
    unlocked: 1,
    clear_rank: 5,
})
assert.equal(hasUnisonTutorial(laterQuestPlayerId), true)
assert.equal(getUnisonUnlockRepairStatusSync(laterQuestPlayerId), "already_unlocked")

const missingTutorialPlayerId = createPlayer("missing-tutorial")
putQuest(missingTutorialPlayerId, 1006001, {
    finished: 1,
    hostFinished: 1,
    unlocked: 1,
    clearRank: 5,
})
assert.equal(hasUnisonTutorial(missingTutorialPlayerId), false)
assert.equal(
    getUnisonUnlockRepairStatusSync(missingTutorialPlayerId),
    "needs_repair",
    "a complete quest row without tutorial marker 12 must still be repaired",
)
assert.equal(repairUnisonUnlockProgressSync(missingTutorialPlayerId), 1)
assert.equal(hasUnisonTutorial(missingTutorialPlayerId), true)
assert.equal(getUnisonUnlockRepairStatusSync(missingTutorialPlayerId), "already_unlocked")

const earlyPlayerId = createPlayer("early")
putQuest(earlyPlayerId, 1005001, {
    finished: 1,
    hostFinished: 1,
    unlocked: 1,
    clearRank: 5,
})
assert.equal(getUnisonUnlockRepairStatusSync(earlyPlayerId), "not_eligible")
assert.equal(repairUnisonUnlockProgressSync(earlyPlayerId), 0)
assert.equal(getUnlockQuest(earlyPlayerId), undefined, "must not unlock before 1-6-1")
assert.equal(hasUnisonTutorial(earlyPlayerId), false, "must not add tutorial marker before 1-6-1")

console.log("unison unlock legacy-save repair test passed")
