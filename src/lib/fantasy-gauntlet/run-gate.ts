import { getDb } from "../../data/db"
import { PartyCategory, RushEventBattleType } from "../../data/types"
import { QuestCategory } from "../types"
import {
    FANTASY_BOSS_STAGES,
    FANTASY_EXCLUSIVE_EQUIPMENT_IDS,
    FANTASY_GAUNTLET,
    getFantasyQuestRef,
} from "./contract"


export interface FantasyRunGate {
    readonly allowed: boolean
    /** 请求的关号;不是幻想连战的关则为 null。 */
    readonly stage: number | null
    /** 这个存档当前应该打的关号(1..15)。 */
    readonly expectedStage: number
}


/**
 * 这个存档当前该打第几关。
 *
 * 判据是 **played-party 标记条数**,不是永久通关记录:客户端的有限 folder 也是
 * 按这张表推进的(`getRushBattleRound() = 列表长度 + 1`),两边必须同源,
 * 否则「重置后从第一关重打」在服务端和客户端会给出不同的关号。
 *
 * 15 条全在 ⇒ 这一轮已经打完,下一轮从第 1 关开始。
 *
 * @param playerId 存档 ID。
 * @returns 1..15。
 */
export function getExpectedFantasyStageSync(playerId: number): number {
    const progress = getDb().prepare(`
        SELECT COUNT(*) AS cleared_stage_count
        FROM players_rush_events_played_parties
        WHERE player_id = ?
          AND event_id = ?
          AND battle_type = ?
          AND round BETWEEN ? AND ?
    `).get(
        playerId,
        FANTASY_GAUNTLET.rushEventId,
        RushEventBattleType.FOLDER,
        FANTASY_GAUNTLET.rushEventId * 1000 + 1,
        FANTASY_GAUNTLET.rushEventId * 1000 + FANTASY_GAUNTLET.finalStage,
    ) as { cleared_stage_count?: number } | undefined

    const clearedStageCount = Math.max(0, Math.min(
        FANTASY_GAUNTLET.finalStage,
        Number(progress?.cleared_stage_count ?? 0),
    ))
    return clearedStageCount >= FANTASY_GAUNTLET.finalStage ? 1 : clearedStageCount + 1
}


/**
 * 顺序门:只有「当前该打的那一关」可以开打。
 *
 * @param playerId 存档 ID。
 * @param category 关卡分类。
 * @param questId 关卡 ID。
 * @returns 判定结果;不是幻想连战的关一律 allowed=false(调用方自己先过滤)。
 */
export function canStartFantasyQuestSync(
    playerId: number,
    category: number,
    questId: number,
): FantasyRunGate {
    const ref = getFantasyQuestRef(category, questId)
    const expectedStage = getExpectedFantasyStageSync(playerId)
    return {
        allowed: ref !== null && ref.stage === expectedStage,
        stage: ref?.stage ?? null,
        expectedStage,
    }
}


/**
 * 救援客人不是这间房的主人。
 *
 * 他们可以反复来帮忙打任意一个 boss 关,一次性顺序门只对房主生效;
 * 奖励照发,但**不推进他们自己的进度**(见 settleFantasyBattleSync 的 rescue 分支)。
 *
 * @param playerId 存档 ID。
 * @param category 关卡分类。
 * @param questId 关卡 ID。
 * @returns 判定结果。
 */
export function canJoinFantasyRescueSync(
    playerId: number,
    category: number,
    questId: number,
): FantasyRunGate {
    const ref = getFantasyQuestRef(category, questId)
    const expectedStage = getExpectedFantasyStageSync(playerId)
    if (ref === null) return { allowed: false, stage: null, expectedStage }
    return { allowed: true, stage: ref.stage, expectedStage }
}


/**
 * 只重置「这一轮的进度」,代币余额与商店购买历史一概保留。
 *
 * 触及的行**全部**限定在 700098 / 300098:
 *  · players_quest_progress 只删 300098001..300098003(多人 boss 的可见性链);
 *  · played parties / cleared folders 只删 event_id = 700098;
 *  · players_rush_events 只 upsert (playerId, 700098)。
 * 深渊连战 700099 的任何一行都不在范围内。
 *
 * Rush 侧的 700098001..015 通关记录**刻意保留**:原生 EventFolder 的
 * 「已完成」页读的就是那些行,而当期顺序由 played-party 标记决定。
 *
 * @param playerId 存档 ID。
 */
