import path from "node:path"
import { Worker } from "node:worker_threads"
import { existsSync } from "../file-exists"
import { observeWorkerMemory, registerMemoryCounters } from "../memory-diagnostics"
import type { WriterCommandMeta } from "./command-registry"
import { WRITER_PROTOCOL_VERSION, writerThreadConfig, type WriterThreadConfig } from "./writer-config"
import { getServerClockSnapshot, onServerClockSnapshotChanged } from "../../utils"
import { nativeSqliteWrites } from "../sqlite-native-writes"

export interface SqliteWriterCommand {
    name: string
    args: unknown
    meta: WriterCommandMeta
}

interface WaitingCommand {
    id: number
    command: SqliteWriterCommand
    resolve: (value: unknown) => void
    reject: (error: Error) => void
    timer: NodeJS.Timeout | null
}

export class SqliteWriterError extends Error {
    readonly code: string

    constructor(message: string, code: string) {
        super(message)
        this.name = "SqliteWriterError"
        this.code = code
    }
}

const state = {
    enabled: false,
    started: false,
    ready: false,
    closing: false,
    submitted: 0,
    completed: 0,
    failed: 0,
    queueFull: 0,
    timeouts: 0,
    restarts: 0,
    abandoned: 0,
    inFlight: 0,
    waiting: 0,
    maxWaiting: 0,
    maxInFlight: 0,
    batches: 0,
    lastBatchSize: 0,
    maxBatchSize: 0,
    lastCommitMs: 0,
    totalCommitMs: 0,
    savepointRollbacks: 0,
    lastError: null as string | null,
}

let config: WriterThreadConfig = writerThreadConfig()
let worker: Worker | null = null
let databasePath: string | null = null
let nextId = 1
let restartTimer: NodeJS.Timeout | null = null
let closeResolve: (() => void) | null = null
const inFlight = new Map<number, WaitingCommand>()
const waiting: WaitingCommand[] = []
const nativeCommands = new WeakMap<Worker, Map<number, () => void>>()

// Registered in the default counter group on purpose: writer health
// (submitted/failed/timeouts/restarts/batches) is an operational metric and
// must stay visible while SQLITE_DIAGNOSTICS is off, which is the production
// default.
registerMemoryCounters("sqliteWriter", () => ({
    enabled: state.enabled,
    started: state.started,
    ready: state.ready,
    submitted: state.submitted,
    completed: state.completed,
    failed: state.failed,
    queueFull: state.queueFull,
    timeouts: state.timeouts,
    restarts: state.restarts,
    abandoned: state.abandoned,
    inFlight: inFlight.size,
    waiting: waiting.length,
    maxWaiting: state.maxWaiting,
    maxInFlight: state.maxInFlight,
    batches: state.batches,
    lastBatchSize: state.lastBatchSize,
    maxBatchSize: state.maxBatchSize,
    lastCommitMs: state.lastCommitMs,
    totalCommitMs: state.totalCommitMs,
    savepointRollbacks: state.savepointRollbacks,
    groupCommitWindowMs: config.groupCommitWindowMs,
    groupCommitMax: config.groupCommitMax,
    lastError: state.lastError !== null,
    lastErrorLength: state.lastError?.length ?? 0,
}))

function workerLocation(): { filename: string, execArgv?: string[] } {
    // This module lives in lib/persistence, so the worker sits two levels up.
    const compiled = path.resolve(__dirname, "../../workers/sqlite-writer-worker.js")
    if (existsSync(compiled)) return { filename: compiled }
    return {
        filename: path.resolve(__dirname, "../../workers/sqlite-writer-worker.ts"),
        execArgv: ["-r", require.resolve("ts-node/register/transpile-only")],
    }
}

function recordError(error: unknown): void {
    state.lastError = (error instanceof Error ? error.message : String(error)).slice(0, 240)
}

function settle(command: WaitingCommand, error: Error | null, value?: unknown): void {
    if (command.timer !== null) {
        clearTimeout(command.timer)
        command.timer = null
    }
    inFlight.delete(command.id)
    if (error === null) command.resolve(value)
    else command.reject(error)
}

