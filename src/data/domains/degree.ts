import { getDb } from "../db"
import { getPlayerQuestProgressSync } from "./quest"

export interface RawPlayerDegree {
    player_id: number
    degree_id: number
    acquired_at: number
}

/**
 * Grants a title to a player. Duplicate grants are intentionally idempotent.
 * Returns true only when a new ownership row was inserted.
 */
export function grantPlayerDegreeSync(
    playerId: number,
    degreeId: number,
    acquiredAt: number = Date.now(),
): boolean {
    if (!Number.isInteger(playerId) || playerId <= 0) return false
    if (!Number.isInteger(degreeId) || degreeId <= 0) return false

    const result = getDb().prepare(`
        INSERT OR IGNORE INTO players_degrees (player_id, degree_id, acquired_at)
        VALUES (?, ?, ?)
    `).run(playerId, degreeId, acquiredAt)
    return result.changes > 0
}

export function givePlayerDegreeSync(playerId: number, degreeId: number): boolean {
    return grantPlayerDegreeSync(playerId, degreeId)
}

export function hasPlayerDegreeSync(playerId: number, degreeId: number): boolean {
    if (degreeId === 1) return true
    const row = getDb().prepare(`
        SELECT 1
        FROM players_degrees
        WHERE player_id = ? AND degree_id = ?
        LIMIT 1
    `).get(playerId, degreeId)
    return row !== undefined
}

export function getPlayerDegreeIdsSync(playerId: number): number[] {
    const rows = getDb().prepare(`
        SELECT degree_id
        FROM players_degrees
        WHERE player_id = ?
        ORDER BY acquired_at ASC, degree_id ASC
    `).all(playerId) as Pick<RawPlayerDegree, "degree_id">[]
    return rows.map(row => row.degree_id)
}

/**
 * Old saves only stored the currently equipped title on players.degree_id.
 * Keep that title and the default title when the ownership table is introduced.
 */
export function ensurePlayerLegacyDegreesSync(playerId: number, currentDegreeId: number): void {
    grantPlayerDegreeSync(playerId, 1, 0)
    if (Number.isInteger(currentDegreeId) && currentDegreeId > 0) {
        grantPlayerDegreeSync(playerId, currentDegreeId, 0)
    }
}

interface SoloTimeAttackDegreeRule {
    questId: number
    masteryDegreeId: number
    victoryDegreeId: number
}

/**
 * Extreme time trial title rewards are displayed by the client from the quest
 * result, but they are not part of mission_degree.json and therefore were
 * never persisted in players_degrees.
 *
 * Each elemental quest has a 3-minute "mastery" title and a 5-minute
 * "victory" title. A 3-minute clear also satisfies the 5-minute condition.
 */
const SOLO_TIME_ATTACK_DEGREE_RULES: SoloTimeAttackDegreeRule[] = [
    { questId: 1001, masteryDegreeId: 54500, victoryDegreeId: 54510 },
    { questId: 1002, masteryDegreeId: 54520, victoryDegreeId: 54530 },
    { questId: 1003, masteryDegreeId: 54540, victoryDegreeId: 54550 },
    { questId: 1004, masteryDegreeId: 54560, victoryDegreeId: 54570 },
    { questId: 1005, masteryDegreeId: 54580, victoryDegreeId: 54590 },
    { questId: 1006, masteryDegreeId: 54600, victoryDegreeId: 54610 },
]

const SOLO_TIME_ATTACK_SECTION = "25"
const MASTERY_TIME_LIMIT_MS = 180_000
const VICTORY_TIME_LIMIT_MS = 300_000

export function grantPlayerSoloTimeAttackDegreesSync(
    playerId: number,
    questId: number,
    elapsedTimeMs: number,
): number[] {
    if (!Number.isFinite(elapsedTimeMs) || elapsedTimeMs < 0) return []

    const rule = SOLO_TIME_ATTACK_DEGREE_RULES.find(entry => entry.questId === questId)
    if (!rule) return []

    const granted: number[] = []
    if (
        elapsedTimeMs <= VICTORY_TIME_LIMIT_MS &&
        grantPlayerDegreeSync(playerId, rule.victoryDegreeId)
    ) {
        granted.push(rule.victoryDegreeId)
    }
    if (
        elapsedTimeMs <= MASTERY_TIME_LIMIT_MS &&
        grantPlayerDegreeSync(playerId, rule.masteryDegreeId)
    ) {
        granted.push(rule.masteryDegreeId)
    }
    return granted
}

/**
 * Backfills titles for clears completed before title persistence was fixed.
 * This is intentionally idempotent and only reads each player's best time.
 */
export function ensurePlayerSoloTimeAttackDegreesSync(playerId: number): number[] {
    const progressList = getPlayerQuestProgressSync(playerId)[SOLO_TIME_ATTACK_SECTION] ?? []
    const granted: number[] = []

    for (const progress of progressList) {
        if (!progress.finished || progress.bestElapsedTimeMs === null || progress.bestElapsedTimeMs === undefined) {
            continue
        }
        granted.push(...grantPlayerSoloTimeAttackDegreesSync(
            playerId,
            progress.questId,
            progress.bestElapsedTimeMs,
        ))
    }
    return granted
}
