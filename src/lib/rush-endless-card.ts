/**
 * 深渊连战 30 关跑完弹**原生「无尽战斗」记录卡**所需的服务端字段。
 *
 * ── 机制 ────────────────────────────────────────────────────
 * 客户端 `RushEventQuestLogic.as:345`:
 *     getRushQuestKind() = rushEvent.getQuestFolder(folderId).get_questKind()
 * 是 **folder 级**属性,取自 master `rush_event_quest_folder` 的 c1。
 * `SingleBattleQuestFinishRushEventProcess.as:52-73` 据它分流:
 *     kind=1 → QuestResultRecordKind.Normal
 *     kind=2 → QuestResultRecordKind.RushEventEndless{ highScore, bestElapsedTimeMs,
 *              oldBestElapsedTimeMs, endlessBattleMaxRound, oldEndlessBattleMaxRound, ... }
 * 把 700099 folder 1 的 quest_kind 改成 2,30 关就走后者,原生渲染
 * `RushEventEndlessScoreCardView`(层数 + MM:SS.FF 用时 + 历史最佳 + 破纪录高亮特效)。
 *
 * ── 为什么服务端必须配合 ────────────────────────────────────
 * 服务端的战斗类型判据是 `rushEventRound === 0 ? ENDLESS : FOLDER`,**与 quest_kind 无关**。
 * folder 1 的 30 关轮号是 1..30,所以服务端仍走 FOLDER 分支,而 FOLDER 分支把
 * `high_score` / `best_elapsed_time_ms` / `endless_battle_max_round` 等一律填 null
 * (见 lib/quest/finish/rush-handler.ts)。客户端在 kind=2 下会去读这些字段,
 * 读到 null 记录卡就是空的。
 *
 * 客户端自带的离线 mock `BattleFinishDummyRemoteRushEventProcess.as:109-125` 是权威契约:
 *     kind=1 → high_score / best_elapsed_time_ms 必须是 Option.None
 *     kind=2 → 两者必须是 Option.Some(...)
 * 本模块就是按这份契约,用排行榜的数据把 kind=2 需要的字段补上。
 *
 * ── 映射 ────────────────────────────────────────────────────
 * 第 N 关结算时:
 *   endless_battle_max_round      = 本程已通关层数 N          (卡上的「本次」层数)
 *   old_endless_battle_max_round  = **本程之前**的最佳层数     (卡上的「最佳」层数)
 *   high_score                    = 本程至今各关战斗用时之和   (卡上的「本次」用时)
 *   best_elapsed_time_ms          = 历史最佳战斗用时           (卡上的「最佳」用时)
 *   old_best_elapsed_time_ms      = 本次之前的历史最佳         (决定破纪录特效放不放)
 * 全部走 battleMs(各关 elapsed_time_ms 之和,关间不计),与「战斗用时榜」完全同源。
 * ⚠ 跑到一半时这个数**不再随现实时间走**(旧口径是 Date.now()-startedAtMs)。
 */

import {
    getRushPlayerFullRunsSync,
    rushLeaderboardStore
} from "../data/domains/rushLeaderboard";
import { peekRushSeasonSync } from "./rush-leaderboard-service";

/**
 * 哪些 (事件, folder) 在 master 里被设成了 quest_kind=2。必须与已发布的 master 一致。
 *
 * **默认为空 —— 2026-08-27 真机回归后已停用。**
 * 曾把 700099 folder 1 设成 quest_kind=2 想借原生「无尽战斗」记录卡显示 30 关全程用时,
 * 真机上炸了两处(见 rush-leaderboard-20260827.md 第三十二节):
 *   1. 深渊连战入口只剩「无尽战斗」可点 —— `RushEventLogic.as:348` 按 `questKind == 1`
 *      收集难度列表,folder 1 一翻成 2,700099 就一个 kind=1 folder 都不剩,列表空了;
 *   2. 每层都是同一个 boss —— kind=2 是**无尽模式**:一关反复打 + correction 缩放。
 *      客户端落到 folder 2 的单关 700099099,自然层层同怪。
 * 根因是 `quest_kind` 是 folder 的**模式**,不是「结算卡样式」开关。30 关塔(30 个不同关卡)
 * 和无尽模式(1 关重复)结构上不兼容,不是补服务端字段能弥合的。
 *
 * master 已按字节回滚。这里同步清空:kind=1 下客户端契约要求
 * high_score / best_elapsed_time_ms 必须是 Option.None,继续注入非空值是违约。
 */
