"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initializeAbyssRecords = void 0;
function initializeAbyssRecords(db) {
    // Public server history, deliberately not a cascading player relation.
    // viewer_id is an attribution snapshot, not a portable-save owner.
    const createTable = (name) => `CREATE TABLE ${name} (
        revision TEXT NOT NULL,
        quest_id INTEGER NOT NULL CHECK (
            quest_id BETWEEN 700099001 AND 700099098
            OR quest_id BETWEEN 700100001 AND 700100030
        ),
        elapsed_time_ms INTEGER NOT NULL CHECK (elapsed_time_ms > 0),
        viewer_id INTEGER NOT NULL,
        recorded_at_ms INTEGER NOT NULL,
        PRIMARY KEY (revision, quest_id)
    ) WITHOUT ROWID`;
    const existing = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='abyss_floor_records'")
        .get();
    if (!existing) {
        db.exec(createTable("abyss_floor_records"));
        return;
    }
    // CREATE IF NOT EXISTS cannot widen a CHECK on an already deployed table.
    // Rebuild only the legacy constraint, atomically retaining all public history.
    if (!/CHECK\s*\(\s*quest_id\s+BETWEEN\s+700099001\s+AND\s+700099098\s*\)/i.test(existing.sql))
        return;
    db.transaction(() => {
        const dependents = db.prepare(`SELECT sql FROM sqlite_master
            WHERE tbl_name='abyss_floor_records' AND type IN ('index','trigger') AND sql IS NOT NULL`)
            .all();
        db.exec(createTable("abyss_floor_records_ex_migration"));
        db.exec(`INSERT INTO abyss_floor_records_ex_migration
            (revision, quest_id, elapsed_time_ms, viewer_id, recorded_at_ms)
            SELECT revision, quest_id, elapsed_time_ms, viewer_id, recorded_at_ms FROM abyss_floor_records`);
        db.exec("DROP TABLE abyss_floor_records");
        db.exec("ALTER TABLE abyss_floor_records_ex_migration RENAME TO abyss_floor_records");
        for (const dependent of dependents)
            db.exec(dependent.sql);
    })();
}
exports.initializeAbyssRecords = initializeAbyssRecords;
