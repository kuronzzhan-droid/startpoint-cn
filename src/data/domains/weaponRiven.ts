import { getDb } from "../db"
import { getWeaponRivenCostOptions, getWeaponRivenDisposition, getWeaponRivenDismantleReward, weaponRivenRuleSet } from "../../lib/weapon-riven/rules"
import { FIRST_RIVEN_ITEM_ID, LAST_RIVEN_ITEM_ID } from "../../lib/weapon-riven/constants"
import { displayWeaponRivenAffixes } from "../../lib/weapon-riven/display"
import { WeaponRivenAffix, WeaponRivenView, WeaponRivenChanges, WeaponRivenError } from "../../lib/weapon-riven/model"
import { validateWeaponRivenQualities } from "../../lib/weapon-riven/quality"
import { migrateWeaponRivenAffixes } from "../../lib/weapon-riven/migrate-quality"
import { migrateWeaponRivenQualities } from "../initializers/weapon-riven-quality"
export { WeaponRivenView, WeaponRivenChanges, WeaponRivenError }
export { convertUnknownWeaponRivensSync } from "./weapon-riven-conversion"

export interface RivenRow {
    riven_id: number; item_id: number; weapon_id: number; affixes_json: string
    roll_count: number; revision: number; pending_json: string | null
    locked: 0 | 1; seen: 0 | 1
    affix_version: 1 | 3
}
function view(row: RivenRow): WeaponRivenView {
    const affixes: WeaponRivenAffix[] = JSON.parse(row.affixes_json)
    const pending = row.pending_json === null ? null : JSON.parse(row.pending_json)
    const refund = getWeaponRivenDismantleReward(affixes.length, row.roll_count)
    const costs = getWeaponRivenCostOptions(row.roll_count)
    return { riven_id: row.riven_id, weapon_id: row.weapon_id,
        affixes: displayWeaponRivenAffixes(row.weapon_id, affixes, row.affix_version), roll_count: row.roll_count,
        locked: row.locked, seen: row.seen, disposition: Math.round(getWeaponRivenDisposition(row.weapon_id)),
        dismantle_return: refund ? [[refund.itemId, refund.amount]] : [],
        revision: row.revision, next_cost: costs[0][1], cost_options: costs,
        pending: pending === null ? null : {draw_id: pending.draw_id,
            affixes: displayWeaponRivenAffixes(row.weapon_id, pending.affixes, pending.affix_version ?? 1)} }
}
export function getPlayerWeaponRivenListSync(playerId: number): Record<string, WeaponRivenView> {
    migrateWeaponRivenQualities(getDb(), playerId)
    const rows = getDb().prepare("SELECT * FROM player_weapon_rivens WHERE player_id=? ORDER BY item_id").all(playerId) as RivenRow[]
    return Object.fromEntries(rows.map(row => [String(row.item_id), view(row)]))
}
export function getPlayerWeaponRivenSync(playerId: number, itemId: number): WeaponRivenView | null {
    const row = getPlayerWeaponRivenRowSync(playerId, itemId)
    return row ? view(row) : null
}
/** Operations must use durable quality pairs, never the response's projected levels. */
export function getPlayerWeaponRivenRowSync(playerId: number, itemId: number): RivenRow | undefined {
    const query = getDb().prepare("SELECT * FROM player_weapon_rivens WHERE player_id=? AND item_id=?")
    const row = query.get(playerId, itemId) as RivenRow | undefined
    if (row && (row.affix_version !== 3 || (row.pending_json !== null && JSON.parse(row.pending_json).affix_version !== 3))) {
        migrateWeaponRivenQualities(getDb(), playerId)
        return query.get(playerId, itemId) as RivenRow
    }
    return row
}

/** Storage primitive; reward entrances use grantWeaponRivenSync for overflow rewards and receipts. */
export function insertWeaponRivenSync(
    playerId: number, weaponId: number, affixes: WeaponRivenAffix[], sourceKey: string,
    random: () => number = Math.random,
    format: 1 | 3 = 1,
): number | null {
    if (format === 1 && weaponRivenRuleSet.rules.schema_version === 3) {
        affixes = migrateWeaponRivenAffixes(weaponId, affixes, weaponRivenRuleSet)
        format = 3
    }
    if (format === 3) validateWeaponRivenQualities(affixes, weaponRivenRuleSet)
    const db = getDb()
    if (!db.inTransaction) throw new Error("Weapon riven creation requires a transaction")
    const existing = db.prepare("SELECT item_id FROM player_weapon_rivens WHERE player_id=? AND source_key=?")
        .get(playerId, sourceKey) as { item_id: number } | undefined
    if (existing) return existing.item_id
    const occupied = new Set((db.prepare("SELECT item_id FROM player_weapon_rivens WHERE player_id=?").all(playerId) as {item_id:number}[]).map(row => row.item_id))
    if (occupied.size >= weaponRivenRuleSet.rules.items.holding_limit) return null
    const available: number[] = []
    for (let itemId = FIRST_RIVEN_ITEM_ID; itemId <= LAST_RIVEN_ITEM_ID; itemId++) {
        if (!occupied.has(itemId)) available.push(itemId)
    }
    if (available.length === 0) return null
    const u = random()
    if (!Number.isFinite(u) || u < 0 || u >= 1) throw new RangeError("Weapon riven random source must return a value in [0, 1).")
    const itemId = available[Math.floor(u * available.length)]
    const sequence = db.prepare(`INSERT INTO player_weapon_riven_sequences(player_id,last_id)
        VALUES (?, (SELECT COALESCE(MAX(riven_id),0)+1 FROM player_weapon_rivens WHERE player_id=?))
        ON CONFLICT(player_id) DO UPDATE SET last_id=MAX(last_id,
            (SELECT COALESCE(MAX(riven_id),0) FROM player_weapon_rivens WHERE player_id=?))+1
        RETURNING last_id`).get(playerId, playerId, playerId) as {last_id:number}
    if (!Number.isSafeInteger(sequence.last_id)) throw new Error("Weapon riven sequence exhausted")
    const now = new Date().toISOString()
    db.prepare(`INSERT INTO player_weapon_rivens(player_id,riven_id,item_id,weapon_id,affixes_json,
        source_key,created_at,updated_at,affix_version) VALUES (?,?,?,?,?,?,?,?,?)`)
        .run(playerId, sequence.last_id, itemId, weaponId, JSON.stringify(affixes), sourceKey, now, now, format)
    return itemId
}
