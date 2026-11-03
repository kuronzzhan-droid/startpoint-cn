"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updatePlayerActiveMissionStageSync = exports.deletePlayerCategoryMissionsSync = exports.updatePlayerCategoryMissionStageBatchSync = exports.updatePlayerCategoryMissionStageSync = exports.incrementPlayerCategoryMissionSync = exports.updatePlayerCategoryMissionBatchSync = exports.updatePlayerCategoryMissionSync = exports.insertPlayerCategoryMissionListSync = exports.getPlayerClearedCollectItemEventMissionListSync = exports.getPlayerCategoryMissionListSync = exports.getPlayerCategoryMissionsForScopesSync = exports.getPlayerCategoryMissionsForCategoriesSync = exports.getPlayerCategoryMissionsSync = exports.incrementPlayerActiveMissionSync = exports.updatePlayerActiveMissionSync = exports.insertPlayerActiveMissionsSync = exports.getPlayerActiveMissionsSync = exports.insertPlayerClearedRegularMissionListSync = exports.getPlayerClearedRegularMissionListSync = void 0;
const cached_statement_1 = require("../../lib/cached-statement");
const db_1 = require("../db");
const utils_1 = require("../utils");
const persistence_coordinator_1 = require("../../lib/persistence-coordinator");
/**
 * Retrieve a list of a player's cleared regular missions.
 *
 * @param playerId The ID of the player.
 * @returns A record, where the index is the id of the mission and the value is ???.
 */
function getPlayerClearedRegularMissionListSync(playerId) {
    const raw = (0, cached_statement_1.cachedStatement)((0, db_1.getDb)(), `
    SELECT id, value
    FROM players_cleared_regular_missions
    WHERE player_id = ?
    `).all(playerId);
    const record = {};
    for (const rawClear of raw) {
        record[rawClear.id.toString()] = rawClear.value;
    }
    return record;
}
exports.getPlayerClearedRegularMissionListSync = getPlayerClearedRegularMissionListSync;
/**
 * Sets a regular mission as having been cleared by a player.
 *
 * @param playerId The ID of the player.
 * @param missionId The ID of the mission that was cleared.
 * @param value
 */
function insertPlayerClearedRegularMissionSync(playerId, missionId, value) {
    (0, cached_statement_1.cachedStatement)((0, db_1.getDb)(), `
    INSERT INTO players_cleared_regular_missions (id, value, player_id)
    VALUES (?, ?, ?)
    `).run(Number(missionId), value, playerId);
}
/**
 * Sets a list of regular missions as having been cleared by a player.
 *
 * @param playerId The ID of the player.
 * @param missionList The list of missions that were cleared.
 */
function insertPlayerClearedRegularMissionListSync(playerId, missionList) {
    (0, persistence_coordinator_1.runPersistenceTransactionSync)({ domain: "mission", playerId, operation: "insert_cleared_regular_missions" }, () => {
        for (const [missionId, value] of Object.entries(missionList)) {
            insertPlayerClearedRegularMissionSync(playerId, missionId, value);
        }
    });
}
exports.insertPlayerClearedRegularMissionListSync = insertPlayerClearedRegularMissionListSync;
/**
/**
/**
 * Inserts a singular item into the player's inventory.
 *
 * @param playerId The ID of the player.
 * @param itemId The ID of the item to insert.
 * @param amount The amount of the item to insert.
 */
function insertPlayerItemSync(playerId, itemId, amount) {
    (0, cached_statement_1.cachedStatement)((0, db_1.getDb)(), `
    INSERT INTO players_items (id, amount, player_id)
    VALUES (?, ?, ?)
    `).run(Number(itemId), amount, playerId);
}
/**
/**
/**
/**
 * Retrieves the missions that a player is currently completing.
 *
 * @param playerId The ID of the player.
 * @returns A record of each mission and its current progress.
 */
/**
 * Retrieves the missions that a player is currently completing.
 *
 * @param playerId The ID of the player.
 * @returns A record of each mission and its current progress.
 */
