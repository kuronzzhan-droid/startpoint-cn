import { randomUUID } from "crypto"
import type { Database } from "better-sqlite3"
import type { PersistenceContext } from "./persistence-coordinator"
import { isServerShuttingDown, withServerWorkAdmission } from "./shutdown-state"

export const BATTLE_RECEIPT_TTL_MS = 24 * 60 * 60 * 1000
const LEASE_MS = 120_000
const STATE_SQL = `CREATE TABLE IF NOT EXISTS battle_receipt_retention_state(
    id INTEGER PRIMARY KEY CHECK(id=1),scan_cursor INTEGER NOT NULL DEFAULT 0,
    owner_token TEXT,lease_until INTEGER NOT NULL DEFAULT 0,last_started_at INTEGER,
    last_completed_at INTEGER,last_error TEXT,last_result_json TEXT)`

export interface BattleReceiptRetentionOptions {
    executeTransaction?: <T>(context: PersistenceContext, operation: () => T) => Promise<T>
    enabled?: boolean
    initialDelayMs?: number
    intervalMs?: number
    catchupDelayMs?: number
    batchRows?: number
    maxBatches?: number
    maxPassMs?: number
    pauseMs?: number
    logger?: Pick<Console, "log" | "warn">
    now?: () => number
}
export interface BattleReceiptRetentionResult {
    scannedRows: number
    migratedRows: number
    deletedRows: number
    deletedJsonBytes: number
    guardedRows: number
    scanCursor: number
    oldestQueuedAt: number | null
    caughtUp: boolean
    stopped: boolean
    elapsedMs: number
    errors: number
}
export interface BattleReceiptRetentionService {
    start(): void
    stop(): Promise<void>
    drain(): Promise<void>
}
interface LegacyRow { receipt_rowid: number; player_id: number; operation: string; request_key: string; created_at: number }
interface QueueRow { player_id: number; play_id: string; operation: string; created_at: number }
interface StateRow { scan_cursor: number; owner_token: string | null; lease_until: number }
const modeFor = (operation: string): "single" | "multi" | null => operation === "quest_finish.single"
    ? "single" : operation === "quest_finish.multi" ? "multi" : null
function bounded(value: number | undefined, fallback: number, min: number, max: number): number {
    return value !== undefined && Number.isSafeInteger(value) && value >= min && value <= max ? value : fallback
}
function configuration(options: BattleReceiptRetentionOptions) {
    return {
        ...options,
        enabled: options.enabled ?? !/^(0|false|off|no)$/i.test(process.env.BATTLE_RECEIPT_RETENTION_ENABLED ?? ""),
        initialDelayMs: bounded(options.initialDelayMs, 10_000, 0, 86_400_000),
        intervalMs: bounded(options.intervalMs, 60_000, 1, 86_400_000),
        catchupDelayMs: bounded(options.catchupDelayMs, 1_000, 1, 86_400_000),
        batchRows: bounded(options.batchRows, 50, 1, 250),
        maxBatches: bounded(options.maxBatches, 20, 1, 100),
        maxPassMs: bounded(options.maxPassMs, 1_000, 1, 30_000),
        pauseMs: bounded(options.pauseMs, 20, 0, 10_000),
        logger: options.logger ?? console,
        now: options.now ?? Date.now,
    }
}
const yieldBatch = (ms: number): Promise<void> => new Promise(resolve => ms > 0 ? setTimeout(resolve, ms) : setImmediate(resolve))
function initialize(db: Database): void {
    db.exec(STATE_SQL)
    db.prepare("INSERT OR IGNORE INTO battle_receipt_retention_state(id) VALUES(1)").run()
}

