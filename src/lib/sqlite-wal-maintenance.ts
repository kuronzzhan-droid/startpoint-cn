import Database, { type Database as SqliteDatabase } from "better-sqlite3"
import fs from "node:fs"
import { performance } from "node:perf_hooks"
import { persistenceWriteGate } from "./persistence-write-gate"
import { nativeSqliteWrites } from "./sqlite-native-writes"
import { SQLITE_WAL_JOURNAL_SIZE_LIMIT_BYTES } from "./sqlite-settings"
import { reclaimSqliteWalSpace } from "./sqlite-wal-reclamation"

// Final I/O occupies the main thread: use smaller steps for shorter pauses.
// A byte limit still cannot bound filesystem latency.
const MAIN_THREAD_RECLAIM_STEP_BYTES = 256 * 1024 * 1024

interface ReclamationObservation {
    windowMs: number
    attempted: boolean
    busy: boolean
    resetObserved: boolean
    reclaimedBytes: number
    walBytes: number
    logFrames: number
    checkpointedFrames: number
}

/** Bulk backfill stays in the worker. Only the final tail and reset run here. */
export function createSqliteWalMaintenance(
    databasePath: string,
    onResult: (result: ReclamationObservation) => void,
    onError: (error: unknown) => void,
): { request: () => void, close: () => void } {
    let database: SqliteDatabase | undefined
    let requested = false, queued = false, closed = false
    const walBytes = () => {
        try { return fs.statSync(`${databasePath}-wal`).size }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0
            throw error
        }
    }
    function connection(): SqliteDatabase {
        if (database) return database
        const current = new Database(databasePath, { fileMustExist: true })
        try {
            current.pragma("journal_mode = WAL")
            current.pragma("synchronous = FULL")
            current.pragma("busy_timeout = 0")
            current.pragma("wal_autocheckpoint = 0")
            current.pragma("journal_size_limit = -1")
            database = current
            return current
        } catch (error) { current.close(); throw error }
    }
    function schedule(): void {
        if (closed || queued || !requested) return
        queued = true
        void persistenceWriteGate.runExclusiveSync(() => {
            if (closed || nativeSqliteWrites.activeCount() > 0) return
            requested = false
            const before = walBytes()
            if (before <= SQLITE_WAL_JOURNAL_SIZE_LIMIT_BYTES) return
            const startedAt = performance.now()
            const db = connection()
            // No await or message boundary: ordinary main-thread SQL cannot
            // append between this catch-up and the reset-triggering commit.
            const passive = (db.pragma("wal_checkpoint(PASSIVE)") as Array<{
                busy: number, log: number, checkpointed: number,
            }>)[0]
            const result = passive.busy === 0 && passive.log === passive.checkpointed
                ? reclaimSqliteWalSpace(db, MAIN_THREAD_RECLAIM_STEP_BYTES)
                : { attempted: false, busy: passive.busy !== 0, resetObserved: false, reclaimedBytes: 0 }
            onResult({ ...result, windowMs: performance.now() - startedAt, walBytes: walBytes(),
                logFrames: passive.log, checkpointedFrames: passive.checkpointed })
        }).catch(error => { requested = false; if (!closed) onError(error) }).finally(() => {
            queued = false
            if (requested && nativeSqliteWrites.activeCount() === 0) schedule()
        })
    }
    const unsubscribe = nativeSqliteWrites.onIdle(schedule)
    return {
        request: () => { if (!closed) { requested = true; schedule() } },
        close: () => {
            closed = true
            requested = false
            unsubscribe()
            if (database) { database.close(); database = undefined }
        },
    }
}
