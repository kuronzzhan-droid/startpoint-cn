import { getDb } from "../data/db"

const playerWriteTails = new Map<number, Promise<void>>()
type SynchronousResult<T> = T extends PromiseLike<unknown> ? never : T

function delay(milliseconds: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, milliseconds))
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
    if ((typeof value !== "object" || value === null) && typeof value !== "function") return false
    return typeof (value as { then?: unknown }).then === "function"
}

function assertSafePlayerId(playerId: number): void {
    if (!Number.isSafeInteger(playerId) || playerId < 0) {
        throw new RangeError("playerId must be a non-negative safe integer")
    }
}

function assertValidMaxAttempts(maxAttempts: number): void {
    if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1) {
        throw new RangeError("maxAttempts must be a positive safe integer")
    }
}

class SqliteRollbackError extends Error {
    readonly cause: unknown
    readonly rollbackCause: unknown

    constructor(cause: unknown, rollbackCause: unknown) {
        super("SQLite transaction failed and rollback failed")
        this.name = "SqliteRollbackError"
        this.cause = cause
        this.rollbackCause = rollbackCause
    }
}

export function isSqliteBusyError(error: unknown): boolean {
    if (!(error instanceof Error) || !("code" in error)) return false
    const code = String((error as Error & { code?: string }).code ?? "")
    return code === "SQLITE_BUSY" || code === "SQLITE_BUSY_SNAPSHOT" || code.startsWith("SQLITE_BUSY_")
}

/**
 * Serialize writes for one player while allowing different players to proceed independently.
 * Calls for the same player are not reentrant: an operation must not await withPlayerWriteQueue
 * again for that player, because the nested call waits for its own outer queue entry.
 */
export async function withPlayerWriteQueue<T>(playerId: number, operation: () => Promise<T>): Promise<T> {
    assertSafePlayerId(playerId)
    const previous = playerWriteTails.get(playerId) ?? Promise.resolve()
    let release!: () => void
    const current = new Promise<void>(resolve => { release = resolve })
    const tail = previous.then(() => current)
    playerWriteTails.set(playerId, tail)
    await previous
    try {
        return await operation()
    } finally {
        release()
        void tail.finally(() => {
            if (playerWriteTails.get(playerId) === tail) playerWriteTails.delete(playerId)
        })
    }
}

/**
 * Run a short synchronous write transaction and retry the complete mutation on snapshot contention.
 * The callback must finish synchronously; Promise and thenable results are rejected before COMMIT.
 */
export async function runImmediateTransactionWithRetry<T>(
    operation: () => T & SynchronousResult<T>,
    maxAttempts = 3,
): Promise<T> {
    assertValidMaxAttempts(maxAttempts)
    const db = getDb()
    let lastError: unknown
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        let began = false
        try {
            db.exec("BEGIN IMMEDIATE")
            began = true
            const result = operation()
            if (isPromiseLike(result)) {
                throw new TypeError("SQLite transaction operation must be synchronous and return no Promise or thenable")
            }
            db.exec("COMMIT")
            return result
        } catch (error) {
            if (began && db.inTransaction) {
                try {
                    db.exec("ROLLBACK")
                } catch (rollbackCause) {
                    throw new SqliteRollbackError(error, rollbackCause)
                }
            }
            if (!isSqliteBusyError(error) || attempt >= maxAttempts) throw error
            lastError = error
            await delay(10 * (2 ** (attempt - 1)))
        }
    }
    throw lastError
}
