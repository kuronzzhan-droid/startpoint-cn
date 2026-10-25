import path from "node:path"
import { existsSync } from "../lib/file-exists"
import { Worker } from "node:worker_threads"
import { observeWorkerMemory, registerMemoryCounters } from "./memory-diagnostics"
import { sqliteSettings } from "./sqlite-settings"
import { nativeSqliteWrites } from "./sqlite-native-writes"

export interface SqlitePersistenceStatement {
    sql: string
    params: readonly unknown[]
}

export interface SqlitePersistenceCommand {
    operation: string
    statements: readonly SqlitePersistenceStatement[]
}

export interface SqlitePersistenceResult {
    changes: number
    lastInsertRowid: number | null
}

interface PendingCommand {
    id: number
    command: SqlitePersistenceCommand
    resolve: (result: SqlitePersistenceResult) => void
    reject: (error: Error) => void
}

interface WorkerState {
    enabled: boolean
    started: boolean
    queued: number
    completed: number
    failed: number
    busyRetries: number
    lastDurationMs: number | null
    lastError: string | null
    synchronous: number | null
    cacheSize: number | null
    mmapSize: number | null
    walAutocheckpoint: number | null
}

let worker: Worker | null = null
let workerReady = false
let closing = false
let nextId = 1
let active: PendingCommand | null = null
const queue: PendingCommand[] = []
const nativeCommands = new WeakMap<Worker, Map<number, () => void>>()
let closeResolve: (() => void) | null = null

const state: WorkerState = {
    enabled: false,
    started: false,
    queued: 0,
    completed: 0,
    failed: 0,
    busyRetries: 0,
    lastDurationMs: null,
    lastError: null,
    synchronous: null,
    cacheSize: null,
    mmapSize: null,
    walAutocheckpoint: null,
}

registerMemoryCounters("sqlitePersistence", () => ({
    enabled: state.enabled,
    started: state.started,
    queued: state.queued,
    completed: state.completed,
    failed: state.failed,
    pending: queue.length + (active ? 1 : 0),
    busyRetries: state.busyRetries,
    lastDurationMs: state.lastDurationMs,
    lastError: state.lastError !== null,
    lastErrorLength: state.lastError?.length ?? 0,
    synchronous: state.synchronous,
    cacheSize: state.cacheSize,
    mmapSize: state.mmapSize,
    walAutocheckpoint: state.walAutocheckpoint,
}), "sqlite")

function enabled(environment: NodeJS.ProcessEnv = process.env): boolean {
    return /^(1|true|yes|on)$/i.test(environment.SQLITE_PERSISTENCE_WORKER ?? "")
}

function workerLocation(): { filename: string, execArgv?: string[] } {
    const compiled = path.resolve(__dirname, "../workers/sqlite-persistence-worker.js")
    if (existsSync(compiled)) return { filename: compiled }
    return {
        filename: path.resolve(__dirname, "../workers/sqlite-persistence-worker.ts"),
        execArgv: ["-r", require.resolve("ts-node/register/transpile-only")],
    }
}

function errorFromMessage(message: any): Error & { code?: string } {
    const error = new Error(String(message?.error ?? "SQLite persistence worker failed")) as Error & { code?: string }
    if (message?.code) error.code = String(message.code)
    return error
}

function rejectAll(error: Error): void {
    if (active) {
        active.reject(error)
        active = null
    }
    while (queue.length > 0) queue.shift()!.reject(error)
}

function pump(): void {
    if (!worker || !workerReady || closing || active || queue.length === 0) return
    active = queue.shift()!
    const current = worker
    const native = nativeCommands.get(current)!
    const releaseNative = nativeSqliteWrites.acquire()
    native.set(active.id, releaseNative)
    try {
        current.postMessage({
            id: active.id,
            operation: active.command.operation,
            statements: active.command.statements,
        })
    } catch (error) {
        native.delete(active.id)
        releaseNative()
        const failedCommand = active
        active = null
        failedCommand.reject(error instanceof Error ? error : new Error(String(error)))
        pump()
    }
}

