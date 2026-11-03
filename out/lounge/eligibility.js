"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.decideLoungeTickets = exports.canParticipateInLounge = void 0;
const crypto_1 = require("crypto");
const campaign_1 = require("../data/domains/campaign");
const campaign_2 = require("../data/domains/campaign");
const item_1 = require("../data/domains/item");
const multi_special_exchange_1 = require("../lib/multi-special-exchange");
const persistence_coordinator_1 = require("../lib/persistence-coordinator");
// Joining cannot create participation progress. Both HTTP and direct TCP
// entry use the same saved eligibility, including safe legacy recovery.
function canParticipateInLounge(playerId, campaignId) {
    const saved = (0, campaign_1.getPlayerMultiSpecialExchangeCampaignsSync)(playerId).find(value => value.campaignId === campaignId);
    const campaign = saved && (0, multi_special_exchange_1.resolveMultiSpecialExchangeCampaign)(saved, id => { var _a; return (_a = (0, item_1.getPlayerItemSync)(playerId, id)) !== null && _a !== void 0 ? _a : 0; });
    return !!campaign && (campaign.status === 1 || campaign.status === 2);
}
exports.canParticipateInLounge = canParticipateInLounge;
/** Commit all existing participants' pending tickets before the Start frame. */
function decideLoungeTickets(room, playerIds) {
    const definition = (0, multi_special_exchange_1.getMultiSpecialExchangeCampaignDefinition)(room.campaignId);
    if (!definition || playerIds.length !== 3 || playerIds.some(id => id === undefined)
        || new Set(playerIds).size !== 3)
        return false;
    return (0, persistence_coordinator_1.runPersistenceTransactionSync)({ domain: "event", operation: "start_multi_special_exchange" }, () => {
        // Recheck the entire group before writing. Single-player draw may have
        // consumed one participant's eligibility after their socket entered.
        const participants = playerIds.map(playerId => {
            const saved = (0, campaign_1.getPlayerMultiSpecialExchangeCampaignsSync)(playerId)
                .find(value => value.campaignId === room.campaignId);
            const campaign = saved && (0, multi_special_exchange_1.resolveMultiSpecialExchangeCampaign)(saved, id => { var _a; return (_a = (0, item_1.getPlayerItemSync)(playerId, id)) !== null && _a !== void 0 ? _a : 0; });
            return { playerId: playerId, campaign };
        });
        if (participants.some(({ campaign }) => !campaign || (campaign.status !== 1 && campaign.status !== 2)))
            return false;
        for (const { playerId, campaign } of participants) {
            const ticketItemId = campaign.status === 2 && campaign.ticketItemId != null
                ? campaign.ticketItemId : definition.ticketItemIds[(0, crypto_1.randomInt)(definition.ticketItemIds.length)];
            (0, campaign_2.updatePlayerMultiSpecialExchangeCampaignSync)(playerId, {
                campaignId: room.campaignId, status: 2, ticketItemId,
            });
        }
        // No inventory is awarded here. Existing /load status2 handling can
        // finish the normal draw even if the app closes before receiving Start.
        return true;
    });
}
exports.decideLoungeTickets = decideLoungeTickets;
