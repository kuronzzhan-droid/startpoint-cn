"use strict";
// Tracks per-character powerflip count for leader-specific powerflip missions (1210012)
// Accumulates zone powerflips to the leader character's counter
Object.defineProperty(exports, "__esModule", { value: true });
exports.trackLeaderPowerflip = void 0;
const db_1 = require("../../../data/db");
const persistence_coordinator_1 = require("../../persistence-coordinator");
function trackLeaderPowerflip(ctx) {
    var _a, _b;
    const zones = ctx.statistics.zones || [];
    let powerFlipCount = 0;
    for (const zone of zones) {
        powerFlipCount += (_a = zone.use_power_flip_count) !== null && _a !== void 0 ? _a : 0;
    }
    if (powerFlipCount === 0)
        return;
    const leaderId = (_b = ctx.party.characters[0]) === null || _b === void 0 ? void 0 : _b.id;
    if (!leaderId)
        return;
    (0, persistence_coordinator_1.runPersistenceTransactionSync)({
        domain: "mission", playerId: ctx.playerId, operation: "track_leader_powerflip",
    }, () => {
        (0, db_1.getDb)().prepare(`
        INSERT INTO players_character_quest_clears (player_id, character_id, clear_count, multi_count, leader_clear_count, leader_multi_count, leader_power_flip_count)
        VALUES (?, ?, 0, 0, 0, 0, ?)
        ON CONFLICT(player_id, character_id) DO UPDATE SET
            leader_power_flip_count = leader_power_flip_count + ?
        `).run(ctx.playerId, leaderId, powerFlipCount, powerFlipCount);
    });
}
exports.trackLeaderPowerflip = trackLeaderPowerflip;
