"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.incrementActiveMissionConditionalBattleFactSync = exports.getActiveMissionConditionalBattleFactsSync = void 0;
const cached_statement_1 = require("../../lib/cached-statement");
const db_1 = require("../db");
function getActiveMissionConditionalBattleFactsSync(playerId) {
    const rows = (0, cached_statement_1.cachedStatement)((0, db_1.getDb)(), `
        SELECT pattern, character_id, progress
        FROM players_active_mission_battle_condition_facts
        WHERE player_id = ?
    `).all(playerId);
    return Object.fromEntries(rows.map(row => [
        `${row.pattern}:${row.character_id}`,
        Math.max(0, row.progress),
    ]));
}
exports.getActiveMissionConditionalBattleFactsSync = getActiveMissionConditionalBattleFactsSync;
function incrementActiveMissionConditionalBattleFactSync(playerId, pattern, characterId) {
    if (!Number.isSafeInteger(pattern) || pattern <= 0
        || !Number.isSafeInteger(characterId) || characterId <= 0)
        return;
    (0, cached_statement_1.cachedStatement)((0, db_1.getDb)(), `
        INSERT INTO players_active_mission_battle_condition_facts (
            player_id, pattern, character_id, progress
        ) VALUES (?, ?, ?, 1)
        ON CONFLICT(player_id, pattern, character_id) DO UPDATE SET
            progress = progress + 1
    `).run(playerId, pattern, characterId);
}
exports.incrementActiveMissionConditionalBattleFactSync = incrementActiveMissionConditionalBattleFactSync;
