"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAbyssFloorRecordDetailsSync = exports.getAbyssFloorRecordSync = exports.recordAbyssFloorFinishSync = void 0;
const db_1 = require("../db");
const abyss_time_revision_1 = require("../../lib/abyss-time-revision");
const activeAccount_1 = require("../activeAccount");
/** Called inside the settlement transaction, never by save import or progress reads. */
function recordAbyssFloorFinishSync(finish) {
    const current = (0, abyss_time_revision_1.getAbyssTimeRevision)(Math.floor(finish.questId / 1000));
    if (!(0, abyss_time_revision_1.isAbyssFiniteQuest)(finish.category, finish.questId) || !current || finish.revision !== current
        || !finish.accomplished || !finish.registered || !finish.matchingPlay || finish.isMulti
        || !Number.isSafeInteger(finish.viewerId) || finish.viewerId <= 0
        || !Number.isSafeInteger(finish.elapsedTimeMs) || finish.elapsedTimeMs <= 0
        || finish.elapsedTimeMs > 2147483647
        || !Number.isFinite(finish.startedAtMs) || !Number.isFinite(finish.nowMs)
        || finish.startedAtMs > finish.nowMs
        // Allow transport/whole-second start timestamp tolerance, not future play time.
        || finish.elapsedTimeMs > finish.nowMs - finish.startedAtMs + 5000)
        return false;
    return (0, db_1.getDb)().prepare(`INSERT INTO abyss_floor_records
        (revision, quest_id, elapsed_time_ms, viewer_id, recorded_at_ms) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(revision, quest_id) DO UPDATE SET
            elapsed_time_ms=excluded.elapsed_time_ms, viewer_id=excluded.viewer_id,
            recorded_at_ms=excluded.recorded_at_ms
        WHERE excluded.elapsed_time_ms < abyss_floor_records.elapsed_time_ms`)
        .run(current, finish.questId, finish.elapsedTimeMs, finish.viewerId, finish.nowMs).changes > 0;
}
exports.recordAbyssFloorFinishSync = recordAbyssFloorFinishSync;
function getAbyssFloorRecordSync(revision, questId) {
    var _a;
    const row = (0, db_1.getDb)().prepare(`SELECT elapsed_time_ms FROM abyss_floor_records
        WHERE revision=? AND quest_id=?`).get(revision, questId);
    return (_a = row === null || row === void 0 ? void 0 : row.elapsed_time_ms) !== null && _a !== void 0 ? _a : null;
}
exports.getAbyssFloorRecordSync = getAbyssFloorRecordSync;
/** Resolve the record's public viewer identity like the public player profile.
 * No login tokens, account fields or player IDs are returned to callers.
 */
function getAbyssFloorRecordDetailsSync(revision, questId) {
    const db = (0, db_1.getDb)();
    const row = db.prepare(`SELECT r.elapsed_time_ms, s.account_id
        FROM abyss_floor_records r
        LEFT JOIN sessions s ON s.token=CAST(r.viewer_id AS TEXT) AND s.type=2
        WHERE r.revision=? AND r.quest_id=?`).get(revision, questId);
    if (!row)
        return null;
    const playerId = row.account_id === null ? null : (0, activeAccount_1.resolvePlayerIdSync)(row.account_id);
    const profile = playerId === null ? undefined : db.prepare('SELECT name FROM players WHERE id=?')
        .get(playerId);
    return { bestTimeMs: row.elapsed_time_ms, holderName: (profile === null || profile === void 0 ? void 0 : profile.name) || null };
}
exports.getAbyssFloorRecordDetailsSync = getAbyssFloorRecordDetailsSync;
