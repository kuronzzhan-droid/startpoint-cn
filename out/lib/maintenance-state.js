"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isHistoryCatchupNeeded = exports.finishHistoryLease = exports.refreshHistoryLease = exports.acquireHistoryLease = exports.writeHistoryPolicy = exports.readHistoryPolicy = exports.validateHistoryPolicy = exports.initializeMaintenanceState = exports.HISTORY_JOB = exports.DEFAULT_HISTORY_POLICY = void 0;
const crypto_1 = require("crypto");
exports.DEFAULT_HISTORY_POLICY = Object.freeze({ maxRows: 500, maxDays: 7, dailyHour: 4, dailyMinute: 30 });
exports.HISTORY_JOB = "receive-history-retention";
const LEASE_MS = 120000;
function initializeMaintenanceState(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS server_maintenance_settings(name TEXT PRIMARY KEY,value_json TEXT NOT NULL) WITHOUT ROWID;
        CREATE TABLE IF NOT EXISTS server_maintenance_jobs(
            name TEXT PRIMARY KEY,owner_token TEXT,lease_until INTEGER NOT NULL DEFAULT 0,
            last_started_at TEXT,last_completed_at TEXT,last_result_json TEXT,last_error TEXT) WITHOUT ROWID;`);
    db.prepare("INSERT OR IGNORE INTO server_maintenance_settings VALUES(?,?)").run(exports.HISTORY_JOB, JSON.stringify(exports.DEFAULT_HISTORY_POLICY));
    db.prepare("INSERT OR IGNORE INTO server_maintenance_jobs(name) VALUES(?)").run(exports.HISTORY_JOB);
}
exports.initializeMaintenanceState = initializeMaintenanceState;
function validateHistoryPolicy(value) {
    if (!value || typeof value !== "object")
        throw new Error("领取历史保留配置无效");
    const p = value;
    for (const [name, max] of [["maxRows", 100000], ["maxDays", 3650], ["dailyHour", 23], ["dailyMinute", 59]]) {
        const min = name === "maxRows" || name === "maxDays" ? 1 : 0;
        if (!Number.isSafeInteger(p[name]) || p[name] < min || p[name] > max)
            throw new Error(`领取历史配置无效：${name}`);
    }
    return { maxRows: p.maxRows, maxDays: p.maxDays, dailyHour: p.dailyHour, dailyMinute: p.dailyMinute };
}
exports.validateHistoryPolicy = validateHistoryPolicy;
function readHistoryPolicy(db) {
    const row = db.prepare("SELECT value_json FROM server_maintenance_settings WHERE name=?").get(exports.HISTORY_JOB);
    if (!row)
        throw new Error("领取历史持久化配置缺失");
    return validateHistoryPolicy(JSON.parse(row.value_json));
}
exports.readHistoryPolicy = readHistoryPolicy;
function writeHistoryPolicy(db, policy) {
    const validated = validateHistoryPolicy(policy);
    db.prepare("INSERT INTO server_maintenance_settings VALUES(?,?) ON CONFLICT(name) DO UPDATE SET value_json=excluded.value_json")
        .run(exports.HISTORY_JOB, JSON.stringify(validated));
}
exports.writeHistoryPolicy = writeHistoryPolicy;
function acquireHistoryLease(db, now = Date.now()) {
    const token = (0, crypto_1.randomUUID)();
    const result = db.prepare(`UPDATE server_maintenance_jobs SET owner_token=?,lease_until=?,last_started_at=?,last_error=NULL
        WHERE name=? AND (owner_token IS NULL OR lease_until<=?)`).run(token, now + LEASE_MS, new Date(now).toISOString(), exports.HISTORY_JOB, now);
    return result.changes === 1 ? { token, nextRefresh: now + 20000 } : null;
}
exports.acquireHistoryLease = acquireHistoryLease;
function refreshHistoryLease(db, lease, now = Date.now()) {
    if (now < lease.nextRefresh)
        return;
    const result = db.prepare("UPDATE server_maintenance_jobs SET lease_until=? WHERE name=? AND owner_token=? AND lease_until>?")
        .run(now + LEASE_MS, exports.HISTORY_JOB, lease.token, now);
    if (result.changes !== 1)
        throw new Error("历史维护锁已失效，停止当前批次");
    lease.nextRefresh = now + 20000;
}
exports.refreshHistoryLease = refreshHistoryLease;
function finishHistoryLease(db, lease, result, success, error = null) {
    db.prepare(`UPDATE server_maintenance_jobs SET owner_token=NULL,lease_until=0,last_result_json=?,last_error=?,
        last_completed_at=CASE WHEN ? THEN ? ELSE last_completed_at END WHERE name=? AND owner_token=?`)
        .run(result === undefined ? null : JSON.stringify(result), error, success ? 1 : 0, new Date().toISOString(), exports.HISTORY_JOB, lease.token);
}
exports.finishHistoryLease = finishHistoryLease;
function isHistoryCatchupNeeded(db, hour, minute, now = new Date()) {
    const scheduled = new Date(now.getTime());
    scheduled.setHours(hour, minute, 0, 0);
    if (scheduled.getTime() > now.getTime())
        scheduled.setDate(scheduled.getDate() - 1);
    const row = db.prepare("SELECT last_completed_at FROM server_maintenance_jobs WHERE name=?").get(exports.HISTORY_JOB);
    return !(row === null || row === void 0 ? void 0 : row.last_completed_at) || !Number.isFinite(Date.parse(row.last_completed_at)) || Date.parse(row.last_completed_at) < scheduled.getTime();
}
exports.isHistoryCatchupNeeded = isHistoryCatchupNeeded;
