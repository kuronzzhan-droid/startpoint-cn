const { test } = require('node:test')
const assert = require('node:assert/strict')
const { settleBattleBoostPoints } = require('../out/lib/quest/finish/battle-boost')

for (const [normal, boss, useNormal, useBoss, remainingNormal, remainingBoss, doubled] of [
    [0, 0, true, false, 0, 0, false],
    [0, 0, false, true, 0, 0, false],
    [0, 0, true, true, 0, 0, false],
    [1, 1, false, false, 1, 1, false],
    [1, 1, true, false, 0, 1, true],
    [1, 1, false, true, 1, 0, true],
    [0, 1, true, true, 0, 0, true],
    [1, 0, true, true, 0, 0, true],
    [2, 1, true, true, 1, 0, true],
    [-1, -2, true, true, 0, 0, false],
]) test(`boost ${normal}/${boss}, selected ${useNormal}/${useBoss}`, () => {
    assert.deepEqual(settleBattleBoostPoints({ boostPoint: normal, bossBoostPoint: boss }, {
        useBoostPoint: useNormal, useBossBoostPoint: useBoss,
    }), { boostPoint: remainingNormal, bossBoostPoint: remainingBoss, useBoostPoint: doubled })
})

test('invalid persisted numeric balances fail instead of producing an invalid debit', () => {
    for (const invalid of [NaN, Infinity, 0.5, '1', Number.MAX_SAFE_INTEGER + 1]) {
        assert.throws(() => settleBattleBoostPoints({ boostPoint: invalid, bossBoostPoint: 1 }, { useBoostPoint: true }))
    }
})