/** Only tiny metadata tables are initialized here. Never index or aggregate the legacy payload table. */
export async function runBattleReceiptRetentionPass(
    database: Database,
    options: BattleReceiptRetentionOptions = {},
    shouldStop: () => boolean = () => false,
): Promise<BattleReceiptRetentionResult> {
    const config = configuration(options)
    const started = performance.now()
    const result: BattleReceiptRetentionResult = {
        scannedRows: 0, migratedRows: 0, deletedRows: 0, deletedJsonBytes: 0, guardedRows: 0,
        scanCursor: 0, oldestQueuedAt: null, caughtUp: false, stopped: false, elapsedMs: 0, errors: 0,
    }
    if (!config.enabled || shouldStop()) { result.stopped = shouldStop(); return result }
    const token = randomUUID()
    let ownsLease = false
    const write = async <T>(operation: string, action: () => T): Promise<T> => {
        if (config.executeTransaction) return config.executeTransaction({ domain: "maintenance", operation }, action)
        return database.transaction(action).immediate()
    }
    const lease = (): void => {
        const now = config.now()
        if (database.prepare(`UPDATE battle_receipt_retention_state SET lease_until=?
            WHERE id=1 AND owner_token=? AND lease_until>?`).run(now + LEASE_MS, token, now).changes !== 1) {
            throw new Error("Battle receipt retention lease lost")
        }
    }
    try {
        ownsLease = await write("battle_receipts_acquire", () => {
            if (shouldStop()) return false
            initialize(database)
            const now = config.now()
            return database.prepare(`UPDATE battle_receipt_retention_state SET owner_token=?,lease_until=?,
                last_started_at=?,last_error=NULL WHERE id=1 AND (owner_token IS NULL OR lease_until<=?)`)
                .run(token, now + LEASE_MS, now, now).changes === 1
        })
        if (!ownsLease) return result
        for (let batch = 0; batch < config.maxBatches && performance.now() - started < config.maxPassMs; batch++) {
            if (shouldStop()) { result.stopped = true; break }
            const outcome = await write("battle_receipts_batch", () => {
                if (shouldStop()) return null
                lease()
                const state = database.prepare("SELECT scan_cursor FROM battle_receipt_retention_state WHERE id=1").get() as StateRow
                // LIMIT applies before filtering operation: sparse battle rows must not cause an unbounded scan.
                const rows = database.prepare(`SELECT rowid AS receipt_rowid,player_id,operation,request_key,created_at
                    FROM player_operation_receipts WHERE rowid>? ORDER BY rowid LIMIT ?`)
                    .all(state.scan_cursor, config.batchRows) as LegacyRow[]
                let migrated = 0
                const ledger = database.prepare(`INSERT INTO battle_settlement_ledger(player_id,play_id,mode,settled_at,version)
                    VALUES(?,?,?,?,1) ON CONFLICT(player_id,play_id) DO UPDATE SET
                    mode=CASE WHEN battle_settlement_ledger.mode=excluded.mode THEN excluded.mode ELSE 'legacy-conflict' END,
                    settled_at=MIN(battle_settlement_ledger.settled_at,excluded.settled_at)`)
                const enqueue = database.prepare(`INSERT INTO battle_receipt_payload_queue(player_id,play_id,operation,created_at)
                    VALUES(?,?,?,?) ON CONFLICT(player_id,play_id,operation) DO UPDATE SET created_at=excluded.created_at`)
                for (const row of rows) {
                    const mode = modeFor(row.operation)
                    if (mode === null) continue
                    if (!Number.isSafeInteger(row.created_at) || row.created_at < 0) throw new Error("Invalid battle receipt timestamp; migration stopped")
                    ledger.run(row.player_id, row.request_key, mode, row.created_at)
                    enqueue.run(row.player_id, row.request_key, row.operation, row.created_at)
                    migrated++
                }
                const cursor = rows.length ? rows[rows.length - 1].receipt_rowid : state.scan_cursor
                database.prepare("UPDATE battle_receipt_retention_state SET scan_cursor=? WHERE id=1 AND owner_token=?").run(cursor, token)
                const cutoff = config.now() - BATTLE_RECEIPT_TTL_MS
                const expired = database.prepare(`SELECT player_id,play_id,operation,created_at FROM battle_receipt_payload_queue
                    WHERE created_at<=? ORDER BY created_at,player_id,play_id,operation LIMIT ?`)
                    .all(cutoff, config.batchRows) as QueueRow[]
                let deleted = 0, bytes = 0, guarded = 0
                const findLedger = database.prepare("SELECT mode,version FROM battle_settlement_ledger WHERE player_id=? AND play_id=?")
                const payload = database.prepare(`SELECT created_at,octet_length(response_json) AS bytes FROM player_operation_receipts
                    WHERE player_id=? AND operation=? AND request_key=?`)
                const prune = database.prepare(`DELETE FROM player_operation_receipts WHERE player_id=? AND operation=? AND request_key=?
                    AND created_at=? AND created_at<=? AND EXISTS(SELECT 1 FROM battle_settlement_ledger l
                        WHERE l.player_id=player_operation_receipts.player_id AND l.play_id=player_operation_receipts.request_key
                        AND l.version=1 AND l.mode IN (?, 'legacy-conflict'))`)
                const dequeue = database.prepare("DELETE FROM battle_receipt_payload_queue WHERE player_id=? AND play_id=? AND operation=? AND created_at=?")
                for (const row of expired) {
                    const mode = modeFor(row.operation)
                    const proof = findLedger.get(row.player_id, row.play_id) as {mode:string;version:number} | undefined
                    if (mode === null || !proof || proof.version !== 1 || (proof.mode !== mode && proof.mode !== "legacy-conflict")) {
                        guarded++
                        continue
                    }
                    const current = payload.get(row.player_id, row.operation, row.play_id) as {created_at:number;bytes:number} | undefined
                    if (current && current.created_at !== row.created_at) {
                        // A replaced payload needs its own full retention window; never delete by a stale rowid.
                        enqueue.run(row.player_id, row.play_id, row.operation, current.created_at)
                        continue
                    }
                    if (current) {
                        const changed = prune.run(row.player_id,row.operation,row.play_id,row.created_at,cutoff,mode).changes
                        deleted += changed
                        if (changed) bytes += current.bytes
                        else { guarded++; continue }
                    }
                    dequeue.run(row.player_id,row.play_id,row.operation,row.created_at)
                }
                const oldest = database.prepare("SELECT created_at FROM battle_receipt_payload_queue ORDER BY created_at LIMIT 1").get() as {created_at:number} | undefined
                return { scanned:rows.length,migrated,deleted,bytes,guarded,cursor,oldest:oldest?.created_at ?? null,
                    caughtUp:rows.length < config.batchRows && (oldest === undefined || oldest.created_at > cutoff), }
            })
            if (outcome === null) { result.stopped = true; break }
            result.scannedRows += outcome.scanned
            result.migratedRows += outcome.migrated
            result.deletedRows += outcome.deleted
            result.deletedJsonBytes += outcome.bytes
            result.guardedRows += outcome.guarded
            result.scanCursor = outcome.cursor
            result.oldestQueuedAt = outcome.oldest
            result.caughtUp = outcome.caughtUp
            if (outcome.guarded) throw new Error(`Battle receipt deletion guard rejected ${outcome.guarded} queued rows`)
            if (outcome.caughtUp) break
            await yieldBatch(config.pauseMs)
        }
        if (shouldStop()) result.stopped = true
        result.elapsedMs = performance.now() - started
        await write("battle_receipts_complete", () => {
            lease()
            database.prepare(`UPDATE battle_receipt_retention_state SET owner_token=NULL,lease_until=0,last_result_json=?,
                last_completed_at=CASE WHEN ? THEN ? ELSE last_completed_at END,last_error=? WHERE id=1 AND owner_token=?`)
                .run(JSON.stringify(result), result.caughtUp && !result.stopped ? 1 : 0, config.now(), result.stopped ? "interrupted" : null, token)
        })
        ownsLease = false
        return result
    } catch (error) {
        result.errors++
        result.elapsedMs = performance.now() - started
        if (ownsLease) {
            try {
                await write("battle_receipts_failed", () => {
                    database.prepare(`UPDATE battle_receipt_retention_state SET owner_token=NULL,lease_until=0,last_error=?,
                        last_result_json=? WHERE id=1 AND owner_token=?`).run(error instanceof Error ? error.message : String(error), JSON.stringify(result), token)
                })
            } catch (stateError) {
                config.logger.warn(`[DB_MAINTENANCE] battle receipt failure state could not be saved: ${String(stateError)}`)
            }
        }
        throw error
    }
}

