import type { Database } from "better-sqlite3"
import { getDb } from "../db"
import { isSingleFinishResponse } from "../../lib/quest/finish/single-finish-identity"
import { isMultiFinishResponse } from "../../lib/quest/finish/multi-finish-identity"

export const BATTLE_REPLAY_RETENTION_MS = 24 * 60 * 60 * 1000
export type BattleSettlementMode = "single" | "multi"
export type RecordedBattleSettlementMode = BattleSettlementMode | "legacy-conflict"

export interface BattleSettlement {
    playerId: number
    playId: string
    mode: RecordedBattleSettlementMode
    settledAtMs: number
    version: 1
    source: "ledger" | "legacy-receipt"
}

export interface BattleFinishReplayResponse {
    data_headers: Record<string, unknown>
    data: Record<string, any>
}

export type BattleReplay =
    | { kind: "missing" }
    | { kind: "available", response: BattleFinishReplayResponse, settlement: BattleSettlement }
    | { kind: "expired", settlement: BattleSettlement }
    | { kind: "other-mode", settlement: BattleSettlement }
    | { kind: "aborted", settlement?: BattleSettlement }
    | { kind: "corrupt", settlement?: BattleSettlement, reason: string }

export class BattleAlreadySettledError extends Error {
    readonly code = "BATTLE_ALREADY_SETTLED"
    constructor() { super("This play has already settled.") }
}

export class BattleClockAbortedError extends Error {
    readonly code = "BATTLE_CLOCK_ABORTED"
    constructor() { super("This play was terminated during clock migration.") }
}

export class BattleSettlementCorruptError extends Error {
    readonly code = "BATTLE_LEDGER_CORRUPT"
    constructor() { super("Battle settlement metadata is invalid.") }
}

function validateIdentity(playerId: number, playId: string): void {
    if (!Number.isSafeInteger(playerId) || playerId < 1 || typeof playId !== "string" || playId.trim().length === 0) {
        throw new TypeError("Invalid battle settlement identity.")
    }
}

function validTimestamp(value: unknown): value is number {
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
}

function operation(mode: BattleSettlementMode): string { return `quest_finish.${mode}` }

interface RawSettlement { mode: unknown, settled_at: unknown, version: unknown }
interface LegacyMetadata { operation: string, created_at: unknown }

/** Metadata only: old response blobs are never loaded to determine payment eligibility. */
function readSettlement(db: Database, playerId: number, playId: string): BattleSettlement | null {
    validateIdentity(playerId, playId)
    const durable = db.prepare(`SELECT mode, settled_at, version FROM battle_settlement_ledger
        WHERE player_id = ? AND play_id = ?`).get(playerId, playId) as RawSettlement | undefined
    const legacy = db.prepare(`SELECT operation, created_at FROM player_operation_receipts
        WHERE player_id = ? AND operation IN ('quest_finish.single','quest_finish.multi') AND request_key = ?`)
        .all(playerId, playId) as LegacyMetadata[]
    if (!durable && legacy.length === 0) return null
    if (durable && ((durable.mode !== "single" && durable.mode !== "multi" && durable.mode !== "legacy-conflict")
        || durable.version !== 1 || !validTimestamp(durable.settled_at))) throw new BattleSettlementCorruptError()
    if (legacy.some(row => !validTimestamp(row.created_at))) throw new BattleSettlementCorruptError()
    const modes = new Set<RecordedBattleSettlementMode>()
    if (durable) modes.add(durable.mode as RecordedBattleSettlementMode)
    for (const row of legacy) modes.add(row.operation === "quest_finish.single" ? "single" : "multi")
    const mode = modes.size === 1 ? [...modes][0] : "legacy-conflict"
    return {
        playerId, playId, mode,
        settledAtMs: Math.min(...legacy.map(row => row.created_at as number), ...(durable ? [durable.settled_at as number] : [])),
        version: 1, source: durable ? "ledger" : "legacy-receipt",
    }
}

/** Terminal facts only. Pending starts remain the caller's responsibility. */
export function getBattleSettlementSync(playerId: number, playId: string): BattleSettlement | null {
    return readSettlement(getDb(), playerId, playId)
}

function isClockAborted(db: Database, playerId: number, playId: string): boolean {
    return !!db.prepare(`SELECT 1 FROM player_operation_receipts
        WHERE player_id = ? AND operation = 'clock_migration.abort' AND request_key = ?`).get(playerId, playId)
}

function isFiveBossTerminal(db: Database, playerId: number, playId: string): boolean {
    if (db.prepare(`SELECT 1 FROM five_boss_solo_runs WHERE player_id=? AND play_id=?
        AND status IN ('settled','aborted')`).get(playerId, playId)) return true
    return !!db.prepare(`SELECT 1 FROM five_boss_gauntlet_members AS member
        JOIN five_boss_gauntlet_runs AS run ON run.run_id=member.run_id
        WHERE member.player_id=? AND member.client_play_id=?
          AND (member.aborted_at IS NOT NULL OR run.status IN ('settled','aborted')
            OR EXISTS (SELECT 1 FROM five_boss_gauntlet_receipts AS receipt
                WHERE receipt.run_id=member.run_id AND receipt.player_id=member.player_id))
        LIMIT 1`).get(playerId, playId)
}

