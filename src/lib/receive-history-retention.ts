import type { Database } from "better-sqlite3"
import type { PersistenceContext } from "./persistence-coordinator"
import { isServerShuttingDown, withServerWorkAdmission } from "./shutdown-state"
import { acquireHistoryLease, finishHistoryLease, initializeMaintenanceState, isHistoryCatchupNeeded, readHistoryPolicy, refreshHistoryLease } from "./maintenance-state"

const DEFAULT_MAX_ROWS = 500
const DEFAULT_DAILY_HOUR = 4
const DEFAULT_DAILY_MINUTE = 30
const DEFAULT_BATCH_PLAYERS = 5
const DEFAULT_PAUSE_MS = 100
const DEFAULT_BUSY_RETRY_ATTEMPTS = 5
const DEFAULT_BUSY_RETRY_DELAY_MS = 20
// Keep each synchronous SQLite delete short enough for realtime callbacks to
// run between batches. The old 1000-row batch made a large cleanup hold the
// main event loop for too long on the production database.
const DEFAULT_DELETE_BATCH_ROWS = 250
const MAX_DELETE_BATCH_ROWS = 5_000

interface ReceiveHistoryCandidateRow {
    player_id: number
    record_count: number
}

export interface ReceiveHistoryRetentionLogger {
    log(message: string): void
    warn(message: string): void
}

export interface ReceiveHistoryRetentionOptions {
    /** The live server supplies its main-database owner; offline tools keep their own connection. */
    executeTransaction?: <T>(context: PersistenceContext, operation: () => T) => Promise<T>
    enabled?: boolean
    maxRows?: number
    maxDays?: number
    nowMs?: number
    initialDelayMs?: number
    dailyHour?: number
    dailyMinute?: number
    batchPlayers?: number
    pauseMs?: number
    busyRetryAttempts?: number
    busyRetryDelayMs?: number
    deleteBatchRows?: number
    logger?: ReceiveHistoryRetentionLogger
}

interface ResolvedReceiveHistoryRetentionOptions {
    executeTransaction: ReceiveHistoryRetentionOptions["executeTransaction"]
    enabled: boolean
    maxRows: number
    maxDays: number
    nowMs: number
    initialDelayMs: number | null
    dailyHour: number
    dailyMinute: number
    batchPlayers: number
    pauseMs: number
    busyRetryAttempts: number
    busyRetryDelayMs: number
    deleteBatchRows: number
    logger: ReceiveHistoryRetentionLogger
}

export interface ReceiveHistoryRetentionPassResult {
    candidatePlayers: number
    processedPlayers: number
    prunedPlayers: number
    deletedRows: number
    failedPlayers: number
    stopped: boolean
    elapsedMs: number
}

export interface ReceiveHistoryRetentionService {
    start(): void
    stop(): Promise<void>
}

export interface ReceiveHistoryRetentionSchedule {
    hour: number
    minute: number
}

function normalizedInteger(value: number | undefined, fallback: number, minimum: number): number {
    if (!Number.isSafeInteger(value) || value === undefined || value < minimum) return fallback
    return value
}

function normalizedBoundedInteger(
    value: number | undefined,
    fallback: number,
    minimum: number,
    maximum: number,
): number {
    if (!Number.isSafeInteger(value) || value === undefined || value < minimum || value > maximum) {
        return fallback
    }
    return value
}

function environmentInteger(name: string): number | undefined {
    const value = Number.parseInt(process.env[name] ?? "", 10)
    return Number.isSafeInteger(value) ? value : undefined
}

export function isReceiveHistoryRetentionEnabled(
    env: NodeJS.ProcessEnv = process.env,
): boolean {
    const value = env.RECEIVE_HISTORY_RETENTION_ENABLED?.trim().toLowerCase()
    return value !== "0" && value !== "false" && value !== "off" && value !== "no"
}

export function getReceiveHistoryRetentionSchedule(
    env: NodeJS.ProcessEnv = process.env,
): ReceiveHistoryRetentionSchedule {
    const value = env.RECEIVE_HISTORY_RETENTION_TIME?.trim() ?? ""
    const match = /^(\d{1,2}):(\d{2})$/.exec(value)
    if (!match) return { hour: DEFAULT_DAILY_HOUR, minute: DEFAULT_DAILY_MINUTE }
    const hour = Number(match[1])
    const minute = Number(match[2])
    if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) {
        return { hour: DEFAULT_DAILY_HOUR, minute: DEFAULT_DAILY_MINUTE }
    }
    return { hour, minute }
}

