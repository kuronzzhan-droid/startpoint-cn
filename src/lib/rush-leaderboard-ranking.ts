/**
 * 把两张自制榜(战斗用时 / 当轮首通)投影成客户端连战排行榜界面认识的形状。
 *
 * 客户端那个界面本来是给「无尽连战」排行榜用的,每行读:
 *   rank_number / best_round / elapsed_time_ms / name / party_member_list / user_rank
 * 正好够表达一次竞速成绩(名次 / 关数 / 用时 / 玩家名 / 通关队伍 / 玩家等级),
 * 所以直接复用,不改 APK。映射裁定见
 * work/agent-coordination/rush-leaderboard-20260827.md。
 */

import type {
    UserRushEventEndlessBattleRanking,
    UserRushEventEndlessBattleMyRankingPartyMemberListItem
} from "../data/types";
import {
    getRushFullRunLeaderboardSync,
    getRushSeasonFirstClearLeaderboardSync,
    type RushRunRecord
} from "../data/domains/rushLeaderboard";
import { getPlayerSync } from "../data/domains/player";
import { getCharactersEvolutionImgLevels } from "./character";
import { getRankDegree } from "./stamina";
import { buildRushRankingPartyMemberList } from "./rush";
import { getRushTowerFolderIdSync, peekRushSeasonSync } from "./rush-leaderboard-service";
import { codeNameOf } from "./rush-leaderboard-news";
import { clientSerializeDate } from "../data/utils/date";
import { getServerDate } from "../utils";

/** 客户端界面里的两个榜。 */
export type RushRankingBoard = "full-run" | "season-first"

/**
 * 一页最多几行。客户端自己按 page/page_max 翻页。
 *
 * 100 是和设备 master `rush_event_ranking` 表里的 `ranking_max_records_per_page`
 * 对齐的值(客户端那个列的消费者 `LogicAssetContainer.getRushEventConfig` 在 CN
 * 包里是零调用者,所以页大小实际由服务端说了算,但对齐总比不对齐好)。
 * P4 走 `/tool/agreement` 一次取全 + 客户端本地分页,这个常量只影响官方契约端点
 * `/event/rush/ranking`;`BOARD_FETCH_CAP = 500` ⇒ 5 页封顶。
 */
export const RUSH_RANKING_PAGE_SIZE = 100

/**
 * 榜单最多取多少条(超出的名次没人会翻到)。
 *
 * 和 {@link RUSH_RANKING_PAGE_SIZE} 是有关系的:500 / 100 = **5 页封顶**。
 * 改页大小之前先想清楚这条,否则最后一页会永远填不满。
 */
export const BOARD_FETCH_CAP = 500

/**
 * 助战 / 剧情变体角色段。这些 ID 不可编成,正常进不了榜行;
 * 一旦混进去,客户端 `GeneralCharacterLogic` 构造函数会抛 **ClientError(8013)**
 * (「キャラクターID:N …マスタ上にありません」),**整个场景开不起来** ——
 * 不是这一格降级。所以在服务端就拦掉。
 */
const SUPPORT_CHARACTER_ID_MIN = 700000
const SUPPORT_CHARACTER_ID_MAX = 700099

/**
 * 这个角色 ID 发给客户端安全吗?
 *
 * 判据是「已发布的 character 主表里有没有这一行」——用的就是客户端自己会去查的
 * 那张表(`assets/cdndata/character.json`)。不认识的一律降级成空槽位(渲染成空框)。
 *
 * **两条下发通道共用这一个判据**:官方契约端点 `/event/rush/ranking`(本文件的
 * `toPartyMemberList`)和 P4 原生行 `/tool/agreement`
 * (`rush-leaderboard-native-rows.ts` 的 `nativeThumbnailPath`)。
 * 别在任何一侧重抄那两个常量 —— 两处各写一份正是 20260828 复核抓到的漏网口子:
 * native 那条路当时只查了 code_name,助战段照发,`700001` 会拼出
 * `character/devil_leader_assist/...`,而这些 thumb 多数在 store 里不存在
 * ⇒ 客户端走 `SectionCommand.FileNotFound` 弹「数据不足」拉去重下资源。
 *
 * @param characterId 角色 ID;null = 空位。
 * @returns 能发就 true。
 */
