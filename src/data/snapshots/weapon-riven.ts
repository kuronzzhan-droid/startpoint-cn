import type { Database } from "better-sqlite3"
import { FIRST_RIVEN_ITEM_ID, FIRST_THEMED_UNKNOWN_RIVEN_ITEM_ID, LAST_RESERVED_RIVEN_ITEM_ID, LAST_THEMED_UNKNOWN_RIVEN_ITEM_ID,
    WEAPON_RIVEN_FRAGMENT_ITEM_ID, isWeaponRivenItemId } from "../../lib/weapon-riven/constants"
import { validateWeaponRivenQualities } from "../../lib/weapon-riven/quality"
import { migrateWeaponRivenQualities } from "../initializers/weapon-riven-quality"
import { weaponRivenRuleSet } from "../../lib/weapon-riven/rules"
import { limitWeaponRivenPartySouls } from "../../lib/weapon-riven/party-limit"

/** Instance inventory is derived from card ownership, including reserved slots. */
export function filterWeaponRivenInventoryRows<T>(columns: readonly string[], rows: T[][]): T[][] {
    const itemIdIndex = columns.indexOf("id")
    return rows.filter(row => !isWeaponRivenItemId(Number(row[itemIdIndex])))
}

/** Run after imported or preserved card ownership is restored, in the import transaction. */
export function clearInvalidWeaponRivenPartyReferences(db: Database, playerId: number): void {
    migrateWeaponRivenQualities(db, playerId)
    // Instance slots only (isWeaponRivenItemId): the fragment and themed unknown cards are stackable
    // items that never have a player_weapon_rivens row, so they must not be treated as dangling.
    for (const column of ["ability_soul_1", "ability_soul_2", "ability_soul_3"]) {
        db.prepare(`UPDATE players_parties SET ${column}=NULL
            WHERE player_id=? AND ${column} BETWEEN ? AND ? AND ${column}<>?
                AND ${column} NOT BETWEEN ? AND ?
                AND NOT EXISTS (SELECT 1 FROM player_weapon_rivens r
                    WHERE r.player_id=players_parties.player_id AND r.item_id=players_parties.${column})`)
            .run(playerId, FIRST_RIVEN_ITEM_ID, LAST_RESERVED_RIVEN_ITEM_ID, WEAPON_RIVEN_FRAGMENT_ITEM_ID,
                FIRST_THEMED_UNKNOWN_RIVEN_ITEM_ID, LAST_THEMED_UNKNOWN_RIVEN_ITEM_ID)
    }
    const parties = db.prepare(`SELECT category,group_id,slot,ability_soul_1,ability_soul_2,ability_soul_3
        FROM players_parties WHERE player_id=?`).all(playerId) as Array<{
        category: number; group_id: number; slot: number
        ability_soul_1: number | null; ability_soul_2: number | null; ability_soul_3: number | null
    }>
    const update = db.prepare(`UPDATE players_parties SET ability_soul_1=?,ability_soul_2=?,ability_soul_3=?
        WHERE player_id=? AND category=? AND group_id=? AND slot=?`)
    for (const party of parties) {
        const before = [party.ability_soul_1, party.ability_soul_2, party.ability_soul_3]
        const after = limitWeaponRivenPartySouls(before)
        if (after.every((id, index) => id === before[index])) continue
        update.run(...after, playerId, party.category, party.group_id, party.slot)
    }
}

/** Validate new JSON-bearing rows before any archive replacement writes. */
export function validateWeaponRivenArchiveRow(columns: readonly string[], values: readonly unknown[]): void {
    const row = Object.fromEntries(columns.map((column,index) => [column,values[index]]))
    for (const column of ["locked", "seen"]) {
        if (columns.includes(column) && row[column] !== 0 && row[column] !== 1) {
            throw new Error(`player_weapon_rivens: invalid ${column} in archive; expected 0 or 1`)
        }
    }
    const fail = (): never => { throw new Error("player_weapon_rivens: invalid riven or pending affixes in archive") }
    const version = row.affix_version ?? 1
    if (version !== 1 && version !== 3) fail()
    const affixes = (value: unknown, format: unknown): boolean => {
        if (format === 3) { validateWeaponRivenQualities(value, weaponRivenRuleSet); return true }
        return format === 1 && Array.isArray(value) && value.length >= 1 && value.length <= 4
        && value.every(pair => Array.isArray(pair) && pair.length === 2
            && Number.isSafeInteger(pair[0]) && pair[0] >= 15990001 && pair[0] < 16000000
            && Number.isSafeInteger(pair[1]) && pair[1] >= 1 && pair[1] <= 100)
        && new Set(value.map(pair => pair[0])).size === value.length
    }
    try {
        if (typeof row.affixes_json !== "string" || !affixes(JSON.parse(row.affixes_json),version)) fail()
        if (row.pending_json !== null) {
            if (typeof row.pending_json !== "string") fail()
            const pending = JSON.parse(row.pending_json as string)
            if (!pending || typeof pending.draw_id !== "string" || !pending.draw_id
                || pending.draw_id.length > 128 || !affixes(pending.affixes,pending.affix_version ?? 1)) fail()
        }
    } catch { fail() }
}

/** Old, exactly matched V2 schemas omit both flags; SQLite inserts their defaults. */
export function withWeaponRivenArchiveDefaults<T>(source: { columns: string[]; rows: T[][] }): {
    columns: string[]; rows: Array<Array<T | number>>
} {
    const defaults: Record<string, number> = { locked: 0, seen: 0, affix_version: 1 }
    const columns = [...source.columns.filter(column => !(column in defaults)), ...Object.keys(defaults)]
    return { columns, rows: source.rows.map(row => columns.map(column => {
        const index = source.columns.indexOf(column)
        return index < 0 ? defaults[column] : row[index]
    })) }
}
