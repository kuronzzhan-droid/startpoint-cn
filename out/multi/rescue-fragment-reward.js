"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRescueFragmentAdditionalReward = exports.getEligibleRescueFragmentReward = exports.getRescueFragmentReward = exports.RESCUE_PURPLE_FRAGMENT_ADDITIONAL_REWARD_GROUP_ID = exports.RESCUE_GOLD_FRAGMENT_ADDITIONAL_REWARD_GROUP_ID = exports.RESCUE_SILVER_FRAGMENT_ADDITIONAL_REWARD_GROUP_ID = exports.RESCUE_PURPLE_FRAGMENT_ITEM_ID = exports.RESCUE_GOLD_FRAGMENT_ITEM_ID = exports.RESCUE_SILVER_FRAGMENT_ITEM_ID = void 0;
const types_1 = require("../lib/types");
const advent_event_quest_json_1 = __importDefault(require("../../assets/advent_event_quest.json"));
const hard_multi_event_quest_json_1 = __importDefault(require("../../assets/hard_multi_event_quest.json"));
const raid_event_quest_json_1 = __importDefault(require("../../assets/raid_event_quest.json"));
const world_story_event_boss_battle_quest_json_1 = __importDefault(require("../../assets/world_story_event_boss_battle_quest.json"));
const boss_tables_1 = require("../lib/boss/boss-tables");
exports.RESCUE_SILVER_FRAGMENT_ITEM_ID = 49000;
exports.RESCUE_GOLD_FRAGMENT_ITEM_ID = 49001;
exports.RESCUE_PURPLE_FRAGMENT_ITEM_ID = 49002;
// These groups are added to AdditionalRewardTable by the matching
// 1.4.58 -> 1.4.59 client asset patch. Unpatched clients still receive the
// inventory item; patched clients also render it on the result screen.
exports.RESCUE_SILVER_FRAGMENT_ADDITIONAL_REWARD_GROUP_ID = 490000;
exports.RESCUE_GOLD_FRAGMENT_ADDITIONAL_REWARD_GROUP_ID = 490001;
exports.RESCUE_PURPLE_FRAGMENT_ADDITIONAL_REWARD_GROUP_ID = 490002;
const rescueFragmentItemByCategoryAndQuest = new Map();
function canonicalRewardCategory(category) {
    const normalizedCategory = Math.trunc(category);
    // The CN AdventEvent client posts category 7 for multiplayer battles,
    // while older callers and the server enum use category 8. They share one
    // quest master and therefore one rescue-fragment schedule.
    return normalizedCategory === types_1.QuestCategory.ADVENT_EVENT_SINGLE
        ? types_1.QuestCategory.ADVENT_EVENT_MULTI
        : normalizedCategory;
}
function rewardKey(category, questId) {
    return `${canonicalRewardCategory(category)}:${Math.abs(Math.trunc(questId))}`;
}
function registerReward(category, questId, itemId) {
    rescueFragmentItemByCategoryAndQuest.set(rewardKey(category, questId), itemId);
}
function groupBattleQuestIds(table) {
    var _a;
    const groups = new Map();
    for (const [rawQuestId, quest] of Object.entries(table)) {
        const questId = Number(rawQuestId);
        if (!Number.isSafeInteger(questId) || quest.rankPointReward === undefined)
            continue;
        const groupId = Math.floor(questId / 1000);
        const group = (_a = groups.get(groupId)) !== null && _a !== void 0 ? _a : [];
        group.push(questId);
        groups.set(groupId, group);
    }
    return [...groups.values()].map(group => group.sort((a, b) => a - b));
}
function registerSequentialDifficultyRewards(category, table) {
    for (const questIds of groupBattleQuestIds(table)) {
        for (let index = 0; index < questIds.length; index++) {
            let itemId;
            if (questIds.length <= 2) {
                itemId = index === 0
                    ? exports.RESCUE_SILVER_FRAGMENT_ITEM_ID
                    : exports.RESCUE_GOLD_FRAGMENT_ITEM_ID;
            }
            else if (questIds.length === 3) {
                itemId = index === 0
                    ? exports.RESCUE_SILVER_FRAGMENT_ITEM_ID
                    : index === 1
                        ? exports.RESCUE_GOLD_FRAGMENT_ITEM_ID
                        : exports.RESCUE_PURPLE_FRAGMENT_ITEM_ID;
            }
            else {
                itemId = index <= 1
                    ? exports.RESCUE_SILVER_FRAGMENT_ITEM_ID
                    : index === 2
                        ? exports.RESCUE_GOLD_FRAGMENT_ITEM_ID
                        : exports.RESCUE_PURPLE_FRAGMENT_ITEM_ID;
            }
            registerReward(category, questIds[index], itemId);
        }
    }
}
// Normal and later-added permanent bosses.
for (const questIds of groupBattleQuestIds(boss_tables_1.serverBossBattleQuests)) {
    const bossId = Math.floor(questIds[0] / 1000);
    for (const questId of questIds) {
        const difficulty = questId % 1000;
        let itemId;
        if (bossId === 1001) {
            // V・Solas and its later-added special variants do not form one
            // continuous difficulty ladder.
            itemId = difficulty === 1
                ? exports.RESCUE_SILVER_FRAGMENT_ITEM_ID
                : difficulty === 2
                    ? exports.RESCUE_GOLD_FRAGMENT_ITEM_ID
                    : exports.RESCUE_PURPLE_FRAGMENT_ITEM_ID;
        }
        else if (bossId === 1020) {
            // Yamata-no-Orochi has only three configured difficulties. Its
            // final "Super" rescue reward is gold on this server.
            itemId = difficulty === 1
                ? exports.RESCUE_SILVER_FRAGMENT_ITEM_ID
                : exports.RESCUE_GOLD_FRAGMENT_ITEM_ID;
        }
        else {
            itemId = difficulty <= 2
                ? exports.RESCUE_SILVER_FRAGMENT_ITEM_ID
                : difficulty === 3
                    ? exports.RESCUE_GOLD_FRAGMENT_ITEM_ID
                    : exports.RESCUE_PURPLE_FRAGMENT_ITEM_ID;
        }
        registerReward(types_1.QuestCategory.BOSS_BATTLE, questId, itemId);
    }
}
// Limited-event co-op bosses. Story-only rows are excluded by the absence of
// rankPointReward; the remaining rows are the actual battle difficulty ladder.
registerSequentialDifficultyRewards(types_1.QuestCategory.ADVENT_EVENT_MULTI, advent_event_quest_json_1.default);
// World-story event boss tables commonly interleave two single-player rows
// followed by the same two co-op rows. Each pair is Advanced / Advanced+.
for (const questIds of groupBattleQuestIds(world_story_event_boss_battle_quest_json_1.default)) {
    for (let index = 0; index < questIds.length; index++) {
        const pairIndex = questIds.length >= 4 ? index % 2 : index;
        registerReward(types_1.QuestCategory.WORLD_STORY_EVENT_BOSS_BATTLE, questIds[index], pairIndex === 0
            ? exports.RESCUE_SILVER_FRAGMENT_ITEM_ID
            : exports.RESCUE_GOLD_FRAGMENT_ITEM_ID);
    }
}
// Raid-event IDs contain a few short/offset blocks, so use the configured
// rank-point tier instead of deriving a difficulty from the numeric suffix.
for (const [rawQuestId, quest] of Object.entries(raid_event_quest_json_1.default)) {
    const questId = Number(rawQuestId);
    if (!Number.isSafeInteger(questId))
        continue;
    const rankPointReward = quest.rankPointReward;
    registerReward(types_1.QuestCategory.RAID_EVENT, questId, rankPointReward <= 50
        ? exports.RESCUE_SILVER_FRAGMENT_ITEM_ID
        : rankPointReward < 100
            ? exports.RESCUE_GOLD_FRAGMENT_ITEM_ID
            : exports.RESCUE_PURPLE_FRAGMENT_ITEM_ID);
}
// Every configured hard-multi quest is a decisive/special steam-robot battle.
// This intentionally includes the three post-added IDs 100000001-100002001.
for (const rawQuestId of Object.keys(hard_multi_event_quest_json_1.default)) {
    const questId = Number(rawQuestId);
    if (!Number.isSafeInteger(questId))
        continue;
    registerReward(types_1.QuestCategory.HARD_MULTI_EVENT, questId, exports.RESCUE_PURPLE_FRAGMENT_ITEM_ID);
}
/**
 * Returns the repeatable reward for one successful rescue clear.
 *
 * Rewards are registered only for quest IDs that exist in the shipped master
 * tables. This covers permanent bosses, limited co-op events, world-story
 * bosses, raid-event quests and all decisive steam robots without accepting
 * arbitrary IDs that merely resemble a valid difficulty suffix.
 */
