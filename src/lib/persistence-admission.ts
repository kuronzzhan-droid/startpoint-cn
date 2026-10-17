/** Bound closures and payloads before they enter any persistence wait chain. */
export const PERSISTENCE_ADMISSION_DEFAULTS = Object.freeze({ total: 256, perPlayer: 8, withoutPlayer: 32 })

export class PersistenceQueueFullError extends Error {
    readonly code = "PERSISTENCE_QUEUE_FULL"
    readonly statusCode = 503
    constructor() { super("服务器写入繁忙，请稍后重试。") }
}

/** A synchronous caller cannot wait for a background transaction. No SQL ran. */
export class PersistenceMaintenanceBusyError extends Error {
    readonly code = "PERSISTENCE_MAINTENANCE_BUSY"
    readonly statusCode = 503
    constructor() { super("服务器正在完成后台写入，请稍后重试。") }
}

export function createPersistenceAdmission(limits: { total: number; perPlayer: number; withoutPlayer: number } = PERSISTENCE_ADMISSION_DEFAULTS) {
    for (const value of Object.values(limits)) {
        if (!Number.isSafeInteger(value) || value < 1) throw new Error("Invalid persistence admission limit")
    }
    const players = new Map<number, number>()
    let total = 0, withoutPlayer = 0, peak = 0, rejected = 0
    return {
        acquire(playerId?: number): () => void {
            if (total >= limits.total
                || (playerId === undefined ? withoutPlayer >= limits.withoutPlayer
                    : (players.get(playerId) ?? 0) >= limits.perPlayer)) {
                rejected++
                throw new PersistenceQueueFullError()
            }
            total++
            peak = Math.max(peak, total)
            if (playerId === undefined) withoutPlayer++
            else players.set(playerId, (players.get(playerId) ?? 0) + 1)
            let released = false
            return () => {
                if (released) return
                released = true
                total--
                if (playerId === undefined) withoutPlayer--
                else {
                    const remaining = players.get(playerId)! - 1
                    if (remaining === 0) players.delete(playerId)
                    else players.set(playerId, remaining)
                }
            }
        },
        stats: () => ({ total, withoutPlayer, players: players.size, peak, rejected }),
    }
}

export const persistenceAdmission = createPersistenceAdmission()

/** Only these failures guarantee the rejected command never started. */
export function isPersistenceAdmissionError(error: unknown): boolean {
    if (!(error instanceof Error)) return false
    const code = (error as Error & { code?: string }).code
    return code === "PERSISTENCE_QUEUE_FULL" || code === "SQLITE_WRITER_QUEUE_FULL"
        || code === "PERSISTENCE_MAINTENANCE_BUSY" || code === "SERVER_CLOSING"
}
