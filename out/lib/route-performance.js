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
exports.installRoutePerformanceMonitor = void 0;
const perf_hooks_1 = require("perf_hooks");
const settlement_performance_1 = require("./settlement-performance");
const admission_1 = require("../multi/room/admission");
const memory_diagnostics_1 = require("./memory-diagnostics");
const request_diagnostics_1 = require("./request-diagnostics");
const server_work_performance_1 = require("./server-work-performance");
const sqlite_commit_diagnostics_1 = require("./sqlite-commit-diagnostics");
const single_settlement_diagnostics_1 = require("./single-settlement-diagnostics");
function isEnabled() {
    var _a;
    return !/^(0|false|no|off)$/i.test((_a = process.env.ROUTE_PERF_SUMMARY) !== null && _a !== void 0 ? _a : "true");
}
/**
 * Adds constant-space, per-route request timing.  It emits one compact line
 * per interval instead of logging every request, so it can remain enabled on
 * production servers while still exposing the routes consuming the CPU core.
 */
function installRoutePerformanceMonitor(fastify) {
    var _a, _b;
    (0, memory_diagnostics_1.installMemoryDiagnostics)(fastify);
    if (!isEnabled())
        return;
    const detailed = /^(1|true|yes|on)$/i.test((_a = process.env.ROUTE_PERF_DETAIL) !== null && _a !== void 0 ? _a : "false");
    const diagnostics = (0, request_diagnostics_1.installRequestDiagnostics)(fastify, { detailed });
    const intervalMs = Math.max(10000, Number.parseInt((_b = process.env.ROUTE_PERF_INTERVAL_MS) !== null && _b !== void 0 ? _b : "60000", 10) || 60000);
    const eventLoopDelay = (0, perf_hooks_1.monitorEventLoopDelay)({ resolution: 20 });
    eventLoopDelay.enable();
    let previousElu = perf_hooks_1.performance.eventLoopUtilization();
    let previousCpu = process.cpuUsage();
    let previousSampleAt = perf_hooks_1.performance.now();
    const timer = setInterval(() => {
        const sampledAt = perf_hooks_1.performance.now();
        const actualIntervalMs = sampledAt - previousSampleAt;
        previousSampleAt = sampledAt;
        const { routes: snapshot, summary } = diagnostics.drain();
        const awake = (0, request_diagnostics_1.drainAwakeDiagnostics)();
        const requestCount = summary.n;
        const top = snapshot
            .sort(([, left], [, right]) => right.totalMs - left.totalMs)
            .slice(0, 6)
            .map(([route, timing]) => (`${route}{n=${timing.n},avg=${(timing.totalMs / timing.n).toFixed(1)}ms,max=${timing.maxMs.toFixed(1)}ms}`))
            .join("; ");
        const elu = perf_hooks_1.performance.eventLoopUtilization(previousElu);
        previousElu = perf_hooks_1.performance.eventLoopUtilization();
        const cpu = process.cpuUsage(previousCpu);
        previousCpu = process.cpuUsage();
        const cpuMs = (cpu.user + cpu.system) / 1000;
        const loopP99Ms = eventLoopDelay.percentile(99) / 1000000;
        const loopMaxMs = eventLoopDelay.max / 1000000;
        eventLoopDelay.reset();
        const phases = (0, settlement_performance_1.drainSettlementPerformanceSummary)();
        const gacha = (0, settlement_performance_1.drainGachaRequestSummary)();
        const admission = (0, admission_1.drainRoomAdmissionPerformanceSummary)();
        const work = (0, server_work_performance_1.drainServerWorkPerformance)();
        const commits = (0, sqlite_commit_diagnostics_1.drainSqliteCommitDiagnostics)();
        const settlements = (0, single_settlement_diagnostics_1.drainSingleSettlementDiagnostics)();
        if (requestCount === 0 && phases === "none" && admission === "none"
            && awake.skippedUnownedMissions === 0 && commits.n === 0
            && gacha === "none" && Object.keys(work).length === 0
            && Object.keys(settlements).length === 0)
            return;
        console.warn(`[PERF] interval=${intervalMs}ms requests=${requestCount} cpu=${cpuMs.toFixed(0)}ms `
            + `actualInterval=${actualIntervalMs.toFixed(1)}ms `
            + `elu=${(elu.utilization * 100).toFixed(1)}% loopP99=${loopP99Ms.toFixed(1)}ms `
            + `loopMax=${loopMaxMs.toFixed(1)}ms top=${top || "none"}`
            + ` phases=${phases} gacha=${gacha} admission=${admission}`);
        console.warn(`[REQUEST-PERF] ${JSON.stringify(Object.assign(Object.assign({}, summary), { awake }))}`);
        if (Object.keys(work).length > 0)
            console.warn(`[WORK-PERF] ${JSON.stringify(work)}`);
        if (commits.n > 0)
            console.warn(`[SQLITE-COMMIT] ${JSON.stringify(commits)}`);
        if (Object.keys(settlements).length > 0)
            console.warn(`[SINGLE-SETTLEMENT] ${JSON.stringify(settlements)}`);
    }, intervalMs);
    timer.unref();
    fastify.addHook("onClose", () => __awaiter(this, void 0, void 0, function* () { clearInterval(timer); eventLoopDelay.disable(); }));
}
exports.installRoutePerformanceMonitor = installRoutePerformanceMonitor;
