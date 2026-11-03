"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.insertPaymentReceiptSync = exports.getPaymentProductCountSync = exports.getPaymentReceiptSync = void 0;
const db_1 = require("../db");
function buildReceipt(row) {
    return {
        playerId: row.player_id,
        paymentKey: row.payment_key,
        productId: row.product_id,
        paidVmoney: row.paid_vmoney,
        freeVmoney: row.free_vmoney,
        afterVmoney: row.after_vmoney,
        afterFreeVmoney: row.after_free_vmoney,
        purchaseCount: row.purchase_count,
    };
}
function getPaymentReceiptSync(playerId, paymentKey) {
    const row = (0, db_1.getDb)().prepare(`
        SELECT player_id, payment_key, product_id, paid_vmoney, free_vmoney,
               after_vmoney, after_free_vmoney, purchase_count
        FROM player_payment_receipts
        WHERE player_id = ? AND payment_key = ?
    `).get(playerId, paymentKey);
    return row ? buildReceipt(row) : null;
}
exports.getPaymentReceiptSync = getPaymentReceiptSync;
function getPaymentProductCountSync(playerId, productId) {
    const row = (0, db_1.getDb)().prepare(`
        SELECT COUNT(*) AS count
        FROM player_payment_receipts
        WHERE player_id = ? AND product_id = ?
    `).get(playerId, productId);
    return Number(row.count) || 0;
}
exports.getPaymentProductCountSync = getPaymentProductCountSync;
function insertPaymentReceiptSync(receipt) {
    (0, db_1.getDb)().prepare(`
        INSERT INTO player_payment_receipts (
            player_id, payment_key, product_id, paid_vmoney, free_vmoney,
            after_vmoney, after_free_vmoney, purchase_count, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(receipt.playerId, receipt.paymentKey, receipt.productId, receipt.paidVmoney, receipt.freeVmoney, receipt.afterVmoney, receipt.afterFreeVmoney, receipt.purchaseCount, Date.now());
}
exports.insertPaymentReceiptSync = insertPaymentReceiptSync;
