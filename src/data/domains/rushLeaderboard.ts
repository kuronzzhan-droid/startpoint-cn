/**
 * 深渊连战排行榜的 SQLite 存储层。
 *
 * 判定规则(计时口径 / 轮次边界)全在 src/lib/rush-leaderboard.ts,这里只负责
 * 把它落到 players_rush_event_runs + rush_event_seasons 两张表上。
 */

import { getDb } from "../db";
import { isFullRunRecord } from "../../lib/rush-leaderboard";
import type {
    NewRushRun,
    RushLeaderboardStore,
    RushRun,
    RushRunPatch,
    RushSeason
} from "../../lib/rush-leaderboard";

interface RawRushRun {
    id: number
    player_id: number
    player_name: string | null
    event_id: number
    folder_id: number
    season: number
    status: string
    started_at_ms: number
    finished_at_ms: number | null
    ended_at_ms: number | null
    duration_ms: number | null
    battle_ms: number
    rounds_cleared: number
    total_rounds: number
    tracked_from_round: number
    character_id_1: number | null
    character_id_2: number | null
    character_id_3: number | null
    unison_character_id_1: number | null
    unison_character_id_2: number | null
    unison_character_id_3: number | null
}

interface RawRushRunWithName extends RawRushRun {
    live_name: string | null
}

interface RawRushSeason {
    event_id: number
    season: number
    started_at_ms: number
    fingerprint: string
    source: string
}

function deserializeRun(raw: RawRushRun): RushRun {
    return {
        id: raw.id,
        playerId: raw.player_id,
        playerName: raw.player_name,
        eventId: raw.event_id,
        folderId: raw.folder_id,
        season: raw.season,
        status: raw.status as RushRun["status"],
        startedAtMs: raw.started_at_ms,
        finishedAtMs: raw.finished_at_ms,
        endedAtMs: raw.ended_at_ms,
        durationMs: raw.duration_ms,
        battleMs: raw.battle_ms,
        roundsCleared: raw.rounds_cleared,
        totalRounds: raw.total_rounds,
        trackedFromRound: raw.tracked_from_round,
        characterIds: [raw.character_id_1, raw.character_id_2, raw.character_id_3],
        unisonCharacterIds: [raw.unison_character_id_1, raw.unison_character_id_2, raw.unison_character_id_3]
    }
}

/** 排行榜/明细接口下发的一行。 */
export interface RushRunRecord extends RushRun {
    /** 存档现在的名字;存档已删则回落到成绩产生时的快照名。 */
    displayName: string | null
    /** 存档是否还在(false = 这条是已删存档留下的历史成绩)。 */
    playerExists: boolean
    /**
     * 是否是「从第 1 关起完整跟踪并通关、且有有效战斗计时」的成绩
     * —— 战斗用时榜的入榜条件,也是「这一行的时间能不能当成绩显示」的开关。
     *
     * `battleMs > 0` 不能写成 `battleMs !== null`:battle_ms 是 NOT NULL DEFAULT 0,
     * 那样写恒真、闸门静默失效,而 0 会渲染成 00:00.00 排在所有真成绩之前。
     */
    fullRun: boolean
}

function toRecord(raw: RawRushRunWithName): RushRunRecord {
    const run = deserializeRun(raw)
    return {
        ...run,
        displayName: raw.live_name ?? run.playerName,
        playerExists: raw.live_name !== null,
        // 判据只此一份 TS 实现(lib/rush-leaderboard.ts 的 isFullRunRecord),别再抄。
        // 剩下的三份等价拷贝都在本文件的 SQL 里,改这里必须同步改:
        // getRushFullRunLeaderboardSync 的 WHERE、getRushPlayerFullRunsSync 的 WHERE、
        // getRushLeaderboardStatsSync 的两个 CASE。
        fullRun: isFullRunRecord(run)
    }
}

const RUN_COLUMNS = `id, player_id, player_name, event_id, folder_id, season, status,
    started_at_ms, finished_at_ms, ended_at_ms, duration_ms, battle_ms,
    rounds_cleared, total_rounds, tracked_from_round,
    character_id_1, character_id_2, character_id_3,
    unison_character_id_1, unison_character_id_2, unison_character_id_3`

