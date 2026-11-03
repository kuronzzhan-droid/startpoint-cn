"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAllAdminPlayerSummariesSync = void 0;
const db_1 = require("../db");
/**
 * Loads the lightweight player fields needed by the account overview in one query.
 */
function getAllAdminPlayerSummariesSync() {
    const rows = (0, db_1.getDb)().prepare(`
        SELECT id, account_id, name, comment, degree_id
        FROM players
        ORDER BY id
    `).all();
    return rows.map(row => {
        var _a, _b;
        return ({
            id: row.id,
            accountId: row.account_id,
            name: row.name,
            comment: (_a = row.comment) !== null && _a !== void 0 ? _a : "",
            degreeId: (_b = row.degree_id) !== null && _b !== void 0 ? _b : 0,
        });
    });
}
exports.getAllAdminPlayerSummariesSync = getAllAdminPlayerSummariesSync;
