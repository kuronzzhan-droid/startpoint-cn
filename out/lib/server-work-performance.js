"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.drainServerWorkPerformance = exports.measureServerWork = exports.recordServerWork = void 0;
const node_perf_hooks_1 = require("node:perf_hooks");
const timings = new Map();
function recordServerWork(phase, elapsedMs) {
    var _a;
    if (!Number.isFinite(elapsedMs) || elapsedMs < 0)
        return;
    const value = (_a = timings.get(phase)) !== null && _a !== void 0 ? _a : { n: 0, totalMs: 0, maxMs: 0 };
    value.n++;
    value.totalMs += elapsedMs;
    value.maxMs = Math.max(value.maxMs, elapsedMs);
    timings.set(phase, value);
}
exports.recordServerWork = recordServerWork;
function measureServerWork(phase, operation) {
    const start = node_perf_hooks_1.performance.now();
    try {
        return operation();
    }
    finally {
        recordServerWork(phase, node_perf_hooks_1.performance.now() - start);
    }
}
exports.measureServerWork = measureServerWork;
function drainServerWorkPerformance() {
    const snapshot = Object.fromEntries([...timings].map(([phase, value]) => [phase, {
            n: value.n,
            avgMs: Math.round(value.totalMs / value.n * 1000) / 1000,
            maxMs: Math.round(value.maxMs * 1000) / 1000,
            totalMs: Math.round(value.totalMs * 1000) / 1000,
        }]));
    timings.clear();
    return snapshot;
}
exports.drainServerWorkPerformance = drainServerWorkPerformance;