/** RushLeaderboardStore 的 better-sqlite3 实现。 */
export const rushLeaderboardStore: RushLeaderboardStore = {
    getActiveRun(playerId: number, eventId: number, folderId: number): RushRun | null {
        const raw = getDb().prepare(`
        SELECT ${RUN_COLUMNS}
        FROM players_rush_event_runs
        WHERE player_id = ? AND event_id = ? AND folder_id = ? AND status = 'active'
        ORDER BY id DESC
        LIMIT 1
        `).get(playerId, eventId, folderId) as RawRushRun | undefined

        return raw === undefined ? null : deserializeRun(raw)
    },

    insertRun(run: NewRushRun): RushRun {
        return getDb().transaction((): RushRun => {
            // 唯一索引只允许每个(存档, 事件, folder)有一条 active。调用方通常已经
            // 作废了旧行,这里再兜一次,免得历史脏行让新 run 插不进去。
            getDb().prepare(`
            UPDATE players_rush_event_runs
            SET status = 'abandoned', ended_at_ms = ?
            WHERE player_id = ? AND event_id = ? AND folder_id = ? AND status = 'active'
            `).run(run.startedAtMs, run.playerId, run.eventId, run.folderId)

            const result = getDb().prepare(`
            INSERT INTO players_rush_event_runs
            (player_id, player_name, event_id, folder_id, season, status,
             started_at_ms, battle_ms, rounds_cleared, total_rounds, tracked_from_round)
            VALUES (?, ?, ?, ?, ?, 'active', ?, 0, ?, ?, ?)
            `).run(
                run.playerId,
                run.playerName,
                run.eventId,
                run.folderId,
                run.season,
                run.startedAtMs,
                Math.max(0, run.trackedFromRound - 1),
                run.totalRounds,
                run.trackedFromRound
            )

            const raw = getDb().prepare(`
            SELECT ${RUN_COLUMNS} FROM players_rush_event_runs WHERE id = ?
            `).get(Number(result.lastInsertRowid)) as RawRushRun

            return deserializeRun(raw)
        })()
    },

    updateRun(runId: number, patch: RushRunPatch): void {
        const fields: Record<string, unknown> = {
            status: patch.status,
            finished_at_ms: patch.finishedAtMs,
            ended_at_ms: patch.endedAtMs,
            duration_ms: patch.durationMs,
            battle_ms: patch.battleMs,
            rounds_cleared: patch.roundsCleared,
            character_id_1: patch.characterIds?.[0],
            character_id_2: patch.characterIds?.[1],
            character_id_3: patch.characterIds?.[2],
            unison_character_id_1: patch.unisonCharacterIds?.[0],
            unison_character_id_2: patch.unisonCharacterIds?.[1],
            unison_character_id_3: patch.unisonCharacterIds?.[2]
        }

        const sets: string[] = []
        const values: unknown[] = []
        for (const [field, value] of Object.entries(fields)) {
            if (value === undefined) continue
            sets.push(`${field} = ?`)
            values.push(value)
        }
        if (sets.length === 0) return

        getDb().prepare(`
        UPDATE players_rush_event_runs SET ${sets.join(", ")} WHERE id = ?
        `).run([...values, runId])
    },

    getSeason(eventId: number): RushSeason | null {
        const raw = getDb().prepare(`
        SELECT event_id, season, started_at_ms, fingerprint, source
        FROM rush_event_seasons WHERE event_id = ?
        `).get(eventId) as RawRushSeason | undefined

        return raw === undefined ? null : {
            eventId: raw.event_id,
            season: raw.season,
            startedAtMs: raw.started_at_ms,
            fingerprint: raw.fingerprint,
            source: raw.source
        }
    },

    putSeason(season: RushSeason): void {
        getDb().prepare(`
        INSERT INTO rush_event_seasons (event_id, season, started_at_ms, fingerprint, source)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (event_id) DO UPDATE SET
            season = excluded.season,
            started_at_ms = excluded.started_at_ms,
            fingerprint = excluded.fingerprint,
            source = excluded.source
        `).run(season.eventId, season.season, season.startedAtMs, season.fingerprint, season.source)
    },

    abandonActiveRuns(eventId: number, endedAtMs: number, folderId?: number): number {
        const result = folderId === undefined
            ? getDb().prepare(`
                UPDATE players_rush_event_runs
                SET status = 'abandoned', ended_at_ms = ?
                WHERE event_id = ? AND status = 'active'
                `).run(endedAtMs, eventId)
            : getDb().prepare(`
                UPDATE players_rush_event_runs
                SET status = 'abandoned', ended_at_ms = ?
                WHERE event_id = ? AND folder_id = ? AND status = 'active'
                `).run(endedAtMs, eventId, folderId)
        return result.changes
    }
}

