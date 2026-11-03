"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.writeCompactMissionCounter = exports.removeCoveredStorageIndexes = exports.migrateStorageLayout = exports.assertStorageLayout = exports.getStorageSnapshotTableInfo = exports.isCompactStorage = exports.getStorageLayoutVersion = exports.COMPACT_COUNTER_VALUES = exports.RETIRED_COUNTER_SNAPSHOTS = exports.WDFP_DATA_VERSION = exports.STORAGE_LAYOUT_VERSION = void 0;
const cached_statement_1 = require("./cached-statement");
exports.STORAGE_LAYOUT_VERSION = 1;
exports.WDFP_DATA_VERSION = 9;
exports.RETIRED_COUNTER_SNAPSHOTS = "players_mission_counter_snapshots";
exports.COMPACT_COUNTER_VALUES = "players_mission_counter_values";
const DEFINITIONS = "mission_counter_definitions";
function quote(name) { return `"${name.replace(/"/g, '""')}"`; }
function getStorageLayoutVersion(db) {
    var _a;
    // Reuse compilation, not the result: migrations and version changes on this
    // connection must still be visible immediately (including after rollback).
    if (!(0, cached_statement_1.cachedStatement)(db, "SELECT 1 FROM sqlite_master WHERE type='table' AND name='server_storage_migrations'").get())
        return 0;
    const row = (0, cached_statement_1.cachedStatement)(db, "SELECT MAX(version) AS version FROM server_storage_migrations").get();
    const version = (_a = row.version) !== null && _a !== void 0 ? _a : 0;
    if (version > exports.STORAGE_LAYOUT_VERSION)
        throw new Error(`数据库存储版本 ${version} 高于程序支持版本，拒绝启动旧程序`);
    return version;
}
exports.getStorageLayoutVersion = getStorageLayoutVersion;
function isCompactStorage(db) { return getStorageLayoutVersion(db) === exports.STORAGE_LAYOUT_VERSION; }
exports.isCompactStorage = isCompactStorage;
/** Export the same logical V2 archive across the physical storage migration. */
function getStorageSnapshotTableInfo(db, table) {
    if (!isCompactStorage(db))
        return undefined;
    const row = db.prepare("SELECT columns_json FROM server_storage_archive_schema WHERE table_name=?").get(table);
    if (!row)
        return undefined;
    const info = JSON.parse(row.columns_json);
    const actual = db.prepare(`PRAGMA table_info(${quote(table)})`).all();
    if (JSON.stringify(actual.map(c => c.name)) !== JSON.stringify(info.map(c => c.name))) {
        throw new Error(`存档兼容结构已变化，需更新转换逻辑：${table}`);
    }
    return info;
}
exports.getStorageSnapshotTableInfo = getStorageSnapshotTableInfo;
function assertStorageLayout(db) {
    var _a;
    const version = getStorageLayoutVersion(db);
    const kind = (_a = db.prepare("SELECT type FROM sqlite_master WHERE name='players_mission_counters'").get()) === null || _a === void 0 ? void 0 : _a.type;
    if (version === 0) {
        if (kind === "view" || db.prepare("SELECT 1 FROM sqlite_master WHERE name=?").get(exports.COMPACT_COUNTER_VALUES)) {
            throw new Error("数据库存在压缩结构但迁移标记缺失，拒绝自动初始化");
        }
        return;
    }
    if (kind !== "view")
        throw new Error("数据库迁移标记与任务计数结构不一致");
    for (const [name, type] of [
        [exports.COMPACT_COUNTER_VALUES, "table"], [DEFINITIONS, "table"],
        [exports.RETIRED_COUNTER_SNAPSHOTS, "view"], ["server_storage_archive_schema", "table"],
        ["storage_counter_insert", "trigger"], ["storage_counter_delete", "trigger"],
    ]) {
        if (!db.prepare("SELECT 1 FROM sqlite_master WHERE name=? AND type=?").get(name, type)) {
            throw new Error(`数据库压缩结构缺失：${name}`);
        }
    }
}
exports.assertStorageLayout = assertStorageLayout;
/** Caller must establish an offline maintenance window and a verified backup. */
function migrateStorageLayout(db, checkpoint = () => { }) {
    assertStorageLayout(db);
    if (isCompactStorage(db))
        return { version: exports.STORAGE_LAYOUT_VERSION, alreadyApplied: true, preservedRows: {}, retiredSnapshotRows: 0, removedIndexes: [] };
    if (db.inTransaction)
        throw new Error("存储迁移不能嵌套到业务事务");
    const targetTables = ["players_mission_counters", exports.RETIRED_COUNTER_SNAPSHOTS, "players_characters_mana_nodes", "players_characters_bond_tokens"];
    const schemas = new Map(targetTables.map(table => {
        const columns = db.prepare(`PRAGMA table_info(${quote(table)})`).all();
        if (columns.length === 0)
            throw new Error(`数据库缺少迁移前置表：${table}`);
        return [table, columns];
    }));
    const expectedColumns = {
        players_mission_counters: ["player_id", "counter_key", "dimension", "scope_type", "scope_key", "qualifier_json", "value", "updated_at"],
        players_mission_counter_snapshots: ["player_id", "period_type", "counter_key", "value", "updated_at"],
        players_characters_mana_nodes: ["value", "awake_level", "character_id", "player_id"],
        players_characters_bond_tokens: ["mana_board_index", "status", "player_id", "character_id"],
    };
    for (const [table, info] of schemas) {
        if (JSON.stringify(info.map(c => c.name)) !== JSON.stringify(expectedColumns[table]))
            throw new Error(`不支持的迁移前结构：${table}`);
        const trigger = db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name=?").get(table);
        if (trigger)
            throw new Error(`迁移表存在额外触发器，需先审查：${table}`);
        if (table === "players_mission_counters" || table === exports.RETIRED_COUNTER_SNAPSHOTS) {
            const indexes = db.prepare(`PRAGMA index_list(${quote(table)})`).all();
            if (indexes.some(index => index.unique && index.origin !== "pk"))
                throw new Error(`迁移表存在额外唯一约束，需先审查：${table}`);
        }
    }
    // A shared key must describe one definition. Never resolve conflicts by
    // arbitrarily keeping the first player's text fields.
    if (db.prepare(`SELECT counter_key FROM players_mission_counters GROUP BY counter_key
        HAVING COUNT(DISTINCT json_array(dimension,scope_type,scope_key,qualifier_json)) > 1 LIMIT 1`).get()) {
        throw new Error("同一任务键存在不同定义，迁移已停止，原数据保留");
    }
    const foreignKeys = Number(db.pragma("foreign_keys", { simple: true }));
    const baselineForeignKeys = db.pragma("foreign_key_check");
    if (baselineForeignKeys.length > 0)
        throw new Error(`数据库已有 ${baselineForeignKeys.length} 项外键异常，需先审查后迁移`);
    const result = { version: exports.STORAGE_LAYOUT_VERSION, alreadyApplied: false, preservedRows: {}, retiredSnapshotRows: 0, removedIndexes: [] };
    db.pragma("foreign_keys=OFF");
    try {
        db.transaction(() => {
            db.exec(`
                CREATE TABLE server_storage_migrations(version INTEGER PRIMARY KEY, completed_at TEXT NOT NULL, result_json TEXT NOT NULL);
                CREATE TABLE server_storage_archive_schema(table_name TEXT PRIMARY KEY, columns_json TEXT NOT NULL) WITHOUT ROWID;
                CREATE TABLE mission_counter_definitions(
                    id INTEGER PRIMARY KEY, counter_key TEXT NOT NULL UNIQUE,
                    dimension TEXT NOT NULL, scope_type TEXT NOT NULL, scope_key TEXT NOT NULL, qualifier_json TEXT NOT NULL);
                CREATE INDEX idx_mission_counter_definitions_dimensions ON mission_counter_definitions(scope_type,scope_key,dimension);
                CREATE TABLE players_mission_counter_values(
                    player_id INTEGER NOT NULL, counter_id INTEGER NOT NULL, value INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL,
                    PRIMARY KEY(player_id,counter_id),
                    FOREIGN KEY(player_id) REFERENCES players(id) ON DELETE CASCADE,
                    FOREIGN KEY(counter_id) REFERENCES mission_counter_definitions(id)) WITHOUT ROWID;
                CREATE INDEX idx_mission_counter_values_definition ON players_mission_counter_values(counter_id,player_id);
                INSERT INTO mission_counter_definitions(counter_key,dimension,scope_type,scope_key,qualifier_json)
                    SELECT DISTINCT counter_key,dimension,scope_type,scope_key,qualifier_json FROM players_mission_counters ORDER BY counter_key;
                INSERT INTO players_mission_counter_values(player_id,counter_id,value,updated_at)
                    SELECT c.player_id,d.id,c.value,c.updated_at FROM players_mission_counters c
                    JOIN mission_counter_definitions d ON d.counter_key=c.counter_key;
            `);
            for (const [table, info] of schemas)
                db.prepare("INSERT INTO server_storage_archive_schema VALUES(?,?)").run(table, JSON.stringify(info));
            const oldCount = db.prepare("SELECT COUNT(*) n FROM players_mission_counters").get().n;
            const newCount = db.prepare("SELECT COUNT(*) n FROM players_mission_counter_values").get().n;
            const mismatch = db.prepare(`SELECT 1 FROM players_mission_counters c
                LEFT JOIN mission_counter_definitions d ON d.counter_key=c.counter_key
                LEFT JOIN players_mission_counter_values v ON v.player_id=c.player_id AND v.counter_id=d.id
                WHERE v.player_id IS NULL OR c.value IS NOT v.value OR c.updated_at IS NOT v.updated_at
                   OR c.dimension IS NOT d.dimension OR c.scope_type IS NOT d.scope_type
                   OR c.scope_key IS NOT d.scope_key OR c.qualifier_json IS NOT d.qualifier_json LIMIT 1`).get();
            if (oldCount !== newCount || mismatch)
                throw new Error("任务计数迁移逐字段校验失败");
            result.preservedRows.players_mission_counters = oldCount;
            checkpoint("counters-verified");
            for (const [table, key] of [["players_characters_mana_nodes", "value"], ["players_characters_bond_tokens", "mana_board_index"]]) {
                const oldSql = db.prepare("SELECT sql FROM sqlite_master WHERE name=? AND type='table'").get(table).sql;
                const temp = `storage_new_${table}`;
                const replaced = oldSql.replace(/^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"[^"]+"|`[^`]+`|\[[^\]]+\]|\w+)/i, `CREATE TABLE ${quote(temp)}`)
                    .replace(/PRIMARY\s+KEY\s*\([^)]*\)/i, `PRIMARY KEY (player_id, character_id, ${key})`)
                    .replace(/;?\s*$/, " WITHOUT ROWID");
                if (replaced === oldSql || !replaced.includes(`CREATE TABLE ${quote(temp)}`))
                    throw new Error(`无法识别建表语句：${table}`);
                const columns = schemas.get(table).map(c => c.name);
                const list = columns.map(quote).join(",");
                // Preserve all explicit indexes initially; remove only those
                // whose entire prefix is supported by another complete index.
                const indexes = db.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name=? AND sql IS NOT NULL").all(table);
                db.exec(replaced);
                db.exec(`INSERT INTO ${quote(temp)}(${list}) SELECT ${list} FROM ${quote(table)}`);
                const count = db.prepare(`SELECT COUNT(*) n FROM ${quote(table)}`).get().n;
                const copied = db.prepare(`SELECT COUNT(*) n FROM ${quote(temp)}`).get().n;
                const join = ["player_id", "character_id", key].map(c => `a.${quote(c)}=b.${quote(c)}`).join(" AND ");
                const differences = columns.map(c => `a.${quote(c)} IS NOT b.${quote(c)}`).join(" OR ");
                if (count !== copied || db.prepare(`SELECT 1 FROM ${quote(table)} a LEFT JOIN ${quote(temp)} b ON ${join} WHERE b.player_id IS NULL OR ${differences} LIMIT 1`).get()) {
                    throw new Error(`角色明细迁移逐字段校验失败：${table}`);
                }
                db.exec(`DROP TABLE ${quote(table)}; ALTER TABLE ${quote(temp)} RENAME TO ${quote(table)}`);
                for (const index of indexes)
                    db.exec(index.sql);
                result.preservedRows[table] = count;
            }
            checkpoint("character-details-verified");
            result.retiredSnapshotRows = db.prepare(`SELECT COUNT(*) n FROM ${exports.RETIRED_COUNTER_SNAPSHOTS}`).get().n;
            db.exec(`
                DROP TABLE players_mission_counters;
                DROP TABLE players_mission_counter_snapshots;
                CREATE VIEW players_mission_counters AS
                    SELECT v.player_id,d.counter_key,d.dimension,d.scope_type,d.scope_key,d.qualifier_json,v.value,v.updated_at
                    FROM players_mission_counter_values v JOIN mission_counter_definitions d ON d.id=v.counter_id;
                CREATE TRIGGER storage_counter_insert INSTEAD OF INSERT ON players_mission_counters BEGIN
                    INSERT INTO mission_counter_definitions(counter_key,dimension,scope_type,scope_key,qualifier_json)
                        VALUES(NEW.counter_key,NEW.dimension,NEW.scope_type,NEW.scope_key,NEW.qualifier_json) ON CONFLICT(counter_key) DO NOTHING;
                    SELECT CASE WHEN EXISTS(SELECT 1 FROM mission_counter_definitions WHERE counter_key=NEW.counter_key
                        AND (dimension IS NOT NEW.dimension OR scope_type IS NOT NEW.scope_type OR scope_key IS NOT NEW.scope_key OR qualifier_json IS NOT NEW.qualifier_json))
                        THEN RAISE(ABORT,'conflicting mission counter definition') END;
                    INSERT INTO players_mission_counter_values(player_id,counter_id,value,updated_at)
                        SELECT NEW.player_id,id,NEW.value,NEW.updated_at FROM mission_counter_definitions WHERE counter_key=NEW.counter_key;
                END;
                CREATE TRIGGER storage_counter_delete INSTEAD OF DELETE ON players_mission_counters BEGIN
                    DELETE FROM players_mission_counter_values WHERE player_id=OLD.player_id
                        AND counter_id=(SELECT id FROM mission_counter_definitions WHERE counter_key=OLD.counter_key);
                END;
                CREATE VIEW players_mission_counter_snapshots AS SELECT
                    CAST(NULL AS INTEGER) AS player_id, CAST(NULL AS TEXT) AS period_type, CAST(NULL AS TEXT) AS counter_key,
                    CAST(NULL AS INTEGER) AS value, CAST(NULL AS TEXT) AS updated_at WHERE 0;
            `);
            result.removedIndexes = removeCoveredStorageIndexes(db);
            if (db.pragma("foreign_key_check").length > 0)
                throw new Error("迁移后外键校验失败");
            checkpoint("before-commit");
            db.prepare("INSERT INTO server_storage_migrations VALUES(?,?,?)").run(exports.STORAGE_LAYOUT_VERSION, new Date().toISOString(), JSON.stringify(result));
        }).immediate();
    }
    finally {
        db.pragma(`foreign_keys=${foreignKeys ? "ON" : "OFF"}`);
    }
    assertStorageLayout(db);
    return result;
}
exports.migrateStorageLayout = migrateStorageLayout;
/** Only remove named, non-unique indexes after checking complete key semantics. */
function removeCoveredStorageIndexes(db) {
    const removed = [];
    const targets = ["players_receive_history", "players_parties", "players_mails", "device_bindings", "players_characters_mana_nodes", "players_characters_bond_tokens"];
    for (const table of targets) {
        const indexes = db.prepare(`PRAGMA index_list(${quote(table)})`).all();
        const keys = (name) => db.prepare(`PRAGMA index_xinfo(${quote(name)})`).all().filter(c => c.key === 1);
        for (const candidate of indexes) {
            if (!candidate.name.startsWith("idx_cleanup_fk_") || candidate.unique || candidate.partial)
                continue;
            const columns = keys(candidate.name);
            if (columns.length === 0 || columns.some(c => c.name === null))
                continue;
            const covered = indexes.some(other => {
                if (other.name === candidate.name || other.partial || removed.includes(other.name))
                    return false;
                const otherKeys = keys(other.name);
                return columns.every((c, i) => { var _a, _b, _c; return ((_a = otherKeys[i]) === null || _a === void 0 ? void 0 : _a.name) === c.name && ((_b = otherKeys[i]) === null || _b === void 0 ? void 0 : _b.coll) === c.coll && ((_c = otherKeys[i]) === null || _c === void 0 ? void 0 : _c.desc) === c.desc; });
            });
            if (covered) {
                db.exec(`DROP INDEX ${quote(candidate.name)}`);
                removed.push(candidate.name);
            }
        }
    }
    return removed;
}
exports.removeCoveredStorageIndexes = removeCoveredStorageIndexes;
function writeCompactMissionCounter(db, playerId, definition, value, operation) {
    const expression = operation === "add" ? "value+excluded.value" : operation === "max" ? "MAX(value,excluded.value)" : "MIN(value,excluded.value)";
    const condition = operation === "add" ? "" : operation === "max" ? " WHERE excluded.value > value" : " WHERE excluded.value < value";
    return db.transaction(() => {
        (0, cached_statement_1.cachedStatement)(db, `INSERT INTO mission_counter_definitions(counter_key,dimension,scope_type,scope_key,qualifier_json)
            VALUES(?,?,?,?,?) ON CONFLICT(counter_key) DO NOTHING`).run(definition.key, definition.dimension, definition.scopeType, definition.scopeKey, definition.qualifierJson);
        const row = (0, cached_statement_1.cachedStatement)(db, `INSERT INTO players_mission_counter_values(player_id,counter_id,value,updated_at)
            SELECT ?,id,?,? FROM mission_counter_definitions WHERE counter_key=?
                AND dimension=? AND scope_type=? AND scope_key=? AND qualifier_json=?
            ON CONFLICT(player_id,counter_id) DO UPDATE SET value=${expression},updated_at=excluded.updated_at${condition}
            RETURNING value`).get(playerId, value, new Date().toISOString(), definition.key, definition.dimension, definition.scopeType, definition.scopeKey, definition.qualifierJson);
        if (row)
            return row.value;
        const current = (0, cached_statement_1.cachedStatement)(db, `SELECT value FROM players_mission_counter_values
            WHERE player_id=? AND counter_id=(SELECT id FROM mission_counter_definitions WHERE counter_key=?
                AND dimension=? AND scope_type=? AND scope_key=? AND qualifier_json=?)`).get(playerId, definition.key, definition.dimension, definition.scopeType, definition.scopeKey, definition.qualifierJson);
        if (!current)
            throw new Error("任务计数定义冲突，拒绝更新");
        return current.value;
    })();
}
exports.writeCompactMissionCounter = writeCompactMissionCounter;
