const assert = require("node:assert/strict")

const {
    getQuestNpcPartyPoolKey,
    isQuestNpcPartyPoolEligibleCategory,
    selectQuestNpcPartySourceIds,
} = require("../out/multi/npc/quest-party-pool-shared")

assert.equal(getQuestNpcPartyPoolKey(26, 1006001), "26:1006001")
for (const category of [2, 7, 8, 19, 26]) {
    assert.equal(isQuestNpcPartyPoolEligibleCategory(category), true)
}
for (const category of [1, 3, 22, 23]) {
    assert.equal(isQuestNpcPartyPoolEligibleCategory(category), false)
}

const candidates = Array.from({ length: 80 }, (_, index) => ({
    sourcePlayerId: index + 1,
    battlePower: 20_000 - index * 100,
    clearedAt: index + 1,
}))
const selected = selectQuestNpcPartySourceIds(candidates)
assert.equal(selected.length, 50)
assert.equal(new Set(selected).size, 50)

// Highest-power 30 are always preserved.
for (let playerId = 1; playerId <= 30; playerId++) {
    assert.equal(selected.includes(playerId), true)
}
// Of the remaining players, the latest 20 are preserved.
for (let playerId = 61; playerId <= 80; playerId++) {
    assert.equal(selected.includes(playerId), true)
}
assert.equal(selected.includes(31), false)
assert.equal(selected.includes(60), false)

console.log("quest NPC party pool tests passed")
