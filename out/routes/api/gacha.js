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
const mail_1 = require("../../data/domains/mail");
const gacha_1 = require("../../data/domains/gacha");
const item_1 = require("../../data/domains/item");
const player_1 = require("../../data/domains/player");
const session_1 = require("../../data/domains/session");
const utils_1 = require("../../utils");
const gacha_2 = require("../../lib/gacha");
const assets_1 = require("../../lib/assets");
const types_1 = require("../../lib/types");
const utils_2 = require("../../data/utils");
const activeAccount_1 = require("../../data/activeAccount");
const character_1 = require("../../lib/character");
const equipment_1 = require("../../lib/equipment");
const gacha_exec_plan_1 = require("../../lib/gacha-exec-plan");
const gacha_rules_1 = require("../../lib/gacha-rules");
const mission_1 = require("../../lib/mission");
const active_mission_counters_1 = require("../../data/domains/active_mission_counters");
const game_logging_1 = require("../../lib/game-logging");
const option_1 = require("../../data/domains/option");
const settlement_performance_1 = require("../../lib/settlement-performance");
const persistence_coordinator_1 = require("../../lib/persistence-coordinator");
const node_crypto_1 = require("node:crypto");
const player_operation_receipt_1 = require("../../data/domains/player-operation-receipt");
const crazy_gacha_1 = require("../../lib/crazy-gacha");
const MAX_GACHA_EXEC_COUNT = 10;
function parseGachaTimestamp(value) {
    // Master-data timestamps are expressed in China Standard Time without an offset.
    return Date.parse(`${value.replace(" ", "T")}+08:00`);
}
function isGachaAvailableAt(gacha, now) {
    const start = parseGachaTimestamp(gacha.startDate);
    const end = parseGachaTimestamp(gacha.endDate);
    return Number.isFinite(start) && Number.isFinite(end) && now >= start && now <= end;
}
var GachaPaymentType;
(function (GachaPaymentType) {
    GachaPaymentType[GachaPaymentType["EMPTY"] = 0] = "EMPTY";
    GachaPaymentType[GachaPaymentType["FREE_VMONEY"] = 1] = "FREE_VMONEY";
    GachaPaymentType[GachaPaymentType["VMONEY"] = 2] = "VMONEY";
    GachaPaymentType[GachaPaymentType["TICKET"] = 3] = "TICKET";
    GachaPaymentType[GachaPaymentType["CAMPAIGN"] = 4] = "CAMPAIGN";
})(GachaPaymentType || (GachaPaymentType = {}));
var GachaExecType;
(function (GachaExecType) {
    GachaExecType[GachaExecType["EMPTY"] = 0] = "EMPTY";
    GachaExecType[GachaExecType["VMONEY_SINGLE"] = 1] = "VMONEY_SINGLE";
    GachaExecType[GachaExecType["VMONEY_MULTI"] = 2] = "VMONEY_MULTI";
    GachaExecType[GachaExecType["UNKNOWN_1"] = 3] = "UNKNOWN_1";
    GachaExecType[GachaExecType["UNKNOWN_2"] = 4] = "UNKNOWN_2";
    GachaExecType[GachaExecType["DAILY_SINGLE"] = 5] = "DAILY_SINGLE";
    GachaExecType[GachaExecType["UNKNOWN_3"] = 6] = "UNKNOWN_3";
    GachaExecType[GachaExecType["CAMPAIGN_SINGLE"] = 7] = "CAMPAIGN_SINGLE";
    GachaExecType[GachaExecType["CAMPAIGN_MULTI"] = 8] = "CAMPAIGN_MULTI";
    GachaExecType[GachaExecType["MULTI_TICKET"] = 9] = "MULTI_TICKET";
    GachaExecType[GachaExecType["SINGLE_TICKET"] = 10] = "SINGLE_TICKET";
    GachaExecType[GachaExecType["UNKNOWN_4"] = 11] = "UNKNOWN_4";
    GachaExecType[GachaExecType["SINGLE_WEAPON_TICKET"] = 12] = "SINGLE_WEAPON_TICKET";
    GachaExecType[GachaExecType["MULTI_WEAPON_TICKET"] = 13] = "MULTI_WEAPON_TICKET";
})(GachaExecType || (GachaExecType = {}));
const exchangeRequiredPoints = 250;
function buildExchangeRequestKey(operation, requestId, gachaId, rewardId) {
    // api_count is only a legacy sequence value and may reset between client
    // sessions. It is deliberately not used as a durable idempotency key.
    if (typeof requestId !== "string" || requestId.length === 0 || requestId.length > 256)
        return null;
    return (0, node_crypto_1.createHash)("sha256")
        .update(`${operation}\u0000${requestId}\u0000${gachaId}\u0000${rewardId}`)
        .digest("hex");
}
function sendExchangeResponse(reply, viewerId, responseData) {
    reply.header("content-type", "application/x-msgpack");
    return reply.status(200).send({
        "data_headers": (0, utils_1.generateDataHeaders)({ viewer_id: viewerId }),
        "data": responseData,
    });
}
const routes = (fastify) => __awaiter(void 0, void 0, void 0, function* () {
    (0, crazy_gacha_1.registerCrazyGachaRoutes)(fastify);
    fastify.post("/exchange_equipment", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        const body = request.body;
        const equipmentId = body.equipment_id;
        const gachaId = body.gacha_id;
        const viewerId = body.viewer_id;
        if (isNaN(viewerId) || isNaN(equipmentId) || isNaN(gachaId))
            return reply.status(400).send({
                "error": "Bad Request",
                "message": "Invalid request body."
            });
        const viewerIdSession = yield (0, session_1.getSession)(viewerId.toString());
        if (!viewerIdSession)
            return reply.status(400).send({
                "error": "Bad Request",
                "message": "Invalid viewer id."
            });
        // get player
        const playerId = (0, activeAccount_1.resolvePlayerIdSync)(viewerIdSession.accountId);
        if (playerId === null)
            return reply.status(500).send({
                "error": "Internal Server Error",
                "message": "No players bound to account."
            });
        const operation = "gacha_exchange_equipment";
        const requestKey = buildExchangeRequestKey(operation, body.request_id, gachaId, equipmentId);
        const previous = requestKey
            ? (0, player_operation_receipt_1.getPlayerOperationReceiptSync)(playerId, operation, requestKey)
            : null;
        if (previous)
            return sendExchangeResponse(reply, viewerId, previous.response);
        const gachaData = (0, assets_1.getGachaSync)(gachaId);
        if (gachaData === null || gachaData.type !== types_1.GachaType.WEAPON)
            return reply.status(400).send({
                "error": "Bad Request",
                "message": "No equipment exchange data for gacha with provided id."
            });
        if ((0, gacha_rules_1.getExchangeableGachaItem)(gachaData, equipmentId) === null)
            return reply.status(400).send({
                "error": "Bad Request",
                "message": "Equipment is not exchangeable from this gacha."
            });
        const settlement = yield (0, persistence_coordinator_1.runPersistenceTransaction)({
            domain: "gacha", playerId, operation,
        }, () => {
            var _a;
            const duplicate = requestKey
                ? (0, player_operation_receipt_1.getPlayerOperationReceiptSync)(playerId, operation, requestKey)
                : null;
            if (duplicate)
                return { responseData: duplicate.response, errorMessage: undefined };
            const gachaInfo = (0, gacha_1.getPlayerGachaInfoSync)(playerId, gachaId);
            if (gachaInfo === null)
                return { responseData: null, errorMessage: "No data for gacha with provided id." };
            const newExchangePoints = ((_a = gachaInfo.gachaExchangePoint) !== null && _a !== void 0 ? _a : 0) - exchangeRequiredPoints;
            if (0 > newExchangePoints)
                return { responseData: null, errorMessage: "Not enough exchange points." };
            const giveResult = (0, equipment_1.givePlayerEquipmentSync)(playerId, equipmentId, 1);
            (0, mail_1.insertReceiveHistorySync)(playerId, { type: mail_1.MailType.EQUIPMENT, type_id: equipmentId, number: 1 });
            (0, gacha_1.updatePlayerGachaInfoSync)(playerId, { gachaId, gachaExchangePoint: newExchangePoints });
            const responseData = {
                "equipment_list": [giveResult],
                "gacha_info_list": [{
                        "gacha_id": gachaId,
                        "is_account_first": gachaInfo.isAccountFirst,
                        "is_daily_first": gachaInfo.isDailyFirst,
                        "gacha_exchange_point": newExchangePoints
                    }],
                "encyclopedia_info": [],
                "mail_arrived": false
            };
            if (requestKey)
                (0, player_operation_receipt_1.insertPlayerOperationReceiptSync)({
                    playerId, operation, requestKey, response: responseData,
                });
            return { responseData, errorMessage: undefined };
        });
        if (!settlement.responseData)
            return reply.status(400).send({
                "error": "Bad Request",
                "message": (_a = settlement.errorMessage) !== null && _a !== void 0 ? _a : "Exchange failed."
            });
        return sendExchangeResponse(reply, viewerId, settlement.responseData);
    }));
    fastify.post("/exchange_character", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        var _b;
        const body = request.body;
        const characterId = body.character_id;
        const gachaId = body.gacha_id;
        const viewerId = body.viewer_id;
        if (isNaN(viewerId) || isNaN(characterId) || isNaN(gachaId))
            return reply.status(400).send({
                "error": "Bad Request",
                "message": "Invalid request body."
            });
        const viewerIdSession = yield (0, session_1.getSession)(viewerId.toString());
        if (!viewerIdSession)
            return reply.status(400).send({
                "error": "Bad Request",
                "message": "Invalid viewer id."
            });
        // get player
        const playerId = (0, activeAccount_1.resolvePlayerIdSync)(viewerIdSession.accountId);
        if (playerId === null)
            return reply.status(500).send({
                "error": "Internal Server Error",
                "message": "No players bound to account."
            });
        const operation = "gacha_exchange_character";
        const requestKey = buildExchangeRequestKey(operation, body.request_id, gachaId, characterId);
        const previous = requestKey
            ? (0, player_operation_receipt_1.getPlayerOperationReceiptSync)(playerId, operation, requestKey)
            : null;
        if (previous)
            return sendExchangeResponse(reply, viewerId, previous.response);
        const gachaData = (0, assets_1.getGachaSync)(gachaId);
        if (gachaData === null || gachaData.type !== types_1.GachaType.CHARACTER)
            return reply.status(400).send({
                "error": "Bad Request",
                "message": "No character exchange data for gacha with provided id."
            });
        if ((0, gacha_rules_1.getExchangeableGachaItem)(gachaData, characterId) === null)
            return reply.status(400).send({
                "error": "Bad Request",
                "message": "Character is not exchangeable from this gacha."
            });
        const settlement = yield (0, persistence_coordinator_1.runPersistenceTransaction)({
            domain: "gacha", playerId, operation,
        }, () => {
            var _a;
            const duplicate = requestKey
                ? (0, player_operation_receipt_1.getPlayerOperationReceiptSync)(playerId, operation, requestKey)
                : null;
            if (duplicate)
                return { responseData: duplicate.response, errorMessage: undefined };
            const gachaInfo = (0, gacha_1.getPlayerGachaInfoSync)(playerId, gachaId);
            if (gachaInfo === null)
                return { responseData: null, errorMessage: "No data for gacha with provided id." };
            const newExchangePoints = ((_a = gachaInfo.gachaExchangePoint) !== null && _a !== void 0 ? _a : 0) - exchangeRequiredPoints;
            if (0 > newExchangePoints)
                return { responseData: null, errorMessage: "Not enough exchange points." };
            const giveResult = (0, character_1.givePlayerCharacterSync)(playerId, characterId);
            if (giveResult === null)
                return { responseData: null, errorMessage: "Could not give player character." };
            (0, mail_1.insertReceiveHistorySync)(playerId, { type: mail_1.MailType.CHARACTER, type_id: characterId, number: 1 });
            (0, gacha_1.updatePlayerGachaInfoSync)(playerId, { gachaId, gachaExchangePoint: newExchangePoints });
            const existingCharacterList = giveResult.character
                ? [giveResult.character]
                : [];
            const characterList = existingCharacterList.length > 0
                ? (0, mission_1.reconcileAwakeUnlockCharacterList)(playerId, existingCharacterList)
                : existingCharacterList;
            const responseData = {
                "character_list": characterList,
                "item_list": giveResult.item !== undefined ? {
                    [giveResult.item.id]: giveResult.item.inventoryCount
                } : [],
                "gacha_info_list": [{
                        "gacha_id": gachaId,
                        "is_account_first": gachaInfo.isAccountFirst,
                        "is_daily_first": gachaInfo.isDailyFirst,
                        "gacha_exchange_point": newExchangePoints
                    }],
                "encyclopedia_info": [],
                "mail_arrived": false
            };
            (0, mission_1.settleDegreeMissionResponse)(playerId, viewerId, responseData, undefined, [4]);
            if (requestKey)
                (0, player_operation_receipt_1.insertPlayerOperationReceiptSync)({
                    playerId, operation, requestKey, response: responseData,
                });
            return { responseData, errorMessage: undefined };
        });
        if (!settlement.responseData)
            return reply.status(400).send({
                "error": "Bad Request",
                "message": (_b = settlement.errorMessage) !== null && _b !== void 0 ? _b : "Exchange failed."
            });
        return sendExchangeResponse(reply, viewerId, settlement.responseData);
    }));
    fastify.post("/exec", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        var _c, _d;
        const body = request.body;
        const viewerId = body.viewer_id;
        const gachaId = body.gacha_id;
        const paymentType = body.payment_type;
        const numberOfExec = body.number_of_exec;
        const type = body.type;
        if (!Number.isSafeInteger(viewerId)
            || !Number.isSafeInteger(gachaId)
            || !Number.isSafeInteger(paymentType)
            || !Number.isSafeInteger(type)
            || !Number.isSafeInteger(numberOfExec)
            || numberOfExec < 1
            || numberOfExec > MAX_GACHA_EXEC_COUNT) {
            (0, game_logging_1.gameVerboseLog)(() => `[GACHA] invalid body: v=${viewerId} g=${gachaId} pt=${paymentType} n=${numberOfExec} t=${type}`);
            return reply.status(400).send({
                "error": "Bad Request",
                "message": "Invalid request body."
            });
        }
        const viewerIdSession = yield (0, session_1.getSession)(viewerId.toString());
        if (!viewerIdSession)
            return reply.status(400).send({
                "error": "Bad Request",
                "message": "Invalid viewer id."
            });
        // get player
        const playerId = (0, settlement_performance_1.measureSettlementPhase)("gacha", "account", () => (0, activeAccount_1.resolvePlayerIdSync)(viewerIdSession.accountId));
        if (playerId === null)
            return reply.status(500).send({ "error": "Internal Server Error", "message": "No players bound to account." });
        // get the gacha
        const gachaData = (0, assets_1.getGachaSync)(gachaId);
        if (gachaData === null) {
            (0, game_logging_1.gameVerboseLog)(() => `[GACHA] gacha not found: gachaId=${gachaId}`);
            return reply.status(400).send({
                "error": "Bad Request",
                "message": "Gacha doesn't exist."
            });
        }
        if (gachaData.enforceAvailabilityWindow === true
            && !isGachaAvailableAt(gachaData, (0, utils_1.getServerTime)() * 1000)) {
            (0, game_logging_1.gameVerboseLog)(() => `[GACHA] gacha unavailable: gachaId=${gachaId}`);
            return reply.status(400).send({
                "error": "Bad Request",
                "message": "Gacha is not available."
            });
        }
        if (gachaData.pageKind === crazy_gacha_1.CRAZY_PAGE_KIND) {
            return (0, crazy_gacha_1.handleCrazyGachaExec)(reply, { viewerId, playerId, gachaId, gachaData, type });
        }
        const isCharacterGacha = gachaData.type == types_1.GachaType.CHARACTER;
        const previewPlayer = (0, player_1.getPlayerSync)(playerId);
        if (previewPlayer === null)
            return reply.status(500).send({ "error": "Internal Server Error", "message": "Player not found." });
        const previewGachaData = (_c = (0, gacha_1.getPlayerGachaInfoSync)(playerId, gachaId)) !== null && _c !== void 0 ? _c : {
            gachaId,
            isAccountFirst: true,
            isDailyFirst: true,
            gachaExchangePoint: 0,
        };
        const previewPlan = (0, gacha_exec_plan_1.buildGachaExecPlan)({
            gacha: gachaData,
            paymentType,
            execType: type,
            numberOfExec,
            playerFunds: {
                freeVmoney: previewPlayer.freeVmoney,
                paidVmoney: previewPlayer.vmoney,
            },
            playerGachaData: previewGachaData,
            getTicketCount: itemId => (0, item_1.getPlayerItemSync)(playerId, itemId),
            getCampaignState: () => {
                var _a;
                const campaignId = (0, assets_1.getGachaCampaignIdSync)(gachaId);
                if (campaignId === null)
                    return null;
                const campaign = (0, gacha_1.getPlayerGachaCampaignSync)(playerId, gachaId, campaignId);
                return {
                    campaignId,
                    count: (_a = campaign === null || campaign === void 0 ? void 0 : campaign.count) !== null && _a !== void 0 ? _a : 1,
                    insert: campaign === null,
                };
            },
        });
        if (!previewPlan.ok) {
            (0, game_logging_1.gameVerboseLog)(() => `[GACHA] exec plan rejected: gachaId=${gachaId} paymentType=${paymentType} type=${type} message=${previewPlan.message}`);
            return reply.status(400).send({ "error": "Bad Request", "message": previewPlan.message });
        }
        const pullCount = previewPlan.plan.pullCount;
        const drawMetadata = (0, settlement_performance_1.measureSettlementPhase)("gacha", "draw", () => (0, gacha_2.drawGachaWithMetadataSync)(gachaData, pullCount));
        const drawResult = drawMetadata.map(draw => draw.id);
        let plannedMoviesToCommit;
        const transactionResult = yield (0, settlement_performance_1.measureSettlementPhaseAsync)("gacha", "transaction", () => (0, persistence_coordinator_1.runPersistenceTransaction)({
            domain: "gacha", playerId, operation: "draw",
        }, () => {
            var _a, _b;
            // Availability is authoritative at actual write execution, after queueing.
            const currentGacha = (0, assets_1.getGachaSync)(gachaId);
            if (currentGacha === null)
                return { ok: false, message: "Gacha doesn't exist." };
            if (currentGacha.enforceAvailabilityWindow === true
                && !isGachaAvailableAt(currentGacha, (0, utils_1.getServerTime)() * 1000)) {
                return { ok: false, message: "Gacha is not available." };
            }
            const player = (0, player_1.getPlayerSync)(playerId);
            if (player === null)
                return { ok: false, message: "No player data." };
            const existingGachaData = (0, gacha_1.getPlayerGachaInfoSync)(playerId, gachaId);
            const playerGachaData = existingGachaData !== null && existingGachaData !== void 0 ? existingGachaData : {
                gachaId,
                isAccountFirst: true,
                isDailyFirst: true,
                gachaExchangePoint: 0,
            };
            let plannedCampaign = null;
            const planResult = (0, gacha_exec_plan_1.buildGachaExecPlan)({
                gacha: gachaData,
                paymentType,
                execType: type,
                numberOfExec,
                playerFunds: {
                    freeVmoney: player.freeVmoney,
                    paidVmoney: player.vmoney,
                },
                playerGachaData,
                getTicketCount: itemId => (0, item_1.getPlayerItemSync)(playerId, itemId),
                getCampaignState: () => {
                    const campaignId = (0, assets_1.getGachaCampaignIdSync)(gachaId);
                    if (campaignId === null)
                        return null;
                    const existingCampaign = (0, gacha_1.getPlayerGachaCampaignSync)(playerId, gachaId, campaignId);
                    plannedCampaign = existingCampaign !== null && existingCampaign !== void 0 ? existingCampaign : { gachaId, campaignId, count: 1 };
                    return {
                        campaignId,
                        count: plannedCampaign.count,
                        insert: existingCampaign === null,
                    };
                },
            });
            if (!planResult.ok)
                return { ok: false, message: planResult.message };
            const execPlan = planResult.plan;
            if (execPlan.pullCount !== pullCount) {
                throw new Error("Gacha execution plan changed across the player queue boundary.");
            }
            const plannedCharacterMovies = isCharacterGacha
                ? (0, settlement_performance_1.measureSettlementPhase)("gacha", "movies", () => (0, gacha_2.planCharacterGachaMovies)(gachaData, drawResult, {
                    skipNoRarityUpMovie: (0, option_1.getPlayerOptionSync)(playerId, "gacha_play_no_rarity_up_movie", false),
                    flushPrevious: false,
                }))
                : undefined;
            plannedMoviesToCommit = plannedCharacterMovies;
            const items = {};
            const gachaCampaigns = [];
            if (execPlan.ticket) {
                items[execPlan.ticket.itemId] = execPlan.ticket.afterCount;
                (0, item_1.updatePlayerItemSync)(playerId, execPlan.ticket.itemId, execPlan.ticket.afterCount);
            }
            if (execPlan.campaign) {
                const campaignData = plannedCampaign !== null && plannedCampaign !== void 0 ? plannedCampaign : {
                    gachaId,
                    campaignId: execPlan.campaign.campaignId,
                    count: execPlan.campaign.count,
                };
                campaignData.count = execPlan.campaign.count;
                if (execPlan.campaign.insert) {
                    (0, gacha_1.insertPlayerGachaCampaignSync)(playerId, campaignData);
                }
                else {
                    (0, gacha_1.updatePlayerGachaCampaignSync)(playerId, gachaId, execPlan.campaign.campaignId, execPlan.campaign.count);
                }
                gachaCampaigns.push((0, utils_2.serializeGachaCampaign)(campaignData));
            }
            const rewardResult = (0, gacha_2.rewardPlayerGachaDrawResultSync)(playerId, gachaData, drawResult, drawMetadata, plannedCharacterMovies, false);
            // Log each drawn item in history
            const historyType = isCharacterGacha ? mail_1.MailType.CHARACTER : mail_1.MailType.EQUIPMENT;
            for (const itemId of drawResult) {
                (0, mail_1.insertReceiveHistorySync)(playerId, { type: historyType, type_id: itemId, number: 1 });
            }
            const newGachaExchangePoint = ((_a = playerGachaData.gachaExchangePoint) !== null && _a !== void 0 ? _a : 0) + pullCount;
            if (existingGachaData === null) {
                playerGachaData.isAccountFirst = false;
                playerGachaData.isDailyFirst = false;
                playerGachaData.gachaExchangePoint = newGachaExchangePoint;
                (0, gacha_1.insertPlayerGachaInfoSync)(playerId, playerGachaData);
            }
            else {
                (0, gacha_1.updatePlayerGachaInfoSync)(playerId, {
                    gachaId: gachaId,
                    isDailyFirst: false,
                    isAccountFirst: false,
                    gachaExchangePoint: newGachaExchangePoint
                });
            }
            (0, player_1.updatePlayerSync)({
                id: playerId,
                vmoney: execPlan.paidVmoney,
                freeVmoney: execPlan.freeVmoney
            });
            if (isCharacterGacha) {
                (0, active_mission_counters_1.incrementActiveMissionGachaCharacterCountSync)(playerId, drawResult.length);
            }
            if (execPlan.campaign) {
                (0, active_mission_counters_1.incrementActiveMissionGachaCampaignCountSync)(playerId);
            }
            let responseData;
            if (isCharacterGacha) {
                const existingCharacterList = rewardResult.characters.filter((character) => character !== undefined
                    && character !== null
                    && typeof character === "object"
                    && !Array.isArray(character));
                const characterList = existingCharacterList.length > 0
                    ? (0, settlement_performance_1.measureSettlementPhase)("gacha", "awake", () => (0, mission_1.reconcileAwakeUnlockCharacterList)(playerId, existingCharacterList))
                    : existingCharacterList;
                responseData = {
                    "user_info": {
                        "free_vmoney": execPlan.freeVmoney,
                        "vmoney": execPlan.paidVmoney,
                    },
                    "draw": rewardResult.draw,
                    "character_list": characterList,
                    "item_list": Object.assign(Object.assign({}, items), rewardResult.items),
                    "gacha_campaign_list": gachaCampaigns,
                    "gacha_info_list": [{
                            "gacha_id": gachaId,
                            "is_account_first": false,
                            "is_daily_first": false,
                            "gacha_exchange_point": newGachaExchangePoint,
                        }],
                    "encyclopedia_info": [],
                    "mail_arrived": false,
                };
                (0, settlement_performance_1.measureSettlementPhase)("gacha", "degree", () => (0, mission_1.settleDegreeMissionResponse)(playerId, viewerId, responseData, undefined, [4]));
            }
            else {
                responseData = {
                    "user_info": {
                        "free_vmoney": execPlan.freeVmoney,
                        "vmoney": execPlan.paidVmoney,
                    },
                    "is_erupt": (_b = rewardResult.isErupt) !== null && _b !== void 0 ? _b : false,
                    "draw_equipment": rewardResult.draw,
                    "item_list": Object.assign(Object.assign({}, items), rewardResult.items),
                    "equipment_list": rewardResult.equipment,
                    "gacha_info_list": [{
                            "gacha_id": gachaId,
                            "is_account_first": false,
                            "is_daily_first": false,
                            "gacha_exchange_point": newGachaExchangePoint,
                        }],
                    "encyclopedia_info": [],
                    "mail_arrived": false,
                };
            }
            return {
                ok: true,
                responseData,
            };
        }, {
            afterCommit: result => {
                if (result.ok && plannedMoviesToCommit) {
                    (0, gacha_2.commitPlannedCharacterGachaMovies)(plannedMoviesToCommit);
                }
            },
        }));
        if (!transactionResult.ok) {
            (0, game_logging_1.gameVerboseLog)(() => `[GACHA] exec plan rejected: gachaId=${gachaId} paymentType=${paymentType} type=${type} message=${transactionResult.message}`);
            return reply.status(400).send({
                "error": "Bad Request",
                "message": transactionResult.message,
            });
        }
        (0, settlement_performance_1.recordGachaRequest)(isCharacterGacha ? "character" : "equipment", pullCount);
        const rarityCounts = new Map();
        for (const draw of drawMetadata) {
            rarityCounts.set(draw.rank, ((_d = rarityCounts.get(draw.rank)) !== null && _d !== void 0 ? _d : 0) + 1);
        }
        const raritySummary = Array.from(rarityCounts.entries())
            .sort(([left], [right]) => left - right)
            .map(([rank, count]) => `${rank}:${count}`)
            .join(",");
        (0, game_logging_1.gameVerboseLog)(() => `[GACHA] gacha=${gachaId} type=${isCharacterGacha ? "character" : "equipment"} `
            + `pulls=${pullCount} rarity=${raritySummary}`);
        reply.header("content-type", "application/x-msgpack");
        return reply.status(200).send({
            "data_headers": (0, utils_1.generateDataHeaders)({ viewer_id: viewerId }),
            "data": transactionResult.responseData,
        });
    }));
});
exports.default = routes;
