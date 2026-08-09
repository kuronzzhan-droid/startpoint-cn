const assert = require("node:assert/strict")
const path = require("node:path")

require("ts-node/register/transpile-only")

const projectRoot = process.env.STARTPOINT_TEST_ROOT
    ? path.resolve(process.env.STARTPOINT_TEST_ROOT)
    : path.resolve(__dirname, "..")

const {
    calculateScoreAttackClearRank,
    collectScoreAttackMainCharacterIds,
    resolveNewScoreAttackBorderRewards,
    resolveScoreAttackBorderTiers,
} = require(path.join(projectRoot, "src/lib/quest/finish/score-attack-handler"))

const thresholds = {
    bRankScore: 100,
    aRankScore: 200,
    sRankScore: 300,
    ssRankScore: 400,
}

assert.equal(calculateScoreAttackClearRank(-1, thresholds), 1)
assert.equal(calculateScoreAttackClearRank(99, thresholds), 1)
assert.equal(calculateScoreAttackClearRank(100, thresholds), 2)
assert.equal(calculateScoreAttackClearRank(200, thresholds), 3)
assert.equal(calculateScoreAttackClearRank(300, thresholds), 4)
assert.equal(calculateScoreAttackClearRank(400, thresholds), 5)
assert.equal(calculateScoreAttackClearRank(9_000_000_000, thresholds), 5)

const tiers = [
    {
        id: 101003,
        eventId: 1,
        questId: 101,
        score: 300,
        reasonId: 16001,
        rewards: [{ kind: 0, id: 40501, amount: 3 }],
    },
    {
        id: 101001,
        eventId: 1,
        questId: 101,
        score: 100,
        reasonId: 16001,
        rewards: [{ kind: 0, id: 40501, amount: 1 }],
    },
    {
        id: 101002,
        eventId: 1,
        questId: 101,
        score: 200,
        reasonId: 16001,
        rewards: [
            { kind: 0, id: 40501, amount: 2 },
            { kind: 0, id: 40502, amount: 5 },
        ],
    },
]

const resolvedTiers = resolveScoreAttackBorderTiers(1, 101, { "1_101": tiers })
assert.deepEqual(resolvedTiers.map(tier => tier.id), [101001, 101002, 101003])
assert.throws(
    () => resolveScoreAttackBorderTiers(undefined, 101, { "1_101": tiers }),
    /missing/,
)
assert.throws(
    () => resolveScoreAttackBorderTiers(1, 999, { "1_101": tiers }),
    /missing/,
)

assert.deepEqual(
    resolveNewScoreAttackBorderRewards(resolvedTiers, 0, 300),
    {
        rewardIds: [101001, 101002, 101003],
        itemCounts: { "40501": 6, "40502": 5 },
    },
)
assert.deepEqual(
    resolveNewScoreAttackBorderRewards(resolvedTiers, 200, 300),
    {
        rewardIds: [101003],
        itemCounts: { "40501": 3 },
    },
)
assert.deepEqual(
    resolveNewScoreAttackBorderRewards(resolvedTiers, 300, 300),
    { rewardIds: [], itemCounts: {} },
)
assert.deepEqual(
    resolveNewScoreAttackBorderRewards(resolvedTiers, 300, 200),
    { rewardIds: [], itemCounts: {} },
)

assert.deepEqual(
    collectScoreAttackMainCharacterIds([
        { id: 101 },
        null,
        { id: 103 },
    ]),
    { "0": 101, "2": 103 },
)

assert.throws(() => resolveScoreAttackBorderTiers(1, 101, {
    "1_101": [{
        id: 1,
        eventId: 1,
        questId: 101,
        score: 100,
        reasonId: 16001,
        rewards: [{ kind: 1, id: 40501, amount: 1 }],
    }],
}), /invalid/)

console.log("score attack event tests passed")
