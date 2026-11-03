"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setLeaderboardAvailabilitySync = exports.isLeaderboardEnabledSync = exports.getLeaderboardAvailabilitySync = exports.isLeaderboardDeadlineDueSync = void 0;
const db_1 = require("../../data/db");
const leaderboard_1 = require("../../data/domains/leaderboard");
const persistence_coordinator_1 = require("../persistence-coordinator");
function isLeaderboardDeadlineDueSync(competitionKey, nowMs = Date.now()) {
    const config = (0, db_1.getDb)().prepare(`
        SELECT settle_at_ms, freeze_enabled, auto_enabled
        FROM leaderboard_settlement_configs WHERE competition_key = ?
    `).get(competitionKey);
    return config !== undefined && (config.freeze_enabled !== 0 || config.auto_enabled !== 0)
        && config.settle_at_ms !== null && nowMs >= config.settle_at_ms;
}
exports.isLeaderboardDeadlineDueSync = isLeaderboardDeadlineDueSync;
function deserializeAvailability(row) {
    return {
        competitionKey: row.competition_key,
        enabled: row.enabled !== 0,
        updatedAtMs: row.updated_at_ms,
    };
}
function getLeaderboardAvailabilitySync(competitionKey, nowMs = Date.now()) {
    var _a;
    const read = () => (0, db_1.getDb)().prepare(`
        SELECT competition_key, enabled, updated_at_ms
        FROM leaderboard_availability
        WHERE competition_key = ?
    `).get(competitionKey);
    const row = (_a = read()) !== null && _a !== void 0 ? _a : (0, persistence_coordinator_1.runPersistenceTransactionSync)({ domain: "leaderboard", operation: "initialize_availability" }, () => {
        (0, db_1.getDb)().prepare(`INSERT OR IGNORE INTO leaderboard_availability
            (competition_key, enabled, updated_at_ms) VALUES (?, ?, ?)`)
            .run(competitionKey, competitionKey === "rush:700100:1" ? 0 : 1, nowMs);
        return read();
    });
    if (row.enabled !== 0 && isLeaderboardDeadlineDueSync(competitionKey, nowMs)) {
        return setLeaderboardAvailabilitySync(competitionKey, false, nowMs).availability;
    }
    return deserializeAvailability(row);
}
exports.getLeaderboardAvailabilitySync = getLeaderboardAvailabilitySync;
function isLeaderboardEnabledSync(competitionKey, nowMs = Date.now()) {
    return getLeaderboardAvailabilitySync(competitionKey, nowMs).enabled;
}
exports.isLeaderboardEnabledSync = isLeaderboardEnabledSync;
function setLeaderboardAvailabilitySync(competitionKey, enabled, updatedAtMs = Date.now()) {
    if (!Number.isSafeInteger(updatedAtMs) || updatedAtMs < 0) {
        throw new Error("updatedAtMs must be a non-negative epoch millisecond value.");
    }
    const db = (0, db_1.getDb)();
    const operation = () => {
        db.prepare(`
            INSERT INTO leaderboard_availability (
                competition_key, enabled, updated_at_ms
            ) VALUES (?, ?, ?)
            ON CONFLICT (competition_key) DO UPDATE SET
                enabled = excluded.enabled,
                updated_at_ms = excluded.updated_at_ms
        `).run(competitionKey, enabled ? 1 : 0, updatedAtMs);
        const abandonedRuns = enabled ? 0 : (0, leaderboard_1.abandonLeaderboardRunsSync)({
            competitionKey,
            endedAtMs: updatedAtMs,
        });
        return {
            availability: getLeaderboardAvailabilitySync(competitionKey, updatedAtMs),
            abandonedRuns,
        };
    };
    return db.inTransaction ? operation() : (0, persistence_coordinator_1.runPersistenceTransactionSync)({
        domain: "leaderboard", operation: "set_leaderboard_availability",
    }, operation);
}
exports.setLeaderboardAvailabilitySync = setLeaderboardAvailabilitySync;