export function millisecondsUntilNextReceiveHistoryRetentionRun(
    now: Date,
    hour: number,
    minute: number,
): number {
    const nextRun = new Date(now.getTime())
    nextRun.setHours(hour, minute, 0, 0)
    if (nextRun.getTime() <= now.getTime()) nextRun.setDate(nextRun.getDate() + 1)
    return Math.max(1, nextRun.getTime() - now.getTime())
}

function resolveOptions(options: ReceiveHistoryRetentionOptions): ResolvedReceiveHistoryRetentionOptions {
    const schedule = getReceiveHistoryRetentionSchedule()
    return {
        executeTransaction: options.executeTransaction,
        enabled: options.enabled ?? isReceiveHistoryRetentionEnabled(),
        maxRows: normalizedInteger(options.maxRows, DEFAULT_MAX_ROWS, 1),
        maxDays: normalizedInteger(options.maxDays, 7, 1),
        nowMs: options.nowMs ?? Date.now(),
        initialDelayMs: options.initialDelayMs === undefined
            ? null
            : normalizedInteger(options.initialDelayMs, 0, 0),
        dailyHour: normalizedBoundedInteger(options.dailyHour, schedule.hour, 0, 23),
        dailyMinute: normalizedBoundedInteger(options.dailyMinute, schedule.minute, 0, 59),
        batchPlayers: normalizedInteger(options.batchPlayers, DEFAULT_BATCH_PLAYERS, 1),
        pauseMs: normalizedInteger(options.pauseMs, DEFAULT_PAUSE_MS, 0),
        busyRetryAttempts: normalizedInteger(
            options.busyRetryAttempts,
            DEFAULT_BUSY_RETRY_ATTEMPTS,
            1,
        ),
        busyRetryDelayMs: normalizedInteger(
            options.busyRetryDelayMs,
            DEFAULT_BUSY_RETRY_DELAY_MS,
            0,
        ),
        deleteBatchRows: normalizedBoundedInteger(
            options.deleteBatchRows ?? environmentInteger("RECEIVE_HISTORY_RETENTION_DELETE_BATCH_ROWS"),
            DEFAULT_DELETE_BATCH_ROWS,
            1,
            MAX_DELETE_BATCH_ROWS,
        ),
        logger: options.logger ?? console,
    }
}

function delay(milliseconds: number): Promise<void> {
    if (milliseconds > 0) return new Promise(resolve => setTimeout(resolve, milliseconds))
    // Promise.resolve() only yields to the microtask queue. Since
    // better-sqlite3 runs synchronously, use libuv's check phase even when the
    // configured pause is zero so HTTP/TCP callbacks get a scheduling chance.
    return new Promise(resolve => setImmediate(resolve))
}

function isSqliteBusyError(error: unknown): boolean {
    if (!(error instanceof Error) || !("code" in error)) return false
    const code = String((error as Error & { code?: string }).code ?? "")
    return code === "SQLITE_BUSY" || code === "SQLITE_BUSY_SNAPSHOT" || code.startsWith("SQLITE_BUSY_")
}

function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

