"use strict";
// Mission reward parsers — from CDN reward tables
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCategoryMissionRewardStageDefinition = exports.getWeeklyMissionRewards = exports.getDegreeMissionRewards = exports.getCollectMissionRewards = exports.getEventMissionRewards = exports.getAwakeMissionRewards = exports.getAwakeMissionRewardStageDefinition = exports.getDailyMissionRewards = exports.getRegularMissionRewards = exports.getMissionRewardStageDefinition = exports.getActiveMissionRewards = void 0;
const mission_active_reward_json_1 = __importDefault(require("../../../assets/mission_active_reward.json"));
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
function getRewardRow(table, missionId, stage) {
    var _a, _b;
    return (_b = (_a = table[String(missionId)]) === null || _a === void 0 ? void 0 : _a[String(stage)]) === null || _b === void 0 ? void 0 : _b[0];
}
function parseOptionalInteger(value) {
    if (value === undefined || value === null || value === "" || value === "(None)")
        return undefined;
    const parsed = Number.parseInt(String(value));
    return Number.isNaN(parsed) ? undefined : parsed;
}
function parseMissionRewardSlots(row, firstKindIndex, slotCount = 4) {
    var _a;
    const result = [];
    for (let slot = 0; slot < slotCount; slot++) {
        const base = firstKindIndex + slot * 6;
        const kind = parseOptionalInteger(row[base]);
        if (kind === undefined)
            continue;
        const amount = (_a = parseOptionalInteger(row[base + 1])) !== null && _a !== void 0 ? _a : 0;
        const itemId = parseOptionalInteger(row[base + 2]);
        const characterId = parseOptionalInteger(row[base + 3]);
        const equipmentId = parseOptionalInteger(row[base + 4]);
        const degreeId = parseOptionalInteger(row[base + 5]);
        if (amount === 0 && kind !== 6)
            continue;
        if (kind === 1 && itemId === undefined)
            continue;
        if (kind === 2 && equipmentId === undefined)
            continue;
        if (kind === 4 && characterId === undefined)
            continue;
        if (kind === 6 && degreeId === undefined)
            continue;
        result.push(Object.assign(Object.assign(Object.assign(Object.assign({ kind,
            amount }, (itemId !== undefined ? { itemId } : {})), (characterId !== undefined ? { characterId } : {})), (equipmentId !== undefined ? { equipmentId } : {})), (degreeId !== undefined ? { degreeId } : {})));
    }
    return result;
}
function getActiveRewardTable(repository) {
    return repository
        ? repository.table("mission_active_reward.json")
        : mission_active_reward_json_1.default;
}
function getActiveMissionRewards(missionId, stage, repository) {
    const row = getRewardRow(getActiveRewardTable(repository), missionId, stage);
    return row ? parseMissionRewardSlots(row, 7) : [];
}
exports.getActiveMissionRewards = getActiveMissionRewards;
function getMissionRewardStageDefinition(missionId, stage, repository) {
    const row = getRewardRow(getActiveRewardTable(repository), missionId, stage);
    if (!row)
        return null;
    const targetProgress = Number.parseFloat(String(row[3]));
    if (!Number.isFinite(targetProgress))
        return null;
    return {
        targetProgress,
        targetClearSeconds: parseOptionalInteger(row[4]),
        rewards: parseMissionRewardSlots(row, 7),
    };
}
exports.getMissionRewardStageDefinition = getMissionRewardStageDefinition;
function getCategoryRewards(table, missionId, stage, firstKindIndex) {
    const row = getRewardRow(table, missionId, stage);
    return row ? parseMissionRewardSlots(row, firstKindIndex) : [];
}
const getRegularMissionRewards = (missionId, stage) => getCategoryRewards(mission_regular_reward_json_1.default, missionId, stage, 5);
exports.getRegularMissionRewards = getRegularMissionRewards;
const getDailyMissionRewards = (missionId, stage) => getCategoryRewards(mission_daily_reward_json_1.default, missionId, stage, 5);
exports.getDailyMissionRewards = getDailyMissionRewards;
function getAwakeMissionRewardStageDefinition(missionId, stage) {
    const row = getRewardRow(awake_master_assets_1.characterAwakeRewards, missionId, stage);
    if (!row)
        return null;
    const missionRewardId = parseOptionalInteger(row[0]);
    const targetProgress = Number.parseFloat(String(row[5]));
    if (missionRewardId === undefined || !Number.isFinite(targetProgress))
        return null;
    const specialKind = parseOptionalInteger(row[1]);
    let specialReward;
    if (specialKind === 0) {
        const characterId = parseOptionalInteger(row[2]);
        const boardIndex = parseOptionalInteger(row[3]);
        const awakeLevel = parseOptionalInteger(row[4]);
        if (characterId === undefined || boardIndex === undefined || awakeLevel === undefined)
            return null;
        specialReward = { characterId, boardIndex, awakeLevel };
    }
    const targetClearSeconds = parseOptionalInteger(row[6]);
    return Object.assign(Object.assign(Object.assign({ missionRewardId,
        targetProgress }, (targetClearSeconds !== undefined ? { targetClearSeconds } : {})), (specialReward ? { specialReward } : {})), { rewards: parseMissionRewardSlots(row, 9) });
}
exports.getAwakeMissionRewardStageDefinition = getAwakeMissionRewardStageDefinition;
function getAwakeMissionRewards(missionId, stage) {
    var _a, _b;
    return (_b = (_a = getAwakeMissionRewardStageDefinition(missionId, stage)) === null || _a === void 0 ? void 0 : _a.rewards) !== null && _b !== void 0 ? _b : [];
}
exports.getAwakeMissionRewards = getAwakeMissionRewards;
function getEventMissionRewards(missionId, stage) {
    return getCategoryRewards(mission_event_reward_json_1.default, missionId, stage, 5);
}
exports.getEventMissionRewards = getEventMissionRewards;
const getCollectMissionRewards = (missionId, stage) => getCategoryRewards(mission_collect_item_reward_json_1.default, missionId, stage, 6);
exports.getCollectMissionRewards = getCollectMissionRewards;
const getDegreeMissionRewards = (missionId, stage) => getCategoryRewards(mission_degree_reward_json_1.default, missionId, stage, 5);
exports.getDegreeMissionRewards = getDegreeMissionRewards;
const getWeeklyMissionRewards = (missionId, stage) => getCategoryRewards(mission_weekly_reward_json_1.default, missionId, stage, 5);
exports.getWeeklyMissionRewards = getWeeklyMissionRewards;
const categoryRewardTables = {
    1: { table: mission_regular_reward_json_1.default, targetProgressIndex: 1, firstKindIndex: 5 },
    2: { table: mission_daily_reward_json_1.default, targetProgressIndex: 1, firstKindIndex: 5 },
    3: { table: mission_event_reward_json_1.default, targetProgressIndex: 1, firstKindIndex: 5 },
    4: { table: mission_collect_item_reward_json_1.default, targetProgressIndex: 2, firstKindIndex: 6 },
    5: { table: mission_degree_reward_json_1.default, targetProgressIndex: 1, firstKindIndex: 5 },
    6: { table: mission_pass_daily_reward_json_1.default, targetProgressIndex: 1, firstKindIndex: 5 },
    7: { table: mission_pass_week_reward_json_1.default, targetProgressIndex: 1, firstKindIndex: 5 },
    8: { table: mission_pass_event_reward_json_1.default, targetProgressIndex: 1, firstKindIndex: 5 },
    10: { table: mission_weekly_reward_json_1.default, targetProgressIndex: 1, firstKindIndex: 5 },
};
function getCategoryMissionRewardStageDefinition(category, missionId, stage) {
    const layout = categoryRewardTables[category];
    if (!layout)
        return null;
    const row = getRewardRow(layout.table, missionId, stage);
    if (!row)
        return null;
    const missionRewardId = parseOptionalInteger(row[0]);
    const targetProgress = Number.parseFloat(String(row[layout.targetProgressIndex]));
    if (missionRewardId === undefined || !Number.isFinite(targetProgress))
        return null;
    return {
        missionRewardId,
        targetProgress,
        rewards: parseMissionRewardSlots(row, layout.firstKindIndex),
    };
}
exports.getCategoryMissionRewardStageDefinition = getCategoryMissionRewardStageDefinition;
