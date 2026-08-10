require("ts-node/register/transpile-only")

const assert = require("node:assert/strict")
const {
    matchesActiveMissionQuestRange,
    resolveActiveMissionQuestIds,
} = require("../src/lib/mission/active-reconciliation/quest-range")

function rangeRow(kind, first = "(None)", second = "(None)", third = "(None)") {
    const row = []
    row[34] = kind
    row[35] = first
    row[36] = second
    row[37] = third
    return row
}

const chapterState = {
    player: { totalLoginDays: 0, totalStaminaUsed: 0 },
    battleCounters: {},
    finishedQuestIds: new Set(),
    questProgress: [
        { category: 1, questId: 1001002, finished: true, clearRank: 5, multiClearCount: 0 },
        { category: 1, questId: 2001001, finished: true, clearRank: 5, multiClearCount: 0 },
        { category: 4, questId: 1001001, finished: true, clearRank: 5, multiClearCount: 0 },
        { category: 4, questId: 2001001, finished: true, clearRank: 5, multiClearCount: 0 },
    ],
    chapterQuestIds: {
        "1": [1001002, 2001001],
        "4": [11001001, 12001001],
    },
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
}

assert.deepEqual(resolveActiveMissionQuestIds(rangeRow("0", "1,2", "8", "4,4")), [1008004, 2008004])
assert.deepEqual(resolveActiveMissionQuestIds(rangeRow("1", "1", "8", "1")), [11008001])
assert.deepEqual(resolveActiveMissionQuestIds(rangeRow("9", "500005", "", "1,2")), [500005001, 500005002])
assert.deepEqual(resolveActiveMissionQuestIds(rangeRow("0", "1", "8", "4")), [1008004])
assert.deepEqual(resolveActiveMissionQuestIds(rangeRow("9", "500005", "", "1")), [500005001])
assert.equal(matchesActiveMissionQuestRange(rangeRow("(None)"), 99, 1), true)
assert.equal(matchesActiveMissionQuestRange(rangeRow(null), 99, 1), true)
assert.equal(matchesActiveMissionQuestRange(rangeRow(""), 1, 1001001), false)
assert.equal(matchesActiveMissionQuestRange(rangeRow("12"), 14, 1001), true)
assert.equal(matchesActiveMissionQuestRange(rangeRow("12"), 20, 1001), true)
assert.equal(matchesActiveMissionQuestRange(rangeRow("12"), 21, 1001), false)
assert.equal(matchesActiveMissionQuestRange(rangeRow("99", "01", "01", "01"), 1, 1001001), false)
assert.throws(() => matchesActiveMissionQuestRange(rangeRow("099"), 1, 1001001), TypeError)
assert.equal(matchesActiveMissionQuestRange(rangeRow("1", "1", "1", "1"), 4, 1001001), true)
assert.equal(matchesActiveMissionQuestRange(rangeRow("1", "1", "1", "1"), 4, 11001001), true)

for (const malformed of ["01", "+1", " 1", "1 ", "1,,2", "-1", "1.5", true]) {
    assert.throws(() => resolveActiveMissionQuestIds(rangeRow("0", malformed, "1", "1")), TypeError)
}
assert.throws(() => resolveActiveMissionQuestIds(rangeRow("0", "9007199254", "999", "999")), RangeError)
assert.throws(() => resolveActiveMissionQuestIds(rangeRow("2", "1", "1", "1")), TypeError)
assert.throws(() => resolveActiveMissionQuestIds(rangeRow("99", "01", "01", "01")), TypeError)
assert.throws(() => resolveActiveMissionQuestIds(rangeRow("0", "", "1", "1")), TypeError)

const {
    computeActiveMissionFactProgress,
} = require("../src/lib/mission/active-reconciliation/fact-progress")

assert.equal(computeActiveMissionFactProgress(66, rangeRow("0", "1,2"), chapterState), 1)
assert.equal(computeActiveMissionFactProgress(66, rangeRow("1", "1,2"), chapterState), 1)
assert.equal(computeActiveMissionFactProgress(66, rangeRow("0", "1,2"), {
    ...chapterState,
    questProgress: chapterState.questProgress.map(progress => (
        progress.questId === 2001001 && progress.category === 1
            ? { ...progress, clearRank: 4 }
            : progress
    )),
}), 0)
assert.equal(computeActiveMissionFactProgress(66, rangeRow("0", "1,2"), {
    ...chapterState,
    chapterQuestIds: { ...chapterState.chapterQuestIds, "1": [] },
}), null)
assert.throws(() => computeActiveMissionFactProgress(66, rangeRow("0", "1"), {
    ...chapterState,
    questProgress: [{ category: 1, questId: 1001002, finished: true, clearRank: 5.5, multiClearCount: 0 }],
}), TypeError)

console.log("active mission chapter fact tests passed")
