"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPlayerPracticeBattleHistorySync = exports.insertPlayerPracticeBattleHistorySync = exports.PRACTICE_BATTLE_HISTORY_CLIENT_LIMIT = void 0;
const db_1 = require("../db");
const battle_history_1 = require("./battle-history");
// The legacy client has no paging and eagerly converts every returned record.
// Bound the combined practice-quest list while keeping the durable archive.
exports.PRACTICE_BATTLE_HISTORY_CLIENT_LIMIT = 100;
function insertPlayerPracticeBattleHistorySync(record) {
    const placeholders = Array.from({ length: 31 }, () => "?").join(", ");
    const result = (0, db_1.getDb)().prepare(`
        INSERT OR IGNORE INTO players_practice_battle_history (
            player_id, play_id, ${battle_history_1.BATTLE_HISTORY_COLUMNS}
        ) VALUES (${placeholders})
    `).run(record.playerId, record.playId, ...(0, battle_history_1.battleHistoryProtocolValues)(record));
    return result.changes === 1;
}
exports.insertPlayerPracticeBattleHistorySync = insertPlayerPracticeBattleHistorySync;
function getPlayerPracticeBattleHistorySync(playerId) {
    return (0, db_1.getDb)().prepare(`
        SELECT ${battle_history_1.BATTLE_HISTORY_COLUMNS}
        FROM players_practice_battle_history
        WHERE player_id = ? AND category_id = 15
        ORDER BY id DESC
        LIMIT ?
    `).all(playerId, exports.PRACTICE_BATTLE_HISTORY_CLIENT_LIMIT);
}
exports.getPlayerPracticeBattleHistorySync = getPlayerPracticeBattleHistorySync;
