import { isRealtimeOwnerChild } from "../coordinator/runtime-role"
import { getQuestBusinessPolicy, getKnownExclusiveBusinessItemIds } from "../coordinator/business-facts"

const PARTY_ITEM_FIELDS = [
    "equipments", "equipmentIds", "equipment_ids",
    "abilitySoulIds", "ability_soul_ids",
] as const

// These CN item IDs remain Fantasy-only even without the optional runtime.
const FANTASY_ITEM_IDS = new Set(Array.from({ length: 11 }, (_, index) => 100013 + index))

function itemId(raw: any): unknown {
    const value = Array.isArray(raw) ? (raw[0] === 0 ? raw[1] : null) : raw
    if (!value || typeof value !== "object") return value
    return value.equipmentId ?? value.equipment_id
        ?? value.abilitySoulId ?? value.ability_soul_id ?? value.id
}

/** Shared item parsing for player readiness and complete AI-party admission. */
export function exclusivePartyItems(party: any): number[] {
    if (!party || typeof party !== "object") return []
    const ids: number[] = []
    for (const field of PARTY_ITEM_FIELDS) {
        const values = party[field]
        if (Array.isArray(values)) ids.push(...values.map(value => Number(itemId(value))))
    }
    return [...new Set([
        ...ids.filter(id => FANTASY_ITEM_IDS.has(id)),
        ...(isRealtimeOwnerChild() ? ids.filter(id => getKnownExclusiveBusinessItemIds().includes(id))
            : require("../../lib/mode15-optional").getMode15ExclusiveItemIds(ids)),
    ])]
}

/** Keep complete loadouts; never admit an AI by silently removing its gear. */
export function isNpcPartyAllowedInRoom(
    category: number | undefined,
    questId: number | undefined,
    party: any,
): boolean {
    if (!party || typeof party !== "object") return false
    return (category !== undefined && questId !== undefined
        && (isRealtimeOwnerChild() ? getQuestBusinessPolicy(category, questId)?.equipmentAllowed === true
            : require("../../lib/mode15-optional").isMode15EquipmentAllowedQuest(category, questId)))
        || exclusivePartyItems(party).length === 0
}