function getPlayerActiveMissionsSync(playerId) {
    const rawMissions = (0, cached_statement_1.cachedStatement)((0, db_1.getDb)(), `
    SELECT id, progress
    FROM players_active_missions
    WHERE player_id = ?
    `).all(playerId);
    const rawStages = (0, cached_statement_1.cachedStatement)((0, db_1.getDb)(), `
    SELECT id, status, mission_id
    FROM players_active_missions_stages
    WHERE player_id = ?
    `).all(playerId);
    const stageBuckets = {};
    for (const rawStage of rawStages) {
        const missionId = rawStage.mission_id.toString();
        let bucket = stageBuckets[missionId];
        if (!bucket) {
            bucket = {};
            stageBuckets[missionId] = bucket;
        }
        bucket[rawStage.id] = (0, utils_1.deserializeBoolean)(rawStage.status);
    }
    const final = {};
    for (const rawMission of rawMissions) {
        const id = rawMission.id.toString();
        final[id] = {
            progress: rawMission.progress,
            stages: stageBuckets[id] || []
        };
    }
    return final;
}
exports.getPlayerActiveMissionsSync = getPlayerActiveMissionsSync;
/**
 * Inserts the data for a singular active mission stage into the database.
 *
 * @param playerId The player's ID.
 * @param stageId The ID of the stage.
 * @param missionId The ID of the mission that this stage belongs to.
 * @param status The status of the stage.
 */
function insertPlayerActiveMissionStageSync(playerId, stageId, missionId, status) {
    (0, cached_statement_1.cachedStatement)((0, db_1.getDb)(), `
    INSERT INTO players_active_missions_stages (id, status, player_id, mission_id)
    VALUES (?, ?, ?, ?)   
    `).run(Number(stageId), (0, utils_1.serializeBoolean)(status), playerId, Number(missionId));
}
/**
 * Inserts a singular active mission into the database.
 *
 * @param playerId The player's iD>
 * @param missionId The ID of the mission to insert.
 * @param mission The mission's data.
 */
function insertPlayerActiveMissionSync(playerId, missionId, mission) {
    (0, cached_statement_1.cachedStatement)((0, db_1.getDb)(), `
    INSERT INTO players_active_missions (id, progress, player_id)
    VALUES (?, ?, ?)
    `).run(Number(missionId), mission.progress, playerId);
    const stages = mission.stages;
    if (stages) {
        for (const [stageId, stage] of Object.entries(stages)) {
            insertPlayerActiveMissionStageSync(playerId, stageId, missionId, stage);
        }
    }
}
/**
 * Batch inserts a record of active missions into the database.
 *
 * @param playerId The player's ID.
 * @param missions The record of active missions to insert.
 */
function insertPlayerActiveMissionsSync(playerId, missions) {
    (0, persistence_coordinator_1.runPersistenceTransactionSync)({ domain: "mission", playerId, operation: "insert_active_missions" }, () => {
        for (const [missionId, mission] of Object.entries(missions)) {
            insertPlayerActiveMissionSync(playerId, missionId, mission);
        }
    });
}
exports.insertPlayerActiveMissionsSync = insertPlayerActiveMissionsSync;
/**
 * Updates the progress value of a single active mission.
 */
