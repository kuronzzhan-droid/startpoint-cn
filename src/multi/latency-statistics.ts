import { performance } from "node:perf_hooks"

// Fixed bucket storage: 1/16 ms through 1 ms, 1 ms through 1 s, 10 ms
// through 10 s and 1 s through 60 s. Percentiles are bucket upper bounds,
// capped by the observed maximum; values above 60 s share one overflow bucket.
const upperBounds = [0]
for (let i = 1; i <= 16; i++) upperBounds.push(i / 16)
for (let i = 2; i <= 1_000; i++) upperBounds.push(i)
for (let i = 1_010; i <= 10_000; i += 10) upperBounds.push(i)
for (let i = 11_000; i <= 60_000; i += 1_000) upperBounds.push(i)
upperBounds.push(Infinity)

export class BoundedLatencyHistogram {
    private readonly buckets = new Float64Array(upperBounds.length)
    private count = 0
    private sum = 0
    private min = Infinity
    private max = 0
    private invalid = 0

    record(ms: number): boolean {
        if (!Number.isFinite(ms) || ms < 0) { this.invalid++; return false }
        let lo = 0, hi = upperBounds.length - 1
        while (lo < hi) {
            const mid = (lo + hi) >>> 1
            if (ms <= upperBounds[mid]) hi = mid
            else lo = mid + 1
        }
        this.buckets[lo]++
        this.count++
        this.sum += ms
        this.min = Math.min(this.min, ms)
        this.max = Math.max(this.max, ms)
        return true
    }

    private percentile(fraction: number): number | null {
        if (!this.count) return null
        const rank = Math.ceil(this.count * fraction)
        let seen = 0
        for (let i = 0; i < this.buckets.length; i++) {
            seen += this.buckets[i]
            if (seen >= rank) return Math.min(upperBounds[i], this.max)
        }
        return this.max
    }

    snapshot() {
        return {
            count: this.count, minMs: this.count ? this.min : null,
            meanMs: this.count ? this.sum / this.count : null, maxMs: this.count ? this.max : null,
            p50Ms: this.percentile(.50), p95Ms: this.percentile(.95), p99Ms: this.percentile(.99),
            quantileMethod: "fixed-bucket-upper-bound" as const,
            resolution: "1/16ms<=1ms;1ms<=1s;10ms<=10s;1s<=60s;overflow=max" as const,
            bucketCount: this.buckets.length, overflowCount: this.buckets[this.buckets.length - 1],
            invalidSamples: this.invalid,
            p99TailSampleEstimate: this.count * .01,
        }
    }
}

type Completed = { at: number; state: "success" | "timeout" | "late" }
type Pending = { at: number; deadline: number }
export type MeasurementOutcome = "success" | "late" | "duplicate" | "unmatched" | "mismatched" | "generic" | "invalid"

/** Tracks timestamps owned by one process/monotonic clock. It never subtracts
 * serverTime or another device's timestamp. Late responses retain timeout counts:
 * timeout counts deadline misses; late counts those misses eventually answered.
 * Jitter is |RTT[n]-RTT[n-1]| for on-time matched replies in reception order. */
export class MeasurementCollector {
    private readonly clock: () => number
    private readonly timeoutMs: number
    private readonly maxPending: number
    private readonly maxCompleted: number
    private readonly pending = new Map<number, Pending>()
    private readonly completed = new Map<number, Completed>()
    private nextId = 1
    private lastIssued = 0
    private previousRtt: number | undefined
    private readonly rtt = new BoundedLatencyHistogram()
    private readonly jitter = new BoundedLatencyHistogram()
    private readonly lateRtt = new BoundedLatencyHistogram()
    private readonly counts = { sent: 0, success: 0, late: 0, timeout: 0, duplicate: 0,
        unmatched: 0, mismatched: 0, genericIgnored: 0, invalid: 0, capacityRejected: 0 }

