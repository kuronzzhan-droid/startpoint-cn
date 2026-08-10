require("ts-node/register/transpile-only")

const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")

const activeMasterPath = path.resolve(__dirname, "../src/lib/mission/active-master-data.ts")
assert.equal(fs.existsSync(activeMasterPath), true, "Active Mission 运行时主数据读取器必须存在")

const {
    getActiveMissionEventMasterDefinition,
    getActiveMissionEventMasterDefinitions,
    getActiveMissionMasterDefinition,
    getActiveMissionMasterDefinitions,
} = require(activeMasterPath)

assert.equal(getActiveMissionMasterDefinitions().length, 96)
assert.deepEqual(
    getActiveMissionEventMasterDefinitions().map(definition => definition.eventId).sort((a, b) => a - b),
    [1, 2, 3, 150],
)

const missionRows = {
    "0": [["invalid-zero"]],
    "01": [["invalid-leading-zero"]],
    "42": [["valid"]],
    "43": ["not-a-row-array"],
    "9007199254740992": [["unsafe-integer"]],
}
const eventRows = {
    "7": [["valid-event"]],
    "08": [["invalid-leading-zero"]],
}
const repository = {
    info: () => ({
        source: "release",
        assetVersion: "test",
        generatorVersion: 1,
        releaseDigest: "active-content-test",
    }),
    table: tableName => ({
        "mission_active.json": missionRows,
        "mission_active_event.json": eventRows,
    })[tableName],
}

assert.deepEqual(
    getActiveMissionMasterDefinitions(repository).map(definition => definition.missionId),
    [42],
    "显式 repository 应覆盖 bundled 表并过滤非 canonical/非法 ID 与坏行",
)
assert.deepEqual(
    getActiveMissionEventMasterDefinitions(repository).map(definition => definition.eventId),
    [7],
)
assert.equal(getActiveMissionMasterDefinition(42, repository).row[0], "valid")
assert.equal(getActiveMissionEventMasterDefinition(7, repository).row[0], "valid-event")

missionRows[42] = [["mutated-after-first-read"]]
missionRows[44] = [["added-after-first-read"]]
assert.equal(
    getActiveMissionMasterDefinition(42, repository).row[0],
    "valid",
    "同一 repository 身份必须缓存首次读取的 snapshot",
)
assert.equal(getActiveMissionMasterDefinition(44, repository), undefined)

const freshRepository = { ...repository }
assert.equal(
    getActiveMissionMasterDefinition(42, freshRepository).row[0],
    "mutated-after-first-read",
    "新 repository 身份应形成新 snapshot",
)
assert.equal(getActiveMissionMasterDefinition(44, freshRepository).row[0], "added-after-first-read")

console.log("mission active content tests passed")