const DEFAULT_ENDLESS_CARD_FOLDERS: Record<number, number[]> = {}

/**
 * 允许用环境变量覆盖,免得改 master 还要改代码:
 *   WF_RUSH_ENDLESS_CARD_FOLDERS={"700099":[1]}
 * 设成 {} 可以在不回滚 master 的情况下先把服务端这半边关掉。
 */
function loadEndlessCardFolders(): Record<number, number[]> {
    const raw = (process.env.WF_RUSH_ENDLESS_CARD_FOLDERS ?? "").trim()
    if (raw === "") return DEFAULT_ENDLESS_CARD_FOLDERS
    try {
        const parsed = JSON.parse(raw) as Record<string, unknown>
        const out: Record<number, number[]> = {}
        for (const [key, value] of Object.entries(parsed)) {
            const eventId = Number(key)
            if (!Number.isFinite(eventId) || !Array.isArray(value)) continue
            out[eventId] = value.map(Number).filter(Number.isFinite)
        }
        return out
    } catch {
        console.error("[RUSH-LB] WF_RUSH_ENDLESS_CARD_FOLDERS is not valid JSON; using defaults")
        return DEFAULT_ENDLESS_CARD_FOLDERS
    }
}

// 缓存按环境变量原文取键:既避免每次结算都 JSON.parse,又不会在环境变量变了之后
// 继续用旧值(纯 null 判断的缓存曾让「默认关闭」和「显式开启」互相污染)。
let cachedEnvRaw: string | null = null
let endlessCardFolders: Record<number, number[]> = {}

/**
 * 该 folder 是否被设成了「无尽记录卡」模式(master quest_kind=2)。
 *
 * @param eventId 连战事件 ID。
 * @param folderId folder ID。
 */
export function isEndlessCardFolder(eventId: number, folderId: number): boolean {
    const raw = process.env.WF_RUSH_ENDLESS_CARD_FOLDERS ?? ""
    if (raw !== cachedEnvRaw) {
        cachedEnvRaw = raw
        endlessCardFolders = loadEndlessCardFolders()
    }
    return (endlessCardFolders[eventId] ?? []).includes(folderId)
}

/** 客户端 kind=2 记录卡需要的那组字段。 */
export interface RushEndlessCardFields {
    high_score: number
    best_elapsed_time_ms: number | null
    old_best_elapsed_time_ms: number | null
    endless_battle_max_round: number
    old_endless_battle_max_round: number | null
    endless_battle_next_round: number
}

/**
 * 取该存档在这座塔上的历史最佳战斗用时(各关结算时间之和)。
 *
 * @param eventId 连战事件 ID。
 * @param folderId folder ID。
 * @param playerId 存档 ID。
 * @param excludeRunId 要排除的 run(算「本次之前的最佳」时排掉本程)。
 * @param season 只看这一期;null = 跨期(没有期次台账时)。
 * @returns 最佳战斗用时(ms);当期没有完整成绩则 null。
 */
function bestBattleMs(
    eventId: number,
    folderId: number,
    playerId: number,
    excludeRunId: number | undefined,
    season: number | null
): number | null {
    // 已按 battle_ms 升序排好(getRushPlayerFullRunsSync 的 ORDER BY),取第一条即最佳。
    // 这里刻意查**该存档的全部成绩**而不是去重后的榜:去重榜里本程若是最快的,
    // 历史最佳就整条消失,永远打不破自己。
    // 但要**收在当期内**:重摇成一座更难的塔之后,拿上一座塔的纪录当门槛,
    // 破纪录特效可能永远不再触发(2026-08-28 复核)。
    for (const record of getRushPlayerFullRunsSync(eventId, folderId, playerId, 500, season)) {
        if (excludeRunId !== undefined && record.id === excludeRunId) continue
        return record.battleMs
    }
    return null
}

/**
 * 该存档在这座塔上通关过的最高层数(完整成绩才算)。
 *
 * 和 `bestBattleMs` 一样要能排除本程 —— 客户端拿 old_* 和新值比来决定放不放
 * 破纪录特效,把本程算进「旧纪录」就永远打不破自己。
 *
 * @param excludeRunId 要排除的 run。
 * @param season 只看这一期;null = 跨期(没有期次台账时)。
 */
