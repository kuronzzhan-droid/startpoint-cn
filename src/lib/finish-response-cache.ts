interface CacheEntry {
    expiresAt: number
    response: unknown
}

const entries = new Map<string, CacheEntry>()
const executionTails = new Map<string, Promise<void>>()
// Multiplayer clients can submit the same settlement again after the lobby has
// already been cleaned up (slow guest, reconnect or HTTP retry).  Keep the
// completed response long enough for that late request to remain idempotent.
const ttlMs = Math.max(5_000, Number.parseInt(process.env.FINISH_RESPONSE_CACHE_TTL_MS ?? "120000", 10) || 120_000)
const maxEntries = Math.max(32, Number.parseInt(process.env.FINISH_RESPONSE_CACHE_MAX ?? "512", 10) || 512)

export function buildFinishResponseCacheKey(
    mode: "single" | "multi",
    viewerId: number,
    body: Record<string, unknown>,
): string | null {
    const playId = typeof body.play_id === "string" && body.play_id.length > 0
        ? body.play_id
        : body.api_count !== undefined && body.api_count !== null
            ? `api:${String(body.api_count)}`
            : null
    // Without a client request token, two legitimate consecutive clears of the
    // same quest are indistinguishable.  In that case it is safer not to cache.
    if (playId === null) return null
    return `${mode}:${viewerId}:${String(body.category ?? "")}:${String(body.quest_id ?? "")}:${playId}`
}

export function getCachedFinishResponse(key: string | null): unknown | undefined {
    if (key === null) return undefined
    const entry = entries.get(key)
    if (!entry) return undefined
    if (entry.expiresAt <= Date.now()) {
        entries.delete(key)
        return undefined
    }
    // Refresh insertion order so hot retry entries remain within the bound.
    entries.delete(key)
    entries.set(key, entry)
    return entry.response
}

export function cacheFinishResponse(key: string | null, response: unknown): void {
    if (key === null) return
    entries.delete(key)
    entries.set(key, { expiresAt: Date.now() + ttlMs, response })
    while (entries.size > maxEntries) {
        const oldest = entries.keys().next().value as string | undefined
        if (oldest === undefined) break
        entries.delete(oldest)
    }
}

/** Serialize retries for the same battle/player until the first response is cached. */
export async function acquireFinishExecution(key: string | null): Promise<() => void> {
    if (key === null) return () => undefined
    const previous = executionTails.get(key) ?? Promise.resolve()
    let releaseCurrent!: () => void
    const current = new Promise<void>(resolve => { releaseCurrent = resolve })
    const tail = previous.then(() => current)
    executionTails.set(key, tail)
    await previous
    let released = false
    return () => {
        if (released) return
        released = true
        releaseCurrent()
        void tail.finally(() => {
            if (executionTails.get(key) === tail) executionTails.delete(key)
        })
    }
}