export function resetFantasyRunSync(playerId: number): void {
    getDb().transaction(() => {
        getDb().prepare(`
            DELETE FROM players_quest_progress
            WHERE player_id = ?
              AND section IN (?, ?)
              AND quest_id BETWEEN ? AND ?
        `).run(
            playerId,
            Number(QuestCategory.ADVENT_EVENT_SINGLE),
            Number(QuestCategory.ADVENT_EVENT_MULTI),
            FANTASY_GAUNTLET.multiEventId * 1000 + 1,
            FANTASY_GAUNTLET.multiEventId * 1000 + FANTASY_BOSS_STAGES.length,
        )
        getDb().prepare(`
            DELETE FROM players_rush_events_played_parties
            WHERE player_id = ? AND event_id = ?
        `).run(playerId, FANTASY_GAUNTLET.rushEventId)
        getDb().prepare(`
            DELETE FROM players_rush_events_cleared_folders
            WHERE player_id = ? AND event_id = ?
        `).run(playerId, FANTASY_GAUNTLET.rushEventId)
        // 重置后把幻想 folder 保持在选中状态:打完一关的客户端是直接回到
        // RushEventQuestSelect 的,不会再走一次 /select_folder。active folder
        // 为 null 时旧客户端会停在已通关的第一关上。
        getDb().prepare(`
            INSERT INTO players_rush_events (
                player_id,
                event_id,
                active_rush_battle_folder_id,
                endless_battle_max_round,
                endless_battle_max_round_time,
                endless_battle_max_round_character_id_1,
                endless_battle_max_round_character_id_2,
                endless_battle_max_round_character_id_3,
                endless_battle_max_round_character_evolution_img_lvl_1,
                endless_battle_max_round_character_evolution_img_lvl_2,
                endless_battle_max_round_character_evolution_img_lvl_3
            ) VALUES (?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL)
            ON CONFLICT(player_id, event_id) DO UPDATE SET
                active_rush_battle_folder_id = excluded.active_rush_battle_folder_id,
                endless_battle_max_round = NULL,
                endless_battle_max_round_time = NULL,
                endless_battle_max_round_character_id_1 = NULL,
                endless_battle_max_round_character_id_2 = NULL,
                endless_battle_max_round_character_id_3 = NULL,
                endless_battle_max_round_character_evolution_img_lvl_1 = NULL,
                endless_battle_max_round_character_evolution_img_lvl_2 = NULL,
                endless_battle_max_round_character_evolution_img_lvl_3 = NULL
        `).run(
            playerId,
            FANTASY_GAUNTLET.rushEventId,
            FANTASY_GAUNTLET.rushFolderId,
        )
    })()
}


/**
 * 查某个存档的某一组编队里带了哪些幻想连战专属装备。
 *
 * @param playerId 存档 ID。
 * @param category 编队分类(连战用 {@link PartyCategory.EVENT})。
 * @param groupId 编队组 ID。
 * @param slot 组内槽位;null 表示整组一起查。
 * @returns 命中的专属装备 ID(去重)。
 */
export function getFantasyExclusivePartyItemsSync(
    playerId: number,
    category: number,
    groupId: number,
    slot: number | null = null,
): number[] {
    const clauses = ["player_id = ?", "category = ?", "group_id = ?"]
    const args: number[] = [playerId, category, groupId]
    if (slot !== null) {
        clauses.push("slot = ?")
        args.push(slot)
    }
    const rows = getDb().prepare(`
        SELECT equipment_1, equipment_2, equipment_3,
               ability_soul_1, ability_soul_2, ability_soul_3
        FROM players_parties
        WHERE ${clauses.join(" AND ")}
    `).all(...args) as Array<Record<string, number | null>>

    const restricted = new Set(FANTASY_EXCLUSIVE_EQUIPMENT_IDS)
    return [...new Set(rows.flatMap(row => Object.values(row)
        .map(Number)
        .filter(id => restricted.has(id))))]
}


/**
 * 连战侧的编队号换算:`party_id = (groupId - 1) * 10 + slot`
 * (与 {@link serializeRushPartyGroups} 的下发口径同源)。
 *
 * @param playerId 存档 ID。
 * @param category 编队分类。
 * @param partyId 客户端发上来的编队号。
 * @returns 命中的专属装备 ID。
 */
export function getFantasyExclusiveGlobalPartyItemsSync(
    playerId: number,
    category: number,
    partyId: number,
): number[] {
    if (!Number.isInteger(partyId) || partyId < 1 || partyId > 120) return []
    const groupId = Math.floor((partyId - 1) / 10) + 1
    const slot = ((partyId - 1) % 10) + 1
    return getFantasyExclusivePartyItemsSync(playerId, category, groupId, slot)
}


/** 连战编队用的分类(我方 rush 走 EVENT,灰那边叫 RUSH)。 */
export const FANTASY_RUSH_PARTY_CATEGORY = PartyCategory.EVENT