/** 作废某个存档在某 folder 下进行中的 run(整段重置时调用)。 */
export function abandonPlayerRushRunSync(
    playerId: number,
    eventId: number,
    folderId: number,
    endedAtMs: number
): number {
    return getDb().prepare(`
    UPDATE players_rush_event_runs
    SET status = 'abandoned', ended_at_ms = ?
    WHERE player_id = ? AND event_id = ? AND folder_id = ? AND status = 'active'
    `).run(endedAtMs, playerId, eventId, folderId).changes
}

/**
 * 战斗用时榜:**当期**里所有「从第 1 关完整跟踪并打通」的成绩,
 * 按存档去重后按战斗用时升序。
 *
 * ── 按期分桶(作者裁定 2026-08-28 晚,推翻同日早些时候的「跨期历史最优」)──
 * 作者原话:「每次重 roll 塔,排行榜结算,新塔是新榜不会有之前的排行」。
 * ⇒ **重摇塔 = 换期 = 新的一张空榜**。`season` 参数非 null 时,
 * 入榜与去重**都**收在那一期内(`WHERE season = ?` 写在窗口函数的子查询里,
 * 不是写在外层 —— 写外层会先跨期选出每人最优再筛期,当期没打过最优的人会整行消失)。
 *
 * 换期之后旧成绩仍留在 `players_rush_event_runs` 和结算快照 `rush_season_results`
 * 里,只是不再出现在当期榜上。传 `null` = 不按期过滤(后台排查、单测、
 * 以及「还没有期次台账」的服务器走这条)。
 *
 * 这条改动顺带消灭了「跨期重复发奖」:第 2 期结算时这张榜不再逐行等于第 1 期。
 *
 * ── 去重口径(作者裁定 2026-08-28,推翻 2026-08-27 的「可重复领」)────────
 * **一位玩家只记录他的最优成绩** —— 同一个存档在**这一期**里打了几程,只有
 * **battle_ms(30 关结算时间之和)最短**的那一程上榜,
 * 榜上不可能出现同一个 `player_id` 两次。
 * 「整段重置重打同一座塔」不换期,所以重打得更慢不会覆盖上一程 —— 这是作者要的。
 *
 * 排序键 2026-08-28 从 duration_ms(墙钟)换成 battle_ms;
 * `battle_ms > 0` 是入榜硬闸(0 = 客户端没报出有效计时,会以 00:00.00 霸榜首)。
 *
 * 落地方式是窗口函数 `ROW_NUMBER() PARTITION BY player_id`,和「当轮首通榜」
 * (`PARTITION BY season, player_id`)同一套写法。去重键仍**只有 `player_id`**:
 * 期已经被 WHERE 收窄掉了,再加进 PARTITION 是重复条件。
 *
 * 同一存档两程 battle_ms 完全相同时,取 `finished_at_ms` 更早的那一程(再同,取 id 小的)
 * —— 必须给到全序,否则 SQLite 可以在两次查询里挑不同的行,
 * 而「名次 → 那一行」是发奖和「点行看资料」共用的索引。
 *
 * ⚠ 这条去重是**发奖**、**游戏内原生榜**、**后台页**三处共用的唯一口径:
 * 它们都从这里取数(`getRushBoardRecordsSync` → 本函数),所以不要在上层再补一次
 * 去重,也不要绕过本函数直接查表。
 *
 * @param eventId 事件 ID。
 * @param folderId folder ID。
 * @param limit 上限。
 * @param season 只看这一期;**null = 不按期过滤**(排查/单测/无台账时用)。
 */
