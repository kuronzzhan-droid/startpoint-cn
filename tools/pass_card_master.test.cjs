require("ts-node/register/transpile-only")

const assert = require("node:assert/strict")
const {
    getPassCardEventDefinition,
    getPassCardRewardDefinition,
    isPassCardEventActiveAt,
} = require("../src/lib/pass-card")
const passCardRewards = require("../assets/pass_card_reward.json")

const event = getPassCardEventDefinition(1)
assert.ok(event)
assert.equal(event.thresholdPoint, 6000)
assert.equal(event.levelThreshold, 100)
assert.equal(event.startTime, 1717189200000)
assert.equal(event.endTime, 1719781199000)
assert.equal(event.forceTime, 1722459599000)
assert.equal(isPassCardEventActiveAt(event, new Date(event.startTime)), true)
assert.equal(isPassCardEventActiveAt(event, new Date(event.endTime)), true)
assert.equal(isPassCardEventActiveAt(event, new Date(event.startTime - 1)), false)
assert.equal(isPassCardEventActiveAt(event, new Date(event.endTime + 1)), false)

assert.deepEqual(getPassCardRewardDefinition(150), {
    rewardId: 150,
    eventId: 3,
    level: 30,
    reward1: { kind: 6, amount: 0, degreeId: 80019 },
    reward2: { kind: 6, amount: 0, degreeId: 80020 },
})
for (const rewardId of Object.keys(passCardRewards).map(Number)) {
    assert.notEqual(getPassCardRewardDefinition(rewardId), undefined)
}

console.log("pass-card master parser tests passed")
