import { getDb } from "../../data/db"
import { countLeaderboardRanksSync, type LeaderboardRankFilter } from "../../data/domains/leaderboard"

/** A synchronous safety ceiling, not a guarantee of latency on every host. */
export const SYNCHRONOUS_SETTLEMENT_LIMITS = Object.freeze({
    runs: 10_000, rounds: 100_000, players: 2_000, mailBytes: 8 * 1024 * 1024,
})

export class LeaderboardSyncLimitError extends Error {
    readonly code = "LEADERBOARD_SYNC_LIMIT"
    readonly statusCode = 409
    constructor(readonly resource: keyof typeof SYNCHRONOUS_SETTLEMENT_LIMITS, readonly observed: number) {
        super("本榜单超出同步结算安全上限，尚未发奖；请安排专门维护后再结算。")
    }
}

export function checkSynchronousSettlementSize(
    key: string, season: number, filter: LeaderboardRankFilter,
    config: { mailSubject: string; mailBody: string },
): number {
    const db = getDb(), limits = SYNCHRONOUS_SETTLEMENT_LIMITS
    // LIMIT is inside each count: rejected jobs never scan/sort all ranks.
    // Existing competition/season and run/round indexes bound these probes.
    const runs = (db.prepare(`SELECT count(*) n FROM (
        SELECT 1 FROM leaderboard_runs WHERE competition_key=? AND season=? LIMIT ?
    )`).get(key, season, limits.runs + 1) as { n: number }).n
    if (runs > limits.runs) throw new LeaderboardSyncLimitError("runs", runs)
    const rounds = (db.prepare(`SELECT count(*) n FROM (
        SELECT 1 FROM leaderboard_runs r JOIN leaderboard_run_rounds rr ON rr.run_id=r.id
        WHERE r.competition_key=? AND r.season=? LIMIT ?
    )`).get(key, season, limits.rounds + 1) as { n: number }).n
    if (rounds > limits.rounds) throw new LeaderboardSyncLimitError("rounds", rounds)
    const total = countLeaderboardRanksSync(key, season, filter)
    if (total > limits.players) throw new LeaderboardSyncLimitError("players", total)
    // Each player can receive an item mail and a degree mail, including rank text.
    const mailBytes = total * 2 * (Buffer.byteLength(config.mailSubject) + Buffer.byteLength(config.mailBody) + 128)
    if (mailBytes > limits.mailBytes) throw new LeaderboardSyncLimitError("mailBytes", mailBytes)
    return total
}
