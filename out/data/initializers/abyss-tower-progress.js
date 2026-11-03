"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initializeAbyssTowerProgress = void 0;
/** Optional in older V1/V2 saves; no historical clears or reward flags are removed. */
function initializeAbyssTowerProgress(database) {
    const columns = database.prepare("PRAGMA table_info(players_rush_events)").all();
    if (!columns.some(column => column.name === "tower_revision")) {
        database.exec("ALTER TABLE players_rush_events ADD COLUMN tower_revision TEXT");
    }
}
exports.initializeAbyssTowerProgress = initializeAbyssTowerProgress;