async function prunePlayerWithRetry(
    database: Database,
    playerId: number,
    maxRows: number,
    maxAttempts: number,
    retryDelayMs: number,
    deleteBatchRows: number,
    cutoff: string,
    executeTransaction: ReceiveHistoryRetentionOptions["executeTransaction"],
    shouldStop: () => boolean,
    beforePrune: () => void,
): Promise<number> {
    const prune = database.prepare(`
        DELETE FROM players_receive_history
        WHERE id IN (SELECT id FROM players_receive_history WHERE player_id = ?
          AND (julianday(create_time) < julianday(?) OR id NOT IN (
              SELECT id
              FROM players_receive_history
              WHERE player_id = ?
              ORDER BY create_time DESC, id DESC
              LIMIT ?
          )) LIMIT ${deleteBatchRows})
    `)

    const operation = (): number => {
        // Recheck after queuing: shutdown can start while a player's earlier
        // write is still running. Refresh the lease in this same transaction.
        if (shouldStop()) return 0
        beforePrune()
        return prune.run(playerId, cutoff, playerId, maxRows).changes
    }
    if (executeTransaction) {
        return executeTransaction({ domain: "maintenance", playerId, operation: "receive_history_prune" }, operation)
    }

    let lastError: unknown
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        let began = false
        try {
            database.exec("BEGIN IMMEDIATE")
            began = true
            const deletedRows = operation()
            database.exec("COMMIT")
            return deletedRows
        } catch (error) {
            if (began && database.inTransaction) {
                try { database.exec("ROLLBACK") } catch {}
            }
            if (!isSqliteBusyError(error) || attempt >= maxAttempts) throw error
            lastError = error
            await delay(retryDelayMs * (2 ** (attempt - 1)))
        }
    }
    throw lastError
}

export async function runReceiveHistoryRetentionPass(
    database: Database,
    options: ReceiveHistoryRetentionOptions = {},
    shouldStop: () => boolean = () => false,
    beforePrune: () => void = () => {},
): Promise<ReceiveHistoryRetentionPassResult> {
    const config = resolveOptions(options)
    const cutoff = new Date(config.nowMs - config.maxDays * 86400_000).toISOString()
    const startedAt = Date.now()
    const result: ReceiveHistoryRetentionPassResult = {
        candidatePlayers: 0,
        processedPlayers: 0,
        prunedPlayers: 0,
        deletedRows: 0,
        failedPlayers: 0,
        stopped: false,
        elapsedMs: 0,
    }
    if (!config.enabled) {
        result.elapsedMs = Date.now() - startedAt
        return result
    }

    const selectCandidates = database.prepare(`
        SELECT player_id, COUNT(*) AS record_count
        FROM players_receive_history
        WHERE player_id > ?
        GROUP BY player_id
        HAVING COUNT(*) > ? OR MIN(julianday(create_time)) < julianday(?)
        ORDER BY player_id
        LIMIT ?
    `)

    let playerCursor = 0
    while (!shouldStop()) {
        const candidates = selectCandidates.all(
            playerCursor,
            config.maxRows,
            cutoff,
            config.batchPlayers,
        ) as ReceiveHistoryCandidateRow[]
        if (candidates.length === 0) break

        for (const candidate of candidates) {
            playerCursor = candidate.player_id
            if (shouldStop()) {
                result.stopped = true
                break
            }
            result.candidatePlayers += 1
            try {
                let deletedRows = 0
                let batchRows: number
                do {
                if (shouldStop()) { result.stopped = true; break }
                batchRows = await prunePlayerWithRetry(
                    database,
                    candidate.player_id,
                    config.maxRows,
                    config.busyRetryAttempts,
                    config.busyRetryDelayMs,
                    config.deleteBatchRows,
                    cutoff,
                    config.executeTransaction,
                    shouldStop,
                    beforePrune,
                )
                deletedRows += batchRows
                result.deletedRows += batchRows
                if (batchRows === config.deleteBatchRows) await delay(config.pauseMs)
                } while (batchRows === config.deleteBatchRows)
                result.processedPlayers += 1
                if (deletedRows > 0) result.prunedPlayers += 1
            } catch (error) {
                result.failedPlayers += 1
                config.logger.warn(
                    `[DB_MAINTENANCE] receive history retention failed for player ${candidate.player_id}: ${describeError(error)}`,
                )
            }
            if (!shouldStop()) await delay(config.pauseMs)
        }
        if (result.stopped) break
    }
    if (shouldStop()) result.stopped = true
    result.elapsedMs = Date.now() - startedAt
    return result
}

