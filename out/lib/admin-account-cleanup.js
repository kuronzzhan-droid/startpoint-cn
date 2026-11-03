"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureCascadeDeleteIndexes = exports.selectUnnotedAccountIds = exports.accountHasNote = void 0;
function accountHasNote(account) {
    return typeof account.adminNote === "string" && account.adminNote.trim().length > 0;
}
exports.accountHasNote = accountHasNote;
function selectUnnotedAccountIds(accounts) {
    return accounts.filter(account => !accountHasNote(account)).map(account => account.id);
}
exports.selectUnnotedAccountIds = selectUnnotedAccountIds;
function quoteIdentifier(identifier) {
    return `"${identifier.replace(/"/g, "\"\"")}"`;
}
function hasSupportingIndex(database, table, columns) {
    const indexes = database.prepare(`PRAGMA index_list(${quoteIdentifier(table)})`).all();
    return indexes.some(index => {
        const indexedColumns = database.prepare(`PRAGMA index_info(${quoteIdentifier(index.name)})`).all()
            .sort((left, right) => left.seqno - right.seqno)
            .map(column => column.name);
        return columns.every((column, index) => indexedColumns[index] === column);
    });
}
/**
 * SQLite has to scan a child table for every cascaded parent-row deletion when
 * the child key is not indexed. Account cleanup touches many related tables, so
 * those scans become quadratic on a populated server. Add only the missing
 * indexes required by ON DELETE CASCADE constraints.
 */
function ensureCascadeDeleteIndexes(database) {
    var _a;
    const tables = database.prepare(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
          AND name NOT LIKE 'sqlite_%'
        ORDER BY name
    `).all();
    let created = 0;
    for (const { name: table } of tables) {
        const foreignKeys = database
            .prepare(`PRAGMA foreign_key_list(${quoteIdentifier(table)})`)
            .all();
        const cascadeGroups = new Map();
        for (const foreignKey of foreignKeys) {
            if (foreignKey.on_delete.toUpperCase() !== "CASCADE")
                continue;
            const group = (_a = cascadeGroups.get(foreignKey.id)) !== null && _a !== void 0 ? _a : [];
            group.push(foreignKey);
            cascadeGroups.set(foreignKey.id, group);
        }
        for (const [foreignKeyId, group] of cascadeGroups) {
            const columns = group
                .sort((left, right) => left.seq - right.seq)
                .map(foreignKey => foreignKey.from);
            if (columns.length === 0 || hasSupportingIndex(database, table, columns))
                continue;
            const safeTable = table.replace(/[^a-zA-Z0-9_]/g, "_");
            const indexName = `idx_cleanup_fk_${safeTable}_${foreignKeyId}`;
            database.prepare(`CREATE INDEX IF NOT EXISTS ${quoteIdentifier(indexName)}
                 ON ${quoteIdentifier(table)} (${columns.map(quoteIdentifier).join(", ")})`).run();
            created += 1;
        }
    }
    return created;
}
exports.ensureCascadeDeleteIndexes = ensureCascadeDeleteIndexes;
