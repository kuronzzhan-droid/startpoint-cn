import { registerMemoryCounters } from "./memory-diagnostics"
interface CacheEntry {
    expiresAt: number
    response: unknown
}

const entries = new Map<string, CacheEntry>()
const executionTails = new Map<string, Promise<void>>()
registerMemoryCounters("finishCache", () => ({ entries: entries.size, executing: executionTails.size }))
// Multiplayer clients can submit the same settlement again after the lobby has
// already been cleaned up (slow guest, reconnect or HTTP retry).  Keep the
// completed response long enough for that late request to remain idempotent.
const ttlMs = Math.max(5_000, Number.parseInt(process.env.FINISH_RESPONSE_CACHE_TTL_MS ?? "120000", 10) || 120_000)
const maxEntries = Math.max(32, Number.parseInt(process.env.FINISH_RESPONSE_CACHE_MAX ?? "512", 10) || 512)

function normalizeRequestNumber(value: unknown): number | null {
    if (typeof value === "number") return Number.isFinite(value) ? value : null
    if (typeof value !== "string") return null
    const text = value.trim()
    if (text.length === 0) return null
    const parsed = Number(text)
    return Number.isFinite(parsed) ? parsed : null
}

function normalizePlayId(value: unknown): string | null {
    return typeof value === "string" && value.length > 0 ? value : null
}

/** The client play id of a finish request, or null when it carries none. */
export function finishRequestPlayId(body: Record<string, unknown>): string | null {
    return normalizePlayId(body.play_id)
}

/** Numeric fields use their number form; anything else keeps the legacy string form. */
function keyPart(value: unknown): string {
    if (value === undefined || value === null) return ""
    const parsed = normalizeRequestNumber(value)
    return parsed === null ? String(value) : String(parsed)
}

/** Request token: play_id first, then api_count (as sent when not numeric). */
function finishRequestToken(body: Record<string, unknown>): string | null {
    const playId = normalizePlayId(body.play_id)
    if (playId !== null) return playId
    if (body.api_count === undefined || body.api_count === null) return null
    return `api:${keyPart(body.api_count)}`
}

export interface FinishResponseCacheKeyOptions {
    /** Multiplayer settlements are keyed by player, quest and play, not by viewer or api_count. */
    playerId?: number
}

export function buildFinishResponseCacheKey(
    mode: "single" | "multi",
    viewerId: number,
    body: Record<string, unknown>,
    options: FinishResponseCacheKeyOptions = {},
): string | null {
    const category = keyPart(body.category)
    const questId = keyPart(body.quest_id)
    const playId = normalizePlayId(body.play_id)
    if (mode === "multi" && options.playerId !== undefined && playId !== null) {
        return `multi:player:${options.playerId}:${category}:${questId}:${playId}`
    }
    const token = finishRequestToken(body)
    // Without a client request token, two legitimate consecutive clears of the
    // same quest are indistinguishable.  In that case it is safer not to cache.
    if (token === null) return null
    return `${mode}:${viewerId}:${category}:${questId}:${token}`
}

/**
 * Serialization key for finish execution.  It is never null: a request
 * without a usable token still waits behind other finishes of the same
 * player (single) or the same player and play (multi).
 */
export function buildFinishExecutionKey(
    mode: "single" | "multi",
    playerId: number,
    body: Record<string, unknown>,
): string {
    if (mode === "single") return `single:${playerId}`
    return `multi:${playerId}:${normalizePlayId(body.play_id) ?? ""}`
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
