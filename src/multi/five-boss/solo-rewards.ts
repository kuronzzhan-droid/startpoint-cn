import { givePlayerItemSync as givePlayerItemSyncDefault } from "../../data/domains/item"
import { givePlayerEquipmentSync as givePlayerEquipmentSyncDefault } from "../../lib/equipment"
import type { FiveBossSoloStartSnapshot } from "./solo-ledger"
import {
    FiveBossAdditionalRewardDrop,
    buildFiveBossAdditionalRewardDrops,
    buildFiveBossCursedWeaponDropPlan,
    buildFiveBossGauntletRewardPlan,
    buildFiveBossWeaponAdditionalRewardDrops,
    getFiveBossCursedWeaponPool,
} from "./rewards"

export interface FiveBossSoloRewardResult {
    /** item id -> 发放后的持有总数(直接并进 finish 的 item_list) */
    items: Record<number, number>
    /** 结算页展示用 additional_reward 引用(材料 + 诅咒武器) */
    dropAdditionalRewardIds: FiveBossAdditionalRewardDrop[]
    granted: Array<{ itemId: number, amount: number }>
    /** 本次命中的诅咒武器最终状态(clientSerializeEquipment 序列化,按 id 去重取最新一次),直接并进 finish 的 equipment_list。 */
    equipment_list: Object[]
    /** 本次命中的诅咒武器 id 列表,可能有重复(同一把命中两次)。 */
    grantedEquipment: number[]
}

export interface GrantFiveBossSoloRewardsInput {
    playerId: number
    firstClear: boolean
    /** 用 fiveBossSoloRewardMultiplier(开战 Auto 快照) 算出来的 1 或 2。 */
    rewardMultiplier: 1 | 2
    randomFloat?: () => number
    givePlayerItemSync?: (playerId: number, itemId: number, amount: number) => number
    givePlayerEquipmentSync?: (playerId: number, equipmentId: number, amount: number) => Object
    /** 诅咒武器候选池覆盖(测试用);省略时每次结算现读 getFiveBossCursedWeaponPool()。 */
    cursedWeaponPool?: readonly number[]
}

/**
 * 单人五重的倍率,与多人同一口径:全程手动 = 2 倍,否则 1 倍。
 * 输入是 solo-ledger 记的开战快照:开局时 AUTO 已开(auto_at_start)或战斗中开过 AUTO(auto_used)
 * 都算 AUTO 局。快照缺失(重建的 active quest、陈旧行)按 1 倍 fail-closed。
 * 注意:quest/start 的 is_auto_start_mode 是「自动续战」不是 AUTO,不能拿来判倍率。
 */
export function fiveBossSoloRewardMultiplier(
    snapshot: Pick<FiveBossSoloStartSnapshot, "autoAtStart" | "autoUsed"> | null,
): 1 | 2 {
    if (!snapshot) return 1
    return snapshot.autoAtStart || snapshot.autoUsed ? 1 : 2
}

/**
 * 单人打五重决战(2026-09-05 作者:"单人那还是有奖励")的结算发放。
 *
 * 单人 start/finish 走 singleBattleQuest 的普通领主战链路,不经过 five-boss runtime,
 * 所以模式材料(图纸/结晶/证/心核)要在这里按同一张 reward plan 发。
 * 倍率:2026-09-09 作者「单人游玩有门票消耗门票获得奖励且 auto 锁开启也双倍奖励」——
 * 单人从固定 1 倍改成与多人同款:手动开局(Auto 锁生效)2 倍、Auto 开局 1 倍。
 * 调用方只在真的扣掉了凭证时才调用本函数(没票 = 不发)。
 */
export function grantFiveBossSoloRewardsSync(input: GrantFiveBossSoloRewardsInput): FiveBossSoloRewardResult {
    const give = input.givePlayerItemSync ?? givePlayerItemSyncDefault
    const giveEquipment = input.givePlayerEquipmentSync ?? givePlayerEquipmentSyncDefault
    const plan = buildFiveBossGauntletRewardPlan({
        firstClear: input.firstClear,
        rewardMultiplier: input.rewardMultiplier,
        randomFloat: input.randomFloat,
    })
    const items: Record<number, number> = {}
    const granted: Array<{ itemId: number, amount: number }> = []
    for (const item of plan.items) {
        if (item.amount <= 0) continue
        items[item.itemId] = give(input.playerId, item.itemId, item.amount)
        granted.push({ itemId: item.itemId, amount: item.amount })
    }

    // 2026-09-28 设计稿第 5 节:诅咒武器本体随机掉落,与多人 battle-runtime.ts 同一口径
    // (同一次结算延续材料用过的 randomFloat 序列,先材料后武器)。
    const weaponPlan = buildFiveBossCursedWeaponDropPlan({
        rewardMultiplier: input.rewardMultiplier,
        availableEquipmentIds: input.cursedWeaponPool ?? getFiveBossCursedWeaponPool(),
        randomFloat: input.randomFloat,
    })
    const latestEquipmentStateById = new Map<number, Object>()
    for (const equipmentId of weaponPlan.equipmentIds) {
        latestEquipmentStateById.set(equipmentId, giveEquipment(input.playerId, equipmentId, 1))
    }

    return {
        items,
        dropAdditionalRewardIds: [
            ...buildFiveBossAdditionalRewardDrops(granted),
            ...buildFiveBossWeaponAdditionalRewardDrops(weaponPlan.equipmentIds),
        ],
        granted,
        equipment_list: Array.from(latestEquipmentStateById.values()),
        grantedEquipment: weaponPlan.equipmentIds,
    }
}
