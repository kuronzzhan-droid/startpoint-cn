export interface ScoreAttackRewardSlot {
    kind: number
    id?: number
    amount: number
}

export interface ScoreAttackBorderTier {
    id: number
    eventId: number
    questId: number
    score: number
    reasonId: number
    rewards: ScoreAttackRewardSlot[]
}

export interface ScoreAttackBorderRewardResolution {
    rewardIds: number[]
    itemCounts: Record<string, number>
}

export interface ScoreAttackRankThresholds {
    bRankScore: number
    aRankScore: number
    sRankScore: number
    ssRankScore: number
}

export function resolveScoreAttackBorderTiers(
    eventId: number | undefined,
    localQuestId: number | undefined,
    tierMap: Record<string, ScoreAttackBorderTier[]>,
): ScoreAttackBorderTier[] {
    if (!Number.isInteger(eventId) || !Number.isInteger(localQuestId)) {
        throw new Error("Score attack event or local quest id is missing.")
    }
    const key = `${eventId}_${localQuestId}`
    const tiers = tierMap[key]
    if (!Array.isArray(tiers) || tiers.length === 0) {
        throw new Error(`Score attack border tiers are missing for ${key}.`)
    }
    if (tiers.some(tier => !Number.isInteger(tier.id) || tier.id <= 0
        || !Number.isFinite(tier.score) || tier.score < 0
        || !Array.isArray(tier.rewards)
        || tier.rewards.some(reward => reward.kind !== 0
            || !Number.isInteger(reward.id) || reward.id! <= 0
            || !Number.isInteger(reward.amount) || reward.amount <= 0))) {
        throw new Error(`Score attack border tiers are invalid for ${key}.`)
    }
    return [...tiers].sort((left, right) => left.score - right.score)
}

export function calculateScoreAttackClearRank(
    score: number,
    thresholds: ScoreAttackRankThresholds,
): number {
    if (!Number.isFinite(score) || score < 0) return 1
    if (score >= thresholds.ssRankScore) return 5
    if (score >= thresholds.sRankScore) return 4
    if (score >= thresholds.aRankScore) return 3
    if (score >= thresholds.bRankScore) return 2
    return 1
}

/** Return all cumulative borders newly crossed by this score. */
export function resolveNewScoreAttackBorderRewards(
    tiers: ScoreAttackBorderTier[],
    previousHighScore: number,
    currentScore: number,
): ScoreAttackBorderRewardResolution {
    const rewardIds: number[] = []
    const itemCounts: Record<string, number> = {}

    tiers.slice().sort((left, right) => left.score - right.score).forEach((tier, index) => {
        if (tier.score <= previousHighScore || tier.score > currentScore) return

        rewardIds.push(tier.id)
        for (const reward of tier.rewards) {
            if (reward.kind !== 0 || reward.id === undefined) {
                throw new Error(`Unsupported score attack reward in tier ${tier.id}.`)
            }
            const itemId = String(reward.id)
            itemCounts[itemId] = (itemCounts[itemId] ?? 0) + reward.amount
        }
    })

    return { rewardIds, itemCounts }
}

export function collectScoreAttackMainCharacterIds(
    characters: ({ id: number | null } | null)[],
): Record<string, number> {
    const result: Record<string, number> = {}
    characters.forEach((character, index) => {
        if (character?.id !== null && character?.id !== undefined) {
            result[String(index)] = character.id
        }
    })
    return result
}
