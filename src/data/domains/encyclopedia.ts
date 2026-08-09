import { getDb } from "../db"

export interface EncyclopediaKeywordState {
    read: boolean
}

export type EncyclopediaKeywordList = Record<string, EncyclopediaKeywordState>

interface RawEncyclopediaKeyword {
    encyclopedia_id: number
    read: number
}

export interface UnlockEncyclopediaResult {
    encyclopediaList: EncyclopediaKeywordList
    itemAmount: number
    consumedKey: boolean
}

function normalizeIds(encyclopediaIds: number[]): number[] {
    return [...new Set(encyclopediaIds)]
}

function rowsToList(rows: RawEncyclopediaKeyword[]): EncyclopediaKeywordList {
    const output: EncyclopediaKeywordList = {}
    for (const row of rows) {
        output[String(row.encyclopedia_id)] = {
            read: row.read !== 0,
        }
    }
    return output
}

export function getPlayerEncyclopediaKeywordsSync(
    playerId: number
): EncyclopediaKeywordList {
    const db = getDb()
    const rows = db.prepare(`
        SELECT encyclopedia_id, read
        FROM players_encyclopedia_keywords
        WHERE player_id = ?
    `).all(playerId) as RawEncyclopediaKeyword[]

    return rowsToList(rows)
}

/**
 * Unlocks all requested encyclopedia keywords while consuming one key for the
 * request, matching the original client behavior. Repeating an already
 * completed request is idempotent and does not consume another key.
 */
export function unlockPlayerEncyclopediaKeywordsSync(
    playerId: number,
    encyclopediaIds: number[],
    keyItemId: number
): UnlockEncyclopediaResult | null {
    const db = getDb()
    const ids = normalizeIds(encyclopediaIds)

    return db.transaction(() => {
        const placeholders = ids.map(() => "?").join(", ")
        const existingRows = db.prepare(`
            SELECT encyclopedia_id, read
            FROM players_encyclopedia_keywords
            WHERE player_id = ? AND encyclopedia_id IN (${placeholders})
        `).all(playerId, ...ids) as RawEncyclopediaKeyword[]
        const existingIds = new Set(existingRows.map(row => row.encyclopedia_id))
        const newIds = ids.filter(id => !existingIds.has(id))

        const rawItem = db.prepare(`
            SELECT amount
            FROM players_items
            WHERE player_id = ? AND id = ?
        `).get(playerId, keyItemId) as { amount: number } | undefined
        const currentItemAmount = rawItem?.amount ?? 0

        if (newIds.length === 0) {
            return {
                encyclopediaList: rowsToList(existingRows),
                itemAmount: currentItemAmount,
                consumedKey: false,
            }
        }

        const deduction = db.prepare(`
            UPDATE players_items
            SET amount = amount - 1
            WHERE player_id = ? AND id = ? AND amount >= 1
        `).run(playerId, keyItemId)
        if (deduction.changes !== 1) return null

        const insert = db.prepare(`
            INSERT OR IGNORE INTO players_encyclopedia_keywords
                (encyclopedia_id, read, player_id)
            VALUES (?, 0, ?)
        `)
        for (const id of newIds) {
            insert.run(id, playerId)
        }

        const resultRows = db.prepare(`
            SELECT encyclopedia_id, read
            FROM players_encyclopedia_keywords
            WHERE player_id = ? AND encyclopedia_id IN (${placeholders})
        `).all(playerId, ...ids) as RawEncyclopediaKeyword[]

        return {
            encyclopediaList: rowsToList(resultRows),
            itemAmount: currentItemAmount - 1,
            consumedKey: true,
        }
    })()
}

export function readPlayerEncyclopediaKeywordsSync(
    playerId: number,
    encyclopediaIds: number[]
): EncyclopediaKeywordList {
    const db = getDb()
    const ids = normalizeIds(encyclopediaIds)
    const update = db.prepare(`
        UPDATE players_encyclopedia_keywords
        SET read = 1
        WHERE player_id = ? AND encyclopedia_id = ?
    `)

    db.transaction(() => {
        for (const id of ids) {
            update.run(playerId, id)
        }
    })()

    const output: EncyclopediaKeywordList = {}
    for (const id of ids) {
        output[String(id)] = { read: true }
    }
    return output
}
