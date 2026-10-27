import { getDb } from "../db"
import { getPlayerPartyGroupListSync } from "./party"
import { PartyCategory } from "../types"
import { kIdToBusinessCode } from "../codeMap"
import { UNKNOWN_RIVEN_ITEM_ID, isWeaponRivenItemId } from "../../lib/weapon-riven/constants"
import { parseGlobalPartyId } from "../../lib/special-event-parties"
import { stripIneffectiveWeaponRivenSouls } from "../../lib/weapon-riven/party-limit"
import { runPersistenceTransactionSync } from "../../lib/persistence-coordinator"

export interface WeaponRivenPartyKey { category: number; group_id: number; slot: number }

/** Revalidate old saves at battle start: more than one revealed card makes every revealed card ineffective. */
export function enforceWeaponRivenPartyLimitSync(playerId: number, partyId: number,
    category: PartyCategory = PartyCategory.NORMAL): ReturnType<typeof getWeaponRivenPartyInfoListSync> {
    const parsed = parseGlobalPartyId(partyId)
    if (!parsed) return []
    const operation = () => {
        const db = getDb()
        const row = db.prepare(`SELECT ability_soul_1,ability_soul_2,ability_soul_3 FROM players_parties
            WHERE player_id=? AND category=? AND group_id=? AND slot=?`)
            .get(playerId, category, parsed.groupId, parsed.slot) as
            { ability_soul_1: number | null; ability_soul_2: number | null; ability_soul_3: number | null } | undefined
        if (!row) return []
        const before = [row.ability_soul_1, row.ability_soul_2, row.ability_soul_3]
        const after = stripIneffectiveWeaponRivenSouls(before)
        if (after.every((id, index) => id === before[index])) return []
        db.prepare(`UPDATE players_parties SET ability_soul_1=?,ability_soul_2=?,ability_soul_3=?
            WHERE player_id=? AND category=? AND group_id=? AND slot=?`)
            .run(...after, playerId, category, parsed.groupId, parsed.slot)
        // A cached lobby wire party read before this repair must not outlive it.
        require("../../multi/party-snapshot").invalidateRealPartySnapshot(playerId)
        return getWeaponRivenPartyInfoListSync(playerId, [{ category, group_id: parsed.groupId, slot: parsed.slot }])
    }
    return getDb().inTransaction ? operation() : runPersistenceTransactionSync({
        domain: "player", playerId, operation: "limit_weapon_riven_party",
    }, operation)
}

/**
 * Battle-start entry for routes other than /single_battle_quest/start (rush_event, raid_event, multi):
 * apply the over-limit rule to every named saved party, then return the authoritative parties when
 * something changed, the player owns revealed cards (a stale client cache may still hold two), or a
 * revealed reference remains. Call inside the start transaction.
 */
export function enforceWeaponRivenStartPartiesSync(playerId: number, category: PartyCategory,
    partyIds: readonly number[]): ReturnType<typeof getWeaponRivenPartyInfoListSync> {
    const keys: WeaponRivenPartyKey[] = []
    let changed = false
    for (const partyId of partyIds) {
        const parsed = parseGlobalPartyId(partyId)
        if (!parsed || keys.some(key => key.group_id === parsed.groupId && key.slot === parsed.slot)) continue
        keys.push({ category, group_id: parsed.groupId, slot: parsed.slot })
        if (enforceWeaponRivenPartyLimitSync(playerId, partyId, category).length > 0) changed = true
    }
    if (keys.length === 0) return []
    const current = getWeaponRivenPartyInfoListSync(playerId, keys)
    return changed || playerHasWeaponRivensSync(playerId)
        || current.some(party => party.ability_soul_ids.some(id => isWeaponRivenItemId(id))) ? current : []
}

/** Every saved slot of one party group (raid starts name a group, not a party). */
export function getSavedPartyIdsInGroupSync(playerId: number, category: PartyCategory, groupId: number): number[] {
    if (!Number.isSafeInteger(groupId) || groupId < 1 || groupId > 12) return []
    return (getDb().prepare(`SELECT slot FROM players_parties WHERE player_id=? AND category=? AND group_id=?
        ORDER BY slot`).all(playerId, category, groupId) as Array<{ slot: number }>)
        .filter(row => Number.isSafeInteger(row.slot) && row.slot >= 1 && row.slot <= 10)
        .map(row => (groupId - 1) * 10 + row.slot)
}

