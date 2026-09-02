export const FIVE_BOSS_GAUNTLET_REWARD_IDS = Object.freeze({
    blueprintFragment: 10000144,
    deepCrystal: 10000145,
    firstClearEmblem: 10000146,
    fiveKingCore: 10000147,
})

export const FIVE_BOSS_GAUNTLET_WEAPON = Object.freeze({
    equipmentId: 5900101,
    name: "死亡使者·终式",
    blueprintFragmentsPerBody: 8,
    bodiesForMaxLimitBreak: 5,
    maxEnhancedLevel: 120,
    allowFiveStarSteelSubstitution: false,
    maxAttackPercent: 25,
    maxAbilityDamagePercent: 475,
    maxIndependentAbilityDamagePercent: 5,
})

export interface FiveBossGauntletRewardItem {
    itemId: number
    amount: number
    multiplierKind: "fixed" | "repeatable"
}

export interface FiveBossGauntletRewardPlan {
    items: FiveBossGauntletRewardItem[]
}

export interface BuildFiveBossGauntletRewardPlanInput {
    firstClear: boolean
    rewardMultiplier: 1 | 2
    randomFloat?: () => number
}


export function canUseAwakeningSubstitutionItem(equipmentId: number): boolean {
    return equipmentId !== FIVE_BOSS_GAUNTLET_WEAPON.equipmentId
}


function checkedRandomFloat(randomFloat: () => number): number {
    const value = randomFloat()
    if (!Number.isFinite(value) || value < 0 || value >= 1) {
        throw new RangeError("randomFloat must return a finite value in [0, 1)")
    }
    return value
}


export function buildFiveBossGauntletRewardPlan(
    input: BuildFiveBossGauntletRewardPlanInput,
): FiveBossGauntletRewardPlan {
    if (typeof input.firstClear !== "boolean") {
        throw new TypeError("firstClear must be a boolean")
    }
    if (input.rewardMultiplier !== 1 && input.rewardMultiplier !== 2) {
        throw new RangeError("rewardMultiplier must be 1 or 2")
    }

    const randomFloat = input.randomFloat ?? Math.random
    const items: FiveBossGauntletRewardItem[] = [
        {
            itemId: FIVE_BOSS_GAUNTLET_REWARD_IDS.blueprintFragment,
            amount: 1,
            multiplierKind: "fixed",
        },
        {
            itemId: FIVE_BOSS_GAUNTLET_REWARD_IDS.deepCrystal,
            amount: 5 * input.rewardMultiplier,
            multiplierKind: "repeatable",
        },
    ]

    if (input.firstClear) {
        items.push({
            itemId: FIVE_BOSS_GAUNTLET_REWARD_IDS.firstClearEmblem,
            amount: 1,
            multiplierKind: "fixed",
        })
    }
    if (checkedRandomFloat(randomFloat) < 0.25) {
        items.push({
            itemId: FIVE_BOSS_GAUNTLET_REWARD_IDS.fiveKingCore,
            amount: input.rewardMultiplier,
            multiplierKind: "repeatable",
        })
    }

    return { items }
}
