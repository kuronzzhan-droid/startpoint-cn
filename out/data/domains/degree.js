"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensurePlayerSoloTimeAttackDegreesSync = exports.grantPlayerSoloTimeAttackDegreesSync = exports.ensurePlayerLegacyDegreesSync = exports.getPlayerDegreeIdsSync = exports.hasPlayerDegreeSync = exports.givePlayerDegreeSync = exports.grantPlayerDegreeSync = exports.validatePortableDegreeList = exports.getPlayerPortableDegreesSync = void 0;
const db_1 = require("../db");
const quest_1 = require("./quest");
const cached_statement_1 = require("../../lib/cached-statement");
function getPlayerPortableDegreesSync(playerId) {
    return (0, db_1.getDb)().prepare(`SELECT degree_id AS degreeId, acquired_at AS acquiredAt
        FROM players_degrees WHERE player_id = ? ORDER BY degree_id`).all(playerId);
}
exports.getPlayerPortableDegreesSync = getPlayerPortableDegreesSync;
/** Validate before replacing a player: malformed V1 progress must never erase the target. */
function validatePortableDegreeList(value) {
    if (value === undefined)
        return;
    if (!Array.isArray(value))
        throw new Error("degreeList must be an array");
    const ids = new Set();
    for (const entry of value) {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)
            || !Number.isSafeInteger(entry.degreeId) || entry.degreeId < 1
            || !Number.isSafeInteger(entry.acquiredAt) || entry.acquiredAt < 0
            || ids.has(entry.degreeId))
            throw new Error("Invalid or duplicate degreeList entry");
        ids.add(entry.degreeId);
    }
}
exports.validatePortableDegreeList = validatePortableDegreeList;
/**
 * Grants a title to a player. Duplicate grants are intentionally idempotent.
 * Returns true only when a new ownership row was inserted.
 */
function grantPlayerDegreeSync(playerId, degreeId, acquiredAt = Date.now()) {
    if (!Number.isInteger(playerId) || playerId <= 0)
        return false;
    if (!Number.isInteger(degreeId) || degreeId <= 0)
        return false;
    const result = (0, cached_statement_1.cachedStatement)((0, db_1.getDb)(), `
        INSERT OR IGNORE INTO players_degrees (player_id, degree_id, acquired_at)
        VALUES (?, ?, ?)
    `).run(playerId, degreeId, acquiredAt);
    return result.changes > 0;
}
exports.grantPlayerDegreeSync = grantPlayerDegreeSync;
function givePlayerDegreeSync(playerId, degreeId) {
    return grantPlayerDegreeSync(playerId, degreeId);
}
exports.givePlayerDegreeSync = givePlayerDegreeSync;
function hasPlayerDegreeSync(playerId, degreeId) {
    if (degreeId === 1)
        return true;
    const row = (0, db_1.getDb)().prepare(`
        SELECT 1
        FROM players_degrees
        WHERE player_id = ? AND degree_id = ?
        LIMIT 1
    `).get(playerId, degreeId);
    return row !== undefined;
}
exports.hasPlayerDegreeSync = hasPlayerDegreeSync;
function getPlayerDegreeIdsSync(playerId) {
    const rows = (0, db_1.getDb)().prepare(`
        SELECT degree_id
        FROM players_degrees
        WHERE player_id = ?
        ORDER BY acquired_at ASC, degree_id ASC
    `).all(playerId);
    return rows.map(row => row.degree_id);
}
exports.getPlayerDegreeIdsSync = getPlayerDegreeIdsSync;
/**
 * Old saves only stored the currently equipped title on players.degree_id.
 * Keep that title and the default title when the ownership table is introduced.
 */
function ensurePlayerLegacyDegreesSync(playerId, currentDegreeId) {
    grantPlayerDegreeSync(playerId, 1, 0);
    if (Number.isInteger(currentDegreeId) && currentDegreeId > 0) {
        grantPlayerDegreeSync(playerId, currentDegreeId, 0);
    }
}
exports.ensurePlayerLegacyDegreesSync = ensurePlayerLegacyDegreesSync;
/**
 * Extreme time trial title rewards are displayed by the client from the quest
 * result, but they are not part of mission_degree.json and therefore were
 * never persisted in players_degrees.
 *
 * Each elemental quest has a 3-minute "mastery" title and a 5-minute
 * "victory" title. A 3-minute clear also satisfies the 5-minute condition.
 */
const SOLO_TIME_ATTACK_DEGREE_RULES = [
    { questId: 1001, masteryDegreeId: 54500, victoryDegreeId: 54510 },
    { questId: 1002, masteryDegreeId: 54520, victoryDegreeId: 54530 },
    { questId: 1003, masteryDegreeId: 54540, victoryDegreeId: 54550 },
    { questId: 1004, masteryDegreeId: 54560, victoryDegreeId: 54570 },
    { questId: 1005, masteryDegreeId: 54580, victoryDegreeId: 54590 },
    { questId: 1006, masteryDegreeId: 54600, victoryDegreeId: 54610 },
];
const SOLO_TIME_ATTACK_SECTION = "25";
const MASTERY_TIME_LIMIT_MS = 180000;
const VICTORY_TIME_LIMIT_MS = 300000;
function grantPlayerSoloTimeAttackDegreesSync(playerId, questId, elapsedTimeMs) {
    if (!Number.isFinite(elapsedTimeMs) || elapsedTimeMs < 0)
        return [];
    const rule = SOLO_TIME_ATTACK_DEGREE_RULES.find(entry => entry.questId === questId);
    if (!rule)
        return [];
    const granted = [];
    if (elapsedTimeMs <= VICTORY_TIME_LIMIT_MS &&
        grantPlayerDegreeSync(playerId, rule.victoryDegreeId)) {
        granted.push(rule.victoryDegreeId);
    }
    if (elapsedTimeMs <= MASTERY_TIME_LIMIT_MS &&
        grantPlayerDegreeSync(playerId, rule.masteryDegreeId)) {
        granted.push(rule.masteryDegreeId);
    }
    return granted;
}
exports.grantPlayerSoloTimeAttackDegreesSync = grantPlayerSoloTimeAttackDegreesSync;
/**
 * Backfills titles for clears completed before title persistence was fixed.
 * This is intentionally idempotent and only reads each player's best time.
 */
function ensurePlayerSoloTimeAttackDegreesSync(playerId) {
    var _a;
    const progressList = (_a = (0, quest_1.getPlayerQuestProgressSync)(playerId)[SOLO_TIME_ATTACK_SECTION]) !== null && _a !== void 0 ? _a : [];
    const granted = [];
    for (const progress of progressList) {
        if (!progress.finished || progress.bestElapsedTimeMs === null || progress.bestElapsedTimeMs === undefined) {
            continue;
        }
        granted.push(...grantPlayerSoloTimeAttackDegreesSync(playerId, progress.questId, progress.bestElapsedTimeMs));
    }
    return granted;
}
exports.ensurePlayerSoloTimeAttackDegreesSync = ensurePlayerSoloTimeAttackDegreesSync;
