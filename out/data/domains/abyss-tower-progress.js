"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.canStartAbyssQuestSync = exports.refreshPlayerAbyssTowersSync = exports.refreshPlayerAbyssTowerSync = exports.hasAbyssExUnlockSync = exports.getAbyssTowerResetRevision = void 0;
const db_1 = require("../db");
const types_1 = require("../types");
const abyss_modes_1 = require("../../lib/abyss-modes");
const abyss_time_revision_1 = require("../../lib/abyss-time-revision");
const version_1 = require("../../lib/version");
const quest_1 = require("../../lib/types/quest");
const service_1 = require("../../lib/leaderboard/service");
const persistence_coordinator_1 = require("../../lib/persistence-coordinator");
/** An explicit publication marker prevents ordinary asset updates from resetting runs. */
function getAbyssTowerResetRevision(eventId) {
    var _a, _b, _c, _d, _e, _f;
    if (!(0, abyss_modes_1.isAbyssEvent)(eventId))
        return null;
    const key = `rush:${eventId}`;
    const patches = (0, version_1.getPatchManifest)().patches.filter(patch => patch.enabled && patch.type === "patch");
    let winner = null;
    for (const patch of patches) {
        const preserved = (_a = patch.rush_tower_preserves) === null || _a === void 0 ? void 0 : _a[key];
        if (preserved !== undefined && (!/^[a-f0-9]{64}$/.test(preserved)
            || !/^[a-f0-9]{64}$/.test((_c = (_b = patch.quest_time_revisions) === null || _b === void 0 ? void 0 : _b[key]) !== null && _c !== void 0 ? _c : "")
            || ((_d = patch.rush_tower_resets) === null || _d === void 0 ? void 0 : _d[key]) !== undefined))
            throw new Error(`Invalid tower preservation marker for ${key} in ${patch.id}`);
        const revision = (_e = patch.rush_tower_resets) === null || _e === void 0 ? void 0 : _e[key];
        if (revision === undefined)
            continue;
        if (!/^[a-f0-9]{64}$/.test(revision) || ((_f = patch.quest_time_revisions) === null || _f === void 0 ? void 0 : _f[key]) !== revision)
            throw new Error(`Invalid tower reset marker for ${key} in ${patch.id}`);
        const order = winner === null ? 1 : (0, version_1.compareVersion)(patch.version, winner.version);
        if (order === 0 && winner.revision !== revision)
            throw new Error(`Conflicting tower reset markers for ${key}`);
        if (order > 0)
            winner = { version: patch.version, revision };
    }
    if (winner === null)
        return null;
    if ((0, abyss_time_revision_1.getAbyssTimeRevision)(eventId) !== winner.revision) {
        const timing = patches.filter(patch => { var _a; return ((_a = patch.quest_time_revisions) === null || _a === void 0 ? void 0 : _a[key]) !== undefined; })
            .sort((a, b) => (0, version_1.compareVersion)(b.version, a.version));
        const latest = timing.filter(patch => { var _a; return patch.version === ((_a = timing[0]) === null || _a === void 0 ? void 0 : _a.version); });
        // An explicit repair binds the new timing fingerprint to the existing run.
        // Missing, conflicting or obsolete declarations still fail closed.
        if (!latest.length || latest.some(patch => {
            var _a;
            return (0, version_1.compareVersion)(patch.version, winner.version) <= 0
                || ((_a = patch.rush_tower_preserves) === null || _a === void 0 ? void 0 : _a[key]) !== winner.revision;
        }))
            throw new Error(`Tower ${key} changed without a matching progress reset marker`);
    }
    return winner.revision;
}
exports.getAbyssTowerResetRevision = getAbyssTowerResetRevision;
/** Historical finite clear is permanent; restarting a run cannot relock EX. */
function hasAbyssExUnlockSync(playerId) {
    const db = (0, db_1.getDb)();
    return !!db.prepare(`SELECT 1 FROM players_rush_events_cleared_folders
        WHERE player_id=? AND event_id=? AND folder_id=1`).get(playerId, abyss_modes_1.ABYSS_NORMAL_EVENT_ID)
        || !!db.prepare(`SELECT 1 FROM players_quest_progress
        WHERE player_id=? AND section=? AND quest_id=? AND finished=1`)
            .get(playerId, quest_1.QuestCategory.RUSH_EVENT, abyss_modes_1.ABYSS_NORMAL_EVENT_ID * 1000 + 30);
}
exports.hasAbyssExUnlockSync = hasAbyssExUnlockSync;
function towerNeedsReset(playerId, eventId, revision) {
    const row = (0, db_1.getDb)().prepare(`SELECT tower_revision FROM players_rush_events
        WHERE player_id=? AND event_id=?`).get(playerId, eventId);
    return row !== undefined && row.tower_revision !== revision;
}
/** Only current finite-run state is reset. Clears, inventories and reward receipts survive. */
function refreshPlayerAbyssTowerSync(playerId, eventId) {
    const revision = getAbyssTowerResetRevision(eventId);
    if (revision === null)
        return false;
    // Avoid taking a write lock for an unchanged tower. Recheck under the
    // transaction before resetting: another writer may have refreshed it.
    if (!towerNeedsReset(playerId, eventId, revision))
        return false;
    const db = (0, db_1.getDb)();
    return (0, persistence_coordinator_1.runPersistenceTransactionSync)({ domain: "event", playerId, operation: "refresh_abyss_tower" }, () => {
        if (!towerNeedsReset(playerId, eventId, revision))
            return false;
        (0, service_1.resetLeaderboardCompetitionSync)(playerId, { category: quest_1.QuestCategory.RUSH_EVENT, eventId, folderId: 1 });
        db.prepare(`DELETE FROM players_rush_events_played_parties
            WHERE player_id=? AND event_id=? AND battle_type=?`).run(playerId, eventId, types_1.RushEventBattleType.FOLDER);
        db.prepare(`UPDATE players_rush_events SET active_rush_battle_folder_id=1, tower_revision=?
            WHERE player_id=? AND event_id=?`).run(revision, playerId, eventId);
        // Keep an old active battle's revision intact: settlement/load reject it as stale.
        return true;
    });
}
exports.refreshPlayerAbyssTowerSync = refreshPlayerAbyssTowerSync;
function refreshPlayerAbyssTowersSync(playerId) {
    // Preserve the atomic batch when any tower is stale; the common read-only
    // path needs neither a write transaction nor a nested savepoint.
    const needed = abyss_modes_1.ABYSS_EVENT_IDS.some(eventId => {
        const revision = getAbyssTowerResetRevision(eventId);
        return revision !== null && towerNeedsReset(playerId, eventId, revision);
    });
    if (!needed)
        return;
    (0, persistence_coordinator_1.runPersistenceTransactionSync)({ domain: "event", playerId, operation: "refresh_abyss_towers" }, () => {
        for (const eventId of abyss_modes_1.ABYSS_EVENT_IDS)
            refreshPlayerAbyssTowerSync(playerId, eventId);
    });
}
exports.refreshPlayerAbyssTowersSync = refreshPlayerAbyssTowersSync;
function canStartAbyssQuestSync(playerId, category, questId) {
    const eventId = (0, abyss_modes_1.abyssEventFromQuest)(category, questId);
    if (eventId === null)
        return true;
    if (eventId === abyss_modes_1.ABYSS_EX_EVENT_ID && !hasAbyssExUnlockSync(playerId))
        return false;
    refreshPlayerAbyssTowerSync(playerId, eventId);
    const round = questId % 1000;
    if (round === 99)
        return true; // native endless compatibility, never a finite round
    if (round < 1 || round > 30)
        return false;
    // Preserve the deployed normal tower until the split's first publication.
    if (eventId === abyss_modes_1.ABYSS_NORMAL_EVENT_ID && getAbyssTowerResetRevision(eventId) === null)
        return true;
    const rows = (0, db_1.getDb)().prepare(`SELECT round FROM players_rush_events_played_parties
        WHERE player_id=? AND event_id=? AND battle_type=? ORDER BY round`)
        .all(playerId, eventId, types_1.RushEventBattleType.FOLDER);
    let expected = 1;
    for (const row of rows) {
        if (row.round !== eventId * 1000 + expected)
            break;
        expected++;
    }
    return round === expected;
}
exports.canStartAbyssQuestSync = canStartAbyssQuestSync;
