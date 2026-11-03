"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const player_time_compat_1 = require("../../lib/player-time-compat");
const crypto_1 = require("crypto");
const activeAccount_1 = require("../../data/activeAccount");
const campaign_1 = require("../../data/domains/campaign");
const item_1 = require("../../data/domains/item");
const player_1 = require("../../data/domains/player");
const session_1 = require("../../data/domains/session");
const mission_1 = require("../../lib/mission");
const character_1 = require("../../lib/character");
const multi_special_exchange_1 = require("../../lib/multi-special-exchange");
const persistence_coordinator_1 = require("../../lib/persistence-coordinator");
const utils_1 = require("../../utils");
function positiveSafeInteger(value) {
    if (typeof value !== "number" && (typeof value !== "string" || !/^\d+$/.test(value)))
        return null;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}
function requestBody(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function resolveViewer(body) {
    return __awaiter(this, void 0, void 0, function* () {
        const viewerId = positiveSafeInteger(body.viewer_id);
        if (viewerId === null)
            return null;
        const session = yield (0, session_1.getSession)(String(viewerId));
        if (!session)
            return null;
        const playerId = (0, activeAccount_1.resolvePlayerIdSync)(session.accountId);
        return playerId === null ? null : { viewerId, playerId };
    });
}
function sendResultCode(reply, viewerId, resultCode) {
    reply.header("content-type", "application/x-msgpack");
    return reply.status(200).send({
        data_headers: (0, utils_1.generateDataHeaders)({ viewer_id: viewerId, result_code: resultCode }),
        data: {},
    });
}
function drawTicket(playerId, campaignId) {
    return __awaiter(this, void 0, void 0, function* () {
        const definition = (0, multi_special_exchange_1.getMultiSpecialExchangeCampaignDefinition)(campaignId);
        if (!definition)
            return null;
        return (0, persistence_coordinator_1.runPersistenceTransaction)({
            domain: "event", playerId, operation: "draw_multi_special_ticket",
        }, () => {
            var _a;
            const campaign = (0, campaign_1.getPlayerMultiSpecialExchangeCampaignsSync)(playerId)
                .find(value => value.campaignId === campaignId);
            if (!campaign)
                return null;
            const resolved = (0, multi_special_exchange_1.resolveMultiSpecialExchangeCampaign)(campaign, id => { var _a; return (_a = (0, item_1.getPlayerItemSync)(playerId, id)) !== null && _a !== void 0 ? _a : 0; });
            if ((resolved === null || resolved === void 0 ? void 0 : resolved.status) === 3) {
                if (campaign.status !== 3 || campaign.ticketItemId !== resolved.ticketItemId) {
                    (0, campaign_1.updatePlayerMultiSpecialExchangeCampaignSync)(playerId, resolved);
                }
                const ticketItemId = resolved.ticketItemId;
                return { ticketItemId, itemAmount: (_a = (0, item_1.getPlayerItemSync)(playerId, ticketItemId)) !== null && _a !== void 0 ? _a : 0 };
            }
            const undecidedLegacy = campaign.status === 2 && campaign.ticketItemId == null
                && definition.ticketItemIds.every(id => { var _a; return ((_a = (0, item_1.getPlayerItemSync)(playerId, id)) !== null && _a !== void 0 ? _a : 0) === 0; });
            if (campaign.status !== 1 && (resolved === null || resolved === void 0 ? void 0 : resolved.status) !== 2 && !undecidedLegacy)
                return null;
            const ticketItemId = (resolved === null || resolved === void 0 ? void 0 : resolved.status) === 2 && resolved.ticketItemId != null ? resolved.ticketItemId
                : definition.ticketItemIds[(0, crypto_1.randomInt)(definition.ticketItemIds.length)];
            const itemAmount = (0, item_1.givePlayerItemSync)(playerId, ticketItemId, 1);
            (0, campaign_1.updatePlayerMultiSpecialExchangeCampaignSync)(playerId, {
                campaignId,
                status: 3,
                ticketItemId,
            });
            return { ticketItemId, itemAmount };
        });
    });
}
const routes = (fastify) => __awaiter(void 0, void 0, void 0, function* () {
    const registerDrawRoute = (path) => {
        fastify.post(path, (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
            var _a;
            const body = requestBody(request.body);
            const context = yield resolveViewer(body);
            const campaignId = positiveSafeInteger(body.campaign_id);
            if (!context || campaignId === null)
                return sendResultCode(reply, (_a = context === null || context === void 0 ? void 0 : context.viewerId) !== null && _a !== void 0 ? _a : 0, 4901);
            const definition = (0, multi_special_exchange_1.getMultiSpecialExchangeCampaignDefinition)(campaignId);
            if (!definition)
                return sendResultCode(reply, context.viewerId, 4901);
            const drawn = yield drawTicket(context.playerId, campaignId);
            if (!drawn)
                return sendResultCode(reply, context.viewerId, 4902);
            reply.header("content-type", "application/x-msgpack");
            return reply.status(200).send({
                data_headers: (0, utils_1.generateDataHeaders)({ viewer_id: context.viewerId }),
                data: {
                    multi_special_exchange_campaign_list: [{
                            campaign_id: campaignId,
                            status: 3,
                            ticket_item_id: drawn.ticketItemId,
                        }],
                    item_list: { [drawn.ticketItemId]: drawn.itemAmount },
                    mail_arrived: false,
                },
            });
        }));
    };
    registerDrawRoute("/single_draw_ticket");
    registerDrawRoute("/multi_draw_ticket");
    fastify.post("/exchange_character", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        var _a, _b, _c;
        const body = requestBody(request.body);
        const context = yield resolveViewer(body);
        const campaignId = positiveSafeInteger(body.campaign_id);
        const characterId = positiveSafeInteger(body.character_id);
        const ticketItemId = positiveSafeInteger(body.ticket_item_id);
        if (!context || campaignId === null || characterId === null || ticketItemId === null) {
            return sendResultCode(reply, (_a = context === null || context === void 0 ? void 0 : context.viewerId) !== null && _a !== void 0 ? _a : 0, 4901);
        }
        const definition = (0, multi_special_exchange_1.getMultiSpecialExchangeCampaignDefinition)(campaignId);
        if (!definition || !definition.ticketItemIds.includes(ticketItemId)) {
            return sendResultCode(reply, context.viewerId, 4901);
        }
        // Only characters listed for this ticket in the client master table
        // can be selected; other ids are rejected like any failed exchange.
        if (!(0, multi_special_exchange_1.isMultiSpecialExchangeCharacter)(ticketItemId, characterId)) {
            return sendResultCode(reply, context.viewerId, 4902);
        }
        const exchangeResult = yield (0, persistence_coordinator_1.runPersistenceTransaction)({
            domain: "event", playerId: context.playerId, operation: "exchange_character",
        }, () => {
            var _a;
            const campaign = (0, campaign_1.getPlayerMultiSpecialExchangeCampaignsSync)(context.playerId)
                .find(value => value.campaignId === campaignId);
            const ticketAmount = (_a = (0, item_1.getPlayerItemSync)(context.playerId, ticketItemId)) !== null && _a !== void 0 ? _a : 0;
            if ((campaign === null || campaign === void 0 ? void 0 : campaign.status) === 4) {
                // The archive contains completion, but no choice receipt.
                // Replay completion only, never invent or issue another reward.
                return { reward: null, newTicketAmount: ticketAmount };
            }
            const resolved = campaign && (0, multi_special_exchange_1.resolveMultiSpecialExchangeCampaign)(campaign, id => { var _a; return (_a = (0, item_1.getPlayerItemSync)(context.playerId, id)) !== null && _a !== void 0 ? _a : 0; });
            if (!resolved || resolved.status !== 3 || resolved.ticketItemId !== ticketItemId || ticketAmount <= 0) {
                return null;
            }
            const reward = (0, character_1.givePlayerCharacterSync)(context.playerId, characterId);
            if (!reward)
                return null;
            const newTicketAmount = ticketAmount - 1;
            (0, item_1.setPlayerItemSync)(context.playerId, ticketItemId, newTicketAmount);
            (0, campaign_1.updatePlayerMultiSpecialExchangeCampaignSync)(context.playerId, {
                campaignId,
                status: 4,
                ticketItemId: null,
            });
            return { reward, newTicketAmount };
        });
        if (!exchangeResult)
            return sendResultCode(reply, context.viewerId, 4902);
        const characterList = ((_b = exchangeResult.reward) === null || _b === void 0 ? void 0 : _b.character)
            ? (0, mission_1.reconcileAwakeUnlockCharacterList)(context.playerId, [
                Object.assign(Object.assign({}, exchangeResult.reward.character), { viewer_id: context.viewerId }),
            ])
            : [];
        const itemList = {
            [ticketItemId]: exchangeResult.newTicketAmount,
        };
        if ((_c = exchangeResult.reward) === null || _c === void 0 ? void 0 : _c.item) {
            itemList[String(exchangeResult.reward.item.id)] =
                exchangeResult.reward.item.inventoryCount;
        }
        const player = (0, player_1.getPlayerSync)(context.playerId);
        reply.header("content-type", "application/x-msgpack");
        return reply.status(200).send({
            data_headers: (0, utils_1.generateDataHeaders)({ viewer_id: context.viewerId }),
            data: {
                multi_special_exchange_campaign_list: [{ campaign_id: campaignId, status: 4 }],
                character_list: characterList,
                item_list: itemList,
                user_info: player ? {
                    free_mana: player.freeMana,
                    exp_pool: player.expPool,
                    exp_pooled_time: (0, player_time_compat_1.getPlayerClientExpTime)(player),
                    free_vmoney: player.freeVmoney,
                } : undefined,
                encyclopedia_info: {},
                mission_info: [],
                mail_arrived: false,
            },
        });
    }));
});
exports.default = routes;
