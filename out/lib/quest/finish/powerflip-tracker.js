"use strict";
// Accumulates zone-level powerflip and dash counters for mission progress
Object.defineProperty(exports, "__esModule", { value: true });
exports.trackPowerflip = void 0;
const player_1 = require("../../../data/domains/player");
function trackPowerflip(ctx) {
    var _a, _b, _c, _d;
    const zones = ctx.statistics.zones || [];
    let powerFlipCount = 0;
    let dashCount = 0;
    for (const zone of zones) {
        powerFlipCount += (_a = zone.use_power_flip_count) !== null && _a !== void 0 ? _a : 0;
        dashCount += (_b = zone.use_dash_count) !== null && _b !== void 0 ? _b : 0;
    }
    if (powerFlipCount > 0 || dashCount > 0) {
        (0, player_1.updatePlayerSync)({
            id: ctx.playerId,
            totalPowerflips: ((_c = ctx.player.totalPowerflips) !== null && _c !== void 0 ? _c : 0) + powerFlipCount,
            totalDashes: ((_d = ctx.player.totalDashes) !== null && _d !== void 0 ? _d : 0) + dashCount,
        });
    }
}
exports.trackPowerflip = trackPowerflip;
