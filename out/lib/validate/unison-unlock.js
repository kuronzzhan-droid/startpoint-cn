"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UnisonUnlockValidator = exports.repairUnisonUnlockProgressSync = exports.getUnisonUnlockRepairStatusSync = void 0;
const db_1 = require("../../data/db");
const MAIN_QUEST_SECTION = 1;
const UNISON_UNLOCK_QUEST_ID = 1006001;
const FIRST_QUEST_AFTER_UNISON_UNLOCK = 1006002;
/**
 * A finished 1-6-1 row is the authoritative unison unlock record. Only a
 * completed later main quest is accepted as evidence that a missing or
 * unfinished 1-6-1 row is damaged legacy data.
 */
function getUnisonUnlockRepairStatusSync(playerId) {
    const progress = (0, db_1.getDb)().prepare(`
        SELECT finished
        FROM players_quest_progress
        WHERE player_id = ?
          AND section = ?
          AND quest_id = ?
    `).get(playerId, MAIN_QUEST_SECTION, UNISON_UNLOCK_QUEST_ID);
    if ((progress === null || progress === void 0 ? void 0 : progress.finished) === 1)
        return "already_unlocked";
    const laterCompletedQuest = (0, db_1.getDb)().prepare(`
        SELECT 1
        FROM players_quest_progress
        WHERE player_id = ?
          AND section = ?
          AND quest_id >= ?
          AND finished = 1
        LIMIT 1
    `).get(playerId, MAIN_QUEST_SECTION, FIRST_QUEST_AFTER_UNISON_UNLOCK);
    return laterCompletedQuest ? "needs_repair" : "not_eligible";
}
exports.getUnisonUnlockRepairStatusSync = getUnisonUnlockRepairStatusSync;
/**
 * Repairs only the authoritative 1-6-1 completion bit. Tutorial hints,
 * multiplayer host completion, explicit unlocked flags and clear rank are
 * independent state and must not be fabricated by this compatibility repair.
 */
function repairUnisonUnlockProgressSync(playerId) {
    const db = (0, db_1.getDb)();
    const result = db.prepare(`
        INSERT INTO players_quest_progress (
            section,
            quest_id,
            finished,
            player_id
        )
        SELECT ?, ?, 1, ?
        WHERE EXISTS (
            SELECT 1
            FROM players_quest_progress
            WHERE player_id = ?
              AND section = ?
              AND quest_id >= ?
              AND finished = 1
        )
        ON CONFLICT(section, quest_id, player_id) DO UPDATE SET
            finished = 1
        WHERE players_quest_progress.finished = 0
          AND EXISTS (
            SELECT 1
            FROM players_quest_progress AS later_progress
            WHERE later_progress.player_id = players_quest_progress.player_id
              AND later_progress.section = ?
              AND later_progress.quest_id >= ?
              AND later_progress.finished = 1
        )
    `).run(MAIN_QUEST_SECTION, UNISON_UNLOCK_QUEST_ID, playerId, playerId, MAIN_QUEST_SECTION, FIRST_QUEST_AFTER_UNISON_UNLOCK, MAIN_QUEST_SECTION, FIRST_QUEST_AFTER_UNISON_UNLOCK);
    const changes = result.changes;
    if (changes > 0) {
        console.log(`[UNISON_UNLOCK] repaired player=${playerId} `
            + `quest=${UNISON_UNLOCK_QUEST_ID} finished=1`);
    }
    return changes;
}
exports.repairUnisonUnlockProgressSync = repairUnisonUnlockProgressSync;
exports.UnisonUnlockValidator = {
    name: "unison-unlock",
    version: 1,
    validate: repairUnisonUnlockProgressSync
};
