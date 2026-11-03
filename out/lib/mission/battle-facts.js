"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordMissionBattleFacts = exports.getBattleActiveMissionPatterns = exports.buildBattleMissionSettlementScopes = exports.BATTLE_SETTLEMENT_CATEGORIES = void 0;
const quest_1 = require("../../data/domains/quest");
const mission_battle_facts_1 = require("../../data/domains/mission_battle_facts");
const character_clear_tracker_1 = require("../quest/finish/character-clear-tracker");
const leader_powerflip_tracker_1 = require("../quest/finish/leader-powerflip-tracker");
const party_co_clear_tracker_1 = require("../quest/finish/party-co-clear-tracker");
const powerflip_tracker_1 = require("../quest/finish/powerflip-tracker");
const utils_1 = require("../../utils");
const event_battle_facts_1 = require("./event-battle-facts");
const pass_battle_facts_1 = require("./pass-battle-facts");
const active_conditional_battle_facts_1 = require("./active-conditional-battle-facts");
const active_loadout_battle_facts_1 = require("./active-loadout-battle-facts");
const daily_battle_facts_1 = require("./daily-battle-facts");
const star_crumb_battle_1 = require("../star-crumb-battle");
const computer_degree_1 = require("./computer-degree");
const computer_event_safe_1 = require("./computer-event-safe");
const degree_party_power_1 = require("./degree-party-power");
const types_1 = require("../types");
// Category 5 (titles) must be settled in the battle result response.  Deferring
// it until get_mission_progress made newly acquired titles invisible until the
// player opened the title screen.
exports.BATTLE_SETTLEMENT_CATEGORIES = Object.freeze([1, 2, 3, 5, 6, 7, 8, 10]);
const BATTLE_DEGREE_CONDITION_TYPES = Object.freeze([
    // Battle results may grant/level characters and equipment in addition to
    // updating battle counters, so include those reward-driven title types.
    1, 4, 5, 8, 14, 15, 16, 17, 19, 20, 21, 22, 23, 25, 26, 27, 28, 29,
    30, 31, 37, 39, 44, 92,
]);
const BATTLE_ACTIVE_MISSION_PATTERNS = Object.freeze([
    // Battle counters, stamina, quest completion, party/loadout facts and
    // reward-driven character level/bond changes.
    4, 5, 8, 13, 14, 16, 17, 23, 26, 39, 57, 70, 71, 72, 73, 89, 90, 91,
]);
function buildBattleMissionSettlementScopes(facts, grantedItemIds = [], extraEventMissionIds = [], affectedCharacterIds = []) {
    const eventMissionIds = [...new Set([
            ...facts.eventMissionIds,
            ...(0, computer_event_safe_1.getEventItemMissionIdsForItems)(grantedItemIds),
            ...extraEventMissionIds.filter(missionId => Number.isSafeInteger(missionId) && missionId > 0),
        ])];
    const degreeMissionIds = facts.degreeTrigger
        ? (0, computer_degree_1.getDegreeMissionIdsForBattle)(BATTLE_DEGREE_CONDITION_TYPES, facts.degreeTrigger, affectedCharacterIds, grantedItemIds)
        : (0, computer_degree_1.getDegreeMissionIdsForConditionTypes)(BATTLE_DEGREE_CONDITION_TYPES, affectedCharacterIds, grantedItemIds);
    return [
        1,
        // Daily all-clear depends on the complete set of enabled core missions,
        // so category 2 deliberately remains a full (but small) evaluation.
        2,
        { category: 3, missionIds: eventMissionIds },
        {
            category: 5,
            missionIds: degreeMissionIds,
        },
        6,
        7,
        { category: 8, missionIds: facts.passMissionIds },
        10,
    ];
}
exports.buildBattleMissionSettlementScopes = buildBattleMissionSettlementScopes;
/** Active Mission patterns whose authoritative facts can change in one battle. */
function getBattleActiveMissionPatterns(questCategory) {
    return [
        ...BATTLE_ACTIVE_MISSION_PATTERNS,
        ...(questCategory === types_1.QuestCategory.CHARACTER ? [21] : []),
        ...(questCategory === types_1.QuestCategory.MAIN || questCategory === types_1.QuestCategory.EX ? [66] : []),
    ];
}
exports.getBattleActiveMissionPatterns = getBattleActiveMissionPatterns;
function recordMissionBattleFacts(ctx, evaluationTime = new Date((0, utils_1.getServerTime)() * 1000)) {
    const degreeTrigger = {
        questCategory: ctx.questCategory,
        questId: ctx.questId,
        mode: ctx.isMulti ? "multi" : "single",
        isHost: ctx.isMultiHost,
        accomplished: ctx.questAccomplished,
        clearRank: ctx.clearRank,
    };
    (0, mission_battle_facts_1.recordMissionBattleResultSync)(ctx.playerId, {
        isMulti: ctx.isMulti === true,
        isHost: ctx.isMultiHost,
        accomplished: ctx.questAccomplished,
        clearRank: ctx.clearRank,
    });
    if (!ctx.questAccomplished) {
        return {
            dailyMissionIds: [], eventMissionIds: [], passMissionIds: [], awakeMissionIds: [],
            degreeTrigger,
        };
    }
    (0, degree_party_power_1.recordDegreePartyPowerClearSync)(ctx);
    const dailyMissionIds = (0, daily_battle_facts_1.recordDailyMissionBattleFacts)(ctx, evaluationTime);
    (0, star_crumb_battle_1.awardBattleStarCrumbSync)(ctx, evaluationTime);
    const eventMissionIds = (0, event_battle_facts_1.recordEventMissionBattleFacts)(ctx, evaluationTime);
    const passMissionIds = (0, pass_battle_facts_1.recordPassMissionBattleFacts)(ctx, evaluationTime);
    (0, active_loadout_battle_facts_1.recordActiveMissionLoadoutBattleFactsSync)(ctx);
    (0, active_conditional_battle_facts_1.recordActiveMissionConditionalBattleFactsSync)(ctx);
    if (ctx.isMulti) {
        (0, quest_1.incrementPlayerQuestMultiClearSync)(ctx.playerId, ctx.questCategory, ctx.questId);
    }
    (0, character_clear_tracker_1.trackCharacterClears)(ctx);
    (0, leader_powerflip_tracker_1.trackLeaderPowerflip)(ctx);
    const awakeMissionIds = (0, party_co_clear_tracker_1.trackPartyCoClears)(ctx);
    (0, powerflip_tracker_1.trackPowerflip)(ctx);
    return { dailyMissionIds, eventMissionIds, passMissionIds, awakeMissionIds, degreeTrigger };
}
exports.recordMissionBattleFacts = recordMissionBattleFacts;
