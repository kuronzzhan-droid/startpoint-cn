import { cachedStatement } from "../../lib/cached-statement"
import { getDb } from "../db";
import { RawPlayerItem } from "../types";
import { runPersistenceTransactionSync } from "../../lib/persistence-coordinator";
import { isWeaponRivenItemId } from "../../lib/weapon-riven/constants";

function assertOrdinaryInventoryItem(itemId: number | string): void {
    if (isWeaponRivenItemId(Number(itemId))) throw new Error("Weapon riven instances cannot be written to players_items")
}

/**
 * Gets the amount of a singular item that a player owns.
 * 
 * @param playerId The ID of the player.
 * @param itemId The ID of the item.
 * @returns The amount of the item that the player owns, or null, indicating no ownership.
 */
export function getPlayerItemSync(
    playerId: number,
    itemId: number | string
): number | null {
    const db = getDb();
    const numericId = Number(itemId)
    if (isWeaponRivenItemId(numericId)) {
        return db.prepare("SELECT 1 FROM player_weapon_rivens WHERE player_id=? AND item_id=?")
            .get(playerId, numericId) ? 1 : null
    }
    const rawItem = cachedStatement(db, `
    SELECT id, amount
    FROM players_items
    WHERE player_id = ? AND id = ?
    `).get(playerId, Number(itemId)) as RawPlayerItem | undefined

    return rawItem === undefined ? null : rawItem.amount
}

/**
 * Gets the items that a player owns.
 * 
 * @param playerId The ID of the player.
 * @returns A record where the index is the item's ID and the value is the item's amount.
 */
export function getPlayerItemsSync(
    playerId: number
): Record<string, number> {
    const db = getDb();
    const rawItems = cachedStatement(db, `
    SELECT id, amount
    FROM players_items
    WHERE player_id = ?
    `).all(playerId) as RawPlayerItem[]

    const output: Record<string, number> = {}
    for (const rawItem of rawItems) {
        output[rawItem.id.toString()] = rawItem.amount
    }

    return output
}

/** Retrieves only the requested inventory rows with one bounded read. */
export function getPlayerItemsByIdsSync(
    playerId: number,
    itemIds: readonly number[],
): Record<string, number> {
    const ids = [...new Set(itemIds)].filter(itemId => Number.isSafeInteger(itemId) && itemId > 0)
    if (ids.length === 0) return {}
    const placeholders = ids.map(() => "?").join(", ")
    const rows = cachedStatement(getDb(), `
    SELECT id, amount
    FROM players_items
    WHERE player_id = ? AND id IN (${placeholders})
    `).all(playerId, ...ids) as RawPlayerItem[]
    const output = Object.fromEntries(rows.map(row => [String(row.id), row.amount]))
    if (ids.some(isWeaponRivenItemId)) {
        for (const id of ids.filter(isWeaponRivenItemId)) {
            delete output[id]
            if (getPlayerItemSync(playerId,id) !== null) output[id] = 1
        }
    }
    return output
}

export function getPlayerCollectedItemTotalSync(
    playerId: number,
    itemId: number | string
): number {
    const row = cachedStatement(getDb(), `
    SELECT total_obtained
    FROM players_collected_items
    WHERE player_id = ? AND item_id = ?
    `).get(playerId, Number(itemId)) as { total_obtained: number } | undefined
    return row?.total_obtained ?? 0
}

export function getPlayerCollectedItemTotalsSync(
    playerId: number
): Record<string, number> {
    const rows = cachedStatement(getDb(), `
    SELECT item_id, total_obtained
    FROM players_collected_items
    WHERE player_id = ?
    `).all(playerId) as { item_id: number; total_obtained: number }[]
    return Object.fromEntries(rows.map(row => [String(row.item_id), row.total_obtained]))
}

/** Retrieves lifetime acquisition totals for only the requested item IDs. */
export function getPlayerCollectedItemTotalsByIdsSync(
    playerId: number,
    itemIds: readonly number[],
): Record<string, number> {
    const ids = [...new Set(itemIds)].filter(itemId => Number.isSafeInteger(itemId) && itemId > 0)
    if (ids.length === 0) return {}
    const placeholders = ids.map(() => "?").join(", ")
    const rows = cachedStatement(getDb(), `
    SELECT item_id, total_obtained
    FROM players_collected_items
    WHERE player_id = ? AND item_id IN (${placeholders})
    `).all(playerId, ...ids) as { item_id: number; total_obtained: number }[]
    return Object.fromEntries(rows.map(row => [String(row.item_id), row.total_obtained]))
}

