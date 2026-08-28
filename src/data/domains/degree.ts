/**
 * Owned degrees (称号/铭牌).
 *
 * The client's degree-select list is built entirely from what
 * `/profile/get_degree_list` returns (see the decompiled
 * `pinball/loading/degree/DegreeSelectLoadingTask.as`), so "owning" a title is
 * purely a server-side fact. `players.degree_id` only records the one being
 * worn; this table records the set to choose from.
 *
 * The table is created on demand rather than in the initializer so that
 * existing databases (which already carry it) and fresh ones behave the same
 * without a schema version bump.
 */
import { getDb } from "../db"

export function ensurePlayerDegreesTableSync(): void {
    getDb().exec(`
    CREATE TABLE IF NOT EXISTS players_degrees (
        player_id INTEGER NOT NULL,
        degree_id INTEGER NOT NULL,
        PRIMARY KEY (player_id, degree_id),
        FOREIGN KEY (player_id) REFERENCES players (id) ON DELETE CASCADE
    )
    `)
}

/**
 * Every degree ID the player has been granted, ascending.
 */
export function getPlayerDegreeIdsSync(playerId: number): number[] {
    ensurePlayerDegreesTableSync()
    const rows = getDb().prepare(`
    SELECT degree_id
    FROM players_degrees
    WHERE player_id = ?
    ORDER BY degree_id
    `).all(playerId) as { degree_id: number }[]

    return rows.map(row => row.degree_id)
}

/**
 * Grants a degree. Re-granting is a no-op rather than an error.
 */
export function grantPlayerDegreeSync(playerId: number, degreeId: number): void {
    ensurePlayerDegreesTableSync()
    getDb().prepare(`
    INSERT OR IGNORE INTO players_degrees (player_id, degree_id)
    VALUES (?, ?)
    `).run(playerId, degreeId)
}

/**
 * Revokes a degree. Revoking one that was never granted is a no-op.
 */
export function revokePlayerDegreeSync(playerId: number, degreeId: number): void {
    ensurePlayerDegreesTableSync()
    getDb().prepare(`
    DELETE FROM players_degrees
    WHERE player_id = ? AND degree_id = ?
    `).run(playerId, degreeId)
}
