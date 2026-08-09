import { getDb } from "../data/db"

const playerWriteTails = new Map<number, Promise<void>>()

function delay(milliseconds: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, milliseconds))
}

export function isSqliteBusyError(error: unknown): boolean {
    if (!(error instanceof Error) || !("code" in error)) return false
    const code = String((error as Error & { code?: string }).code ?? "")
    return code === "SQLITE_BUSY" || code === "SQLITE_BUSY_SNAPSHOT" || code.startsWith("SQLITE_BUSY_")
}

export async function withPlayerWriteQueue<T>(playerId: number, operation: () => Promise<T>): Promise<T> {
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

/** Run a short write transaction and retry the complete mutation on snapshot contention. */
export async function runImmediateTransactionWithRetry<T>(
    operation: () => T,
    maxAttempts = 3,
): Promise<T> {
    const db = getDb()
    let lastError: unknown
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        let began = false
        try {
            db.exec("BEGIN IMMEDIATE")
            began = true
            const result = operation()
            db.exec("COMMIT")
            return result
        } catch (error) {
            if (began && db.inTransaction) {
                try { db.exec("ROLLBACK") } catch {}
            }
            if (!isSqliteBusyError(error) || attempt >= maxAttempts) throw error
            lastError = error
            await delay(10 * (2 ** (attempt - 1)))
        }
    }
    throw lastError
}
