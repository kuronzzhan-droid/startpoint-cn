import campaignCharacters from "../../assets/multi_special_exchange_campaign_character.json"
import type { PlayerMultiSpecialExchangeCampaign } from "../data/types"

export interface MultiSpecialExchangeCampaignDefinition {
    campaignId: number
    ticketItemIds: readonly number[]
}

// CN master/campaign/multi_special_exchange currently contains campaigns 1-3.
// Campaigns 4-5 use the same sequential ticket allocation in later official
// data; campaign 5 is also present in the repository's captured API response.
const CAMPAIGNS = new Map<number, MultiSpecialExchangeCampaignDefinition>([
    [1, { campaignId: 1, ticketItemIds: [980001, 980002, 980003] }],
    [2, { campaignId: 2, ticketItemIds: [980004] }],
    [3, { campaignId: 3, ticketItemIds: [980005] }],
    [4, { campaignId: 4, ticketItemIds: [980006] }],
    [5, { campaignId: 5, ticketItemIds: [980007] }],
])

// Exchangeable characters per ticket item, mirrored from the client master
// table master/campaign/multi_special_exchange/multi_special_exchange_campaign_character
// (ticket item id -> character ids). The client builds its selection list from
// the same table, so only these pairs can be chosen in the exchange screen.
// Tickets without a client list (980006/980007) have no exchangeable characters.
const EXCHANGEABLE_CHARACTERS = new Map<number, ReadonlySet<number>>(
    Object.entries(campaignCharacters as Record<string, number[]>)
        .map(([ticketItemId, characterIds]) => [Number(ticketItemId), new Set(characterIds)]),
)

export function getMultiSpecialExchangeCampaignDefinition(
    campaignId: number,
): MultiSpecialExchangeCampaignDefinition | null {
    const definition = CAMPAIGNS.get(campaignId)
    // A later campaign ID is not usable until its ticket selection lists are
    // present in the client master mirrored by this server.
    return definition && definition.ticketItemIds.every(id => (EXCHANGEABLE_CHARACTERS.get(id)?.size ?? 0) > 0)
        ? definition : null
}

export function isMultiSpecialExchangeCharacter(ticketItemId: number, characterId: number): boolean {
    return EXCHANGEABLE_CHARACTERS.get(ticketItemId)?.has(characterId) ?? false
}

/** Resolve legacy progress without issuing tickets or mutating saved state. */
export function resolveMultiSpecialExchangeCampaign(
    campaign: PlayerMultiSpecialExchangeCampaign,
    getItemAmount: (ticketItemId: number) => number,
): PlayerMultiSpecialExchangeCampaign | null {
    const definition = getMultiSpecialExchangeCampaignDefinition(campaign.campaignId)
    if (!definition || !Number.isInteger(campaign.status) || campaign.status < 1 || campaign.status > 4) return null
    if (campaign.status === 1 || campaign.status === 4) {
        return { campaignId: campaign.campaignId, status: campaign.status, ticketItemId: null }
    }
    const held = definition.ticketItemIds.filter(id => {
        const amount = getItemAmount(id)
        return Number.isSafeInteger(amount) && amount > 0
    })
    const selected = campaign.ticketItemId
    const validSelected = selected !== null && selected !== undefined && definition.ticketItemIds.includes(selected)
    if (campaign.status === 3) {
        const ticketItemId = validSelected && held.includes(selected!) ? selected! : held.length === 1 ? held[0] : null
        // Sending Drew without a usable ticket makes the client unwrap None
        // while loading the home scene. Preserve unresolved rows in the DB.
        return ticketItemId === null ? null : { campaignId: campaign.campaignId, status: 3, ticketItemId }
    }
    if (selected !== null && selected !== undefined && !validSelected) return null
    const ticketItemId = validSelected ? selected! : definition.ticketItemIds.length === 1 ? definition.ticketItemIds[0] : null
    if (held.length > 0) {
        const alreadyDrawn = ticketItemId !== null && held.includes(ticketItemId)
            ? ticketItemId : selected == null && held.length === 1 ? held[0] : null
        return alreadyDrawn === null ? null : { campaignId: campaign.campaignId, status: 3, ticketItemId: alreadyDrawn }
    }
    // TicketDecided is read by status alone. With no ticket yet paid, a legacy
    // empty identity remains eligible for the normal first multi-draw; unlike
    // Drew, it does not require a selected ticket to load the home scene.
    return { campaignId: campaign.campaignId, status: 2, ticketItemId }
}
