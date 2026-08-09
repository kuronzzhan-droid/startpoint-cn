const assert = require("node:assert/strict")
const treasureShop = require("../assets/treasure_shop.json")

assert.equal(Object.keys(treasureShop).length, 108)

for (const [shopItemId, item] of Object.entries(treasureShop)) {
    assert.ok(item.rewards.length > 0, `${shopItemId} must grant a reward`)
    assert.ok(item.userCost?.amount > 0, `${shopItemId} must have a positive price`)
    assert.ok(item.stock > 0, `${shopItemId} must have positive stock`)
    assert.ok(
        !item.rewards.some(reward => reward.id === Number(shopItemId)),
        `${shopItemId} must not use its shop row id as the reward id`,
    )
}

assert.deepEqual(treasureShop["200070"], {
    costs: [],
    rewards: [{ type: 0, id: 2, count: 1 }],
    availableFrom: "2025-03-06 05:00:00",
    availableUntil: null,
    stock: 30,
    userCost: { type: 1, amount: 100 },
    dailyStock: 30,
})

assert.deepEqual(treasureShop["200088"], {
    costs: [],
    rewards: [{ type: 1, count: 2000 }],
    availableFrom: "2025-03-06 05:00:00",
    availableUntil: null,
    stock: 30,
    userCost: { type: 1, amount: 1000 },
    dailyStock: 30,
})

console.log("treasure shop official asset regression checks passed")
