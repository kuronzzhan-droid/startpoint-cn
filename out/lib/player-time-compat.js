"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPlayerClientExpTime = exports.getPlayerClientMaintenanceDateSync = exports.validatePlayerArchiveTimeBasis = exports.getPlayerBusinessDateSync = exports.getPlayerBusinessOffsetSync = exports.getExistingPlayerTimeStateSync = void 0;
const utils_1 = require("../utils");
function database(db) { return db !== null && db !== void 0 ? db : require("../data/db").getDb(); }
function assertEpoch(value, field) {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || !Number.isFinite(new Date(value).getTime())) {
        throw new Error(`${field}: invalid real-time epoch`);
    }
}
/** Read existing markers only. This compatibility module never creates or migrates state. */
function getExistingPlayerTimeStateSync(playerId, db) {
    const connection = database(db);
    if (!connection.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='player_time_state'").get())
        return null;
    const row = connection.prepare("SELECT version,cutover_real_ms,day_anchor_ms,week_anchor_ms FROM player_time_state WHERE player_id=?")
        .get(playerId);
    if (!row)
        return null;
    if (row.version !== 1)
        throw new Error("Unsupported existing player time version");
    assertEpoch(row.cutover_real_ms, "cutoverRealMs");
    assertEpoch(row.day_anchor_ms, "dayAnchorMs");
    assertEpoch(row.week_anchor_ms, "weekAnchorMs");
    return { playerId, version: row.version, cutoverRealMs: row.cutover_real_ms,
        dayAnchorMs: row.day_anchor_ms, weekAnchorMs: row.week_anchor_ms };
}
exports.getExistingPlayerTimeStateSync = getExistingPlayerTimeStateSync;
function getPlayerBusinessOffsetSync(playerId, db) {
    var _a;
    return getExistingPlayerTimeStateSync(playerId, db) ? 0 : (_a = (0, utils_1.getTimeOffset)()) !== null && _a !== void 0 ? _a : 0;
}
exports.getPlayerBusinessOffsetSync = getPlayerBusinessOffsetSync;
/** Maintenance storage only: the supplied date uses the current effective context, never an assumed global offset. */
function getPlayerBusinessDateSync(playerId, providedDate = (0, utils_1.getServerDate)(), db) {
    var _a;
    return new Date(providedDate.getTime() - ((_a = (0, utils_1.getTimeOffset)()) !== null && _a !== void 0 ? _a : 0) + getPlayerBusinessOffsetSync(playerId, db));
}
exports.getPlayerBusinessDateSync = getPlayerBusinessDateSync;
function validatePlayerArchiveTimeBasis(value) {
    if (!value || typeof value !== "object")
        throw new Error("Invalid archive time basis");
    const basis = value;
    if (basis.kind !== "real-system" || basis.version !== 1)
        throw new Error("Unsupported archive time basis");
    assertEpoch(basis.cutoverRealMs, "timeBasis.cutoverRealMs");
    assertEpoch(basis.dayAnchorMs, "timeBasis.dayAnchorMs");
    assertEpoch(basis.weekAnchorMs, "timeBasis.weekAnchorMs");
    if (basis.dayAnchorMs < basis.cutoverRealMs || basis.weekAnchorMs < basis.cutoverRealMs)
        throw new Error("Archive time anchors predate cutover");
}
exports.validatePlayerArchiveTimeBasis = validatePlayerArchiveTimeBasis;
/** Existing real maintenance fields are translated back to the legacy client coordinate. */
function getPlayerClientMaintenanceDateSync(playerId, date) {
    var _a;
    return new Date(date.getTime() - getPlayerBusinessOffsetSync(playerId) + ((_a = (0, utils_1.getTimeOffset)()) !== null && _a !== void 0 ? _a : 0));
}
exports.getPlayerClientMaintenanceDateSync = getPlayerClientMaintenanceDateSync;
/** Saved EXP offsets identify the checkpoint coordinate, not the displayed content date. */
function getPlayerClientExpTime(player) {
    var _a;
    const clientOffset = (_a = (0, utils_1.getTimeOffset)()) !== null && _a !== void 0 ? _a : 0;
    const storedOffset = typeof player.timeOffset === "number" && Number.isFinite(player.timeOffset)
        ? player.timeOffset : clientOffset;
    return Math.floor((player.expPooledTime.getTime() - storedOffset + clientOffset) / 1000);
}
exports.getPlayerClientExpTime = getPlayerClientExpTime;
