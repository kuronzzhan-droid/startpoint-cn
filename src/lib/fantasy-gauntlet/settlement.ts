import { getDb } from "../../data/db"
import type { PlayerRushEventPlayedParty } from "../../data/types"
import { RushEventBattleType } from "../../data/types"
import { givePlayerRewardsSync } from "../quest"
import { PlayerRewardResult, QuestCategory, Reward, RewardType } from "../types"
import {
    FANTASY_BOSS_TOKEN_REWARDS,
    FANTASY_GAUNTLET,
    getFantasyQuestRef,
} from "./contract"
import { repairFantasyCompletionClassificationSync } from "./completion"
import { resetFantasyRunSync } from "./run-gate"


interface FantasyFixedItemReward {
    readonly id: number
    readonly count: number
}


const ELEMENT_TIER_1 = [1, 5, 9, 13, 42, 46] as const
const ELEMENT_TIER_2 = [2, 6, 10, 14, 43, 47] as const
const ELEMENT_TIER_3 = [3, 7, 11, 15, 44, 48] as const
const ELEMENT_TIER_4 = [4, 8, 12, 16, 45, 49] as const
const ETHER_TIER_1 = [50, 53, 56, 59, 62, 65] as const
const ETHER_TIER_2 = [51, 54, 57, 60, 63, 66] as const
const ETHER_TIER_3 = [52, 55, 58, 61, 64, 67] as const


function itemSet(ids: readonly number[], count: number): FantasyFixedItemReward[] {
    return ids.map(id => ({ id, count }))
}


/**
 * 单人关的固定素材奖励,按**显示关号**索引。
 *
 * 刻意不按 boss/field 索引:关卡内容可以随时重排,奖励表不该跟着动。
 * 5/10/15 三个 boss 关走另一套代币结算,不在这张表里。
 */
export const FANTASY_SOLO_FIXED_REWARDS:
    Readonly<Record<number, readonly FantasyFixedItemReward[]>> = Object.freeze({
        1: itemSet(ELEMENT_TIER_1, 100),
        2: itemSet(ELEMENT_TIER_1, 150),
        3: itemSet(ELEMENT_TIER_2, 100),
        4: [...itemSet(ELEMENT_TIER_2, 150),
            { id: FANTASY_GAUNTLET.dreamEmblemItemId, count: 5 }],
        6: itemSet(ELEMENT_TIER_3, 75),
        7: itemSet(ETHER_TIER_1, 50),
        8: [...itemSet(ELEMENT_TIER_3, 125), ...itemSet(ETHER_TIER_1, 50)],
        9: [...itemSet(ETHER_TIER_2, 50),
            { id: FANTASY_GAUNTLET.dreamEmblemItemId, count: 10 }],
        11: [...itemSet(ELEMENT_TIER_4, 50), ...itemSet(ETHER_TIER_1, 100)],
        12: itemSet(ETHER_TIER_2, 75),
        13: [...itemSet(ELEMENT_TIER_4, 100), ...itemSet(ETHER_TIER_3, 50)],
        14: [
            ...itemSet(ETHER_TIER_1, 100),
            ...itemSet(ETHER_TIER_2, 75),
            ...itemSet(ETHER_TIER_3, 50),
            { id: FANTASY_GAUNTLET.dreamEmblemItemId, count: 15 },
        ],
    })


/** 全 15 关通关的一次性奖励(每一轮都发,不是终身一次)。 */
export const FANTASY_FULL_CLEAR_REWARDS: readonly FantasyFixedItemReward[] =
    Object.freeze([
        { id: FANTASY_GAUNTLET.dreamEmblemItemId, count: 200 },
        { id: FANTASY_GAUNTLET.fullClearTokenItemId, count: 1 },
    ])


export interface FantasyAdditionalRewardEntry {
    group_id: number
    index: number
    number: number
}


export interface FantasySettlementResult extends PlayerRewardResult {
    /** 客户端结算面板用的 additional reward 条目。 */
    fantasy_additional_reward_ids: FantasyAdditionalRewardEntry[]
    /** 本次结算的显示关号。 */
    stage: number
    /** 本次是否构成整轮全通(会顺带重置这一轮)。 */
    fullClear: boolean
    /** 本次发放的幻想代币数量。 */
    tokenAmount: number
}


