"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.insertPlayerOperationReceiptSync = exports.getPlayerOperationReceiptSync = void 0;
const db_1 = require("../db");
function getPlayerOperationReceiptSync(playerId, operation, requestKey) {
    const row = (0, db_1.getDb)().prepare(`
        SELECT player_id, operation, request_key, response_json
        FROM player_operation_receipts
        WHERE player_id = ? AND operation = ? AND request_key = ?
    `).get(playerId, operation, requestKey);
    if (!row)
        return null;
    try {
        return {
            playerId: row.player_id,
            operation: row.operation,
            requestKey: row.request_key,
            response: JSON.parse(row.response_json),
        };
    }
    catch (_a) {
        throw new Error(`持久化请求回执损坏：${operation}/${requestKey}`);
    }
}
exports.getPlayerOperationReceiptSync = getPlayerOperationReceiptSync;
function insertPlayerOperationReceiptSync(receipt, createdAtMs = Date.now()) {
    if (!Number.isSafeInteger(createdAtMs) || createdAtMs < 0)
        throw new TypeError("Invalid receipt creation time.");
    const responseJson = JSON.stringify(receipt.response);
    if (responseJson === undefined)
        throw new Error(`持久化请求回执不可序列化：${receipt.operation}`);
    (0, db_1.getDb)().prepare(`
        INSERT INTO player_operation_receipts (
            player_id, operation, request_key, response_json, created_at
        ) VALUES (?, ?, ?, ?, ?)
    `).run(receipt.playerId, receipt.operation, receipt.requestKey, responseJson, createdAtMs);
}
exports.insertPlayerOperationReceiptSync = insertPlayerOperationReceiptSync;