export function getRushFullRunLeaderboardSync(
    eventId: number,
    folderId: number,
    limit: number = 100,
    season: number | null = null
): RushRunRecord[] {
    // 期条件必须落在窗口函数的子查询里 —— 放到外层等于「先跨期选最优、再筛期」,
    // 那样「上一期更快、这一期也打通了」的玩家会在当期榜上凭空消失。
    const seasonClause = season === null ? "" : " AND season = ?"
    const params: unknown[] = season === null
        ? [eventId, folderId, limit]
        : [eventId, folderId, season, limit]

    const rows = getDb().prepare(`
    SELECT ${RUN_COLUMNS.split(",").map(c => `r.${c.trim()}`).join(", ")}, p.name AS live_name
    FROM players_rush_event_runs r
    LEFT JOIN players p ON p.id = r.player_id
    WHERE r.id IN (
        SELECT id FROM (
            SELECT id, ROW_NUMBER() OVER (
                PARTITION BY player_id ORDER BY battle_ms ASC, finished_at_ms ASC, id ASC
            ) AS rn
            FROM players_rush_event_runs
            WHERE event_id = ? AND folder_id = ?${seasonClause}
                AND status = 'completed' AND tracked_from_round = 1
                AND duration_ms IS NOT NULL AND battle_ms > 0
        ) WHERE rn = 1
    )
    ORDER BY r.battle_ms ASC, r.finished_at_ms ASC, r.id ASC
    LIMIT ?
    `).all(params) as RawRushRunWithName[]

    return rows.map(toRecord)
}

/**
 * 某个存档在这座塔上的**全部**完整成绩(按战斗用时 battle_ms 升序)。
 *
 * 为什么不复用 {@link getRushFullRunLeaderboardSync}:那张榜按存档去重了,
 * 一个存档只剩最快的一条 —— 而「破纪录特效」要拿**本程之外**的历史最佳来比
 * (`src/lib/rush-endless-card.ts`),去重后的榜里本程一旦是最快的,历史最佳
 * 就整条消失,永远打不破自己。所以记录卡那条路必须看全量。
 *
 * ── 也要按期(2026-08-28 复核补) ────────────────────────────────
 * 榜按期分桶之后,「个人纪录」跨期就说不通了:重摇成一座更难的塔以后,玩家要打破的
 * 是**上一座塔**的纪录,破纪录特效可能永远不再触发;反过来重摇成更简单的塔则第一次
 * 就破。所以记录卡传当期期号,让「最佳」和「新塔是新榜」同一个口径。
 * 传 `null` 仍是跨期(后台排查/单测/没有期次台账时走这条)。
 *
 * @param eventId 连战事件 ID。
 * @param folderId folder ID。
 * @param playerId 存档 ID。
 * @param limit 上限。
 * @param season 只看这一期;**null = 不按期过滤**。
 * @returns 该存档的完整成绩,按 battle_ms 升序(同分按完成时刻、再按 id)。
 */
export function getRushPlayerFullRunsSync(
    eventId: number,
    folderId: number,
    playerId: number,
    limit: number = 500,
    season: number | null = null
): RushRunRecord[] {
    const seasonClause = season === null ? "" : " AND r.season = ?"
    const params: unknown[] = season === null
        ? [eventId, folderId, playerId, limit]
        : [eventId, folderId, playerId, season, limit]

    const rows = getDb().prepare(`
    SELECT ${RUN_COLUMNS.split(",").map(c => `r.${c.trim()}`).join(", ")}, p.name AS live_name
    FROM players_rush_event_runs r
    LEFT JOIN players p ON p.id = r.player_id
    WHERE r.event_id = ? AND r.folder_id = ? AND r.player_id = ?
        AND r.status = 'completed' AND r.tracked_from_round = 1
        AND r.duration_ms IS NOT NULL AND r.battle_ms > 0${seasonClause}
    ORDER BY r.battle_ms ASC, r.finished_at_ms ASC, r.id ASC
    LIMIT ?
    `).all(params) as RawRushRunWithName[]

    return rows.map(toRecord)
}

/**
 * 当轮首通榜:每一期里,每个存档的第一次通关。
 * 按期号倒序(最新一期在最上面),同期内按首通时刻升序。
 */
