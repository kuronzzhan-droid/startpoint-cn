import path from "node:path"
import { existsSync } from "../lib/file-exists"
import { Worker } from "node:worker_threads"
import { observeWorkerMemory, registerMemoryCounters } from "./memory-diagnostics"
import { multicoreConfig } from "./multicore-config"
import { createSqliteWalMaintenance } from "./sqlite-wal-maintenance"
import { SQLITE_WAL_JOURNAL_SIZE_LIMIT_BYTES } from "./sqlite-settings"

interface CheckpointState {
    enabled: boolean
    started: boolean
    completed: number
    errors: number
    busy: number
    truncateAttempts: number
    truncateCompleted: number
    truncateBusy: number
    lastDurationMs: number | null
    lastWasTruncate: boolean
    lastWalBytes: number | null
    lastPassiveLogFrames: number | null
    lastPassiveCheckpointedFrames: number | null
    lastLogFrames: number | null
    lastCheckpointedFrames: number | null
    lastError: string | null
    reclaimAttempts: number
    reclaimBusy: number
    reclaimWindows: number
    reclaimErrors: number
    reclaimResetsObserved: number
    reclaimedBytes: number
    lastReclaimedBytes: number | null
    lastReclaimWindowMs: number | null
    maxReclaimWindowMs: number
}

interface CheckpointOwnershipCallbacks {
    onReady?: () => void
    onStopped?: () => void
}

export function createCheckpointOwnershipController(
    callbacks: CheckpointOwnershipCallbacks = {},
    failureThreshold = 3,
): {
    checkpointSucceeded: () => void
    checkpointFailed: () => void
    workerStopped: () => void
} {
    let externalOwner = false
    let consecutiveErrors = 0
    const threshold = Math.max(1, Math.trunc(failureThreshold))

    return {
        checkpointSucceeded: () => {
            consecutiveErrors = 0
            if (externalOwner) return
            externalOwner = true
            callbacks.onReady?.()
        },
        checkpointFailed: () => {
            consecutiveErrors++
            if (!externalOwner || consecutiveErrors < threshold) return
            externalOwner = false
            callbacks.onStopped?.()
        },
        workerStopped: () => {
            if (!externalOwner) return
            externalOwner = false
            callbacks.onStopped?.()
        },
    }
}

let worker: Worker | null = null
const maintenanceByWorker = new WeakMap<Worker, ReturnType<typeof createSqliteWalMaintenance>>()
const state: CheckpointState = {
    enabled: false, started: false, completed: 0, errors: 0, busy: 0,
    truncateAttempts: 0, truncateCompleted: 0, truncateBusy: 0,
    lastDurationMs: null, lastLogFrames: null, lastCheckpointedFrames: null,
    lastWasTruncate: false, lastWalBytes: null, lastPassiveLogFrames: null,
    lastPassiveCheckpointedFrames: null, lastError: null,
    reclaimAttempts: 0, reclaimBusy: 0, reclaimWindows: 0, reclaimErrors: 0, reclaimResetsObserved: 0,
    reclaimedBytes: 0, lastReclaimedBytes: null, lastReclaimWindowMs: null, maxReclaimWindowMs: 0,
}

registerMemoryCounters("sqliteCheckpoint", () => ({
    enabled: state.enabled, started: state.started, completed: state.completed,
    errors: state.errors, busy: state.busy, truncateAttempts: state.truncateAttempts,
    truncateCompleted: state.truncateCompleted, truncateBusy: state.truncateBusy,
    lastDurationMs: state.lastDurationMs, lastWasTruncate: state.lastWasTruncate,
    lastWalBytes: state.lastWalBytes,
    lastPassiveLogFrames: state.lastPassiveLogFrames,
    lastPassiveCheckpointedFrames: state.lastPassiveCheckpointedFrames,
    lastLogFrames: state.lastLogFrames,
    lastCheckpointedFrames: state.lastCheckpointedFrames,
    lastError: state.lastError !== null,
    lastErrorLength: state.lastError?.length ?? 0,
    reclaimAttempts: state.reclaimAttempts, reclaimBusy: state.reclaimBusy,
    reclaimWindows: state.reclaimWindows, reclaimErrors: state.reclaimErrors,
    reclaimResetsObserved: state.reclaimResetsObserved,
    reclaimedBytes: state.reclaimedBytes, lastReclaimedBytes: state.lastReclaimedBytes,
    lastReclaimWindowMs: state.lastReclaimWindowMs, maxReclaimWindowMs: state.maxReclaimWindowMs,
}), "sqlite")

function enabled(environment: NodeJS.ProcessEnv = process.env): boolean {
    return multicoreConfig(environment).checkpointWorker
}

function workerLocation(): { filename: string, execArgv?: string[] } {
    const compiled = path.resolve(__dirname, "../workers/sqlite-checkpoint-worker.js")
    if (existsSync(compiled)) return { filename: compiled }
    return {
        filename: path.resolve(__dirname, "../workers/sqlite-checkpoint-worker.ts"),
        execArgv: ["-r", require.resolve("ts-node/register/transpile-only")],
    }
}

