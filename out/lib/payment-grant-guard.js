"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.paymentGrantGuard = exports.PaymentGrantGuard = exports.DEFAULT_MAX_TRACKED_PLAYERS = exports.DEFAULT_MAX_GRANTS_PER_HOUR = exports.DEFAULT_PRODUCT_INTERVAL_MS = void 0;
const node_perf_hooks_1 = require("node:perf_hooks");
exports.DEFAULT_PRODUCT_INTERVAL_MS = 10000;
exports.DEFAULT_MAX_GRANTS_PER_HOUR = 60;
exports.DEFAULT_MAX_TRACKED_PLAYERS = 5000;
const HOUR_MS = 3600000;
/** Process-local budgets. Durable receipt replay remains owned by SQLite. */
class PaymentGrantGuard {
    constructor(options = {}) {
        var _a, _b, _c, _d;
        this.windows = new Map();
        this.lastNow = 0;
        this.now = (_a = options.now) !== null && _a !== void 0 ? _a : (() => node_perf_hooks_1.performance.now());
        this.interval = (_b = options.minIntervalMsPerProduct) !== null && _b !== void 0 ? _b : exports.DEFAULT_PRODUCT_INTERVAL_MS;
        this.limit = (_c = options.maxGrantsPerHour) !== null && _c !== void 0 ? _c : exports.DEFAULT_MAX_GRANTS_PER_HOUR;
        this.capacity = (_d = options.maxTrackedPlayers) !== null && _d !== void 0 ? _d : exports.DEFAULT_MAX_TRACKED_PLAYERS;
        if (!Number.isFinite(this.interval) || this.interval < 0
            || !Number.isSafeInteger(this.limit) || this.limit < 1
            || !Number.isSafeInteger(this.capacity) || this.capacity < 1) {
            throw new Error("Invalid payment grant budget options.");
        }
    }
    // Call after receipt lookup, inside the serialized player transaction.
    check(input) {
        const sampled = this.now();
        if (!Number.isFinite(sampled))
            return { allowed: false, reason: "invalid_clock", retryAfterMs: 1000, at: this.lastNow };
        const at = this.lastNow = Math.max(this.lastNow, sampled);
        const window = this.windows.get(input.playerId);
        const last = window === null || window === void 0 ? void 0 : window.products.get(input.productId);
        if (last !== undefined && at - last < this.interval) {
            return { allowed: false, reason: "product_cooldown", retryAfterMs: this.interval - (at - last), at };
        }
        if (window && at - window.start < HOUR_MS && window.count >= this.limit) {
            return { allowed: false, reason: "hourly_cap", retryAfterMs: HOUR_MS - (at - window.start), at };
        }
        if (!window && this.windows.size >= this.capacity) {
            // Never evict an active budget to admit another player.
            for (const [id, entry] of this.windows) {
                if (at - entry.start >= HOUR_MS && at - entry.last >= this.interval)
                    this.windows.delete(id);
            }
            if (this.windows.size >= this.capacity)
                return { allowed: false, reason: "capacity", retryAfterMs: 1000, at };
        }
        return { allowed: true, reason: null, retryAfterMs: 0, at };
    }
    // Apply an allowed decision only after COMMIT, before releasing the queue.
    // No clock reads, database access or callbacks can fail after the SQL commit.
    commit(input, at) {
        let window = this.windows.get(input.playerId);
        if (!window) {
            window = { start: at, count: 0, last: at, products: new Map() };
            this.windows.set(input.playerId, window);
        }
        else if (at - window.start >= HOUR_MS) {
            window.start = at;
            window.count = 0;
        }
        for (const [product, last] of window.products) {
            if (at - last >= this.interval)
                window.products.delete(product);
        }
        window.count++;
        window.last = at;
        window.products.set(input.productId, at);
    }
    inspect() {
        let products = 0, grants = 0;
        for (const window of this.windows.values()) {
            products += window.products.size;
            grants += window.count;
        }
        return { players: this.windows.size, products, grants };
    }
}
exports.PaymentGrantGuard = PaymentGrantGuard;
const guards = new WeakMap();
function paymentGrantGuard(app) {
    let guard = guards.get(app);
    if (!guard) {
        guard = new PaymentGrantGuard();
        guards.set(app, guard);
    }
    return guard;
}
exports.paymentGrantGuard = paymentGrantGuard;
