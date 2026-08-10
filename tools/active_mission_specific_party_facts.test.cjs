require("ts-node/register/transpile-only")

const assert = require("node:assert/strict")
const {
    computeActiveMissionFactProgress,
} = require("../src/lib/mission/active-reconciliation/fact-progress")

function row({ battleKind = 3, rangeKind, first, second, third, characterId = 121033 } = {}) {
    const values = []
    values[32] = String(battleKind)
    if (rangeKind !== undefined) values[34] = String(rangeKind)
    if (first !== undefined) values[35] = String(first)
    if (second !== undefined) values[36] = String(second)
    if (third !== undefined) values[37] = String(third)
    values[43] = String(characterId)
    values[46] = String(characterId)
    return values
}

function makeState(overrides = {}) {
    return {
        player: { totalLoginDays: 0, totalStaminaUsed: 0 },
        battleCounters: {},
        finishedQuestIds: new Set(),
        questProgress: [
            { category: 21, questId: 1003, finished: true, leaderCharacterId: 121033, multiClearCount: 0 },
            { category: 21, questId: 1004, finished: true, leaderCharacterId: 999999, multiClearCount: 0 },
        ],
        chapterQuestIds: {},
        practiceQuestChallengeCount: 6,
        leaderClearCounts: { "121033": { all: 4, multi: 2 } },
        conditionalBattleFacts: {
            "71:121033": 5,
            "72:121033": 3,
            "73:121033": 1,
        },
        loadoutBattleFacts: { "99001": 8 },
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

const state = makeState()
assert.equal(computeActiveMissionFactProgress(70, row({ battleKind: 1 }), state), 2)
assert.equal(computeActiveMissionFactProgress(70, row({ battleKind: 2 }), state), 2)
assert.equal(computeActiveMissionFactProgress(70, row({ battleKind: 3 }), state), 4)
assert.equal(computeActiveMissionFactProgress(70, row({
    battleKind: 1,
    rangeKind: 14,
    first: "1",
    third: "3",
}), state), 1)
assert.equal(computeActiveMissionFactProgress(70, row({
    battleKind: 2,
    rangeKind: 14,
    first: "1",
    third: "3",
}), state), null)
assert.equal(computeActiveMissionFactProgress(70, row({
    battleKind: 1,
    rangeKind: 99,
    first: "01",
}), state), 0)
assert.equal(computeActiveMissionFactProgress(70, row(), makeState({ leaderClearCounts: {} })), 0)

assert.equal(computeActiveMissionFactProgress(65, (() => {
    const values = row()
    values[34] = "11"
    return values
})(), state), 6)
assert.equal(computeActiveMissionFactProgress(65, row({ rangeKind: 14 }), state), null)
assert.equal(computeActiveMissionFactProgress(71, row(), state), 5)
assert.equal(computeActiveMissionFactProgress(72, row(), state), 3)
assert.equal(computeActiveMissionFactProgress(73, row(), state), 1)
assert.equal(computeActiveMissionFactProgress(89, row(), state, 99001), 8)
assert.equal(computeActiveMissionFactProgress(89, row(), state), null)

assert.throws(() => computeActiveMissionFactProgress(70, row(), makeState({
    leaderClearCounts: { "121033": { all: 1, multi: 2 } },
})), RangeError)
assert.throws(() => computeActiveMissionFactProgress(71, row(), makeState({
    conditionalBattleFacts: { "71:121033": -1 },
})), RangeError)
assert.throws(() => computeActiveMissionFactProgress(89, row(), makeState({
    loadoutBattleFacts: { "99001": Number.MAX_SAFE_INTEGER + 1 },
}), 99001), RangeError)
assert.throws(() => computeActiveMissionFactProgress(70, row({ characterId: "01" }), state), TypeError)

console.log("active mission specific party fact tests passed")
