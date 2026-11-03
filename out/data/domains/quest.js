"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.insertPlayerDrawnQuestsSync = exports.getPlayerDrawnQuestsSync = exports.incrementPlayerQuestMultiClearSync = exports.updatePlayerQuestProgressSync = exports.insertPlayerQuestProgressListSync = exports.insertPlayerQuestProgressSync = exports.getPlayerQuestProgressBySectionAndIdsSync = exports.getPlayerSingleQuestProgressSync = exports.countFinishedPlayerQuestsSync = exports.countFinishedPlayerQuestsByCategorySync = exports.getPlayerQuestProgressSubsetSync = exports.getPlayerSingleQuestHistorySummarySync = exports.getPlayerQuestProgressSync = void 0;
const load_snapshot_1 = require("../readers/load-snapshot");
const cached_statement_1 = require("../../lib/cached-statement");
const db_1 = require("../db");
const utils_1 = require("../utils");
const abyss_time_revision_1 = require("./abyss-time-revision");
const abyss_modes_1 = require("../../lib/abyss-modes");
const abyss_time_revision_2 = require("../../lib/abyss-time-revision");
const persistence_coordinator_1 = require("../../lib/persistence-coordinator");
/**
 * Converts a RawPlayerQuestProgress object into a PlayerQuestProgress object.
 *
 * @param raw The raw object to convert.
 * @returns The converted object.
 */
/**
 * Gets a player's overall quest progressfrom the database.
 *
 * @param playerId The player's ID.
 * @returns A record where the index is the section and the value is a list of PlayerQuestProgress.
 */
function getPlayerQuestProgressSync(playerId) {
    (0, abyss_time_revision_1.refreshPlayerAbyssBestTimesSync)(playerId);
    return (0, load_snapshot_1.readPlayerQuestProgressSync)((0, db_1.getDb)(), playerId);
}
exports.getPlayerQuestProgressSync = getPlayerQuestProgressSync;
/** Historical single-only facts; shared single/co-op categories cannot prove the mode. */
function getPlayerSingleQuestHistorySummarySync(playerId) {
    (0, abyss_time_revision_1.refreshPlayerAbyssBestTimesSync)(playerId);
    return (0, cached_statement_1.cachedStatement)((0, db_1.getDb)(), `
        SELECT MIN(CASE WHEN finished = 1 AND best_elapsed_time_ms > 0
                       AND best_elapsed_time_ms <= 1.7976931348623157e308
                       THEN best_elapsed_time_ms END) AS bestElapsedTimeMs,
               MAX(0, COALESCE(MAX(high_score), 0)) AS highScore,
               COALESCE(SUM(CASE WHEN finished = 1 AND clear_rank = 5 THEN 1 ELSE 0 END), 0) AS ssCount
        FROM players_quest_progress
        WHERE player_id = ? AND section NOT IN (2, 8, 19, 26)
    `).get(playerId);
}
exports.getPlayerSingleQuestHistorySummarySync = getPlayerSingleQuestHistorySummarySync;
/**
 * Reads only the quest rows needed by an Active Mission reconciliation.
 * Section 4 ids are accepted in either stored or 10,000,000-offset form.
 */
