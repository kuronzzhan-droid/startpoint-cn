"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assertLeaderboardSettlementNotCancelled = exports.configureLeaderboardSettlementCancellation = exports.LeaderboardSettlementCancelledError = void 0;
class LeaderboardSettlementCancelledError extends Error {
    constructor(reason = "Leaderboard settlement cancelled during shutdown; check the committed season before retrying.") {
        super(reason);
        this.code = "LEADERBOARD_CANCELLED";
        this.statusCode = 503;
    }
}
exports.LeaderboardSettlementCancelledError = LeaderboardSettlementCancelledError;
let cancellation;
/** Only the dedicated worker configures this; the shared flag works during synchronous SQL. */
function configureLeaderboardSettlementCancellation(buffer) {
    cancellation = buffer === undefined ? undefined : new Int32Array(buffer);
}
exports.configureLeaderboardSettlementCancellation = configureLeaderboardSettlementCancellation;
function assertLeaderboardSettlementNotCancelled() {
    if (cancellation && Atomics.load(cancellation, 0) !== 0)
        throw new LeaderboardSettlementCancelledError();
}
exports.assertLeaderboardSettlementNotCancelled = assertLeaderboardSettlementNotCancelled;
