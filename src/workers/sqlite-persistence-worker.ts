import Database from "better-sqlite3"
import { parentPort, workerData } from "node:worker_threads"
import { installWorkerMemoryProbe } from "../lib/memory-diagnostics"
import { applySqliteWalSizeLimit } from "../lib/sqlite-settings"

interface PersistenceStatement {
    sql: string
    params: readonly unknown[]
}

interface PersistenceCommand {
    id: number
    operation: string
    statements: readonly PersistenceStatement[]
}

interface WorkerInput {
    databasePath: string
    busyTimeoutMs: number
    maxAttempts: number
    settings: {
        synchronous: "FULL" | "NORMAL"
        cacheKiB: number
        mmapBytes: number
    }
}

const input = workerData as WorkerInput
const database = new Database(input.databasePath)
database.pragma("journal_mode = WAL")
database.pragma(`cache_size = -${input.settings.cacheKiB}`)
database.pragma(`mmap_size = ${input.settings.mmapBytes}`)
database.pragma(`synchronous = ${input.settings.synchronous}`)
applySqliteWalSizeLimit(database)
database.pragma(`busy_timeout = ${Math.max(0, input.busyTimeoutMs)}`)
// Keep a safety owner even if the external checkpoint worker exits. These
// commandized writes are low-volume, so an occasional automatic checkpoint is
// preferable to unbounded WAL growth.
database.pragma("wal_autocheckpoint = 1000")
database.pragma("foreign_keys = ON")

function reportSettings(): void {
    parentPort?.postMessage({
        type: "settings",
        synchronous: database.pragma("synchronous", { simple: true }),
        cacheSize: database.pragma("cache_size", { simple: true }),
        mmapSize: database.pragma("mmap_size", { simple: true }),
        walAutocheckpoint: database.pragma("wal_autocheckpoint", { simple: true }),
    })
}

let closed = false
let executing = false
let completed = 0
let failed = 0
let busyRetries = 0

function isBusyError(error: unknown): boolean {
    if (!(error instanceof Error) || !("code" in error)) return false
    const code = String((error as Error & { code?: string }).code ?? "")
    return code === "SQLITE_BUSY"
        || code === "SQLITE_BUSY_SNAPSHOT"
        || code.startsWith("SQLITE_BUSY_")
}

function delay(milliseconds: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, milliseconds))
}

function runCommand(command: PersistenceCommand): { changes: number, lastInsertRowid: number | null } {
    if (!Array.isArray(command.statements) || command.statements.length === 0) {
        throw new Error("Persistence command must contain at least one statement.")
    }
    return database.transaction(() => {
        let changes = 0
        let lastInsertRowid: number | null = null
        for (const statement of command.statements) {
            if (!statement || typeof statement.sql !== "string" || statement.sql.length === 0) {
                throw new Error("Persistence command contains an invalid SQL statement.")
            }
            const result = database.prepare(statement.sql).run(...(statement.params ?? []))
            changes += result.changes
            lastInsertRowid = Number(result.lastInsertRowid)
        }
        return { changes, lastInsertRowid }
    }).immediate()
}

async function execute(command: PersistenceCommand): Promise<void> {
    if (closed) throw new Error("SQLite persistence worker is closed.")
    executing = true
    try {
        let lastError: unknown
        for (let attempt = 1; attempt <= Math.max(1, input.maxAttempts); attempt += 1) {
            try {
                const result = runCommand(command)
                completed++
                parentPort?.postMessage({
                    type: "result", id: command.id, operation: command.operation, ...result,
                })
                return
            } catch (error) {
                lastError = error
                if (!isBusyError(error) || attempt >= input.maxAttempts) throw error
                busyRetries++
                await delay(10 * (2 ** (attempt - 1)))
            }
        }
        throw lastError
    } catch (error) {
        failed++
        parentPort?.postMessage({
            type: "error",
            id: command.id,
            operation: command.operation,
            code: error instanceof Error && "code" in error
                ? String((error as Error & { code?: string }).code ?? "") : null,
            error: error instanceof Error ? error.message : String(error),
        })
    } finally {
        executing = false
    }
}

installWorkerMemoryProbe(() => ({ completed, failed, busyRetries, executing }))
reportSettings()

parentPort?.on("message", (
    message: PersistenceCommand
        | { type: "close" }
        | { type: "checkpoint_owner", external: boolean }
        | { type: "memory_probe" },
) => {
    if (typeof message === "object" && "type" in message) {
        if (message.type === "memory_probe") return
        if (message.type === "checkpoint_owner") {
            database.pragma(`wal_autocheckpoint = ${message.external ? 0 : 1000}`)
            reportSettings()
            return
        }
        if (message.type === "close") {
            if (executing || closed) return
            closed = true
            try { database.close() } catch {}
            parentPort?.postMessage({ type: "closed" })
            return
        }
    }
    void execute(message as PersistenceCommand)
})
