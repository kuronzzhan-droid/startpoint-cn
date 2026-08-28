/**
 * 排行榜赛季结算的 SQLite 落地层。
 *
 * 判定规则在 src/lib/rush-settlement.ts;这里负责配置读写、名次冻结、
 * 发奖邮件、台账记账,并把它们锁进**一个事务**。
 */

import { getDb } from "../db";
import { insertMailSync, MailType } from "./mail";
import {
    defaultRushSettlementConfig,
    normalizeRewardTiers,
    type RushRewardBoard,
    type RushRewardTier,
    type RushSettlementConfig
} from "../../lib/rush-settlement";
import type { RushRunRecord } from "./rushLeaderboard";

interface RawConfig {
    event_id: number
    folder_id: number
    auto_enabled: number
    settle_at_ms: number | null
    repeat_interval_ms: number | null
    reward_board: string
    reward_rank_limit: number
    reward_tiers: string
    mail_subject: string
    mail_body: string
    updated_at_ms: number
    /** 2026-08-28 新增列;老库迁移前读出来是 undefined,见 deserializeConfig。 */
    exclude_bots: number | null | undefined
}

function deserializeConfig(raw: RawConfig): RushSettlementConfig {
    let tiers: RushRewardTier[] = []
    try {
        tiers = normalizeRewardTiers(JSON.parse(raw.reward_tiers))
    } catch {
        console.error(`[RUSH-LB] settlement tiers unreadable for ${raw.event_id}/${raw.folder_id}`)
    }
    return {
        eventId: raw.event_id,
        folderId: raw.folder_id,
        autoEnabled: raw.auto_enabled === 1,
        settleAtMs: raw.settle_at_ms,
        repeatIntervalMs: raw.repeat_interval_ms,
        rewardBoard: (raw.reward_board === "season-first" ? "season-first" : "full-run") as RushRewardBoard,
        rewardRankLimit: raw.reward_rank_limit,
        rewardTiers: tiers,
        mailSubject: raw.mail_subject,
        mailBody: raw.mail_body,
        updatedAtMs: raw.updated_at_ms,
        // 老库在 ALTER TABLE 跑之前查出来是 undefined —— 那时候要落在**默认排除**
        // 这一边,和出厂默认一致。`!== 0` 而不是 `=== 1`:少写一个分支就少一处
        // 「NULL 被当成开着」的静默分叉。
        excludeBots: raw.exclude_bots === undefined || raw.exclude_bots === null
            ? true : raw.exclude_bots !== 0
    }
}

/**
 * 读结算配置;没有就用出厂默认建一条。
 *
 * @param eventId 事件 ID。
 * @param folderId folder ID。
 * @param nowMs 当前真实时间。
 */
export function getRushSettlementConfigSync(
    eventId: number,
    folderId: number,
    nowMs: number
): RushSettlementConfig {
    const raw = getDb().prepare(`
    SELECT * FROM rush_settlement_config WHERE event_id = ? AND folder_id = ?
    `).get(eventId, folderId) as RawConfig | undefined

    if (raw !== undefined) return deserializeConfig(raw)

    const fresh = defaultRushSettlementConfig(eventId, folderId, nowMs)
    putRushSettlementConfigSync(fresh)
    return fresh
}

/** 写结算配置(整条覆盖)。 */
export function putRushSettlementConfigSync(config: RushSettlementConfig): void {
    getDb().prepare(`
    INSERT INTO rush_settlement_config
        (event_id, folder_id, auto_enabled, settle_at_ms, repeat_interval_ms,
         reward_board, reward_rank_limit, reward_tiers, mail_subject, mail_body,
         updated_at_ms, exclude_bots)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (event_id, folder_id) DO UPDATE SET
        auto_enabled = excluded.auto_enabled,
        settle_at_ms = excluded.settle_at_ms,
        repeat_interval_ms = excluded.repeat_interval_ms,
        reward_board = excluded.reward_board,
        reward_rank_limit = excluded.reward_rank_limit,
        reward_tiers = excluded.reward_tiers,
        mail_subject = excluded.mail_subject,
        mail_body = excluded.mail_body,
        updated_at_ms = excluded.updated_at_ms,
        exclude_bots = excluded.exclude_bots
    `).run(
        config.eventId,
        config.folderId,
        config.autoEnabled ? 1 : 0,
        config.settleAtMs,
        config.repeatIntervalMs,
        config.rewardBoard,
        config.rewardRankLimit,
        JSON.stringify(config.rewardTiers),
        config.mailSubject,
        config.mailBody,
        config.updatedAtMs,
        config.excludeBots ? 1 : 0
    )
}

