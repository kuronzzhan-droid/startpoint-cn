import type { MissionSettlementScope } from "../mission/settlement"
import type { PlayerQuestProgress } from "../../data/types"
import type { FinishContext } from "../../lib/quest/finish/types"
import type {
    SingleFinishTransactionArgs,
    SingleFinishTransactionResult,
} from "../quest/finish/single-finish-transaction"

/**
 * Stable command names and their argument shapes.
 *
 * Commands are named here instead of inside the domain modules so callers, the
 * registry and the writer worker can share one literal without importing each
 * other. The domain type import is type-only, so this module stays free of
 * runtime dependencies and cannot create an import cycle.
 */

export const MISSION_SETTLE_CATEGORIES = "mission.settle_categories"

export interface MissionSettleCategoriesArgs {
    playerId: number
    categories: Array<number | MissionSettlementScope>
    evaluationTimeMs: number
}

/**
 * 单人副本结算前的关卡进度刷新。原实现用 runPersistenceTransaction 包裹，
 * 因为深渊最好成绩的刷新是"读+写"；把整段搬进写线程后主线程不再承担它。
 */
export const SINGLE_REFRESH_QUEST_PROGRESS = "single.refresh_quest_progress"

export interface SingleRefreshQuestProgressArgs {
    playerId: number
    section: number | string
    questId: number | string
}

export type SingleRefreshQuestProgressResult = PlayerQuestProgress | null

/** 多人结算后清理本场战斗的进行中关卡记录（单条 DELETE）。 */
export const MULTI_CLEANUP_ACTIVE_QUEST = "multi.cleanup_active_quest"

export interface MultiCleanupActiveQuestArgs {
    playerId: number
    expectedPlayId: string
    /** Completes the durable finish receipt written by the reward transaction. */
    receipt?: { playId: string, response: unknown }
}

/**
 * 多人结算的"战斗事实"事务：任务战斗事实、推荐队伍、蒸气机器人挑战与角色经验。
 * finishCtx 全部由请求体与数据库行组成，是普通数据，可安全跨线程传递。
 */
export const MULTI_RECORD_BATTLE_FACTS = "multi.record_battle_facts"

export interface MultiRecordBattleFactsArgs {
    finishCtx: FinishContext
    partyCharacterIdsArray: number[]
    characterExpReward: number
    fixedParty: boolean
    evaluationTimeMs: number
}

export interface MultiRecordBattleFactsResult {
    missionBattleFacts: unknown
    steamRobotMissionId: number | null
    rewardCharacterExpResult: unknown
}

/**
 * 单人副本 /finish 的完整结算事务体。原先整段闭包在主线程执行，2026-10-03
 * 原样搬进写线程：参数全部是准备与校验阶段产生的派生值（数据库行、master
 * data、请求体、已算好的段位与魔力等），返回值是原来直接回给客户端的响应
 * 对象加上结算体分段计时，两者都是结构化克隆安全的数据。
 */
export const SINGLE_SETTLE_FINISH = "single.settle_finish"

export type SingleSettleFinishArgs = SingleFinishTransactionArgs
export type SingleSettleFinishResult = SingleFinishTransactionResult