function updatePlayerActiveMissionSync(playerId, missionId, progress) {
    (0, cached_statement_1.cachedStatement)((0, db_1.getDb)(), `
    INSERT INTO players_active_missions (id, progress, player_id)
    VALUES (?, ?, ?)
    ON CONFLICT(id, player_id) DO UPDATE SET progress = excluded.progress
    `).run(Number(missionId), progress, playerId);
}
exports.updatePlayerActiveMissionSync = updatePlayerActiveMissionSync;
/** Atomically adds a client-reported counter delta to a mission. */
function incrementPlayerActiveMissionSync(playerId, missionId, delta) {
    (0, cached_statement_1.cachedStatement)((0, db_1.getDb)(), `
    INSERT INTO players_active_missions (id, progress, player_id)
    VALUES (?, ?, ?)
    ON CONFLICT(id, player_id) DO UPDATE SET progress = progress + excluded.progress
    `).run(Number(missionId), delta, playerId);
}
exports.incrementPlayerActiveMissionSync = incrementPlayerActiveMissionSync;
/** Retrieves category-scoped mission progress without mixing equal IDs. */
function getPlayerCategoryMissionsSync(playerId, category, missionIds) {
    var _a, _b;
    const ids = missionIds === undefined ? undefined : [...new Set(missionIds)].filter(Number.isSafeInteger);
    if ((ids === null || ids === void 0 ? void 0 : ids.length) === 0)
        return {};
    const placeholders = ids === null || ids === void 0 ? void 0 : ids.map(() => "?").join(", ");
    const parameters = [playerId, category, ...(ids !== null && ids !== void 0 ? ids : [])];
    const missions = (0, cached_statement_1.cachedStatement)((0, db_1.getDb)(), `
    SELECT id, progress
    FROM players_category_missions
    WHERE player_id = ? AND category = ?
    ${ids ? `AND id IN (${placeholders})` : ""}
    `).all(...parameters);
    const stages = (0, cached_statement_1.cachedStatement)((0, db_1.getDb)(), `
    SELECT id, status, mission_id
    FROM players_category_mission_stages
    WHERE player_id = ? AND category = ?
    ${ids ? `AND mission_id IN (${placeholders})` : ""}
    `).all(...parameters);
    const stageBuckets = {};
    for (const stage of stages) {
        const missionId = String(stage.mission_id);
        const bucket = (_a = stageBuckets[missionId]) !== null && _a !== void 0 ? _a : {};
        bucket[String(stage.id)] = (0, utils_1.deserializeBoolean)(stage.status);
        stageBuckets[missionId] = bucket;
    }
    const result = {};
    for (const mission of missions) {
        result[String(mission.id)] = {
            progress: mission.progress,
            stages: (_b = stageBuckets[String(mission.id)]) !== null && _b !== void 0 ? _b : [],
        };
    }
    return result;
}
exports.getPlayerCategoryMissionsSync = getPlayerCategoryMissionsSync;
/** Retrieves several category buckets with two SQLite reads total. */
function getPlayerCategoryMissionsForCategoriesSync(playerId, categories) {
    var _a, _b;
    const uniqueCategories = [...new Set(categories.filter(Number.isSafeInteger))];
    if (uniqueCategories.length === 0)
        return {};
    const placeholders = uniqueCategories.map(() => "?").join(", ");
    const missions = (0, cached_statement_1.cachedStatement)((0, db_1.getDb)(), `
    SELECT category, id, progress
    FROM players_category_missions
    WHERE player_id = ? AND category IN (${placeholders})
    `).all(playerId, ...uniqueCategories);
    const stages = (0, cached_statement_1.cachedStatement)((0, db_1.getDb)(), `
    SELECT category, id, status, mission_id
    FROM players_category_mission_stages
    WHERE player_id = ? AND category IN (${placeholders})
    `).all(playerId, ...uniqueCategories);
    const stageBuckets = new Map();
    for (const stage of stages) {
        const missionKey = `${stage.category}:${stage.mission_id}`;
        const bucket = (_a = stageBuckets.get(missionKey)) !== null && _a !== void 0 ? _a : {};
        bucket[String(stage.id)] = (0, utils_1.deserializeBoolean)(stage.status);
        stageBuckets.set(missionKey, bucket);
    }
    const result = Object.fromEntries(uniqueCategories.map(category => [String(category), {}]));
    for (const mission of missions) {
        result[String(mission.category)][String(mission.id)] = {
            progress: mission.progress,
            stages: (_b = stageBuckets.get(`${mission.category}:${mission.id}`)) !== null && _b !== void 0 ? _b : [],
        };
    }
    return result;
}
exports.getPlayerCategoryMissionsForCategoriesSync = getPlayerCategoryMissionsForCategoriesSync;
/** Two fixed query plans, restricted to the mission IDs this settlement evaluates. */
function getPlayerCategoryMissionsForScopesSync(playerId, scopes) {
    var _a;
    const requested = new Map();
    for (const scope of scopes) {
        if (!Number.isSafeInteger(scope.category))
            continue;
        const ids = (_a = requested.get(scope.category)) !== null && _a !== void 0 ? _a : new Set();
        for (const id of scope.missionIds)
            if (Number.isSafeInteger(id))
                ids.add(id);
        requested.set(scope.category, ids);
    }
    const result = {};
    const pairs = [];
    for (const [category, ids] of requested) {
        result[String(category)] = {};
        for (const id of ids)
            pairs.push([category, id]);
    }
    if (pairs.length === 0)
        return result;
    const selection = JSON.stringify(pairs);
    const missions = (0, cached_statement_1.cachedStatement)((0, db_1.getDb)(), `
        SELECT m.category, m.id, m.progress
        FROM json_each(?) AS requested
        CROSS JOIN players_category_missions AS m
        WHERE m.category = CAST(json_extract(requested.value, '$[0]') AS INTEGER)
          AND m.id = CAST(json_extract(requested.value, '$[1]') AS INTEGER)
          AND m.player_id = ?
    `).all(selection, playerId);
    for (const mission of missions) {
        result[String(mission.category)][String(mission.id)] = { progress: mission.progress, stages: [] };
    }
    const stages = (0, cached_statement_1.cachedStatement)((0, db_1.getDb)(), `
        SELECT s.category, s.id, s.status, s.mission_id
        FROM json_each(?) AS requested
        CROSS JOIN players_category_mission_stages AS s
        WHERE s.category = CAST(json_extract(requested.value, '$[0]') AS INTEGER)
          AND s.mission_id = CAST(json_extract(requested.value, '$[1]') AS INTEGER)
          AND s.player_id = ?
    `).all(selection, playerId);
    for (const stage of stages) {
        const mission = result[String(stage.category)][String(stage.mission_id)];
        if (!mission)
            continue;
        if (Array.isArray(mission.stages))
            mission.stages = {};
        mission.stages[String(stage.id)] = (0, utils_1.deserializeBoolean)(stage.status);
    }
    return result;
}
exports.getPlayerCategoryMissionsForScopesSync = getPlayerCategoryMissionsForScopesSync;
function getPlayerCategoryMissionListSync(playerId) {
    const categories = (0, cached_statement_1.cachedStatement)((0, db_1.getDb)(), `
    SELECT DISTINCT category
    FROM players_category_missions
    WHERE player_id = ?
    ORDER BY category
    `).all(playerId);
    return getPlayerCategoryMissionsForCategoriesSync(playerId, categories.map(({ category }) => category));
}
exports.getPlayerCategoryMissionListSync = getPlayerCategoryMissionListSync;
function getPlayerClearedCollectItemEventMissionListSync(playerId) {
    const rows = (0, cached_statement_1.cachedStatement)((0, db_1.getDb)(), `
    SELECT mission_id, MAX(id) AS stage
    FROM players_category_mission_stages
    WHERE player_id = ? AND category = 4 AND status = 1
    GROUP BY mission_id
    ORDER BY mission_id
    `).all(playerId);
    return Object.fromEntries(rows.map(row => [String(row.mission_id), row.stage]));
}
exports.getPlayerClearedCollectItemEventMissionListSync = getPlayerClearedCollectItemEventMissionListSync;
function insertPlayerCategoryMissionListSync(playerId, categories) {
    (0, persistence_coordinator_1.runPersistenceTransactionSync)({ domain: "mission", playerId, operation: "insert_category_missions" }, () => {
        for (const [categoryKey, missions] of Object.entries(categories)) {
            const category = Number(categoryKey);
            if (!Number.isInteger(category))
                continue;
            for (const [missionId, mission] of Object.entries(missions)) {
                updatePlayerCategoryMissionSync(playerId, category, missionId, mission.progress);
                if (!mission.stages || Array.isArray(mission.stages))
                    continue;
                for (const [stageId, received] of Object.entries(mission.stages)) {
                    updatePlayerCategoryMissionStageSync(playerId, category, stageId, missionId, received);
                }
            }
        }
    });
}
exports.insertPlayerCategoryMissionListSync = insertPlayerCategoryMissionListSync;
function updatePlayerCategoryMissionSync(playerId, category, missionId, progress) {
    (0, cached_statement_1.cachedStatement)((0, db_1.getDb)(), `
    INSERT INTO players_category_missions (category, id, progress, player_id)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(category, id, player_id) DO UPDATE SET progress = excluded.progress
    `).run(category, Number(missionId), progress, playerId);
}
exports.updatePlayerCategoryMissionSync = updatePlayerCategoryMissionSync;
function updatePlayerCategoryMissionBatchSync(playerId, updates) {
    if (updates.length === 0)
        return;
    const statement = (0, cached_statement_1.cachedStatement)((0, db_1.getDb)(), `
    INSERT INTO players_category_missions (category, id, progress, player_id)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(category, id, player_id) DO UPDATE SET progress = excluded.progress
    `);
    for (const update of updates) {
        statement.run(update.category, update.missionId, update.progress, playerId);
    }
}
exports.updatePlayerCategoryMissionBatchSync = updatePlayerCategoryMissionBatchSync;
function incrementPlayerCategoryMissionSync(playerId, category, missionId, delta) {
    (0, cached_statement_1.cachedStatement)((0, db_1.getDb)(), `
    INSERT INTO players_category_missions (category, id, progress, player_id)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(category, id, player_id) DO UPDATE SET progress = progress + excluded.progress
    `).run(category, Number(missionId), delta, playerId);
}
exports.incrementPlayerCategoryMissionSync = incrementPlayerCategoryMissionSync;
function updatePlayerCategoryMissionStageSync(playerId, category, stageId, missionId, status) {
    (0, cached_statement_1.cachedStatement)((0, db_1.getDb)(), `
    INSERT INTO players_category_mission_stages (category, id, status, player_id, mission_id)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(category, id, mission_id, player_id) DO UPDATE SET status = excluded.status
    `).run(category, Number(stageId), (0, utils_1.serializeBoolean)(status), playerId, Number(missionId));
}
exports.updatePlayerCategoryMissionStageSync = updatePlayerCategoryMissionStageSync;
function updatePlayerCategoryMissionStageBatchSync(playerId, updates) {
    if (updates.length === 0)
        return;
    const statement = (0, cached_statement_1.cachedStatement)((0, db_1.getDb)(), `
    INSERT INTO players_category_mission_stages (category, id, status, player_id, mission_id)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(category, id, mission_id, player_id) DO UPDATE SET status = excluded.status
    `);
    for (const update of updates) {
        statement.run(update.category, update.stageId, (0, utils_1.serializeBoolean)(update.status), playerId, update.missionId);
    }
}
exports.updatePlayerCategoryMissionStageBatchSync = updatePlayerCategoryMissionStageBatchSync;
function deletePlayerCategoryMissionsSync(playerId, category) {
    (0, persistence_coordinator_1.runPersistenceTransactionSync)({ domain: "mission", playerId, operation: "delete_category_missions" }, () => {
        (0, cached_statement_1.cachedStatement)((0, db_1.getDb)(), `DELETE FROM players_category_mission_stages WHERE player_id = ? AND category = ?`).run(playerId, category);
        (0, cached_statement_1.cachedStatement)((0, db_1.getDb)(), `DELETE FROM players_category_missions WHERE player_id = ? AND category = ?`).run(playerId, category);
    });
}
exports.deletePlayerCategoryMissionsSync = deletePlayerCategoryMissionsSync;
/**
 * Updates the status of a single active mission stage (claimed/unclaimed).
 */
function updatePlayerActiveMissionStageSync(playerId, stageId, missionId, status) {
    (0, cached_statement_1.cachedStatement)((0, db_1.getDb)(), `
    INSERT OR REPLACE INTO players_active_missions_stages (id, status, player_id, mission_id)
    VALUES (?, ?, ?, ?)
    `).run(Number(stageId), (0, utils_1.serializeBoolean)(status), playerId, Number(missionId));
}
exports.updatePlayerActiveMissionStageSync = updatePlayerActiveMissionStageSync;