/** 所有已存在的结算配置(调度器遍历用)。 */
export function getAllRushSettlementConfigsSync(): RushSettlementConfig[] {
    const rows = getDb().prepare(`SELECT * FROM rush_settlement_config`).all() as RawConfig[]
    return rows.map(deserializeConfig)
}

/** 某一期是否已经结算过。 */
export function isSeasonSettledSync(eventId: number, folderId: number, season: number): boolean {
    const row = getDb().prepare(`
    SELECT 1 AS hit FROM rush_season_settlements
    WHERE event_id = ? AND folder_id = ? AND season = ?
    `).get(eventId, folderId, season) as { hit: number } | undefined
    return row !== undefined
}

export interface SettlementLedgerRow {
    id: number
    eventId: number
    folderId: number
    season: number
    settledAtMs: number
    source: string
    nextSeason: number
    fullRunRows: number
    seasonFirstRows: number
    rewardedCount: number
    mailCount: number
    note: string | null
}

interface RawLedger {
    id: number
    event_id: number
    folder_id: number
    season: number
    settled_at_ms: number
    source: string
    next_season: number
    full_run_rows: number
    season_first_rows: number
    rewarded_count: number
    mail_count: number
    note: string | null
}

function deserializeLedger(raw: RawLedger): SettlementLedgerRow {
    return {
        id: raw.id,
        eventId: raw.event_id,
        folderId: raw.folder_id,
        season: raw.season,
        settledAtMs: raw.settled_at_ms,
        source: raw.source,
        nextSeason: raw.next_season,
        fullRunRows: raw.full_run_rows,
        seasonFirstRows: raw.season_first_rows,
        rewardedCount: raw.rewarded_count,
        mailCount: raw.mail_count,
        note: raw.note
    }
}

/** 历史结算台账(新的在前)。 */
export function getSettlementHistorySync(
    eventId: number,
    folderId: number,
    limit: number = 50
): SettlementLedgerRow[] {
    const rows = getDb().prepare(`
    SELECT * FROM rush_season_settlements
    WHERE event_id = ? AND folder_id = ?
    ORDER BY season DESC LIMIT ?
    `).all(eventId, folderId, limit) as RawLedger[]
    return rows.map(deserializeLedger)
}

export interface SeasonResultRow {
    board: string
    rank: number
    playerId: number
    playerName: string | null
    runId: number | null
    durationMs: number | null
    battleMs: number | null
    roundsCleared: number | null
    finishedAtMs: number | null
    rewardItemId: number | null
    rewardCount: number | null
    mailId: number | null
    /**
     * 这一行占了名次却没发奖的原因;null = 正常(发了,或者这一档本来就没配奖励)。
     *  · `'bot'`     机器人,被结算配置的 `excludeBots` 排除;
     *  · `'deleted'` 存档已删,`players_mails` 的外键插不进邮件。
     */
    skipReason: string | null
}

/** 某一期冻结下来的名次快照。 */
export function getSeasonResultsSync(
    eventId: number,
    folderId: number,
    season: number,
    board?: string
): SeasonResultRow[] {
    const rows = board === undefined
        ? getDb().prepare(`
            SELECT board, rank, player_id, player_name, run_id, duration_ms, battle_ms,
                   rounds_cleared, finished_at_ms, reward_item_id, reward_count, mail_id,
                   skip_reason
            FROM rush_season_results
            WHERE event_id = ? AND folder_id = ? AND season = ?
            ORDER BY board ASC, rank ASC`).all(eventId, folderId, season)
        : getDb().prepare(`
            SELECT board, rank, player_id, player_name, run_id, duration_ms, battle_ms,
                   rounds_cleared, finished_at_ms, reward_item_id, reward_count, mail_id,
                   skip_reason
            FROM rush_season_results
            WHERE event_id = ? AND folder_id = ? AND season = ? AND board = ?
            ORDER BY rank ASC`).all(eventId, folderId, season, board)

    return (rows as any[]).map(raw => ({
        board: raw.board,
        rank: raw.rank,
        playerId: raw.player_id,
        playerName: raw.player_name,
        runId: raw.run_id,
        durationMs: raw.duration_ms,
        battleMs: raw.battle_ms,
        roundsCleared: raw.rounds_cleared,
        finishedAtMs: raw.finished_at_ms,
        rewardItemId: raw.reward_item_id,
        rewardCount: raw.reward_count,
        mailId: raw.mail_id,
        skipReason: raw.skip_reason ?? null
    }))
}

