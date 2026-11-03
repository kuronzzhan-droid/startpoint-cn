"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.repairAllGauntletCompletionClassificationsSync = exports.repairGauntletCompletionClassificationSync = void 0;
const db_1 = require("../data/db");
const types_1 = require("./types");
const GAUNTLET_COMPLETION_RULES = {
    700098: {
        firstRegularQuestId: 700098001,
        lastRegularQuestId: 700098015,
        completionQuestId: 700098016,
    },
    700099: {
        firstRegularQuestId: 700099001,
        lastRegularQuestId: 700099030,
        completionQuestId: 700099099,
    },
    700100: {
        firstRegularQuestId: 700100001,
        lastRegularQuestId: 700100030,
        completionQuestId: 700100099,
    },
};
/**
 * Preserve the native EventFolder "completed" classification without making
 * the optional practice/endless battle part of the required finite run.
 *
 * This row is historical UI state only. Current practice/endless rounds remain
 * driven by players_rush_events and players_rush_events_played_parties.
 */
function repairGauntletCompletionClassificationSync(playerId, eventId) {
    var _a, _b, _c, _d;
    const rule = GAUNTLET_COMPLETION_RULES[eventId];
    if (rule === undefined)
        return false;
    const expectedRegularQuestCount = rule.lastRegularQuestId - rule.firstRegularQuestId + 1;
    const regularProgress = (0, db_1.getDb)().prepare(`
        SELECT COUNT(*) AS cleared_quest_count
        FROM players_quest_progress
        WHERE player_id = ?
          AND section = ?
          AND quest_id BETWEEN ? AND ?
          AND finished = 1
    `).get(playerId, Number(types_1.QuestCategory.RUSH_EVENT), rule.firstRegularQuestId, rule.lastRegularQuestId);
    if (Number((_a = regularProgress === null || regularProgress === void 0 ? void 0 : regularProgress.cleared_quest_count) !== null && _a !== void 0 ? _a : 0) !== expectedRegularQuestCount) {
        return false;
    }
    const completionProgress = (0, db_1.getDb)().prepare(`
        SELECT finished, unlocked, clear_rank
        FROM players_quest_progress
        WHERE player_id = ? AND section = ? AND quest_id = ?
    `).get(playerId, Number(types_1.QuestCategory.RUSH_EVENT), rule.completionQuestId);
    const isClassifiedAsCompleted = Number((_b = completionProgress === null || completionProgress === void 0 ? void 0 : completionProgress.finished) !== null && _b !== void 0 ? _b : 0) === 1
        && Number((_c = completionProgress === null || completionProgress === void 0 ? void 0 : completionProgress.unlocked) !== null && _c !== void 0 ? _c : 0) === 1
        && Number((_d = completionProgress === null || completionProgress === void 0 ? void 0 : completionProgress.clear_rank) !== null && _d !== void 0 ? _d : 0) >= 5;
    if (isClassifiedAsCompleted)
        return false;
    (0, db_1.getDb)().prepare(`
        INSERT INTO players_quest_progress (
            section, quest_id, finished, host_finished, unlocked,
            high_score, clear_rank, best_elapsed_time_ms,
            leader_character_id, multi_clear_count,
            s_plus_reward_received, player_id
        ) VALUES (?, ?, 1, 0, 1, NULL, 5, NULL, NULL, 0, 0, ?)
        ON CONFLICT(section, quest_id, player_id) DO UPDATE SET
            finished = 1,
            unlocked = 1,
            clear_rank = MAX(COALESCE(players_quest_progress.clear_rank, 0), 5)
    `).run(Number(types_1.QuestCategory.RUSH_EVENT), rule.completionQuestId, playerId);
    return true;
}
exports.repairGauntletCompletionClassificationSync = repairGauntletCompletionClassificationSync;
function repairAllGauntletCompletionClassificationsSync(playerId) {
    return Object.keys(GAUNTLET_COMPLETION_RULES)
        .map(Number)
        .filter(eventId => repairGauntletCompletionClassificationSync(playerId, eventId));
}
exports.repairAllGauntletCompletionClassificationsSync = repairAllGauntletCompletionClassificationsSync;