function getPlayerQuestProgressSubsetSync(playerId, scope) {
    var _a, _b, _c;
    (0, abyss_time_revision_1.refreshPlayerAbyssBestTimesSync)(playerId);
    const sections = [...new Set(((_a = scope.sections) !== null && _a !== void 0 ? _a : [])
            .map(Number)
            .filter(value => Number.isSafeInteger(value) && value >= 0))];
    const requestedQuestIds = [...new Set(((_b = scope.questIds) !== null && _b !== void 0 ? _b : [])
            .map(Number)
            .filter(value => Number.isSafeInteger(value) && value >= 0))];
    const storedQuestIds = [...new Set(requestedQuestIds.flatMap(questId => (questId >= 10000000 ? [questId, questId - 10000000] : [questId])))];
    if (sections.length === 0 && storedQuestIds.length === 0)
        return {};
    const rows = new Map();
    const remember = (raw) => {
        rows.set(`${raw.section}:${raw.quest_id}`, raw);
    };
    const columns = `section, quest_id, finished, host_finished, unlocked, high_score,
        clear_rank, best_elapsed_time_ms, leader_character_id, multi_clear_count,
        s_plus_reward_received`;
    if (sections.length > 0) {
        const placeholders = sections.map(() => "?").join(", ");
        const found = (0, cached_statement_1.cachedStatement)((0, db_1.getDb)(), `
            SELECT ${columns}
            FROM players_quest_progress
            WHERE player_id = ? AND section IN (${placeholders})
        `).all(playerId, ...sections);
        for (const raw of found)
            remember(raw);
    }
    // Keep comfortably below SQLite builds with a 999-variable default.
    for (let offset = 0; offset < storedQuestIds.length; offset += 400) {
        const chunk = storedQuestIds.slice(offset, offset + 400);
        const placeholders = chunk.map(() => "?").join(", ");
        const found = (0, cached_statement_1.cachedStatement)((0, db_1.getDb)(), `
            SELECT ${columns}
            FROM players_quest_progress
            WHERE player_id = ? AND quest_id IN (${placeholders})
        `).all(playerId, ...chunk);
        for (const raw of found)
            remember(raw);
    }
    const mapped = {};
    for (const raw of rows.values()) {
        const section = String(raw.section);
        ((_c = mapped[section]) !== null && _c !== void 0 ? _c : (mapped[section] = [])).push((0, load_snapshot_1.buildPlayerQuestProgress)(raw));
    }
    return mapped;
}
exports.getPlayerQuestProgressSubsetSync = getPlayerQuestProgressSubsetSync;
function countFinishedPlayerQuestsByCategorySync(playerId, category) {
    const row = (0, cached_statement_1.cachedStatement)((0, db_1.getDb)(), `
    SELECT COUNT(*) AS count
    FROM players_quest_progress
    WHERE player_id = ? AND section = ? AND finished = 1
    `).get(playerId, category);
    const count = Number(row === null || row === void 0 ? void 0 : row.count);
    return Number.isSafeInteger(count) && count >= 0 ? count : 0;
}
exports.countFinishedPlayerQuestsByCategorySync = countFinishedPlayerQuestsByCategorySync;
function countFinishedPlayerQuestsSync(playerId) {
    const row = (0, cached_statement_1.cachedStatement)((0, db_1.getDb)(), `
    SELECT COUNT(*) AS count
    FROM players_quest_progress
    WHERE player_id = ? AND finished = 1
    `).get(playerId);
    const count = Number(row === null || row === void 0 ? void 0 : row.count);
    return Number.isSafeInteger(count) && count >= 0 ? count : 0;
}
exports.countFinishedPlayerQuestsSync = countFinishedPlayerQuestsSync;
/**
 * Gets the progress of a singular quest for a player..
 *
 * @param playerId The ID of the player.
 * @param section The section of the quest.
 * @param questId The ID of the quest.
 * @returns The quest's progress data, or null if it doesn't exist.
 */