export function getRushSeasonFirstClearLeaderboardSync(
    eventId: number,
    folderId: number,
    limit: number = 100
): RushRunRecord[] {
    const rows = getDb().prepare(`
    SELECT ${RUN_COLUMNS.split(",").map(c => `r.${c.trim()}`).join(", ")}, p.name AS live_name
    FROM players_rush_event_runs r
    LEFT JOIN players p ON p.id = r.player_id
    WHERE r.id IN (
        SELECT id FROM (
            SELECT id, ROW_NUMBER() OVER (
                PARTITION BY season, player_id ORDER BY finished_at_ms ASC, id ASC
            ) AS rn
            FROM players_rush_event_runs
            WHERE event_id = ? AND folder_id = ? AND status = 'completed' AND finished_at_ms IS NOT NULL
        ) WHERE rn = 1
    )
    ORDER BY r.season DESC, r.finished_at_ms ASC, r.id ASC
    LIMIT ?
    `).all(eventId, folderId, limit) as RawRushRunWithName[]

    return rows.map(toRecord)
}

/** 某事件/folder 下的原始 run 明细(含进行中和已作废),用于后台排查。 */
export function getRushRunsSync(
    eventId: number,
    folderId: number,
    options: { playerId?: number, limit?: number } = {}
): RushRunRecord[] {
    const limit = options.limit ?? 200
    const rows = options.playerId === undefined
        ? getDb().prepare(`
            SELECT ${RUN_COLUMNS.split(",").map(c => `r.${c.trim()}`).join(", ")}, p.name AS live_name
            FROM players_rush_event_runs r
            LEFT JOIN players p ON p.id = r.player_id
            WHERE r.event_id = ? AND r.folder_id = ?
            ORDER BY r.id DESC LIMIT ?
            `).all(eventId, folderId, limit) as RawRushRunWithName[]
        : getDb().prepare(`
            SELECT ${RUN_COLUMNS.split(",").map(c => `r.${c.trim()}`).join(", ")}, p.name AS live_name
            FROM players_rush_event_runs r
            LEFT JOIN players p ON p.id = r.player_id
            WHERE r.event_id = ? AND r.folder_id = ? AND r.player_id = ?
            ORDER BY r.id DESC LIMIT ?
            `).all(eventId, folderId, options.playerId, limit) as RawRushRunWithName[]

    return rows.map(toRecord)
}

/** 榜单统计:总记录数、通关数、最好成绩。 */
export interface RushLeaderboardStats {
    totalRuns: number
    completedRuns: number
    fullRuns: number
    abandonedRuns: number
    activeRuns: number
    /** 最好成绩 = 最小的 battle_ms(30 关结算时间之和);没有有效成绩则 null。 */
    bestBattleMs: number | null
    /**
     * 战斗用时榜**去重后**的行数 = 有完整成绩的存档数。
     *
     * 与 {@link fullRuns} 的差值 = 被去重吃掉的重复成绩数 **加上** battle_ms<=0 的
     * 废行数(后者当前为 0)。两个数一起显示,否则作者会以为成绩丢了
     * (作者裁定「一位玩家只记录他的最优成绩」,见
     * {@link getRushFullRunLeaderboardSync})。
     */
    rankedPlayers: number
    /**
     * **当期**的完整成绩数;没传 `season` 时是 null。
     *
     * 与 {@link fullRuns} 分开显示是必须的:榜本身 2026-08-28 起按期收窄
     * ({@link getRushFullRunLeaderboardSync}),而这几个统计数是跨期累计的。
     * 只显示累计数的话,换期之后后台会一边写「26 条成绩」一边给出一张空榜,
     * 正是 full-run 端点注释里要避免的「后台看得见、游戏里看不见」。
     */
    seasonFullRuns: number | null
    /** **当期**去重后的上榜存档数(= 当期榜的行数);没传 `season` 时是 null。 */
    seasonRankedPlayers: number | null
}

/**
 * 榜单统计。
 *
 * @param eventId 事件 ID。
 * @param folderId folder ID。
 * @param season 当期期号;给了就**额外**算一份当期的数
 *        ({@link RushLeaderboardStats.seasonFullRuns} /
 *         {@link RushLeaderboardStats.seasonRankedPlayers})。
 *        其余字段**始终是跨期累计**——后台要能看见「历史一共打过多少」。
 */
