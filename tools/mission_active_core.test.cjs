require("ts-node/register/transpile-only")

const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")

const corePath = path.resolve(__dirname, "../src/lib/mission/active-core.ts")
assert.equal(fs.existsSync(corePath), true, "Active Mission 纯逻辑核心模块必须存在")

const {
    getActiveMissionEventReleasePhase,
    getActiveMissionRewardStageIds,
    isActiveMissionAvailable,
    isActiveMissionClaimable,
    parseActiveMissionDefinition,
    parseActiveMissionEventDefinition,
    parseCnMasterDateTime,
    settleActiveMissionProgress,
} = require(corePath)
const { getMissionRewardStageDefinition, getActiveMissionRewards } = require("../src/lib/mission/rewards")
const { validateMissionRewardClaims } = require("../src/lib/mission/claims")
const { filterToActiveMissions } = require("../src/lib/mission/filter")

function missionRow({ eventId, phase, stringId, need, show, start, end, showStart, showEnd }) {
    const row = []
    row[0] = String(eventId)
    row[1] = phase === undefined ? "(None)" : String(phase)
    row[3] = stringId
    row[56] = need ? String(need.missionId) : "(None)"
    row[57] = need ? String(need.stage) : ""
    row[58] = show ? String(show.missionId) : "(None)"
    row[59] = show ? String(show.stage) : ""
    row[60] = start ?? "(None)"
    row[61] = end ?? "(None)"
    row[62] = showStart ?? "(None)"
    row[63] = showEnd ?? "(None)"
    return row
}

function eventRow({ kind = 0, maxPhase, start, end, needQuestId }) {
    const row = []
    row[2] = String(kind)
    row[3] = maxPhase === undefined ? "(None)" : String(maxPhase)
    row[14] = start
    row[15] = end ?? "(None)"
    row[22] = needQuestId === undefined ? "(None)" : String(needQuestId)
    return row
}

function stageRow(targetProgress, targetClearSeconds) {
    const row = []
    row[3] = String(targetProgress)
    row[4] = targetClearSeconds === undefined ? "(None)" : String(targetClearSeconds)
    row[7] = "1"
    row[8] = "7"
    row[9] = "101"
    return row
}

function createRepository(tables, digest = "active-core-test") {
    return {
        info: () => ({
            source: "release",
            assetVersion: "test",
            generatorVersion: 1,
            releaseDigest: digest,
        }),
        table: tableName => tables[tableName],
    }
}

const releaseTables = {
    "mission_active.json": {
        9001: [missionRow({
            eventId: 90,
            phase: 1,
            stringId: "phase_one",
            start: "2024-08-14 20:00:00",
            end: "2024-08-14 21:00:00",
            showStart: "2024-08-14 20:00:00",
            showEnd: "2024-08-14 22:00:00",
        })],
        9003: [missionRow({
            eventId: 90,
            phase: 3,
            stringId: "phase_three",
            need: { missionId: 9001, stage: 1 },
            show: { missionId: 9001, stage: 1 },
        })],
        9101: [missionRow({ eventId: 91, phase: 1, stringId: "timed_clear" })],
        9201: [missionRow({ eventId: 92, phase: 1, stringId: "dependency" })],
        9202: [missionRow({ eventId: 92, phase: 1, stringId: "visibility" })],
        9203: [missionRow({
            eventId: 92,
            phase: 1,
            stringId: "dependent",
            need: { missionId: 9201, stage: 2 },
            show: { missionId: 9202, stage: 1 },
        })],
        9301: [missionRow({ eventId: 93, phase: 1, stringId: "quest_locked" })],
    },
    "mission_active_event.json": {
        90: [eventRow({
            maxPhase: 3,
            start: "2024-08-14 20:00:00",
            end: "2024-08-14 22:00:00",
        })],
        91: [eventRow({ maxPhase: 1, start: "2024-08-14 20:00:00" })],
        92: [eventRow({ maxPhase: 1, start: "2024-08-14 20:00:00" })],
        93: [eventRow({
            maxPhase: 1,
            start: "2024-08-14 20:00:00",
            needQuestId: 10008004,
        })],
    },
    "mission_active_reward.json": {
        9001: { 1: [stageRow(10)] },
        9003: { 1: [stageRow(1)] },
        9101: { 1: [stageRow(1, 30)] },
        9201: { 1: [stageRow(10)], 2: [stageRow(20)] },
        9202: { 1: [stageRow(5)] },
        9203: { 1: [stageRow(1)] },
        9301: { 1: [stageRow(1)] },
    },
}
const repository = createRepository(releaseTables)