function getPlayerSingleQuestProgressSync(playerId, section, questId) {
    const abyssEventId = (0, abyss_time_revision_2.isAbyssFiniteQuest)(section, questId)
        ? (0, abyss_modes_1.abyssEventFromQuest)(section, questId)
        : null;
    if (abyssEventId !== null)
        (0, abyss_time_revision_1.refreshPlayerAbyssBestTimesSync)(playerId, abyssEventId);
    const rawProgress = (0, cached_statement_1.cachedStatement)((0, db_1.getDb)(), `
    SELECT section, quest_id, finished, host_finished, unlocked, high_score, clear_rank, best_elapsed_time_ms, leader_character_id, multi_clear_count, s_plus_reward_received
    FROM players_quest_progress
    WHERE player_id = ? AND section = ? AND quest_id = ?
    `).get(playerId, Number(section), Number(questId));
    if (rawProgress === undefined)
        return null;
    return (0, load_snapshot_1.buildPlayerQuestProgress)(rawProgress);
}
exports.getPlayerSingleQuestProgressSync = getPlayerSingleQuestProgressSync;
/** Reads exact ids in one section without broadening to other quest categories. */
function getPlayerQuestProgressBySectionAndIdsSync(playerId, section, questIds) {
    const sectionId = Number(section);
    const ids = [...new Set(questIds)].filter(id => Number.isSafeInteger(id) && id >= 0);
    if (!Number.isSafeInteger(sectionId) || sectionId < 0 || ids.length === 0)
        return [];
    if (ids.some(id => (0, abyss_time_revision_2.isAbyssFiniteQuest)(sectionId, id)))
        (0, abyss_time_revision_1.refreshPlayerAbyssBestTimesSync)(playerId);
    const result = [];
    for (let offset = 0; offset < ids.length; offset += 400) {
        const chunk = ids.slice(offset, offset + 400);
        const rows = (0, cached_statement_1.cachedStatement)((0, db_1.getDb)(), `
            SELECT section, quest_id, finished, host_finished, unlocked, high_score, clear_rank,
                best_elapsed_time_ms, leader_character_id, multi_clear_count, s_plus_reward_received
            FROM players_quest_progress
            WHERE player_id = ? AND section = ? AND quest_id IN (${chunk.map(() => "?").join(", ")})
        `).all(playerId, sectionId, ...chunk);
        result.push(...rows.map(load_snapshot_1.buildPlayerQuestProgress));
    }
    return result;
}
exports.getPlayerQuestProgressBySectionAndIdsSync = getPlayerQuestProgressBySectionAndIdsSync;
/**
 * Inserts a singular quest progress into the database.
 *
 * @param playerId The ID of the player.
 * @param section The section that this quest progress belongs to.
 * @param data The data of this quest progress.
 */