export function createBattleReceiptRetentionService(database: Database, options: BattleReceiptRetentionOptions = {}): BattleReceiptRetentionService {
    const config = configuration(options)
    let stopped = true, timer: NodeJS.Timeout | null = null, active: Promise<void> | null = null
    const schedule = (ms: number): void => {
        if (stopped || isServerShuttingDown() || !config.enabled || timer !== null) return
        timer = setTimeout(() => {
            timer = null
            if (stopped || isServerShuttingDown()) return
            let next = config.intervalMs
            active = (async () => {
                try {
                    await withServerWorkAdmission(async () => {
                        const result = await runBattleReceiptRetentionPass(database, config, () => stopped || isServerShuttingDown())
                        next = result.caughtUp ? config.intervalMs : config.catchupDelayMs
                        config.logger.log(`[DB_MAINTENANCE] battle receipts: ${JSON.stringify(result)}`)
                    })
                } catch (error) {
                    next = config.intervalMs
                    config.logger.warn(`[DB_MAINTENANCE] battle receipt retention failed: ${String(error)}`)
                }
            })()
            void active.finally(() => { active = null; schedule(next) })
        }, ms)
        timer.unref()
    }
    return {
        start() { if (!stopped || isServerShuttingDown()) return; stopped = false; schedule(config.initialDelayMs) },
        async stop() { stopped = true; if (timer) { clearTimeout(timer); timer = null }; if (active) await active },
        async drain() { if (active) await active },
    }
}

export function startBattleReceiptRetentionService(database: Database, options: BattleReceiptRetentionOptions = {}): BattleReceiptRetentionService {
    const service = createBattleReceiptRetentionService(database, options)
    service.start()
    return service
}
