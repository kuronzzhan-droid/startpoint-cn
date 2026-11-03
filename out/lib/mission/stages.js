"use strict";
// Stage threshold data — from CDN reward tables
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getMissionFinalTargetProgress = exports.getMissionStageIds = exports.isMissionProgressComplete = exports.getCompletedStageNumbers = exports.getCurrentStage = exports.getMissionIdsByCategory = void 0;
const mission_regular_reward_json_1 = __importDefault(require("../../../assets/mission_regular_reward.json"));
const mission_daily_reward_json_1 = __importDefault(require("../../../assets/mission_daily_reward.json"));
const mission_event_reward_json_1 = __importDefault(require("../../../assets/mission_event_reward.json"));
const mission_degree_reward_json_1 = __importDefault(require("../../../assets/mission_degree_reward.json"));
const mission_collect_item_reward_json_1 = __importDefault(require("../../../assets/mission_collect_item_reward.json"));
const mission_weekly_reward_json_1 = __importDefault(require("../../../assets/mission_weekly_reward.json"));
const awake_master_assets_1 = require("./awake-master-assets");
const mission_pass_daily_reward_json_1 = __importDefault(require("../../../assets/mission_pass_daily_reward.json"));
const mission_pass_week_reward_json_1 = __importDefault(require("../../../assets/mission_pass_week_reward.json"));
const mission_pass_event_reward_json_1 = __importDefault(require("../../../assets/mission_pass_event_reward.json"));
function buildLookup(rewardTable, targetProgressIndex) {
    const result = {};
    for (const [missionId, stages] of Object.entries(rewardTable)) {
        const list = [];
        for (const [stageStr, rows] of Object.entries(stages)) {
            const row = rows[0];
            const targetProgress = parseInt(row[targetProgressIndex] || "0");
            const stage = parseInt(stageStr);
            list.push({ stage, targetProgress });
        }
        list.sort((a, b) => a.targetProgress - b.targetProgress);
        result[missionId] = list;
    }
    return result;
}
const missionStageLookup = {
    1: buildLookup(mission_regular_reward_json_1.default, 1),
    2: buildLookup(mission_daily_reward_json_1.default, 1),
    3: buildLookup(mission_event_reward_json_1.default, 1),
    4: buildLookup(mission_collect_item_reward_json_1.default, 2),
    5: buildLookup(mission_degree_reward_json_1.default, 1),
    6: buildLookup(mission_pass_daily_reward_json_1.default, 1),
    7: buildLookup(mission_pass_week_reward_json_1.default, 1),
    8: buildLookup(mission_pass_event_reward_json_1.default, 1),
    9: buildLookup(awake_master_assets_1.characterAwakeRewards, 5),
    10: buildLookup(mission_weekly_reward_json_1.default, 1),
};
const finalTargets = Object.fromEntries(Object.entries(missionStageLookup).map(([category, missions]) => [
    category,
    Object.fromEntries(Object.entries(missions).map(([id, stages]) => [
        id, stages.length === 0 ? undefined : Math.max(...stages.map(stage => stage.targetProgress)),
    ])),
]));
const missionIds = Object.fromEntries(Object.entries(missionStageLookup).map(([category, missions]) => [
    category, Object.keys(missions).map(Number),
]));
function getMissionIdsByCategory(category) {
    var _a, _b;
    // Preserve the caller-owned array contract.
    return (_b = (_a = missionIds[category]) === null || _a === void 0 ? void 0 : _a.slice()) !== null && _b !== void 0 ? _b : [];
}
exports.getMissionIdsByCategory = getMissionIdsByCategory;
function getCurrentStage(category, missionId, progress) {
    var _a;
    const stages = (_a = missionStageLookup[category]) === null || _a === void 0 ? void 0 : _a[String(missionId)];
    if (!stages || stages.length === 0)
        return 1;
    let current = stages[stages.length - 1].stage;
    for (const s of stages) {
        if (progress < s.targetProgress) {
            current = s.stage;
            break;
        }
    }
    return current;
}
exports.getCurrentStage = getCurrentStage;
function getCompletedStageNumbers(category, missionId, progress) {
    var _a;
    const stages = (_a = missionStageLookup[category]) === null || _a === void 0 ? void 0 : _a[String(missionId)];
    if (!stages)
        return [];
    return stages.filter(s => progress >= s.targetProgress).map(s => s.stage);
}
exports.getCompletedStageNumbers = getCompletedStageNumbers;
function isMissionProgressComplete(category, missionId, progress) {
    var _a;
    const stages = (_a = missionStageLookup[category]) === null || _a === void 0 ? void 0 : _a[String(missionId)];
    return !!(stages === null || stages === void 0 ? void 0 : stages.length) && stages.every(stage => progress >= stage.targetProgress);
}
exports.isMissionProgressComplete = isMissionProgressComplete;
function getMissionStageIds(category, missionId) {
    var _a;
    const stages = (_a = missionStageLookup[category]) === null || _a === void 0 ? void 0 : _a[String(missionId)];
    if (!stages)
        return [];
    return stages.map(s => s.stage);
}
exports.getMissionStageIds = getMissionStageIds;
/**
 * Returns the largest progress value the client ever needs for a mission.
 *
 * Several degree conditions are backed by lifetime counters or score values
 * that can grow far beyond the final reward threshold. Persisting and
 * returning the raw value is unnecessary and can overflow older clients.
 */
function getMissionFinalTargetProgress(category, missionId) {
    var _a;
    return (_a = finalTargets[category]) === null || _a === void 0 ? void 0 : _a[missionId];
}
exports.getMissionFinalTargetProgress = getMissionFinalTargetProgress;
