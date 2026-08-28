/**
 * 把两张自制榜接到客户端**排名活动(RankingEvent)**界面上。
 *
 * ── 为什么是这个界面 ────────────────────────────────────────────
 * 逆向 CN 客户端(弹国服/scripts,ffdec AS3 产物)的结论:
 *
 *  1. **客户端根本没有「连战玩家排行榜」界面。** `pinball/scene/event/rush/ranking/`
 *     下只有 `party/`,那是「战斗履历与重置」编队页(按钮贴图
 *     `bitmap_text-assets/battle_history_and_reset`),行里只有「第 N 回合」+ 九个
 *     缩略图,没有玩家名/名次/数值列。
 *  2. 全库 grep `rush_event/ranking` / `event/rush/ranking`:**零命中**。客户端的
 *     rush 端点只有 summary / party / select_folder / battle_start / reset /
 *     reward / endless_battle 七个。服务端里那个 `/event/rush/ranking` 处理器
 *     客户端**永远不会调**(线上日志佐证:开服至今 0 次调用)。
 *  3. `event/rush/reward` 的 `rank_number` 客户端收下了但**零处读取**。
 *  4. `SceneKind` 全表里带 Rank 的场景只有 RankingEventQuestSelect(Loading) 和
 *     RushEventRankingParty 三个 —— 穷举证明没有别的榜可用。
 *
 * 唯一「数值列天生是时间」的界面是**排名活动**:
 *   - `ranking_event/get_summary` 的 `best_record.elapsed_time_ms` 是毫秒;
 *   - `RankingEventYourTimeRecordView` 用 `formatToSeparatedMMSSFF` 渲染成
 *     MM:SS.FF 秒表(布局里有独立的 minute/second/centisecond 文本槽);
 *   - `rank_border_top.elapsed_time_ms` 天生就是「再快多少能上一档」。
 * 正好就是竞速榜要的三件套,且**一行客户端代码都不用改**。
 *
 * ── 现状:默认停用 ────────────────────────────────────────────
 * 曾把官方的 1000/1001(云水试炼-复刻 / 溢光试炼复刻)征用成两张榜的门面,
 * 作者不要那两个常驻 banner —— master 已按字节还原,`DEFAULT_BINDINGS` 也清空了。
 * 本文件保留为**可用但未启用**的通路(见 `WF_RUSH_BOARD_RANKING_EVENTS`)。
 *
 * ── 补记(作者纠正后的复查)─────────────────────────────────
 * 作者指出官方「狂热激战」有玩家层数排行榜。复查确认他说的模式确实存在,
 * 但**渲染玩家名次列表的场景不在这个 APK 构建里**:
 *   - 「无尽战斗」是 folder 级模式:`rush_event_quest_folder.quest_kind = 2`
 *     (官方 700007 的 folder 4;深渊连战 700099 的 folder 2 **已经有**),
 *     它走 `QuestResultRecordKind.RushEventEndless`,原生显示层数/用时记录卡。
 *   - 但 `rush_event_ranking_aggregation_schedule` 和 `rush_event_ranking_reward`
 *     两张 master 表虽然在 boot 注册表里(498 张之一)被加载,**全库零处读取**;
 *     `SceneKind` 全表 193 个场景里没有任何玩家名次列表场景。
 * 结论:排行榜功能在官方运营期存在(700001~700007 都有 ranking_reward 行就是指纹),
 * 但这一版客户端把那个界面裁掉了,数据表成了死重。不改 APK 就做不出玩家名次列表。
 */

import type { RushRankingBoard } from "./rush-leaderboard-ranking";
import {
    getRushBoardRecordsSync,
    getRushRankingMyRowSync
} from "./rush-leaderboard-ranking";
import type { RushRunRecord } from "../data/domains/rushLeaderboard";
import { QuestCategory } from "./types";
import { getPlayerSync } from "../data/domains/player";

/** 一个排名活动 id 绑定到哪张榜。 */
export interface RushBoardBinding {
    eventId: number
    folderId: number
    board: RushRankingBoard
    label: string
}

