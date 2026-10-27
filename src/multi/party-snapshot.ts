import {
    getPlayerCharacterManaNodeAwakeLevelsSync,
    getPlayerCharacterSync,
} from "../data/domains/character"
import { getPlayerEquipmentSync } from "../data/domains/equipment"
import { getPlayerPartyGroupListSync } from "../data/domains/party"
import { getPlayerSync } from "../data/domains/player"
import { PartyCategory, PlayerParty } from "../data/types"
import { parseGlobalPartyId } from "../lib/special-event-parties"
import { registerMemoryCounters } from "../lib/memory-diagnostics"
import { isWeaponRivenInstanceId, stripWeaponRivenPartySouls } from "../lib/weapon-riven/client"

interface PartySnapshotEntry {
    party: any
    expiresAt: number
}

const CACHE_TTL_MS = Math.max(
    5_000,
    Number.parseInt(process.env.MULTI_PARTY_SNAPSHOT_TTL_MS ?? "10000", 10) || 10_000,
)
const CACHE_MAX_ENTRIES = Math.max(
    100,
    Number.parseInt(process.env.MULTI_PARTY_SNAPSHOT_MAX_ENTRIES ?? "1000", 10) || 1_000,
)
const snapshots = new Map<string, PartySnapshotEntry>()
let cacheHits = 0
let cacheMisses = 0
let cacheWrites = 0

registerMemoryCounters("multiPartySnapshot", _detailed => ({
    entries: snapshots.size,
    hits: cacheHits,
    misses: cacheMisses,
    writes: cacheWrites,
    ttlMs: CACHE_TTL_MS,
    maxEntries: CACHE_MAX_ENTRIES,
}))

function selectedPartyId(playerId: number, partyId?: number): number {
    return partyId ?? getPlayerSync(playerId)?.partySlot ?? 1
}

function snapshotKey(playerId: number, partyId: number): string {
    return `${playerId}:${partyId}`
}

function copyParty(party: any): any { return JSON.parse(JSON.stringify(party)) }

function storeSnapshot(playerId: number, partyId: number, party: any): void {
    const key = snapshotKey(playerId, partyId)
    if (!snapshots.has(key) && snapshots.size >= CACHE_MAX_ENTRIES) {
        const oldest = snapshots.keys().next().value
        if (oldest !== undefined) snapshots.delete(oldest)
    }
    snapshots.set(key, { party: copyParty(party), expiresAt: Date.now() + CACHE_TTL_MS })
    cacheWrites++
}

function getLiveSnapshot(playerId: number, partyId: number): any | null {
    const key = snapshotKey(playerId, partyId)
    const current = snapshots.get(key)
    if (!current) return null
    if (current.expiresAt <= Date.now()) {
        snapshots.delete(key)
        return null
    }
    return copyParty(current.party)
}

