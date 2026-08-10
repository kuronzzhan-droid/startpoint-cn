import { getDb } from "../db"

function positiveSafeInteger(value: unknown, name: string): number {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new TypeError(`${name} must be a finite number`)
    }
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new RangeError(`${name} must be a positive safe integer`)
    }
    return value
}

function canonicalId(value: number | string, name: string): number {
    if (typeof value === "number") return positiveSafeInteger(value, name)
    if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
        throw new TypeError(`${name} must be a canonical positive decimal integer`)
    }
    const parsed = Number(value)
    if (!Number.isSafeInteger(parsed)) {
        throw new RangeError(`${name} must be a positive safe integer`)
    }
    return parsed
}

function storedCounter(value: unknown): number {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new TypeError("stored progress is not a finite number")
    }
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new RangeError("stored progress is not a non-negative safe integer")
    }
    return value
}

export function getActiveMissionBattleFactsSync(playerId: number): Record<string, number> {
    const validPlayerId = positiveSafeInteger(playerId, "playerId")
    const rows = getDb().prepare(`
        SELECT mission_id, progress
        FROM players_active_mission_battle_facts
        WHERE player_id = ?
        ORDER BY mission_id
    `).all(validPlayerId) as Array<{ mission_id: unknown; progress: unknown }>

    const result: Record<string, number> = {}
    for (const row of rows) {
        const missionId = positiveSafeInteger(row.mission_id, "stored missionId")
        result[String(missionId)] = storedCounter(row.progress)
    }
    return result
}

export function incrementActiveMissionBattleFactSync(
    playerId: number,
    missionId: number | string,
    amount = 1,
): void {
    const validPlayerId = positiveSafeInteger(playerId, "playerId")
    const validMissionId = canonicalId(missionId, "missionId")
    const validAmount = positiveSafeInteger(amount, "amount")
    const result = getDb().prepare(`
        INSERT INTO players_active_mission_battle_facts (player_id, mission_id, progress)
        VALUES (?, ?, ?)
        ON CONFLICT(player_id, mission_id) DO UPDATE SET
            progress = progress + excluded.progress
        WHERE typeof(progress) = 'integer'
          AND progress >= 0
          AND progress <= ?
    `).run(
        validPlayerId,
        validMissionId,
        validAmount,
        Number.MAX_SAFE_INTEGER - validAmount,
    )
    if (result.changes !== 1) {
        throw new RangeError("battle progress cannot be incremented safely")
    }
}
