import { getDb } from "../db"

/**
 * Durable quest-finish receipts.
 *
 * A receipt is written in the same transaction that pays a battle out, keyed
 * by player and client play_id (the client creates a fresh id for every
 * battle start; a restored battle keeps its id). Any later finish carrying the
 * same play_id replays the stored response and pays nothing.
 *
 * Rows live in the existing `player_operation_receipts` ledger, which is
 * already preserved across save import/transfer. Retention is bounded: the
 * stored response is dropped after FINISH_RECEIPT_RESPONSE_DAYS (the key keeps
 * blocking a second payout) and the key itself after
 * FINISH_RECEIPT_RETENTION_DAYS.
 */
export type FinishReceiptKind = "single" | "multi"

const OPERATIONS: Record<FinishReceiptKind, string> = {
    single: "quest_finish.single",
    multi: "quest_finish.multi",
}
const DAY_MS = 24 * 60 * 60 * 1000
const COMPACTED = "null"

function days(name: string, fallback: number): number {
    const parsed = Number.parseInt(process.env[name] ?? "", 10)
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}

export function finishReceiptResponseRetentionMs(): number {
    return days("FINISH_RECEIPT_RESPONSE_DAYS", 7) * DAY_MS
}

export function finishReceiptRetentionMs(): number {
    return Math.max(days("FINISH_RECEIPT_RETENTION_DAYS", 180) * DAY_MS, finishReceiptResponseRetentionMs())
}

export interface FinishReceipt {
    /** Null when the play is settled but its response is no longer kept. */
    response: unknown | null
}

export function getFinishReceiptSync(
    playerId: number,
    kind: FinishReceiptKind,
    playId: string,
): FinishReceipt | null {
    const row = getDb().prepare(`
        SELECT response_json FROM player_operation_receipts
        WHERE player_id = ? AND operation = ? AND request_key = ?
    `).get(playerId, OPERATIONS[kind], playId) as { response_json: string } | undefined
    if (!row) return null
    try {
        return { response: JSON.parse(row.response_json) as unknown }
    } catch {
        // A damaged response must still block a second payout.
        return { response: null }
    }
}

/**
 * Record (or complete) the receipt for a settled play. Must run inside the
 * settlement transaction. The first write keeps its creation time.
 */
export function recordFinishReceiptSync(
    playerId: number,
    kind: FinishReceiptKind,
    playId: string,
    response: unknown | null,
    nowMs: number = Date.now(),
): void {
    const responseJson = response === null ? COMPACTED : JSON.stringify(response)
    if (responseJson === undefined) throw new Error(`结算回执不可序列化：${kind}`)
    getDb().prepare(`
        INSERT INTO player_operation_receipts (player_id, operation, request_key, response_json, created_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (player_id, operation, request_key)
        DO UPDATE SET response_json = excluded.response_json
    `).run(playerId, OPERATIONS[kind], playId, responseJson, nowMs)
}

/** Bounded retention for one player's finish receipts; uses the (player_id, created_at) index. */
export function pruneFinishReceiptsSync(playerId: number, nowMs: number = Date.now()): void {
    const db = getDb()
    db.prepare(`
        DELETE FROM player_operation_receipts
        WHERE player_id = ? AND created_at < ? AND operation IN (?, ?)
    `).run(playerId, nowMs - finishReceiptRetentionMs(), OPERATIONS.single, OPERATIONS.multi)
    db.prepare(`
        UPDATE player_operation_receipts SET response_json = '${COMPACTED}'
        WHERE player_id = ? AND created_at < ? AND operation IN (?, ?) AND response_json <> '${COMPACTED}'
    `).run(playerId, nowMs - finishReceiptResponseRetentionMs(), OPERATIONS.single, OPERATIONS.multi)
}
