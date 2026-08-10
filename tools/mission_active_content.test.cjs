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

const bundledMissions = require("../assets/mission_active.json")
const bundledEvents = require("../assets/mission_active_event.json")
const bundledRewards = require("../assets/mission_active_reward.json")
const bundledMissionIds = Object.keys(bundledMissions).sort((left, right) => Number(left) - Number(right))
assert.deepEqual(
    Object.keys(bundledRewards).sort((left, right) => Number(left) - Number(right)),
    bundledMissionIds,
    "bundled Active Mission master/reward ID 集必须一致",
)
for (const missionId of bundledMissionIds) {
    const eventId = String(Number(bundledMissions[missionId][0][0]))
    assert.ok(Object.hasOwn(bundledEvents, eventId), `mission ${missionId} 必须引用存在的 event`)

    const rawStageIds = Object.keys(bundledRewards[missionId])
    const stageIds = rawStageIds.map(rawStageId => {
        const stageId = Number(rawStageId)
        assert.ok(
            Number.isSafeInteger(stageId) && stageId > 0 && String(stageId) === rawStageId,
            `mission ${missionId} stage ${rawStageId} 必须是 canonical positive safe integer`,
        )
        return stageId
    }).sort((left, right) => left - right)
    assert.deepEqual(
        stageIds,
        Array.from({ length: stageIds.length }, (_, index) => index + 1),
        `mission ${missionId} reward stage 必须从 1 连续`,
    )
}

const missionRows = {
    "0": [["invalid-zero"]],
    "01": [["invalid-leading-zero"]],
    "42": [["valid", { nested: ["original"] }]],
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

const repositoryDefinitions = getActiveMissionMasterDefinitions(repository)
assert.deepEqual(
    repositoryDefinitions.map(definition => definition.missionId),
    [42],
    "显式 repository 应覆盖 bundled 表并过滤非 canonical/非法 ID 与坏行",
)
const repositoryEventDefinitions = getActiveMissionEventMasterDefinitions(repository)
assert.deepEqual(
    repositoryEventDefinitions.map(definition => definition.eventId),
    [7],
)
const repositoryDefinition = getActiveMissionMasterDefinition(42, repository)
const repositoryEventDefinition = getActiveMissionEventMasterDefinition(7, repository)
assert.equal(repositoryDefinition, repositoryDefinitions[0], "list 与 Map 必须共享同一 definition snapshot")
assert.equal(repositoryEventDefinition, repositoryEventDefinitions[0])
assert.equal(repositoryDefinition.row[0], "valid")
assert.equal(repositoryEventDefinition.row[0], "valid-event")
assert.equal(Object.isFrozen(repositoryDefinitions), true)
assert.equal(Object.isFrozen(repositoryDefinition), true)
assert.equal(Object.isFrozen(repositoryDefinition.row), true)
assert.equal(Object.isFrozen(repositoryDefinition.row[1]), true)
assert.equal(Object.isFrozen(repositoryDefinition.row[1].nested), true)
assert.equal(Object.isFrozen(repositoryEventDefinitions), true)
assert.equal(Object.isFrozen(repositoryEventDefinition), true)
assert.equal(Object.isFrozen(repositoryEventDefinition.row), true)

missionRows[42][0][0] = "poisoned-through-source"
missionRows[42][0][1].nested[0] = "nested-poison-through-source"
assert.equal(repositoryDefinition.row[0], "valid", "源表原地修改不得污染缓存 snapshot")
assert.equal(repositoryDefinition.row[1].nested[0], "original")
assert.equal(Reflect.set(repositoryDefinition.row, 0, "poisoned-through-caller"), false)
assert.equal(Reflect.set(repositoryDefinition.row[1].nested, 0, "nested-poison-through-caller"), false)
assert.throws(() => repositoryDefinitions.pop(), TypeError)
assert.equal(Reflect.set(repositoryEventDefinition.row, 0, "event-poison-through-caller"), false)
assert.throws(() => repositoryEventDefinitions.pop(), TypeError)
assert.equal(getActiveMissionMasterDefinitions(repository).length, 1)
assert.equal(getActiveMissionMasterDefinition(42, repository), repositoryDefinition)
assert.equal(getActiveMissionMasterDefinition(42, repository).row[0], "valid")

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
