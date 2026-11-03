"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readPlayerEncyclopediaKeywordsSync = exports.unlockPlayerEncyclopediaKeywordsSync = exports.getPlayerEncyclopediaKeywordsSync = void 0;
const db_1 = require("../db");
const persistence_coordinator_1 = require("../../lib/persistence-coordinator");
function normalizeIds(encyclopediaIds) {
    return [...new Set(encyclopediaIds)];
}
function rowsToList(rows) {
    const output = {};
    for (const row of rows) {
        output[String(row.encyclopedia_id)] = {
            read: row.read !== 0,
        };
    }
    return output;
}
function getPlayerEncyclopediaKeywordsSync(playerId) {
    const db = (0, db_1.getDb)();
    const rows = db.prepare(`
        SELECT encyclopedia_id, read
        FROM players_encyclopedia_keywords
        WHERE player_id = ?
    `).all(playerId);
    return rowsToList(rows);
}
exports.getPlayerEncyclopediaKeywordsSync = getPlayerEncyclopediaKeywordsSync;
/**
 * Unlocks all requested encyclopedia keywords while consuming one key for the
 * request, matching the original client behavior. Repeating an already
 * completed request is idempotent and does not consume another key.
 */
function unlockPlayerEncyclopediaKeywordsSync(playerId, encyclopediaIds, keyItemId) {
    const db = (0, db_1.getDb)();
    const ids = normalizeIds(encyclopediaIds);
    return (0, persistence_coordinator_1.runPersistenceTransactionSync)({ domain: "player", playerId, operation: "unlock_encyclopedia_keywords" }, () => {
        var _a;
        const placeholders = ids.map(() => "?").join(", ");
        const existingRows = db.prepare(`
            SELECT encyclopedia_id, read
            FROM players_encyclopedia_keywords
            WHERE player_id = ? AND encyclopedia_id IN (${placeholders})
        `).all(playerId, ...ids);
        const existingIds = new Set(existingRows.map(row => row.encyclopedia_id));
        const newIds = ids.filter(id => !existingIds.has(id));
        const rawItem = db.prepare(`
            SELECT amount
            FROM players_items
            WHERE player_id = ? AND id = ?
        `).get(playerId, keyItemId);
        const currentItemAmount = (_a = rawItem === null || rawItem === void 0 ? void 0 : rawItem.amount) !== null && _a !== void 0 ? _a : 0;
        if (newIds.length === 0) {
            return {
                encyclopediaList: rowsToList(existingRows),
                itemAmount: currentItemAmount,
                consumedKey: false,
            };
        }
        const deduction = db.prepare(`
            UPDATE players_items
            SET amount = amount - 1
            WHERE player_id = ? AND id = ? AND amount >= 1
        `).run(playerId, keyItemId);
        if (deduction.changes !== 1)
            return null;
        const insert = db.prepare(`
            INSERT OR IGNORE INTO players_encyclopedia_keywords
                (encyclopedia_id, read, player_id)
            VALUES (?, 0, ?)
        `);
        for (const id of newIds) {
            insert.run(id, playerId);
        }
        const resultRows = db.prepare(`
            SELECT encyclopedia_id, read
            FROM players_encyclopedia_keywords
            WHERE player_id = ? AND encyclopedia_id IN (${placeholders})
        `).all(playerId, ...ids);
        return {
            encyclopediaList: rowsToList(resultRows),
            itemAmount: currentItemAmount - 1,
            consumedKey: true,
        };
    });
}
exports.unlockPlayerEncyclopediaKeywordsSync = unlockPlayerEncyclopediaKeywordsSync;
function readPlayerEncyclopediaKeywordsSync(playerId, encyclopediaIds) {
    const db = (0, db_1.getDb)();
    const ids = normalizeIds(encyclopediaIds);
    const update = db.prepare(`
        UPDATE players_encyclopedia_keywords
        SET read = 1
        WHERE player_id = ? AND encyclopedia_id = ?
    `);
    (0, persistence_coordinator_1.runPersistenceTransactionSync)({ domain: "player", playerId, operation: "read_encyclopedia_keywords" }, () => {
        for (const id of ids) {
            update.run(playerId, id);
        }
    });
    const output = {};
    for (const id of ids) {
        output[String(id)] = { read: true };
    }
    return output;
}
exports.readPlayerEncyclopediaKeywordsSync = readPlayerEncyclopediaKeywordsSync;
