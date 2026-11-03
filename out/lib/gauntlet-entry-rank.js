"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.canStartRankGatedGauntletRush = exports.isRankGatedGauntletRushEvent = exports.GAUNTLET_MIN_PLAYER_RANK = void 0;
exports.GAUNTLET_MIN_PLAYER_RANK = 130;
const RANK_GATED_RUSH_EVENT_IDS = new Set([
    700098, // Fantasy Gauntlet
    700099, // Deep Abyss Gauntlet
    700100, // Deep Abyss EX
]);
function isRankGatedGauntletRushEvent(rushEventId) {
    return RANK_GATED_RUSH_EVENT_IDS.has(rushEventId);
}
exports.isRankGatedGauntletRushEvent = isRankGatedGauntletRushEvent;
function canStartRankGatedGauntletRush(rushEventId, playerRank) {
    return !isRankGatedGauntletRushEvent(rushEventId)
        || playerRank >= exports.GAUNTLET_MIN_PLAYER_RANK;
}
exports.canStartRankGatedGauntletRush = canStartRankGatedGauntletRush;
