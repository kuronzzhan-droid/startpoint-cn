"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveProfileTargetPlayerIdSync = exports.fromProfileTargetId = exports.toProfileTargetId = exports.RUSH_PROFILE_ID_BASE = void 0;
const follow_1 = require("../data/domains/follow");
// Compatibility for cached leaderboard responses. New rows use real viewer
// IDs; only old clients may still send this encoded archive-ID namespace.
exports.RUSH_PROFILE_ID_BASE = 9000000000;
function toProfileTargetId(playerId) {
    if (!Number.isSafeInteger(playerId) || playerId <= 0
        || !Number.isSafeInteger(exports.RUSH_PROFILE_ID_BASE + playerId))
        return 0;
    return exports.RUSH_PROFILE_ID_BASE + playerId;
}
exports.toProfileTargetId = toProfileTargetId;
function fromProfileTargetId(targetId) {
    if (!Number.isSafeInteger(targetId))
        return null;
    const playerId = targetId - exports.RUSH_PROFILE_ID_BASE;
    return playerId > 0 ? playerId : null;
}
exports.fromProfileTargetId = fromProfileTargetId;
function resolveProfileTargetPlayerIdSync(targetId) {
    if (!Number.isSafeInteger(targetId) || targetId <= 0)
        return null;
    const legacyPlayerId = fromProfileTargetId(targetId);
    if (legacyPlayerId === null)
        return (0, follow_1.getPlayerIdByViewerIdSync)(targetId);
    // A legacy profile and its subsequent real-ID follow action must resolve
    // to the same archive. Missing or switched identities are unavailable.
    return (0, follow_1.getViewerIdByPlayerIdSync)(legacyPlayerId) === null ? null : legacyPlayerId;
}
exports.resolveProfileTargetPlayerIdSync = resolveProfileTargetPlayerIdSync;
