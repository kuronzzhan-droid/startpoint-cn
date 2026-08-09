import { getAccountFromPlayerIdSync, getPlayerSync } from "../data/domains/player"
import type { Player } from "../data/types"
import { getConfigSync } from "./assets"
import { getRankDegree } from "./stamina"

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Official-style beginner eligibility used by rescue notices and missions.
 * A host must still be within both the configured rank and account-age limits.
 */
export function isNewbiePlayerSync(
    playerId: number,
    player: Player | null = getPlayerSync(playerId),
    nowMs: number = Date.now(),
): boolean {
    if (!player) return false

    const config = getConfigSync()
    const maxRank = Math.max(0, Number(config.newbie_rank) || 0)
    const maxDays = Math.max(0, Number(config.newbie_days) || 0)
    if (maxRank <= 0 || maxDays <= 0) return false
    if (getRankDegree(player.rankPoint || 0) > maxRank) return false

    const account = getAccountFromPlayerIdSync(playerId)
    const startedAt = account?.firstLoginTime?.getTime()
        ?? account?.regTime?.getTime()
        ?? Number.NaN
    if (!Number.isFinite(startedAt)) return false

    return nowMs >= startedAt && nowMs - startedAt <= maxDays * DAY_MS
}
