"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.observeSqliteDatabase = void 0;
const node_perf_hooks_1 = require("node:perf_hooks");
const memory_diagnostics_1 = require("./memory-diagnostics");
const observed = new WeakSet();
/** Counts all prepare calls on a connection, including callers outside the LRU. */
function observeSqliteDatabase(db, name) {
    if (!(0, memory_diagnostics_1.sqliteDiagnosticsEnabled)() || observed.has(db))
        return;
    observed.add(db);
    const stats = { prepareCalls: 0, prepareErrors: 0, sampledPrepareCalls: 0,
        sampledPrepareMs: 0, maxSampledPrepareMs: 0,
        executeCalls: 0, executeErrors: 0, busyErrors: 0, sampledExecuteCalls: 0,
        sampledExecuteMs: 0, maxSampledExecuteMs: 0 };
    const readSettings = () => {
        const settings = { nativeBytesAvailable: false };
        for (const pragma of ["cache_size", "page_size", "mmap_size", "temp_store", "busy_timeout", "synchronous", "wal_autocheckpoint"]) {
            try {
                const value = db.pragma(pragma, { simple: true });
                settings[pragma] = typeof value === "number" ? value : null;
            }
            catch (_a) {
                settings[pragma] = null;
            }
        }
        return settings;
    };
    const prepare = db.prepare;
    db.prepare = function (sql) {
        stats.prepareCalls++;
        const sampled = stats.prepareCalls % 64 === 1;
        const start = sampled ? node_perf_hooks_1.performance.now() : 0;
        try {
            const statement = prepare.call(this, sql);
            const methods = statement;
            for (const method of ["get", "all", "run"]) {
                const execute = methods[method];
                methods[method] = function (...args) {
                    stats.executeCalls++;
                    const sampled = stats.executeCalls % 64 === 1;
                    const start = sampled ? node_perf_hooks_1.performance.now() : 0;
                    try {
                        return execute.apply(this, args);
                    }
                    catch (error) {
                        stats.executeErrors++;
                        if (String(error === null || error === void 0 ? void 0 : error.code).startsWith("SQLITE_BUSY"))
                            stats.busyErrors++;
                        throw error;
                    }
                    finally {
                        if (sampled) {
                            const elapsed = node_perf_hooks_1.performance.now() - start;
                            stats.sampledExecuteCalls++;
                            stats.sampledExecuteMs += elapsed;
                            stats.maxSampledExecuteMs = Math.max(stats.maxSampledExecuteMs, elapsed);
                        }
                    }
                };
            }
            return statement;
        }
        catch (error) {
            stats.prepareErrors++;
            throw error;
        }
        finally {
            if (sampled) {
                const elapsed = node_perf_hooks_1.performance.now() - start;
                stats.sampledPrepareCalls++;
                stats.sampledPrepareMs += elapsed;
                stats.maxSampledPrepareMs = Math.max(stats.maxSampledPrepareMs, elapsed);
            }
        }
    };
    // Do not keep the connection alive from the process-wide counter registry.
    const reference = new WeakRef(db);
    const unregister = (0, memory_diagnostics_1.registerMemoryCounters)(`sqlite.${name}`, () => {
        const connection = reference.deref();
        if (!(connection === null || connection === void 0 ? void 0 : connection.open)) {
            unregister();
            return { unavailable: true };
        }
        return Object.assign(Object.assign(Object.assign({}, readSettings()), stats), { inTransaction: connection.inTransaction });
    }, "sqlite");
}
exports.observeSqliteDatabase = observeSqliteDatabase;
