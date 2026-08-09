require("ts-node/register/transpile-only")

const assert = require("node:assert/strict")
const { randomUUID } = require("node:crypto")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const databaseDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "expert-single-ss-reward-"))
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
    getPlayerSingleQuestProgressSync,
    insertPlayerQuestProgressSync,
    updatePlayerQuestProgressSync,
} = require("../src/data/domains/quest")
const { getQuestFromCategorySync } = require("../src/lib/assets")
const { QuestCategory } = require("../src/lib/types")

initializeDatabase()
db = getDb()

const columns = db.prepare(`PRAGMA table_info("players_quest_progress")`).all()
assert.equal(
    columns.some(column => column.name === "s_plus_reward_received" && column.dflt_value === "0"),
    true,
    "SS reward receipt column must exist with a false default",
)

const account = insertAccountSync({
    appId: "wf_cn",
    idpAlias: "",
    idpCode: "test",
    idpId: `expert-single-ss-reward-${randomUUID()}`,
    status: "normal",
})
const playerId = insertDefaultPlayerSync(account.id).id

insertPlayerQuestProgressSync(playerId, QuestCategory.EXPERT_SINGLE_EVENT, {
    questId: 2001,
    finished: true,
    clearRank: 5,
})
assert.equal(
    getPlayerSingleQuestProgressSync(playerId, QuestCategory.EXPERT_SINGLE_EVENT, 2001).sPlusRewardReceived,
    false,
    "Existing SS records must remain eligible for the corrected reward once",
)

updatePlayerQuestProgressSync(playerId, QuestCategory.EXPERT_SINGLE_EVENT, {
    questId: 2001,
    sPlusRewardReceived: true,
})
assert.equal(
    getPlayerSingleQuestProgressSync(playerId, QuestCategory.EXPERT_SINGLE_EVENT, 2001).sPlusRewardReceived,
    true,
    "Receipt marker must persist after the corrected reward is granted",
)

const quests = require("../assets/expert_single_event_quest.json")
for (const questId of Object.keys(quests)) {
    const resolved = getQuestFromCategorySync(QuestCategory.EXPERT_SINGLE_EVENT, Number(questId))
    assert.deepEqual(
        resolved.sPlusReward,
        { type: 0, id: 14040, count: 3 },
        `Quest ${questId} must grant three Starry Memory Crystals for SS`,
    )
}

console.log("expert single event SS reward tests passed")
cleanup()
process.removeListener("exit", cleanup)