export function isShippableCharacterId(characterId: number | null): boolean {
    if (characterId === null || !Number.isFinite(characterId) || characterId <= 0) return false
    if (characterId >= SUPPORT_CHARACTER_ID_MIN && characterId <= SUPPORT_CHARACTER_ID_MAX) return false
    return codeNameOf(characterId) !== null
}

/**
 * 官方契约端点 `/event/rush/ranking` 的一行队伍。
 *
 * ⚠ 画的是**那一程的实战队伍快照**(`record.characterIds`),和游戏内原生榜行
 * 不一样 —— 后者 2026-08-28 起改画「个人资料里的前三个角色」
 * (`rush-leaderboard-native-rows.ts` 文件头「三个头像画的是谁」)。
 * **这是刻意的**,不是漏改:这条通道 + 公告版 + 后台页保留快照语义。
 */
function toPartyMemberList(
    record: RushRunRecord
): UserRushEventEndlessBattleMyRankingPartyMemberListItem[] {
    // 注意:**槽位要对齐**。查等级只能拿非空 ID 去查,但结果必须放回原来的槽位,
    // 否则「1 号位空、2 号位有人」的队伍会把 2 号位的等级安到 1 号位上。
    const filled = record.characterIds
        .map((id, slot) => ({ id, slot }))
        .filter((entry): entry is { id: number, slot: number } => entry.id !== null)

    // 进化立绘等级取该存档当前的值:成绩行里只存了角色 ID。存档已删就退回 0。
    let evolutionLevels: (number | null)[] = []
    try {
        evolutionLevels = record.playerExists && filled.length > 0
            ? getCharactersEvolutionImgLevels(record.playerId, filled.map(entry => entry.id))
            : []
    } catch {
        evolutionLevels = []
    }

    const bySlot: (number | null)[] = [null, null, null]
    filled.forEach((entry, index) => {
        // 客户端会把 >1 钳到 1,但 <0 直接抛 ClientError(2027)。别把安全性押在客户端。
        const raw = Number(evolutionLevels[index] ?? 0)
        bySlot[entry.slot] = !Number.isFinite(raw) ? 0 : Math.min(1, Math.max(0, Math.trunc(raw)))
    })

    // 主表里不认识的 ID 一律降级成空槽位(见 isShippableCharacterId 上的 8013 说明)。
    const safeIds = record.characterIds.map(id => (isShippableCharacterId(id) ? id : null))
    safeIds.forEach((id, slot) => {
        if (id === null) bySlot[slot] = null
    })

    // 恒定 3 个元素 —— 少一个就会在复用的 cell 里留下上一行的头像。
    return buildRushRankingPartyMemberList(safeIds, bySlot)
}

/**
 * 把一条 run 记录投影成一行榜单。
 *
 * @param record 成绩记录。
 * @param rankNumber 名次(1 起)。
 * @returns 客户端认识的榜单行。
 */
export function toRushRankingRow(
    record: RushRunRecord,
    rankNumber: number
): UserRushEventEndlessBattleRanking {
    // 存档还在就读实时等级,读不到退回 1(客户端只拿来显示「Rank N」)。
    let userRank = 1
    try {
        const player = record.playerExists ? getPlayerSync(record.playerId) : null
        if (player !== null) userRank = getRankDegree(player.rankPoint)
    } catch {
        userRank = 1
    }

    return {
        rank_number: rankNumber,
        best_round: record.roundsCleared,
        // 界面上的数值列 = 这一程 30 关的结算时间之和(battleMs,2026-08-28 口径)。
        // 这条是官方契约端点,elapsed_time_ms 是 Int 发不了 null,所以半途接管的行
        // 只能发它自己的部分和 —— 战斗用时榜的 SQL 已经把这种行挡在榜外,
        // 只有绑到「当期首通榜」时才可能出现(WF_RUSH_RANKING_BOARDS 改绑)。
        // 那种情况下 battleMs=0 的行会显示成 00:00.00;这是**观感**问题不是排序问题:
        // 首通榜按 finished_at_ms 排、客户端不对 rows 再排序,它只待在自己那一行。
        // 刻意不写 `fullRun ? battleMs : 0` —— 那对 battleMs=0 是空转,
        // 对部分和的行反而把一个能看的数换成了 0(裁定见计划步骤 15)。
        elapsed_time_ms: record.battleMs,
        name: record.displayName ?? `存档${record.playerId}`,
        party_member_list: toPartyMemberList(record),
        user_rank: userRank
    }
}

