"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.snapshotAllMissionCountersSync = exports.getMissionCounterDeltaSync = exports.getMissionCounterSnapshotValueSync = exports.getMissionCounterValuesSync = exports.getMissionCounterValueSync = exports.setMissionCounterMinSync = exports.setMissionCounterMaxSync = exports.addMissionCounterSync = exports.makeMissionCounterKey = exports.serializeMissionCounterQualifier = exports.normalizeMissionCounterQualifier = void 0;
const cached_statement_1 = require("../cached-statement");
const db_1 = require("../../data/db");
const storage_layout_1 = require("../storage-layout");
const persistence_coordinator_1 = require("../persistence-coordinator");
function normalizeMissionCounterQualifier(qualifier = {}) {
    const normalized = {};
    for (const key of Object.keys(qualifier).sort()) {
        const value = qualifier[key];
        if (value === null || value === undefined || value === "(None)" || value === "")
            continue;
        normalized[key] = value;
    }
    return normalized;
}
exports.normalizeMissionCounterQualifier = normalizeMissionCounterQualifier;
function serializeMissionCounterQualifier(qualifier = {}) {
    return JSON.stringify(normalizeMissionCounterQualifier(qualifier));
}
exports.serializeMissionCounterQualifier = serializeMissionCounterQualifier;
function makeMissionCounterKey(query) {
    return [
        query.dimension,
        query.scopeType,
        query.scopeKey,
        serializeMissionCounterQualifier(query.qualifier),
    ].join("|");
}
exports.makeMissionCounterKey = makeMissionCounterKey;
function nowSql() {
    return new Date().toISOString();
}
function addMissionCounterSync(playerId, query, amount = 1) {
    if (amount <= 0)
        return getMissionCounterValueSync(playerId, query);
    const counterKey = makeMissionCounterKey(query);
    const qualifierJson = serializeMissionCounterQualifier(query.qualifier);
    if ((0, storage_layout_1.isCompactStorage)((0, db_1.getDb)()))
        return (0, storage_layout_1.writeCompactMissionCounter)((0, db_1.getDb)(), playerId, {
            key: counterKey, dimension: query.dimension, scopeType: query.scopeType, scopeKey: query.scopeKey, qualifierJson,
        }, amount, "add");
    const row = (0, cached_statement_1.cachedStatement)((0, db_1.getDb)(), `
    INSERT INTO players_mission_counters
        (player_id, counter_key, dimension, scope_type, scope_key, qualifier_json, value, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(player_id, counter_key) DO UPDATE SET
        value = value + excluded.value,
        updated_at = excluded.updated_at
    RETURNING value
    `).get(playerId, counterKey, query.dimension, query.scopeType, query.scopeKey, qualifierJson, amount, nowSql());
    return row.value;
}
exports.addMissionCounterSync = addMissionCounterSync;
function setMissionCounterMaxSync(playerId, query, value) {
    const counterKey = makeMissionCounterKey(query);
    const qualifierJson = serializeMissionCounterQualifier(query.qualifier);
    if ((0, storage_layout_1.isCompactStorage)((0, db_1.getDb)()))
        return (0, storage_layout_1.writeCompactMissionCounter)((0, db_1.getDb)(), playerId, {
            key: counterKey, dimension: query.dimension, scopeType: query.scopeType, scopeKey: query.scopeKey, qualifierJson,
        }, value, "max");
    const row = (0, cached_statement_1.cachedStatement)((0, db_1.getDb)(), `
    INSERT INTO players_mission_counters
        (player_id, counter_key, dimension, scope_type, scope_key, qualifier_json, value, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(player_id, counter_key) DO UPDATE SET
        value = MAX(value, excluded.value),
        updated_at = excluded.updated_at
        WHERE excluded.value > value
    RETURNING value
    `).get(playerId, counterKey, query.dimension, query.scopeType, query.scopeKey, qualifierJson, value, nowSql());
    if (row)
        return row.value;
    return getMissionCounterValueSync(playerId, query);
}
exports.setMissionCounterMaxSync = setMissionCounterMaxSync;
function setMissionCounterMinSync(playerId, query, value) {
    if (!Number.isFinite(value) || value <= 0)
        return getMissionCounterValueSync(playerId, query);
    const counterKey = makeMissionCounterKey(query);
    const qualifierJson = serializeMissionCounterQualifier(query.qualifier);
    if ((0, storage_layout_1.isCompactStorage)((0, db_1.getDb)()))
        return (0, storage_layout_1.writeCompactMissionCounter)((0, db_1.getDb)(), playerId, {
            key: counterKey, dimension: query.dimension, scopeType: query.scopeType, scopeKey: query.scopeKey, qualifierJson,
        }, value, "min");
    const row = (0, cached_statement_1.cachedStatement)((0, db_1.getDb)(), `
    INSERT INTO players_mission_counters
        (player_id, counter_key, dimension, scope_type, scope_key, qualifier_json, value, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(player_id, counter_key) DO UPDATE SET
        value = MIN(value, excluded.value),
        updated_at = excluded.updated_at
        WHERE excluded.value < value
    RETURNING value
    `).get(playerId, counterKey, query.dimension, query.scopeType, query.scopeKey, qualifierJson, value, nowSql());
    if (row)
        return row.value;
    return getMissionCounterValueSync(playerId, query);
}
exports.setMissionCounterMinSync = setMissionCounterMinSync;
function getMissionCounterValueSync(playerId, query) {
    var _a;
    const counterKey = makeMissionCounterKey(query);
    const row = (0, cached_statement_1.cachedStatement)((0, db_1.getDb)(), `
    SELECT value FROM players_mission_counters
    WHERE player_id = ? AND counter_key = ?
    `).get(playerId, counterKey);
    return (_a = row === null || row === void 0 ? void 0 : row.value) !== null && _a !== void 0 ? _a : 0;
}
exports.getMissionCounterValueSync = getMissionCounterValueSync;
/** Loads several exact counter keys with one SQLite statement. */
function getMissionCounterValuesSync(playerId, queries) {
    const counterKeys = [...new Set(queries.map(makeMissionCounterKey))];
    if (counterKeys.length === 0)
        return new Map();
    const placeholders = counterKeys.map(() => "?").join(", ");
    const rows = (0, cached_statement_1.cachedStatement)((0, db_1.getDb)(), `
    SELECT counter_key, value FROM players_mission_counters
    WHERE player_id = ? AND counter_key IN (${placeholders})
    `).all(playerId, ...counterKeys);
    const values = new Map(counterKeys.map(key => [key, 0]));
    for (const row of rows)
        values.set(row.counter_key, Number(row.value) || 0);
    return values;
}
exports.getMissionCounterValuesSync = getMissionCounterValuesSync;
function getMissionCounterSnapshotValueSync(playerId, periodType, query) {
    var _a;
    if ((0, storage_layout_1.isCompactStorage)((0, db_1.getDb)()))
        throw new Error("旧任务快照已退役，周期任务应使用 players_periodic_snapshots");
    const counterKey = makeMissionCounterKey(query);
    const row = (0, cached_statement_1.cachedStatement)((0, db_1.getDb)(), `
    SELECT value FROM players_mission_counter_snapshots
    WHERE player_id = ? AND period_type = ? AND counter_key = ?
    `).get(playerId, periodType, counterKey);
    return (_a = row === null || row === void 0 ? void 0 : row.value) !== null && _a !== void 0 ? _a : 0;
}
exports.getMissionCounterSnapshotValueSync = getMissionCounterSnapshotValueSync;
function getMissionCounterDeltaSync(playerId, periodType, query) {
    const current = getMissionCounterValueSync(playerId, query);
    const snapshot = getMissionCounterSnapshotValueSync(playerId, periodType, query);
    return Math.max(0, current - snapshot);
}
exports.getMissionCounterDeltaSync = getMissionCounterDeltaSync;
function snapshotAllMissionCountersSync(playerId, periodType) {
    if ((0, storage_layout_1.isCompactStorage)((0, db_1.getDb)()))
        throw new Error("旧任务快照已退役，禁止重新生成全量副本");
    const rows = (0, cached_statement_1.cachedStatement)((0, db_1.getDb)(), `
    SELECT counter_key, value FROM players_mission_counters
    WHERE player_id = ?
    `).all(playerId);
    const insert = (0, cached_statement_1.cachedStatement)((0, db_1.getDb)(), `
    INSERT INTO players_mission_counter_snapshots
        (player_id, period_type, counter_key, value, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(player_id, period_type, counter_key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `);
    const timestamp = nowSql();
    (0, persistence_coordinator_1.runPersistenceTransactionSync)({
        domain: "mission", playerId, operation: "snapshot_all_mission_counters",
    }, () => {
        for (const row of rows)
            insert.run(playerId, periodType, row.counter_key, row.value, timestamp);
    });
    return rows.length;
}
exports.snapshotAllMissionCountersSync = snapshotAllMissionCountersSync;
