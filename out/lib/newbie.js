"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isNewbiePlayerSync = void 0;
const player_1 = require("../data/domains/player");
const assets_1 = require("./assets");
const stamina_1 = require("./stamina");
const DAY_MS = 24 * 60 * 60 * 1000;
/**
 * Official-style beginner eligibility used by rescue notices and missions.
 * A host must still be within both the configured rank and account-age limits.
 */
function isNewbiePlayerSync(playerId, player = (0, player_1.getPlayerSync)(playerId), nowMs = Date.now()) {
    var _a, _b, _c, _d;
    if (!player)
        return false;
    const config = (0, assets_1.getConfigSync)();
    const maxRank = Math.max(0, Number(config.newbie_rank) || 0);
    const maxDays = Math.max(0, Number(config.newbie_days) || 0);
    if (maxRank <= 0 || maxDays <= 0)
        return false;
    if ((0, stamina_1.getRankDegree)(player.rankPoint || 0) > maxRank)
        return false;
    const account = (0, player_1.getAccountFromPlayerIdSync)(playerId);
    const startedAt = (_d = (_b = (_a = account === null || account === void 0 ? void 0 : account.firstLoginTime) === null || _a === void 0 ? void 0 : _a.getTime()) !== null && _b !== void 0 ? _b : (_c = account === null || account === void 0 ? void 0 : account.regTime) === null || _c === void 0 ? void 0 : _c.getTime()) !== null && _d !== void 0 ? _d : Number.NaN;
    if (!Number.isFinite(startedAt))
        return false;
    return nowMs >= startedAt && nowMs - startedAt <= maxDays * DAY_MS;
}
exports.isNewbiePlayerSync = isNewbiePlayerSync;
