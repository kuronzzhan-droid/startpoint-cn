"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteAllPopupNewsReceiptsSync = exports.deleteNewsReceiptsSync = exports.markAccountNewsReceipts = exports.markAccountNewsReceiptsSync = exports.markAccountNewsReceipt = exports.markAccountNewsReceiptSync = exports.hasAccountNewsReceiptSync = exports.getAccountNewsReceiptIdsSync = void 0;
const db_1 = require("../db");
const persistence_coordinator_1 = require("../../lib/persistence-coordinator");
function getAccountNewsReceiptIdsSync(accountId, kind) {
    const rows = (0, db_1.getDb)().prepare(`
        SELECT news_id
        FROM account_news_receipts
        WHERE account_id = ? AND receipt_kind = ?
    `).all(accountId, kind);
    return new Set(rows.map(row => row.news_id));
}
exports.getAccountNewsReceiptIdsSync = getAccountNewsReceiptIdsSync;
function hasAccountNewsReceiptSync(accountId, newsId, kind) {
    return (0, db_1.getDb)().prepare(`
        SELECT 1
        FROM account_news_receipts
        WHERE account_id = ? AND news_id = ? AND receipt_kind = ?
        LIMIT 1
    `).get(accountId, newsId, kind) !== undefined;
}
exports.hasAccountNewsReceiptSync = hasAccountNewsReceiptSync;
function markAccountNewsReceiptSync(accountId, newsId, kind) {
    (0, persistence_coordinator_1.runPersistenceTransactionSync)({ domain: "account", operation: "mark_account_news_receipt" }, () => {
        (0, db_1.getDb)().prepare(`
            INSERT INTO account_news_receipts (account_id, news_id, receipt_kind, seen_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(account_id, news_id, receipt_kind) DO UPDATE SET
                seen_at = excluded.seen_at
        `).run(accountId, newsId, kind, Date.now());
    });
}
exports.markAccountNewsReceiptSync = markAccountNewsReceiptSync;
function markAccountNewsReceipt(accountId, newsId, kind) {
    const sql = `
        INSERT INTO account_news_receipts (account_id, news_id, receipt_kind, seen_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(account_id, news_id, receipt_kind) DO UPDATE SET
            seen_at = excluded.seen_at
    `;
    return (0, persistence_coordinator_1.runPersistenceSqlCommand)({ domain: "account", operation: "mark_account_news_receipt" }, [{
            sql,
            params: [accountId, newsId, kind, Date.now()],
        }], () => {
        (0, db_1.getDb)().prepare(`
            INSERT INTO account_news_receipts (account_id, news_id, receipt_kind, seen_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(account_id, news_id, receipt_kind) DO UPDATE SET
                seen_at = excluded.seen_at
        `).run(accountId, newsId, kind, Date.now());
    });
}
exports.markAccountNewsReceipt = markAccountNewsReceipt;
function markAccountNewsReceiptsSync(accountId, newsIds, kind) {
    if (newsIds.length === 0)
        return;
    const insert = (0, db_1.getDb)().prepare(`
        INSERT INTO account_news_receipts (account_id, news_id, receipt_kind, seen_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(account_id, news_id, receipt_kind) DO UPDATE SET
            seen_at = excluded.seen_at
    `);
    const now = Date.now();
    (0, persistence_coordinator_1.runPersistenceTransactionSync)({ domain: "account", operation: "mark_account_news_receipts" }, () => {
        for (const newsId of newsIds)
            insert.run(accountId, newsId, kind, now);
    });
}
exports.markAccountNewsReceiptsSync = markAccountNewsReceiptsSync;
function markAccountNewsReceipts(accountId, newsIds, kind) {
    if (newsIds.length === 0)
        return Promise.resolve();
    const sql = `
        INSERT INTO account_news_receipts (account_id, news_id, receipt_kind, seen_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(account_id, news_id, receipt_kind) DO UPDATE SET
            seen_at = excluded.seen_at
    `;
    const now = Date.now();
    return (0, persistence_coordinator_1.runPersistenceSqlCommand)({ domain: "account", operation: "mark_account_news_receipts" }, newsIds.map(newsId => ({
        sql,
        params: [accountId, newsId, kind, now],
    })), () => {
        const insert = (0, db_1.getDb)().prepare(`
            INSERT INTO account_news_receipts (account_id, news_id, receipt_kind, seen_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(account_id, news_id, receipt_kind) DO UPDATE SET
                seen_at = excluded.seen_at
        `);
        for (const newsId of newsIds)
            insert.run(accountId, newsId, kind, now);
    });
}
exports.markAccountNewsReceipts = markAccountNewsReceipts;
function deleteNewsReceiptsSync(newsId, kind) {
    if (kind === undefined) {
        return (0, db_1.getDb)().prepare(`
            DELETE FROM account_news_receipts WHERE news_id = ?
        `).run(newsId).changes;
    }
    return (0, db_1.getDb)().prepare(`
        DELETE FROM account_news_receipts
        WHERE news_id = ? AND receipt_kind = ?
    `).run(newsId, kind).changes;
}
exports.deleteNewsReceiptsSync = deleteNewsReceiptsSync;
function deleteAllPopupNewsReceiptsSync() {
    return (0, db_1.getDb)().prepare(`
        DELETE FROM account_news_receipts WHERE receipt_kind = 'popup'
    `).run().changes;
}
exports.deleteAllPopupNewsReceiptsSync = deleteAllPopupNewsReceiptsSync;
