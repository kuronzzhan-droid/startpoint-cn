export const FIVE_BOSS_GAUNTLET_REWARD_IDS = Object.freeze({
    blueprintFragment: 10000144,
    deepCrystal: 10000145,
    firstClearEmblem: 10000146,
    fiveKingCore: 10000147,
})

/**
 * 结算页只认 drop_additional_reward_ids 里的「客户端 additional_reward 组 + 序号」,
 * item_list 只更新背包数字不上屏(真机 2026-09-04:材料到账但结算页空白)。
 * 组 590010000 的四行在客户端 master/reward/event/additional_reward.orderedmap(1.4.725),
 * 序号顺序与这里必须一致。
 */
export const FIVE_BOSS_GAUNTLET_REWARD_DISPLAY = Object.freeze({
    additionalRewardGroupId: 590010000,
    indexByItemId: Object.freeze({
        [FIVE_BOSS_GAUNTLET_REWARD_IDS.blueprintFragment]: 1,
        [FIVE_BOSS_GAUNTLET_REWARD_IDS.deepCrystal]: 2,
        [FIVE_BOSS_GAUNTLET_REWARD_IDS.firstClearEmblem]: 3,
        [FIVE_BOSS_GAUNTLET_REWARD_IDS.fiveKingCore]: 4,
    }) as Readonly<Record<number, number>>,
})

export interface FiveBossAdditionalRewardDrop {
    group_id: number
    index: number
    number: number
}

/** 把已发放的道具映射成结算页能展示的 additional_reward 引用;没有展示行的道具跳过。 */
export function buildFiveBossAdditionalRewardDrops(
    grantedItems: ReadonlyArray<{ itemId: number, amount: number }>,
): FiveBossAdditionalRewardDrop[] {
    const drops: FiveBossAdditionalRewardDrop[] = []
    for (const item of grantedItems) {
        const index = FIVE_BOSS_GAUNTLET_REWARD_DISPLAY.indexByItemId[item.itemId]
        if (index === undefined || item.amount <= 0) continue
        drops.push({
            group_id: FIVE_BOSS_GAUNTLET_REWARD_DISPLAY.additionalRewardGroupId,
            index,
            number: item.amount,
        })
    }
    return drops
}

/** 终式武装图纸掉率(每次通关独立判定)。 */
export const FIVE_BOSS_BLUEPRINT_DROP_RATE = 0.5

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
    const items: FiveBossGauntletRewardItem[] = []
    // 2026-09-06 作者:「武器图纸也是概率掉吧」→ 图纸改为每次通关 50% 掉 1 张(不随手动倍率翻倍)。
    if (checkedRandomFloat(randomFloat) < FIVE_BOSS_BLUEPRINT_DROP_RATE) {
        items.push({
            itemId: FIVE_BOSS_GAUNTLET_REWARD_IDS.blueprintFragment,
            amount: 1,
            multiplierKind: "fixed",
        })
    }
    items.push({
        itemId: FIVE_BOSS_GAUNTLET_REWARD_IDS.deepCrystal,
        amount: 5 * input.rewardMultiplier,
        multiplierKind: "repeatable",
    })

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
