"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkSynchronousSettlementSize = exports.LeaderboardSyncLimitError = exports.SYNCHRONOUS_SETTLEMENT_LIMITS = void 0;
const db_1 = require("../../data/db");
const leaderboard_1 = require("../../data/domains/leaderboard");
/** A synchronous safety ceiling, not a guarantee of latency on every host. */
exports.SYNCHRONOUS_SETTLEMENT_LIMITS = Object.freeze({
    runs: 10000, rounds: 100000, players: 2000, mailBytes: 8 * 1024 * 1024,
});
class LeaderboardSyncLimitError extends Error {
    constructor(resource, observed) {
        super("本榜单超出同步结算安全上限，尚未发奖；请安排专门维护后再结算。");
        this.resource = resource;
        this.observed = observed;
        this.code = "LEADERBOARD_SYNC_LIMIT";
        this.statusCode = 409;
    }
}
exports.LeaderboardSyncLimitError = LeaderboardSyncLimitError;
function checkSynchronousSettlementSize(key, season, filter, config) {
    const db = (0, db_1.getDb)(), limits = exports.SYNCHRONOUS_SETTLEMENT_LIMITS;
    // LIMIT is inside each count: rejected jobs never scan/sort all ranks.
    // Existing competition/season and run/round indexes bound these probes.
    const runs = db.prepare(`SELECT count(*) n FROM (
        SELECT 1 FROM leaderboard_runs WHERE competition_key=? AND season=? LIMIT ?
    )`).get(key, season, limits.runs + 1).n;
    if (runs > limits.runs)
        throw new LeaderboardSyncLimitError("runs", runs);
    const rounds = db.prepare(`SELECT count(*) n FROM (
        SELECT 1 FROM leaderboard_runs r JOIN leaderboard_run_rounds rr ON rr.run_id=r.id
        WHERE r.competition_key=? AND r.season=? LIMIT ?
    )`).get(key, season, limits.rounds + 1).n;
    if (rounds > limits.rounds)
        throw new LeaderboardSyncLimitError("rounds", rounds);
    const total = (0, leaderboard_1.countLeaderboardRanksSync)(key, season, filter);
    if (total > limits.players)
        throw new LeaderboardSyncLimitError("players", total);
    // Each player can receive an item mail and a degree mail, including rank text.
    const mailBytes = total * 2 * (Buffer.byteLength(config.mailSubject) + Buffer.byteLength(config.mailBody) + 128);
    if (mailBytes > limits.mailBytes)
        throw new LeaderboardSyncLimitError("mailBytes", mailBytes);
    return total;
}
exports.checkSynchronousSettlementSize = checkSynchronousSettlementSize;
