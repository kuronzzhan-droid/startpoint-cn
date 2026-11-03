"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.incrementActiveMissionBattleFactSync = exports.getActiveMissionBattleFactsSync = void 0;
const cached_statement_1 = require("../../lib/cached-statement");
const db_1 = require("../db");
function getActiveMissionBattleFactsSync(playerId) {
    const rows = (0, cached_statement_1.cachedStatement)((0, db_1.getDb)(), `
        SELECT mission_id, progress
        FROM players_active_mission_battle_facts
        WHERE player_id = ?
    `).all(playerId);
    return Object.fromEntries(rows.map(row => [
        String(row.mission_id),
        Math.max(0, row.progress),
    ]));
}
exports.getActiveMissionBattleFactsSync = getActiveMissionBattleFactsSync;
function incrementActiveMissionBattleFactSync(playerId, missionId, amount = 1) {
    if (!Number.isSafeInteger(missionId) || missionId <= 0
        || !Number.isSafeInteger(amount) || amount <= 0)
        return;
    (0, cached_statement_1.cachedStatement)((0, db_1.getDb)(), `
        INSERT INTO players_active_mission_battle_facts (
            player_id, mission_id, progress
        ) VALUES (?, ?, ?)
        ON CONFLICT(player_id, mission_id) DO UPDATE SET
            progress = progress + excluded.progress
    `).run(playerId, missionId, amount);
}
exports.incrementActiveMissionBattleFactSync = incrementActiveMissionBattleFactSync;
