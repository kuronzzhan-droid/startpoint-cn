"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.settleMissionCategoriesAsync = exports.settleMissionCategories = exports.settleMissionCategoriesWithProgress = void 0;
const mission_1 = require("../../data/domains/mission");
const degree_1 = require("../../data/domains/degree");
const registry_1 = require("./registry");
const rewards_1 = require("./rewards");
const stages_1 = require("./stages");
const patterns_1 = require("./patterns");
const client_progress_1 = require("./client-progress");
const grants_1 = require("./grants");
const master_data_1 = require("./master-data");
const persistence_coordinator_1 = require("../persistence-coordinator");
const command_names_1 = require("../persistence/command-names");
const evaluation_context_1 = require("./evaluation-context");
function isDailyCoreMission(pattern) {
    return /^single_battle_play(?:_[23])?$/.test(pattern)
        || /^multi_battle_play(?:_[23])?$/.test(pattern)
        || /^use_dash(?:_[23])?$/.test(pattern)
        || pattern === "daily_quest_stamina_use_2024_02";
}
function applyDailyCompletionProgress(missions) {
    const dailyMissions = missions.filter(mission => mission.category === 2);
    if (dailyMissions.length === 0)
        return;
    const completedCoreCount = dailyMissions.filter(mission => {
        const pattern = (0, patterns_1.getMissionPattern)(2, mission.missionId);
        return isDailyCoreMission(pattern)
            && (0, stages_1.isMissionProgressComplete)(2, mission.missionId, mission.progress);
    }).length;
    for (const mission of dailyMissions) {
        if (!(0, patterns_1.getMissionPattern)(2, mission.missionId).startsWith("daily_quest_all_clear"))
            continue;
        mission.progress = Math.max(mission.dbProgress, completedCoreCount);
    }
}
function evaluateMissionCategories(playerId, categories, evaluationTime) {
    var _a, _b, _c, _d, _e;
    const evaluatedMissions = [];
    const evaluatedMissionKeys = new Set();
    const scopes = new Map();
    for (const entry of categories) {
        const scope = typeof entry === "number" ? { category: entry } : entry;
        scopes.set(`${scope.category}:${(_a = scope.eventId) !== null && _a !== void 0 ? _a : ""}`, scope);
    }
    const preparedScopes = [...scopes.values()].map(scope => {
        var _a;
        return ({
            scope,
            candidateMissionIds: (_a = scope.missionIds) !== null && _a !== void 0 ? _a : (0, stages_1.getMissionIdsByCategory)(scope.category),
        });
    }).filter(entry => entry.candidateMissionIds.length > 0);
    const persistedByCategory = /^(0|false|no|off)$/i.test((_b = process.env.MISSION_SCOPED_READS) !== null && _b !== void 0 ? _b : "true")
        ? (0, mission_1.getPlayerCategoryMissionsForCategoriesSync)(playerId, preparedScopes.map(entry => entry.scope.category))
        : (0, mission_1.getPlayerCategoryMissionsForScopesSync)(playerId, preparedScopes.map(entry => ({
            category: entry.scope.category, missionIds: entry.candidateMissionIds,
        })));
    const readContext = new evaluation_context_1.MissionEvaluationReadContext(playerId);
    const player = readContext.player;
    for (const { scope, candidateMissionIds } of preparedScopes) {
        const { category, eventId } = scope;
        const computer = (0, registry_1.getComputer)(category);
        const persisted = (_c = persistedByCategory[String(category)]) !== null && _c !== void 0 ? _c : {};
        // Title progress is monotonic and capped at its final target. Completed
        // titles need no fact scan, but still enter persistence preparation so
        // unreceived stages and missing legacy degree ownership can be repaired.
        const factMissionIds = category === 5 ? candidateMissionIds.filter(missionId => {
            var _a, _b;
            if (!(0, patterns_1.isMissionEnabledAt)(category, missionId, evaluationTime, eventId))
                return false;
            const target = (0, stages_1.getMissionFinalTargetProgress)(category, missionId);
            return target === undefined || ((_b = (_a = persisted[String(missionId)]) === null || _a === void 0 ? void 0 : _a.progress) !== null && _b !== void 0 ? _b : 0) < target;
        }) : candidateMissionIds;
        const factMissionIdSet = new Set(factMissionIds);
        const context = factMissionIds.length > 0 ? computer.buildContext(playerId, category, evaluationTime, factMissionIds, readContext) : undefined;
        for (const missionId of candidateMissionIds) {
            if (!(0, patterns_1.isMissionEnabledAt)(category, missionId, evaluationTime, eventId))
                continue;
            const missionKey = `${category}:${missionId}`;
            if (evaluatedMissionKeys.has(missionKey))
                continue;
            evaluatedMissionKeys.add(missionKey);
            const current = persisted[String(missionId)];
            const dbProgress = (_d = current === null || current === void 0 ? void 0 : current.progress) !== null && _d !== void 0 ? _d : 0;
            const computed = context && factMissionIdSet.has(missionId)
                ? computer.compute(missionId, context, dbProgress) : dbProgress;
            const finalTarget = (0, stages_1.getMissionFinalTargetProgress)(category, missionId);
            const monotonicProgress = Math.max(0, dbProgress, Number.isFinite(computed) ? computed : 0);
            evaluatedMissions.push({
                category,
                missionId,
                progress: finalTarget === undefined
                    ? monotonicProgress
                    : category === 2 || (0, client_progress_1.isClientProgressMissionPattern)((0, patterns_1.getMissionPattern)(category, missionId))
                        ? Math.max(dbProgress, Math.min(monotonicProgress, finalTarget))
                        : Math.min(monotonicProgress, finalTarget),
                receivedStages: (_e = current === null || current === void 0 ? void 0 : current.stages) !== null && _e !== void 0 ? _e : [],
                dbProgress,
            });
        }
    }
    applyDailyCompletionProgress(evaluatedMissions);
    return { player, evaluatedMissions };
}
function emptyMissionSettlementResult() {
    return {
        missionInfo: [],
        itemList: {},
        characterList: [],
        equipmentList: [],
        degreeIds: [],
        passCardPoints: {},
    };
}
function prepareMissionPersistence(playerId, evaluatedMissions) {
    const progressUpdates = evaluatedMissions.filter(mission => mission.progress !== mission.dbProgress);
    const pendingRewards = [];
    const legacyDegreeIds = new Set();
    for (const mission of evaluatedMissions) {
        for (const stage of (0, stages_1.getCompletedStageNumbers)(mission.category, mission.missionId, mission.progress)) {
            const definition = (0, rewards_1.getCategoryMissionRewardStageDefinition)(mission.category, mission.missionId, stage);
            if (!definition)
                continue;
            if (!Array.isArray(mission.receivedStages)
                && mission.receivedStages[String(stage)] === true) {
                if (mission.category === 5) {
                    for (const reward of definition.rewards) {
                        if (reward.kind === 6 && reward.degreeId !== undefined) {
                            legacyDegreeIds.add(reward.degreeId);
                        }
                    }
                }
                continue;
            }
            pendingRewards.push({ mission, stage, definition });
        }
    }
    const ownedDegrees = legacyDegreeIds.size > 0
        ? new Set((0, degree_1.getPlayerDegreeIdsSync)(playerId))
        : new Set();
    return {
        progressUpdates,
        pendingRewards,
        missingLegacyDegreeIds: [...legacyDegreeIds].filter(degreeId => !ownedDegrees.has(degreeId)),
    };
}
function persistMissionEvaluation(playerId, player, prepared) {
    var _a;
    const granter = new grants_1.MissionRewardGranter(playerId, player);
    const missionInfo = [];
    (0, mission_1.updatePlayerCategoryMissionBatchSync)(playerId, prepared.progressUpdates
        .map(mission => ({
        category: mission.category,
        missionId: mission.missionId,
        progress: mission.progress,
    })));
    for (const degreeId of prepared.missingLegacyDegreeIds) {
        granter.grantDegreeOwnershipOnly(degreeId);
    }
    (0, mission_1.updatePlayerCategoryMissionStageBatchSync)(playerId, prepared.pendingRewards.map(({ mission, stage }) => ({
        category: mission.category,
        missionId: mission.missionId,
        stageId: stage,
        status: true,
    })));
    for (const { mission, definition } of prepared.pendingRewards) {
        const passCardEventId = mission.category >= 6 && mission.category <= 8
            ? (_a = (0, master_data_1.getMissionMasterDefinition)(mission.category, mission.missionId)) === null || _a === void 0 ? void 0 : _a.eventId
            : undefined;
        granter.grant(definition.rewards, { passCardEventId });
        missionInfo.push({
            mission_category_id: mission.category,
            mission_id: mission.missionId,
            mission_reward_id: definition.missionRewardId,
        });
    }
    granter.persistPlayer();
    return Object.assign({ missionInfo, itemList: granter.itemList, characterList: granter.characterList, equipmentList: granter.equipmentList, degreeIds: granter.degreeList, passCardPoints: granter.passCardPoints }, (granter.hasPlayerChanges() ? { userInfo: granter.getUserInfo() } : {}));
}
function evaluatedProgressOf(evaluatedMissions) {
    return evaluatedMissions.map(mission => ({
        category: mission.category,
        missionId: mission.missionId,
        progress: mission.progress,
    }));
}
function settleMissionCategoriesWithProgress(playerId, categories, evaluationTime) {
    const evaluation = evaluateMissionCategories(playerId, categories, evaluationTime);
    const prepared = prepareMissionPersistence(playerId, evaluation.evaluatedMissions);
    const settlement = prepared.progressUpdates.length === 0
        && prepared.pendingRewards.length === 0
        && prepared.missingLegacyDegreeIds.length === 0
        ? emptyMissionSettlementResult()
        : (0, persistence_coordinator_1.runPersistenceTransactionSync)({
            domain: "mission", playerId, operation: "settle_categories_sync",
        }, () => persistMissionEvaluation(playerId, evaluation.player, prepared));
    return {
        settlement,
        evaluatedProgress: evaluatedProgressOf(evaluation.evaluatedMissions),
    };
}
exports.settleMissionCategoriesWithProgress = settleMissionCategoriesWithProgress;
function settleMissionCategories(playerId, categories, evaluationTime) {
    return settleMissionCategoriesWithProgress(playerId, categories, evaluationTime).settlement;
}
exports.settleMissionCategories = settleMissionCategories;
function settleMissionCategoriesAsync(playerId, categories, evaluationTime) {
    return __awaiter(this, void 0, void 0, function* () {
        // The whole settlement (context scan plus persistence) is a registered
        // command so it can run inside the SQLite writer thread without holding the
        // main event loop. With the writer disabled the same registry entry runs
        // in-process and keeps the previous behaviour.
        return (0, persistence_coordinator_1.runWriterCommand)(command_names_1.MISSION_SETTLE_CATEGORIES, {
            playerId,
            categories: [...categories],
            evaluationTimeMs: evaluationTime.getTime(),
        }, { domain: "mission", playerId, operation: "settle_categories" });
    });
}
exports.settleMissionCategoriesAsync = settleMissionCategoriesAsync;
