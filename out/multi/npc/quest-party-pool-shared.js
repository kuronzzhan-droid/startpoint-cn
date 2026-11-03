"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.selectQuestNpcPartySourceIds = exports.getQuestNpcPartyPoolKey = exports.isQuestNpcPartyPoolEligibleCategory = exports.cloneQuestNpcPartySnapshot = exports.QUEST_NPC_POOL_MIN_POWER = exports.QUEST_NPC_POOL_MAX_RECENT = void 0;
const quest_1 = require("../../lib/types/quest");
const public_payload_1 = require("../../lib/weapon-riven/public-payload");
exports.QUEST_NPC_POOL_MAX_RECENT = 50;
exports.QUEST_NPC_POOL_MIN_POWER = 8000;
const ELIGIBLE_QUEST_CATEGORIES = new Set([
    quest_1.QuestCategory.BOSS_BATTLE,
    quest_1.QuestCategory.ADVENT_EVENT_SINGLE,
    quest_1.QuestCategory.ADVENT_EVENT_MULTI,
    quest_1.QuestCategory.WORLD_STORY_EVENT_BOSS_BATTLE,
    quest_1.QuestCategory.HARD_MULTI_EVENT,
]);
/** Each battle/settlement owns its wire roster independently of the live room. */
function cloneQuestNpcPartySnapshot(snapshot) {
    return snapshot ? (0, public_payload_1.stripWeaponRivenPublicPayload)(snapshot) : undefined;
}
exports.cloneQuestNpcPartySnapshot = cloneQuestNpcPartySnapshot;
function isQuestNpcPartyPoolEligibleCategory(category) {
    return ELIGIBLE_QUEST_CATEGORIES.has(Number(category));
}
exports.isQuestNpcPartyPoolEligibleCategory = isQuestNpcPartyPoolEligibleCategory;
function getQuestNpcPartyPoolKey(category, questId) {
    return `${Number(category)}:${Number(questId)}`;
}
exports.getQuestNpcPartyPoolKey = getQuestNpcPartyPoolKey;
function selectQuestNpcPartySourceIds(candidates) {
    // Power remains a selection gate, never a reason to retain an older clear.
    return [...candidates]
        .sort((a, b) => b.clearedAt - a.clearedAt || a.sourcePlayerId - b.sourcePlayerId)
        .slice(0, exports.QUEST_NPC_POOL_MAX_RECENT)
        .map(candidate => candidate.sourcePlayerId);
}
exports.selectQuestNpcPartySourceIds = selectQuestNpcPartySourceIds;