export function createReceiveHistoryRetentionService(
    database: Database,
    options: ReceiveHistoryRetentionOptions = {},
): ReceiveHistoryRetentionService {
    initializeMaintenanceState(database)
    const persisted = readHistoryPolicy(database)
    const envSchedule = process.env.RECEIVE_HISTORY_RETENTION_TIME ? getReceiveHistoryRetentionSchedule() : null
    const config = resolveOptions({ ...persisted, ...envSchedule && {dailyHour:envSchedule.hour,dailyMinute:envSchedule.minute}, ...options })
    let stopped = true
    let timer: NodeJS.Timeout | null = null
    let activePass: Promise<void> | null = null
    const write = async <T>(operation: string, action: () => T): Promise<T> => {
        if (config.executeTransaction) {
            return config.executeTransaction({ domain: "maintenance", operation }, action)
        }
        return database.transaction(action).immediate()
    }

    const schedule = (overrideDelayMs: number | null = null): void => {
        if (stopped || isServerShuttingDown() || !config.enabled || timer !== null) return
        const now = new Date()
        const delayMs = overrideDelayMs ?? millisecondsUntilNextReceiveHistoryRetentionRun(
            now,
            config.dailyHour,
            config.dailyMinute,
        )
        const nextRunAt = new Date(now.getTime() + delayMs)
        config.logger.log(
            `[DB_MAINTENANCE] receive history retention scheduled: nextRunAt=${nextRunAt.toString()}`,
        )
        timer = setTimeout(() => {
            timer = null
            if (stopped || isServerShuttingDown()) return
            activePass = withServerWorkAdmission(async () => {
                let lease: ReturnType<typeof acquireHistoryLease> = null
                try {
                    lease = await write("receive_history_acquire", () => stopped ? null : acquireHistoryLease(database))
                    if (!lease) return
                    const result = await runReceiveHistoryRetentionPass(
                        database,
                        {
                            enabled: config.enabled,
                            maxRows: config.maxRows,
                            maxDays: config.maxDays,
                            batchPlayers: config.batchPlayers,
                            pauseMs: config.pauseMs,
                            busyRetryAttempts: config.busyRetryAttempts,
                            busyRetryDelayMs: config.busyRetryDelayMs,
                            deleteBatchRows: config.deleteBatchRows,
                            logger: config.logger,
                            executeTransaction: config.executeTransaction,
                        },
                        () => stopped,
                        () => { if (lease) refreshHistoryLease(database, lease) },
                    )
                    const completedLease = lease
                    await write("receive_history_complete", () => finishHistoryLease(database, completedLease, result,
                        !result.stopped && result.failedPlayers === 0,
                        result.failedPlayers > 0 ? `${result.failedPlayers} players failed` : result.stopped ? "interrupted" : null))
                    lease = null
                    config.logger.log(
                        `[DB_MAINTENANCE] receive history retention completed: candidates=${result.candidatePlayers} prunedPlayers=${result.prunedPlayers} deletedRows=${result.deletedRows} failures=${result.failedPlayers} stopped=${result.stopped} elapsedMs=${result.elapsedMs}`,
                    )
                } catch (error) {
                    if (lease) {
                        const failedLease = lease
                        try {
                            await write("receive_history_failed", () => finishHistoryLease(database, failedLease, undefined, false, describeError(error)))
                        } catch {}
                    }
                    config.logger.warn(
                        `[DB_MAINTENANCE] receive history retention pass failed: ${describeError(error)}`,
                    )
                }
            })
            void activePass.then(() => {
                activePass = null
                if (!stopped) schedule(isHistoryCatchupNeeded(database,config.dailyHour,config.dailyMinute) ? 120_000 : null)
            })
        }, delayMs)
        timer.unref()
    }

    return {
        start(): void {
            if (!stopped || isServerShuttingDown()) return
            stopped = false
            if (!config.enabled) {
                config.logger.log(
                    "[DB_MAINTENANCE] receive history retention disabled by RECEIVE_HISTORY_RETENTION_ENABLED",
                )
                return
            }
            config.logger.log(
                `[DB_MAINTENANCE] receive history retention enabled: maxRows=${config.maxRows} dailyTime=${String(config.dailyHour).padStart(2, "0")}:${String(config.dailyMinute).padStart(2, "0")} localServerTime`,
            )
            schedule(config.initialDelayMs ?? (isHistoryCatchupNeeded(database,config.dailyHour,config.dailyMinute) ? 10_000 : null))
        },
        async stop(): Promise<void> {
            stopped = true
            if (timer !== null) {
                clearTimeout(timer)
                timer = null
            }
            if (activePass !== null) await activePass
        },
    }
}
