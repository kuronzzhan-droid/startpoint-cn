import type { Database } from "better-sqlite3"
import fs from "node:fs"
import { SQLITE_WAL_JOURNAL_SIZE_LIMIT_BYTES, SQLITE_WAL_RECLAIM_STEP_BYTES } from "./sqlite-settings"

interface WalReclaimResult {
    attempted: boolean
    busy: boolean
    reclaimedBytes: number
    resetObserved: boolean
}

function walBytes(database: Database): number {
    try { return fs.statSync(`${database.name}-wal`).size }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0
        throw error
    }
}

function walGeneration(database: Database): string {
    const descriptor = fs.openSync(`${database.name}-wal`, "r")
    try {
        const header = Buffer.allocUnsafe(24)
        if (fs.readSync(descriptor, header, 0, header.length, 0) !== header.length) {
            throw new Error("Could not read SQLite WAL generation")
        }
        return header.subarray(12, 24).toString("hex")
    } finally { fs.closeSync(descriptor) }
}

/** Run only on the zero-timeout maintenance connection after a complete PASSIVE. */
export function reclaimSqliteWalSpace(database: Database, stepBytes = SQLITE_WAL_RECLAIM_STEP_BYTES): WalReclaimResult {
    if (walBytes(database) <= SQLITE_WAL_JOURNAL_SIZE_LIMIT_BYTES) {
        return { attempted: false, busy: false, reclaimedBytes: 0, resetObserved: false }
    }
    try { database.exec("BEGIN IMMEDIATE") }
    catch (error) {
        if ((error as { code?: string }).code === "SQLITE_BUSY") {
            return { attempted: true, busy: true, reclaimedBytes: 0, resetObserved: false }
        }
        throw error
    }
    try {
        const generation = walGeneration(database)
        // Read under the write lock so a concurrent version change is preserved.
        const version = database.pragma("user_version", { simple: true }) as number
        database.pragma(`user_version = ${version}`)
        // Sample after all writes, immediately before COMMIT. Earlier samples
        // can miss a transaction's spill/rollback physical high-water mark.
        const before = walBytes(database)
        const target = Math.max(SQLITE_WAL_JOURNAL_SIZE_LIMIT_BYTES,
            before - Math.min(SQLITE_WAL_RECLAIM_STEP_BYTES, stepBytes))
        database.pragma(`journal_size_limit = ${target}`)
        database.exec("COMMIT")
        // Another writer can regrow the physical file before the size sample.
        // A reset still ends this round, even when its net decrease is hidden.
        const resetObserved = walGeneration(database) !== generation
        return { attempted: true, busy: false, reclaimedBytes: Math.max(0, before - walBytes(database)), resetObserved }
    } catch (error) {
        if (database.inTransaction) database.exec("ROLLBACK")
        throw error
    }
}
