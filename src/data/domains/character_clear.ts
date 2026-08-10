import { getDb } from "../db";

export function getPlayerCharacterClearSync(playerId: number, characterId: number) {
    const row = getDb().prepare(`
    SELECT clear_count, multi_count, leader_clear_count, leader_multi_count, leader_power_flip_count FROM players_character_quest_clears
    WHERE player_id = ? AND character_id = ?
    `).get(playerId, characterId) as { clear_count: number; multi_count: number; leader_clear_count: number; leader_multi_count: number; leader_power_flip_count: number } | undefined;
    return row || { clear_count: 0, multi_count: 0, leader_clear_count: 0, leader_multi_count: 0, leader_power_flip_count: 0 };
}

function characterClearPositiveSafe(value: unknown, name: string): number {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new TypeError(`${name} must be a finite number`)
    }
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new RangeError(`${name} must be a positive safe integer`)
    }
    return value
}

function characterClearCounter(value: unknown, name: string): number {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new TypeError(`${name} must be a finite number`)
    }
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new RangeError(`${name} must be a non-negative safe integer`)
    }
    return value
}

export function getPlayerCharacterClearsSync(playerId: number) {
    const rows = getDb().prepare(`
    SELECT character_id, clear_count, multi_count,
           leader_clear_count, leader_multi_count, leader_power_flip_count
    FROM players_character_quest_clears
    WHERE player_id = ?
    ORDER BY character_id
    `).all(characterClearPositiveSafe(playerId, "playerId")) as Array<Record<string, unknown>>

    return Object.fromEntries(rows.map(row => [
        String(characterClearPositiveSafe(row.character_id, "stored characterId")),
        {
            clear_count: characterClearCounter(row.clear_count, "stored clearCount"),
            multi_count: characterClearCounter(row.multi_count, "stored multiCount"),
            leader_clear_count: characterClearCounter(row.leader_clear_count, "stored leaderClearCount"),
            leader_multi_count: characterClearCounter(row.leader_multi_count, "stored leaderMultiCount"),
            leader_power_flip_count: characterClearCounter(
                row.leader_power_flip_count,
                "stored leaderPowerFlipCount",
            ),
        },
    ]))
}

export function incrementPlayerCharacterClearSync(playerId: number, characterId: number, isMulti: boolean, isLeader = false) {
    const db = getDb();
    db.prepare(`
    INSERT INTO players_character_quest_clears (player_id, character_id, clear_count, multi_count, leader_clear_count, leader_multi_count)
    VALUES (?, ?, 1, ?, ?, ?)
    ON CONFLICT(player_id, character_id) DO UPDATE SET
        clear_count = clear_count + 1,
        multi_count = multi_count + ?,
        leader_clear_count = leader_clear_count + ?,
        leader_multi_count = leader_multi_count + ?
    `).run(playerId, characterId, isMulti ? 1 : 0, isLeader ? 1 : 0, isMulti && isLeader ? 1 : 0, isMulti ? 1 : 0, isLeader ? 1 : 0, isMulti && isLeader ? 1 : 0);
}
