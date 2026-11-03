"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pruneFinishReceiptsSync = exports.recordFinishReceiptSync = exports.getFinishReceiptSync = exports.finishReceiptRetentionMs = exports.finishReceiptResponseRetentionMs = void 0;
const db_1 = require("../db");
const OPERATIONS = {
    single: "quest_finish.single",
    multi: "quest_finish.multi",
};
const DAY_MS = 24 * 60 * 60 * 1000;
const COMPACTED = "null";
function days(name, fallback) {
    var _a;
    const parsed = Number.parseInt((_a = process.env[name]) !== null && _a !== void 0 ? _a : "", 10);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}
function finishReceiptResponseRetentionMs() {
    return days("FINISH_RECEIPT_RESPONSE_DAYS", 7) * DAY_MS;
}
exports.finishReceiptResponseRetentionMs = finishReceiptResponseRetentionMs;
function finishReceiptRetentionMs() {
    return Math.max(days("FINISH_RECEIPT_RETENTION_DAYS", 180) * DAY_MS, finishReceiptResponseRetentionMs());
}
exports.finishReceiptRetentionMs = finishReceiptRetentionMs;
function getFinishReceiptSync(playerId, kind, playId) {
    const row = (0, db_1.getDb)().prepare(`
        SELECT response_json FROM player_operation_receipts
        WHERE player_id = ? AND operation = ? AND request_key = ?
    `).get(playerId, OPERATIONS[kind], playId);
    if (!row)
        return null;
    try {
        return { response: JSON.parse(row.response_json) };
    }
    catch (_a) {
        // A damaged response must still block a second payout.
        return { response: null };
    }
}
exports.getFinishReceiptSync = getFinishReceiptSync;
/**
 * Record (or complete) the receipt for a settled play. Must run inside the
 * settlement transaction. The first write keeps its creation time.
 */
function recordFinishReceiptSync(playerId, kind, playId, response, nowMs = Date.now()) {
    const responseJson = response === null ? COMPACTED : JSON.stringify(response);
    if (responseJson === undefined)
        throw new Error(`结算回执不可序列化：${kind}`);
    (0, db_1.getDb)().prepare(`
        INSERT INTO player_operation_receipts (player_id, operation, request_key, response_json, created_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (player_id, operation, request_key)
        DO UPDATE SET response_json = excluded.response_json
    `).run(playerId, OPERATIONS[kind], playId, responseJson, nowMs);
}
exports.recordFinishReceiptSync = recordFinishReceiptSync;
/** Bounded retention for one player's finish receipts; uses the (player_id, created_at) index. */
function pruneFinishReceiptsSync(playerId, nowMs = Date.now()) {
    const db = (0, db_1.getDb)();
    db.prepare(`
        DELETE FROM player_operation_receipts
        WHERE player_id = ? AND created_at < ? AND operation IN (?, ?)
    `).run(playerId, nowMs - finishReceiptRetentionMs(), OPERATIONS.single, OPERATIONS.multi);
    db.prepare(`
        UPDATE player_operation_receipts SET response_json = '${COMPACTED}'
        WHERE player_id = ? AND created_at < ? AND operation IN (?, ?) AND response_json <> '${COMPACTED}'
    `).run(playerId, nowMs - finishReceiptResponseRetentionMs(), OPERATIONS.single, OPERATIONS.multi);
}
exports.pruneFinishReceiptsSync = pruneFinishReceiptsSync;