/** Build the legacy wire party used by the lobby Welcome packet. */
export function buildRealParty(playerId: number, targetParty?: PlayerParty, partyId?: number): any {
    const filledChars: any[] = []
    const filledUnison: any[] = []
    const filledEquips: any[] = []
    const filledSouls: any[] = []

    // The player's normal SET and the NPC pool are separate sources. Explicit
    // targetParty callers (including NPC builders) keep their chosen party.
    let selectedParty: PlayerParty | null = targetParty ?? null
    if (!selectedParty) {
        const parsed = parseGlobalPartyId(selectedPartyId(playerId, partyId))
        if (parsed) {
            selectedParty = getPlayerPartyGroupListSync(playerId, PartyCategory.NORMAL)
                [String(parsed.groupId)]?.list[String(parsed.slot)] ?? null
        }
    }

    for (let i = 0; i < 3; i++) {
        const charId = selectedParty?.characterIds[i] ?? null
        if (!charId) {
            filledChars.push([1])
        } else {
            const dbChar = getPlayerCharacterSync(playerId, charId)
            if (!dbChar) {
                filledChars.push([1])
            } else {
                const manaNodeMap = getPlayerCharacterManaNodeAwakeLevelsSync(playerId, charId)

                const exBoost = dbChar.exBoost?.abilityIdList?.length
                    ? [0, { ability_id_list: dbChar.exBoost.abilityIdList, status_id: dbChar.exBoost.statusId }]
                    : [1]
                filledChars.push([0, {
                    id: charId,
                    evolution_level: dbChar.evolutionLevel,
                    exp: dbChar.exp,
                    over_limit_step: dbChar.overLimitStep,
                    mana_node_ids: manaNodeMap,
                    ex_boost: exBoost,
                    illustration_settings: [1],
                }])

            }
        }

        const unisonId = selectedParty?.unisonCharacterIds[i] ?? null
        if (!unisonId) {
            filledUnison.push([1])
        } else {
            const dbUnison = getPlayerCharacterSync(playerId, unisonId)
            if (!dbUnison) {
                filledUnison.push([1])
            } else {
                const nodeMap = getPlayerCharacterManaNodeAwakeLevelsSync(playerId, unisonId)
                const unisonExBoost = dbUnison.exBoost?.abilityIdList?.length
                    ? [0, { ability_id_list: dbUnison.exBoost.abilityIdList, status_id: dbUnison.exBoost.statusId }]
                    : [1]
                filledUnison.push([0, {
                    id: unisonId,
                    evolution_level: dbUnison.evolutionLevel,
                    exp: dbUnison.exp,
                    over_limit_step: dbUnison.overLimitStep,
                    mana_node_ids: nodeMap,
                    ex_boost: unisonExBoost,
                    illustration_settings: [1],
                }])
            }
        }

        const equipId = selectedParty?.equipmentIds[i] ?? null
        if (!equipId) {
            filledEquips.push([1])
        } else {
            const dbEquip = getPlayerEquipmentSync(playerId, equipId)
            filledEquips.push(dbEquip
                ? [0, { equipmentId: equipId, level: dbEquip.level, enhancementLevel: dbEquip.enhancementLevel }]
                : [1])
        }

        const soulId = selectedParty?.abilitySoulIds[i] ?? null
        filledSouls.push(soulId && !isWeaponRivenInstanceId(soulId) ? [0, soulId] : [1])
    }

    return {
        characters: filledChars,
        unison_characters: filledUnison,
        equipments: filledEquips,
        abilitySoulIds: filledSouls,
    }
}

/** Prime the snapshot before the subsequent TCP handshake. */
export function primeRealPartySnapshot(playerId: number, targetParty?: PlayerParty, partyId?: number): any {
    if (targetParty) return buildRealParty(playerId, targetParty)
    const selectedId = selectedPartyId(playerId, partyId)
    const cached = getLiveSnapshot(playerId, selectedId)
    if (cached !== null) {
        cacheHits++
        return cached
    }
    const party = buildRealParty(playerId, undefined, selectedId)
    storeSnapshot(playerId, selectedId, stripWeaponRivenPartySouls(party))
    return party
}

/** Return a warmed party or build it once for backward-compatible direct TCP clients. */
export function getRealPartySnapshot(playerId: number, partyId?: number): any {
    const selectedId = selectedPartyId(playerId, partyId)
    const cached = getLiveSnapshot(playerId, selectedId)
    if (cached !== null) {
        cacheHits++
        return cached
    }
    cacheMisses++
    return primeRealPartySnapshot(playerId, undefined, selectedId)
}

/** Keep a client-selected party authoritative for reconnects in the same room. */
export function setRealPartySnapshot(playerId: number, party: any, partyId?: number): void {
    if (!Number.isSafeInteger(playerId) || playerId <= 0 || !party || typeof party !== "object") return
    const selectedId = selectedPartyId(playerId, partyId)
    if (!parseGlobalPartyId(selectedId)) return
    storeSnapshot(playerId, selectedId, stripWeaponRivenPartySouls(party))
}

export function invalidateRealPartySnapshot(playerId: number): void {
    for (const key of snapshots.keys()) if (key.startsWith(`${playerId}:`)) snapshots.delete(key)
}