function bestRoundsCleared(
    eventId: number,
    folderId: number,
    playerId: number,
    excludeRunId: number | undefined,
    season: number | null
): number | null {
    let best: number | null = null
    for (const record of getRushPlayerFullRunsSync(eventId, folderId, playerId, 500, season)) {
        if (excludeRunId !== undefined && record.id === excludeRunId) continue
        if (best === null || record.roundsCleared > best) best = record.roundsCleared
    }
    return best
}

export interface RushEndlessCardInput {
    playerId: number
    eventId: number
    folderId: number
    round: number
    totalRounds: number
    accomplished: boolean
}

/**
 * 造出 kind=2 记录卡要的字段。**必须在排行榜钩子记完这一关之后调用**,
 * 否则「本次」的层数/用时会少算一关。
 *
 * @param input 结算上下文。
 * @returns 字段组;这个 folder 不是记录卡模式、或打输了,返回 null(不覆盖响应)。
 */
export function buildRushEndlessCardFields(
    input: RushEndlessCardInput
): RushEndlessCardFields | null {
    try {
        const { playerId, eventId, folderId, round, totalRounds, accomplished } = input
        if (!accomplished) return null
        if (!isEndlessCardFolder(eventId, folderId)) return null
        if (round <= 0 || totalRounds <= 0) return null

        const isFinalRound = round >= totalRounds
        // 「历史最佳」和榜同一个口径:只看当期(重摇塔 = 换期 = 新的一张空榜)。
        // 没有期次台账时是 null = 跨期,与改造前一致。
        const season = peekRushSeasonSync(eventId)?.season ?? null
        // 打完最终关时 run 已收榜(status=completed),active 查不到了 —— 这时用榜上
        // 刚落地的那条;还在半路则用进行中的 run 算「至今累计」。
        const active = rushLeaderboardStore.getActiveRun(playerId, eventId, folderId)

        let thisRunBattleMs: number
        let thisRunRounds: number
        let thisRunId: number | undefined

        if (active !== null) {
            thisRunId = active.id
            thisRunRounds = active.roundsCleared
            // 2026-08-28 口径:卡上的「本次」= 已通关各关战斗用时之和,不是墙钟。
            // 这也是整份代码里最后一处从实时钟取成绩的地方。
            thisRunBattleMs = active.battleMs
        } else if (isFinalRound) {
            // 刚收榜的那一程 = 该存档 finishedAtMs 最新的一条
            let latest: { id: number, battleMs: number, rounds: number, finishedAtMs: number } | null = null
            for (const record of getRushPlayerFullRunsSync(eventId, folderId, playerId, 500, season)) {
                // battle_ms<=0 的行已被 SQL 挡住,这里只是防御性重申:0 会被客户端
                // 当成 00:00.00 的完美成绩。
                if (record.battleMs <= 0) continue
                if (latest === null || (record.finishedAtMs ?? 0) > latest.finishedAtMs) {
                    latest = {
                        id: record.id,
                        battleMs: record.battleMs,
                        rounds: record.roundsCleared,
                        finishedAtMs: record.finishedAtMs ?? 0
                    }
                }
            }
            if (latest === null) return null
            thisRunId = latest.id
            thisRunRounds = latest.rounds
            thisRunBattleMs = latest.battleMs
        } else {
            return null
        }

        const previousBest = bestBattleMs(eventId, folderId, playerId, thisRunId, season)
        const bestIncludingThis = isFinalRound
            ? (previousBest === null ? thisRunBattleMs : Math.min(previousBest, thisRunBattleMs))
            : previousBest
        const bestRounds = bestRoundsCleared(eventId, folderId, playerId, thisRunId, season)

        return {
            high_score: thisRunBattleMs,
            best_elapsed_time_ms: bestIncludingThis,
            old_best_elapsed_time_ms: previousBest,
            endless_battle_max_round: Math.max(1, thisRunRounds),
            old_endless_battle_max_round: bestRounds,
            // 塔是有限的:打完就没有「下一层」,钳在总关数内免得客户端算出第 31 关
            endless_battle_next_round: Math.min(totalRounds, thisRunRounds + 1)
        }
    } catch (error) {
        console.error("[RUSH-LB] endless card fields failed:", error)
        return null
    }
}