function getRescueFragmentReward(category, questId) {
    const itemId = rescueFragmentItemByCategoryAndQuest.get(rewardKey(category, questId));
    if (itemId === undefined)
        return null;
    return {
        type: types_1.RewardType.ITEM,
        id: itemId,
        count: 10,
    };
}
exports.getRescueFragmentReward = getRescueFragmentReward;
function getEligibleRescueFragmentReward(category, questId, questAccomplished, isFragmentRewardEligible) {
    if (!questAccomplished || !isFragmentRewardEligible)
        return null;
    return getRescueFragmentReward(category, questId);
}
exports.getEligibleRescueFragmentReward = getEligibleRescueFragmentReward;
function getRescueFragmentAdditionalReward(reward) {
    if (reward === null || reward.type !== types_1.RewardType.ITEM)
        return null;
    const itemReward = reward;
    let groupId;
    switch (itemReward.id) {
        case exports.RESCUE_SILVER_FRAGMENT_ITEM_ID:
            groupId = exports.RESCUE_SILVER_FRAGMENT_ADDITIONAL_REWARD_GROUP_ID;
            break;
        case exports.RESCUE_GOLD_FRAGMENT_ITEM_ID:
            groupId = exports.RESCUE_GOLD_FRAGMENT_ADDITIONAL_REWARD_GROUP_ID;
            break;
        case exports.RESCUE_PURPLE_FRAGMENT_ITEM_ID:
            groupId = exports.RESCUE_PURPLE_FRAGMENT_ADDITIONAL_REWARD_GROUP_ID;
            break;
        default:
            return null;
    }
    return {
        group_id: groupId,
        index: 1,
        number: itemReward.count,
    };
}
exports.getRescueFragmentAdditionalReward = getRescueFragmentAdditionalReward;
