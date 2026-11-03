"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.refreshPlayerAbyssBestTimesSync = void 0;
const db_1 = require("../db");
const abyss_modes_1 = require("../../lib/abyss-modes");
const abyss_time_revision_1 = require("../../lib/abyss-time-revision");
const quest_1 = require("../../lib/types/quest");
const persistence_coordinator_1 = require("../../lib/persistence-coordinator");
/** Clear only the finite tower's times, including legacy saves and restored saves. */
function refreshPlayerAbyssBestTimesSync(playerId, eventId) {
    if (eventId === undefined) {
        let normalRevision = null;
        for (const id of abyss_modes_1.ABYSS_EVENT_IDS) {
            const result = refreshPlayerAbyssBestTimesSync(playerId, id);
            if (id === abyss_modes_1.ABYSS_NORMAL_EVENT_ID)
                normalRevision = result;
        }
        return normalRevision;
    }
    if (!(0, abyss_modes_1.isAbyssEvent)(eventId))
        return null;
    const revision = (0, abyss_time_revision_1.getAbyssTimeRevision)(eventId);
    if (revision === null)
        return null;
    const hasStaleRows = (0, db_1.getDb)().prepare(`
        SELECT 1 AS found
        FROM players_quest_progress
        WHERE player_id = ? AND section = ? AND quest_id BETWEEN ? AND ?
          AND (best_time_revision IS NULL OR best_time_revision != ?)
        LIMIT 1
    `).get(playerId, quest_1.QuestCategory.RUSH_EVENT, eventId * 1000 + 1, eventId * 1000 + (eventId === abyss_modes_1.ABYSS_EX_EVENT_ID ? 30 : 98), revision);
    if (!hasStaleRows)
        return revision;
    (0, persistence_coordinator_1.runPersistenceTransactionSync)({
        domain: "single-quest", playerId, operation: "refresh_abyss_best_times",
    }, () => (0, db_1.getDb)().prepare(`
            UPDATE players_quest_progress
            SET best_elapsed_time_ms = NULL, best_time_revision = ?
            WHERE player_id = ? AND section = ? AND quest_id BETWEEN ? AND ?
              AND (best_time_revision IS NULL OR best_time_revision != ?)
        `).run(revision, playerId, quest_1.QuestCategory.RUSH_EVENT, eventId * 1000 + 1, eventId * 1000 + (eventId === abyss_modes_1.ABYSS_EX_EVENT_ID ? 30 : 98), revision));
    return revision;
}
exports.refreshPlayerAbyssBestTimesSync = refreshPlayerAbyssBestTimesSync;
