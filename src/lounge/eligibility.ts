import { randomInt } from "crypto"
import { getPlayerMultiSpecialExchangeCampaignsSync } from "../data/domains/campaign"
import { updatePlayerMultiSpecialExchangeCampaignSync } from "../data/domains/campaign"
import { getPlayerItemSync } from "../data/domains/item"
import { getMultiSpecialExchangeCampaignDefinition, resolveMultiSpecialExchangeCampaign } from "../lib/multi-special-exchange"
import { runPersistenceTransactionSync } from "../lib/persistence-coordinator"
import type { LoungeRoom } from "./state"

// Joining cannot create participation progress. Both HTTP and direct TCP
// entry use the same saved eligibility, including safe legacy recovery.
export function canParticipateInLounge(playerId: number, campaignId: number): boolean {
    const saved = getPlayerMultiSpecialExchangeCampaignsSync(playerId).find(value => value.campaignId === campaignId)
    const campaign = saved && resolveMultiSpecialExchangeCampaign(saved, id => getPlayerItemSync(playerId, id) ?? 0)
    return !!campaign && (campaign.status === 1 || campaign.status === 2)
}

/** Commit all existing participants' pending tickets before the Start frame. */
export function decideLoungeTickets(room: LoungeRoom, playerIds: readonly (number | undefined)[]): boolean {
    const definition = getMultiSpecialExchangeCampaignDefinition(room.campaignId)
    if (!definition || playerIds.length !== 3 || playerIds.some(id => id === undefined)
        || new Set(playerIds).size !== 3) return false
    return runPersistenceTransactionSync({ domain: "event", operation: "start_multi_special_exchange" }, () => {
        // Recheck the entire group before writing. Single-player draw may have
        // consumed one participant's eligibility after their socket entered.
        const participants = playerIds.map(playerId => {
            const saved = getPlayerMultiSpecialExchangeCampaignsSync(playerId!)
                .find(value => value.campaignId === room.campaignId)
            const campaign = saved && resolveMultiSpecialExchangeCampaign(saved,
                id => getPlayerItemSync(playerId!, id) ?? 0)
            return { playerId: playerId!, campaign }
        })
        if (participants.some(({ campaign }) => !campaign || (campaign.status !== 1 && campaign.status !== 2))) return false
        for (const { playerId, campaign } of participants) {
            const ticketItemId = campaign!.status === 2 && campaign!.ticketItemId != null
                ? campaign!.ticketItemId : definition.ticketItemIds[randomInt(definition.ticketItemIds.length)]
            updatePlayerMultiSpecialExchangeCampaignSync(playerId, {
                campaignId: room.campaignId, status: 2, ticketItemId,
            })
        }
        // No inventory is awarded here. Existing /load status2 handling can
        // finish the normal draw even if the app closes before receiving Start.
        return true
    })
}
