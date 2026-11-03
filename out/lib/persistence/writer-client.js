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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.stopSqliteWriter = exports.waitForSqliteWriterReady = exports.drainSqliteWriter = exports.sqliteWriterStats = exports.sqliteWriterQueueDepth = exports.setSqliteWriterCheckpointOwner = exports.executeSqliteWriterCommand = exports.startSqliteWriter = exports.isSqliteWriterReady = exports.isSqliteWriterEnabled = exports.writerThreadSettings = exports.SqliteWriterError = void 0;
const node_path_1 = __importDefault(require("node:path"));
const node_worker_threads_1 = require("node:worker_threads");
const file_exists_1 = require("../file-exists");
const memory_diagnostics_1 = require("../memory-diagnostics");
const writer_config_1 = require("./writer-config");
const utils_1 = require("../../utils");
class SqliteWriterError extends Error {
    constructor(message, code) {
        super(message);
        this.name = "SqliteWriterError";
        this.code = code;
    }
}
exports.SqliteWriterError = SqliteWriterError;
const state = {
    enabled: false,
    started: false,
    ready: false,
    closing: false,
    submitted: 0,
    completed: 0,
    failed: 0,
    queueFull: 0,
    timeouts: 0,
    restarts: 0,
    abandoned: 0,
    inFlight: 0,
    waiting: 0,
    maxWaiting: 0,
    maxInFlight: 0,
    batches: 0,
    lastBatchSize: 0,
    maxBatchSize: 0,
    lastCommitMs: 0,
    totalCommitMs: 0,
    savepointRollbacks: 0,
    lastError: null,
};
let config = (0, writer_config_1.writerThreadConfig)();
let worker = null;
let databasePath = null;
let nextId = 1;
let restartTimer = null;
let closeResolve = null;
const inFlight = new Map();
const waiting = [];
// Registered in the default counter group on purpose: writer health
// (submitted/failed/timeouts/restarts/batches) is an operational metric and
// must stay visible while SQLITE_DIAGNOSTICS is off, which is the production
// default.
(0, memory_diagnostics_1.registerMemoryCounters)("sqliteWriter", () => {
    var _a, _b;
    return ({
        enabled: state.enabled,
        started: state.started,
        ready: state.ready,
        submitted: state.submitted,
        completed: state.completed,
        failed: state.failed,
        queueFull: state.queueFull,
        timeouts: state.timeouts,
        restarts: state.restarts,
        abandoned: state.abandoned,
        inFlight: inFlight.size,
        waiting: waiting.length,
        maxWaiting: state.maxWaiting,
        maxInFlight: state.maxInFlight,
        batches: state.batches,
        lastBatchSize: state.lastBatchSize,
        maxBatchSize: state.maxBatchSize,
        lastCommitMs: state.lastCommitMs,
        totalCommitMs: state.totalCommitMs,
        savepointRollbacks: state.savepointRollbacks,
        groupCommitWindowMs: config.groupCommitWindowMs,
        groupCommitMax: config.groupCommitMax,
        lastError: state.lastError !== null,
        lastErrorLength: (_b = (_a = state.lastError) === null || _a === void 0 ? void 0 : _a.length) !== null && _b !== void 0 ? _b : 0,
    });
});
function workerLocation() {
    // This module lives in lib/persistence, so the worker sits two levels up.
    const compiled = node_path_1.default.resolve(__dirname, "../../workers/sqlite-writer-worker.js");
    if ((0, file_exists_1.existsSync)(compiled))
        return { filename: compiled };
    return {
        filename: node_path_1.default.resolve(__dirname, "../../workers/sqlite-writer-worker.ts"),
        execArgv: ["-r", require.resolve("ts-node/register/transpile-only")],
    };
}
function recordError(error) {
    state.lastError = (error instanceof Error ? error.message : String(error)).slice(0, 240);
}
function settle(command, error, value) {
    if (command.timer !== null) {
        clearTimeout(command.timer);
        command.timer = null;
    }
    inFlight.delete(command.id);
    if (error === null)
        command.resolve(value);
    else
        command.reject(error);
}
function rejectAll(error) {
    for (const command of [...inFlight.values()]) {
        state.abandoned++;
        settle(command, error);
    }
    while (waiting.length > 0) {
        const command = waiting.shift();
        state.abandoned++;
        settle(command, error);
    }
}
function pump() {
    if (worker === null || !state.ready || state.closing)
        return;
    while (inFlight.size < config.maxInFlight && waiting.length > 0) {
        const command = waiting.shift();
        inFlight.set(command.id, command);
        state.maxInFlight = Math.max(state.maxInFlight, inFlight.size);
        if (config.commandTimeoutMs > 0) {
            command.timer = setTimeout(() => {
                if (!inFlight.has(command.id))
                    return;
                state.timeouts++;
                settle(command, new SqliteWriterError(`SQLite writer command timed out after ${config.commandTimeoutMs}ms.`, "SQLITE_WRITER_TIMEOUT"));
                // The worker may still be inside the timed-out transaction, so
                // its state is unknown. Terminating the worker closes the
                // connection and lets SQLite roll the open transaction back.
                forceRestart("command timeout");
            }, config.commandTimeoutMs);
        }
        try {
            worker.postMessage({
                type: "command",
                id: command.id,
                name: command.command.name,
                args: command.command.args,
                meta: command.command.meta,
            });
        }
        catch (error) {
            settle(command, error instanceof Error ? error : new Error(String(error)));
            state.failed++;
            recordError(error);
        }
    }
}
function forceRestart(reason) {
    const current = worker;
    if (current === null)
        return;
    console.error(`[WRITER] restarting SQLite writer worker: ${reason}`);
    // Stop accepting work immediately. The exit event only fires after
    // terminate() completes, and a command dispatched in that window would be
    // sent to a dying worker.
    state.ready = false;
    rejectAll(new SqliteWriterError(`SQLite writer worker is restarting: ${reason}`, "SQLITE_WRITER_RESTARTING"));
    void current.terminate();
}
function scheduleRestart() {
    if (state.closing || databasePath === null || restartTimer !== null)
        return;
    if (state.restarts >= config.maxRestarts) {
        console.error(`[WRITER] SQLite writer worker reached the restart limit (${config.maxRestarts}); `
            + "commands will fail until the service restarts.");
        return;
    }
    const attempt = state.restarts + 1;
    restartTimer = setTimeout(() => {
        restartTimer = null;
        if (state.closing || databasePath === null)
            return;
        state.restarts++;
        startWorker(databasePath);
    }, Math.min(1000, 100 * attempt));
}
function startWorker(targetDatabasePath) {
    const location = workerLocation();
    const current = new node_worker_threads_1.Worker(location.filename, Object.assign(Object.assign({}, (location.execArgv ? { execArgv: location.execArgv } : {})), { workerData: {
            databasePath: targetDatabasePath,
            busyTimeoutMs: config.busyTimeoutMs,
            groupCommitWindowMs: config.groupCommitWindowMs,
            groupCommitMax: config.groupCommitMax,
            protocolVersion: writer_config_1.WRITER_PROTOCOL_VERSION,
        } }));
    worker = current;
    state.started = true;
    state.ready = false;
    (0, memory_diagnostics_1.observeWorkerMemory)("sqlite-writer", current);
    current.on("message", (message) => {
        var _a, _b;
        if (worker !== current)
            return;
        switch (message === null || message === void 0 ? void 0 : message.type) {
            case "ready":
                state.ready = true;
                // Commands executed here must read the same virtual clock as
                // the main thread; push before any queued command is sent.
                pushTimeOffset();
                pump();
                return;
            case "result":
            case "error": {
                const command = inFlight.get(Number(message.id));
                if (command === undefined)
                    return;
                if (message.type === "result") {
                    state.completed++;
                    settle(command, null, message.value);
                }
                else {
                    state.failed++;
                    const error = new SqliteWriterError(String((_a = message.error) !== null && _a !== void 0 ? _a : "SQLite writer command failed."), String((_b = message.code) !== null && _b !== void 0 ? _b : "SQLITE_WRITER_COMMAND_FAILED"));
                    recordError(error);
                    settle(command, error);
                }
                pump();
                return;
            }
            case "fatal":
                recordError(message.error);
                console.error(`[WRITER] worker reported a fatal startup error: ${String(message.error)}`);
                return;
            case "batch":
                state.batches++;
                state.lastBatchSize = Number(message.size) || 0;
                state.maxBatchSize = Math.max(state.maxBatchSize, state.lastBatchSize);
                state.lastCommitMs = Number(message.commitMs) || 0;
                state.totalCommitMs += state.lastCommitMs;
                state.savepointRollbacks += Number(message.rollbacks) || 0;
                return;
            case "closed":
                closeResolve === null || closeResolve === void 0 ? void 0 : closeResolve();
                closeResolve = null;
                return;
            default:
                return;
        }
    });
    current.on("error", error => {
        if (worker !== current)
            return;
        recordError(error);
        console.error(`[WRITER] worker error: ${error.message}`);
        state.ready = false;
    });
    current.once("exit", code => {
        if (worker !== current)
            return;
        worker = null;
        state.ready = false;
        state.started = false;
        if (!state.closing) {
            const reason = new SqliteWriterError(`SQLite writer worker exited (code ${code}).`, "SQLITE_WRITER_EXITED");
            recordError(reason);
            rejectAll(reason);
            scheduleRestart();
        }
    });
    console.log(`[DB] sqlite writer thread enabled busyTimeoutMs=${config.busyTimeoutMs}`
        + ` groupCommitWindowMs=${config.groupCommitWindowMs} groupCommitMax=${config.groupCommitMax}`);
}
function writerThreadSettings() {
    return config;
}
exports.writerThreadSettings = writerThreadSettings;
function isSqliteWriterEnabled() {
    return config.enabled;
}
exports.isSqliteWriterEnabled = isSqliteWriterEnabled;
function isSqliteWriterReady() {
    return worker !== null && state.ready;
}
exports.isSqliteWriterReady = isSqliteWriterReady;
/** Forward the main thread's global virtual-clock offset to the writer thread. */
function pushTimeOffset() {
    const current = worker;
    if (current === null)
        return;
    try {
        current.postMessage({ type: "set_time_offset", offset: (0, utils_1.getLegacyTimeOffset)() });
    }
    catch (error) {
        console.error(`[WRITER] failed to push the time offset: ${error instanceof Error ? error.message : String(error)}`);
    }
}
let timeOffsetListenerRegistered = false;
/** Keep later management-panel time changes in sync with the writer thread. */
function registerTimeOffsetListener() {
    if (timeOffsetListenerRegistered)
        return;
    timeOffsetListenerRegistered = true;
    (0, utils_1.onServerTimeOffsetChanged)(() => pushTimeOffset());
}
function startSqliteWriter(targetDatabasePath, environment = process.env) {
    config = (0, writer_config_1.writerThreadConfig)(environment);
    state.enabled = config.enabled;
    if (!config.enabled)
        return false;
    registerTimeOffsetListener();
    if (worker !== null)
        return true;
    // A previous stop() leaves the client closing; an explicit restart must
    // clear that so commands are accepted again.
    state.closing = false;
    state.restarts = 0;
    databasePath = targetDatabasePath;
    startWorker(targetDatabasePath);
    return true;
}
exports.startSqliteWriter = startSqliteWriter;
function executeSqliteWriterCommand(command) {
    if (worker === null || !state.ready || state.closing) {
        return Promise.reject(new SqliteWriterError("SQLite writer worker is not running.", "SQLITE_WRITER_UNAVAILABLE"));
    }
    if (waiting.length >= config.queueMax) {
        state.queueFull++;
        return Promise.reject(new SqliteWriterError(`SQLite writer queue is full (${config.queueMax}).`, "SQLITE_WRITER_QUEUE_FULL"));
    }
    state.submitted++;
    return new Promise((resolve, reject) => {
        const entry = {
            id: nextId++,
            command,
            resolve,
            reject,
            timer: null,
        };
        waiting.push(entry);
        state.waiting = waiting.length;
        state.maxWaiting = Math.max(state.maxWaiting, waiting.length);
        pump();
    });
}
exports.executeSqliteWriterCommand = executeSqliteWriterCommand;
/** Tell the writer connection who owns WAL checkpointing. */
function setSqliteWriterCheckpointOwner(external) {
    try {
        worker === null || worker === void 0 ? void 0 : worker.postMessage({ type: "checkpoint_owner", external });
    }
    catch (_a) {
        // A worker exiting during the handoff keeps its automatic checkpoint
        // owner; the main connection follows the same rule.
    }
}
exports.setSqliteWriterCheckpointOwner = setSqliteWriterCheckpointOwner;
function sqliteWriterQueueDepth() {
    return waiting.length + inFlight.size;
}
exports.sqliteWriterQueueDepth = sqliteWriterQueueDepth;
function sqliteWriterStats() {
    return {
        enabled: state.enabled,
        ready: state.ready,
        submitted: state.submitted,
        completed: state.completed,
        failed: state.failed,
        batches: state.batches,
        lastBatchSize: state.lastBatchSize,
        maxBatchSize: state.maxBatchSize,
        lastCommitMs: state.lastCommitMs,
        totalCommitMs: state.totalCommitMs,
        savepointRollbacks: state.savepointRollbacks,
        timeouts: state.timeouts,
        restarts: state.restarts,
        inFlight: inFlight.size,
        waiting: waiting.length,
    };
}
exports.sqliteWriterStats = sqliteWriterStats;
function drainSqliteWriter() {
    return __awaiter(this, void 0, void 0, function* () {
        while (worker !== null && (inFlight.size > 0 || waiting.length > 0)) {
            yield new Promise(resolve => setTimeout(resolve, 0));
        }
    });
}
exports.drainSqliteWriter = drainSqliteWriter;
/**
 * Wait briefly for the writer thread to finish starting.
 *
 * The worker loads the domain layer before it reports ready, so the first
 * requests after a restart must not fail just because the thread is still
 * warming up.
 */
