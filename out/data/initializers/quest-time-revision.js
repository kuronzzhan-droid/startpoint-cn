"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initializeQuestTimeRevision = void 0;
/** Existing saves keep their clear/reward state; legacy times have no revision. */
function initializeQuestTimeRevision(database) {
    const columns = database.prepare("PRAGMA table_info(players_quest_progress)")
        .all();
    if (!columns.some(column => column.name === "best_time_revision")) {
        database.exec("ALTER TABLE players_quest_progress ADD COLUMN best_time_revision TEXT");
    }
    const activeColumns = database.prepare("PRAGMA table_info(players_active_quests)")
        .all();
    if (!activeColumns.some(column => column.name === "quest_time_revision")) {
        database.exec("ALTER TABLE players_active_quests ADD COLUMN quest_time_revision TEXT");
    }
}
exports.initializeQuestTimeRevision = initializeQuestTimeRevision;
