export class LeaderboardSettlementCancelledError extends Error {
    readonly code = "LEADERBOARD_CANCELLED"
    readonly statusCode = 503
    constructor(reason = "Leaderboard settlement cancelled during shutdown; check the committed season before retrying.") {
        super(reason)
    }
}

let cancellation: Int32Array | undefined

/** Only the dedicated worker configures this; the shared flag works during synchronous SQL. */
export function configureLeaderboardSettlementCancellation(buffer?: SharedArrayBuffer): void {
    cancellation = buffer === undefined ? undefined : new Int32Array(buffer)
}

export function assertLeaderboardSettlementNotCancelled(): void {
    if (cancellation && Atomics.load(cancellation, 0) !== 0) throw new LeaderboardSettlementCancelledError()
}
