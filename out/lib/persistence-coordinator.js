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
exports.drainPersistence = exports.runBackgroundPersistenceTask = exports.runPersistenceTransactionSync = exports.runWriterCommand = exports.runPersistenceSqlCommand = exports.runPersistenceTransaction = exports.configurePersistenceSqlExecutor = void 0;
const node_perf_hooks_1 = require("node:perf_hooks");
const node_async_hooks_1 = require("node:async_hooks");
const utils_1 = require("../utils");
const db_1 = require("../data/db");
const memory_diagnostics_1 = require("./memory-diagnostics");
const command_registry_1 = require("./persistence/command-registry");
const writer_client_1 = require("./persistence/writer-client");
const server_work_performance_1 = require("./server-work-performance");
const persistence_admission_1 = require("./persistence-admission");
const persistence_write_gate_1 = require("./persistence-write-gate");
const shutdown_state_1 = require("./shutdown-state");
const sqlite_write_coordinator_1 = require("./sqlite-write-coordinator");
let globalWriteTail = Promise.resolve();
// An async command owns one admission slot through its nested sync work.
// The active flag prevents detached callbacks from reusing a released slot.
const admittedCommand = new node_async_hooks_1.AsyncLocalStorage();
// The first migration step keeps SQLite in the main process. Nested domain
// transactions belong to the outer command for metrics, but retain savepoints
// so a caught inner error cannot leave partial writes in the outer transaction.
let activePersistenceContext;
const persistenceStats = new Map();
let persistenceSqlExecutor = null;
let writerFallbackCount = 0;
let writerStartupWaitCount = 0;
function yieldToEventLoop() {
    return new Promise(resolve => setImmediate(resolve));
}
function statsFor(domain) {
    const existing = persistenceStats.get(domain);
    if (existing)
        return existing;
    const created = {
        queued: 0, committed: 0, failed: 0, maxPending: 0, queueMs: 0, transactionMs: 0,
        maxQueueMs: 0, maxTransactionMs: 0,
    };
    persistenceStats.set(domain, created);
    return created;
}
(0, memory_diagnostics_1.registerMemoryCounters)("persistence", () => {
    const counters = {};
    counters["writer.fallbacks"] = writerFallbackCount;
    counters["writer.startupWaits"] = writerStartupWaitCount;
    for (const [key, value] of Object.entries(persistence_admission_1.persistenceAdmission.stats()))
        counters[`admission.${key}`] = value;
    for (const [key, value] of Object.entries(persistence_write_gate_1.persistenceWriteGate.stats()))
        counters[`writeGate.${key}`] = value;
    for (const [domain, value] of persistenceStats) {
        counters[`domain.${domain}.queued`] = value.queued;
        counters[`domain.${domain}.committed`] = value.committed;
        counters[`domain.${domain}.failed`] = value.failed;
        const pending = Math.max(0, value.queued - value.committed - value.failed);
        counters[`domain.${domain}.pending`] = pending;
        counters[`domain.${domain}.maxPending`] = value.maxPending;
        counters[`domain.${domain}.avgQueueMs`] = value.queued === 0 ? 0 : value.queueMs / value.queued;
        counters[`domain.${domain}.avgTransactionMs`] = value.committed + value.failed === 0
            ? 0 : value.transactionMs / (value.committed + value.failed);
        counters[`domain.${domain}.maxQueueMs`] = value.maxQueueMs;
        counters[`domain.${domain}.maxTransactionMs`] = value.maxTransactionMs;
    }
    return counters;
}, "sqlite");
function enqueueGlobalWrite(operation) {
    const previous = globalWriteTail;
    let release;
    const current = new Promise(resolve => { release = resolve; });
    globalWriteTail = previous.then(() => current);
    return previous.then(() => __awaiter(this, void 0, void 0, function* () {
        try {
            return yield operation();
        }
        finally {
            release();
        }
    }));
}
function enqueuePersistence(context, operation, exclusive = false) {
    try {
        return (0, shutdown_state_1.withServerWorkAdmission)(() => enqueueAcceptedPersistence(context, operation, exclusive));
    }
    catch (error) {
        statsFor(context.domain).failed++;
        return Promise.reject(error);
    }
}
function enqueueAcceptedPersistence(context, operation, exclusive) {
    let release;
    try {
        release = persistence_admission_1.persistenceAdmission.acquire(context.playerId);
    }
    catch (error) {
        statsFor(context.domain).failed++;
        return Promise.reject(error);
    }
    // Capacity includes running work and all upstream waiting chains, not only
    // commands already handed to the optional SQLite writer thread.
    const admission = { active: true };
    const execute = () => admittedCommand.run(admission, () => __awaiter(this, void 0, void 0, function* () {
        const releaseGate = yield persistence_write_gate_1.persistenceWriteGate.acquire(exclusive);
        try {
            return yield operation();
        }
        finally {
            releaseGate();
        }
    }));
    const pending = context.playerId === undefined
        ? enqueueGlobalWrite(execute) : (0, sqlite_write_coordinator_1.withPlayerWriteQueue)(context.playerId, execute);
    return pending.finally(() => { admission.active = false; release(); });
}
function withPersistenceContext(context, operation) {
    var _a;
    const previous = activePersistenceContext;
    activePersistenceContext = context;
    try {
        // Capture the content clock after BEGIN/queueing. Existing player
        // markers affect EXP/day/week storage only, never content visibility.
        const offset = (_a = (0, utils_1.getLegacyTimeOffset)()) !== null && _a !== void 0 ? _a : 0;
        return (0, utils_1.withServerClock)(Date.now() + offset, operation, offset);
    }
    finally {
        activePersistenceContext = previous;
    }
}
/**
 * Install the optional worker-backed SQL command executor. The normal
 * transaction callback path remains available for commands that still need
 * in-process domain logic. Only explicitly commandized writes use this hook.
 */
