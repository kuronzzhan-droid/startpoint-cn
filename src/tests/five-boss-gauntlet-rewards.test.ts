import assert from "node:assert/strict"
import test from "node:test"

import {
    FIVE_BOSS_BLUEPRINT_DROP_RATE,
    FIVE_BOSS_CURSED_WEAPON_DROP_RATE,
    FIVE_BOSS_CURSED_WEAPON_ID_BASE,
    FIVE_BOSS_CURSED_WEAPON_POOL_SIZE,
    FIVE_BOSS_GAUNTLET_REWARD_IDS,
    FIVE_BOSS_GAUNTLET_WEAPON,
    buildFiveBossCursedWeaponDropPlan,
    buildFiveBossGauntletRewardPlan,
    buildFiveBossWeaponAdditionalRewardDrops,
    canUseAwakeningSubstitutionItem,
    getFiveBossCursedWeaponPool,
} from "../multi/five-boss/rewards"


/** Pops one value per call; throws if asked for more than were queued (catches over-consumption of the random source). */
function queueRandom(values: number[]): () => number {
    const queue = [...values]
    return () => {
        if (queue.length === 0) throw new Error("randomFloat queue exhausted")
        return queue.shift() as number
    }
}


function neverCalled(): () => number {
    return () => { throw new Error("randomFloat must not be called") }
}


function amountOf(
    plan: ReturnType<typeof buildFiveBossGauntletRewardPlan>,
    itemId: number,
): number {
    return plan.items.find(item => item.itemId === itemId)?.amount ?? 0
}


test("manual clear doubles only repeatable materials", () => {
    const auto = buildFiveBossGauntletRewardPlan({
        firstClear: true,
        rewardMultiplier: 1,
        randomFloat: () => 0,
    })
    const manual = buildFiveBossGauntletRewardPlan({
        firstClear: true,
        rewardMultiplier: 2,
        randomFloat: () => 0,
    })

    assert.equal(amountOf(auto, FIVE_BOSS_GAUNTLET_REWARD_IDS.blueprintFragment), 1)
    assert.equal(amountOf(manual, FIVE_BOSS_GAUNTLET_REWARD_IDS.blueprintFragment), 1)
    assert.equal(amountOf(auto, FIVE_BOSS_GAUNTLET_REWARD_IDS.firstClearEmblem), 1)
    assert.equal(amountOf(manual, FIVE_BOSS_GAUNTLET_REWARD_IDS.firstClearEmblem), 1)
    assert.equal(amountOf(manual, FIVE_BOSS_GAUNTLET_REWARD_IDS.deepCrystal), 2 * amountOf(auto, FIVE_BOSS_GAUNTLET_REWARD_IDS.deepCrystal))
    assert.equal(amountOf(manual, FIVE_BOSS_GAUNTLET_REWARD_IDS.fiveKingCore), 2 * amountOf(auto, FIVE_BOSS_GAUNTLET_REWARD_IDS.fiveKingCore))
})


test("later clears do not repeat the first-clear emblem", () => {
    // 2026-09-28 设计稿:结晶 10×倍率,心核保底 1×倍率(0.99 只错过 25% 加成roll,不影响保底)。
    const plan = buildFiveBossGauntletRewardPlan({
        firstClear: false,
        rewardMultiplier: 1,
        randomFloat: () => 0.99,
    })

    assert.equal(amountOf(plan, FIVE_BOSS_GAUNTLET_REWARD_IDS.firstClearEmblem), 0)
    assert.equal(amountOf(plan, FIVE_BOSS_GAUNTLET_REWARD_IDS.blueprintFragment), 0)
    assert.equal(amountOf(plan, FIVE_BOSS_GAUNTLET_REWARD_IDS.deepCrystal), 10)
    assert.equal(amountOf(plan, FIVE_BOSS_GAUNTLET_REWARD_IDS.fiveKingCore), 1)
})


