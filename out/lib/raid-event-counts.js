"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRaidQuestCount = exports.getRaidQuestCounts = void 0;
const cached_statement_1 = require("./cached-statement");
/**
 * Connection-local derived counts. TEMP triggers participate in the caller's
 * transaction, so rollbacks, deletions and resets cannot leave a JS cache stale.
 * Persistent schema and portable save contents remain unchanged.
 */
function ensureCountCache(db) {
    if ((0, cached_statement_1.cachedStatement)(db, "SELECT 1 FROM sqlite_temp_master WHERE type = 'table' AND name = 'raid_count_cache_meta'").get())
        return;
    db.exec(`
        CREATE TEMP TABLE raid_count_cache_meta (id INTEGER PRIMARY KEY, data_version INTEGER NOT NULL);
        CREATE TEMP TABLE raid_count_cache_events (event_id INTEGER PRIMARY KEY);
        CREATE TEMP TABLE raid_count_cache (
            event_id INTEGER NOT NULL, quest_id INTEGER NOT NULL, kills INTEGER NOT NULL,
            PRIMARY KEY (event_id, quest_id)
        ) WITHOUT ROWID;
        CREATE TEMP TRIGGER raid_count_cache_insert AFTER INSERT ON main.raid_event_global_kill_ledger
        WHEN EXISTS (SELECT 1 FROM raid_count_cache_events WHERE event_id = NEW.event_id)
        BEGIN
            INSERT INTO raid_count_cache VALUES (NEW.event_id, NEW.quest_id, 1)
            ON CONFLICT(event_id, quest_id) DO UPDATE SET kills = kills + 1;
        END;
        CREATE TEMP TRIGGER raid_count_cache_delete AFTER DELETE ON main.raid_event_global_kill_ledger
        WHEN EXISTS (SELECT 1 FROM raid_count_cache_events WHERE event_id = OLD.event_id)
        BEGIN
            UPDATE raid_count_cache SET kills = kills - 1 WHERE event_id = OLD.event_id AND quest_id = OLD.quest_id;
        END;
        CREATE TEMP TRIGGER raid_count_cache_update AFTER UPDATE OF event_id, quest_id ON main.raid_event_global_kill_ledger
        BEGIN
            UPDATE raid_count_cache SET kills = kills - 1 WHERE event_id = OLD.event_id AND quest_id = OLD.quest_id;
            INSERT INTO raid_count_cache
            SELECT NEW.event_id, NEW.quest_id, 1
            WHERE EXISTS (SELECT 1 FROM raid_count_cache_events WHERE event_id = NEW.event_id)
            ON CONFLICT(event_id, quest_id) DO UPDATE SET kills = kills + 1;
        END;
    `);
}
function getRaidQuestCounts(db, eventId) {
    return db.transaction(() => {
        ensureCountCache(db);
        // Pin a main-database read snapshot before comparing external commits.
        (0, cached_statement_1.cachedStatement)(db, "SELECT 1 FROM raid_event_global_kill_ledger LIMIT 1").get();
        const version = (0, cached_statement_1.cachedStatement)(db, "PRAGMA data_version").get().data_version;
        const cached = (0, cached_statement_1.cachedStatement)(db, "SELECT data_version FROM raid_count_cache_meta WHERE id = 1").get();
        if ((cached === null || cached === void 0 ? void 0 : cached.data_version) !== version) {
            db.exec("DELETE FROM raid_count_cache; DELETE FROM raid_count_cache_events");
            (0, cached_statement_1.cachedStatement)(db, "INSERT OR REPLACE INTO raid_count_cache_meta VALUES (1, ?)").run(version);
        }
        if (!(0, cached_statement_1.cachedStatement)(db, "SELECT 1 FROM raid_count_cache_events WHERE event_id = ?").get(eventId)) {
            (0, cached_statement_1.cachedStatement)(db, `INSERT INTO raid_count_cache
                SELECT event_id, quest_id, COUNT(*) FROM raid_event_global_kill_ledger
                WHERE event_id = ? GROUP BY quest_id`).run(eventId);
            (0, cached_statement_1.cachedStatement)(db, "INSERT INTO raid_count_cache_events VALUES (?)").run(eventId);
        }
        const rows = (0, cached_statement_1.cachedStatement)(db, "SELECT quest_id, kills FROM raid_count_cache WHERE event_id = ? AND kills > 0 ORDER BY quest_id")
            .all(eventId);
        return Object.fromEntries(rows.map(row => [String(row.quest_id), { kill_count: row.kills }]));
    })();
}
exports.getRaidQuestCounts = getRaidQuestCounts;
function getRaidQuestCount(db, eventId, questId) {
    const row = (0, cached_statement_1.cachedStatement)(db, `
        SELECT COUNT(*) AS kill_count
        FROM raid_event_global_kill_ledger
        WHERE event_id = ? AND quest_id = ?
    `).get(eventId, questId);
    return Math.max(0, Number(row.kill_count) || 0);
}
exports.getRaidQuestCount = getRaidQuestCount;