function configurePersistenceSqlExecutor(executor) {
    persistenceSqlExecutor = executor;
}
exports.configurePersistenceSqlExecutor = configurePersistenceSqlExecutor;
/**
 * Execute one complete main-database transaction under an explicit domain.
 *
 * The operation remains synchronous from better-sqlite3's point of view. The
 * queue and timing seam are deliberate: business modules can migrate here one
 * by one, while a future worker-backed executor can preserve the same contract.
 */
function runPersistenceTransaction(context_1, operation_1) {
    return __awaiter(this, arguments, void 0, function* (context, operation, options = {}) {
        const queuedAt = node_perf_hooks_1.performance.now();
        const stats = statsFor(context.domain);
        stats.queued++;
        stats.maxPending = Math.max(stats.maxPending, stats.queued - stats.committed - stats.failed);
        const execute = () => __awaiter(this, void 0, void 0, function* () {
            // A burst of queued SQLite commands otherwise chains through promise
            // microtasks without returning to libuv. Give TCP heartbeats and HTTP
            // callbacks one scheduling turn between transactions.
            yield yieldToEventLoop();
            const queueMs = node_perf_hooks_1.performance.now() - queuedAt;
            stats.queueMs += queueMs;
            stats.maxQueueMs = Math.max(stats.maxQueueMs, queueMs);
            (0, server_work_performance_1.recordServerWork)("persistence.queue", queueMs);
            const startedAt = node_perf_hooks_1.performance.now();
            try {
                const result = yield (0, sqlite_write_coordinator_1.runImmediateTransactionWithRetry)(() => (withPersistenceContext(context, operation)));
                stats.committed++;
                if (options.afterCommit) {
                    try {
                        options.afterCommit(result);
                    }
                    catch (error) {
                        // The database is already committed. Observability or
                        // non-durable side effects must not turn success into a retry.
                        console.error(`[PERSISTENCE] afterCommit failed: domain=${context.domain} operation=${context.operation}`, error);
                    }
                }
                return result;
            }
            catch (error) {
                stats.failed++;
                throw error;
            }
            finally {
                const transactionMs = node_perf_hooks_1.performance.now() - startedAt;
                stats.transactionMs += transactionMs;
                stats.maxTransactionMs = Math.max(stats.maxTransactionMs, transactionMs);
                (0, server_work_performance_1.recordServerWork)("persistence.transaction", transactionMs);
            }
        });
        return enqueuePersistence(context, execute);
    });
}
exports.runPersistenceTransaction = runPersistenceTransaction;
/**
 * Execute a serializable write command through the optional persistence
 * worker. When the worker is disabled, use the same in-process coordinator so
 * local development and existing deployments keep identical semantics.
 */