test("the blueprint drops on a 60% roll and never doubles", () => {
    // 2026-09-28 设计稿第 5 节把掉率从 50% 提到 60%(旧断言钉的是 0.5/miss@0.5,这里改钉 0.6/miss@0.6)。
    assert.equal(FIVE_BOSS_BLUEPRINT_DROP_RATE, 0.6)
    const hit = buildFiveBossGauntletRewardPlan({ firstClear: false, rewardMultiplier: 2, randomFloat: () => 0.49 })
    const miss = buildFiveBossGauntletRewardPlan({ firstClear: false, rewardMultiplier: 2, randomFloat: () => 0.6 })
    assert.equal(amountOf(hit, FIVE_BOSS_GAUNTLET_REWARD_IDS.blueprintFragment), 1)
    assert.equal(amountOf(miss, FIVE_BOSS_GAUNTLET_REWARD_IDS.blueprintFragment), 0)
    assert.equal(amountOf(miss, FIVE_BOSS_GAUNTLET_REWARD_IDS.deepCrystal), 20)
})


test("the five-king-core reward always grants at least 1x, with a 25% chance of a second 1x", () => {
    // 2026-09-28 设计稿第 5 节:心核从纯 25% 判定改为「必掉 1×倍率 + 25% 额外 1×倍率」,合并成一条 amount。
    const guaranteedOnly = buildFiveBossGauntletRewardPlan({ firstClear: false, rewardMultiplier: 2, randomFloat: () => 0.25 })
    const withBonus = buildFiveBossGauntletRewardPlan({ firstClear: false, rewardMultiplier: 2, randomFloat: () => 0.24 })
    assert.equal(amountOf(guaranteedOnly, FIVE_BOSS_GAUNTLET_REWARD_IDS.fiveKingCore), 2)
    assert.equal(amountOf(withBonus, FIVE_BOSS_GAUNTLET_REWARD_IDS.fiveKingCore), 4)
})


test("invalid multipliers and random sources fail closed", () => {
    assert.throws(() => buildFiveBossGauntletRewardPlan({
        firstClear: false,
        rewardMultiplier: 3 as 1,
    }), /rewardMultiplier/)
    assert.throws(() => buildFiveBossGauntletRewardPlan({
        firstClear: false,
        rewardMultiplier: 1,
        randomFloat: () => 1,
    }), /randomFloat/)
})


test("the weapon is shop-only and requires repeated clears and duplicate bodies", () => {
    const plan = buildFiveBossGauntletRewardPlan({
        firstClear: true,
        rewardMultiplier: 2,
        randomFloat: () => 0,
    })

    assert.equal(plan.items.some(item => item.itemId === FIVE_BOSS_GAUNTLET_WEAPON.equipmentId), false)
    assert.equal(FIVE_BOSS_GAUNTLET_WEAPON.blueprintFragmentsPerBody, 8)
    assert.equal(FIVE_BOSS_GAUNTLET_WEAPON.bodiesForMaxLimitBreak, 5)
    assert.equal(FIVE_BOSS_GAUNTLET_WEAPON.maxEnhancedLevel, 120)
    assert.equal(FIVE_BOSS_GAUNTLET_WEAPON.allowFiveStarSteelSubstitution, false)
    assert.equal(FIVE_BOSS_GAUNTLET_WEAPON.maxAttackPercent, 25)
    assert.equal(FIVE_BOSS_GAUNTLET_WEAPON.maxAbilityDamagePercent, 475)
    assert.equal(FIVE_BOSS_GAUNTLET_WEAPON.maxIndependentAbilityDamagePercent, 5)
    assert.equal("maxSkillDamagePercent" in FIVE_BOSS_GAUNTLET_WEAPON, false)
});


test("the gauntlet weapon rejects awakening substitution items", () => {
    assert.equal(canUseAwakeningSubstitutionItem(FIVE_BOSS_GAUNTLET_WEAPON.equipmentId), false)
    assert.equal(canUseAwakeningSubstitutionItem(5010073), true)
})


