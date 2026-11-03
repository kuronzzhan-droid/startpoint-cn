"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.drainSingleSettlementDiagnostics = exports.createSingleSettlementBodyTimer = exports.createSingleSettlementBodyTimingCollector = exports.recordSingleSettlementBodyTiming = void 0;
const node_perf_hooks_1 = require("node:perf_hooks");
const timings = new Map();
const rounded = (value) => Math.round(value * 1000) / 1000;
const disabledCollector = {
    step(_phase) { },
    result(_bodySucceeded) { return null; },
};
function keyOf(category, fiveBoss) {
    return fiveBoss ? "five_boss" : Number.isInteger(category) && category >= 0 && category <= 27
        ? String(category) : "other";
}
/** Merge one completed body measurement into the per-category aggregate. */
function recordSingleSettlementBodyTiming(timing) {
    var _a, _b;
    const entry = (_a = timings.get(keyOf(timing.category, timing.fiveBoss))) !== null && _a !== void 0 ? _a : { n: 0, bodyErrors: 0, totalMs: 0, maxMs: 0, phases: {} };
    entry.n++;
    if (!timing.succeeded)
        entry.bodyErrors++;
    entry.totalMs += timing.totalMs;
    entry.maxMs = Math.max(entry.maxMs, timing.totalMs);
    for (const name of Object.keys(timing.phases)) {
        const duration = timing.phases[name];
        const phaseTiming = (_b = entry.phases[name]) !== null && _b !== void 0 ? _b : { n: 0, totalMs: 0, maxMs: 0 };
        phaseTiming.n++;
        phaseTiming.totalMs += duration;
        phaseTiming.maxMs = Math.max(phaseTiming.maxMs, duration);
        entry.phases[name] = phaseTiming;
    }
    timings.set(keyOf(timing.category, timing.fiveBoss), entry);
}
exports.recordSingleSettlementBodyTiming = recordSingleSettlementBodyTiming;
/**
 * Disjoint transaction-body intervals, bounded to known numeric categories
 * plus two buckets. `result` returns the sample without touching the local
 * aggregate, which is what a command executed in another thread needs.
 */
function createSingleSettlementBodyTimingCollector(category, fiveBoss) {
    var _a;
    if (/^(0|false|no|off)$/i.test((_a = process.env.ROUTE_PERF_SUMMARY) !== null && _a !== void 0 ? _a : "true"))
        return disabledCollector;
    const startedAt = node_perf_hooks_1.performance.now();
    let previousAt = startedAt;
    let phase = "rewards";
    let finished = false;
    const local = {};
    const record = (now) => {
        var _a;
        local[phase] = ((_a = local[phase]) !== null && _a !== void 0 ? _a : 0) + now - previousAt;
        previousAt = now;
    };
    return {
        step(next) {
            if (finished)
                return;
            record(node_perf_hooks_1.performance.now());
            phase = next;
        },
        result(bodySucceeded) {
            if (finished)
                return null;
            finished = true;
            const now = node_perf_hooks_1.performance.now();
            record(now);
            return {
                category, fiveBoss, succeeded: bodySucceeded,
                totalMs: now - startedAt,
                phases: Object.assign({}, local),
            };
        },
    };
}
exports.createSingleSettlementBodyTimingCollector = createSingleSettlementBodyTimingCollector;
/** In-process timer: records the finished body into the local aggregate. */
function createSingleSettlementBodyTimer(category, fiveBoss) {
    const collector = createSingleSettlementBodyTimingCollector(category, fiveBoss);
    return {
        step: collector.step,
        finish(bodySucceeded) {
            const timing = collector.result(bodySucceeded);
            if (timing !== null)
                recordSingleSettlementBodyTiming(timing);
        },
    };
}
exports.createSingleSettlementBodyTimer = createSingleSettlementBodyTimer;
function drainSingleSettlementDiagnostics() {
    const result = Object.fromEntries([...timings].map(([key, entry]) => [key, Object.assign(Object.assign({}, entry), { totalMs: rounded(entry.totalMs), maxMs: rounded(entry.maxMs), phases: Object.fromEntries(Object.entries(entry.phases).map(([phase, timing]) => [phase, Object.assign(Object.assign({}, timing), { totalMs: rounded(timing.totalMs), maxMs: rounded(timing.maxMs) })])) })]));
    timings.clear();
    return result;
}
exports.drainSingleSettlementDiagnostics = drainSingleSettlementDiagnostics;