/**
 * 取某张榜的全部成绩(已排好序)。
 *
 * ── 「战斗用时榜」只看当期(作者裁定 2026-08-28 晚)───────────────────
 * 「每次重 roll 塔,排行榜结算,新塔是新榜不会有之前的排行」⇒ 这里把**当前期号**
 * 喂给 `getRushFullRunLeaderboardSync`。期号从 {@link peekRushSeasonSync} 现读
 * (只读,不会因为有人打开榜就凭空建台账);还没有台账时传 null =
 * 不按期过滤,与改动前行为一致。
 *
 * **这是所有展示通道共用的唯一取数口:** 游戏内原生榜、富文本页、公告版与
 * 官方契约端点 `/event/rush/ranking` 都走这里。结算为了不被展示的 500 行上限
 * 截断，直接调用同域全量 SQL，但仍传入相同的 currentSeason 保持「按期分桶」口径。
 *
 * 「当期首通榜」**刻意不收窄**:它按定义就是跨期的历史册
 * (`PARTITION BY season, player_id` + `ORDER BY season DESC`),每一行自带期号,
 * 界面上也是按期倒序列出来的。把它也收窄到当期就和战斗用时榜重复了。
 *
 * @param eventId 连战事件 ID。
 * @param folderId folder ID。
 * @param board 要取哪张榜。
 * @returns 成绩记录数组。
 */
export function getRushBoardRecordsSync(
    eventId: number,
    folderId: number,
    board: RushRankingBoard
): RushRunRecord[] {
    if (board === "season-first") {
        return getRushSeasonFirstClearLeaderboardSync(eventId, folderId, BOARD_FETCH_CAP)
    }
    return getRushFullRunLeaderboardSync(
        eventId, folderId, BOARD_FETCH_CAP, peekRushSeasonSync(eventId)?.season ?? null)
}

// ── 榜的归属:一个 event_id = 一张榜 ────────────────────────────────
//
// 官方那个界面上没有任何 tab / 榜类型参数(请求体只有 event_id / page /
// aggregated_time,主页上也只有一颗皇冠钮),`aggregated_time` 又被
// ClientError(7100) 的格式校验锁死、藏不了额外语义。
// ⇒ 两张自制榜只能靠 **event_id** 分开(方案文档 §5.3 裁定)。

/** 一个连战事件在客户端排行榜界面上对应哪张榜、哪个 folder。 */
export interface RushRankingTarget {
    eventId: number
    folderId: number
    board: RushRankingBoard
}

/** 默认绑定:深渊连战 700099 = 战斗用时榜。其余事件回落到战斗用时榜。 */
const DEFAULT_RANKING_BOARDS: Record<number, RushRankingBoard> = {
    700099: "full-run"
}

/**
 * 允许用环境变量改绑,免得再起一个连战事件当「当轮首通榜」的门面时还要改代码:
 *
 *   WF_RUSH_RANKING_BOARDS={"700099":"full-run","700007":"season-first"}
 */
function loadRankingBoards(): Record<number, RushRankingBoard> {
    const raw = (process.env.WF_RUSH_RANKING_BOARDS ?? "").trim()
    if (raw === "") return DEFAULT_RANKING_BOARDS

    try {
        const parsed = JSON.parse(raw) as Record<string, unknown>
        const bindings: Record<number, RushRankingBoard> = {}
        for (const [id, board] of Object.entries(parsed)) {
            const eventId = Number(id)
            if (!Number.isFinite(eventId)) continue
            if (board !== "full-run" && board !== "season-first") continue
            bindings[eventId] = board
        }
        return Object.keys(bindings).length === 0 ? DEFAULT_RANKING_BOARDS : bindings
    } catch (error) {
        console.error("[RUSH-LB] WF_RUSH_RANKING_BOARDS parse failed:", error)
        return DEFAULT_RANKING_BOARDS
    }
}