test("the cursed-weapon pool is the 29 ids 5910101..5910129, filtered live against equipment_ids.json", () => {
    assert.equal(FIVE_BOSS_CURSED_WEAPON_DROP_RATE, 0.05)
    assert.equal(FIVE_BOSS_CURSED_WEAPON_ID_BASE, 5910100)
    assert.equal(FIVE_BOSS_CURSED_WEAPON_POOL_SIZE, 29)

    const pool = getFiveBossCursedWeaponPool()
    // 另一会话在建/退役武器,这里只断言"全部落在区间内、按升序、无重复",不锁死具体数量,
    // 避免与诅咒武器施工会话的 assets/equipment_ids.json 改动打架。
    assert.ok(pool.length > 0 && pool.length <= FIVE_BOSS_CURSED_WEAPON_POOL_SIZE, `pool.length=${pool.length}`)
    assert.ok(pool.every(id => id > FIVE_BOSS_CURSED_WEAPON_ID_BASE && id <= FIVE_BOSS_CURSED_WEAPON_ID_BASE + FIVE_BOSS_CURSED_WEAPON_POOL_SIZE))
    assert.deepEqual(pool, [...pool].sort((left, right) => left - right))
    assert.equal(new Set(pool).size, pool.length)
})


test("cursed-weapon rolls: multiplier is the roll count, each roll independently hits at 5%", () => {
    const pool = [5910101, 5910102, 5910103]

    const noHits = buildFiveBossCursedWeaponDropPlan({
        rewardMultiplier: 1,
        availableEquipmentIds: pool,
        randomFloat: queueRandom([0.05]), // exactly the rate = miss (strict <)
    })
    assert.deepEqual(noHits.equipmentIds, [])

    const oneRollOneHit = buildFiveBossCursedWeaponDropPlan({
        rewardMultiplier: 1,
        availableEquipmentIds: pool,
        randomFloat: queueRandom([0.01, 0.5]), // hit, then pick index floor(0.5*3)=1
    })
    assert.deepEqual(oneRollOneHit.equipmentIds, [5910102])

    const twoRollsTwoHits = buildFiveBossCursedWeaponDropPlan({
        rewardMultiplier: 2,
        availableEquipmentIds: pool,
        randomFloat: queueRandom([0, 0, 0.04, 0.999999]), // hit+pick(0), hit+pick(2)
    })
    assert.deepEqual(twoRollsTwoHits.equipmentIds, [5910101, 5910103])

    const twoRollsOneHit = buildFiveBossCursedWeaponDropPlan({
        rewardMultiplier: 2,
        availableEquipmentIds: pool,
        randomFloat: queueRandom([0.5, 0.01, 0.9]), // roll 1 miss, roll 2 hit+pick(2)
    })
    assert.deepEqual(twoRollsOneHit.equipmentIds, [5910103])
})


test("cursed-weapon rolls never touch randomFloat when the pool is empty", () => {
    const plan = buildFiveBossCursedWeaponDropPlan({
        rewardMultiplier: 2,
        availableEquipmentIds: [],
        randomFloat: neverCalled(),
    })
    assert.deepEqual(plan.equipmentIds, [])
})


test("cursed-weapon rolls reject bad multipliers, non-array pools, and out-of-range random sources", () => {
    assert.throws(() => buildFiveBossCursedWeaponDropPlan({
        rewardMultiplier: 3 as 1,
        availableEquipmentIds: [5910101],
    }), /rewardMultiplier/)
    assert.throws(() => buildFiveBossCursedWeaponDropPlan({
        rewardMultiplier: 1,
        availableEquipmentIds: null as unknown as number[],
    }), /availableEquipmentIds/)
    assert.throws(() => buildFiveBossCursedWeaponDropPlan({
        rewardMultiplier: 1,
        availableEquipmentIds: [5910101],
        randomFloat: () => 1,
    }), /randomFloat/)
})


test("each granted weapon (including a repeat hit) gets its own additional_reward row at index = id - 5910100", () => {
    assert.deepEqual(buildFiveBossWeaponAdditionalRewardDrops([]), [])
    assert.deepEqual(
        buildFiveBossWeaponAdditionalRewardDrops([5910101, 5910129, 5910101]),
        [
            { group_id: 590010001, index: 1, number: 1 },
            { group_id: 590010001, index: 29, number: 1 },
            { group_id: 590010001, index: 1, number: 1 },
        ],
    )
})

