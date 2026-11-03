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
exports.stopSqlitePersistenceWorker = exports.drainSqlitePersistenceWorker = exports.executeSqlitePersistenceCommand = exports.setSqlitePersistenceCheckpointOwner = exports.isSqlitePersistenceWorkerStarted = exports.startSqlitePersistenceWorker = void 0;
const node_path_1 = __importDefault(require("node:path"));
const file_exists_1 = require("../lib/file-exists");
const node_worker_threads_1 = require("node:worker_threads");
const memory_diagnostics_1 = require("./memory-diagnostics");
const sqlite_settings_1 = require("./sqlite-settings");
let worker = null;
let workerReady = false;
let closing = false;
let nextId = 1;
let active = null;
const queue = [];
let closeResolve = null;
const state = {
    enabled: false,
    started: false,
    queued: 0,
    completed: 0,
    failed: 0,
    busyRetries: 0,
    lastDurationMs: null,
    lastError: null,
    synchronous: null,
    cacheSize: null,
    mmapSize: null,
    walAutocheckpoint: null,
};
(0, memory_diagnostics_1.registerMemoryCounters)("sqlitePersistence", () => {
    var _a, _b;
    return ({
        enabled: state.enabled,
        started: state.started,
        queued: state.queued,
        completed: state.completed,
        failed: state.failed,
        pending: queue.length + (active ? 1 : 0),
        busyRetries: state.busyRetries,
        lastDurationMs: state.lastDurationMs,
        lastError: state.lastError !== null,
        lastErrorLength: (_b = (_a = state.lastError) === null || _a === void 0 ? void 0 : _a.length) !== null && _b !== void 0 ? _b : 0,
        synchronous: state.synchronous,
        cacheSize: state.cacheSize,
        mmapSize: state.mmapSize,
        walAutocheckpoint: state.walAutocheckpoint,
    });
}, "sqlite");
function enabled(environment = process.env) {
    var _a;
    return /^(1|true|yes|on)$/i.test((_a = environment.SQLITE_PERSISTENCE_WORKER) !== null && _a !== void 0 ? _a : "");
}
function workerLocation() {
    const compiled = node_path_1.default.resolve(__dirname, "../workers/sqlite-persistence-worker.js");
    if ((0, file_exists_1.existsSync)(compiled))
        return { filename: compiled };
    return {
        filename: node_path_1.default.resolve(__dirname, "../workers/sqlite-persistence-worker.ts"),
        execArgv: ["-r", require.resolve("ts-node/register/transpile-only")],
    };
}
function errorFromMessage(message) {
    var _a;
    const error = new Error(String((_a = message === null || message === void 0 ? void 0 : message.error) !== null && _a !== void 0 ? _a : "SQLite persistence worker failed"));
    if (message === null || message === void 0 ? void 0 : message.code)
        error.code = String(message.code);
    return error;
}
function rejectAll(error) {
    if (active) {
        active.reject(error);
        active = null;
    }
    while (queue.length > 0)
        queue.shift().reject(error);
}
function pump() {
    if (!worker || !workerReady || closing || active || queue.length === 0)
        return;
    active = queue.shift();
    try {
        worker.postMessage({
            id: active.id,
            operation: active.command.operation,
            statements: active.command.statements,
        });
    }
    catch (error) {
        const failedCommand = active;
        active = null;
        failedCommand.reject(error instanceof Error ? error : new Error(String(error)));
        pump();
    }
}
function startSqlitePersistenceWorker(databasePath, environment = process.env) {
    var _a, _b;
    if (worker || !enabled(environment))
        return worker !== null;
    state.enabled = true;
    state.started = false;
    workerReady = false;
    closing = false;
    const location = workerLocation();
    const parsedBusyTimeoutMs = Number.parseInt((_a = environment.SQLITE_PERSISTENCE_BUSY_TIMEOUT_MS) !== null && _a !== void 0 ? _a : "1000", 10);
    const busyTimeoutMs = Number.isFinite(parsedBusyTimeoutMs) ? Math.max(0, parsedBusyTimeoutMs) : 1000;
    const maxAttempts = Math.max(1, Number.parseInt((_b = environment.SQLITE_PERSISTENCE_MAX_ATTEMPTS) !== null && _b !== void 0 ? _b : "3", 10) || 3);
    const settings = (0, sqlite_settings_1.sqliteSettings)(environment);
    const current = new node_worker_threads_1.Worker(location.filename, Object.assign(Object.assign({}, (location.execArgv ? { execArgv: location.execArgv } : {})), { workerData: { databasePath, busyTimeoutMs, maxAttempts, settings } }));
    worker = current;
    (0, memory_diagnostics_1.observeWorkerMemory)("sqlite-persistence", current);
    current.once("online", () => {
        if (worker !== current)
            return;
        workerReady = true;
        state.started = true;
        pump();
    });
    current.on("message", message => {
        var _a;
        if (worker !== current)
            return;
        if ((message === null || message === void 0 ? void 0 : message.type) === "settings") {
            state.synchronous = Number.isFinite(Number(message.synchronous))
                ? Number(message.synchronous) : null;
            state.cacheSize = Number.isFinite(Number(message.cacheSize))
                ? Number(message.cacheSize) : null;
            state.mmapSize = Number.isFinite(Number(message.mmapSize))
                ? Number(message.mmapSize) : null;
            state.walAutocheckpoint = Number.isFinite(Number(message.walAutocheckpoint))
                ? Number(message.walAutocheckpoint) : null;
            return;
        }
        if ((message === null || message === void 0 ? void 0 : message.type) === "result" || (message === null || message === void 0 ? void 0 : message.type) === "error") {
            const command = active;
            if (!command || command.id !== message.id)
                return;
            active = null;
            if (message.type === "result") {
                state.completed++;
                command.resolve({
                    changes: Number(message.changes) || 0,
                    lastInsertRowid: Number.isFinite(Number(message.lastInsertRowid))
                        ? Number(message.lastInsertRowid) : null,
                });
            }
            else {
                state.failed++;
                state.lastError = String((_a = message.error) !== null && _a !== void 0 ? _a : "SQLite persistence worker failed").slice(0, 240);
                command.reject(errorFromMessage(message));
            }
            pump();
            return;
        }
        if ((message === null || message === void 0 ? void 0 : message.type) === "closed") {
            state.started = false;
            closeResolve === null || closeResolve === void 0 ? void 0 : closeResolve();
            closeResolve = null;
        }
    });
    current.on("error", error => {
        if (worker !== current)
            return;
        state.failed++;
        state.lastError = error.message.slice(0, 240);
        workerReady = false;
        state.started = false;
        rejectAll(error);
    });
    current.once("exit", code => {
        if (worker !== current)
            return;
        worker = null;
        workerReady = false;
        state.started = false;
        if (code !== 0 && !closing) {
            const error = new Error(`SQLite persistence worker exited (code ${code})`);
            state.failed++;
            state.lastError = error.message;
            rejectAll(error);
        }
    });
    console.log(`[DB] sqlite persistence worker enabled busyTimeoutMs=${busyTimeoutMs} maxAttempts=${maxAttempts}`);
    return true;
}
exports.startSqlitePersistenceWorker = startSqlitePersistenceWorker;
function isSqlitePersistenceWorkerStarted() {
    return worker !== null;
}
exports.isSqlitePersistenceWorkerStarted = isSqlitePersistenceWorkerStarted;
function setSqlitePersistenceCheckpointOwner(external) {
    try {
        worker === null || worker === void 0 ? void 0 : worker.postMessage({
            type: "checkpoint_owner",
            external,
        });
    }
    catch (_a) {
        // A worker exiting during ownership handoff will be replaced or the
        // main connection will retain automatic checkpointing.
    }
}
exports.setSqlitePersistenceCheckpointOwner = setSqlitePersistenceCheckpointOwner;
function executeSqlitePersistenceCommand(command) {
    if (!worker || closing)
        return Promise.reject(new Error("SQLite persistence worker is not running."));
    return new Promise((resolve, reject) => {
        state.queued++;
        queue.push({ id: nextId++, command, resolve, reject });
        pump();
    });
}
exports.executeSqlitePersistenceCommand = executeSqlitePersistenceCommand;
function drainSqlitePersistenceWorker() {
    return __awaiter(this, void 0, void 0, function* () {
        while (active || queue.length > 0) {
            yield new Promise(resolve => setTimeout(resolve, 0));
        }
    });
}
exports.drainSqlitePersistenceWorker = drainSqlitePersistenceWorker;
function stopSqlitePersistenceWorker() {
    return __awaiter(this, void 0, void 0, function* () {
        const current = worker;
        if (!current)
            return;
        yield drainSqlitePersistenceWorker();
        closing = true;
        if (!workerReady) {
            worker = null;
            try {
                yield current.terminate();
            }
            catch (_a) { }
            state.started = false;
            return;
        }
        workerReady = false;
        yield new Promise(resolve => {
            closeResolve = resolve;
            try {
                current.postMessage({ type: "close" });
            }
            catch (_a) {
                resolve();
            }
        });
        worker = null;
        try {
            yield current.terminate();
        }
        catch (_b) { }
        state.started = false;
    });
}
exports.stopSqlitePersistenceWorker = stopSqlitePersistenceWorker;
