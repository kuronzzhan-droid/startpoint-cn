"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.settleAwakeMissionRewards = exports.settleAwakeMissionCandidates = exports.getAwakeBattleMissionIds = void 0;
const character_awake_1 = require("../../data/domains/character_awake");
const mission_1 = require("../../data/domains/mission");
const player_1 = require("../../data/domains/player");
const character_helpers_1 = require("../character-helpers");
const grants_1 = require("./grants");
const rewards_1 = require("./rewards");
const stages_1 = require("./stages");
const stages_2 = require("./stages");
const character_queries_1 = require("./character-queries");
const registry_1 = require("./registry");
const request_diagnostics_1 = require("../request-diagnostics");
const persistence_coordinator_1 = require("../persistence-coordinator");
function getAwakeBattleMissionIds(characterIds, directlyChangedMissionIds = []) {
    const targetCharacterIds = new Set(characterIds.filter(characterId => Number.isSafeInteger(characterId) && characterId > 0));
    const missionIds = new Set(directlyChangedMissionIds.filter(missionId => Number.isSafeInteger(missionId) && missionId > 0));
    for (const missionId of (0, stages_2.getMissionIdsByCategory)(9)) {
        if (targetCharacterIds.has(Number((0, character_queries_1.getCharacterIdFromMission)(missionId)))) {
            missionIds.add(missionId);
        }
    }
    return [...missionIds];
}
exports.getAwakeBattleMissionIds = getAwakeBattleMissionIds;
function settleAwakeMissionCandidates(playerId, missionIds, evaluationTime) {
    var _a;
    const uniqueMissionIds = [...new Set(missionIds)];
    if (uniqueMissionIds.length === 0) {
        return {
            missionInfo: [], itemList: {}, characterList: [], equipmentList: [],
            degreeIds: [], passCardPoints: {},
        };
    }
    const computer = (0, registry_1.getComputer)(9);
    const context = computer.buildContext(playerId, 9, evaluationTime, uniqueMissionIds);
    const persisted = (_a = context.persistedMissions) !== null && _a !== void 0 ? _a : (0, mission_1.getPlayerCategoryMissionsSync)(playerId, 9, uniqueMissionIds);
    const progressList = uniqueMissionIds.map(missionId => {
        var _a, _b;
        const dbProgress = (_b = (_a = persisted[String(missionId)]) === null || _a === void 0 ? void 0 : _a.progress) !== null && _b !== void 0 ? _b : 0;
        const computed = computer.compute(missionId, context, dbProgress);
        const monotonicProgress = Math.max(0, dbProgress, Number.isFinite(computed) ? computed : 0);
        const finalTarget = (0, stages_2.getMissionFinalTargetProgress)(9, missionId);
        return {
            missionId,
            progress: finalTarget === undefined
                ? monotonicProgress
                : Math.min(monotonicProgress, finalTarget),
        };
    });
    return settleAwakeMissionRewards(playerId, progressList, persisted);
}
exports.settleAwakeMissionCandidates = settleAwakeMissionCandidates;
function settleAwakeMissionRewards(playerId, progressList, missionSnapshot) {
    const progressByMissionId = new Map();
    for (const entry of progressList) {
        const currentProgress = progressByMissionId.get(entry.missionId);
        if (currentProgress === undefined || entry.progress > currentProgress) {
            progressByMissionId.set(entry.missionId, entry.progress);
        }
    }
    const player = (0, player_1.getPlayerSync)(playerId);
    if (!player)
        throw new Error(`Player ${playerId} not found during CharacterAwake settlement.`);
    const ownedIds = (0, character_awake_1.getOwnedAwakeCharacterIdsSync)(playerId, [...progressByMissionId.keys()].map(id => Number((0, character_queries_1.getCharacterIdFromMission)(id))));
    // Fixed parties and old saves can contain progress for unowned characters.
    // Keep that progress intact and rewards pending until the character is owned.
    for (const missionId of progressByMissionId.keys()) {
        const characterId = Number((0, character_queries_1.getCharacterIdFromMission)(missionId));
        if (!ownedIds.has(characterId)) {
            progressByMissionId.delete(missionId);
            (0, request_diagnostics_1.recordUnownedAwakeMission)(missionId, characterId);
        }
    }
    if (progressByMissionId.size === 0)
        return {
            missionInfo: [], itemList: {}, characterList: [], equipmentList: [], degreeIds: [], passCardPoints: {},
        };
    const aggregatedProgressList = [...progressByMissionId].map(([missionId, progress]) => ({ missionId, progress }));
    const persistedMissions = missionSnapshot !== null && missionSnapshot !== void 0 ? missionSnapshot : (0, mission_1.getPlayerCategoryMissionsSync)(playerId, 9, [...progressByMissionId.keys()]);
    const granter = new grants_1.MissionRewardGranter(playerId, player);
    const missionInfo = [];
    const unlockCandidateCharacterIds = aggregatedProgressList.map(entry => Number((0, character_queries_1.getCharacterIdFromMission)(entry.missionId)));
    // Publish the scoped authoritative state on retries, including higher levels
    // already saved. The mission route no longer needs a second reconciliation.
    const unlockMap = (0, character_awake_1.getPlayerCharacterAwakeUnlocksByCharacterIdsSync)(playerId, unlockCandidateCharacterIds);
    (0, persistence_coordinator_1.runPersistenceTransactionSync)({
        domain: "mission", playerId, operation: "settle_awake_mission_rewards",
    }, () => {
        var _a, _b, _c, _d, _e, _f;
        for (const entry of aggregatedProgressList) {
            if (((_a = persistedMissions[String(entry.missionId)]) === null || _a === void 0 ? void 0 : _a.progress) !== entry.progress) {
                (0, mission_1.updatePlayerCategoryMissionSync)(playerId, 9, entry.missionId, entry.progress);
            }
        }
        for (const entry of aggregatedProgressList) {
            const persistedStages = (_b = persistedMissions[String(entry.missionId)]) === null || _b === void 0 ? void 0 : _b.stages;
            for (const stage of (0, stages_1.getCompletedStageNumbers)(9, entry.missionId, entry.progress)) {
                const definition = (0, rewards_1.getAwakeMissionRewardStageDefinition)(entry.missionId, stage);
                if (!definition)
                    continue;
                // Special rewards are authoritative state, not consumable
                // grants. Re-assert and publish them even when the mission
                // stage was received earlier and its original response was
                // lost. The monotonic upsert keeps this idempotent.
                if (definition.specialReward) {
                    const special = definition.specialReward;
                    if (!ownedIds.has(special.characterId)) {
                        throw new Error(`Awake reward character mismatch for mission ${entry.missionId}.`);
                    }
                    const characterKey = String(special.characterId);
                    const persistedLevels = (_c = unlockMap.get(characterKey)) !== null && _c !== void 0 ? _c : {};
                    if (((_d = persistedLevels[special.boardIndex]) !== null && _d !== void 0 ? _d : 0) < special.awakeLevel) {
                        (0, character_awake_1.upsertPlayerCharacterAwakeUnlockSync)(playerId, special.characterId, special.boardIndex, special.awakeLevel);
                        persistedLevels[special.boardIndex] = special.awakeLevel;
                        unlockMap.set(characterKey, persistedLevels);
                    }
                    const levels = (_e = unlockMap.get(characterKey)) !== null && _e !== void 0 ? _e : {};
                    levels[special.boardIndex] = Math.max((_f = levels[special.boardIndex]) !== null && _f !== void 0 ? _f : 0, special.awakeLevel);
                    unlockMap.set(characterKey, levels);
                }
                if (!Array.isArray(persistedStages) && (persistedStages === null || persistedStages === void 0 ? void 0 : persistedStages[String(stage)]) === true)
                    continue;
                (0, mission_1.updatePlayerCategoryMissionStageSync)(playerId, 9, stage, entry.missionId, true);
                granter.grant(definition.rewards);
                missionInfo.push({
                    mission_category_id: 9,
                    mission_id: entry.missionId,
                    mission_reward_id: definition.missionRewardId,
                });
            }
        }
        granter.persistPlayer();
    });
    const unlockCharacterList = unlockMap.size === 0
        ? []
        : (0, character_helpers_1.buildScopedManaBoardAwakeCharacterList)(playerId, unlockMap);
    const characterList = [
        ...granter.characterList,
        ...unlockCharacterList,
    ];
    return Object.assign({ missionInfo, itemList: granter.itemList, characterList, equipmentList: granter.equipmentList, degreeIds: granter.degreeList, passCardPoints: {} }, (granter.hasPlayerChanges() ? { userInfo: granter.getUserInfo() } : {}));
}
exports.settleAwakeMissionRewards = settleAwakeMissionRewards;