export function startSqliteCheckpointWorker(
    databasePath: string,
    environment: NodeJS.ProcessEnv = process.env,
    callbacks: CheckpointOwnershipCallbacks = {},
): void {
    if (worker || !enabled(environment)) return
    const ownership = createCheckpointOwnershipController(callbacks)
    state.enabled = true
    state.started = false
    const location = workerLocation()
    const intervalMs = Math.max(1_000, Number.parseInt(environment.SQLITE_CHECKPOINT_INTERVAL_MS ?? "5000", 10) || 5_000)
    const current = new Worker(location.filename, {
        ...(location.execArgv ? { execArgv: location.execArgv } : {}),
        workerData: { databasePath, intervalMs },
    })
    worker = current
    const maintenance = createSqliteWalMaintenance(databasePath, result => {
        if (worker !== current) return
        state.reclaimWindows++
        state.reclaimAttempts += result.attempted ? 1 : 0
        state.reclaimBusy += result.busy ? 1 : 0
        state.reclaimResetsObserved += result.resetObserved ? 1 : 0
        state.reclaimedBytes += result.reclaimedBytes
        state.lastReclaimedBytes = result.reclaimedBytes
        state.lastWalBytes = result.walBytes
        state.lastReclaimWindowMs = result.windowMs
        state.maxReclaimWindowMs = Math.max(state.maxReclaimWindowMs, result.windowMs)
    }, error => {
        if (worker !== current) return
        state.errors++
        state.reclaimErrors++
        state.lastError = error instanceof Error ? error.message.slice(0, 240) : String(error).slice(0, 240)
    })
    maintenanceByWorker.set(current, maintenance)
    observeWorkerMemory("sqlite-checkpoint", current)
    current.on("online", () => { state.started = true })
    current.on("message", message => {
        if (worker !== current) return
        if (message?.type === "checkpoint") {
            ownership.checkpointSucceeded()
            state.completed++
            state.busy += message.busy === 1 ? 1 : 0
            state.truncateAttempts += message.truncateAttempted === true ? 1 : 0
            state.truncateCompleted += message.truncateAttempted === true && message.truncateBusy === 0 ? 1 : 0
            state.truncateBusy += Number(message.truncateBusy) === 1 ? 1 : 0
            state.lastDurationMs = Number(message.durationMs) || 0
            state.lastWasTruncate = message.mode === "truncate"
            state.lastWalBytes = Number.isFinite(Number(message.walBytes)) ? Number(message.walBytes) : null
            state.lastPassiveLogFrames = Number.isFinite(Number(message.passiveLogFrames))
                ? Number(message.passiveLogFrames) : null
            state.lastPassiveCheckpointedFrames = Number.isFinite(Number(message.passiveCheckpointedFrames))
                ? Number(message.passiveCheckpointedFrames) : null
            state.lastLogFrames = Number(message.logFrames) || 0
            state.lastCheckpointedFrames = Number(message.checkpointedFrames) || 0
            state.lastError = null
            if (Number(message.busy) === 0
                && state.lastPassiveLogFrames === state.lastPassiveCheckpointedFrames
                && Number(message.walBytes) > SQLITE_WAL_JOURNAL_SIZE_LIMIT_BYTES) maintenance.request()
        } else if (message?.type === "checkpoint_error") {
            state.errors++
            state.lastDurationMs = Number(message.durationMs) || 0
            state.lastError = String(message.error ?? "checkpoint failed").slice(0, 240)
            ownership.checkpointFailed()
        }
    })
    current.on("error", error => {
        if (worker !== current) return
        state.errors++
        state.lastError = error.message.slice(0, 240)
    })
    current.once("exit", () => {
        maintenance.close()
        maintenanceByWorker.delete(current)
        const replaced = worker !== null && worker !== current
        if (worker === current) worker = null
        if (!replaced) {
            state.enabled = false
            state.started = false
        }
        if (!replaced) ownership.workerStopped()
    })
    console.log(`[DB] sqlite checkpoint worker enabled intervalMs=${intervalMs}`
        + " mode=PASSIVE busyTimeoutMs=0")
}

export async function stopSqliteCheckpointWorker(): Promise<void> {
    const current = worker
    if (!current) return
    maintenanceByWorker.get(current)?.close()
    await new Promise<void>(resolve => {
        let settled = false
        const finish = () => {
            if (settled) return
            settled = true
            clearTimeout(timer)
            current.off("message", receive)
            current.off("exit", finish)
            resolve()
        }
        const receive = (message: unknown) => {
            if ((message as { type?: string })?.type === "closed") finish()
        }
        const timer = setTimeout(finish, 5_000)
        timer.unref()
        current.on("message", receive)
        current.once("exit", finish)
        try { current.postMessage({ type: "close" }) } catch { finish() }
    })
    if (worker === current) worker = null
    await current.terminate()
    state.enabled = false
    state.started = false
}

export function requestSqliteCheckpoint(): void {
    try { worker?.postMessage({ type: "checkpoint_now" }) } catch {}
}
