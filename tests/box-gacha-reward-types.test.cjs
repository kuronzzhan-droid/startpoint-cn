const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const output = process.env.LENS_BUILD_OUT || path.resolve(__dirname, '../out')
const { getBoxGachaSync } = require(path.join(output, 'lib/assets'))
const { drawBoxGachaSync } = require(path.join(output, 'lib/gacha'))

test('featured box characters are returned for all three type-6 master rewards', () => {
    for (const [gachaId, rewardId, characterId] of [
        [1, 1000103001, 263002], [2, 1000203001, 233001], [3, 1000303001, 223001],
    ]) {
        const box = getBoxGachaSync(gachaId).boxes['3']
        const exhausted = Object.entries(box).filter(([id]) => Number(id) !== rewardId)
            .map(([id, reward]) => ({ id: Number(id), number: reward.available }))
        const result = drawBoxGachaSync(box, exhausted, 1)
        assert.equal(result.drawCount, 1)
        assert.deepEqual(result.rewards, [{ id: rewardId, number: 1 }])
        assert.deepEqual([...result.characters], [[characterId, 1]])
        assert.equal(drawBoxGachaSync(box, [...exhausted, ...result.rewards], 1).drawCount, 0)
    }
})

test('event-scoped type-5 pass-card points reject a draw instead of consuming it', () => {
    const drawn = []
    assert.throws(() => drawBoxGachaSync({
        '1001': { type: 5, count: 10, available: 1, tier: 0 },
    }, drawn, 1), /pass-card point rewards are unsupported/)
    assert.deepEqual(drawn, [])
})