assert.equal(parseCnMasterDateTime("2024-08-14 21:00:00"), Date.parse("2024-08-14T13:00:00.000Z"))
assert.throws(() => parseCnMasterDateTime("2024-02-30 00:00:00"), /CN master/i)

const parsedMission = parseActiveMissionDefinition(9001, releaseTables["mission_active.json"][9001][0])
assert.equal(parsedMission.eventId, 90)
assert.equal(parsedMission.phase, 1)
assert.equal(parsedMission.stringId, "phase_one")
const parsedEvent = parseActiveMissionEventDefinition(90, releaseTables["mission_active_event.json"][90][0])
assert.equal(parsedEvent.kind, 0)
assert.equal(parsedEvent.maxPhase, 3)

for (const invalidPhase of ["0", "-1", "1.5", "01", "1e0"]) {
    const invalidPhaseTables = structuredClone(releaseTables)
    invalidPhaseTables["mission_active.json"][9001][0][1] = invalidPhase
    const invalidPhaseRepository = createRepository(invalidPhaseTables, `invalid-phase-${invalidPhase}`)
    assert.throws(
        () => parseActiveMissionDefinition(9001, invalidPhaseTables["mission_active.json"][9001][0]),
        /phase/i,
    )
    assert.equal(isActiveMissionAvailable(9001, {
        repository: invalidPhaseRepository,
        now: Date.parse("2024-08-14T12:00:00.000Z"),
        activeMissions: {},
        questProgress: {},
    }), false, `phase ${invalidPhase} 不得绕过 availability`)
}
for (const invalidMaxPhase of ["0", "-1", "1.5", "01", "1e0"]) {
    const invalidEventTables = structuredClone(releaseTables)
    invalidEventTables["mission_active_event.json"][90][0][3] = invalidMaxPhase
    const invalidEventRepository = createRepository(invalidEventTables, `invalid-max-phase-${invalidMaxPhase}`)
    assert.throws(
        () => parseActiveMissionEventDefinition(90, invalidEventTables["mission_active_event.json"][90][0]),
        /max phase/i,
    )
    assert.equal(isActiveMissionAvailable(9001, {
        repository: invalidEventRepository,
        now: Date.parse("2024-08-14T12:00:00.000Z"),
        activeMissions: {},
        questProgress: {},
    }), false)
}

const start = Date.parse("2024-08-14T12:00:00.000Z")
const end = Date.parse("2024-08-14T13:00:00.000Z")
const emptyContext = { repository, activeMissions: {}, questProgress: {} }
assert.equal(isActiveMissionAvailable(9001, { ...emptyContext, now: start - 1 }), false)
assert.equal(isActiveMissionAvailable(9001, { ...emptyContext, now: start }), true, "start 边界必须包含")
assert.equal(isActiveMissionAvailable(9001, { ...emptyContext, now: end }), true, "end 边界必须包含")
assert.equal(isActiveMissionAvailable(9001, { ...emptyContext, now: end + 1 }), false)
assert.equal(isActiveMissionAvailable(9001, { ...emptyContext, now: Number.NaN }), false)