function waitForSqliteWriterReady(timeoutMs) {
    return __awaiter(this, void 0, void 0, function* () {
        if (isSqliteWriterReady())
            return true;
        if (!state.enabled || state.closing)
            return false;
        const deadline = Date.now() + Math.max(0, timeoutMs);
        while (Date.now() < deadline) {
            if (isSqliteWriterReady())
                return true;
            if (worker === null && restartTimer === null)
                return false;
            yield new Promise(resolve => setTimeout(resolve, 25));
        }
        return isSqliteWriterReady();
    });
}
exports.waitForSqliteWriterReady = waitForSqliteWriterReady;
function stopSqliteWriter() {
    return __awaiter(this, void 0, void 0, function* () {
        // Close the door first: a pending restart must not recreate the worker
        // while shutdown is in progress, and no new command may be accepted.
        state.closing = true;
        state.ready = false;
        if (restartTimer !== null) {
            clearTimeout(restartTimer);
            restartTimer = null;
        }
        const current = worker;
        if (current === null) {
            state.started = false;
            return;
        }
        yield drainSqliteWriter();
        if (worker !== current) {
            // A restart replaced the worker while draining; stop the new one too.
            state.closing = false;
            return stopSqliteWriter();
        }
        yield new Promise(resolve => {
            const timer = setTimeout(() => {
                closeResolve = null;
                resolve();
            }, 5000);
            closeResolve = () => {
                clearTimeout(timer);
                resolve();
            };
            try {
                current.postMessage({ type: "close" });
            }
            catch (_a) {
                clearTimeout(timer);
                closeResolve = null;
                resolve();
            }
        });
        worker = null;
        state.started = false;
        try {
            yield current.terminate();
        }
        catch ( /* already gone */_a) { /* already gone */ }
    });
}
exports.stopSqliteWriter = stopSqliteWriter;
