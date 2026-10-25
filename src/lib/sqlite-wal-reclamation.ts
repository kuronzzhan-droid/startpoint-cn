import type { Database } from "better-sqlite3"
import fs from "node:fs"
import { SQLITE_WAL_JOURNAL_SIZE_LIMIT_BYTES, SQLITE_WAL_RECLAIM_STEP_BYTES } from "./sqlite-settings"

interface WalReclaimResult {
    attempted: boolean
    busy: boolean
    reclaimedBytes: number
}

function walBytes(database: Database): number {
    try { return fs.statSync(`${database.name}-wal`).size }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0
        throw error
    }
}

/** Run only on the zero-timeout maintenance connection after a complete PASSIVE. */
export function reclaimSqliteWalSpace(database: Database): WalReclaimResult {
    if (walBytes(database) <= SQLITE_WAL_JOURNAL_SIZE_LIMIT_BYTES) {
        return { attempted: false, busy: false, reclaimedBytes: 0 }
    }
    try { database.exec("BEGIN IMMEDIATE") }
    catch (error) {
        if ((error as { code?: string }).code === "SQLITE_BUSY") {
            return { attempted: true, busy: true, reclaimedBytes: 0 }
        }
        throw error
    }
    try {
        // Read under the write lock so a concurrent version change is preserved.
        const version = database.pragma("user_version", { simple: true }) as number
        database.pragma(`user_version = ${version}`)
        // Sample after all writes, immediately before COMMIT. Earlier samples
        // can miss a transaction's spill/rollback physical high-water mark.
        const before = walBytes(database)
        const target = Math.max(SQLITE_WAL_JOURNAL_SIZE_LIMIT_BYTES, before - SQLITE_WAL_RECLAIM_STEP_BYTES)
        database.pragma(`journal_size_limit = ${target}`)
        database.exec("COMMIT")
        return { attempted: true, busy: false, reclaimedBytes: Math.max(0, before - walBytes(database)) }
    } catch (error) {
        if (database.inTransaction) database.exec("ROLLBACK")
        throw error
    }
}
