import { givePlayerItemSync as givePlayerItemSyncDefault } from "../../data/domains/item"
import {
    FiveBossAdditionalRewardDrop,
    buildFiveBossAdditionalRewardDrops,
    buildFiveBossGauntletRewardPlan,
} from "./rewards"

export interface FiveBossSoloRewardResult {
    /** item id -> 发放后的持有总数(直接并进 finish 的 item_list) */
    items: Record<number, number>
    /** 结算页展示用 additional_reward 引用 */
    dropAdditionalRewardIds: FiveBossAdditionalRewardDrop[]
    granted: Array<{ itemId: number, amount: number }>
}

export interface GrantFiveBossSoloRewardsInput {
    playerId: number
    firstClear: boolean
    randomFloat?: () => number
    givePlayerItemSync?: (playerId: number, itemId: number, amount: number) => number
}

/**
 * 单人打五重决战(2026-09-05 作者:"单人那还是有奖励")的结算发放。
 *
 * 单人 start/finish 走 singleBattleQuest 的普通领主战链路,不经过 five-boss runtime,
 * 所以模式材料(图纸/结晶/证/心核)要在这里按同一张 reward plan 发,倍率固定 1
 * (单人没有 AUTO 关闭双倍那套 boost 语义)。
 */
export function grantFiveBossSoloRewardsSync(input: GrantFiveBossSoloRewardsInput): FiveBossSoloRewardResult {
    const give = input.givePlayerItemSync ?? givePlayerItemSyncDefault
    const plan = buildFiveBossGauntletRewardPlan({
        firstClear: input.firstClear,
        rewardMultiplier: 1,
        randomFloat: input.randomFloat,
    })
    const items: Record<number, number> = {}
    const granted: Array<{ itemId: number, amount: number }> = []
    for (const item of plan.items) {
        if (item.amount <= 0) continue
        items[item.itemId] = give(input.playerId, item.itemId, item.amount)
        granted.push({ itemId: item.itemId, amount: item.amount })
    }
    return {
        items,
        dropAdditionalRewardIds: buildFiveBossAdditionalRewardDrops(granted),
        granted,
    }
}