export function startSqlitePersistenceWorker(
    databasePath: string,
    environment: NodeJS.ProcessEnv = process.env,
): boolean {
    if (worker || !enabled(environment)) return worker !== null
    state.enabled = true
    state.started = false
    workerReady = false
    closing = false
    const location = workerLocation()
    const parsedBusyTimeoutMs = Number.parseInt(environment.SQLITE_PERSISTENCE_BUSY_TIMEOUT_MS ?? "1000", 10)
    const busyTimeoutMs = Number.isFinite(parsedBusyTimeoutMs) ? Math.max(0, parsedBusyTimeoutMs) : 1_000
    const maxAttempts = Math.max(1, Number.parseInt(environment.SQLITE_PERSISTENCE_MAX_ATTEMPTS ?? "3", 10) || 3)
    const settings = sqliteSettings(environment)
    const releaseStartup = nativeSqliteWrites.acquire()
    let current: Worker
    try { current = new Worker(location.filename, {
        ...(location.execArgv ? { execArgv: location.execArgv } : {}),
        workerData: { databasePath, busyTimeoutMs, maxAttempts, settings },
    }) } catch (error) { releaseStartup(); throw error }
    const native = new Map<number, () => void>()
    nativeCommands.set(current, native)
    worker = current
    observeWorkerMemory("sqlite-persistence", current)
    current.once("online", () => {
        if (worker !== current) return
        workerReady = true
        state.started = true
        pump()
    })
    current.on("message", message => {
        if (message?.type === "result" || message?.type === "error") {
            const id = Number(message.id)
            const release = native.get(id)
            native.delete(id)
            release?.()
        }
        if (worker !== current) return
        if (message?.type === "settings") {
            releaseStartup()
            state.synchronous = Number.isFinite(Number(message.synchronous))
                ? Number(message.synchronous) : null
            state.cacheSize = Number.isFinite(Number(message.cacheSize))
                ? Number(message.cacheSize) : null
            state.mmapSize = Number.isFinite(Number(message.mmapSize))
                ? Number(message.mmapSize) : null
            state.walAutocheckpoint = Number.isFinite(Number(message.walAutocheckpoint))
                ? Number(message.walAutocheckpoint) : null
            return
        }
        if (message?.type === "result" || message?.type === "error") {
            const command = active
            if (!command || command.id !== message.id) return
            active = null
            if (message.type === "result") {
                state.completed++
                command.resolve({
                    changes: Number(message.changes) || 0,
                    lastInsertRowid: Number.isFinite(Number(message.lastInsertRowid))
                        ? Number(message.lastInsertRowid) : null,
                })
            } else {
                state.failed++
                state.lastError = String(message.error ?? "SQLite persistence worker failed").slice(0, 240)
                command.reject(errorFromMessage(message))
            }
            pump()
            return
        }
        if (message?.type === "closed") {
            state.started = false
            closeResolve?.()
            closeResolve = null
        }
    })
    current.on("error", error => {
        if (worker !== current) return
        // Native SqliteError startup failures may cross the Worker boundary as
        // a plain object. Normalize them before updating metrics/rejecting.
        const details = error as unknown as { message?: unknown, code?: unknown }
        const failure = error instanceof Error ? error : errorFromMessage({
            error: details?.message ?? error,
            code: details?.code,
        })
        state.failed++
        state.lastError = failure.message.slice(0, 240)
        workerReady = false
        state.started = false
        rejectAll(failure)
    })
    current.once("exit", code => {
        releaseStartup()
        const outstanding = [...native.values()]
        native.clear()
        nativeCommands.delete(current)
        for (const release of outstanding) release()
        if (worker !== current) return
        worker = null
        workerReady = false
        state.started = false
        if (code !== 0 && !closing) {
            const error = new Error(`SQLite persistence worker exited (code ${code})`)
            state.failed++
            state.lastError = error.message
            rejectAll(error)
        }
    })
    console.log(`[DB] sqlite persistence worker enabled busyTimeoutMs=${busyTimeoutMs} maxAttempts=${maxAttempts}`)
    return true
}

export function isSqlitePersistenceWorkerStarted(): boolean {
    return worker !== null
}

export function setSqlitePersistenceCheckpointOwner(external: boolean): void {
    try {
        worker?.postMessage({
            type: "checkpoint_owner",
            external,
        })
    } catch {
        // A worker exiting during ownership handoff will be replaced or the
        // main connection will retain automatic checkpointing.
    }
}

export function executeSqlitePersistenceCommand(
    command: SqlitePersistenceCommand,
): Promise<SqlitePersistenceResult> {
    if (!worker || closing) return Promise.reject(new Error("SQLite persistence worker is not running."))
    return new Promise<SqlitePersistenceResult>((resolve, reject) => {
        state.queued++
        queue.push({ id: nextId++, command, resolve, reject })
        pump()
    })
}

export async function drainSqlitePersistenceWorker(): Promise<void> {
    while (active || queue.length > 0) {
        await new Promise(resolve => setTimeout(resolve, 0))
    }
}

export async function stopSqlitePersistenceWorker(): Promise<void> {
    const current = worker
    if (!current) return
    await drainSqlitePersistenceWorker()
    closing = true
    if (!workerReady) {
        worker = null
        try { await current.terminate() } catch {}
        state.started = false
        return
    }
    workerReady = false
    await new Promise<void>(resolve => {
        closeResolve = resolve
        try { current.postMessage({ type: "close" }) } catch { resolve() }
    })
    worker = null
    try { await current.terminate() } catch {}
    state.started = false
}