/** Call inside the actual start transaction, not just before joining its queue. */
export function assertBattleCanStartSync(playerId: number, playId: string): void {
    const db = getDb()
    if (!db.inTransaction) throw new Error("Battle start eligibility must be checked inside its transaction.")
    validateIdentity(playerId, playId)
    if (isClockAborted(db, playerId, playId)) throw new BattleClockAbortedError()
    if (readSettlement(db, playerId, playId) || isFiveBossTerminal(db, playerId, playId)) throw new BattleAlreadySettledError()
}

/** Insert before the full response, in the same transaction as every reward and play consumption. */
export function insertBattleSettlementSync(
    playerId: number, playId: string, mode: BattleSettlementMode, settledAtMs = Date.now(),
): BattleSettlement {
    const db = getDb()
    if (!db.inTransaction) throw new Error("Battle settlement must be recorded inside its payment transaction.")
    validateIdentity(playerId, playId)
    if ((mode !== "single" && mode !== "multi") || !validTimestamp(settledAtMs)) throw new TypeError("Invalid battle settlement metadata.")
    if (isClockAborted(db, playerId, playId)) throw new BattleClockAbortedError()
    if (readSettlement(db, playerId, playId)) throw new BattleAlreadySettledError()
    db.prepare(`INSERT INTO battle_settlement_ledger(player_id,play_id,mode,settled_at,version)
        VALUES(?,?,?,?,1)`).run(playerId, playId, mode, settledAtMs)
    db.prepare(`INSERT INTO battle_receipt_payload_queue(player_id,play_id,operation,created_at)
        VALUES(?,?,?,?)`).run(playerId, playId, operation(mode), settledAtMs)
    return { playerId, playId, mode, settledAtMs, version: 1, source: "ledger" }
}

/** A retained guard never becomes missing merely because its replay response expired or was lost. */
export function getBattleReplaySync(
    playerId: number, mode: BattleSettlementMode, playId: string, nowMs = Date.now(),
): BattleReplay {
    try {
        validateIdentity(playerId, playId)
        if ((mode !== "single" && mode !== "multi") || !validTimestamp(nowMs)) throw new TypeError("Invalid battle replay request.")
    } catch (error) {
        if (error instanceof TypeError) return { kind: "corrupt", reason: "invalid-replay-request" }
        throw error
    }
    const db = getDb()
    let settlement: BattleSettlement | null
    try { settlement = readSettlement(db, playerId, playId) }
    catch (error) {
        if (error instanceof BattleSettlementCorruptError) return { kind: "corrupt", reason: "invalid-settlement-metadata" }
        throw error
    }
    // SQLite/closed-connection failures must reach existing HTTP/worker error handling.
    // In particular a native TypeError here is not a malformed JSON response.
    if (isClockAborted(db, playerId, playId)) return { kind: "aborted", ...(settlement ? { settlement } : {}) }
    if (!settlement) return { kind: "missing" }
    if (settlement.mode !== mode) return { kind: "other-mode", settlement }
    if (nowMs - settlement.settledAtMs >= BATTLE_REPLAY_RETENTION_MS) return { kind: "expired", settlement }
    const metadata = db.prepare(`SELECT created_at FROM player_operation_receipts
        WHERE player_id=? AND operation=? AND request_key=?`).get(playerId, operation(mode), playId) as { created_at: unknown } | undefined
    if (!metadata) return { kind: "corrupt", settlement, reason: "missing-response" }
    if (!validTimestamp(metadata.created_at)) return { kind: "corrupt", settlement, reason: "invalid-response-time" }
    if (nowMs - metadata.created_at >= BATTLE_REPLAY_RETENTION_MS) return { kind: "expired", settlement }
    const payload = db.prepare(`SELECT response_json FROM player_operation_receipts
        WHERE player_id=? AND operation=? AND request_key=?`).get(playerId, operation(mode), playId) as { response_json: string } | undefined
    if (!payload) return { kind: "corrupt", settlement, reason: "missing-response" }
    let response: unknown
    try { response = JSON.parse(payload.response_json) }
    catch (error) {
        if (error instanceof SyntaxError || error instanceof TypeError) return { kind: "corrupt", settlement, reason: "invalid-response-json" }
        throw error
    }
    if (!(mode === "single" ? isSingleFinishResponse(response) : isMultiFinishResponse(response))) {
        return { kind: "corrupt", settlement, reason: "invalid-response-shape" }
    }
    return { kind: "available", response: response as BattleFinishReplayResponse, settlement }
}