assert.equal(isActiveMissionAvailable(9203, {
    ...emptyContext,
    now: start,
    activeMissions: {
        9201: { progress: 10, stages: { 2: true } },
        9202: { progress: 5, stages: { 1: true } },
    },
}), false, "need 阶段即使标记已领取，也必须满足对应进度阈值")
assert.equal(isActiveMissionAvailable(9203, {
    ...emptyContext,
    now: start,
    activeMissions: {
        9201: { progress: 20, stages: { 1: true, 2: true } },
        9202: { progress: 5, stages: { 1: true } },
    },
}), true, "need/show 阶段已完成且领取后必须允许")
assert.equal(isActiveMissionAvailable(9301, { ...emptyContext, now: start }), false)
assert.equal(isActiveMissionAvailable(9301, {
    ...emptyContext,
    now: start,
    questProgress: { 4: [{ questId: 8004, finished: true }] },
}), true, "分类 4 的短 quest ID 必须按现有规则规范化")

const completePhaseOne = { 9001: { progress: 10, stages: { 1: false } } }
assert.equal(
    getActiveMissionEventReleasePhase(90, completePhaseOne, repository),
    2,
    "缺失 phase 2 时不得因 every([]) 自动释放 phase 3",
)

const settled = settleActiveMissionProgress(9001, { progress: 0, stages: {} }, 10, { repository })
assert.deepEqual(settled.state, { progress: 10, stages: { 1: false } })
assert.equal(settleActiveMissionProgress(9001, settled.state, 5, { repository }).delta, null)
assert.equal(
    settleActiveMissionProgress(9001, { progress: 10, stages: { 1: true } }, 10, { repository }).state.stages[1],
    true,
    "已领取阶段不得回退",
)
assert.deepEqual(
    settleActiveMissionProgress(9101, { progress: 0, stages: {} }, 1, { repository }).state.stages,
    {},
)
assert.deepEqual(
    settleActiveMissionProgress(9101, { progress: 0, stages: {} }, 1, { repository, clearSeconds: 31 }).state.stages,
    {},
)
assert.equal(
    settleActiveMissionProgress(9101, { progress: 0, stages: {} }, 1, { repository, clearSeconds: 30 }).state.stages[1],
    false,
)
assert.deepEqual(
    settleActiveMissionProgress(9101, { progress: 0, stages: {} }, 1, { repository, clearSeconds: -1 }).state.stages,
    {},
    "负 clearSeconds 必须 fail closed，不得完成/发奖",
)
for (const progress of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1]) {
    assert.throws(
        () => settleActiveMissionProgress(9001, { progress, stages: {} }, 10, { repository }),
        /current progress/i,
        `污染 current progress ${String(progress)} 必须 fail closed`,
    )
}

assert.deepEqual(getActiveMissionRewardStageIds(9201, repository), [1, 2])
for (const invalidStageTable of [
    { "1": [stageRow(1)], "01": [stageRow(1)] },
    { "1": [stageRow(1)], "1e0": [stageRow(1)] },
    { "1": [stageRow(1)], "3": [stageRow(3)] },
]) {
    const invalidStageTables = structuredClone(releaseTables)
    invalidStageTables["mission_active_reward.json"][9001] = invalidStageTable
    const invalidStageRepository = createRepository(invalidStageTables, "invalid-stage-schema")
    assert.throws(
        () => getActiveMissionRewardStageIds(9001, invalidStageRepository),
        /reward stage/i,
    )
    assert.equal(
        getMissionRewardStageDefinition(9001, 1, invalidStageRepository),
        null,
        "别名/不连续 stage 表不得产生 reward definition",
    )
}
for (const invalidThresholdRow of [
    stageRow(-1),
    stageRow(1.5),
    stageRow(Number.MAX_SAFE_INTEGER + 1),
    stageRow(1, -1),
    stageRow(1, 1.5),
]) {
    const invalidThresholdTables = structuredClone(releaseTables)
    invalidThresholdTables["mission_active_reward.json"][9001] = { 1: [invalidThresholdRow] }
    const invalidThresholdRepository = createRepository(invalidThresholdTables, "invalid-threshold")
    assert.equal(
        getMissionRewardStageDefinition(9001, 1, invalidThresholdRepository),
        null,
        "显式 repository 的进度/限时阈值必须是非负 safe integer",
    )
    assert.deepEqual(
        settleActiveMissionProgress(9001, { progress: 0, stages: {} }, 0, {
            repository: invalidThresholdRepository,
        }),
        { state: { progress: 0, stages: {} }, delta: null },
    )
}
for (const progress of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1]) {
    assert.throws(
        () => settleActiveMissionProgress(9001, { progress: 0, stages: {} }, progress, { repository }),
        /absolute progress/i,
    )
}