function insertPlayerQuestProgressSync(playerId, section, data) {
    var _a, _b, _c, _d, _e, _f, _g;
    const timeRevision = (0, abyss_time_revision_2.isAbyssFiniteQuest)(section, data.questId)
        ? (0, abyss_time_revision_1.refreshPlayerAbyssBestTimesSync)(playerId, Math.floor(data.questId / 1000)) : null;
    (0, cached_statement_1.cachedStatement)((0, db_1.getDb)(), `
    INSERT INTO players_quest_progress (section, quest_id, finished, host_finished, unlocked, high_score, clear_rank, best_elapsed_time_ms, leader_character_id, s_plus_reward_received, player_id, best_time_revision)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(Number(section), data.questId, (0, utils_1.serializeBoolean)(data.finished), (0, utils_1.serializeBoolean)((_a = data.hostFinished) !== null && _a !== void 0 ? _a : false), (0, utils_1.serializeBoolean)((_b = data.unlocked) !== null && _b !== void 0 ? _b : false), (_c = data.highScore) !== null && _c !== void 0 ? _c : null, (_d = data.clearRank) !== null && _d !== void 0 ? _d : null, (_e = data.bestElapsedTimeMs) !== null && _e !== void 0 ? _e : null, (_f = data.leaderCharacterId) !== null && _f !== void 0 ? _f : null, (0, utils_1.serializeBoolean)((_g = data.sPlusRewardReceived) !== null && _g !== void 0 ? _g : false), playerId, timeRevision);
}
exports.insertPlayerQuestProgressSync = insertPlayerQuestProgressSync;
/**
 * Batch inserts a record of quest progress into the database.
 *
 * @param playerId The player's ID.
 * @param progressList The record of quest progress.
 */
function insertPlayerQuestProgressListSync(playerId, progressList) {
    (0, persistence_coordinator_1.runPersistenceTransactionSync)({ domain: "single-quest", playerId, operation: "insert_quest_progress_list" }, () => {
        for (const [section, progresses] of Object.entries(progressList)) {
            for (const progress of progresses) {
                insertPlayerQuestProgressSync(playerId, section, progress);
            }
        }
    });
}
exports.insertPlayerQuestProgressListSync = insertPlayerQuestProgressListSync;
/**
 * Updates the progress for a single player's quest.
 *
 * @param playerId The ID of the player.
 * @param section The section that the quest belongs to.
 * @param data The partial data of the quest progress to update.
 */
function updatePlayerQuestProgressSync(playerId, section, data) {
    if ((0, abyss_time_revision_2.isAbyssFiniteQuest)(section, data.questId))
        (0, abyss_time_revision_1.refreshPlayerAbyssBestTimesSync)(playerId);
    const fieldMap = {
        'finished': 'finished',
        'hostFinished': 'host_finished',
        'unlocked': 'unlocked',
        'highScore': 'high_score',
        'clearRank': 'clear_rank',
        'bestElapsedTimeMs': 'best_elapsed_time_ms',
        'leaderCharacterId': 'leader_character_id',
        'sPlusRewardReceived': 's_plus_reward_received'
    };
    const sets = [];
    const values = [];
    for (const key in data) {
        const value = data[key];
        const mapped = fieldMap[key];
        if (mapped && value !== undefined) {
            sets.push(`${mapped} = ?`);
            if (typeof (value) === "boolean") {
                values.push((0, utils_1.serializeBoolean)(value));
            }
            else {
                values.push(value);
            }
        }
    }
    if (sets.length > 0)
        (0, cached_statement_1.cachedStatement)((0, db_1.getDb)(), `
        UPDATE players_quest_progress
        SET ${sets.join(', ')}
        WHERE section = ? AND quest_id = ? AND player_id = ?
        `).run([...values, Number(section), data.questId, playerId]);
}
exports.updatePlayerQuestProgressSync = updatePlayerQuestProgressSync;
function incrementPlayerQuestMultiClearSync(playerId, section, questId) {
    (0, cached_statement_1.cachedStatement)((0, db_1.getDb)(), `
    UPDATE players_quest_progress
    SET multi_clear_count = multi_clear_count + 1
    WHERE player_id = ? AND section = ? AND quest_id = ?
    `).run(playerId, Number(section), Number(questId));
}
exports.incrementPlayerQuestMultiClearSync = incrementPlayerQuestMultiClearSync;
/**
 * Converts a RawPlayerGachaInfo object into a PlayerGachaInfo object.
 *
 * @param rawInfo The raw object to convert.
 * @returns The converted object.
 */
/**
 * Gets a player's drawn quests list.
 *
 * @param playerId The player's ID.
 * @returns A list of the player's drawn quests.
 */
function getPlayerDrawnQuestsSync(playerId) {
    const rawQuests = (0, cached_statement_1.cachedStatement)((0, db_1.getDb)(), `
    SELECT category_id, quest_id, odds_id
    FROM players_drawn_quests
    WHERE player_id = ?
    `).all(playerId);
    return rawQuests.map(raw => {
        return {
            categoryId: raw.category_id,
            questId: raw.quest_id,
            oddsId: raw.odds_id
        };
    });
}
exports.getPlayerDrawnQuestsSync = getPlayerDrawnQuestsSync;
/**
 * Inserts a singular drawn quest into a player's data.
 *
 * @param playerId The ID of the player.
 * @param drawnQuest The drawn quest to insert.
 */
function insertPlayerDrawnQuestSync(playerId, drawnQuest) {
    (0, cached_statement_1.cachedStatement)((0, db_1.getDb)(), `
    INSERT INTO players_drawn_quests (category_id, quest_id, odds_id, player_id)
    VALUES (?, ?, ?, ?)
    `).run(drawnQuest.categoryId, drawnQuest.questId, drawnQuest.oddsId, playerId);
}
/**
 * Batch inserts a list of drawn quests into the database.
 *
 * @param playerId The ID of the player.
 * @param drawnQuests The list of drawn quests to insert.
 */
function insertPlayerDrawnQuestsSync(playerId, drawnQuests) {
    (0, persistence_coordinator_1.runPersistenceTransactionSync)({ domain: "single-quest", playerId, operation: "insert_drawn_quests" }, () => {
        for (const drawnQuest of drawnQuests) {
            insertPlayerDrawnQuestSync(playerId, drawnQuest);
        }
    });
}
exports.insertPlayerDrawnQuestsSync = insertPlayerDrawnQuestsSync;
/**
/**
/**
/**
 * Retrieves the missions that a player is currently completing.
 *
 * @param playerId The ID of the player.
 * @returns A record of each mission and its current progress.
 */
