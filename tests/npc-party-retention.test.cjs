const test = require('node:test')
const assert = require('node:assert/strict')
const { selectQuestNpcPartySourceIds, QUEST_NPC_POOL_MAX_RECENT } =
    require('../out/multi/npc/quest-party-pool-shared')

test('retention keeps the latest 50 clears without reserving high-power entries', () => {
    const candidates = Array.from({length: 75}, (_, i) => ({
        sourcePlayerId: i + 1, clearedAt: i + 1, battlePower: i < 30 ? 999999 : 8000,
    }))
    const before = structuredClone(candidates)
    assert.equal(QUEST_NPC_POOL_MAX_RECENT, 50)
    assert.deepEqual(selectQuestNpcPartySourceIds(candidates),
        Array.from({length: 50}, (_, i) => 75 - i))
    assert.deepEqual(candidates, before)
})

test('empty and small histories retain only their actual entries', () => {
    assert.deepEqual(selectQuestNpcPartySourceIds([]), [])
    assert.deepEqual(selectQuestNpcPartySourceIds([
        {sourcePlayerId: 1, clearedAt: 10, battlePower: 999999},
        {sourcePlayerId: 2, clearedAt: 20, battlePower: 8000},
    ]), [2, 1])
})

test('equal clear times have a stable order independent of battle power', () => {
    const candidates = Array.from({length: 55}, (_, i) => ({
        sourcePlayerId: 55 - i, clearedAt: 100, battlePower: 999999 - i,
    }))
    assert.deepEqual(selectQuestNpcPartySourceIds(candidates),
        Array.from({length: 50}, (_, i) => i + 1))
})