export function getRushLeaderboardStatsSync(
    eventId: number,
    folderId: number,
    season: number | null = null
): RushLeaderboardStats {
    const raw = getDb().prepare(`
    SELECT
        COUNT(*) AS total_runs,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed_runs,
        SUM(CASE WHEN status = 'completed' AND tracked_from_round = 1 THEN 1 ELSE 0 END) AS full_runs,
        SUM(CASE WHEN status = 'abandoned' THEN 1 ELSE 0 END) AS abandoned_runs,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active_runs,
        MIN(CASE WHEN status = 'completed' AND tracked_from_round = 1
            AND duration_ms IS NOT NULL AND battle_ms > 0 THEN battle_ms END) AS best_battle_ms,
        COUNT(DISTINCT CASE
            WHEN status = 'completed' AND tracked_from_round = 1
                AND duration_ms IS NOT NULL AND battle_ms > 0
            THEN player_id END) AS ranked_players
    FROM players_rush_event_runs
    WHERE event_id = ? AND folder_id = ?
    `).get(eventId, folderId) as {
        total_runs: number
        completed_runs: number | null
        full_runs: number | null
        abandoned_runs: number | null
        active_runs: number | null
        best_battle_ms: number | null
        ranked_players: number | null
    }

    // 当期那一份单独算。判据必须和 getRushFullRunLeaderboardSync 的入榜条件逐字
    // 相同(completed + tracked_from_round=1 + duration_ms 非空 + battle_ms>0),
    // 否则后台的「当期 N 条」会和榜上实际行数对不上。
    const scoped = season === null ? null : getDb().prepare(`
    SELECT
        COUNT(*) AS full_runs,
        COUNT(DISTINCT player_id) AS ranked_players
    FROM players_rush_event_runs
    WHERE event_id = ? AND folder_id = ? AND season = ?
        AND status = 'completed' AND tracked_from_round = 1
        AND duration_ms IS NOT NULL AND battle_ms > 0
    `).get(eventId, folderId, season) as {
        full_runs: number | null
        ranked_players: number | null
    } | undefined

    return {
        totalRuns: raw?.total_runs ?? 0,
        completedRuns: raw?.completed_runs ?? 0,
        fullRuns: raw?.full_runs ?? 0,
        abandonedRuns: raw?.abandoned_runs ?? 0,
        activeRuns: raw?.active_runs ?? 0,
        bestBattleMs: raw?.best_battle_ms ?? null,
        rankedPlayers: raw?.ranked_players ?? 0,
        seasonFullRuns: scoped === undefined || scoped === null ? null : scoped.full_runs ?? 0,
        seasonRankedPlayers: scoped === undefined || scoped === null ? null : scoped.ranked_players ?? 0
    }
}

/**
 * 「机器人」存档账号的 `accounts.idp_code`。
 *
 * 由 `mod-tools/wf_rush_bots.py`(常量 `BOT_IDP_CODE`)建号时写进去,
 * **两处必须同值**。整个 src/ 里认识 'rushbot' 的就只有这一个常量。
 */
export const RUSH_BOT_IDP_CODE = "rushbot"

/**
 * 机器人存档的 id 集合。
 *
 * 判据是账号级的(一个 `accounts` 行 + 它名下的全部 `players`),不是名字或
 * id 区间 —— 那两种都会在作者改名 / 建新存档时误伤真人。
 *
 * @returns 存档 id 集合;查不到(没建过 bot)时是空集合。空集合的语义是
 *          「一个都不排除」,所以调用方不需要额外判空。
 */
export function getRushBotPlayerIdsSync(): Set<number> {
    const rows = getDb().prepare(`
    SELECT p.id AS id
    FROM players p
    JOIN accounts a ON a.id = p.account_id
    WHERE a.idp_code = ?
    `).all(RUSH_BOT_IDP_CODE) as { id: number }[]

    return new Set(rows.map(row => row.id))
}

/** 有成绩记录的 (事件, folder) 组合。 */
export function getRushLeaderboardEventKeysSync(): { eventId: number, folderId: number }[] {
    const rows = getDb().prepare(`
    SELECT DISTINCT event_id, folder_id
    FROM players_rush_event_runs
    ORDER BY event_id ASC, folder_id ASC
    `).all() as { event_id: number, folder_id: number }[]

    return rows.map(row => ({ eventId: row.event_id, folderId: row.folder_id }))
}
