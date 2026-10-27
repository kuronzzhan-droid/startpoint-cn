import { getPlayerItemSync } from "../../data/domains/item"
import { getPlayerWeaponRivenSync } from "../../data/domains/weaponRiven"
import { getWeaponRivenPartyInfoListSync } from "../../data/domains/weapon-riven-party"
import { WeaponRivenAutoDismantled, WeaponRivenView } from "./model"

interface SettlementData {
    item_list?: Record<string, number>
    weapon_riven_list?: Record<string, WeaponRivenView>
    weapon_riven_deleted?: number[]
    weapon_riven_granted?: number[]
    weapon_riven_auto_dismantled?: WeaponRivenAutoDismantled[]
    party_info_list?: Array<{ party_id: number; party_category: number }>
}

/** The receipt fixes the reward decision; current balances and parties remain authoritative. */
export function refreshWeaponRivenSettlementDataSync<T extends SettlementData>(playerId: number, data: T): T {
    const refreshed = { ...data }
    if (data.item_list) refreshed.item_list = Object.fromEntries(Object.keys(data.item_list)
        .map(id => [id, getPlayerItemSync(playerId, id) ?? 0]))
    if (data.weapon_riven_list) {
        // The overflow decision is frozen, including affixes and reward amounts. Old receipts had none.
        refreshed.weapon_riven_auto_dismantled = data.weapon_riven_auto_dismantled ?? []
        const current: Record<string, WeaponRivenView> = {}
        const deleted: number[] = []
        const itemIds = new Set([...Object.keys(data.weapon_riven_list).map(Number), ...(data.weapon_riven_deleted ?? [])])
        for (const itemId of itemIds) {
            const riven = getPlayerWeaponRivenSync(playerId, itemId)
            if (riven) current[itemId] = riven
            else deleted.push(itemId)
        }
        refreshed.weapon_riven_list = current
        refreshed.weapon_riven_deleted = deleted
        // Old receipts predate the explicit grant list. Their frozen cards still identify
        // the rewards, but a recycled item slot must never label its replacement as a grant.
        const granted = data.weapon_riven_granted ?? Object.keys(data.weapon_riven_list).map(Number)
        refreshed.weapon_riven_granted = granted.filter(itemId => {
            const original = data.weapon_riven_list![itemId]
            return original && current[itemId]?.riven_id === original.riven_id
        })
    }
    if (data.party_info_list) refreshed.party_info_list = getWeaponRivenPartyInfoListSync(playerId,
        data.party_info_list.map(party => ({ category: party.party_category,
            group_id: Math.floor((party.party_id - 1) / 10) + 1, slot: (party.party_id - 1) % 10 + 1 })))
    return refreshed
}

/** Only riven-aware five-boss receipts need this projection; ordinary solo receipts are unchanged. */
export function refreshWeaponRivenSettlementResponseSync<T>(playerId: number, response: T): T {
    const data = (response as { data?: SettlementData } | null)?.data
    if (!data?.weapon_riven_list) return response
    return { ...response, data: refreshWeaponRivenSettlementDataSync(playerId, data) }
}
