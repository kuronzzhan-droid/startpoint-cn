require("ts-node/register/transpile-only")

const assert = require("node:assert/strict")
const {
    computeActiveMissionFactProgress,
    estimateActiveMissionCharacterLevel,
} = require("../src/lib/mission/active-reconciliation/fact-progress")

function makeState(overrides = {}) {
    return {
        player: { totalLoginDays: 1, totalStaminaUsed: 20 },
        battleCounters: { singleClearCount: 2, multiClearCount: 3, multiHostClearCount: 1 },
        finishedQuestIds: new Set([101, 102]),
        questProgress: [],
        chapterQuestIds: {},
        practiceQuestChallengeCount: 0,
        leaderClearCounts: {},
        conditionalBattleFacts: {},
        loadoutBattleFacts: {},
        characterStoryQuestIds: { "1": [101, 102, 103], "2": [102] },
        characters: {
            "1": {
                rarity: 1,
                exp: 11416,
                evolutionLevel: 1,
                overLimitStep: 2,
                bondTokenList: [{ status: 1 }, { status: 0 }],
            },
            "2": {
                rarity: 1,
                exp: 0,
                evolutionLevel: 0,
                overLimitStep: 1,
                bondTokenList: [{ status: 1 }],
            },
        },
        equipment: [
            { level: 5, maxLevel: 5, enhancementLevel: 20 },
            { level: 1, maxLevel: 5, enhancementLevel: 8 },
        ],
        manaNodes: { "1": [101, 102, 201, 202] },
        manaBoardNodes: { "1": { "2": [201, 202] } },
        manaNodeSlots: { "1": { "101": 1, "102": 4, "201": 2, "202": 4 } },
        partyAbilitySoulCount: 1,
        treasureShopPurchaseCount: 2,
        bossCoinShopPurchaseCount: 3,
        bossCoinEquipmentShopPurchaseCount: 1,
        totalUsedManaCount: 120,
        totalGachaCharacterCount: 5,
        totalEquipmentEquipCount: 1,
        totalUnisonSetCount: 1,
        totalPartyCharacterSetCount: 1,
        totalInjectedExpCount: 1,
        totalGachaCampaignCount: 1,
        ...overrides,
    }
}

function characterRow(characterId = "(None)") {
    const row = []
    row[43] = characterId
    return row
}

const state = makeState()
const expectations = new Map([
    [0, 1], [39, 20], [21, 2], [14, 2], [16, 3], [17, 1], [5, 40],
    [61, 1], [36, 1], [48, 1], [9, 3], [8, 2], [62, 2], [7, 4],
    [34, 4], [35, 1], [45, 2], [58, 1], [59, 1], [60, 1], [63, 1],
    [83, 1], [64, 1], [84, 3], [46, 120], [78, 5],
])
for (const [pattern, expected] of expectations) {
    assert.equal(computeActiveMissionFactProgress(pattern, characterRow(), state), expected, `pattern ${pattern}`)
}
assert.equal(computeActiveMissionFactProgress(4, characterRow("1"), state), 1)
assert.equal(computeActiveMissionFactProgress(4, characterRow("999"), state), 0)
assert.equal(computeActiveMissionFactProgress(4, characterRow(), state), 2)
assert.equal(computeActiveMissionFactProgress(21, characterRow(), makeState({ finishedQuestIds: new Set() })), 0)

assert.equal(estimateActiveMissionCharacterLevel(state.characters["1"]), 40)
assert.equal(estimateActiveMissionCharacterLevel({ ...state.characters["1"], rarity: undefined }), 0)
assert.equal(estimateActiveMissionCharacterLevel({ ...state.characters["1"], rarity: 6 }), 0)
for (const rarity of [1, 2, 3, 4, 5]) {
    const level = estimateActiveMissionCharacterLevel({
        rarity,
        exp: 0,
        evolutionLevel: 0,
        overLimitStep: 0,
        bondTokenList: [],
    })
    assert.equal(level, 39 + rarity * 10 - 10)
}

const overflowCharacters = {
    "1": { ...state.characters["1"], overLimitStep: Number.MAX_SAFE_INTEGER },
    "2": { ...state.characters["2"], overLimitStep: 1 },
}
assert.throws(() => computeActiveMissionFactProgress(9, characterRow(), makeState({
    characters: overflowCharacters,
})), RangeError)
assert.throws(() => computeActiveMissionFactProgress(34, characterRow(), makeState({
    equipment: [{ level: 0, maxLevel: 5, enhancementLevel: 0 }],
})), RangeError)
assert.throws(() => computeActiveMissionFactProgress(8, characterRow(), makeState({
    characters: { "1": { ...state.characters["1"], bondTokenList: [{ status: -1 }] } },
})), RangeError)
assert.throws(() => computeActiveMissionFactProgress(7, characterRow(), makeState({
    manaNodes: { "1": [1, -2] },
})), RangeError)

const beforeNodes = [...state.manaNodes["1"]]
const beforeTokens = state.characters["1"].bondTokenList.map(token => ({ ...token }))
computeActiveMissionFactProgress(48, characterRow(), state)
computeActiveMissionFactProgress(8, characterRow(), state)
assert.deepEqual(state.manaNodes["1"], beforeNodes)
assert.deepEqual(state.characters["1"].bondTokenList, beforeTokens)

console.log("active mission character fact tests passed")