function runPersistenceSqlCommand(context, statements, fallback) {
    if (persistenceSqlExecutor === null) {
        return runPersistenceTransaction(context, () => { fallback(); }).then(() => undefined);
    }
    const queuedAt = node_perf_hooks_1.performance.now();
    const stats = statsFor(context.domain);
    stats.queued++;
    stats.maxPending = Math.max(stats.maxPending, stats.queued - stats.committed - stats.failed);
    const execute = () => __awaiter(this, void 0, void 0, function* () {
        yield yieldToEventLoop();
        const queueMs = node_perf_hooks_1.performance.now() - queuedAt;
        stats.queueMs += queueMs;
        stats.maxQueueMs = Math.max(stats.maxQueueMs, queueMs);
        (0, server_work_performance_1.recordServerWork)("persistence.queue", queueMs);
        const startedAt = node_perf_hooks_1.performance.now();
        try {
            yield persistenceSqlExecutor(context, statements);
            stats.committed++;
        }
        catch (error) {
            stats.failed++;
            throw error;
        }
        finally {
            const transactionMs = node_perf_hooks_1.performance.now() - startedAt;
            stats.transactionMs += transactionMs;
            stats.maxTransactionMs = Math.max(stats.maxTransactionMs, transactionMs);
            (0, server_work_performance_1.recordServerWork)("persistence.transaction", transactionMs);
        }
    });
    return enqueuePersistence(context, execute);
}
exports.runPersistenceSqlCommand = runPersistenceSqlCommand;
/**
 * Execute a registered write command.
 *
 * The command runs in the SQLite writer thread when `CN_WRITER_THREAD` is
 * enabled and the thread is ready, and in-process otherwise. Both paths share
 * the same registry entry, the same per-player/global ordering and the same
 * domain metrics, so flipping the switch cannot change business results.
 *
 * The command implementation owns its transaction: the writer thread already
 * wraps every command in the batch transaction, and the in-process path leaves
 * the existing `runPersistenceTransactionSync` contract untouched.
 */
function runWriterCommand(name, args, context) {
    return __awaiter(this, void 0, void 0, function* () {
        const queuedAt = node_perf_hooks_1.performance.now();
        const stats = statsFor(context.domain);
        stats.queued++;
        stats.maxPending = Math.max(stats.maxPending, stats.queued - stats.committed - stats.failed);
        const execute = () => __awaiter(this, void 0, void 0, function* () {
            yield yieldToEventLoop();
            const queueMs = node_perf_hooks_1.performance.now() - queuedAt;
            stats.queueMs += queueMs;
            stats.maxQueueMs = Math.max(stats.maxQueueMs, queueMs);
            (0, server_work_performance_1.recordServerWork)("persistence.queue", queueMs);
            const startedAt = node_perf_hooks_1.performance.now();
            try {
                const result = yield executeRegisteredWriterCommand(name, args, context);
                stats.committed++;
                return result;
            }
            catch (error) {
                stats.failed++;
                throw error;
            }
            finally {
                const transactionMs = node_perf_hooks_1.performance.now() - startedAt;
                stats.transactionMs += transactionMs;
                stats.maxTransactionMs = Math.max(stats.maxTransactionMs, transactionMs);
                (0, server_work_performance_1.recordServerWork)("persistence.transaction", transactionMs);
            }
        });
        return enqueuePersistence(context, execute);
    });
}
exports.runWriterCommand = runWriterCommand;
/** Bounded wait so the first requests after a restart do not fail on warm-up. */
const WRITER_STARTUP_WAIT_MS = 10000;
function executeRegisteredWriterCommand(name, args, context) {
    return __awaiter(this, void 0, void 0, function* () {
        if ((0, writer_client_1.isSqliteWriterEnabled)()) {
            if (!(0, writer_client_1.isSqliteWriterReady)()) {
                writerStartupWaitCount++;
                yield (0, writer_client_1.waitForSqliteWriterReady)(WRITER_STARTUP_WAIT_MS);
            }
            if ((0, writer_client_1.isSqliteWriterReady)()) {
                const value = yield (0, writer_client_1.executeSqliteWriterCommand)({
                    name,
                    args,
                    meta: {
                        domain: context.domain,
                        operation: context.operation,
                        playerId: context.playerId,
                    },
                });
                return value;
            }
            // The worker is configured but never became ready. An explicit
            // fallback switch may continue in-process; otherwise the caller must
            // see the failure instead of an unverified write.
            const reason = `SQLite writer thread is not ready; command ${name} was not executed.`;
            if (!(0, writer_client_1.writerThreadSettings)().fallback)
                throw new Error(reason);
            writerFallbackCount++;
            console.error(`[PERSISTENCE] ${reason} Falling back to the in-process implementation.`);
        }
        return runRegisteredWriterCommandInProcess(name, args, context);
    });
}
let writerCommandsLoaded = false;
/**
 * Bind command names to domain code on first use.
 *
 * The requirement is intentionally lazy: `commands` imports domain modules
 * that import this coordinator, so a top-level import would create a
 * module-load cycle. Requiring it here keeps the import graph acyclic while
 * still letting any entry point (server, test or script) run a command
 * in-process without remembering to import the registry.
 */