export interface FrozenBoard {
    board: RushRewardBoard
    records: RushRunRecord[]
}

export interface SettlementWrite {
    eventId: number
    folderId: number
    season: number
    settledAtMs: number
    source: string
    nextSeason: number
    boards: FrozenBoard[]
    /** 发奖是按哪张榜的名次算的 —— 邮件信息要回填到这张榜的快照行上。 */
    rewardBoard: RushRewardBoard
    /** 发奖计划(rank → 道具);邮件在事务内插入。 */
    mails: { rank: number, playerId: number, itemId: number, count: number, subject: string, body: string }[]
    /**
     * 「占了名次但发不了奖」的名次 → 原因,只针对 {@link rewardBoard} 那张榜。
     * 写进快照行的 `skip_reason`,让作者事后看得出第 3 名为什么是空的。
     */
    skips?: Record<number, string>
    note: string | null
}

export interface SettlementWriteResult {
    settlementId: number
    fullRunRows: number
    seasonFirstRows: number
    mailCount: number
}

/**
 * **一个事务里**完成冻结 + 发奖 + 记账。换期由调用方在同一事务内接着做。
 *
 * @param write 要落盘的内容。
 * @returns 落盘结果。
 */
export function writeSettlementSync(write: SettlementWrite): SettlementWriteResult {
    const db = getDb()
    const mailTime = new Date(write.settledAtMs).toISOString().replace("T", " ").substring(0, 19)

    const ledger = db.prepare(`
    INSERT INTO rush_season_settlements
        (event_id, folder_id, season, settled_at_ms, source, next_season,
         full_run_rows, season_first_rows, rewarded_count, mail_count, note)
    VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, 0, ?)
    `).run(
        write.eventId, write.folderId, write.season, write.settledAtMs,
        write.source, write.nextSeason, write.note
    )
    const settlementId = Number(ledger.lastInsertRowid)

    // 先按 (board, rank) 建好快照行,发完奖再把邮件信息回填上去
    const insertResult = db.prepare(`
    INSERT INTO rush_season_results
        (settlement_id, event_id, folder_id, season, board, rank, player_id, player_name,
         run_id, duration_ms, battle_ms, rounds_cleared, finished_at_ms,
         reward_item_id, reward_count, mail_id, skip_reason)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?)
    `)

    const skips = write.skips ?? {}
    const counts: Record<string, number> = { "full-run": 0, "season-first": 0 }
    for (const frozen of write.boards) {
        frozen.records.forEach((record, index) => {
            const rank = index + 1
            insertResult.run(
                settlementId, write.eventId, write.folderId, write.season, frozen.board,
                rank, record.playerId, record.displayName, record.id,
                record.durationMs, record.battleMs, record.roundsCleared, record.finishedAtMs,
                // 跳过原因只挂在**发奖依据**那张榜上 —— 另一张榜根本不发奖,
                // 给它写 skip_reason 会让人以为那里也漏发了。
                frozen.board === write.rewardBoard ? (skips[rank] ?? null) : null
            )
        })
        counts[frozen.board] = frozen.records.length
    }

    const updateReward = db.prepare(`
    UPDATE rush_season_results
    SET reward_item_id = ?, reward_count = ?, mail_id = ?
    WHERE settlement_id = ? AND board = ? AND rank = ?
    `)

    let mailCount = 0
    for (const mail of write.mails) {
        const mailId = insertMailSync(mail.playerId, {
            reason_id: 0,
            subject: mail.subject,
            description: mail.body,
            type: MailType.ITEM,
            type_id: mail.itemId,
            number: mail.count,
            receive_time: "0000-00-00 00:00:00",
            create_time: mailTime,
            reward_period_limited: 0,
            reward_limit_time: null
        })
        updateReward.run(mail.itemId, mail.count, mailId, settlementId,
            write.rewardBoard, mail.rank)
        mailCount += 1
    }

    db.prepare(`
    UPDATE rush_season_settlements
    SET full_run_rows = ?, season_first_rows = ?, rewarded_count = ?, mail_count = ?
    WHERE id = ?
    `).run(counts["full-run"] ?? 0, counts["season-first"] ?? 0, mailCount, mailCount, settlementId)

    return {
        settlementId,
        fullRunRows: counts["full-run"] ?? 0,
        seasonFirstRows: counts["season-first"] ?? 0,
        mailCount
    }
}
