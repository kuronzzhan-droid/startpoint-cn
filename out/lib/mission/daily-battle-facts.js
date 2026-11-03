"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordDailyMissionBattleFacts = void 0;
const advent_event_quest_json_1 = __importDefault(require("../../../assets/advent_event_quest.json"));
const score_attack_event_quest_json_1 = __importDefault(require("../../../assets/score_attack_event_quest.json"));
const mission_1 = require("../../data/domains/mission");
const master_data_1 = require("./master-data");
const SCORE_ATTACK_DAILY_MISSION_ID = 10075;
const ANY_BATTLE_DAILY_MISSION_ID = 800392;
const SINGLE_BATTLE_DAILY_MISSION_ID = 900002;
const MULTI_BATTLE_DAILY_MISSION_IDS = new Set([900001, 900003]);
const ACTIVE_DAILY_BATTLE_MISSION_IDS = new Set([
    800115,
    800116,
    800117,
    800124,
    800125,
    800126,
]);
const ADVENT_EVENT_RANGE_KIND = 5;
const BOSS_BATTLE_RANGE_KIND = 2;
const SCORE_ATTACK_EVENT_RANGE_KIND = 20;
const SCORE_ATTACK_QUEST_CATEGORY = 27;
const SCORE_ATTACK_CLEAR_PATTERN_TYPE = 14;
const SINGLE_BATTLE_CLEAR_PATTERN_TYPE = 14;
const ANY_BATTLE_CLEAR_PATTERN_TYPE = 23;
const MULTI_BATTLE_CLEAR_PATTERN_TYPE = 16;
const adventQuestIds = new Set(Object.keys(advent_event_quest_json_1.default).map(Number).filter(Number.isSafeInteger));
const scoreAttackQuestEventIds = new Map(Object.entries(score_attack_event_quest_json_1.default).map(([questId, quest]) => [
    Number(questId),
    Number(quest.eventId),
]));
function matchesAdventEvent(row, questCategory, questId) {
    if (questCategory !== 7 || !adventQuestIds.has(questId))
        return false;
    const eventSelector = Number(row[8]);
    return Number.isSafeInteger(eventSelector)
        && eventSelector > 0
        && Math.trunc(questId / 1000) === eventSelector;
}
function matchesQuestRange(row, questCategory, questId) {
    const rangeKind = Number(row[7]);
    if (rangeKind === ADVENT_EVENT_RANGE_KIND) {
        return matchesAdventEvent(row, questCategory, questId);
    }
    return rangeKind === BOSS_BATTLE_RANGE_KIND && questCategory === 2;
}
function matchesScoreAttackEvent(row, questCategory, questId) {
    if (questCategory !== SCORE_ATTACK_QUEST_CATEGORY
        || Number(row[7]) !== SCORE_ATTACK_EVENT_RANGE_KIND)
        return false;
    const eventId = scoreAttackQuestEventIds.get(questId);
    return eventId !== undefined && eventId === Number(row[8]);
}
function recordDailyMissionBattleFacts(context, evaluationTime) {
    if (!context.questAccomplished)
        return [];
    const matchedMissionIds = [];
    for (const definition of (0, master_data_1.getMissionMasterDefinitions)(2)) {
        if (!(0, master_data_1.isMissionDefinitionEnabledAt)(definition, evaluationTime))
            continue;
        const patternType = Number(definition.row[2]);
        const matchesExistingMultiMission = context.isMulti === true
            && ACTIVE_DAILY_BATTLE_MISSION_IDS.has(definition.missionId)
            && patternType === MULTI_BATTLE_CLEAR_PATTERN_TYPE
            && matchesQuestRange(definition.row, context.questCategory, context.questId);
        const matchesScoreAttackMission = definition.missionId === SCORE_ATTACK_DAILY_MISSION_ID
            && patternType === SCORE_ATTACK_CLEAR_PATTERN_TYPE
            && matchesScoreAttackEvent(definition.row, context.questCategory, context.questId);
        const matchesAnyBattleMission = definition.missionId === ANY_BATTLE_DAILY_MISSION_ID
            && patternType === ANY_BATTLE_CLEAR_PATTERN_TYPE;
        // Bonus daily missions keep their own facts and never join the four
        // core patterns used by the daily all-clear mission.
        const matchesSingleBattleMission = context.isMulti !== true
            && definition.missionId === SINGLE_BATTLE_DAILY_MISSION_ID
            && patternType === SINGLE_BATTLE_CLEAR_PATTERN_TYPE;
        const matchesMultiBattleMission = context.isMulti === true
            && MULTI_BATTLE_DAILY_MISSION_IDS.has(definition.missionId)
            && patternType === MULTI_BATTLE_CLEAR_PATTERN_TYPE;
        if (!matchesExistingMultiMission
            && !matchesScoreAttackMission
            && !matchesAnyBattleMission
            && !matchesSingleBattleMission
            && !matchesMultiBattleMission)
            continue;
        (0, mission_1.incrementPlayerCategoryMissionSync)(context.playerId, 2, definition.missionId, 1);
        matchedMissionIds.push(definition.missionId);
    }
    return matchedMissionIds;
}
exports.recordDailyMissionBattleFacts = recordDailyMissionBattleFacts;
