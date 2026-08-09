import { getRankDegree } from "./stamina"

export function resolveAttentionEstablisherRank(rankPoint: number): number {
    // The client declares this field as PlayerRank, so it expects the
    // player's actual rank degree (up to 250), not a quest-rank ID.
    return getRankDegree(rankPoint)
}