function rejectAll(error: Error): void {
    for (const command of [...inFlight.values()]) {
        state.abandoned++
        settle(command, error)
    }
    while (waiting.length > 0) {
        const command = waiting.shift()!
        state.abandoned++
        settle(command, error)
    }
}

function pump(): void {
    if (worker === null || !state.ready || state.closing) return
    while (inFlight.size < config.maxInFlight && waiting.length > 0) {
        const command = waiting.shift()!
        inFlight.set(command.id, command)
        state.maxInFlight = Math.max(state.maxInFlight, inFlight.size)
        if (config.commandTimeoutMs > 0) {
            command.timer = setTimeout(() => {
                if (!inFlight.has(command.id)) return
                state.timeouts++
                settle(command, new SqliteWriterError(
                    `SQLite writer command timed out after ${config.commandTimeoutMs}ms.`,
                    "SQLITE_WRITER_TIMEOUT",
                ))
                // The worker may still be inside the timed-out transaction, so
                // its state is unknown. Terminating the worker closes the
                // connection and lets SQLite roll the open transaction back.
                forceRestart("command timeout")
            }, config.commandTimeoutMs)
        }
        const current = worker
        const native = nativeCommands.get(current)!
        const releaseNative = nativeSqliteWrites.acquire()
        native.set(command.id, releaseNative)
        try {
            current.postMessage({
                type: "command",
                id: command.id,
                name: command.command.name,
                args: command.command.args,
                meta: command.command.meta,
            })
        } catch (error) {
            native.delete(command.id)
            releaseNative()
            settle(command, error instanceof Error ? error : new Error(String(error)))
            state.failed++
            recordError(error)
        }
    }
}

function forceRestart(reason: string): void {
    const current = worker
    if (current === null) return
    console.error(`[WRITER] restarting SQLite writer worker: ${reason}`)
    // Stop accepting work immediately. The exit event only fires after
    // terminate() completes, and a command dispatched in that window would be
    // sent to a dying worker.
    state.ready = false
    rejectAll(new SqliteWriterError(
        `SQLite writer worker is restarting: ${reason}`,
        "SQLITE_WRITER_RESTARTING",
    ))
    void current.terminate()
}

function scheduleRestart(): void {
    if (state.closing || databasePath === null || restartTimer !== null) return
    if (state.restarts >= config.maxRestarts) {
        console.error(
            `[WRITER] SQLite writer worker reached the restart limit (${config.maxRestarts}); `
            + "commands will fail until the service restarts.",
        )
        return
    }
    const attempt = state.restarts + 1
    restartTimer = setTimeout(() => {
        restartTimer = null
        if (state.closing || databasePath === null) return
        state.restarts++
        startWorker(databasePath)
    }, Math.min(1_000, 100 * attempt))
}

