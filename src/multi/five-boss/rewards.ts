import equipmentIdsTable from "../../../assets/equipment_ids.json"

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

/**
 * 终式武装图纸掉率(每次通关独立判定,不随手动倍率翻倍)。
 * 2026-09-06 作者首定为 50%;2026-09-28《五重决战重做设计》第 5 节改为 60%。
 */
export const FIVE_BOSS_BLUEPRINT_DROP_RATE = 0.6

/**
 * 诅咒武器本体随机掉落命中率(每次掷骰独立判定,掷骰次数 = rewardMultiplier)。
 * 2026-09-28 设计稿定 15%;同日作者裁定诅咒武器以武器扭蛋 990003 为主,五重直掉降到 5%。
 */
export const FIVE_BOSS_CURSED_WEAPON_DROP_RATE = 0.05

/** 诅咒武器池 id 区间:5910101..5910129(29 把),index = equipmentId - base。 */
export const FIVE_BOSS_CURSED_WEAPON_ID_BASE = 5910100
export const FIVE_BOSS_CURSED_WEAPON_POOL_SIZE = 29

const FIVE_BOSS_CURSED_WEAPON_CANDIDATE_IDS: readonly number[] = Object.freeze(
    Array.from(
        { length: FIVE_BOSS_CURSED_WEAPON_POOL_SIZE },
        (_, index) => FIVE_BOSS_CURSED_WEAPON_ID_BASE + 1 + index,
    ),
)

/**
 * 诅咒武器掉落展示:客户端 additional_reward 组 590010001,index = equipmentId - 5910100(1..29)。
 * 行内容(kind=1 Equipment)由数据侧另行发布到 master/reward/event/additional_reward.orderedmap,
 * 与材料组 590010000 并列,不在本次服务端改动范围。
 */
export const FIVE_BOSS_CURSED_WEAPON_REWARD_DISPLAY = Object.freeze({
    additionalRewardGroupId: 590010001,
})

/**
 * 按服务端 equipment_ids.json 白名单过滤诅咒武器候选池(该 JSON 随服务端启动静态导入,
 * 诅咒武器/PARADOX 施工会话增删武器登记后需重启服务端才生效),防止掉出一个服务端
 * 根本不认的装备 id(不存在会在 givePlayerEquipmentSync 里静默建一条脏记录)。
 * 池为空(例如全部武器暂时下架)时调用方应直接跳过掉落,不抛错。
 */
export function getFiveBossCursedWeaponPool(): number[] {
    const known = new Set(equipmentIdsTable as number[])
    return FIVE_BOSS_CURSED_WEAPON_CANDIDATE_IDS.filter(id => known.has(id))
}

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
    // 2026-09-06 作者:「武器图纸也是概率掉吧」→ 图纸按 FIVE_BOSS_BLUEPRINT_DROP_RATE 概率掉 1 张
    // (不随手动倍率翻倍);2026-09-28 设计稿把掉率从 50% 提到 60%。
    if (checkedRandomFloat(randomFloat) < FIVE_BOSS_BLUEPRINT_DROP_RATE) {
        items.push({
            itemId: FIVE_BOSS_GAUNTLET_REWARD_IDS.blueprintFragment,
            amount: 1,
            multiplierKind: "fixed",
        })
    }
    // 2026-09-28 设计稿第 5 节:结晶 5→10 × 倍率。
    items.push({
        itemId: FIVE_BOSS_GAUNTLET_REWARD_IDS.deepCrystal,
        amount: 10 * input.rewardMultiplier,
        multiplierKind: "repeatable",
    })

    if (input.firstClear) {
        items.push({
            itemId: FIVE_BOSS_GAUNTLET_REWARD_IDS.firstClearEmblem,
            amount: 1,
            multiplierKind: "fixed",
        })
    }
    // 2026-09-28 设计稿第 5 节:心核改为「必掉 1 × 倍率 + 25% 额外 1 × 倍率」,合并成一条 amount
    // (旧版是纯 25% 判定,不中则整条奖励缺席;新版保底,只有加成部分是概率的)。
    let fiveKingCoreAmount = input.rewardMultiplier
    if (checkedRandomFloat(randomFloat) < 0.25) {
        fiveKingCoreAmount += input.rewardMultiplier
    }
    items.push({
        itemId: FIVE_BOSS_GAUNTLET_REWARD_IDS.fiveKingCore,
        amount: fiveKingCoreAmount,
        multiplierKind: "repeatable",
    })

    return { items }
}


export interface BuildFiveBossCursedWeaponDropPlanInput {
    rewardMultiplier: 1 | 2
    /** 候选池(已按 equipment_ids.json 过滤);空数组表示当前无武器可掉。 */
    availableEquipmentIds: readonly number[]
    randomFloat?: () => number
}

export interface FiveBossCursedWeaponDropPlan {
    /** 本次结算命中的诅咒武器 id 列表,顺序 = 掷骰顺序,可能有重复(同一把武器命中两次)。 */
    equipmentIds: number[]
}

/**
 * 诅咒武器本体随机掉落(2026-09-28 设计稿第 5 节新增)。掷骰次数 = rewardMultiplier
 * (手动局 2 次、AUTO 局 1 次),每次独立 FIVE_BOSS_CURSED_WEAPON_DROP_RATE 命中;
 * 命中则从候选池均匀抽 1 把,发 1 件。纯函数,不做任何发放 I/O,随机源可注入以保证测试确定。
 */
export function buildFiveBossCursedWeaponDropPlan(
    input: BuildFiveBossCursedWeaponDropPlanInput,
): FiveBossCursedWeaponDropPlan {
    if (input.rewardMultiplier !== 1 && input.rewardMultiplier !== 2) {
        throw new RangeError("rewardMultiplier must be 1 or 2")
    }
    if (!Array.isArray(input.availableEquipmentIds)) {
        throw new TypeError("availableEquipmentIds must be an array")
    }

    const randomFloat = input.randomFloat ?? Math.random
    const equipmentIds: number[] = []
    if (input.availableEquipmentIds.length > 0) {
        for (let roll = 0; roll < input.rewardMultiplier; roll++) {
            if (checkedRandomFloat(randomFloat) < FIVE_BOSS_CURSED_WEAPON_DROP_RATE) {
                const pickIndex = Math.min(
                    input.availableEquipmentIds.length - 1,
                    Math.floor(checkedRandomFloat(randomFloat) * input.availableEquipmentIds.length),
                )
                equipmentIds.push(input.availableEquipmentIds[pickIndex])
            }
        }
    }
    return { equipmentIds }
}


/** 每把掉落的诅咒武器各自一条结算页展示行(kind=1 Equipment,组 590010001)。 */
export function buildFiveBossWeaponAdditionalRewardDrops(
    grantedEquipmentIds: ReadonlyArray<number>,
): FiveBossAdditionalRewardDrop[] {
    return grantedEquipmentIds.map(equipmentId => ({
        group_id: FIVE_BOSS_CURSED_WEAPON_REWARD_DISPLAY.additionalRewardGroupId,
        index: equipmentId - FIVE_BOSS_CURSED_WEAPON_ID_BASE,
        number: 1,
    }))
}
