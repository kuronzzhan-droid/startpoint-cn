import Database from "better-sqlite3"
import fs from "node:fs"
import { parentPort, workerData } from "node:worker_threads"
import { performance } from "node:perf_hooks"
import { installWorkerMemoryProbe } from "../lib/memory-diagnostics"
import { applySqliteWalSizeLimit } from "../lib/sqlite-settings"

interface WorkerInput {
    databasePath: string
    intervalMs: number
}

const input = workerData as WorkerInput
const database = new Database(input.databasePath)
database.pragma("journal_mode = WAL")
database.pragma("synchronous = FULL")
applySqliteWalSizeLimit(database)
// Checkpoint maintenance must never wait behind a player transaction. A busy
// result is safe here: the next interval retries after the writer/reader has
// released its lock.
database.pragma("busy_timeout = 0")
database.pragma("wal_autocheckpoint = 0")

let closed = false
let checkpointRunning = false
let completed = 0
let errors = 0
let busy = 0

function walBytes(): number | null {
    try { return fs.statSync(`${input.databasePath}-wal`).size }
    catch { return null }
}

function numberValue(value: unknown): number {
    return Number.isFinite(Number(value)) ? Number(value) : 0
}

function checkpoint(): void {
    if (closed || checkpointRunning) return
    checkpointRunning = true
    const startedAt = performance.now()
    try {
        // FULL/RESTART/TRUNCATE hold the writer lock while syncing the database.
        // busy_timeout only bounds waiting for a lock, not that I/O after it is
        // acquired. Online checkpoints must stay PASSIVE even for a large WAL;
        // Explicit checkpoint truncation belongs in a maintenance window with
        // writers stopped. Reclaim only through a small natural-reset commit.
        const passiveResult = database.pragma("wal_checkpoint(PASSIVE)") as Array<Record<string, unknown>>
        const passiveState = passiveResult[0] ?? {}
        const passiveLogFrames = numberValue(passiveState.log)
        const passiveCheckpointedFrames = numberValue(passiveState.checkpointed)
        const checkpointBusy = numberValue(passiveState.busy)
        if (checkpointBusy === 1) busy++
        completed++
        parentPort?.postMessage({
            type: "checkpoint",
            durationMs: performance.now() - startedAt,
            mode: "passive",
            busy: checkpointBusy,
            logFrames: passiveLogFrames,
            checkpointedFrames: passiveCheckpointedFrames,
            passiveLogFrames,
            passiveCheckpointedFrames,
            // Keep the existing diagnostics contract for older consumers.
            truncateAttempted: false,
            truncateBusy: 0,
            // Reclamation is serialized with business writes by the parent.
            reclaimAttempted: false,
            reclaimBusy: false,
            reclaimedBytes: 0,
            walBytes: walBytes(),
        })
    } catch (error) {
        errors++
        parentPort?.postMessage({
            type: "checkpoint_error",
            durationMs: performance.now() - startedAt,
            error: error instanceof Error ? error.message : String(error),
        })
    } finally {
        checkpointRunning = false
    }
}

installWorkerMemoryProbe(() => ({
    completed, errors, busy, truncateAttempts: 0, truncateCompleted: 0, truncateBusy: 0,
}))

const interval = setInterval(checkpoint, Math.max(250, input.intervalMs))
interval.unref()
checkpoint()

parentPort?.on("message", message => {
    if (message?.type === "checkpoint_now") checkpoint()
    if (message?.type !== "close" || closed) return
    closed = true
    clearInterval(interval)
    try { database.close() } catch {}
    parentPort?.postMessage({ type: "closed" })
})
