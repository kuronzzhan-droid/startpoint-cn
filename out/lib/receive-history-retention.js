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
exports.createReceiveHistoryRetentionService = exports.runReceiveHistoryRetentionPass = exports.millisecondsUntilNextReceiveHistoryRetentionRun = exports.getReceiveHistoryRetentionSchedule = exports.isReceiveHistoryRetentionEnabled = void 0;
const shutdown_state_1 = require("./shutdown-state");
const maintenance_state_1 = require("./maintenance-state");
const DEFAULT_MAX_ROWS = 500;
const DEFAULT_DAILY_HOUR = 4;
const DEFAULT_DAILY_MINUTE = 30;
const DEFAULT_BATCH_PLAYERS = 5;
const DEFAULT_PAUSE_MS = 100;
const DEFAULT_BUSY_RETRY_ATTEMPTS = 5;
const DEFAULT_BUSY_RETRY_DELAY_MS = 20;
// Keep each synchronous SQLite delete short enough for realtime callbacks to
// run between batches. The old 1000-row batch made a large cleanup hold the
// main event loop for too long on the production database.
const DEFAULT_DELETE_BATCH_ROWS = 250;
const MAX_DELETE_BATCH_ROWS = 5000;
function normalizedInteger(value, fallback, minimum) {
    if (!Number.isSafeInteger(value) || value === undefined || value < minimum)
        return fallback;
    return value;
}
function normalizedBoundedInteger(value, fallback, minimum, maximum) {
    if (!Number.isSafeInteger(value) || value === undefined || value < minimum || value > maximum) {
        return fallback;
    }
    return value;
}
function environmentInteger(name) {
    var _a;
    const value = Number.parseInt((_a = process.env[name]) !== null && _a !== void 0 ? _a : "", 10);
    return Number.isSafeInteger(value) ? value : undefined;
}
function isReceiveHistoryRetentionEnabled(env = process.env) {
    var _a;
    const value = (_a = env.RECEIVE_HISTORY_RETENTION_ENABLED) === null || _a === void 0 ? void 0 : _a.trim().toLowerCase();
    return value !== "0" && value !== "false" && value !== "off" && value !== "no";
}
exports.isReceiveHistoryRetentionEnabled = isReceiveHistoryRetentionEnabled;
function getReceiveHistoryRetentionSchedule(env = process.env) {
    var _a, _b;
    const value = (_b = (_a = env.RECEIVE_HISTORY_RETENTION_TIME) === null || _a === void 0 ? void 0 : _a.trim()) !== null && _b !== void 0 ? _b : "";
    const match = /^(\d{1,2}):(\d{2})$/.exec(value);
    if (!match)
        return { hour: DEFAULT_DAILY_HOUR, minute: DEFAULT_DAILY_MINUTE };
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) {
        return { hour: DEFAULT_DAILY_HOUR, minute: DEFAULT_DAILY_MINUTE };
    }
    return { hour, minute };
}
exports.getReceiveHistoryRetentionSchedule = getReceiveHistoryRetentionSchedule;
function millisecondsUntilNextReceiveHistoryRetentionRun(now, hour, minute) {
    const nextRun = new Date(now.getTime());
    nextRun.setHours(hour, minute, 0, 0);
    if (nextRun.getTime() <= now.getTime())
        nextRun.setDate(nextRun.getDate() + 1);
    return Math.max(1, nextRun.getTime() - now.getTime());
}
exports.millisecondsUntilNextReceiveHistoryRetentionRun = millisecondsUntilNextReceiveHistoryRetentionRun;
function resolveOptions(options) {
    var _a, _b, _c, _d;
    const schedule = getReceiveHistoryRetentionSchedule();
    return {
        executeTransaction: options.executeTransaction,
        enabled: (_a = options.enabled) !== null && _a !== void 0 ? _a : isReceiveHistoryRetentionEnabled(),
        maxRows: normalizedInteger(options.maxRows, DEFAULT_MAX_ROWS, 1),
        maxDays: normalizedInteger(options.maxDays, 7, 1),
        nowMs: (_b = options.nowMs) !== null && _b !== void 0 ? _b : Date.now(),
        initialDelayMs: options.initialDelayMs === undefined
            ? null
            : normalizedInteger(options.initialDelayMs, 0, 0),
        dailyHour: normalizedBoundedInteger(options.dailyHour, schedule.hour, 0, 23),
        dailyMinute: normalizedBoundedInteger(options.dailyMinute, schedule.minute, 0, 59),
        batchPlayers: normalizedInteger(options.batchPlayers, DEFAULT_BATCH_PLAYERS, 1),
        pauseMs: normalizedInteger(options.pauseMs, DEFAULT_PAUSE_MS, 0),
        busyRetryAttempts: normalizedInteger(options.busyRetryAttempts, DEFAULT_BUSY_RETRY_ATTEMPTS, 1),
        busyRetryDelayMs: normalizedInteger(options.busyRetryDelayMs, DEFAULT_BUSY_RETRY_DELAY_MS, 0),
        deleteBatchRows: normalizedBoundedInteger((_c = options.deleteBatchRows) !== null && _c !== void 0 ? _c : environmentInteger("RECEIVE_HISTORY_RETENTION_DELETE_BATCH_ROWS"), DEFAULT_DELETE_BATCH_ROWS, 1, MAX_DELETE_BATCH_ROWS),
        logger: (_d = options.logger) !== null && _d !== void 0 ? _d : console,
    };
}
function delay(milliseconds) {
    if (milliseconds > 0)
        return new Promise(resolve => setTimeout(resolve, milliseconds));
    // Promise.resolve() only yields to the microtask queue. Since
    // better-sqlite3 runs synchronously, use libuv's check phase even when the
    // configured pause is zero so HTTP/TCP callbacks get a scheduling chance.
    return new Promise(resolve => setImmediate(resolve));
}
function isSqliteBusyError(error) {
    var _a;
    if (!(error instanceof Error) || !("code" in error))
        return false;
    const code = String((_a = error.code) !== null && _a !== void 0 ? _a : "");
    return code === "SQLITE_BUSY" || code === "SQLITE_BUSY_SNAPSHOT" || code.startsWith("SQLITE_BUSY_");
}
function describeError(error) {
    return error instanceof Error ? error.message : String(error);
}
function prunePlayerWithRetry(database, playerId, maxRows, maxAttempts, retryDelayMs, deleteBatchRows, cutoff, executeTransaction, shouldStop, beforePrune) {
    return __awaiter(this, void 0, void 0, function* () {
        const prune = database.prepare(`
        DELETE FROM players_receive_history
        WHERE id IN (SELECT id FROM players_receive_history WHERE player_id = ?
          AND (julianday(create_time) < julianday(?) OR id NOT IN (
              SELECT id
              FROM players_receive_history
              WHERE player_id = ?
              ORDER BY create_time DESC, id DESC
              LIMIT ?
          )) LIMIT ${deleteBatchRows})
    `);
        const operation = () => {
            // Recheck after queuing: shutdown can start while a player's earlier
            // write is still running. Refresh the lease in this same transaction.
            if (shouldStop())
                return 0;
            beforePrune();
            return prune.run(playerId, cutoff, playerId, maxRows).changes;
        };
        if (executeTransaction) {
            return executeTransaction({ domain: "maintenance", playerId, operation: "receive_history_prune" }, operation);
        }
        let lastError;
        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
            let began = false;
            try {
                database.exec("BEGIN IMMEDIATE");
                began = true;
                const deletedRows = operation();
                database.exec("COMMIT");
                return deletedRows;
            }
            catch (error) {
                if (began && database.inTransaction) {
                    try {
                        database.exec("ROLLBACK");
                    }
                    catch (_a) { }
                }
                if (!isSqliteBusyError(error) || attempt >= maxAttempts)
                    throw error;
                lastError = error;
                yield delay(retryDelayMs * (2 ** (attempt - 1)));
            }
        }
        throw lastError;
    });
}
function runReceiveHistoryRetentionPass(database_1) {
    return __awaiter(this, arguments, void 0, function* (database, options = {}, shouldStop = () => false, beforePrune = () => { }) {
        const config = resolveOptions(options);
        const cutoff = new Date(config.nowMs - config.maxDays * 86400000).toISOString();
        const startedAt = Date.now();
        const result = {
            candidatePlayers: 0,
            processedPlayers: 0,
            prunedPlayers: 0,
            deletedRows: 0,
            failedPlayers: 0,
            stopped: false,
            elapsedMs: 0,
        };
        if (!config.enabled) {
            result.elapsedMs = Date.now() - startedAt;
            return result;
        }
        const selectCandidates = database.prepare(`
        SELECT player_id, COUNT(*) AS record_count
        FROM players_receive_history
        WHERE player_id > ?
        GROUP BY player_id
        HAVING COUNT(*) > ? OR MIN(julianday(create_time)) < julianday(?)
        ORDER BY player_id
        LIMIT ?
    `);
        let playerCursor = 0;
        while (!shouldStop()) {
            const candidates = selectCandidates.all(playerCursor, config.maxRows, cutoff, config.batchPlayers);
            if (candidates.length === 0)
                break;
            for (const candidate of candidates) {
                playerCursor = candidate.player_id;
                if (shouldStop()) {
                    result.stopped = true;
                    break;
                }
                result.candidatePlayers += 1;
                try {
                    let deletedRows = 0;
                    let batchRows;
                    do {
                        if (shouldStop()) {
                            result.stopped = true;
                            break;
                        }
                        batchRows = yield prunePlayerWithRetry(database, candidate.player_id, config.maxRows, config.busyRetryAttempts, config.busyRetryDelayMs, config.deleteBatchRows, cutoff, config.executeTransaction, shouldStop, beforePrune);
                        deletedRows += batchRows;
                        result.deletedRows += batchRows;
                        if (batchRows === config.deleteBatchRows)
                            yield delay(config.pauseMs);
                    } while (batchRows === config.deleteBatchRows);
                    result.processedPlayers += 1;
                    if (deletedRows > 0)
                        result.prunedPlayers += 1;
                }
                catch (error) {
                    result.failedPlayers += 1;
                    config.logger.warn(`[DB_MAINTENANCE] receive history retention failed for player ${candidate.player_id}: ${describeError(error)}`);
                }
                if (!shouldStop())
                    yield delay(config.pauseMs);
            }
            if (result.stopped)
                break;
        }
        if (shouldStop())
            result.stopped = true;
        result.elapsedMs = Date.now() - startedAt;
        return result;
    });
}
exports.runReceiveHistoryRetentionPass = runReceiveHistoryRetentionPass;
function createReceiveHistoryRetentionService(database, options = {}) {
    (0, maintenance_state_1.initializeMaintenanceState)(database);
    const persisted = (0, maintenance_state_1.readHistoryPolicy)(database);
    const envSchedule = process.env.RECEIVE_HISTORY_RETENTION_TIME ? getReceiveHistoryRetentionSchedule() : null;
    const config = resolveOptions(Object.assign(Object.assign(Object.assign({}, persisted), envSchedule && { dailyHour: envSchedule.hour, dailyMinute: envSchedule.minute }), options));
    let stopped = true;
    let timer = null;
    let activePass = null;
    const write = (operation, action) => __awaiter(this, void 0, void 0, function* () {
        if (config.executeTransaction) {
            return config.executeTransaction({ domain: "maintenance", operation }, action);
        }
        return database.transaction(action).immediate();
    });
    const schedule = (overrideDelayMs = null) => {
        if (stopped || (0, shutdown_state_1.isServerShuttingDown)() || !config.enabled || timer !== null)
            return;
        const now = new Date();
        const delayMs = overrideDelayMs !== null && overrideDelayMs !== void 0 ? overrideDelayMs : millisecondsUntilNextReceiveHistoryRetentionRun(now, config.dailyHour, config.dailyMinute);
        const nextRunAt = new Date(now.getTime() + delayMs);
        config.logger.log(`[DB_MAINTENANCE] receive history retention scheduled: nextRunAt=${nextRunAt.toString()}`);
        timer = setTimeout(() => {
            timer = null;
            if (stopped || (0, shutdown_state_1.isServerShuttingDown)())
                return;
            activePass = (0, shutdown_state_1.withServerWorkAdmission)(() => __awaiter(this, void 0, void 0, function* () {
                let lease = null;
                try {
                    lease = yield write("receive_history_acquire", () => stopped ? null : (0, maintenance_state_1.acquireHistoryLease)(database));
                    if (!lease)
                        return;
                    const result = yield runReceiveHistoryRetentionPass(database, {
                        enabled: config.enabled,
                        maxRows: config.maxRows,
                        maxDays: config.maxDays,
                        batchPlayers: config.batchPlayers,
                        pauseMs: config.pauseMs,
                        busyRetryAttempts: config.busyRetryAttempts,
                        busyRetryDelayMs: config.busyRetryDelayMs,
                        deleteBatchRows: config.deleteBatchRows,
                        logger: config.logger,
                        executeTransaction: config.executeTransaction,
                    }, () => stopped, () => { if (lease)
                        (0, maintenance_state_1.refreshHistoryLease)(database, lease); });
                    const completedLease = lease;
                    yield write("receive_history_complete", () => (0, maintenance_state_1.finishHistoryLease)(database, completedLease, result, !result.stopped && result.failedPlayers === 0, result.failedPlayers > 0 ? `${result.failedPlayers} players failed` : result.stopped ? "interrupted" : null));
                    lease = null;
                    config.logger.log(`[DB_MAINTENANCE] receive history retention completed: candidates=${result.candidatePlayers} prunedPlayers=${result.prunedPlayers} deletedRows=${result.deletedRows} failures=${result.failedPlayers} stopped=${result.stopped} elapsedMs=${result.elapsedMs}`);
                }
                catch (error) {
                    if (lease) {
                        const failedLease = lease;
                        try {
                            yield write("receive_history_failed", () => (0, maintenance_state_1.finishHistoryLease)(database, failedLease, undefined, false, describeError(error)));
                        }
                        catch (_a) { }
                    }
                    config.logger.warn(`[DB_MAINTENANCE] receive history retention pass failed: ${describeError(error)}`);
                }
            }));
            void activePass.then(() => {
                activePass = null;
                if (!stopped)
                    schedule((0, maintenance_state_1.isHistoryCatchupNeeded)(database, config.dailyHour, config.dailyMinute) ? 120000 : null);
            });
        }, delayMs);
        timer.unref();
    };
    return {
        start() {
            var _a;
            if (!stopped || (0, shutdown_state_1.isServerShuttingDown)())
                return;
            stopped = false;
            if (!config.enabled) {
                config.logger.log("[DB_MAINTENANCE] receive history retention disabled by RECEIVE_HISTORY_RETENTION_ENABLED");
                return;
            }
            config.logger.log(`[DB_MAINTENANCE] receive history retention enabled: maxRows=${config.maxRows} dailyTime=${String(config.dailyHour).padStart(2, "0")}:${String(config.dailyMinute).padStart(2, "0")} localServerTime`);
            schedule((_a = config.initialDelayMs) !== null && _a !== void 0 ? _a : ((0, maintenance_state_1.isHistoryCatchupNeeded)(database, config.dailyHour, config.dailyMinute) ? 10000 : null));
        },
        stop() {
            return __awaiter(this, void 0, void 0, function* () {
                stopped = true;
                if (timer !== null) {
                    clearTimeout(timer);
                    timer = null;
                }
                if (activePass !== null)
                    yield activePass;
            });
        },
    };
}
exports.createReceiveHistoryRetentionService = createReceiveHistoryRetentionService;
