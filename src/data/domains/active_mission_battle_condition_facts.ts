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

function storedCounter(value: unknown, name: string): number {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new TypeError(`${name} is not a finite number`)
    }
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new RangeError(`${name} is not a non-negative safe integer`)
    }
    return value
}

export function getActiveMissionConditionalBattleFactsSync(
    playerId: number,
): Record<string, number> {
    const validPlayerId = positiveSafeInteger(playerId, "playerId")
    const rows = getDb().prepare(`
        SELECT pattern, character_id, progress
        FROM players_active_mission_battle_condition_facts
        WHERE player_id = ?
        ORDER BY pattern, character_id
    `).all(validPlayerId) as Array<{
        pattern: unknown
        character_id: unknown
        progress: unknown
    }>

    const result: Record<string, number> = {}
    for (const row of rows) {
        const pattern = positiveSafeInteger(row.pattern, "stored pattern")
        const characterId = positiveSafeInteger(row.character_id, "stored characterId")
        result[`${pattern}:${characterId}`] = storedCounter(row.progress, "stored progress")
    }
    return result
}

export function incrementActiveMissionConditionalBattleFactSync(
    playerId: number,
    pattern: number,
    characterId: number,
): void {
    const validPlayerId = positiveSafeInteger(playerId, "playerId")
    const validPattern = positiveSafeInteger(pattern, "pattern")
    const validCharacterId = positiveSafeInteger(characterId, "characterId")
    const result = getDb().prepare(`
        INSERT INTO players_active_mission_battle_condition_facts
            (player_id, pattern, character_id, progress)
        VALUES (?, ?, ?, 1)
        ON CONFLICT(player_id, pattern, character_id) DO UPDATE SET
            progress = progress + 1
        WHERE typeof(progress) = 'integer'
          AND progress >= 0
          AND progress < ?
    `).run(validPlayerId, validPattern, validCharacterId, Number.MAX_SAFE_INTEGER)
    if (result.changes !== 1) {
        throw new RangeError("conditional battle progress cannot be incremented safely")
    }
}
