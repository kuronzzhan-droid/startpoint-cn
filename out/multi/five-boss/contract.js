"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isFiveBossHiddenQuest = exports.isFiveBossGauntletQuest = exports.FIVE_BOSS_GAUNTLET = void 0;
const types_1 = require("../../lib/types");
/**
 * Runtime identifiers shared by the multiplayer route and the generated client package.
 * The cross-stack test pins these values to mod-tools/five_boss_coop_v1.json.
 */
exports.FIVE_BOSS_GAUNTLET = Object.freeze({
    routeId: "five_boss_coop_v1",
    category: types_1.QuestCategory.BOSS_BATTLE,
    visibleQuestId: 1099001,
    hiddenQuestIds: [1099002, 1099003],
    ticketItemId: 10000143,
    staminaCost: 35,
    minimumGuestPlayerRank: 130,
    roomMemberLimit: 3,
    sceneBossCounts: [3, 4],
    aiFillTimeoutMs: 120000,
    maxContinueCount: 1,
    continueVmoneyCost: 50,
});
function isFiveBossGauntletQuest(category, questId) {
    return category === exports.FIVE_BOSS_GAUNTLET.category
        && questId === exports.FIVE_BOSS_GAUNTLET.visibleQuestId;
}
exports.isFiveBossGauntletQuest = isFiveBossGauntletQuest;
function isFiveBossHiddenQuest(category, questId) {
    return category === exports.FIVE_BOSS_GAUNTLET.category
        && exports.FIVE_BOSS_GAUNTLET.hiddenQuestIds.includes(questId);
}
exports.isFiveBossHiddenQuest = isFiveBossHiddenQuest;