    constructor(options: { clock?: () => number; timeoutMs?: number; maxPending?: number; maxCompleted?: number } = {}) {
        this.clock = options.clock ?? (() => performance.now())
        this.timeoutMs = options.timeoutMs ?? 5_000
        this.maxPending = options.maxPending ?? 256
        this.maxCompleted = options.maxCompleted ?? 1_024
        if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0 ||
            !Number.isSafeInteger(this.maxPending) || this.maxPending < 1 || this.maxPending > 65_536 ||
            !Number.isSafeInteger(this.maxCompleted) || this.maxCompleted < 1 || this.maxCompleted > 65_536) {
            throw new RangeError("invalid bounded collector options")
        }
    }

    /** Optional explicit ID/time are for same-process multi-socket delivery
     * tests only. IDs must increase and are never reused within this collector. */
    start(id = this.nextId, at = this.clock()): { id: number; sentAt: number } {
        if (!Number.isSafeInteger(id) || id <= this.lastIssued || id > 2_147_483_647 || !Number.isFinite(at) || at < 0) {
            throw new RangeError("measurement requires a new positive int32 ID and local monotonic timestamp")
        }
        this.expire(at)
        if (this.pending.size >= this.maxPending) { this.counts.capacityRejected++; throw new RangeError("measurement pending capacity") }
        this.lastIssued = id
        this.nextId = id + 1
        this.pending.set(id, { at, deadline: at + this.timeoutMs })
        this.counts.sent++
        return { id, sentAt: at }
    }

    private remember(id: number, entry: Completed): void {
        this.completed.set(id, entry)
        if (this.completed.size > this.maxCompleted) this.completed.delete(this.completed.keys().next().value!)
    }

    get pendingCount(): number { return this.pending.size }

    expire(at = this.clock()): number {
        if (!Number.isFinite(at) || at < 0) throw new RangeError("invalid local monotonic timestamp")
        let expired = 0
        for (const [id, entry] of this.pending) {
            if (at < entry.deadline) continue
            this.pending.delete(id)
            this.remember(id, { at: entry.at, state: "timeout" })
            this.counts.timeout++
            expired++
        }
        return expired
    }

    receive(id: number, echoTime: number, at = this.clock()): MeasurementOutcome {
        if (id === 0 && echoTime === 0) { this.counts.genericIgnored++; return "generic" }
        if (!Number.isSafeInteger(id) || id < 1 || !Number.isFinite(echoTime) || !Number.isFinite(at) || at < echoTime) {
            this.counts.invalid++; return "invalid"
        }
        this.expire(at)
        const pending = this.pending.get(id), done = this.completed.get(id)
        if (!pending && !done) { this.counts.unmatched++; return "unmatched" }
        const original = pending ?? done!
        if (original.at !== echoTime) { this.counts.mismatched++; return "mismatched" }
        if (done && done.state !== "timeout") { this.counts.duplicate++; return "duplicate" }
        const ms = at - original.at
        if (done) {
            done.state = "late"
            this.counts.late++
            this.lateRtt.record(ms)
            return "late"
        }
        this.pending.delete(id)
        this.remember(id, { at: original.at, state: "success" })
        this.counts.success++
        this.rtt.record(ms)
        if (this.previousRtt !== undefined) this.jitter.record(Math.abs(ms - this.previousRtt))
        this.previousRtt = ms
        return "success"
    }

    snapshot() {
        return { ...this.counts, pending: this.pending.size, retainedCompleted: this.completed.size,
            completedRetentionLimit: this.maxCompleted,
            classificationLimit: "replies older than completed retention are unmatched" as const,
            timeoutMs: this.timeoutMs, rttMs: this.rtt.snapshot(), lateRttMs: this.lateRtt.snapshot(),
            jitterMs: this.jitter.snapshot(),
            jitterDefinition: "absolute difference of successive on-time matched RTTs in reception order" as const,
            timeoutDefinition: "deadline misses; includes late responses" as const }
    }
}
