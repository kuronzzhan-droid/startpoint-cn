"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MeasurementCollector = exports.BoundedLatencyHistogram = void 0;
const node_perf_hooks_1 = require("node:perf_hooks");
// Fixed bucket storage: 1/16 ms through 1 ms, 1 ms through 1 s, 10 ms
// through 10 s and 1 s through 60 s. Percentiles are bucket upper bounds,
// capped by the observed maximum; values above 60 s share one overflow bucket.
const upperBounds = [0];
for (let i = 1; i <= 16; i++)
    upperBounds.push(i / 16);
for (let i = 2; i <= 1000; i++)
    upperBounds.push(i);
for (let i = 1010; i <= 10000; i += 10)
    upperBounds.push(i);
for (let i = 11000; i <= 60000; i += 1000)
    upperBounds.push(i);
upperBounds.push(Infinity);
class BoundedLatencyHistogram {
    constructor() {
        this.buckets = new Float64Array(upperBounds.length);
        this.count = 0;
        this.sum = 0;
        this.min = Infinity;
        this.max = 0;
        this.invalid = 0;
    }
    record(ms) {
        if (!Number.isFinite(ms) || ms < 0) {
            this.invalid++;
            return false;
        }
        let lo = 0, hi = upperBounds.length - 1;
        while (lo < hi) {
            const mid = (lo + hi) >>> 1;
            if (ms <= upperBounds[mid])
                hi = mid;
            else
                lo = mid + 1;
        }
        this.buckets[lo]++;
        this.count++;
        this.sum += ms;
        this.min = Math.min(this.min, ms);
        this.max = Math.max(this.max, ms);
        return true;
    }
    percentile(fraction) {
        if (!this.count)
            return null;
        const rank = Math.ceil(this.count * fraction);
        let seen = 0;
        for (let i = 0; i < this.buckets.length; i++) {
            seen += this.buckets[i];
            if (seen >= rank)
                return Math.min(upperBounds[i], this.max);
        }
        return this.max;
    }
    snapshot() {
        return {
            count: this.count, minMs: this.count ? this.min : null,
            meanMs: this.count ? this.sum / this.count : null, maxMs: this.count ? this.max : null,
            p50Ms: this.percentile(.50), p95Ms: this.percentile(.95), p99Ms: this.percentile(.99),
            quantileMethod: "fixed-bucket-upper-bound",
            resolution: "1/16ms<=1ms;1ms<=1s;10ms<=10s;1s<=60s;overflow=max",
            bucketCount: this.buckets.length, overflowCount: this.buckets[this.buckets.length - 1],
            invalidSamples: this.invalid,
            p99TailSampleEstimate: this.count * .01,
        };
    }
}
exports.BoundedLatencyHistogram = BoundedLatencyHistogram;
/** Tracks timestamps owned by one process/monotonic clock. It never subtracts
 * serverTime or another device's timestamp. Late responses retain timeout counts:
 * timeout counts deadline misses; late counts those misses eventually answered.
 * Jitter is |RTT[n]-RTT[n-1]| for on-time matched replies in reception order. */