/** Keep the earliest saved references, leaving unconverted battle-party slots untouched. */
export function trimUnknownWeaponRivenPartiesSync(
    playerId: number, remaining: number, protectedParty?: WeaponRivenPartyKey,
    itemId: number = UNKNOWN_RIVEN_ITEM_ID,
): WeaponRivenPartyKey[] {
    const db = getDb()
    if (!db.inTransaction) throw new Error("Unknown riven party cleanup requires a transaction")
    const parties = db.prepare(`SELECT category,group_id,slot,ability_soul_1,ability_soul_2,ability_soul_3
        FROM players_parties WHERE player_id=?
        AND (ability_soul_1=? OR ability_soul_2=? OR ability_soul_3=?)
        ORDER BY category,group_id,slot`).all(playerId, itemId, itemId, itemId) as
        Array<WeaponRivenPartyKey & { ability_soul_1: number | null; ability_soul_2: number | null; ability_soul_3: number | null }>
    let excess = parties.reduce((total, party) => total + [party.ability_soul_1, party.ability_soul_2, party.ability_soul_3]
        .filter(id => id === itemId).length, 0) - Math.max(0, remaining)
    const changed: WeaponRivenPartyKey[] = []
    for (const party of parties.reverse()) {
        if (excess <= 0) break
        if (protectedParty && party.category === protectedParty.category
            && party.group_id === protectedParty.group_id && party.slot === protectedParty.slot) continue
        const souls = [party.ability_soul_1, party.ability_soul_2, party.ability_soul_3]
        for (let slot = souls.length - 1; slot >= 0 && excess > 0; slot--) {
            if (souls[slot] !== itemId) continue
            souls[slot] = null
            excess--
        }
        db.prepare(`UPDATE players_parties SET ability_soul_1=?,ability_soul_2=?,ability_soul_3=?
            WHERE player_id=? AND category=? AND group_id=? AND slot=?`)
            .run(...souls, playerId, party.category, party.group_id, party.slot)
        changed.push({ category: party.category, group_id: party.group_id, slot: party.slot })
    }
    return changed.reverse()
}

const sameParty = (a: WeaponRivenPartyKey, b: WeaponRivenPartyKey) =>
    a.category === b.category && a.group_id === b.group_id && a.slot === b.slot

/**
 * Clear only consumed frozen slots, then apply the historical excess rule to other parties.
 * `remaining` is the plain unknown balance, or a per-item balance map for themed unknown cards;
 * `slotItemIds[i]` names the card consumed in `convertedSlots[i]` (default: the plain unknown card).
 */
export function cleanupConvertedUnknownWeaponRivenPartiesSync(
    playerId: number, remaining: number | Record<number, number>, partyId: number | undefined, convertedSlots: number[],
    slotItemIds: number[] = [],
): WeaponRivenPartyKey[] {
    const db = getDb()
    if (!db.inTransaction) throw new Error("Unknown riven party cleanup requires a transaction")
    if (convertedSlots.length === 0) return []
    const balances: Record<number, number> = typeof remaining === "number" ? { [UNKNOWN_RIVEN_ITEM_ID]: remaining } : remaining
    const itemIds = Object.keys(balances).map(Number)
    const merge = (lists: WeaponRivenPartyKey[][]): WeaponRivenPartyKey[] => {
        const result: WeaponRivenPartyKey[] = []
        for (const key of lists.flat()) if (!result.some(other => sameParty(other, key))) result.push(key)
        return result.sort((a, b) => a.category - b.category || a.group_id - b.group_id || a.slot - b.slot)
    }
    const parsed = partyId === undefined ? null : parseGlobalPartyId(partyId)
    // Old battles did not freeze a party ID. Never infer it from today's selected party.
    if (!parsed) return merge(itemIds.map(itemId => trimUnknownWeaponRivenPartiesSync(playerId, balances[itemId], undefined, itemId)))
    const party = { category: PartyCategory.NORMAL, group_id: parsed.groupId, slot: parsed.slot }
    const columns = ["ability_soul_1", "ability_soul_2", "ability_soul_3"]
    let changed = false
    convertedSlots.forEach((slot, index) => {
        if (!Number.isInteger(slot) || slot < 0 || slot >= columns.length) return
        const column = columns[slot]
        // A later edit may have replaced this soul; never clear its replacement.
        const result = db.prepare(`UPDATE players_parties SET ${column}=NULL
            WHERE player_id=? AND category=? AND group_id=? AND slot=? AND ${column}=?`)
            .run(playerId, party.category, party.group_id, party.slot, slotItemIds[index] ?? UNKNOWN_RIVEN_ITEM_ID)
        changed = result.changes > 0 || changed
    })
    const trimmed = merge(itemIds.map(itemId => trimUnknownWeaponRivenPartiesSync(playerId, balances[itemId], party, itemId)))
        .filter(key => !sameParty(key, party))
    return changed ? [party, ...trimmed] : trimmed
}

/** Owners of revealed cards get their authoritative selected party back at every battle start. */
export function playerHasWeaponRivensSync(playerId: number): boolean {
    return getDb().prepare("SELECT 1 FROM player_weapon_rivens WHERE player_id=? LIMIT 1").get(playerId) !== undefined
}

/** Re-read saved parties so a settlement replay cannot overwrite a later party edit. */
export function getWeaponRivenPartyInfoListSync(playerId: number, keys: WeaponRivenPartyKey[]) {
    const categories = new Map([...new Set(keys.map(key => key.category))].map(category => [category,
        getPlayerPartyGroupListSync(playerId, category as PartyCategory)]))
    return keys.map(key => {
        const party = categories.get(key.category)?.[key.group_id]?.list[key.slot]
        if (!party) return null
        return { party_id: (key.group_id - 1) * 10 + key.slot, party_category: key.category, party_name: party.name,
            character_ids: party.characterIds.map(id => id === null ? null : kIdToBusinessCode(id)),
            unison_character_ids: party.unisonCharacterIds.map(id => id === null ? null : kIdToBusinessCode(id)),
            equipment_ids: party.equipmentIds, ability_soul_ids: party.abilitySoulIds,
            party_edited: party.edited, options: { allow_other_players_to_heal_me: party.options.allowOtherPlayersToHealMe } }
    }).filter((party): party is NonNullable<typeof party> => party !== null)
}