/**
 * 由 event_id 解析出「这次要展示哪张榜」。
 *
 * @param eventId 客户端请求里的连战事件 ID。
 * @returns 目标榜;该事件没有多轮 folder(= 不是塔)时返回 null。
 */
export function resolveRushRankingTargetSync(eventId: number): RushRankingTarget | null {
    if (!Number.isFinite(eventId)) return null

    const folderId = getRushTowerFolderIdSync(eventId)
    if (folderId === null) return null

    return {
        eventId,
        folderId,
        board: loadRankingBoards()[eventId] ?? "full-run"
    }
}

// ── 聚合时刻与快照 ─────────────────────────────────────────────────

/**
 * 官方连战榜的聚合时刻(小时)。
 *
 * 来源:master 全局表 `rush_event_ranking_aggregation_schedule` —— 它是**全局表**
 * (外层 key 恒为 1,不按活动 id 分行),rush 三行 = 10:00 / 14:00 / 00:00。
 */
export const RUSH_RANKING_AGGREGATION_HOURS: readonly number[] = [0, 10, 14]

/**
 * 把一个时刻向下取整到最近的聚合时刻,按客户端要的 `YYYY-MM-DD HH:MM:SS` 输出。
 *
 * 两条硬约束:
 *  ① 客户端把这个字符串**原样回抛**给翻页 / 编队子页请求;
 *  ② `JapanStandardTimeString.toAppTime` 对格式硬校验(空格恰好 1 个、`-` 恰好 2 个),
 *     错了抛 `ClientError(7100)`。
 * 所以一律走 `clientSerializeDate`,不许自己拼字符串。
 *
 * 发 `now()` 是个真问题:界面上「::value::更新」会显示当前时刻,每次进榜都在变,
 * 而它本该是「这批名次是什么时候结算的」。
 *
 * @param date 参考时刻;默认取服务器钟(后台的时间控制能平移它,界面上其它时间也走它)。
 * @returns 形如 `2026-08-27 14:00:00` 的聚合时刻。
 */
export function getRushRankingAggregatedTime(date: Date = getServerDate()): string {
    const bucket = new Date(date.getTime())
    const hour = bucket.getUTCHours()

    // 0 恒在表里,所以一定能找到一个 <= hour 的刻度。
    let floored = 0
    for (const candidate of RUSH_RANKING_AGGREGATION_HOURS) {
        if (candidate <= hour && candidate >= floored) floored = candidate
    }

    bucket.setUTCHours(floored, 0, 0, 0)
    return clientSerializeDate(bucket)
}

interface RushRankingSnapshot {
    aggregatedTime: string
    records: RushRunRecord[]
}

/**
 * 每张榜只留最新一个聚合时刻的快照。
 *
 * 为什么要快照:客户端翻页和「点某一行看编队」是**分开的两次请求**,中间可能有人
 * 刚打完一程。名次一漂,用户看到的是 A、点开就是 B。用 `aggregated_time` 当快照键
 * 正好把「同一聚合时刻内名次不许漂」这条落实下来。
 *
 * 代价是新成绩要等下一个聚合时刻(00:00 / 10:00 / 14:00)才进榜 —— 这正是官方语义。
 */
const rankingSnapshots = new Map<string, RushRankingSnapshot>()

function snapshotKey(eventId: number, folderId: number, board: RushRankingBoard): string {
    return `${eventId}:${folderId}:${board}`
}

/**
 * 取某张榜在某个聚合时刻的快照(没有就现查一次并缓存)。
 *
 * @param eventId 连战事件 ID。
 * @param folderId folder ID。
 * @param board 要取哪张榜。
 * @param aggregatedTime 聚合时刻;传 undefined = 不走快照,每次现查。
 * @returns 成绩记录数组。
 */