function recordPlayerCollectedItemSync(
    playerId: number,
    itemId: number | string,
    obtainedAmount: number
): void {
    if (!Number.isSafeInteger(obtainedAmount) || obtainedAmount <= 0) return
    cachedStatement(getDb(), `
    INSERT INTO players_collected_items (player_id, item_id, total_obtained)
    VALUES (?, ?, ?)
    ON CONFLICT(player_id, item_id) DO UPDATE SET
        total_obtained = total_obtained + excluded.total_obtained
    `).run(playerId, Number(itemId), obtainedAmount)
}

/**
 * Inserts a singular item into the player's inventory.
 * 
 * @param playerId The ID of the player.
 * @param itemId The ID of the item to insert.
 * @param amount The amount of the item to insert.
 */
function insertPlayerItemSync(
    playerId: number,
    itemId: number | string,
    amount: number
) {
    assertOrdinaryInventoryItem(itemId)
    const db = getDb();
    cachedStatement(db, `
    INSERT INTO players_items (id, amount, player_id)
    VALUES (?, ?, ?)
    `).run(Number(itemId), amount, playerId)
}

/**
 * Batch inserts a record of player items into a player's inventory.
 * 
 * @param playerId The ID of the player.
 * @param items The record of items.
 */
export function insertPlayerItemsSync(
    playerId: number,
    items: Record<string, number>
) {
    const db = getDb();
    runPersistenceTransactionSync({ domain: "player", playerId, operation: "insert_player_items" }, () => {
        for (const [itemId, amount] of Object.entries(items)) {
            insertPlayerItemSync(playerId, itemId, amount)
        }
    })
}

/**
 * Updates a player's item's amount.
 * 
 * @param playerId The ID of the player.
 * @param itemId The item's ID.
 * @param amount The new amount the item should have.
 */
export function updatePlayerItemSync(
    playerId: number,
    itemId: string | number,
    amount: number
) {
    assertOrdinaryInventoryItem(itemId)
    const db = getDb();
    cachedStatement(db, `
    UPDATE players_items
    SET amount = ?
    WHERE player_id = ? AND id = ?
    `).run(amount, playerId, Number(itemId))
}

/**
 * Sets a player's item to an exact amount, inserting the row first if the player does not yet
 * own the item.
 *
 * updatePlayerItemSync on its own is a bare UPDATE that silently affects zero rows when the
 * player does not already own the item, so callers that mean "add or set this item" (e.g. the
 * web admin's POST /:id/item) would return success while writing nothing for a not-yet-owned item.
 *
 * @param playerId The ID of the player.
 * @param itemId The item's ID.
 * @param amount The exact amount the item should have.
 */
export function setPlayerItemSync(
    playerId: number,
    itemId: string | number,
    amount: number
) {
    if (getPlayerItemSync(playerId, itemId) === null) {
        insertPlayerItemSync(playerId, itemId, amount)
    } else {
        updatePlayerItemSync(playerId, itemId, amount)
    }
}

/**
 * Gives a player giveAmount of an item.
 * 
 * @param playerId The ID of the player.
 * @param itemId The ID of the item.
 * @param giveAmount The amount of the item to give.
 * @returns The new total amount of the item that the player owns.
 */
export function givePlayerItemSync(
    playerId: number,
    itemId: string | number,
    giveAmount: number
): number {
    return runPersistenceTransactionSync({ domain: "player", playerId, operation: "give_player_item" }, () => {
        const ownedAmount = getPlayerItemSync(playerId, itemId)
        const newAmount = (ownedAmount ?? 0) + giveAmount
        if (ownedAmount === null) insertPlayerItemSync(playerId, itemId, newAmount)
        else updatePlayerItemSync(playerId, itemId, newAmount)
        recordPlayerCollectedItemSync(playerId, itemId, giveAmount)
        return newAmount
    })
}
