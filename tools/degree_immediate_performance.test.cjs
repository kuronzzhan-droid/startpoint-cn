require("ts-node/register/transpile-only")

const assert = require("node:assert/strict")
const { randomUUID } = require("node:crypto")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { performance } = require("node:perf_hooks")

const databaseDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "degree-immediate-perf-db-"))
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
const { settleMissionCategories } = require("../src/lib/mission/settlement")
const { getDegreeMissionIdsForConditionTypes } = require("../src/lib/mission/computer-degree")

initializeDatabase()
db = getDb()
const account = insertAccountSync({
    appId: "wf_cn",
    idpAlias: "",
    idpCode: "test",
    idpId: `degree-immediate-perf-${randomUUID()}`,
    status: "normal",
})
const playerId = insertDefaultPlayerSync(account.id).id
const evaluationTime = new Date("2025-01-01T12:00:00.000Z")

settleMissionCategories(playerId, [5], evaluationTime)
const iterations = 25
const startedAt = performance.now()
for (let index = 0; index < iterations; index++) {
    settleMissionCategories(playerId, [5], evaluationTime)
}
const averageMs = (performance.now() - startedAt) / iterations

assert.equal(
    averageMs < 100,
    true,
    `title settlement should remain below 100 ms on an empty save; measured ${averageMs.toFixed(3)} ms`,
)
console.log(`degree immediate settlement average: ${averageMs.toFixed(3)} ms`)

const scopedMissionIds = getDegreeMissionIdsForConditionTypes([4])
assert.equal(scopedMissionIds.length > 0, true)
const scopedStartedAt = performance.now()
for (let index = 0; index < iterations; index++) {
    settleMissionCategories(playerId, [{ category: 5, missionIds: scopedMissionIds }], evaluationTime)
}
const scopedAverageMs = (performance.now() - scopedStartedAt) / iterations
assert.equal(
    scopedAverageMs < 20,
    true,
    `event-scoped title settlement should remain below 20 ms; measured ${scopedAverageMs.toFixed(3)} ms`,
)
console.log(`degree scoped settlement average: ${scopedAverageMs.toFixed(3)} ms`)

cleanup()
process.removeListener("exit", cleanup)