assert.deepEqual(getActiveMissionRewards(11110, 1), [{ kind: 0, amount: 300 }])
assert.deepEqual(getMissionRewardStageDefinition(11110, 1), {
    source: "active",
    targetProgress: 10,
    targetClearSeconds: undefined,
    rewards: [{ kind: 0, amount: 300 }],
})
assert.deepEqual(getMissionRewardStageDefinition(11, 1), {
    source: "awake",
    targetProgress: 3,
    targetClearSeconds: undefined,
    rewards: [{ kind: 1, amount: 10, itemId: 1 }],
})
assert.equal(
    getMissionRewardStageDefinition(11, 1, repository),
    null,
    "显式 repository 不得 fallback 到 bundled awake 表",
)
assert.equal(getMissionRewardStageDefinition(9001, 1, repository).source, "active")

assert.deepEqual(
    filterToActiveMissions({ 9001: { progress: 1 }, 11110: { progress: 1 } }, repository),
    { 9001: { progress: 1 } },
    "显式 repository 的 filter 必须使用该 snapshot 的 master ID 集",
)
const bundledRewardIds = new Set(Object.keys(require("../assets/mission_active_reward.json")).map(Number))
const bundledFilterInput = Object.fromEntries([...bundledRewardIds].map(id => [String(id), id]))
bundledFilterInput[99999999] = 99999999
assert.deepEqual(
    Object.keys(filterToActiveMissions(bundledFilterInput)).map(Number).sort((a, b) => a - b),
    [...bundledRewardIds].sort((a, b) => a - b),
    "无 repository 时必须继续使用 bundled reward ID set",
)

assert.deepEqual(
    validateMissionRewardClaims(
        { "99999999": { progress: 0, stages: [] } },
        [{ mission_id: 99999999, stages: [1] }],
    ),
    { ok: false, message: "Unknown mission reward stage." },
)
assert.deepEqual(
    validateMissionRewardClaims({}, [{ mission_id: 99999999, stages: [1] }]),
    { ok: false, message: "Mission is not active." },
)
assert.equal(
    validateMissionRewardClaims(
        { 9001: { progress: 10, stages: { 1: false } } },
        [{ mission_id: 9001, stages: [1] }],
        { repository, now: end, questProgress: {} },
    ).ok,
    true,
    "显式 context 应使用 repository 的 master/availability/reward",
)
for (const invalidProgress of [
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    -1,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
]) {
    assert.deepEqual(
        validateMissionRewardClaims(
            { 9001: { progress: invalidProgress, stages: { 1: false } } },
            [{ mission_id: 9001, stages: [1] }],
            { repository, now: end, questProgress: {} },
        ),
        { ok: false, message: "Active mission is not available." },
        `显式 context 必须拒绝污染 progress ${String(invalidProgress)}`,
    )
}
assert.deepEqual(
    validateMissionRewardClaims(
        { 9001: { progress: 10, stages: { 1: false } } },
        [{ mission_id: 9001, stages: [1] }],
        { now: end, questProgress: {} },
    ),
    { ok: false, message: "Active mission is not available." },
    "缺 repository 的显式 context 必须 fail closed",
)
assert.deepEqual(
    validateMissionRewardClaims(
        { 9001: { progress: 10, stages: { 1: false } } },
        [{ mission_id: 9001, stages: [1] }],
        { repository, now: end },
    ),
    { ok: false, message: "Active mission is not available." },
    "缺 questProgress 的显式 context 必须 fail closed",
)
assert.deepEqual(
    validateMissionRewardClaims(
        { 9999: { progress: 10, stages: { 1: false } } },
        [{ mission_id: 9999, stages: [1] }],
        { repository, now: end, questProgress: {} },
    ),
    { ok: false, message: "Unknown active mission." },
)