function startWorker(targetDatabasePath: string): void {
    const location = workerLocation()
    const releaseStartup = nativeSqliteWrites.acquire()
    let current: Worker
    try { current = new Worker(location.filename, {
        ...(location.execArgv ? { execArgv: location.execArgv } : {}),
        workerData: {
            databasePath: targetDatabasePath,
            busyTimeoutMs: config.busyTimeoutMs,
            groupCommitWindowMs: config.groupCommitWindowMs,
            groupCommitMax: config.groupCommitMax,
            protocolVersion: WRITER_PROTOCOL_VERSION,
            clockSnapshot: getServerClockSnapshot(),
        },
    }) } catch (error) { releaseStartup(); throw error }
    const native = new Map<number, () => void>()
    nativeCommands.set(current, native)
    worker = current
    state.started = true
    state.ready = false
    observeWorkerMemory("sqlite-writer", current)

    current.on("message", (message: any) => {
        // A timed-out caller may already have left inFlight. Its native work
        // is still active until this final ACK or the owning worker exits.
        if (message?.type === "result" || message?.type === "error") {
            const id = Number(message.id)
            const release = native.get(id)
            native.delete(id)
            release?.()
        }
        if (worker !== current) return
        switch (message?.type) {
            case "ready":
                if (message.protocolVersion !== WRITER_PROTOCOL_VERSION) {
                    forceRestart("clock protocol mismatch")
                    return
                }
                state.ready = true
                releaseStartup()
                // Synchronize both clock coordinates before queued commands.
                pushClockSnapshot()
                pump()
                return
            case "result":
            case "error": {
                const command = inFlight.get(Number(message.id))
                if (command === undefined) return
                if (message.type === "result") {
                    state.completed++
                    settle(command, null, message.value)
                } else {
                    state.failed++
                    const error = new SqliteWriterError(
                        String(message.error ?? "SQLite writer command failed."),
                        String(message.code ?? "SQLITE_WRITER_COMMAND_FAILED"),
                    )
                    recordError(error)
                    settle(command, error)
                }
                pump()
                return
            }
            case "fatal":
                recordError(message.error)
                console.error(`[WRITER] worker reported a fatal startup error: ${String(message.error)}`)
                return
            case "batch":
                state.batches++
                state.lastBatchSize = Number(message.size) || 0
                state.maxBatchSize = Math.max(state.maxBatchSize, state.lastBatchSize)
                state.lastCommitMs = Number(message.commitMs) || 0
                state.totalCommitMs += state.lastCommitMs
                state.savepointRollbacks += Number(message.rollbacks) || 0
                return
            case "closed":
                closeResolve?.()
                closeResolve = null
                return
            default:
                return
        }
    })
    current.on("error", error => {
        if (worker !== current) return
        recordError(error)
        console.error(`[WRITER] worker error: ${error.message}`)
        state.ready = false
    })
    current.once("exit", code => {
        // stop/restart may detach this worker before its native handles close.
        releaseStartup()
        const outstanding = [...native.values()]
        native.clear()
        nativeCommands.delete(current)
        for (const release of outstanding) release()
        if (worker !== current) return
        worker = null
        state.ready = false
        state.started = false
        if (!state.closing) {
            const reason = new SqliteWriterError(
                `SQLite writer worker exited (code ${code}).`,
                "SQLITE_WRITER_EXITED",
            )
            recordError(reason)
            rejectAll(reason)
            scheduleRestart()
        }
    })
    console.log(
        `[DB] sqlite writer thread enabled busyTimeoutMs=${config.busyTimeoutMs}`
        + ` groupCommitWindowMs=${config.groupCommitWindowMs} groupCommitMax=${config.groupCommitMax}`,
    )
}

export function writerThreadSettings(): WriterThreadConfig {
    return config
}

export function isSqliteWriterEnabled(): boolean {
    return config.enabled
}

export function isSqliteWriterReady(): boolean {
    return worker !== null && state.ready
}

/** Forward the complete business and preserved-battle coordinate together. */
function pushClockSnapshot(): void {
    const current = worker
    if (current === null) return
    try {
        current.postMessage({ type: "set_clock_snapshot", snapshot: getServerClockSnapshot() })
    } catch (error) {
        console.error(
            `[WRITER] failed to push the clock snapshot: ${error instanceof Error ? error.message : String(error)}`,
        )
    }
}

let clockSnapshotListenerRegistered = false

/** Keep later management-panel time changes in sync with the writer thread. */
function registerClockSnapshotListener(): void {
    if (clockSnapshotListenerRegistered) return
    clockSnapshotListenerRegistered = true
    onServerClockSnapshotChanged(() => pushClockSnapshot())
}

export function startSqliteWriter(targetDatabasePath: string, environment: NodeJS.ProcessEnv = process.env): boolean {
    config = writerThreadConfig(environment)
    state.enabled = config.enabled
    if (!config.enabled) return false
    registerClockSnapshotListener()
    if (worker !== null) return true
    // A previous stop() leaves the client closing; an explicit restart must
    // clear that so commands are accepted again.
    state.closing = false
    state.restarts = 0
    databasePath = targetDatabasePath
    startWorker(targetDatabasePath)
    return true
}

