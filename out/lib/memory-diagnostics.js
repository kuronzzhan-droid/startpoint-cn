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
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.installMemoryDiagnostics = exports.collectMemoryDiagnostics = exports.observeServerConnections = exports.observeWorkerMemory = exports.installWorkerMemoryProbe = exports.registerMemoryCounters = exports.detailedMemoryDiagnosticsEnabled = exports.sqliteDiagnosticsEnabled = exports.memoryDiagnosticsEnabled = void 0;
const worker_threads_1 = require("worker_threads");
const perf_hooks_1 = require("perf_hooks");
const v8_1 = require("v8");
const process_memory_probe_1 = require("./process-memory-probe");
const providers = new Map();
const workers = new Map();
const installed = new WeakSet();
const betterSqlite3Version = require("better-sqlite3/package.json").version;
const observedServers = new WeakSet();
let processProbe = null;
let processCpuTotal = null;
let processCpuSampledAt = null;
let processCpuDelta = null;
let monitorUsers = 0;
function memoryDiagnosticsEnabled() {
    var _a;
    return !/^(0|false|no|off)$/i.test((_a = process.env.MEMORY_DIAGNOSTICS) !== null && _a !== void 0 ? _a : "true");
}
exports.memoryDiagnosticsEnabled = memoryDiagnosticsEnabled;
function sqliteDiagnosticsEnabled() {
    var _a;
    return !/^(0|false|no|off)$/i.test((_a = process.env.SQLITE_DIAGNOSTICS) !== null && _a !== void 0 ? _a : "false");
}
exports.sqliteDiagnosticsEnabled = sqliteDiagnosticsEnabled;
function detailedMemoryDiagnosticsEnabled() {
    var _a;
    return memoryDiagnosticsEnabled() && /^(1|true|yes|on)$/i.test((_a = process.env.MEMORY_DIAGNOSTICS_DETAIL) !== null && _a !== void 0 ? _a : "false");
}
exports.detailedMemoryDiagnosticsEnabled = detailedMemoryDiagnosticsEnabled;
function samplingEnabled() { return memoryDiagnosticsEnabled() || sqliteDiagnosticsEnabled(); }
function threadMemory(detailed) {
    const _a = process.memoryUsage(), { rss: _rss } = _a, memory = __rest(_a, ["rss"]);
    if (!detailed)
        return memory;
    const heap = (0, v8_1.getHeapStatistics)();
    return Object.assign(Object.assign({}, memory), { totalPhysicalHeap: heap.total_physical_size, mallocedMemory: heap.malloced_memory, nativeContexts: heap.number_of_native_contexts, detachedContexts: heap.number_of_detached_contexts });
}
function registerMemoryCounters(name, read, group = "memory") {
    const enabled = group === "sqlite" ? sqliteDiagnosticsEnabled() : memoryDiagnosticsEnabled();
    if (!enabled || (!providers.has(name) && providers.size >= 32))
        return () => { };
    const provider = { read, group };
    providers.set(name, provider);
    return () => { if (providers.get(name) === provider)
        providers.delete(name); };
}
exports.registerMemoryCounters = registerMemoryCounters;
function readCounters(detailed) {
    const counters = {};
    for (const [name, { read, group }] of providers) {
        if (!(group === "sqlite" ? sqliteDiagnosticsEnabled() : memoryDiagnosticsEnabled()))
            continue;
        try {
            counters[name] = read(detailed);
        }
        catch (_a) {
            counters[name] = { unavailable: true };
        }
    }
    return counters;
}
function installWorkerMemoryProbe(read) {
    if (worker_threads_1.isMainThread || !samplingEnabled())
        return;
    worker_threads_1.parentPort === null || worker_threads_1.parentPort === void 0 ? void 0 : worker_threads_1.parentPort.on("message", message => {
        if ((message === null || message === void 0 ? void 0 : message.type) !== "memory_probe")
            return;
        const memory = memoryDiagnosticsEnabled(), detailed = detailedMemoryDiagnosticsEnabled();
        worker_threads_1.parentPort === null || worker_threads_1.parentPort === void 0 ? void 0 : worker_threads_1.parentPort.postMessage({ type: "memory_sample", memory: memory ? threadMemory(detailed) : null,
            counters: memory ? read(detailed) : {}, diagnostics: readCounters(detailed) });
    });
}
exports.installWorkerMemoryProbe = installWorkerMemoryProbe;
function observeWorkerMemory(name, worker) {
    if (!samplingEnabled() || workers.size >= 16)
        return;
    const state = { name, pending: false, requestedAt: 0, sampledAt: null,
        sample: null, counters: {},
        diagnostics: {}, cpuPending: false, cpuRequestedAt: 0,
        cpuSampledAt: null, cpuTotal: null,
        cpuDelta: null };
    workers.set(worker, state);
    const receive = (message) => {
        var _a;
        if ((message === null || message === void 0 ? void 0 : message.type) !== "memory_sample")
            return;
        state.sample = message.memory;
        state.counters = message.counters;
        state.diagnostics = (_a = message.diagnostics) !== null && _a !== void 0 ? _a : {};
        state.sampledAt = perf_hooks_1.performance.now();
        state.pending = false;
    };
    worker.on("message", receive);
    worker.once("exit", () => { workers.delete(worker); worker.off("message", receive); });
}
exports.observeWorkerMemory = observeWorkerMemory;
function sampleWorkerCpu(worker, state) {
    const cpuUsage = worker.cpuUsage;
    if (typeof cpuUsage !== "function" || state.cpuPending)
        return;
    state.cpuPending = true;
    state.cpuRequestedAt = perf_hooks_1.performance.now();
    void cpuUsage.call(worker).then(current => {
        const previous = state.cpuTotal;
        state.cpuTotal = current;
        state.cpuDelta = previous === null ? null : {
            user: Math.max(0, current.user - previous.user),
            system: Math.max(0, current.system - previous.system),
        };
        state.cpuSampledAt = perf_hooks_1.performance.now();
    }).catch(() => {
        // Node versions before 24.6 and workers that are exiting may reject this probe.
        state.cpuDelta = null;
    }).finally(() => { state.cpuPending = false; });
}
function sampleProcessCpu() {
    const current = process.cpuUsage();
    const previous = processCpuTotal;
    processCpuTotal = current;
    processCpuDelta = previous === null ? null : {
        user: Math.max(0, current.user - previous.user),
        system: Math.max(0, current.system - previous.system),
    };
    processCpuSampledAt = perf_hooks_1.performance.now();
}
function observeServerConnections(name, server) {
    if (!memoryDiagnosticsEnabled() || observedServers.has(server))
        return;
    observedServers.add(server);
    let connections = null, pending = false, closed = false;
    let sampledAt = null;
    const unregister = registerMemoryCounters(`connections.${name}`, () => {
        const ageMs = sampledAt === null ? null : Math.round(perf_hooks_1.performance.now() - sampledAt);
        if (!pending && !closed) {
            pending = true;
            server.getConnections((error, count) => {
                pending = false;
                if (closed)
                    return;
                if (error) {
                    connections = null;
                    return;
                }
                connections = count;
                sampledAt = perf_hooks_1.performance.now();
            });
        }
        return { connections, ageMs, unavailable: connections === null || ageMs === null || ageMs > 120000 };
    });
    server.once("close", () => { closed = true; unregister(); observedServers.delete(server); });
}
exports.observeServerConnections = observeServerConnections;
/** Constant retained state: one sample and at most one outstanding request per worker. */
function collectMemoryDiagnostics() {
    var _a, _b, _c, _d, _e;
    const now = perf_hooks_1.performance.now();
    const memory = memoryDiagnosticsEnabled(), detailed = detailedMemoryDiagnosticsEnabled();
    sampleProcessCpu();
    const counters = readCounters(detailed);
    const workerSamples = [...workers].map(([worker, state]) => {
        var _a, _b, _c, _d, _e, _f, _g, _h;
        sampleWorkerCpu(worker, state);
        const sample = { name: state.name, threadId: worker.threadId,
            ageMs: state.sampledAt === null ? null : Math.round(now - state.sampledAt),
            stale: state.sampledAt === null || now - state.sampledAt > 120000,
            pendingMs: state.pending ? Math.round(now - state.requestedAt) : 0,
            memory: state.sample, counters: state.counters, diagnostics: state.diagnostics,
            cpu: {
                supported: typeof worker.cpuUsage === "function",
                ageMs: state.cpuSampledAt === null ? null : Math.round(now - state.cpuSampledAt),
                pendingMs: state.cpuPending ? Math.round(now - state.cpuRequestedAt) : 0,
                totalUserUs: (_b = (_a = state.cpuTotal) === null || _a === void 0 ? void 0 : _a.user) !== null && _b !== void 0 ? _b : null,
                totalSystemUs: (_d = (_c = state.cpuTotal) === null || _c === void 0 ? void 0 : _c.system) !== null && _d !== void 0 ? _d : null,
                deltaUserUs: (_f = (_e = state.cpuDelta) === null || _e === void 0 ? void 0 : _e.user) !== null && _f !== void 0 ? _f : null,
                deltaSystemUs: (_h = (_g = state.cpuDelta) === null || _g === void 0 ? void 0 : _g.system) !== null && _h !== void 0 ? _h : null,
            }, };
        if (samplingEnabled() && !state.pending) {
            try {
                worker.postMessage({ type: "memory_probe" });
                state.pending = true;
                state.requestedAt = now;
            }
            catch ( /* Exiting worker: exit listener removes its sample. */_j) { /* Exiting worker: exit listener removes its sample. */ }
        }
        return sample;
    });
    if (detailed) {
        const activeResources = Object.create(null);
        let resourceTypes = 0;
        for (const type of process.getActiveResourcesInfo()) {
            if (type in activeResources)
                activeResources[type]++;
            else if (resourceTypes < 64) {
                activeResources[type] = 1;
                resourceTypes++;
            }
        }
        counters.activeResources = activeResources;
    }
    if (memory)
        counters.stdio = { stdoutQueuedBytes: process.stdout.writableLength, stderrQueuedBytes: process.stderr.writableLength };
    const osProcess = memory ? (_a = processProbe === null || processProbe === void 0 ? void 0 : processProbe.snapshot()) !== null && _a !== void 0 ? _a : null : undefined;
    if (memory)
        processProbe === null || processProbe === void 0 ? void 0 : processProbe.request();
    return { timestamp: new Date().toISOString(), pid: process.pid, uptimeSeconds: Math.floor(process.uptime()),
        memoryMode: memory ? detailed ? "detailed" : "basic" : "off",
        runtime: { node: process.versions.node, v8: process.versions.v8, betterSqlite3: betterSqlite3Version,
            platform: process.platform, arch: process.arch },
        cpu: {
            ageMs: processCpuSampledAt === null ? null : Math.round(now - processCpuSampledAt),
            totalUserUs: (_b = processCpuTotal === null || processCpuTotal === void 0 ? void 0 : processCpuTotal.user) !== null && _b !== void 0 ? _b : null,
            totalSystemUs: (_c = processCpuTotal === null || processCpuTotal === void 0 ? void 0 : processCpuTotal.system) !== null && _c !== void 0 ? _c : null,
            deltaUserUs: (_d = processCpuDelta === null || processCpuDelta === void 0 ? void 0 : processCpuDelta.user) !== null && _d !== void 0 ? _d : null,
            deltaSystemUs: (_e = processCpuDelta === null || processCpuDelta === void 0 ? void 0 : processCpuDelta.system) !== null && _e !== void 0 ? _e : null,
        },
        rss: memory ? process.memoryUsage.rss() : undefined, main: memory ? threadMemory(detailed) : undefined,
        osProcess, workers: workerSamples, counters };
}
exports.collectMemoryDiagnostics = collectMemoryDiagnostics;
function installMemoryDiagnostics(fastify) {
    var _a;
    if (!samplingEnabled() || installed.has(fastify))
        return;
    installed.add(fastify);
    monitorUsers++;
    if (memoryDiagnosticsEnabled() && !processProbe) {
        processProbe = new process_memory_probe_1.ProcessMemoryProbe();
        processProbe.request();
    }
    if (fastify.server)
        observeServerConnections("http", fastify.server);
    console.warn(`[DIAGNOSTICS] ${JSON.stringify({
        memory: memoryDiagnosticsEnabled() ? detailedMemoryDiagnosticsEnabled() ? "detailed" : "basic" : "off",
        sqlite: sqliteDiagnosticsEnabled(), nativeMemory: (_a = processProbe === null || processProbe === void 0 ? void 0 : processProbe.enabled) !== null && _a !== void 0 ? _a : false, intervalMs: 60000,
    })}`);
    const timer = setInterval(() => {
        const tag = memoryDiagnosticsEnabled() ? "MEM" : "SQLITE-PERF";
        try {
            const sample = collectMemoryDiagnostics();
            // SQLite sampling remains usable with memory collection switched off.
            console.warn(`[${tag}] ${JSON.stringify(tag === "MEM" ? sample : {
                timestamp: sample.timestamp, pid: sample.pid, cpu: sample.cpu, counters: sample.counters,
                workers: sample.workers.filter(worker => Object.keys(worker.diagnostics).length > 0).map(worker => ({
                    name: worker.name, threadId: worker.threadId, ageMs: worker.ageMs,
                    stale: worker.stale, pendingMs: worker.pendingMs, diagnostics: worker.diagnostics,
                })),
            })}`);
        }
        catch (_a) {
            console.warn(`[${tag}] sample unavailable`);
        }
    }, 60000);
    timer.unref();
    fastify.addHook("onClose", () => __awaiter(this, void 0, void 0, function* () {
        clearInterval(timer);
        installed.delete(fastify);
        if (--monitorUsers === 0) {
            processProbe === null || processProbe === void 0 ? void 0 : processProbe.close();
            processProbe = null;
            processCpuTotal = null;
            processCpuSampledAt = null;
            processCpuDelta = null;
        }
    }));
}
exports.installMemoryDiagnostics = installMemoryDiagnostics;
