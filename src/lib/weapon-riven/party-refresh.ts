import { PartyCategory } from "../../data/types"
import { invalidateRealPartySnapshot } from "../../multi/party-snapshot"
import { getRoomCommandGateway } from "../../multi/coordinator/default-runtime"
import { refreshWeaponRivenSettlementResponseSync } from "./settlement-response"

/** Invoke only after the inventory/party transaction has committed. */
export async function refreshWeaponRivenPartiesAfterCommit(playerId: number,
    parties: Array<{ party_id: number; party_category: number }> = []): Promise<void> {
    if (parties.length === 0) return
    invalidateRealPartySnapshot(playerId)
    try {
        await getRoomCommandGateway().execute("runtime.partyChanged", { playerId,
            changedPartyIds: parties.filter(party => party.party_category === PartyCategory.NORMAL).map(party => party.party_id),
            selectionChanged: false })
    } catch (error) {
        console.error(`[RIVEN] committed party cleanup; lobby refresh failed: player=${playerId}`, error)
    }
}

/** A retry also repairs cache invalidation lost after a previous durable commit. */
export async function refreshWeaponRivenSettlementResponseAfterCommit<T>(playerId: number, response: T): Promise<T> {
    const current = refreshWeaponRivenSettlementResponseSync(playerId, response)
    const data = (current as { data?: { weapon_riven_list?: unknown;
        party_info_list?: Array<{ party_id: number; party_category: number }> } } | null)?.data
    if (data?.weapon_riven_list) await refreshWeaponRivenPartiesAfterCommit(playerId, data.party_info_list)
    return current
}
