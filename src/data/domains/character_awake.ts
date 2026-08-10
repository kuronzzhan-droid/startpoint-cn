import { getDb } from "../db"

export type CharacterAwakeUnlockMap = Map<string, Record<number, number>>

function positiveSafeInteger(value: unknown, name: string): number {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new TypeError(`${name} must be a finite number`)
    }
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new RangeError(`${name} must be a positive safe integer`)
    }
    return value
}

export function getPlayerCharacterAwakeUnlocksSync(
    playerId: number,
): CharacterAwakeUnlockMap {
    const validPlayerId = positiveSafeInteger(playerId, "playerId")
    const rows = getDb().prepare(`
        SELECT character_id, board_index, awake_level
        FROM players_character_awake_unlocks
        WHERE player_id = ?
        ORDER BY character_id, board_index
    `).all(validPlayerId) as Array<{
        character_id: unknown
        board_index: unknown
        awake_level: unknown
    }>

    const result: CharacterAwakeUnlockMap = new Map()
    for (const row of rows) {
        const characterId = positiveSafeInteger(row.character_id, "stored characterId")
        const boardIndex = positiveSafeInteger(row.board_index, "stored boardIndex")
        const awakeLevel = positiveSafeInteger(row.awake_level, "stored awakeLevel")
        const awakeLevels = result.get(String(characterId)) ?? {}
        awakeLevels[boardIndex] = awakeLevel
        result.set(String(characterId), awakeLevels)
    }
    return result
}

export function upsertPlayerCharacterAwakeUnlockSync(
    playerId: number,
    characterId: number,
    boardIndex: number,
    awakeLevel: number,
): boolean {
    const validPlayerId = positiveSafeInteger(playerId, "playerId")
    const validCharacterId = positiveSafeInteger(characterId, "characterId")
    const validBoardIndex = positiveSafeInteger(boardIndex, "boardIndex")
    const validAwakeLevel = positiveSafeInteger(awakeLevel, "awakeLevel")
    const database = getDb()
    const result = database.prepare(`
        INSERT INTO players_character_awake_unlocks
            (player_id, character_id, board_index, awake_level)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(player_id, character_id, board_index) DO UPDATE SET
            awake_level = excluded.awake_level
        WHERE typeof(awake_level) = 'integer'
          AND awake_level > 0
          AND excluded.awake_level > awake_level
    `).run(validPlayerId, validCharacterId, validBoardIndex, validAwakeLevel)
    if (result.changes === 1) return true

    const row = database.prepare(`
        SELECT awake_level FROM players_character_awake_unlocks
        WHERE player_id = ? AND character_id = ? AND board_index = ?
    `).get(validPlayerId, validCharacterId, validBoardIndex) as { awake_level: unknown } | undefined
    if (row === undefined) {
        throw new Error("awake unlock upsert did not affect its target row")
    }
    const storedAwakeLevel = positiveSafeInteger(row.awake_level, "stored awakeLevel")
    if (storedAwakeLevel >= validAwakeLevel) return false
    throw new Error("awake unlock upsert was rejected unexpectedly")
}
