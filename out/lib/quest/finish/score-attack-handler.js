"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.collectScoreAttackMainCharacterIds = exports.resolveNewScoreAttackBorderRewards = exports.calculateScoreAttackClearRank = exports.resolveScoreAttackBorderTiers = void 0;
function resolveScoreAttackBorderTiers(eventId, localQuestId, tierMap) {
    if (!Number.isInteger(eventId) || !Number.isInteger(localQuestId)) {
        throw new Error("Score attack event or local quest id is missing.");
    }
    const key = `${eventId}_${localQuestId}`;
    const tiers = tierMap[key];
    if (!Array.isArray(tiers) || tiers.length === 0) {
        throw new Error(`Score attack border tiers are missing for ${key}.`);
    }
    if (tiers.some(tier => !Number.isInteger(tier.id) || tier.id <= 0
        || !Number.isFinite(tier.score) || tier.score < 0
        || !Array.isArray(tier.rewards)
        || tier.rewards.some(reward => reward.kind !== 0
            || !Number.isInteger(reward.id) || reward.id <= 0
            || !Number.isInteger(reward.amount) || reward.amount <= 0))) {
        throw new Error(`Score attack border tiers are invalid for ${key}.`);
    }
    return [...tiers].sort((left, right) => left.score - right.score);
}
exports.resolveScoreAttackBorderTiers = resolveScoreAttackBorderTiers;
function calculateScoreAttackClearRank(score, thresholds) {
    if (!Number.isFinite(score) || score < 0)
        return 1;
    if (score >= thresholds.ssRankScore)
        return 5;
    if (score >= thresholds.sRankScore)
        return 4;
    if (score >= thresholds.aRankScore)
        return 3;
    if (score >= thresholds.bRankScore)
        return 2;
    return 1;
}
exports.calculateScoreAttackClearRank = calculateScoreAttackClearRank;
/** Return all cumulative borders newly crossed by this score. */
function resolveNewScoreAttackBorderRewards(tiers, previousHighScore, currentScore) {
    const rewardIds = [];
    const itemCounts = {};
    tiers.slice().sort((left, right) => left.score - right.score).forEach((tier, index) => {
        var _a;
        if (tier.score <= previousHighScore || tier.score > currentScore)
            return;
        rewardIds.push(tier.id);
        for (const reward of tier.rewards) {
            if (reward.kind !== 0 || reward.id === undefined) {
                throw new Error(`Unsupported score attack reward in tier ${tier.id}.`);
            }
            const itemId = String(reward.id);
            itemCounts[itemId] = ((_a = itemCounts[itemId]) !== null && _a !== void 0 ? _a : 0) + reward.amount;
        }
    });
    return { rewardIds, itemCounts };
}
exports.resolveNewScoreAttackBorderRewards = resolveNewScoreAttackBorderRewards;
function collectScoreAttackMainCharacterIds(characters) {
    const result = {};
    characters.forEach((character, index) => {
        if ((character === null || character === void 0 ? void 0 : character.id) !== null && (character === null || character === void 0 ? void 0 : character.id) !== undefined) {
            result[String(index)] = character.id;
        }
    });
    return result;
}
exports.collectScoreAttackMainCharacterIds = collectScoreAttackMainCharacterIds;
