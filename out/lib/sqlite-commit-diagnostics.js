"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.drainSqliteCommitDiagnostics = exports.endCommitProbe = exports.beginCommitProbe = exports.readWalCommitState = void 0;
const node_fs_1 = require("node:fs");
const node_os_1 = require("node:os");
const node_perf_hooks_1 = require("node:perf_hooks");
const memory_diagnostics_1 = require("./memory-diagnostics");
const settingsCache = new WeakMap();
const littleEndian = (0, node_os_1.endianness)() === "LE";
const uint32 = (b, offset) => littleEndian ? b.readUInt32LE(offset) : b.readUInt32BE(offset);
const uint16 = (b, offset) => littleEndian ? b.readUInt16LE(offset) : b.readUInt16BE(offset);
/** Read WAL-index metadata only; never run a checkpoint or read player rows. */
function readWalCommitState(db) {
    if (!db.open || db.memory || !db.name)
        return null;
    let fd;
    try {
        fd = (0, node_fs_1.openSync)(`${db.name}-shm`, "r");
        const header = Buffer.allocUnsafe(100), verify = Buffer.allocUnsafe(100);
        // Matching copies and repeated reads reject concurrent/torn observations.
        if ((0, node_fs_1.readSync)(fd, header, 0, 100, 0) !== 100 || (0, node_fs_1.readSync)(fd, verify, 0, 100, 0) !== 100
            || !header.equals(verify) || !header.subarray(0, 48).equals(header.subarray(48, 96))
            || uint32(header, 0) !== 3007000 || header[12] !== 1)
            return null;
        const frames = uint32(header, 16), backfilled = uint32(header, 96);
        if (backfilled > frames)
            return null;
        const size = uint16(header, 14);
        return { frames, backfilled, generation: header.subarray(32, 40).toString("hex"), pageSize: size === 1 ? 65536 : size };
    }
    catch (_a) {
        return null;
    }
    finally {
        if (fd !== undefined) {
            try {
                (0, node_fs_1.closeSync)(fd);
            }
            catch ( /* diagnostic only */_b) { /* diagnostic only */ }
        }
    }
}
exports.readWalCommitState = readWalCommitState;
function settingsFor(db) {
    var _a, _b;
    let settings = settingsCache.get(db);
    if (settings)
        return settings;
    const read = (key) => { try {
        return db.pragma(key, { simple: true });
    }
    catch (_a) {
        return null;
    } };
    const number = (key) => { const v = read(key); return typeof v === "number" ? v : null; };
    const mode = read("journal_mode");
    let version;
    try {
        version = db.prepare("SELECT sqlite_version() AS sqliteVersion, sqlite_source_id() AS sqliteSourceId")
            .get();
    }
    catch ( /* Diagnostic metadata must not affect settlement. */_c) { /* Diagnostic metadata must not affect settlement. */ }
    settings = { journalMode: typeof mode === "string" ? mode : null, synchronous: number("synchronous"),
        autoCheckpoint: number("wal_autocheckpoint"), busyTimeout: number("busy_timeout"),
        sqliteVersion: (_a = version === null || version === void 0 ? void 0 : version.sqliteVersion) !== null && _a !== void 0 ? _a : null, sqliteSourceId: (_b = version === null || version === void 0 ? void 0 : version.sqliteSourceId) !== null && _b !== void 0 ? _b : null };
    settingsCache.set(db, settings);
    return settings;
}
function beginCommitProbe(db, kind) {
    var _a, _b;
    if (!(0, memory_diagnostics_1.sqliteDiagnosticsEnabled)() || /^(0|false|no|off)$/i.test((_a = process.env.SQLITE_COMMIT_DIAGNOSTICS) !== null && _a !== void 0 ? _a : "true")
        || /^(0|false|no|off)$/i.test((_b = process.env.ROUTE_PERF_SUMMARY) !== null && _b !== void 0 ? _b : "true"))
        return;
    const settings = settingsFor(db);
    const before = settings.journalMode === "wal" ? readWalCommitState(db) : null;
    return { kind, settings, before, cpu: process.cpuUsage(), startedAt: node_perf_hooks_1.performance.now() };
}
exports.beginCommitProbe = beginCommitProbe;
const stats = () => ({ n: 0, totalMs: 0, maxMs: 0, errors: 0, slow: 0, checkpointProgress: 0, unavailableWal: 0 });
let totals = stats(), samples = [], omitted = 0;
const rounded = (n) => Math.round(n * 1000) / 1000;
function endCommitProbe(db, probe, success, error) {
    var _a, _b;
    if (!probe)
        return;
    // Exclude the following metadata read from the measured COMMIT interval.
    const wallMs = node_perf_hooks_1.performance.now() - probe.startedAt;
    const cpu = process.cpuUsage(probe.cpu);
    totals.n++;
    totals.totalMs += wallMs;
    totals.maxMs = Math.max(totals.maxMs, wallMs);
    if (!success)
        totals.errors++;
    const configured = Number((_a = process.env.SQLITE_SLOW_COMMIT_MS) !== null && _a !== void 0 ? _a : 100);
    const threshold = Number.isFinite(configured) ? Math.max(0, configured) : 100;
    if (success && wallMs < threshold)
        return;
    totals.slow++;
    const after = probe.settings.journalMode === "wal" ? readWalCommitState(db) : null;
    const before = probe.before;
    const walReset = before && after ? before.generation !== after.generation : null;
    // Observed progress does not identify the connection that performed it.
    const checkpointProgress = before && after
        ? (walReset ? after.backfilled > 0 : after.backfilled > before.backfilled) : null;
    if (checkpointProgress)
        totals.checkpointProgress++;
    if (!before || !after)
        totals.unavailableWal++;
    const code = String((_b = error === null || error === void 0 ? void 0 : error.code) !== null && _b !== void 0 ? _b : "");
    samples.push({ timestamp: new Date().toISOString(), kind: probe.kind, wallMs: rounded(wallMs),
        processCpuMs: rounded((cpu.user + cpu.system) / 1000), success,
        errorCode: /^SQLITE_[A-Z_]+$/.test(code) ? code : success ? null : "unknown",
        settings: probe.settings, before, after, checkpointProgress, walReset });
    samples.sort((a, b) => b.wallMs - a.wallMs);
    if (samples.length > 8) {
        samples.pop();
        omitted++;
    }
}
exports.endCommitProbe = endCommitProbe;
function drainSqliteCommitDiagnostics() {
    const summary = Object.assign(Object.assign({}, totals), { totalMs: rounded(totals.totalMs), maxMs: rounded(totals.maxMs), avgMs: totals.n ? rounded(totals.totalMs / totals.n) : 0, samples, omitted });
    totals = stats();
    samples = [];
    omitted = 0;
    return summary;
}
exports.drainSqliteCommitDiagnostics = drainSqliteCommitDiagnostics;
