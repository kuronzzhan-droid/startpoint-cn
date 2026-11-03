"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setPlayerRepairVersionSync = exports.getPlayerRepairVersionsSync = void 0;
const db_1 = require("../db");
function getPlayerRepairVersionsSync(playerId) {
    const rows = (0, db_1.getDb)().prepare(`
        SELECT repair_key, repair_version
        FROM players_repair_versions
        WHERE player_id = ?
    `).all(playerId);
    return new Map(rows.map(row => [row.repair_key, row.repair_version]));
}
exports.getPlayerRepairVersionsSync = getPlayerRepairVersionsSync;
function setPlayerRepairVersionSync(playerId, repairKey, repairVersion) {
    (0, db_1.getDb)().prepare(`
        INSERT INTO players_repair_versions
            (player_id, repair_key, repair_version, applied_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(player_id, repair_key) DO UPDATE SET
            repair_version = MAX(repair_version, excluded.repair_version),
            applied_at = excluded.applied_at
    `).run(playerId, repairKey, repairVersion, new Date().toISOString());
}
exports.setPlayerRepairVersionSync = setPlayerRepairVersionSync;
