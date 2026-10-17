import { performance } from "node:perf_hooks"
import type { FastifyInstance } from "fastify"

export const DEFAULT_PRODUCT_INTERVAL_MS = 10_000
export const DEFAULT_MAX_GRANTS_PER_HOUR = 60
export const DEFAULT_MAX_TRACKED_PLAYERS = 5_000
const HOUR_MS = 3_600_000

interface GrantInput { playerId: number; productId: string }
interface GrantWindow {
    start: number
    count: number
    last: number
    products: Map<string, number>
}
interface GuardOptions {
    now?: () => number
    minIntervalMsPerProduct?: number
    maxGrantsPerHour?: number
    maxTrackedPlayers?: number
}
export interface GrantDecision {
    allowed: boolean
    reason: "product_cooldown" | "hourly_cap" | "capacity" | "invalid_clock" | null
    retryAfterMs: number
    at: number
}

/** Process-local budgets. Durable receipt replay remains owned by SQLite. */
export class PaymentGrantGuard {
    private readonly windows = new Map<number, GrantWindow>()
    private readonly now: () => number
    private readonly interval: number
    private readonly limit: number
    private readonly capacity: number
    private lastNow = 0

    constructor(options: GuardOptions = {}) {
        this.now = options.now ?? (() => performance.now())
        this.interval = options.minIntervalMsPerProduct ?? DEFAULT_PRODUCT_INTERVAL_MS
        this.limit = options.maxGrantsPerHour ?? DEFAULT_MAX_GRANTS_PER_HOUR
        this.capacity = options.maxTrackedPlayers ?? DEFAULT_MAX_TRACKED_PLAYERS
        if (!Number.isFinite(this.interval) || this.interval < 0
            || !Number.isSafeInteger(this.limit) || this.limit < 1
            || !Number.isSafeInteger(this.capacity) || this.capacity < 1) {
            throw new Error("Invalid payment grant budget options.")
        }
    }

    // Call after receipt lookup, inside the serialized player transaction.
    check(input: GrantInput): GrantDecision {
        const sampled = this.now()
        if (!Number.isFinite(sampled)) return { allowed: false, reason: "invalid_clock", retryAfterMs: 1_000, at: this.lastNow }
        const at = this.lastNow = Math.max(this.lastNow, sampled)
        const window = this.windows.get(input.playerId)
        const last = window?.products.get(input.productId)
        if (last !== undefined && at - last < this.interval) {
            return { allowed: false, reason: "product_cooldown", retryAfterMs: this.interval - (at - last), at }
        }
        if (window && at - window.start < HOUR_MS && window.count >= this.limit) {
            return { allowed: false, reason: "hourly_cap", retryAfterMs: HOUR_MS - (at - window.start), at }
        }
        if (!window && this.windows.size >= this.capacity) {
            // Never evict an active budget to admit another player.
            for (const [id, entry] of this.windows) {
                if (at - entry.start >= HOUR_MS && at - entry.last >= this.interval) this.windows.delete(id)
            }
            if (this.windows.size >= this.capacity) return { allowed: false, reason: "capacity", retryAfterMs: 1_000, at }
        }
        return { allowed: true, reason: null, retryAfterMs: 0, at }
    }

    // Apply an allowed decision only after COMMIT, before releasing the queue.
    // No clock reads, database access or callbacks can fail after the SQL commit.
    commit(input: GrantInput, at: number): void {
        let window = this.windows.get(input.playerId)
        if (!window) {
            window = { start: at, count: 0, last: at, products: new Map() }
            this.windows.set(input.playerId, window)
        } else if (at - window.start >= HOUR_MS) {
            window.start = at
            window.count = 0
        }
        for (const [product, last] of window.products) {
            if (at - last >= this.interval) window.products.delete(product)
        }
        window.count++
        window.last = at
        window.products.set(input.productId, at)
    }

    inspect(): { players: number; products: number; grants: number } {
        let products = 0, grants = 0
        for (const window of this.windows.values()) { products += window.products.size; grants += window.count }
        return { players: this.windows.size, products, grants }
    }
}

const guards = new WeakMap<FastifyInstance, PaymentGrantGuard>()
export function paymentGrantGuard(app: FastifyInstance): PaymentGrantGuard {
    let guard = guards.get(app)
    if (!guard) { guard = new PaymentGrantGuard(); guards.set(app, guard) }
    return guard
}
