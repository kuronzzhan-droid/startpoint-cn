"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.reconcileAwakeUnlocks = exports.reconcileAwakeUnlocksFromProgress = void 0;
const character_awake_1 = require("../../data/domains/character_awake");
const request_diagnostics_1 = require("../request-diagnostics");
const character_1 = require("../../data/domains/character");
const character_queries_1 = require("./character-queries");
const registry_1 = require("./registry");
const rewards_1 = require("./rewards");
const stages_1 = require("./stages");
const utils_1 = require("../../utils");
const persistence_coordinator_1 = require("../persistence-coordinator");
function reconcileAwakeUnlocksFromProgress(playerId, progressList, persistedUnlocks = (0, character_awake_1.getPlayerCharacterAwakeUnlocksSync)(playerId)) {
    const changed = new Map();
    const missing = progressList.flatMap(entry => {
        const characterId = (0, character_queries_1.getCharacterIdFromMission)(entry.missionId);
        return (0, stages_1.getCompletedStageNumbers)(9, entry.missionId, entry.progress).flatMap(stage => {
            var _a, _b, _c;
            const reward = (_a = (0, rewards_1.getAwakeMissionRewardStageDefinition)(entry.missionId, stage)) === null || _a === void 0 ? void 0 : _a.specialReward;
            return reward && String(reward.characterId) === characterId
                && ((_c = (_b = persistedUnlocks.get(characterId)) === null || _b === void 0 ? void 0 : _b[reward.boardIndex]) !== null && _c !== void 0 ? _c : 0) < reward.awakeLevel
                ? [Object.assign(Object.assign({}, reward), { missionId: entry.missionId })] : [];
        });
    });
    if (missing.length === 0)
        return { all: persistedUnlocks, changed };
    const ownedIds = (0, character_awake_1.getOwnedAwakeCharacterIdsSync)(playerId, missing.map(reward => reward.characterId));
    (0, persistence_coordinator_1.runPersistenceTransactionSync)({
        domain: "mission", playerId, operation: "reconcile_awake_unlocks",
    }, () => {
        var _a, _b;
        for (const reward of missing) {
            if (!ownedIds.has(reward.characterId)) {
                (0, request_diagnostics_1.recordUnownedAwakeMission)(reward.missionId, reward.characterId);
                continue;
            }
            if (!(0, character_awake_1.upsertPlayerCharacterAwakeUnlockSync)(playerId, reward.characterId, reward.boardIndex, reward.awakeLevel))
                continue;
            const characterId = String(reward.characterId);
            const levels = (_a = changed.get(characterId)) !== null && _a !== void 0 ? _a : {};
            levels[reward.boardIndex] = Math.max((_b = levels[reward.boardIndex]) !== null && _b !== void 0 ? _b : 0, reward.awakeLevel);
            changed.set(characterId, levels);
        }
    });
    return {
        all: (0, character_awake_1.getPlayerCharacterAwakeUnlocksSync)(playerId),
        changed,
    };
}
exports.reconcileAwakeUnlocksFromProgress = reconcileAwakeUnlocksFromProgress;
function reconcileAwakeUnlocks(playerId, candidateCharacterIds) {
    var _a, _b, _c;
    const all = (0, character_awake_1.getPlayerCharacterAwakeUnlocksSync)(playerId);
    const candidateIds = candidateCharacterIds ? new Set(candidateCharacterIds.map(String)) : null;
    // This function repairs unlock state, not consumable mission rewards.
    // A character already holding every configured level needs no fact reads.
    const missingMissionIds = (0, stages_1.getMissionIdsByCategory)(9).filter(missionId => {
        const characterId = (0, character_queries_1.getCharacterIdFromMission)(missionId);
        if (candidateIds && !candidateIds.has(characterId))
            return false;
        return (0, stages_1.getMissionStageIds)(9, missionId).some(stage => {
            var _a, _b, _c;
            const reward = (_a = (0, rewards_1.getAwakeMissionRewardStageDefinition)(missionId, stage)) === null || _a === void 0 ? void 0 : _a.specialReward;
            return reward && String(reward.characterId) === characterId
                && ((_c = (_b = all.get(characterId)) === null || _b === void 0 ? void 0 : _b[reward.boardIndex]) !== null && _c !== void 0 ? _c : 0) < reward.awakeLevel;
        });
    });
    if (missingMissionIds.length === 0)
        return { all, changed: new Map() };
    const ownedCharacters = (0, character_1.getPlayerCharactersByIdsSync)(playerId, missingMissionIds.map(character_queries_1.getCharacterIdFromMission).map(Number));
    const ownedMissionIds = missingMissionIds.filter(id => ownedCharacters[(0, character_queries_1.getCharacterIdFromMission)(id)]);
    if (ownedMissionIds.length === 0)
        return { all, changed: new Map() };
    const computer = (0, registry_1.getComputer)(9);
    const context = computer.buildContext(playerId, 9, (0, utils_1.getServerDate)(), ownedMissionIds);
    const progressList = [];
    for (const missionId of ownedMissionIds) {
        const dbProgress = (_c = (_b = (_a = context.persistedMissions) === null || _a === void 0 ? void 0 : _a[String(missionId)]) === null || _b === void 0 ? void 0 : _b.progress) !== null && _c !== void 0 ? _c : 0;
        progressList.push({
            missionId,
            progress: computer.compute(missionId, context, dbProgress),
        });
    }
    return reconcileAwakeUnlocksFromProgress(playerId, progressList, all);
}
exports.reconcileAwakeUnlocks = reconcileAwakeUnlocks;
