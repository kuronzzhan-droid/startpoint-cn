require("ts-node/register/transpile-only")

const assert = require("node:assert/strict")
const {
    getRescueFragmentAdditionalReward,
    getRescueFragmentReward,
    RESCUE_GOLD_FRAGMENT_ADDITIONAL_REWARD_GROUP_ID,
    RESCUE_GOLD_FRAGMENT_ITEM_ID,
    RESCUE_PURPLE_FRAGMENT_ADDITIONAL_REWARD_GROUP_ID,
    RESCUE_PURPLE_FRAGMENT_ITEM_ID,
    RESCUE_SILVER_FRAGMENT_ADDITIONAL_REWARD_GROUP_ID,
    RESCUE_SILVER_FRAGMENT_ITEM_ID,
} = require("../src/multi/rescue-fragment-reward")
const { QuestCategory, RewardType } = require("../src/lib/types")

function item(id) {
    return { type: RewardType.ITEM, id, count: 10 }
}

assert.deepEqual(getRescueFragmentReward(QuestCategory.BOSS_BATTLE, 1060001), item(RESCUE_SILVER_FRAGMENT_ITEM_ID))
assert.deepEqual(getRescueFragmentReward(QuestCategory.BOSS_BATTLE, 1060002), item(RESCUE_SILVER_FRAGMENT_ITEM_ID))
assert.deepEqual(getRescueFragmentReward(QuestCategory.BOSS_BATTLE, 1060003), item(RESCUE_GOLD_FRAGMENT_ITEM_ID))
assert.deepEqual(getRescueFragmentReward(QuestCategory.BOSS_BATTLE, 1060004), item(RESCUE_PURPLE_FRAGMENT_ITEM_ID))
assert.deepEqual(getRescueFragmentReward(QuestCategory.BOSS_BATTLE, 1060005), item(RESCUE_PURPLE_FRAGMENT_ITEM_ID))

// Yamata-no-Orochi is the server's three-stage exception: its final Super
// rescue reward remains gold.
assert.deepEqual(getRescueFragmentReward(QuestCategory.BOSS_BATTLE, 1020001), item(RESCUE_SILVER_FRAGMENT_ITEM_ID))
assert.deepEqual(getRescueFragmentReward(QuestCategory.BOSS_BATTLE, 1020002), item(RESCUE_GOLD_FRAGMENT_ITEM_ID))
assert.deepEqual(getRescueFragmentReward(QuestCategory.BOSS_BATTLE, 1020003), item(RESCUE_GOLD_FRAGMENT_ITEM_ID))

// Later permanent difficulties and special V・Solas variants are no longer
// dropped because their suffix exceeds the old 1-5 switch.
assert.deepEqual(getRescueFragmentReward(QuestCategory.BOSS_BATTLE, 1001006), item(RESCUE_PURPLE_FRAGMENT_ITEM_ID))
assert.deepEqual(getRescueFragmentReward(QuestCategory.BOSS_BATTLE, 1001019), item(RESCUE_PURPLE_FRAGMENT_ITEM_ID))

// Every configured decisive/special steam robot, including post-added IDs.
for (const questId of [
    1001,
    2001,
    3001,
    1001001,
    1002001,
    1003001,
    1004001,
    1005001,
    1006001,
    100000001,
    100001001,
    100002001,
]) {
    assert.deepEqual(
        getRescueFragmentReward(QuestCategory.HARD_MULTI_EVENT, questId),
        item(RESCUE_PURPLE_FRAGMENT_ITEM_ID),
    )
}

assert.equal(getRescueFragmentReward(QuestCategory.HARD_MULTI_EVENT, 1001002), null)
assert.deepEqual(
    getRescueFragmentReward(QuestCategory.ADVENT_EVENT_MULTI, 200080005),
    item(RESCUE_PURPLE_FRAGMENT_ITEM_ID),
)
assert.deepEqual(
    getRescueFragmentReward(QuestCategory.WORLD_STORY_EVENT_BOSS_BATTLE, 100100003),
    item(RESCUE_SILVER_FRAGMENT_ITEM_ID),
)
assert.deepEqual(
    getRescueFragmentReward(QuestCategory.WORLD_STORY_EVENT_BOSS_BATTLE, 100100004),
    item(RESCUE_GOLD_FRAGMENT_ITEM_ID),
)
assert.deepEqual(
    getRescueFragmentReward(QuestCategory.RAID_EVENT, 7026),
    item(RESCUE_PURPLE_FRAGMENT_ITEM_ID),
)
assert.equal(getRescueFragmentReward(QuestCategory.ADVENT_EVENT_MULTI, 200080999), null)
assert.equal(getRescueFragmentReward(QuestCategory.BOSS_BATTLE, 1060006), null)

assert.deepEqual(
    getRescueFragmentAdditionalReward(item(RESCUE_SILVER_FRAGMENT_ITEM_ID)),
    { group_id: RESCUE_SILVER_FRAGMENT_ADDITIONAL_REWARD_GROUP_ID, index: 1, number: 10 },
)
assert.deepEqual(
    getRescueFragmentAdditionalReward(item(RESCUE_GOLD_FRAGMENT_ITEM_ID)),
    { group_id: RESCUE_GOLD_FRAGMENT_ADDITIONAL_REWARD_GROUP_ID, index: 1, number: 10 },
)
assert.deepEqual(
    getRescueFragmentAdditionalReward(item(RESCUE_PURPLE_FRAGMENT_ITEM_ID)),
    { group_id: RESCUE_PURPLE_FRAGMENT_ADDITIONAL_REWARD_GROUP_ID, index: 1, number: 10 },
)
assert.equal(getRescueFragmentAdditionalReward(null), null)
assert.equal(
    getRescueFragmentAdditionalReward({ type: RewardType.ITEM, id: 101001, count: 10 }),
    null,
)

console.log("rescue fragment reward tests passed")
