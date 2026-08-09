const assert = require("node:assert/strict")
const path = require("node:path")

const projectRoot = process.env.STARTPOINT_TEST_ROOT
    ? path.resolve(process.env.STARTPOINT_TEST_ROOT)
    : path.resolve(__dirname, "..")
const quests = require(path.join(projectRoot, "assets/score_attack_event_quest.json"))
const borderRewards = require(path.join(projectRoot, "assets/score_attack_border_reward.json"))
const entryCosts = require(path.join(projectRoot, "assets/quest_entry_costs.json"))

const questEntries = Object.entries(quests)
assert.equal(questEntries.length, 123)

let largeThresholdCount = 0
for (const [questId, quest] of questEntries) {
    assert.ok(Number.isInteger(quest.eventId) && quest.eventId > 0)
    assert.ok(Number.isInteger(quest.scoreAttackQuestId) && quest.scoreAttackQuestId > 0)

    const thresholds = [
        quest.bRankScore,
        quest.aRankScore,
        quest.sRankScore,
        quest.ssRankScore,
    ]
    assert.ok(thresholds.every(value => Number.isFinite(value) && value >= 0))
    assert.ok(thresholds.every((value, index) => index === 0 || value >= thresholds[index - 1]))
    largeThresholdCount += thresholds.filter(value => value >= 0x80000000).length

    const key = `${quest.eventId}_${quest.scoreAttackQuestId}`
    const tiers = borderRewards[key]
    assert.ok(Array.isArray(tiers) && tiers.length > 0, `missing border rewards for quest ${questId}`)
}
assert.ok(largeThresholdCount > 0)

let tierCount = 0
for (const tiers of Object.values(borderRewards)) {
    for (const tier of tiers) {
        assert.ok(Number.isInteger(tier.id) && tier.id > 0)
        assert.ok(Number.isFinite(tier.score) && tier.score >= 0)
        assert.ok(Array.isArray(tier.rewards))
        for (const reward of tier.rewards) {
            assert.equal(reward.kind, 0)
            assert.ok(Number.isInteger(reward.id) && reward.id > 0)
            assert.ok(Number.isInteger(reward.amount) && reward.amount > 0)
        }
        tierCount++
    }
}
assert.equal(tierCount, 11100)

const category27Costs = Object.entries(entryCosts)
    .filter(([key]) => key.startsWith("27_"))

// The private-server build may intentionally keep Score Attack free. If costs
// are enabled later, require the complete official 123-quest set rather than a
// partially configured mix.
assert.ok(category27Costs.length === 0 || category27Costs.length === 123)
for (const [, cost] of category27Costs) {
    assert.deepEqual(cost, { itemId: 0, itemCount: 0, stamina: 10 })
}

console.log(
    `score attack event data tests passed (${category27Costs.length === 0 ? "free entry" : "10 stamina"})`,
)
