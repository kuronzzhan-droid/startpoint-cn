require("ts-node/register/transpile-only")

const assert = require("node:assert/strict")
const {
    computeActiveMissionFactProgress,
} = require("../src/lib/mission/active-reconciliation/fact-progress")
const {
    matchesActiveMissionQuestRange,
} = require("../src/lib/mission/active-reconciliation/quest-range")

function makeState(overrides = {}) {
    return {
        player: { totalLoginDays: 0, totalStaminaUsed: 0 },
        battleCounters: {
            singleClearCount: 7,
            multiClearCount: 9,
            multiHostClearCount: 4,
            singleRankSsCount: 2,
            rankSsCount: 5,
        },
        finishedQuestIds: new Set(),
        questProgress: [
            { category: 14, questId: 1002, finished: true, multiClearCount: 0 },
            { category: 14, questId: 1003, finished: true, multiClearCount: 0 },
            { category: 2, questId: 1006003, finished: true, multiClearCount: 3 },
            { category: 2, questId: 1006004, finished: true, multiClearCount: 4 },
        ],
        chapterQuestIds: {},
        practiceQuestChallengeCount: 0,
        leaderClearCounts: {},
        conditionalBattleFacts: {},
        loadoutBattleFacts: {},
        characterStoryQuestIds: {},
        characters: {},
        equipment: [],
        manaNodes: {},
        manaBoardNodes: {},
        manaNodeSlots: {},
        partyAbilitySoulCount: 0,
        treasureShopPurchaseCount: 0,
        bossCoinShopPurchaseCount: 0,
        bossCoinEquipmentShopPurchaseCount: 0,
        totalUsedManaCount: 0,
        totalGachaCharacterCount: 0,
        totalEquipmentEquipCount: 0,
        totalUnisonSetCount: 0,
        totalPartyCharacterSetCount: 0,
        totalInjectedExpCount: 0,
        totalGachaCampaignCount: 0,
        ...overrides,
    }
}

function factRow({ battleKind = 3, rangeKind, first, second, third } = {}) {
    const row = []
    row[32] = String(battleKind)
    if (rangeKind !== undefined) row[34] = String(rangeKind)
    if (first !== undefined) row[35] = first
    if (second !== undefined) row[36] = second
    if (third !== undefined) row[37] = third
    return row
}

const state = makeState()
assert.equal(computeActiveMissionFactProgress(14, [], state), 7)
assert.equal(computeActiveMissionFactProgress(16, [], state), 9)
assert.equal(computeActiveMissionFactProgress(17, [], state), 4)
assert.equal(computeActiveMissionFactProgress(23, factRow({
    battleKind: 1,
    rangeKind: 4,
    first: "1",
    third: "2,4,6",
}), state), 1)
assert.equal(computeActiveMissionFactProgress(23, factRow({
    battleKind: 2,
    rangeKind: 2,
    first: "1",
    second: "6",
    third: "3",
}), state), 3)
assert.equal(computeActiveMissionFactProgress(23, factRow({
    battleKind: 3,
    rangeKind: 2,
    first: "1",
    second: "6",
    third: "3,4",
}), state), 7)
assert.equal(computeActiveMissionFactProgress(23, factRow({ battleKind: 3 }), state), 9)
assert.equal(matchesActiveMissionQuestRange(factRow({ rangeKind: 99, first: "01" }), 14, 1002), false)
assert.equal(computeActiveMissionFactProgress(23, factRow({
    battleKind: 1,
    rangeKind: 99,
    first: "01",
}), state), 0)

assert.equal(computeActiveMissionFactProgress(26, factRow({ battleKind: 1 }), state), 2)
assert.equal(computeActiveMissionFactProgress(26, factRow({ battleKind: 2 }), state), 3)
assert.equal(computeActiveMissionFactProgress(26, factRow({ battleKind: 3 }), state), 5)
assert.equal(computeActiveMissionFactProgress(26, factRow({ battleKind: 3, rangeKind: 2 }), state), null)
assert.equal(computeActiveMissionFactProgress(26, factRow({ battleKind: 3, rangeKind: 99, first: "01" }), state), null)
assert.throws(() => matchesActiveMissionQuestRange(factRow({ rangeKind: "099" }), 14, 1002), TypeError)

for (const badCounter of [-1, 1.5, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => computeActiveMissionFactProgress(14, [], makeState({
        battleCounters: { ...state.battleCounters, singleClearCount: badCounter },
    })), error => error instanceof TypeError || error instanceof RangeError)
}
assert.throws(() => computeActiveMissionFactProgress(23, factRow({ battleKind: 4 }), state), TypeError)
assert.throws(() => computeActiveMissionFactProgress(23, factRow({ battleKind: 2 }), makeState({
    questProgress: [{ category: 2, questId: 1006003, finished: true, multiClearCount: -1 }],
})), RangeError)
assert.throws(() => computeActiveMissionFactProgress(23, factRow({ battleKind: 3 }), makeState({
    questProgress: [
        { category: 2, questId: 1006003, finished: false, multiClearCount: Number.MAX_SAFE_INTEGER },
        { category: 2, questId: 1006004, finished: true, multiClearCount: 1 },
    ],
})), RangeError)

const unchanged = makeState()
const before = unchanged.questProgress.map(value => ({ ...value }))
computeActiveMissionFactProgress(23, factRow({ battleKind: 3 }), unchanged)
assert.deepEqual(unchanged.questProgress, before)
assert.equal(computeActiveMissionFactProgress(999, [], state), null)

console.log("active mission battle fact tests passed")