class MeasurementCollector {
    constructor(options = {}) {
        var _a, _b, _c, _d;
        this.pending = new Map();
        this.completed = new Map();
        this.nextId = 1;
        this.lastIssued = 0;
        this.rtt = new BoundedLatencyHistogram();
        this.jitter = new BoundedLatencyHistogram();
        this.lateRtt = new BoundedLatencyHistogram();
        this.counts = { sent: 0, success: 0, late: 0, timeout: 0, duplicate: 0,
            unmatched: 0, mismatched: 0, genericIgnored: 0, invalid: 0, capacityRejected: 0 };
        this.clock = (_a = options.clock) !== null && _a !== void 0 ? _a : (() => node_perf_hooks_1.performance.now());
        this.timeoutMs = (_b = options.timeoutMs) !== null && _b !== void 0 ? _b : 5000;
        this.maxPending = (_c = options.maxPending) !== null && _c !== void 0 ? _c : 256;
        this.maxCompleted = (_d = options.maxCompleted) !== null && _d !== void 0 ? _d : 1024;
        if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0 ||
            !Number.isSafeInteger(this.maxPending) || this.maxPending < 1 || this.maxPending > 65536 ||
            !Number.isSafeInteger(this.maxCompleted) || this.maxCompleted < 1 || this.maxCompleted > 65536) {
            throw new RangeError("invalid bounded collector options");
        }
    }
    /** Optional explicit ID/time are for same-process multi-socket delivery
     * tests only. IDs must increase and are never reused within this collector. */
    start(id = this.nextId, at = this.clock()) {
        if (!Number.isSafeInteger(id) || id <= this.lastIssued || id > 2147483647 || !Number.isFinite(at) || at < 0) {
            throw new RangeError("measurement requires a new positive int32 ID and local monotonic timestamp");
        }
        this.expire(at);
        if (this.pending.size >= this.maxPending) {
            this.counts.capacityRejected++;
            throw new RangeError("measurement pending capacity");
        }
        this.lastIssued = id;
        this.nextId = id + 1;
        this.pending.set(id, { at, deadline: at + this.timeoutMs });
        this.counts.sent++;
        return { id, sentAt: at };
    }
    remember(id, entry) {
        this.completed.set(id, entry);
        if (this.completed.size > this.maxCompleted)
            this.completed.delete(this.completed.keys().next().value);
    }
    get pendingCount() { return this.pending.size; }
    expire(at = this.clock()) {
        if (!Number.isFinite(at) || at < 0)
            throw new RangeError("invalid local monotonic timestamp");
        let expired = 0;
        for (const [id, entry] of this.pending) {
            if (at < entry.deadline)
                continue;
            this.pending.delete(id);
            this.remember(id, { at: entry.at, state: "timeout" });
            this.counts.timeout++;
            expired++;
        }
        return expired;
    }
    receive(id, echoTime, at = this.clock()) {
        if (id === 0 && echoTime === 0) {
            this.counts.genericIgnored++;
            return "generic";
        }
        if (!Number.isSafeInteger(id) || id < 1 || !Number.isFinite(echoTime) || !Number.isFinite(at) || at < echoTime) {
            this.counts.invalid++;
            return "invalid";
        }
        this.expire(at);
        const pending = this.pending.get(id), done = this.completed.get(id);
        if (!pending && !done) {
            this.counts.unmatched++;
            return "unmatched";
        }
        const original = pending !== null && pending !== void 0 ? pending : done;
        if (original.at !== echoTime) {
            this.counts.mismatched++;
            return "mismatched";
        }
        if (done && done.state !== "timeout") {
            this.counts.duplicate++;
            return "duplicate";
        }
        const ms = at - original.at;
        if (done) {
            done.state = "late";
            this.counts.late++;
            this.lateRtt.record(ms);
            return "late";
        }
        this.pending.delete(id);
        this.remember(id, { at: original.at, state: "success" });
        this.counts.success++;
        this.rtt.record(ms);
        if (this.previousRtt !== undefined)
            this.jitter.record(Math.abs(ms - this.previousRtt));
        this.previousRtt = ms;
        return "success";
    }
    snapshot() {
        return Object.assign(Object.assign({}, this.counts), { pending: this.pending.size, retainedCompleted: this.completed.size, completedRetentionLimit: this.maxCompleted, classificationLimit: "replies older than completed retention are unmatched", timeoutMs: this.timeoutMs, rttMs: this.rtt.snapshot(), lateRttMs: this.lateRtt.snapshot(), jitterMs: this.jitter.snapshot(), jitterDefinition: "absolute difference of successive on-time matched RTTs in reception order", timeoutDefinition: "deadline misses; includes late responses" });
    }
}
exports.MeasurementCollector = MeasurementCollector;