/**
 * **默认为空 —— 不劫持任何官方活动。**
 *
 * 2026-08-27 曾把 1000/1001(云水试炼-复刻 / 溢光试炼复刻)征用成两张榜的门面,
 * 作者不要那两个常驻 banner,已把 master 时间窗按字节还原、这里也一并停用。
 * 代码保留是因为映射逻辑本身是对的,想再开只要给环境变量:
 *
 *   WF_RUSH_BOARD_RANKING_EVENTS={"1000":{"eventId":700099,"folderId":1,"board":"full-run"}}
 *
 * 注意:开之前必须同时把 master 的 ranking_event 时间窗改开,否则活动列表里看不到。
 */
const DEFAULT_BINDINGS: Record<number, RushBoardBinding> = {}

/**
 * 允许用环境变量改绑,免得换活动 id 还要改代码。格式:
 *   WF_RUSH_BOARD_RANKING_EVENTS={"1000":{"eventId":700099,"folderId":1,"board":"full-run"}}
 */
function loadBindings(): Record<number, RushBoardBinding> {
    const raw = (process.env.WF_RUSH_BOARD_RANKING_EVENTS ?? "").trim()
    if (raw === "") return DEFAULT_BINDINGS
    try {
        const parsed = JSON.parse(raw) as Record<string, Partial<RushBoardBinding>>
        const merged: Record<number, RushBoardBinding> = {}
        for (const [key, value] of Object.entries(parsed)) {
            const id = Number(key)
            if (!Number.isFinite(id)) continue
            merged[id] = {
                eventId: value.eventId ?? 700099,
                folderId: value.folderId ?? 1,
                board: value.board ?? "full-run",
                label: value.label ?? `连战榜 ${id}`
            }
        }
        return Object.keys(merged).length > 0 ? merged : DEFAULT_BINDINGS
    } catch {
        console.error("[RUSH-LB] WF_RUSH_BOARD_RANKING_EVENTS is not valid JSON; using defaults")
        return DEFAULT_BINDINGS
    }
}

let bindings: Record<number, RushBoardBinding> | null = null

/**
 * 查某个排名活动 id 绑定的榜。
 *
 * @param rankingEventId 排名活动 ID。
 * @returns 绑定信息;不是自制榜则返回 null(交回官方时间挑战逻辑)。
 */
export function getRushBoardBinding(rankingEventId: number): RushBoardBinding | null {
    if (bindings === null) bindings = loadBindings()
    return bindings[rankingEventId] ?? null
}

/** 客户端 `ranking_event/get_summary` 的 data 段。 */
export interface RankingEventSummary {
    best_record: { elapsed_time_ms: number, is_accomplished: boolean, score: number }
    leader_character_id: number
    leader_character_evolution_img_level: number
    rank_border_top: { elapsed_time_ms: number, is_accomplished: boolean, score: number } | null
    rank_percentage: number
}

/**
 * 取要显示的队长角色。
 *
 * 客户端 `RankingEventPresentationTranslator` 会先查 `player.hasCharacter(id)`,
 * 查不到就走 `getGeneralCharacter` —— 但那个 id 必须在角色 master 里真实存在,
 * 否则 master 查表直接 ClientError 8601。所以榜上没成绩时退回**这个存档自己的
 * 队长**(必然存在且拥有),而不是硬编码一个可能不存在的 id。
 */
function leaderOf(record: RushRunRecord | null, playerId: number): { id: number, level: number } {
    const characterId = record?.characterIds.find((id): id is number => id !== null)
    if (characterId !== undefined) return { id: characterId, level: 1 }

    try {
        const leaderCharacterId = getPlayerSync(playerId)?.leaderCharacterId
        if (typeof leaderCharacterId === "number" && leaderCharacterId > 0) {
            return { id: leaderCharacterId, level: 1 }
        }
    } catch {
        // 落到下面的兜底
    }
    return { id: 1, level: 1 }
}