export function executeSqliteWriterCommand(command: SqliteWriterCommand): Promise<unknown> {
    if (worker === null || !state.ready || state.closing) {
        return Promise.reject(new SqliteWriterError(
            "SQLite writer worker is not running.",
            "SQLITE_WRITER_UNAVAILABLE",
        ))
    }
    if (waiting.length >= config.queueMax) {
        state.queueFull++
        return Promise.reject(new SqliteWriterError(
            `SQLite writer queue is full (${config.queueMax}).`,
            "SQLITE_WRITER_QUEUE_FULL",
        ))
    }
    state.submitted++
    return new Promise<unknown>((resolve, reject) => {
        const entry: WaitingCommand = {
            id: nextId++,
            command,
            resolve,
            reject,
            timer: null,
        }
        waiting.push(entry)
        state.waiting = waiting.length
        state.maxWaiting = Math.max(state.maxWaiting, waiting.length)
        pump()
    })
}

/** Tell the writer connection who owns WAL checkpointing. */
export function setSqliteWriterCheckpointOwner(external: boolean): void {
    try {
        worker?.postMessage({ type: "checkpoint_owner", external })
    } catch {
        // A worker exiting during the handoff keeps its automatic checkpoint
        // owner; the main connection follows the same rule.
    }
}

export function sqliteWriterQueueDepth(): number {
    return waiting.length + inFlight.size
}

export interface SqliteWriterStats {
    enabled: boolean
    ready: boolean
    submitted: number
    completed: number
    failed: number
    batches: number
    lastBatchSize: number
    maxBatchSize: number
    lastCommitMs: number
    totalCommitMs: number
    savepointRollbacks: number
    timeouts: number
    restarts: number
    inFlight: number
    waiting: number
}

export function sqliteWriterStats(): SqliteWriterStats {
    return {
        enabled: state.enabled,
        ready: state.ready,
        submitted: state.submitted,
        completed: state.completed,
        failed: state.failed,
        batches: state.batches,
        lastBatchSize: state.lastBatchSize,
        maxBatchSize: state.maxBatchSize,
        lastCommitMs: state.lastCommitMs,
        totalCommitMs: state.totalCommitMs,
        savepointRollbacks: state.savepointRollbacks,
        timeouts: state.timeouts,
        restarts: state.restarts,
        inFlight: inFlight.size,
        waiting: waiting.length,
    }
}

export async function drainSqliteWriter(): Promise<void> {
    while (worker !== null && (inFlight.size > 0 || waiting.length > 0)) {
        await new Promise(resolve => setTimeout(resolve, 0))
    }
}

/**
 * Wait briefly for the writer thread to finish starting.
 *
 * The worker loads the domain layer before it reports ready, so the first
 * requests after a restart must not fail just because the thread is still
 * warming up.
 */
export async function waitForSqliteWriterReady(timeoutMs: number): Promise<boolean> {
    if (isSqliteWriterReady()) return true
    if (!state.enabled || state.closing) return false
    const deadline = Date.now() + Math.max(0, timeoutMs)
    while (Date.now() < deadline) {
        if (isSqliteWriterReady()) return true
        if (worker === null && restartTimer === null) return false
        await new Promise(resolve => setTimeout(resolve, 25))
    }
    return isSqliteWriterReady()
}

export async function stopSqliteWriter(): Promise<void> {
    // Close the door first: a pending restart must not recreate the worker
    // while shutdown is in progress, and no new command may be accepted.
    state.closing = true
    state.ready = false
    if (restartTimer !== null) {
        clearTimeout(restartTimer)
        restartTimer = null
    }
    const current = worker
    if (current === null) {
        state.started = false
        return
    }
    await drainSqliteWriter()
    if (worker !== current) {
        // A restart replaced the worker while draining; stop the new one too.
        state.closing = false
        return stopSqliteWriter()
    }
    await new Promise<void>(resolve => {
        const timer = setTimeout(() => {
            closeResolve = null
            resolve()
        }, 5_000)
        closeResolve = () => {
            clearTimeout(timer)
            resolve()
        }
        try {
            current.postMessage({ type: "close" })
        } catch {
            clearTimeout(timer)
            closeResolve = null
            resolve()
        }
    })
    worker = null
    state.started = false
    try { await current.terminate() } catch { /* already gone */ }
}
