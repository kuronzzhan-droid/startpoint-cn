require("ts-node/register/transpile-only")

const assert = require("node:assert/strict")
const { randomUUID } = require("node:crypto")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const databaseDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "mission-degree-stats-db-"))
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
const { insertPlayerEquipmentSync } = require("../src/data/domains/equipment")
const { insertDefaultPlayerSync } = require("../src/data/domains/player")
const { recordBattleMissionDimensions } = require("../src/lib/mission/battle-dimensions")
const { DegreeComputer } = require("../src/lib/mission/computer-degree")
const { summarizeBattleStatistics } = require("../src/lib/mission/events")

initializeDatabase()
db = getDb()
const account = insertAccountSync({
    appId: "wf_cn",
    idpAlias: "",
    idpCode: "test",
    idpId: `mission-degree-stats-${randomUUID()}`,
    status: "normal",
})
const playerId = insertDefaultPlayerSync(account.id).id

const singleStatistics = summarizeBattleStatistics({
    max_combo_count: 101,
    max_skill_chain_count: 5,
    zones: [{
        use_dash_count: 1000,
        use_power_flip_count: 10,
        use_power_flip_lv3_count: 500,
        use_skill_count: 100,
        fever_count: 50,
        fever_ms: 180000,
        use_debuff_to_enemy_count: 50,
        clear_buff_of_enemy_count: 50,
        clear_debuff_of_self_count: 50,
        enemy_kill_count: 500,
        weak_point_attack_count: 100,
        coffin_count_reduced_count: 25,
    }],
})
recordBattleMissionDimensions({
    type: "battle_finish",
    playerId,
    questCategory: 1,
    questId: 100001,
    accomplished: true,
    mode: "single",
    clearRank: 5,
    clearTimeMs: 1000,
    partyCharacterIds: [],
    unisonCharacterIds: [],
    statistics: singleStatistics,
})

const multiStatistics = summarizeBattleStatistics({
    max_skill_chain_count: 7,
    zones: [{
        use_buff_to_all_party_members: 50,
        use_heal_to_all_party_members: 50,
        use_emotion_count: 1,
    }],
})
recordBattleMissionDimensions({
    type: "battle_finish",
    playerId,
    questCategory: 2,
    questId: 200001,
    accomplished: true,
    mode: "multi",
    role: "host",
    isRescue: true,
    isNewbieRescue: true,
    isMvp: true,
    clearRank: 5,
    clearTimeMs: 1000,
    partyCharacterIds: [],
    unisonCharacterIds: [],
    statistics: multiStatistics,
})

insertPlayerEquipmentSync(playerId, 5010001, {
    stack: 1,
    level: 5,
    enhancementLevel: 0,
    protection: false,
})
insertPlayerEquipmentSync(playerId, 5010002, {
    stack: 1,
    level: 3,
    enhancementLevel: 0,
    protection: false,
})

const context = DegreeComputer.buildContext(playerId, 5)
const expectedProgress = new Map([
    [16000, 50],
    [17000, 180],
    [18000, 50],
    [19000, 50],
    [20000, 50],
    [21000, 50],
    [22000, 50],
    [24000, 1],
    [25000, 1],
    [26000, 1],
    [27000, 7],
    [28000, 1],
    [29000, 500],
    [33000, 100],
    [36000, 100],
    [37000, 1000],
    [38000, 500],
    [40000, 25],
    [42000, 6],
    [43000, 1],
    [70004, 1],
])
for (const [missionId, expected] of expectedProgress) {
    assert.equal(
        DegreeComputer.compute(missionId, context, 0),
        expected,
        `degree mission ${missionId} should use the recorded server-side statistic`,
    )
}

console.log("mission degree battle statistic tests passed")
cleanup()
process.removeListener("exit", cleanup)