/**
 * 按某张榜为某个存档生成排名活动摘要。
 *
 * 映射(裁定见 work/agent-coordination/rush-leaderboard-20260827.md):
 *   best_record.elapsed_time_ms  = 我在这张榜上的最好成绩(30 关结算时间之和)
 *   best_record.score            = 那一程打通的关数
 *   rank_border_top.elapsed_time_ms = 榜首成绩 —— 界面上「再快多少能超过」
 *   rank_percentage              = 我的名次占比(0=榜首,100=垫底)
 *   leader_character_*           = 我那一程的队长
 *
 * @param binding 该活动绑定的榜。
 * @param playerId 存档 ID。
 * @returns 摘要;没有任何成绩时也返回一个「未达成」的空摘要,让界面能正常打开。
 */
export function buildRushBoardRankingSummary(
    binding: RushBoardBinding,
    playerId: number
): RankingEventSummary {
    const records = getRushBoardRecordsSync(binding.eventId, binding.folderId, binding.board)
    const topRecord = records[0] ?? null
    const myIndex = records.findIndex(record => record.playerId === playerId)
    const myRecord = myIndex < 0 ? null : records[myIndex]!

    const leader = leaderOf(myRecord ?? topRecord, playerId)
    // records 已在 SQL 层滤掉 `duration_ms IS NULL / battle_ms <= 0`(战斗用时榜),
    // 所以在这个调用点上 fullRun 与旧的 durationMs 判据恒等 —— 这里是纵深防御,
    // 不是行为变更,也因此没有断言守着(单测无法注入未过滤的 records)。
    // ⚠ 将来若放宽 getRushBoardRecordsSync 的 WHERE(例如「未上榜也给条目」),
    // 必须回来确认这一行仍然是想要的口径。
    const isAccomplished = myRecord !== null && myRecord.fullRun

    // 名次占比,**0~100**(客户端 RankingEventPresentationTranslator 会 clamp 到
    // [0,100],再 /100 去和段位表的 rank_border(0~1 小数)比)。榜首 = 0,垫底 = 100。
    // 注意别填 100 给「还没上榜」的人以外的任何人:100 会让标记钉到最底。
    const rankPercentage = myIndex < 0 || records.length <= 1
        ? (myIndex === 0 ? 0 : 100)
        : (myIndex / (records.length - 1)) * 100

    return {
        best_record: {
            elapsed_time_ms: myRecord?.battleMs ?? 0,
            is_accomplished: isAccomplished,
            score: myRecord?.roundsCleared ?? 0
        },
        leader_character_id: leader.id,
        leader_character_evolution_img_level: leader.level,
        rank_border_top: topRecord === null ? null : {
            elapsed_time_ms: topRecord.battleMs,
            is_accomplished: true,
            score: topRecord.roundsCleared
        },
        rank_percentage: rankPercentage
    }
}

/**
 * 判断某个关卡是否属于「被征用成榜的排名活动」。
 *
 * 这些活动只是榜的门面,没有真关卡数据 —— 真开起来是一场空战斗,所以
 * `single_battle_quest/start` 必须挡住。关卡 id 的构造规则沿用官方:
 * 排名活动 id × 1000 + 序号(1000 → 1000001,1001 → 1001001)。
 *
 * @param questCategory 关卡分类。
 * @param questId 关卡 ID。
 * @returns 是则应当拒绝开战。
 */
export function isRushBoardRankingQuest(questCategory: number, questId: number): boolean {
    if (questCategory !== QuestCategory.RANKING_EVENT_SINGLE) return false
    if (bindings === null) bindings = loadBindings()
    return Object.keys(bindings)
        .some(id => Math.floor(questId / 1000) === Number(id))
}

/**
 * 该存档在这张榜上的名次(1 起),没上榜返回 null。用于日志与后台核对。
 *
 * @param binding 该活动绑定的榜。
 * @param playerId 存档 ID。
 */
export function getRushBoardMyRankSync(
    binding: RushBoardBinding,
    playerId: number
): number | null {
    const row = getRushRankingMyRowSync(binding.eventId, binding.folderId, binding.board, playerId)
    return row?.rank_number ?? null
}
