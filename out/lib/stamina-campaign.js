"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getActiveCampaignRate = void 0;
const stamina_campaign_json_1 = __importDefault(require("../../assets/stamina_campaign.json"));
const types_1 = require("./types");
const campaigns = [];
for (const [id, rows] of Object.entries(stamina_campaign_json_1.default)) {
    const row = rows[0];
    if (!row || !row[5])
        continue;
    campaigns.push({
        id,
        rate: parseFloat(row[5]),
        questType: parseInt(row[6]),
        questIds: row[9] || "",
        eventIds: row[7] || "",
        startTime: new Date(row[1]),
        endTime: new Date(row[2]),
    });
}
const CATEGORY_TO_CDN_TYPE = {
    [types_1.QuestCategory.MAIN]: 0,
    [types_1.QuestCategory.EX]: 1,
    [types_1.QuestCategory.BOSS_BATTLE]: 2,
    [types_1.QuestCategory.DAILY_WEEK_EVENT]: 3,
    [types_1.QuestCategory.DAILY_EXP_MANA_EVENT]: 4,
    [types_1.QuestCategory.ADVENT_EVENT_SINGLE]: 5,
    [types_1.QuestCategory.ADVENT_EVENT_MULTI]: 5,
    [types_1.QuestCategory.STORY_EVENT_SINGLE]: 6,
    [types_1.QuestCategory.CHALLENGE_DUNGEON_EVENT]: 7,
    [types_1.QuestCategory.RANKING_EVENT_SINGLE]: 8,
    [types_1.QuestCategory.WORLD_STORY_EVENT]: 9,
    [types_1.QuestCategory.WORLD_STORY_EVENT_BOSS_BATTLE]: 10,
    [types_1.QuestCategory.PRACTICE]: 11,
    [types_1.QuestCategory.TOWER_DUNGEON_EVENT]: 13,
    [types_1.QuestCategory.EXPERT_SINGLE_EVENT]: 14,
    [types_1.QuestCategory.CARNIVAL_EVENT]: 15,
    [types_1.QuestCategory.RAID_EVENT]: 16,
    [types_1.QuestCategory.RUSH_EVENT]: 17,
    [types_1.QuestCategory.SOLO_TIME_ATTACK_EVENT]: 18,
    [types_1.QuestCategory.HARD_MULTI_EVENT]: 19,
};
function matchesQuestId(campaign, questId) {
    if (campaign.questIds === "(None)" || campaign.questIds === "")
        return true;
    const ids = campaign.questIds.split(",").map(Number);
    return ids.includes(questId);
}
function matchesEvent(campaign, _questId) {
    if (campaign.eventIds === "(None)" || campaign.eventIds === "")
        return false;
    return true;
}
function getActiveCampaignRate(category, questId, serverDate) {
    const cdnType = CATEGORY_TO_CDN_TYPE[category];
    if (cdnType === undefined)
        return 1;
    let rate = 1;
    for (const c of campaigns) {
        if (c.questType !== cdnType)
            continue;
        if (serverDate < c.startTime || serverDate > c.endTime)
            continue;
        if (!matchesQuestId(c, questId) && !matchesEvent(c, questId))
            continue;
        rate = Math.min(rate, c.rate);
    }
    return rate;
}
exports.getActiveCampaignRate = getActiveCampaignRate;
