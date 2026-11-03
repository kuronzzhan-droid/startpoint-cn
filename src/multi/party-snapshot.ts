import {
    getPlayerCharacterManaNodesSync,
    getPlayerCharacterSync,
} from "../data/domains/character"
import { getPlayerEquipmentSync } from "../data/domains/equipment"
import { getPlayerPartyGroupListSync } from "../data/domains/party"
import { PartyCategory, PlayerParty } from "../data/types"
import { registerMemoryCounters } from "../lib/memory-diagnostics"

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
const snapshots = new Map<number, PartySnapshotEntry>()
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

function storeSnapshot(playerId: number, party: any): void {
    if (!snapshots.has(playerId) && snapshots.size >= CACHE_MAX_ENTRIES) {
        const oldest = snapshots.keys().next().value
        if (Number.isSafeInteger(oldest)) snapshots.delete(oldest)
    }
    snapshots.set(playerId, { party, expiresAt: Date.now() + CACHE_TTL_MS })
    cacheWrites++
}

function getLiveSnapshot(playerId: number): any | null {
    const current = snapshots.get(playerId)
    if (!current) return null
    if (current.expiresAt <= Date.now()) {
        snapshots.delete(playerId)
        return null
    }
    return current.party
}

/** Build the legacy wire party used by the lobby Welcome packet. */
export function buildRealParty(playerId: number, targetParty?: PlayerParty): any {
    const filledChars: any[] = []
    const filledUnison: any[] = []
    const filledEquips: any[] = []
    const filledSouls: any[] = []

    // Search for an NPC-named party across NORMAL and EVENT categories.
    let selectedParty: PlayerParty | null = targetParty ?? null
    if (!selectedParty) {
        for (const category of [PartyCategory.NORMAL, PartyCategory.EVENT]) {
            const groups = getPlayerPartyGroupListSync(playerId, category)
            for (const group of Object.values(groups)) {
                for (const party of Object.values(group.list)) {
                    if (party.name && party.name.includes("NPC")) {
                        selectedParty = party
                        break
                    }
                }
                if (selectedParty) break
            }
            if (selectedParty) break
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
                const rawManaNodes = getPlayerCharacterManaNodesSync(playerId, charId)
                const manaNodeMap: Record<string, number> = {}
                for (const id of rawManaNodes) manaNodeMap[String(id)] = 0

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
                const rawNodes = getPlayerCharacterManaNodesSync(playerId, unisonId)
                const nodeMap: Record<string, number> = {}
                for (const id of rawNodes) nodeMap[String(id)] = 0
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
        filledSouls.push(soulId ? [0, soulId] : [1])
    }

    return {
        characters: filledChars,
        unison_characters: filledUnison,
        equipments: filledEquips,
        abilitySoulIds: filledSouls,
    }
}

/** Prime the snapshot before the subsequent TCP handshake. */
export function primeRealPartySnapshot(playerId: number, targetParty?: PlayerParty): any {
    if (targetParty) return buildRealParty(playerId, targetParty)
    const cached = getLiveSnapshot(playerId)
    if (cached !== null) {
        cacheHits++
        return cached
    }
    const party = buildRealParty(playerId)
    storeSnapshot(playerId, party)
    return party
}

/** Return a warmed party or build it once for backward-compatible direct TCP clients. */
export function getRealPartySnapshot(playerId: number): any {
    const cached = getLiveSnapshot(playerId)
    if (cached !== null) {
        cacheHits++
        return cached
    }
    cacheMisses++
    return primeRealPartySnapshot(playerId)
}

/** Keep a client-selected party authoritative for reconnects in the same room. */
export function setRealPartySnapshot(playerId: number, party: any): void {
    if (!Number.isSafeInteger(playerId) || playerId <= 0 || !party || typeof party !== "object") return
    storeSnapshot(playerId, party)
}

export function invalidateRealPartySnapshot(playerId: number): void {
    snapshots.delete(playerId)
}
