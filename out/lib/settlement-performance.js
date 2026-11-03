"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.drainSettlementPerformanceSummary = exports.measureSettlementPhaseAsync = exports.measureSettlementPhase = exports.recordSettlementPhase = exports.drainGachaRequestSummary = exports.recordGachaRequest = void 0;
const timings = new Map();
const gachaRequests = {
    character: { requests: 0, pulls: 0 },
    equipment: { requests: 0, pulls: 0 },
};
function recordGachaRequest(kind, pulls) {
    if (!Number.isSafeInteger(pulls) || pulls <= 0)
        return;
    gachaRequests[kind].requests += 1;
    gachaRequests[kind].pulls += pulls;
}
exports.recordGachaRequest = recordGachaRequest;
function drainGachaRequestSummary() {
    return Object.entries(gachaRequests).map(([kind, counters]) => {
        const text = `${kind}{requests=${counters.requests},pulls=${counters.pulls}}`;
        counters.requests = 0;
        counters.pulls = 0;
        return text;
    }).join("; ");
}
exports.drainGachaRequestSummary = drainGachaRequestSummary;
function recordSettlementPhase(kind, phase, elapsedMs) {
    var _a;
    if (!Number.isFinite(elapsedMs) || elapsedMs < 0)
        return;
    const key = `${kind}.${phase}`;
    const timing = (_a = timings.get(key)) !== null && _a !== void 0 ? _a : { count: 0, totalMs: 0, maxMs: 0 };
    timing.count += 1;
    timing.totalMs += elapsedMs;
    timing.maxMs = Math.max(timing.maxMs, elapsedMs);
    timings.set(key, timing);
}
exports.recordSettlementPhase = recordSettlementPhase;
function measureSettlementPhase(kind, phase, operation) {
    const startedAt = process.hrtime.bigint();
    try {
        return operation();
    }
    finally {
        recordSettlementPhase(kind, phase, Number(process.hrtime.bigint() - startedAt) / 1000000);
    }
}
exports.measureSettlementPhase = measureSettlementPhase;
function measureSettlementPhaseAsync(kind, phase, operation) {
    return __awaiter(this, void 0, void 0, function* () {
        const startedAt = process.hrtime.bigint();
        try {
            return yield operation();
        }
        finally {
            recordSettlementPhase(kind, phase, Number(process.hrtime.bigint() - startedAt) / 1000000);
        }
    });
}
exports.measureSettlementPhaseAsync = measureSettlementPhaseAsync;
function drainSettlementPerformanceSummary(limit = 12) {
    if (timings.size === 0)
        return "none";
    const snapshot = [...timings.entries()];
    timings.clear();
    return snapshot
        .sort(([, left], [, right]) => right.totalMs - left.totalMs)
        .slice(0, limit)
        .map(([phase, timing]) => (`${phase}{n=${timing.count},avg=${(timing.totalMs / timing.count).toFixed(1)}ms,max=${timing.maxMs.toFixed(1)}ms}`))
        .join("; ");
}
exports.drainSettlementPerformanceSummary = drainSettlementPerformanceSummary;