function ensureWriterCommandsLoaded() {
    if (writerCommandsLoaded)
        return;
    writerCommandsLoaded = true;
    require("./persistence/commands");
}
function runRegisteredWriterCommandInProcess(name, args, context) {
    ensureWriterCommandsLoaded();
    const handler = (0, command_registry_1.getWriterCommand)(name);
    if (handler === undefined) {
        throw new Error(`Writer command is not registered: ${name}`);
    }
    const effects = [];
    const commandContext = (0, command_registry_1.createWriterCommandContext)({ domain: context.domain, operation: context.operation, playerId: context.playerId }, effect => effects.push(effect));
    // Acquire the SQLite write lock before capturing the command clock. A
    // busy lock can outlive a content deadline just like the async queue can.
    const result = runPersistenceTransactionSync(context, () => handler(args, commandContext));
    for (const effect of effects) {
        try {
            effect();
        }
        catch (error) {
            // Mirrors runPersistenceTransaction: an already committed command
            // must not be reported as failed because a side effect threw.
            console.error(`[PERSISTENCE] afterCommit failed: domain=${context.domain} operation=${context.operation}`, error);
        }
    }
    return result;
}
/**
 * Compatibility boundary for legacy synchronous callers.
 *
 * Synchronous APIs cannot wait on the async queue, so this helper keeps the
 * existing better-sqlite3 immediate-transaction contract and contributes to
 * the same domain metrics. New request paths should use the async variant.
 */
function runPersistenceTransactionSync(context, operation) {
    var _a;
    (0, shutdown_state_1.assertServerAcceptingWork)();
    // better-sqlite3 creates a savepoint when already inside a transaction.
    // Do not replace this with operation(): some callers catch an inner failure
    // and continue, and still require that inner operation to roll back.
    if (activePersistenceContext)
        return (0, db_1.getDb)().transaction(operation)();
    persistence_write_gate_1.persistenceWriteGate.assertSynchronousWriteAllowed();
    const stats = statsFor(context.domain);
    stats.queued++;
    stats.maxPending = Math.max(stats.maxPending, stats.queued - stats.committed - stats.failed);
    const startedAt = node_perf_hooks_1.performance.now();
    let release;
    try {
        if (!((_a = admittedCommand.getStore()) === null || _a === void 0 ? void 0 : _a.active))
            release = persistence_admission_1.persistenceAdmission.acquire(context.playerId);
        const result = (0, db_1.getDb)().transaction(() => (withPersistenceContext(context, operation))).immediate();
        stats.committed++;
        return result;
    }
    catch (error) {
        stats.failed++;
        throw error;
    }
    finally {
        release === null || release === void 0 ? void 0 : release();
        const transactionMs = node_perf_hooks_1.performance.now() - startedAt;
        stats.transactionMs += transactionMs;
        stats.maxTransactionMs = Math.max(stats.maxTransactionMs, transactionMs);
        (0, server_work_performance_1.recordServerWork)("persistence.transaction", transactionMs);
    }
}
exports.runPersistenceTransactionSync = runPersistenceTransactionSync;
/**
 * A worker owns its own SQLite transaction. Never await it inside a transaction
 * on the main connection. Normal admitted commands wait without blocking the
 * event loop; legacy raw SQL fails promptly instead of busy-waiting on its lock.
 * The operation must wait for worker exit/connection close before resolving.
 */
function runBackgroundPersistenceTask(context, operation, prepare, beforePrepare) {
    var _a;
    if (((_a = admittedCommand.getStore()) === null || _a === void 0 ? void 0 : _a.active) || (0, db_1.getDb)().inTransaction) {
        return Promise.reject(new Error("Background persistence cannot start inside another persistence command or transaction."));
    }
    const stats = statsFor(context.domain);
    stats.queued++;
    stats.maxPending = Math.max(stats.maxPending, stats.queued - stats.committed - stats.failed);
    return enqueuePersistence(context, () => __awaiter(this, void 0, void 0, function* () {
        const db = (0, db_1.getDb)();
        const busyTimeout = db.pragma("busy_timeout", { simple: true });
        db.pragma("busy_timeout = 0");
        try {
            // Cancellation of an accepted but still queued worker must be
            // checked before even the short preparation BEGIN.
            beforePrepare === null || beforePrepare === void 0 ? void 0 : beforePrepare();
            // Wait for prior native writers before even the small preparation
            // transaction, otherwise BEGIN here could still stall the main loop.
            const prepared = prepare ? db.transaction(() => withPersistenceContext(context, prepare)).immediate() : undefined;
            const result = yield operation(prepared);
            stats.committed++;
            return result;
        }
        catch (error) {
            stats.failed++;
            throw error;
        }
        finally {
            db.pragma(`busy_timeout = ${busyTimeout}`);
        }
    }), true);
}
exports.runBackgroundPersistenceTask = runBackgroundPersistenceTask;
/** Wait for queued asynchronous persistence work before a graceful shutdown. */
function drainPersistence() {
    return __awaiter(this, void 0, void 0, function* () {
        yield globalWriteTail;
        yield (0, sqlite_write_coordinator_1.drainPlayerWriteQueues)();
    });
}
exports.drainPersistence = drainPersistence;