export function getRushRankingRecordsSync(
    eventId: number,
    folderId: number,
    board: RushRankingBoard,
    aggregatedTime?: string
): RushRunRecord[] {
    // 逃生门:`WF_RUSH_RANKING_LIVE=1` 关掉快照,每次现查。
    // 官方语义是「到点才结算」,所以默认开着快照;但自测时刚打完一程想立刻在
    // 界面上看到自己,等下一个 00:00 / 10:00 / 14:00 就太难受了。
    if (aggregatedTime === undefined || (process.env.WF_RUSH_RANKING_LIVE ?? "").trim() === "1") {
        return getRushBoardRecordsSync(eventId, folderId, board)
    }

    const key = snapshotKey(eventId, folderId, board)
    const cached = rankingSnapshots.get(key)
    if (cached !== undefined && cached.aggregatedTime === aggregatedTime) return cached.records

    const records = getRushBoardRecordsSync(eventId, folderId, board)
    rankingSnapshots.set(key, { aggregatedTime, records })
    return records
}

/** 丢掉所有快照。后台改了成绩 / 单测切换数据集时用。 */
export function clearRushRankingSnapshots(): void {
    rankingSnapshots.clear()
}

export interface RushRankingPage {
    /** 总页数,恒 >= 1。客户端算 `maxPage = page_max - 1`,而且 None 分支直接 throw。 */
    pageMax: number
    total: number
    list: UserRushEventEndlessBattleRanking[]
}

/**
 * 取某张榜的一页,投影成客户端形状。
 *
 * @param eventId 连战事件 ID。
 * @param folderId folder ID。
 * @param board 要取哪张榜。
 * @param page 页码(**1 起**,和客户端一致 —— `rankingListPageChanged` 里是
 *   `currentPageIndex + 1` 之后才交给 `Page(...)`,而 `currentPageIndex` 是 0 起的)。
 * @param pageSize 每页行数。
 * @param aggregatedTime 聚合时刻;给了就走同一时刻的快照。
 */
export function getRushRankingPageSync(
    eventId: number,
    folderId: number,
    board: RushRankingBoard,
    page: number,
    pageSize: number = RUSH_RANKING_PAGE_SIZE,
    aggregatedTime?: string
): RushRankingPage {
    const records = getRushRankingRecordsSync(eventId, folderId, board, aggregatedTime)
    const offset = (Math.max(1, Math.trunc(page) || 1) - 1) * pageSize
    const slice = records.slice(offset, offset + pageSize)

    return {
        pageMax: Math.max(1, Math.ceil(records.length / pageSize)),
        total: records.length,
        list: slice.map((record, index) => toRushRankingRow(record, offset + index + 1))
    }
}

/**
 * 取某个存档在某张榜上的最好名次(界面顶部的「我的成绩」栏)。
 *
 * @param eventId 连战事件 ID。
 * @param folderId folder ID。
 * @param board 要取哪张榜。
 * @param playerId 存档 ID。
 * @param aggregatedTime 聚合时刻;给了就走同一时刻的快照。
 * @returns 榜单行;该存档还没上榜时返回 null
 *   (客户端会自动用本地玩家数据伪造一张「排名外」卡,不会崩)。
 */
export function getRushRankingMyRowSync(
    eventId: number,
    folderId: number,
    board: RushRankingBoard,
    playerId: number,
    aggregatedTime?: string
): UserRushEventEndlessBattleRanking | null {
    const records = getRushRankingRecordsSync(eventId, folderId, board, aggregatedTime)
    const index = records.findIndex(record => record.playerId === playerId)
    return index < 0 ? null : toRushRankingRow(records[index]!, index + 1)
}

/**
 * 由名次反查那一条成绩 —— 「点某一行看它的编队」走这里。
 *
 * **必须和列表用同一张榜、同一个排序、同一个快照**,否则点开的是另一个人的队伍。
 *
 * @param eventId 连战事件 ID。
 * @param folderId folder ID。
 * @param board 要取哪张榜。
 * @param rankNumber 名次(1 起)。
 * @param aggregatedTime 聚合时刻;给了就走同一时刻的快照。
 * @returns 该名次上的成绩记录;名次越界返回 null。
 */
export function getRushRankingRecordAtRankSync(
    eventId: number,
    folderId: number,
    board: RushRankingBoard,
    rankNumber: number,
    aggregatedTime?: string
): RushRunRecord | null {
    if (!Number.isFinite(rankNumber) || rankNumber < 1) return null

    const records = getRushRankingRecordsSync(eventId, folderId, board, aggregatedTime)
    return records[Math.trunc(rankNumber) - 1] ?? null
}
