import campaignCharacters from "../../assets/multi_special_exchange_campaign_character.json"

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
    return CAMPAIGNS.get(campaignId) ?? null
}

export function isMultiSpecialExchangeCharacter(ticketItemId: number, characterId: number): boolean {
    return EXCHANGEABLE_CHARACTERS.get(ticketItemId)?.has(characterId) ?? false
}
