import { getLeaderboardCompetition } from "./competition"
import { runPersistenceTransaction } from "../persistence-coordinator"
import { withServerWorkAdmission } from "../shutdown-state"

export class LeaderboardWorkBusyError extends Error {
    readonly statusCode = 429
    readonly code = "LEADERBOARD_BUSY"
    constructor() { super("排行榜维护繁忙，请稍后重试。") }
}

/** One accepted maintenance job; repeated admin clicks never accumulate work. */
export function createLeaderboardWorkControl(clock: () => number = Date.now) {
    let running = false, lastNow = -Infinity
    // Keys are limited to registered competitions and these two admin actions.
    const nextAllowed = new Map<string, number>()
    type Action = "settle" | "rollover" | "scheduler"
    const run = <T>(key: string, action: Action, operation: () => Promise<T>): Promise<T> => withServerWorkAdmission(async () => {
        if (!getLeaderboardCompetition(key)) throw new Error("Unknown leaderboard competition")
        const now = lastNow = Math.max(lastNow, clock())
        const budgetKey = `${key}:${action}`
        if (running || action !== "scheduler" && now < (nextAllowed.get(budgetKey) ?? -Infinity)) {
            throw new LeaderboardWorkBusyError()
        }
        running = true
        if (action !== "scheduler") nextAllowed.set(budgetKey, now + 2_000)
        try {
            const result = await operation()
            // A precondition failure (for example rollover before settlement)
            // must not prevent a corrected action immediately afterwards.
            if (result && typeof result === "object" && "ok" in result && result.ok === false) nextAllowed.delete(budgetKey)
            return result
        } finally { running = false }
    })
    return Object.assign(
        <T>(key: string, action: Action, operation: () => T): Promise<T> => run(key, action, () => (
            runPersistenceTransaction({ domain: "leaderboard", operation: `${action}:${key}` }, operation)
        )),
        // Async work owns its transaction on another connection. Share the same
        // one-job/cooldown control without holding a main-thread transaction.
        { background: run },
    )
}

export const runLeaderboardWork = createLeaderboardWorkControl()
