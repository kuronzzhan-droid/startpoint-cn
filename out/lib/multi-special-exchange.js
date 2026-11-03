"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveMultiSpecialExchangeCampaign = exports.isMultiSpecialExchangeCharacter = exports.getMultiSpecialExchangeCampaignDefinition = void 0;
const multi_special_exchange_campaign_character_json_1 = __importDefault(require("../../assets/multi_special_exchange_campaign_character.json"));
// CN master/campaign/multi_special_exchange currently contains campaigns 1-3.
// Campaigns 4-5 use the same sequential ticket allocation in later official
// data; campaign 5 is also present in the repository's captured API response.
const CAMPAIGNS = new Map([
    [1, { campaignId: 1, ticketItemIds: [980001, 980002, 980003] }],
    [2, { campaignId: 2, ticketItemIds: [980004] }],
    [3, { campaignId: 3, ticketItemIds: [980005] }],
    [4, { campaignId: 4, ticketItemIds: [980006] }],
    [5, { campaignId: 5, ticketItemIds: [980007] }],
]);
// Exchangeable characters per ticket item, mirrored from the client master
// table master/campaign/multi_special_exchange/multi_special_exchange_campaign_character
// (ticket item id -> character ids). The client builds its selection list from
// the same table, so only these pairs can be chosen in the exchange screen.
// Tickets without a client list (980006/980007) have no exchangeable characters.
const EXCHANGEABLE_CHARACTERS = new Map(Object.entries(multi_special_exchange_campaign_character_json_1.default)
    .map(([ticketItemId, characterIds]) => [Number(ticketItemId), new Set(characterIds)]));
function getMultiSpecialExchangeCampaignDefinition(campaignId) {
    const definition = CAMPAIGNS.get(campaignId);
    // A later campaign ID is not usable until its ticket selection lists are
    // present in the client master mirrored by this server.
    return definition && definition.ticketItemIds.every(id => { var _a, _b; return ((_b = (_a = EXCHANGEABLE_CHARACTERS.get(id)) === null || _a === void 0 ? void 0 : _a.size) !== null && _b !== void 0 ? _b : 0) > 0; })
        ? definition : null;
}
exports.getMultiSpecialExchangeCampaignDefinition = getMultiSpecialExchangeCampaignDefinition;
function isMultiSpecialExchangeCharacter(ticketItemId, characterId) {
    var _a, _b;
    return (_b = (_a = EXCHANGEABLE_CHARACTERS.get(ticketItemId)) === null || _a === void 0 ? void 0 : _a.has(characterId)) !== null && _b !== void 0 ? _b : false;
}
exports.isMultiSpecialExchangeCharacter = isMultiSpecialExchangeCharacter;
/** Resolve legacy progress without issuing tickets or mutating saved state. */
function resolveMultiSpecialExchangeCampaign(campaign, getItemAmount) {
    const definition = getMultiSpecialExchangeCampaignDefinition(campaign.campaignId);
    if (!definition || !Number.isInteger(campaign.status) || campaign.status < 1 || campaign.status > 4)
        return null;
    if (campaign.status === 1 || campaign.status === 4) {
        return { campaignId: campaign.campaignId, status: campaign.status, ticketItemId: null };
    }
    const held = definition.ticketItemIds.filter(id => {
        const amount = getItemAmount(id);
        return Number.isSafeInteger(amount) && amount > 0;
    });
    const selected = campaign.ticketItemId;
    const validSelected = selected !== null && selected !== undefined && definition.ticketItemIds.includes(selected);
    if (campaign.status === 3) {
        const ticketItemId = validSelected && held.includes(selected) ? selected : held.length === 1 ? held[0] : null;
        // Sending Drew without a usable ticket makes the client unwrap None
        // while loading the home scene. Preserve unresolved rows in the DB.
        return ticketItemId === null ? null : { campaignId: campaign.campaignId, status: 3, ticketItemId };
    }
    if (selected !== null && selected !== undefined && !validSelected)
        return null;
    const ticketItemId = validSelected ? selected : definition.ticketItemIds.length === 1 ? definition.ticketItemIds[0] : null;
    if (held.length > 0) {
        const alreadyDrawn = ticketItemId !== null && held.includes(ticketItemId)
            ? ticketItemId : selected == null && held.length === 1 ? held[0] : null;
        return alreadyDrawn === null ? null : { campaignId: campaign.campaignId, status: 3, ticketItemId: alreadyDrawn };
    }
    // TicketDecided is read by status alone. With no ticket yet paid, a legacy
    // empty identity remains eligible for the normal first multi-draw; unlike
    // Drew, it does not require a selected ticket to load the home scene.
    return { campaignId: campaign.campaignId, status: 2, ticketItemId };
}
exports.resolveMultiSpecialExchangeCampaign = resolveMultiSpecialExchangeCampaign;
