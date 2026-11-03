"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listBossRewardProfiles = exports.resolveBossTokenCount = exports.getBossRewardProfile = void 0;
/**
 * Permanent boss reward profiles are keyed by both quest and score group.
 * Adding another boss means appending one immutable profile and its master
 * tables; existing bosses keep their original reward behavior.
 */
const BOSS_REWARD_PROFILES = Object.freeze([
    Object.freeze({
        profileId: "orochi-boss-v2",
        questId: 1020004,
        scoreGroupId: 209990,
        tokenItemId: 40193,
        tokenCount: Object.freeze({ solo: 1, multi: 3 }),
        rareGroupId: 3099900,
        rareCharacterId: 129990,
        rareChanceBasisPoints: 100,
    }),
]);
function optionalSafeInteger(value) {
    return value !== undefined && Number.isSafeInteger(value) && value > 0
        ? value
        : undefined;
}
function getBossRewardProfile(questId, scoreGroupId) {
    var _a;
    const normalizedQuestId = optionalSafeInteger(questId);
    const normalizedScoreGroupId = optionalSafeInteger(scoreGroupId);
    if (normalizedQuestId === undefined && normalizedScoreGroupId === undefined)
        return null;
    return (_a = BOSS_REWARD_PROFILES.find(profile => (normalizedQuestId === undefined || profile.questId === normalizedQuestId)
        && (normalizedScoreGroupId === undefined || profile.scoreGroupId === normalizedScoreGroupId))) !== null && _a !== void 0 ? _a : null;
}
exports.getBossRewardProfile = getBossRewardProfile;
function resolveBossTokenCount(profile, mode) {
    return profile.tokenCount[mode];
}
exports.resolveBossTokenCount = resolveBossTokenCount;
function listBossRewardProfiles() {
    return BOSS_REWARD_PROFILES;
}
exports.listBossRewardProfiles = listBossRewardProfiles;