export interface FantasySettlementOptions {
    /** 救援客人:发奖但不推进自己的进度,也不因失败而重置。 */
    rescue?: boolean
    /** 多人 boss 关的出战队伍,用于补写 folder 标记。 */
    playedParty?: Omit<PlayerRushEventPlayedParty, "round" | "battleType">
}


const EMPTY_REWARD_RESULT: PlayerRewardResult = {
    user_info: { free_mana: 0, free_vmoney: 0, exp_pool: 0 },
    character_list: [],
    joined_character_id_list: [],
    equipment_list: [],
    items: {},
}


/** 三个槽位补齐成 null,避免 better-sqlite3 因参数个数不符而抛。 */
function normalizeSlots(
    values: readonly (number | null)[] | undefined,
): (number | null)[] {
    return [0, 1, 2].map(index => {
        const value = values?.[index]
        return value === undefined || value === null ? null : Number(value)
    })
}


/**
 * folder 的可见性由 played-party 行驱动,而不是普通的通关记录。
 *
 * 单人关结算会自然写出这些行;多人 boss 打完之后必须由服务端补一条等价标记,
 * 否则原生 Rush 页永远停在这一关。
 */
function recordFantasyBossRushRoundSync(
    playerId: number,
    stage: number,
    playedParty: Omit<PlayerRushEventPlayedParty, "round" | "battleType">,
): void {
    getDb().prepare(`
        INSERT OR REPLACE INTO players_rush_events_played_parties (
            character_id_1, character_id_2, character_id_3,
            unison_character_id_1, unison_character_id_2, unison_character_id_3,
            equipment_id_1, equipment_id_2, equipment_id_3,
            ability_soul_id_1, ability_soul_id_2, ability_soul_id_3,
            evolution_img_level_1, evolution_img_level_2, evolution_img_level_3,
            unison_evolution_img_level_1, unison_evolution_img_level_2,
            unison_evolution_img_level_3,
            player_id, event_id, round, battle_type
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        ...normalizeSlots(playedParty.characterIds),
        ...normalizeSlots(playedParty.unisonCharacterIds),
        ...normalizeSlots(playedParty.equipmentIds),
        ...normalizeSlots(playedParty.abilitySoulIds),
        ...normalizeSlots(playedParty.evolutionImgLevels),
        ...normalizeSlots(playedParty.unisonEvolutionImgLevels),
        playerId,
        FANTASY_GAUNTLET.rushEventId,
        FANTASY_GAUNTLET.rushEventId * 1000 + stage,
        RushEventBattleType.FOLDER,
    )
}


/**
 * 多人 boss 打完之后,把 Rush 侧的同号占位关标记成已通关。
 *
 * 列表与我方 players_quest_progress 的实际表结构对齐(方案 A):灰那份带
 * host_finished / s_plus_reward_received 两列,我方没有,照抄会在运行期炸 SQL。
 */
function completeFantasyRushPlaceholderSync(playerId: number, stage: number): void {
    getDb().prepare(`
        INSERT INTO players_quest_progress (
            section, quest_id, finished, unlocked,
            high_score, clear_rank, best_elapsed_time_ms,
            leader_character_id, multi_clear_count, player_id
        ) VALUES (?, ?, 1, 1, NULL, 5, NULL, NULL, 0, ?)
        ON CONFLICT(section, quest_id, player_id) DO UPDATE SET
            finished = 1,
            unlocked = 1,
            clear_rank = MAX(COALESCE(players_quest_progress.clear_rank, 0), 5)
    `).run(
        Number(QuestCategory.RUSH_EVENT),
        FANTASY_GAUNTLET.rushEventId * 1000 + stage,
        playerId,
    )
}


/**
 * 幻想连战的跨事件结算。**在普通关卡结算写完通关记录之后**调用。
 *
 * 单人关发按关号编排的固定素材;boss 关发幻想代币;第 15 关(且不是救援)
 * 构成全通,额外发梦幻纹章 ×200 与究极图腾 ×1,并把这一轮重置回第 1 关。
 *
 * 全通奖励只在这里发一份:原生 folder 通关路径已被
 * FANTASY_GAUNTLET.folderRoundSentinel 顶到第 16 轮,永不触发(A13)。
 *
 * @param playerId 存档 ID。
 * @param category 关卡分类。
 * @param questId 关卡 ID。
 * @param accomplished 是否通关。
 * @param options 结算选项。
 * @returns 结算结果;不是幻想连战的关或失败时为 null。
 */
export function settleFantasyBattleSync(
    playerId: number,
    category: number,
    questId: number,
    accomplished: boolean,
    options: FantasySettlementOptions = {},
): FantasySettlementResult | null {
    const ref = getFantasyQuestRef(category, questId)
    if (ref === null) return null

    const rescue = options.rescue === true

    if (!accomplished) {
        // 失败 = 这一轮作废,从第 1 关重来。救援客人不拥有这间房的进度,
        // 他们的失败不该把自己的进度清掉。
        if (!rescue) resetFantasyRunSync(playerId)
        console.log(`[FANTASY] failed: player=${playerId} stage=${ref.stage} rescue=${rescue}`)
        return null
    }

    const tokenAmount = FANTASY_BOSS_TOKEN_REWARDS[ref.stage] ?? 0
    const fullClear = ref.stage === FANTASY_GAUNTLET.finalStage && !rescue
    const soloRewards = !ref.isMulti && !rescue
        ? FANTASY_SOLO_FIXED_REWARDS[ref.stage] ?? []
        : []

    const rewards: Reward[] = []
    for (const drop of soloRewards) {
        rewards.push({ type: RewardType.ITEM, id: drop.id, count: drop.count } as Reward)
    }
    if (tokenAmount > 0) {
        rewards.push({
            type: RewardType.ITEM,
            id: FANTASY_GAUNTLET.tokenItemId,
            count: tokenAmount,
        } as Reward)
    }
    if (fullClear) {
        for (const drop of FANTASY_FULL_CLEAR_REWARDS) {
            rewards.push({ type: RewardType.ITEM, id: drop.id, count: drop.count } as Reward)
        }
    }

    const granted = rewards.length === 0
        ? EMPTY_REWARD_RESULT
        : givePlayerRewardsSync(playerId, rewards) ?? EMPTY_REWARD_RESULT

    const result: FantasySettlementResult = {
        ...granted,
        fantasy_additional_reward_ids: [],
        stage: ref.stage,
        fullClear,
        tokenAmount,
    }

    if (soloRewards.length > 0) {
        const groupId = FANTASY_GAUNTLET.soloRewardGroupBaseId + ref.stage
        result.fantasy_additional_reward_ids.push(...soloRewards.map((drop, index) => ({
            group_id: groupId,
            index: index + 1,
            number: drop.count,
        })))
    }
    if (tokenAmount > 0) {
        result.fantasy_additional_reward_ids.push({
            group_id: FANTASY_GAUNTLET.bossTokenRewardGroupId,
            index: 1,
            number: tokenAmount,
        })
    }
    if (fullClear) {
        result.fantasy_additional_reward_ids.push(
            ...FANTASY_FULL_CLEAR_REWARDS.map((drop, index) => ({
                group_id: FANTASY_GAUNTLET.fullClearRewardGroupId,
                index: index + 1,
                number: drop.count,
            })),
        )
    }

    if (ref.isMulti && !rescue) {
        completeFantasyRushPlaceholderSync(playerId, ref.stage)
        // 每一条 folder 标记都要有真实的成员头像。结算包里没有队伍时宁可**不写**
        // 这条标记 —— 空行会让 Rush 页当场 C8601,比缺一条标记糟糕得多。
        if (options.playedParty?.characterIds?.some(
            id => id !== null && id !== undefined,
        )) {
            recordFantasyBossRushRoundSync(playerId, ref.stage, options.playedParty)
        } else {
            console.warn(
                `[FANTASY] skipped empty boss party marker: player=${playerId} stage=${ref.stage}`,
            )
        }
    }

    if (fullClear) {
        repairFantasyCompletionClassificationSync(playerId)
        resetFantasyRunSync(playerId)
        console.log(
            `[FANTASY] completed: player=${playerId} token=${tokenAmount}; reset to stage 1`,
        )
    } else {
        console.log(
            `[FANTASY] cleared: player=${playerId} stage=${ref.stage}`
            + ` token=${tokenAmount} rescue=${rescue}`,
        )
    }
    return result
}
