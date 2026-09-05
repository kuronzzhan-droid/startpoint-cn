import assert from "node:assert/strict"
import test from "node:test"

import {
    FIVE_BOSS_BLUEPRINT_DROP_RATE,
    FIVE_BOSS_GAUNTLET_REWARD_IDS,
    FIVE_BOSS_GAUNTLET_WEAPON,
    buildFiveBossGauntletRewardPlan,
    canUseAwakeningSubstitutionItem,
} from "../multi/five-boss/rewards"


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
    const plan = buildFiveBossGauntletRewardPlan({
        firstClear: false,
        rewardMultiplier: 1,
        randomFloat: () => 0.99,
    })

    assert.equal(amountOf(plan, FIVE_BOSS_GAUNTLET_REWARD_IDS.firstClearEmblem), 0)
    assert.equal(amountOf(plan, FIVE_BOSS_GAUNTLET_REWARD_IDS.blueprintFragment), 0)
    assert.equal(amountOf(plan, FIVE_BOSS_GAUNTLET_REWARD_IDS.deepCrystal), 5)
    assert.equal(amountOf(plan, FIVE_BOSS_GAUNTLET_REWARD_IDS.fiveKingCore), 0)
})


test("the blueprint drops on a 50% roll and never doubles", () => {
    assert.equal(FIVE_BOSS_BLUEPRINT_DROP_RATE, 0.5)
    const hit = buildFiveBossGauntletRewardPlan({ firstClear: false, rewardMultiplier: 2, randomFloat: () => 0.49 })
    const miss = buildFiveBossGauntletRewardPlan({ firstClear: false, rewardMultiplier: 2, randomFloat: () => 0.5 })
    assert.equal(amountOf(hit, FIVE_BOSS_GAUNTLET_REWARD_IDS.blueprintFragment), 1)
    assert.equal(amountOf(miss, FIVE_BOSS_GAUNTLET_REWARD_IDS.blueprintFragment), 0)
    assert.equal(amountOf(miss, FIVE_BOSS_GAUNTLET_REWARD_IDS.deepCrystal), 10)
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

