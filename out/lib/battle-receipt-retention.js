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
exports.startBattleReceiptRetentionService = exports.createBattleReceiptRetentionService = exports.runBattleReceiptRetentionPass = exports.BATTLE_RECEIPT_TTL_MS = void 0;
const crypto_1 = require("crypto");
const shutdown_state_1 = require("./shutdown-state");
exports.BATTLE_RECEIPT_TTL_MS = 24 * 60 * 60 * 1000;
const LEASE_MS = 120000;
const STATE_SQL = `CREATE TABLE IF NOT EXISTS battle_receipt_retention_state(
    id INTEGER PRIMARY KEY CHECK(id=1),scan_cursor INTEGER NOT NULL DEFAULT 0,
    owner_token TEXT,lease_until INTEGER NOT NULL DEFAULT 0,last_started_at INTEGER,
    last_completed_at INTEGER,last_error TEXT,last_result_json TEXT)`;
const modeFor = (operation) => operation === "quest_finish.single"
    ? "single" : operation === "quest_finish.multi" ? "multi" : null;
function bounded(value, fallback, min, max) {
    return value !== undefined && Number.isSafeInteger(value) && value >= min && value <= max ? value : fallback;
}
function configuration(options) {
    var _a, _b, _c, _d;
    return Object.assign(Object.assign({}, options), { enabled: (_a = options.enabled) !== null && _a !== void 0 ? _a : !/^(0|false|off|no)$/i.test((_b = process.env.BATTLE_RECEIPT_RETENTION_ENABLED) !== null && _b !== void 0 ? _b : ""), initialDelayMs: bounded(options.initialDelayMs, 10000, 0, 86400000), intervalMs: bounded(options.intervalMs, 60000, 1, 86400000), catchupDelayMs: bounded(options.catchupDelayMs, 1000, 1, 86400000), batchRows: bounded(options.batchRows, 50, 1, 250), maxBatches: bounded(options.maxBatches, 20, 1, 100), maxPassMs: bounded(options.maxPassMs, 1000, 1, 30000), pauseMs: bounded(options.pauseMs, 20, 0, 10000), logger: (_c = options.logger) !== null && _c !== void 0 ? _c : console, now: (_d = options.now) !== null && _d !== void 0 ? _d : Date.now });
}
const yieldBatch = (ms) => new Promise(resolve => ms > 0 ? setTimeout(resolve, ms) : setImmediate(resolve));
function initialize(db) {
    db.exec(STATE_SQL);
    db.prepare("INSERT OR IGNORE INTO battle_receipt_retention_state(id) VALUES(1)").run();
}
/** Only tiny metadata tables are initialized here. Never index or aggregate the legacy payload table. */
function runBattleReceiptRetentionPass(database_1) {
    return __awaiter(this, arguments, void 0, function* (database, options = {}, shouldStop = () => false) {
        const config = configuration(options);
        const started = performance.now();
        const result = {
            scannedRows: 0, migratedRows: 0, deletedRows: 0, deletedJsonBytes: 0, guardedRows: 0,
            scanCursor: 0, oldestQueuedAt: null, caughtUp: false, stopped: false, elapsedMs: 0, errors: 0,
        };
        if (!config.enabled || shouldStop()) {
            result.stopped = shouldStop();
            return result;
        }
        const token = (0, crypto_1.randomUUID)();
        let ownsLease = false;
        const write = (operation, action) => __awaiter(this, void 0, void 0, function* () {
            if (config.executeTransaction)
                return config.executeTransaction({ domain: "maintenance", operation }, action);
            return database.transaction(action).immediate();
        });
        const lease = () => {
            const now = config.now();
            if (database.prepare(`UPDATE battle_receipt_retention_state SET lease_until=?
            WHERE id=1 AND owner_token=? AND lease_until>?`).run(now + LEASE_MS, token, now).changes !== 1) {
                throw new Error("Battle receipt retention lease lost");
            }
        };
        try {
            ownsLease = yield write("battle_receipts_acquire", () => {
                if (shouldStop())
                    return false;
                initialize(database);
                const now = config.now();
                return database.prepare(`UPDATE battle_receipt_retention_state SET owner_token=?,lease_until=?,
                last_started_at=?,last_error=NULL WHERE id=1 AND (owner_token IS NULL OR lease_until<=?)`)
                    .run(token, now + LEASE_MS, now, now).changes === 1;
            });
            if (!ownsLease)
                return result;
            for (let batch = 0; batch < config.maxBatches && performance.now() - started < config.maxPassMs; batch++) {
                if (shouldStop()) {
                    result.stopped = true;
                    break;
                }
                const outcome = yield write("battle_receipts_batch", () => {
                    var _a;
                    if (shouldStop())
                        return null;
                    lease();
                    const state = database.prepare("SELECT scan_cursor FROM battle_receipt_retention_state WHERE id=1").get();
                    // LIMIT applies before filtering operation: sparse battle rows must not cause an unbounded scan.
                    const rows = database.prepare(`SELECT rowid AS receipt_rowid,player_id,operation,request_key,created_at
                    FROM player_operation_receipts WHERE rowid>? ORDER BY rowid LIMIT ?`)
                        .all(state.scan_cursor, config.batchRows);
                    let migrated = 0;
                    const ledger = database.prepare(`INSERT INTO battle_settlement_ledger(player_id,play_id,mode,settled_at,version)
                    VALUES(?,?,?,?,1) ON CONFLICT(player_id,play_id) DO UPDATE SET
                    mode=CASE WHEN battle_settlement_ledger.mode=excluded.mode THEN excluded.mode ELSE 'legacy-conflict' END,
                    settled_at=MIN(battle_settlement_ledger.settled_at,excluded.settled_at)`);
                    const enqueue = database.prepare(`INSERT INTO battle_receipt_payload_queue(player_id,play_id,operation,created_at)
                    VALUES(?,?,?,?) ON CONFLICT(player_id,play_id,operation) DO UPDATE SET created_at=excluded.created_at`);
                    for (const row of rows) {
                        const mode = modeFor(row.operation);
                        if (mode === null)
                            continue;
                        if (!Number.isSafeInteger(row.created_at) || row.created_at < 0)
                            throw new Error("Invalid battle receipt timestamp; migration stopped");
                        ledger.run(row.player_id, row.request_key, mode, row.created_at);
                        enqueue.run(row.player_id, row.request_key, row.operation, row.created_at);
                        migrated++;
                    }
                    const cursor = rows.length ? rows[rows.length - 1].receipt_rowid : state.scan_cursor;
                    database.prepare("UPDATE battle_receipt_retention_state SET scan_cursor=? WHERE id=1 AND owner_token=?").run(cursor, token);
                    const cutoff = config.now() - exports.BATTLE_RECEIPT_TTL_MS;
                    const expired = database.prepare(`SELECT player_id,play_id,operation,created_at FROM battle_receipt_payload_queue
                    WHERE created_at<=? ORDER BY created_at,player_id,play_id,operation LIMIT ?`)
                        .all(cutoff, config.batchRows);
                    let deleted = 0, bytes = 0, guarded = 0;
                    const findLedger = database.prepare("SELECT mode,version FROM battle_settlement_ledger WHERE player_id=? AND play_id=?");
                    const payload = database.prepare(`SELECT created_at,octet_length(response_json) AS bytes FROM player_operation_receipts
                    WHERE player_id=? AND operation=? AND request_key=?`);
                    const prune = database.prepare(`DELETE FROM player_operation_receipts WHERE player_id=? AND operation=? AND request_key=?
                    AND created_at=? AND created_at<=? AND EXISTS(SELECT 1 FROM battle_settlement_ledger l
                        WHERE l.player_id=player_operation_receipts.player_id AND l.play_id=player_operation_receipts.request_key
                        AND l.version=1 AND l.mode IN (?, 'legacy-conflict'))`);
                    const dequeue = database.prepare("DELETE FROM battle_receipt_payload_queue WHERE player_id=? AND play_id=? AND operation=? AND created_at=?");
                    for (const row of expired) {
                        const mode = modeFor(row.operation);
                        const proof = findLedger.get(row.player_id, row.play_id);
                        if (mode === null || !proof || proof.version !== 1 || (proof.mode !== mode && proof.mode !== "legacy-conflict")) {
                            guarded++;
                            continue;
                        }
                        const current = payload.get(row.player_id, row.operation, row.play_id);
                        if (current && current.created_at !== row.created_at) {
                            // A replaced payload needs its own full retention window; never delete by a stale rowid.
                            enqueue.run(row.player_id, row.play_id, row.operation, current.created_at);
                            continue;
                        }
                        if (current) {
                            const changed = prune.run(row.player_id, row.operation, row.play_id, row.created_at, cutoff, mode).changes;
                            deleted += changed;
                            if (changed)
                                bytes += current.bytes;
                            else {
                                guarded++;
                                continue;
                            }
                        }
                        dequeue.run(row.player_id, row.play_id, row.operation, row.created_at);
                    }
                    const oldest = database.prepare("SELECT created_at FROM battle_receipt_payload_queue ORDER BY created_at LIMIT 1").get();
                    return { scanned: rows.length, migrated, deleted, bytes, guarded, cursor, oldest: (_a = oldest === null || oldest === void 0 ? void 0 : oldest.created_at) !== null && _a !== void 0 ? _a : null,
                        caughtUp: rows.length < config.batchRows && (oldest === undefined || oldest.created_at > cutoff), };
                });
                if (outcome === null) {
                    result.stopped = true;
                    break;
                }
                result.scannedRows += outcome.scanned;
                result.migratedRows += outcome.migrated;
                result.deletedRows += outcome.deleted;
                result.deletedJsonBytes += outcome.bytes;
                result.guardedRows += outcome.guarded;
                result.scanCursor = outcome.cursor;
                result.oldestQueuedAt = outcome.oldest;
                result.caughtUp = outcome.caughtUp;
                if (outcome.guarded)
                    throw new Error(`Battle receipt deletion guard rejected ${outcome.guarded} queued rows`);
                if (outcome.caughtUp)
                    break;
                yield yieldBatch(config.pauseMs);
            }
            if (shouldStop())
                result.stopped = true;
            result.elapsedMs = performance.now() - started;
            yield write("battle_receipts_complete", () => {
                lease();
                database.prepare(`UPDATE battle_receipt_retention_state SET owner_token=NULL,lease_until=0,last_result_json=?,
                last_completed_at=CASE WHEN ? THEN ? ELSE last_completed_at END,last_error=? WHERE id=1 AND owner_token=?`)
                    .run(JSON.stringify(result), result.caughtUp && !result.stopped ? 1 : 0, config.now(), result.stopped ? "interrupted" : null, token);
            });
            ownsLease = false;
            return result;
        }
        catch (error) {
            result.errors++;
            result.elapsedMs = performance.now() - started;
            if (ownsLease) {
                try {
                    yield write("battle_receipts_failed", () => {
                        database.prepare(`UPDATE battle_receipt_retention_state SET owner_token=NULL,lease_until=0,last_error=?,
                        last_result_json=? WHERE id=1 AND owner_token=?`).run(error instanceof Error ? error.message : String(error), JSON.stringify(result), token);
                    });
                }
                catch (stateError) {
                    config.logger.warn(`[DB_MAINTENANCE] battle receipt failure state could not be saved: ${String(stateError)}`);
                }
            }
            throw error;
        }
    });
}
exports.runBattleReceiptRetentionPass = runBattleReceiptRetentionPass;
function createBattleReceiptRetentionService(database, options = {}) {
    const config = configuration(options);
    let stopped = true, timer = null, active = null;
    const schedule = (ms) => {
        if (stopped || (0, shutdown_state_1.isServerShuttingDown)() || !config.enabled || timer !== null)
            return;
        timer = setTimeout(() => {
            timer = null;
            if (stopped || (0, shutdown_state_1.isServerShuttingDown)())
                return;
            let next = config.intervalMs;
            active = (() => __awaiter(this, void 0, void 0, function* () {
                try {
                    yield (0, shutdown_state_1.withServerWorkAdmission)(() => __awaiter(this, void 0, void 0, function* () {
                        const result = yield runBattleReceiptRetentionPass(database, config, () => stopped || (0, shutdown_state_1.isServerShuttingDown)());
                        next = result.caughtUp ? config.intervalMs : config.catchupDelayMs;
                        config.logger.log(`[DB_MAINTENANCE] battle receipts: ${JSON.stringify(result)}`);
                    }));
                }
                catch (error) {
                    next = config.intervalMs;
                    config.logger.warn(`[DB_MAINTENANCE] battle receipt retention failed: ${String(error)}`);
                }
            }))();
            void active.finally(() => { active = null; schedule(next); });
        }, ms);
        timer.unref();
    };
    return {
        start() { if (!stopped || (0, shutdown_state_1.isServerShuttingDown)())
            return; stopped = false; schedule(config.initialDelayMs); },
        stop() {
            return __awaiter(this, void 0, void 0, function* () { stopped = true; if (timer) {
                clearTimeout(timer);
                timer = null;
            } ; if (active)
                yield active; });
        },
        drain() {
            return __awaiter(this, void 0, void 0, function* () { if (active)
                yield active; });
        },
    };
}
exports.createBattleReceiptRetentionService = createBattleReceiptRetentionService;
function startBattleReceiptRetentionService(database, options = {}) {
    const service = createBattleReceiptRetentionService(database, options);
    service.start();
    return service;
}
exports.startBattleReceiptRetentionService = startBattleReceiptRetentionService;
