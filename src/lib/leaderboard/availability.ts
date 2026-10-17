import { getDb } from "../../data/db"
import { abandonLeaderboardRunsSync } from "../../data/domains/leaderboard"
import { runPersistenceTransactionSync } from "../persistence-coordinator"

export interface LeaderboardAvailability {
    competitionKey: string
    enabled: boolean
    updatedAtMs: number
}

export interface LeaderboardAvailabilityUpdate {
    availability: LeaderboardAvailability
    abandonedRuns: number
}

interface RawAvailability {
    competition_key: string
    enabled: number
    updated_at_ms: number
}

export function isLeaderboardDeadlineDueSync(competitionKey: string, nowMs = Date.now()): boolean {
    const config = getDb().prepare(`
        SELECT settle_at_ms, freeze_enabled, auto_enabled
        FROM leaderboard_settlement_configs WHERE competition_key = ?
    `).get(competitionKey) as {
        settle_at_ms: number | null; freeze_enabled: number; auto_enabled: number
    } | undefined
    return config !== undefined && (config.freeze_enabled !== 0 || config.auto_enabled !== 0)
        && config.settle_at_ms !== null && nowMs >= config.settle_at_ms
}

function deserializeAvailability(row: RawAvailability): LeaderboardAvailability {
    return {
        competitionKey: row.competition_key,
        enabled: row.enabled !== 0,
        updatedAtMs: row.updated_at_ms,
    }
}

export function getLeaderboardAvailabilitySync(
    competitionKey: string,
    nowMs: number = Date.now(),
): LeaderboardAvailability {
    const read = () => getDb().prepare(`
        SELECT competition_key, enabled, updated_at_ms
        FROM leaderboard_availability
        WHERE competition_key = ?
    `).get(competitionKey) as RawAvailability | undefined
    const row = read() ?? runPersistenceTransactionSync({ domain: "leaderboard", operation: "initialize_availability" }, () => {
        getDb().prepare(`INSERT OR IGNORE INTO leaderboard_availability
            (competition_key, enabled, updated_at_ms) VALUES (?, ?, ?)`)
            .run(competitionKey, competitionKey === "rush:700100:1" ? 0 : 1, nowMs)
        return read()!
    })
    if (row.enabled !== 0 && isLeaderboardDeadlineDueSync(competitionKey, nowMs)) {
        return setLeaderboardAvailabilitySync(competitionKey, false, nowMs).availability
    }
    return deserializeAvailability(row)
}

export function isLeaderboardEnabledSync(competitionKey: string, nowMs = Date.now()): boolean {
    return getLeaderboardAvailabilitySync(competitionKey, nowMs).enabled
}

export function setLeaderboardAvailabilitySync(
    competitionKey: string,
    enabled: boolean,
    updatedAtMs: number = Date.now(),
): LeaderboardAvailabilityUpdate {
    if (!Number.isSafeInteger(updatedAtMs) || updatedAtMs < 0) {
        throw new Error("updatedAtMs must be a non-negative epoch millisecond value.")
    }
    const db = getDb()
    const operation = () => {
        db.prepare(`
            INSERT INTO leaderboard_availability (
                competition_key, enabled, updated_at_ms
            ) VALUES (?, ?, ?)
            ON CONFLICT (competition_key) DO UPDATE SET
                enabled = excluded.enabled,
                updated_at_ms = excluded.updated_at_ms
        `).run(competitionKey, enabled ? 1 : 0, updatedAtMs)
        const abandonedRuns = enabled ? 0 : abandonLeaderboardRunsSync({
            competitionKey,
            endedAtMs: updatedAtMs,
        })
        return {
            availability: getLeaderboardAvailabilitySync(competitionKey, updatedAtMs),
            abandonedRuns,
        }
    }
    return db.inTransaction ? operation() : runPersistenceTransactionSync({
        domain: "leaderboard", operation: "set_leaderboard_availability",
    }, operation)
}