assert.equal(isActiveMissionClaimable(9001, { ...emptyContext, now: end + 60 * 60 * 1000 }), true)
assert.equal(isActiveMissionClaimable(9001, { ...emptyContext, now: end + 60 * 60 * 1000 + 1 }), false)

const bundledRepository = {
    info: repository.info,
    table: tableName => ({
        "mission_active.json": require("../assets/mission_active.json"),
        "mission_active_event.json": require("../assets/mission_active_event.json"),
        "mission_active_reward.json": require("../assets/mission_active_reward.json"),
    })[tableName],
}
const serverNow = Date.parse("2024-08-14T12:00:00.000Z")
const bundledContext = {
    repository: bundledRepository,
    now: serverNow,
    activeMissions: {},
    questProgress: {},
}
assert.equal(isActiveMissionAvailable(21010, bundledContext), false, "event 3 在当前服务器时间必须过期")
assert.equal(isActiveMissionAvailable(20001, bundledContext), false, "event 2 前置关卡未通关必须拒绝")
assert.equal(isActiveMissionAvailable(20001, {
    ...bundledContext,
    questProgress: { 1: [{ questId: 1008004, finished: true }] },
}), true)

const contentsGuideClaimState = { 20001: { progress: 1, stages: { 1: false } } }
assert.deepEqual(
    validateMissionRewardClaims(
        contentsGuideClaimState,
        [{ mission_id: 20001, stages: [1] }],
        { repository: bundledRepository, now: serverNow, questProgress: {} },
    ),
    { ok: false, message: "Active mission is not available." },
    "前置关卡未完成时显式 context 领奖必须拒绝",
)
assert.equal(
    validateMissionRewardClaims(
        contentsGuideClaimState,
        [{ mission_id: 20001, stages: [1] }],
        {
            repository: bundledRepository,
            now: serverNow,
            questProgress: { 1: [{ questId: 1008004, finished: true }] },
        },
    ).ok,
    true,
)
assert.deepEqual(
    validateMissionRewardClaims(
        { 21010: { progress: 1, stages: { 1: false } } },
        [{ mission_id: 21010, stages: [1] }],
        { repository: bundledRepository, now: serverNow, questProgress: {} },
    ),
    { ok: false, message: "Active mission is not available." },
    "event 过期时显式 context 领奖必须拒绝",
)

const realIncentiveClaimTime = Date.parse("2022-12-20T00:00:00.000Z")
assert.equal(isActiveMissionAvailable(21010, {
    ...bundledContext,
    now: realIncentiveClaimTime,
}), false, "完成期限结束后不得继续推进")
assert.equal(isActiveMissionClaimable(21010, {
    ...bundledContext,
    now: realIncentiveClaimTime,
}), true, "展示/领奖期内必须允许领取")
assert.equal(isActiveMissionClaimable(21010, {
    ...bundledContext,
    now: Date.parse("2023-01-06T00:00:00.000Z"),
}), false)
assert.deepEqual(
    validateMissionRewardClaims(
        { 21010: { progress: 1, stages: { 1: false } } },
        [{ mission_id: 21010, stages: [1] }],
        {
            repository: bundledRepository,
            now: Date.parse("2023-01-06T00:00:00.000Z"),
            questProgress: {},
        },
    ),
    { ok: false, message: "Active mission is not available." },
    "show/领奖期结束后必须拒绝",
)
for (const eventId of [1, 150]) {
    const definition = require("../src/lib/mission/active-master-data")
        .getActiveMissionEventMasterDefinition(eventId, bundledRepository)
    assert.equal(parseActiveMissionEventDefinition(eventId, definition.row).endTime, undefined)
}

console.log("mission active core tests passed")
