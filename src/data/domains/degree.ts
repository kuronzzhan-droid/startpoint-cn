import { getDb } from "../db"
import { getPlayerQuestProgressSync } from "./quest"

export interface RawPlayerDegree {
    player_id: number
    degree_id: number
    acquired_at: number
}

interface SoloTimeAttackDegreeRule {
    questId: number
    masteryDegreeId: number
    victoryDegreeId: number
}

const SOLO_TIME_ATTACK_DEGREE_RULES: readonly SoloTimeAttackDegreeRule[] = [
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

function positiveSafeInteger(value: unknown, name: string): number {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new TypeError(`${name} must be a finite number`)
    }
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new RangeError(`${name} must be a positive safe integer`)
    }
    return value
}

function nonNegativeSafeInteger(value: unknown, name: string): number {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new TypeError(`${name} must be a finite number`)
    }
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new RangeError(`${name} must be a non-negative safe integer`)
    }
    return value
}

export function grantPlayerDegreeSync(
    playerId: number,
    degreeId: number,
    acquiredAt: number = Date.now(),
): boolean {
    const validPlayerId = positiveSafeInteger(playerId, "playerId")
    const validDegreeId = positiveSafeInteger(degreeId, "degreeId")
    const validAcquiredAt = nonNegativeSafeInteger(acquiredAt, "acquiredAt")
    const result = getDb().prepare(`
        INSERT OR IGNORE INTO players_degrees (player_id, degree_id, acquired_at)
        VALUES (?, ?, ?)
    `).run(validPlayerId, validDegreeId, validAcquiredAt)
    if (result.changes === 0) return false
    if (result.changes === 1) return true
    throw new Error("degree grant affected an unexpected number of rows")
}

export function givePlayerDegreeSync(playerId: number, degreeId: number): boolean {
    return grantPlayerDegreeSync(playerId, degreeId)
}

export function hasPlayerDegreeSync(playerId: number, degreeId: number): boolean {
    const validPlayerId = positiveSafeInteger(playerId, "playerId")
    const validDegreeId = positiveSafeInteger(degreeId, "degreeId")
    return getDb().prepare(`
        SELECT 1 FROM players_degrees
        WHERE player_id = ? AND degree_id = ?
        LIMIT 1
    `).get(validPlayerId, validDegreeId) !== undefined
}

export function getPlayerDegreeIdsSync(playerId: number): number[] {
    const validPlayerId = positiveSafeInteger(playerId, "playerId")
    const rows = getDb().prepare(`
        SELECT degree_id, acquired_at
        FROM players_degrees
        WHERE player_id = ?
        ORDER BY acquired_at, degree_id
    `).all(validPlayerId) as Array<{ degree_id: unknown; acquired_at: unknown }>
    return rows.map(row => {
        nonNegativeSafeInteger(row.acquired_at, "stored acquiredAt")
        return positiveSafeInteger(row.degree_id, "stored degreeId")
    })
}

export function ensurePlayerLegacyDegreesSync(playerId: number, currentDegreeId: number): void {
    const validPlayerId = positiveSafeInteger(playerId, "playerId")
    const validCurrentDegreeId = currentDegreeId === 0
        ? 0
        : positiveSafeInteger(currentDegreeId, "currentDegreeId")
    getDb().transaction(() => {
        grantPlayerDegreeSync(validPlayerId, 1, 0)
        if (validCurrentDegreeId > 0) {
            grantPlayerDegreeSync(validPlayerId, validCurrentDegreeId, 0)
        }
    })()
}

export function grantPlayerSoloTimeAttackDegreesSync(
    playerId: number,
    questId: number,
    elapsedTimeMs: number,
): number[] {
    const validPlayerId = positiveSafeInteger(playerId, "playerId")
    const validQuestId = positiveSafeInteger(questId, "questId")
    const validElapsedTime = nonNegativeSafeInteger(elapsedTimeMs, "elapsedTimeMs")
    const rule = SOLO_TIME_ATTACK_DEGREE_RULES.find(entry => entry.questId === validQuestId)
    if (rule === undefined) return []

    return getDb().transaction(() => {
        const granted: number[] = []
        if (validElapsedTime <= VICTORY_TIME_LIMIT_MS
            && grantPlayerDegreeSync(validPlayerId, rule.victoryDegreeId)) {
            granted.push(rule.victoryDegreeId)
        }
        if (validElapsedTime <= MASTERY_TIME_LIMIT_MS
            && grantPlayerDegreeSync(validPlayerId, rule.masteryDegreeId)) {
            granted.push(rule.masteryDegreeId)
        }
        return granted
    })()
}

export function ensurePlayerSoloTimeAttackDegreesSync(playerId: number): number[] {
    const validPlayerId = positiveSafeInteger(playerId, "playerId")
    return getDb().transaction(() => {
        const progressList = getPlayerQuestProgressSync(validPlayerId)[SOLO_TIME_ATTACK_SECTION] ?? []
        const granted: number[] = []
        for (const progress of progressList) {
            if (!progress.finished
                || progress.bestElapsedTimeMs === null
                || progress.bestElapsedTimeMs === undefined) {
                continue
            }
            granted.push(...grantPlayerSoloTimeAttackDegreesSync(
                validPlayerId,
                positiveSafeInteger(progress.questId, "stored questId"),
                nonNegativeSafeInteger(progress.bestElapsedTimeMs, "stored bestElapsedTimeMs"),
            ))
        }
        return granted
    })()
}
