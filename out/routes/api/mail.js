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
exports.claimPlayerMailRewards = void 0;
const mail_1 = require("../../data/domains/mail");
const character_1 = require("../../data/domains/character");
const item_1 = require("../../data/domains/item");
const player_1 = require("../../data/domains/player");
const session_1 = require("../../data/domains/session");
const activeAccount_1 = require("../../data/activeAccount");
const utils_1 = require("../../utils");
const utils_2 = require("../../data/utils");
const equipment_1 = require("../../lib/equipment");
const client_display_time_1 = require("../../lib/client-display-time");
const degree_1 = require("../../data/domains/degree");
const mission_1 = require("../../lib/mission");
const mana_1 = require("../../lib/mana");
const persistence_coordinator_1 = require("../../lib/persistence-coordinator");
const node_crypto_1 = require("node:crypto");
const player_operation_receipt_1 = require("../../data/domains/player-operation-receipt");
const MAX_MAIL_CLAIM_IDS = 1000;
function buildMailClaimRequestKey(mailIds, requestId) {
    if (typeof requestId !== "string" || requestId.length === 0 || requestId.length > 256)
        return null;
    const normalized = [...new Set(mailIds.filter(mailId => Number.isSafeInteger(mailId) && mailId > 0))].sort((left, right) => left - right);
    if (normalized.length === 0)
        return null;
    return (0, node_crypto_1.createHash)("sha256").update(`${requestId}\u0000${normalized.join(",")}`).digest("hex");
}
function formatMailResponse(mail) {
    return {
        id: mail.id,
        reason_id: mail.reason_id,
        subject: mail.subject,
        description: mail.description,
        type: mail.type,
        type_id: mail.type_id != null && mail.type_id > 2147483647 ? 0 : mail.type_id,
        number: mail.number,
        receive_time: (0, client_display_time_1.serializeRealTimeForVirtualClient)(mail.receive_time),
        create_time: (0, client_display_time_1.serializeRealTimeForVirtualClient)(mail.create_time),
        reward_period_limited: mail.reward_period_limited === 1,
        reward_limit_time: (0, client_display_time_1.serializeRealTimeForVirtualClient)(mail.reward_limit_time),
    };
}
function applyMailReward(playerId, player, mail) {
    var _a, _b, _c;
    const characterList = [];
    const equipmentList = [];
    const itemList = {};
    const userInfo = {};
    const degreeIds = [];
    switch (mail.type) {
        case mail_1.MailType.ITEM: {
            if (mail.type_id === null)
                break;
            const newAmount = (0, item_1.givePlayerItemSync)(playerId, mail.type_id, mail.number);
            itemList[String(mail.type_id)] = newAmount;
            break;
        }
        case mail_1.MailType.PAID_VMONEY: {
            const newVmoney = player.vmoney + mail.number;
            (0, player_1.updatePlayerSync)({ id: playerId, vmoney: newVmoney });
            player.vmoney = newVmoney;
            userInfo['vmoney'] = newVmoney;
            break;
        }
        case mail_1.MailType.FREE_VMONEY: {
            const newFreeVmoney = player.freeVmoney + mail.number;
            (0, player_1.updatePlayerSync)({ id: playerId, freeVmoney: newFreeVmoney });
            player.freeVmoney = newFreeVmoney;
            userInfo['free_vmoney'] = newFreeVmoney;
            break;
        }
        case mail_1.MailType.CHARACTER: {
            if (mail.type_id === null)
                break;
            const existing = (0, character_1.getPlayerCharacterSync)(playerId, mail.type_id);
            if (existing) {
                (0, character_1.updatePlayerCharacterSync)(playerId, mail.type_id, {
                    entryCount: existing.entryCount + 1
                });
            }
            else {
                (0, character_1.insertDefaultPlayerCharacterSync)(playerId, mail.type_id);
            }
            const charData = (0, character_1.getPlayerCharacterSync)(playerId, mail.type_id);
            characterList.push({
                character_id: mail.type_id,
                entry_count: charData.entryCount,
                evolution_level: charData.evolutionLevel,
                over_limit_step: charData.overLimitStep,
                protection: charData.protection,
                exp: charData.exp,
                stack: charData.stack,
                bond_token_list: (_b = (_a = charData.bondTokenList) === null || _a === void 0 ? void 0 : _a.map(bt => ({
                    mana_board_index: bt.manaBoardIndex,
                    status: bt.status
                }))) !== null && _b !== void 0 ? _b : [],
                join_time: (0, utils_2.clientSerializeDate)(charData.joinTime),
                update_time: (0, utils_2.clientSerializeDate)(charData.updateTime)
            });
            break;
        }
        case mail_1.MailType.EQUIPMENT: {
            if (mail.type_id === null)
                break;
            const result = (0, equipment_1.givePlayerEquipmentSync)(playerId, mail.type_id, mail.number);
            equipmentList.push(result);
            break;
        }
        case mail_1.MailType.STAR_CRUMB: {
            const newCrumb = player.starCrumb + mail.number;
            (0, player_1.updatePlayerSync)({ id: playerId, starCrumb: newCrumb });
            player.starCrumb = newCrumb;
            userInfo['star_crumb'] = newCrumb;
            break;
        }
        case mail_1.MailType.FREE_MANA: {
            const manaGrant = (0, mana_1.calculateFreeManaGrant)(player, mail.number);
            const totalManaObtained = ((_c = player.totalManaObtained) !== null && _c !== void 0 ? _c : 0) + mail.number;
            (0, player_1.updatePlayerSync)({ id: playerId, freeMana: manaGrant.freeMana, totalManaObtained });
            player.freeMana = manaGrant.freeMana;
            player.totalManaObtained = totalManaObtained;
            userInfo['free_mana'] = manaGrant.freeMana;
            break;
        }
        case mail_1.MailType.EXP_POOL: {
            const newExp = (0, player_1.adjustPlayerExpPoolSync)(playerId, mail.number, 'mail_reward');
            if (newExp === null)
                throw new Error(`Failed to grant EXP mail ${mail.id} to player ${playerId}`);
            player.expPool = newExp;
            userInfo['exp_pool'] = newExp;
            break;
        }
        case mail_1.MailType.BOND_TOKEN: {
            const newBond = player.bondToken + mail.number;
            (0, player_1.updatePlayerSync)({ id: playerId, bondToken: newBond });
            player.bondToken = newBond;
            userInfo['bond_token'] = newBond;
            break;
        }
        case mail_1.MailType.BOSS_BOOST_POINT: {
            const newBoss = player.bossBoostPoint + mail.number;
            (0, player_1.updatePlayerSync)({ id: playerId, bossBoostPoint: newBoss });
            player.bossBoostPoint = newBoss;
            userInfo['boss_boost_point'] = newBoss;
            break;
        }
        case mail_1.MailType.BOOST_POINT: {
            const newBoost = player.boostPoint + mail.number;
            (0, player_1.updatePlayerSync)({ id: playerId, boostPoint: newBoost });
            player.boostPoint = newBoost;
            userInfo['boost_point'] = newBoost;
            break;
        }
        case mail_1.MailType.DEGREE: {
            if (mail.type_id === null)
                break;
            if ((0, degree_1.grantPlayerDegreeSync)(playerId, mail.type_id)) {
                degreeIds.push(mail.type_id);
            }
            break;
        }
        case mail_1.MailType.RANK_POINT: {
            const newRank = player.rankPoint + mail.number;
            (0, player_1.updatePlayerSync)({ id: playerId, rankPoint: newRank });
            player.rankPoint = newRank;
            userInfo['rank_point'] = newRank;
            break;
        }
    }
    (0, mail_1.insertReceiveHistorySync)(playerId, { type: mail.type, type_id: mail.type_id, number: mail.number });
    return { characterList, equipmentList, itemList, userInfo, degreeIds };
}
/**
 * Claims the exact requested mails and applies all rewards in one short write transaction.
 * The per-player queue prevents duplicate grants between concurrent requests in this process;
 * BEGIN IMMEDIATE also protects the read/mark/reward sequence from other writers.
 */
function claimPlayerMailRewards(playerId, requestedMailIds, requestId) {
    return __awaiter(this, void 0, void 0, function* () {
        if (requestedMailIds.length > MAX_MAIL_CLAIM_IDS) {
            throw new RangeError(`A mail claim may contain at most ${MAX_MAIL_CLAIM_IDS} IDs.`);
        }
        const requestKey = buildMailClaimRequestKey(requestedMailIds, requestId);
        return (0, persistence_coordinator_1.runPersistenceTransaction)({
            domain: "mail", playerId, operation: "claim_rewards",
        }, () => {
            if (requestKey) {
                const previous = (0, player_operation_receipt_1.getPlayerOperationReceiptSync)(playerId, "mail_claim", requestKey);
                if (previous)
                    return previous.response;
            }
            const uniqueMailIds = [...new Set(requestedMailIds.filter(mailId => Number.isSafeInteger(mailId) && mailId > 0))];
            const mails = (0, mail_1.getUnreceivedPlayerMailsByIdsSync)(playerId, uniqueMailIds);
            const mailById = new Map(mails.map(mail => [mail.id, mail]));
            const player = (0, player_1.getPlayerSync)(playerId);
            if (!player)
                throw new Error(`Player ${playerId} does not exist.`);
            // Mark first inside the transaction. Any reward failure rolls this update back.
            const claimedMailIds = (0, mail_1.receiveAllMailsSync)(playerId, uniqueMailIds.filter(mailId => mailById.has(mailId)));
            const characterList = [];
            const equipmentList = [];
            const itemList = {};
            const userInfo = {};
            const degreeIds = new Set();
            for (const mailId of claimedMailIds) {
                const mail = mailById.get(mailId);
                if (!mail)
                    continue;
                const reward = applyMailReward(playerId, player, mail);
                characterList.push(...reward.characterList);
                equipmentList.push(...reward.equipmentList);
                Object.assign(itemList, reward.itemList);
                Object.assign(userInfo, reward.userInfo);
                for (const degreeId of reward.degreeIds)
                    degreeIds.add(degreeId);
            }
            const result = {
                claimedMailIds,
                alreadyCount: requestedMailIds.length - claimedMailIds.length,
                characterList,
                equipmentList,
                itemList,
                userInfo,
                degreeIds: [...degreeIds],
            };
            if (requestKey)
                (0, player_operation_receipt_1.insertPlayerOperationReceiptSync)({
                    playerId,
                    operation: "mail_claim",
                    requestKey,
                    response: result,
                });
            return result;
        });
    });
}
exports.claimPlayerMailRewards = claimPlayerMailRewards;
const routes = (fastify) => __awaiter(void 0, void 0, void 0, function* () {
    fastify.post("/index", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        const body = request.body;
        const viewerId = body.viewer_id;
        if (!viewerId || isNaN(viewerId))
            return reply.status(400).send({
                error: "Bad Request",
                message: "Invalid viewer_id"
            });
        const session = yield (0, session_1.getSession)(viewerId.toString());
        if (!session)
            return reply.status(400).send({
                error: "Bad Request",
                message: "Invalid viewer_id"
            });
        const playerId = (0, activeAccount_1.resolvePlayerIdSync)(session.accountId);
        if (playerId === null)
            return reply.status(400).send({
                error: "Bad Request",
                message: "No player bound to account"
            });
        const page = body.current_page || 1;
        const mails = (0, mail_1.getPlayerMailsSync)(playerId, page, 100);
        const totalCount = (0, mail_1.getPlayerMailCountSync)(playerId);
        reply.header("content-type", "application/x-msgpack");
        return reply.status(200).send({
            data_headers: (0, utils_1.generateDataHeaders)({ viewer_id: viewerId }),
            data: {
                mail: mails.map(formatMailResponse),
                total_count: totalCount,
            }
        });
    }));
    fastify.post("/receive", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        const body = request.body;
        const viewerId = body.viewer_id;
        const mailId = body.mail_id;
        if (!viewerId || isNaN(viewerId) || !mailId || isNaN(mailId))
            return reply.status(400).send({
                error: "Bad Request",
                message: "Invalid request body"
            });
        const session = yield (0, session_1.getSession)(viewerId.toString());
        if (!session)
            return reply.status(400).send({
                error: "Bad Request",
                message: "Invalid viewer_id"
            });
        const playerId = (0, activeAccount_1.resolvePlayerIdSync)(session.accountId);
        if (playerId === null)
            return reply.status(400).send({
                error: "Bad Request",
                message: "No player bound to account"
            });
        const claim = yield claimPlayerMailRewards(playerId, [mailId], body.request_id);
        if (claim.claimedMailIds.length === 0)
            return reply.status(400).send({
                error: "Bad Request",
                message: "Mail not found or already received"
            });
        const { characterList, equipmentList, itemList, userInfo, degreeIds } = claim;
        const reconciledCharacterList = (0, mission_1.reconcileAwakeUnlockCharacterList)(playerId, characterList);
        const totalCount = (0, mail_1.getPlayerMailCountSync)(playerId);
        const responseData = {
            auto_sale_expired_mail: false,
            dispose_expired_mail: false,
            total_count: totalCount,
            mail_arrived: (0, mail_1.getPlayerMailCountSync)(playerId, true) > 0,
        };
        if (reconciledCharacterList.length > 0)
            responseData.character_list = reconciledCharacterList;
        if (equipmentList.length > 0)
            responseData.equipment_list = equipmentList;
        if (Object.keys(itemList).length > 0)
            responseData.item_list = itemList;
        if (Object.keys(userInfo).length > 0)
            responseData.user_info = userInfo;
        if (degreeIds.length > 0) {
            responseData.degree_list = degreeIds.map(degreeId => ({
                viewer_id: viewerId,
                degree_id: degreeId,
            }));
        }
        reply.header("content-type", "application/x-msgpack");
        return reply.status(200).send({
            data_headers: (0, utils_1.generateDataHeaders)({ viewer_id: viewerId }),
            data: responseData
        });
    }));
    fastify.post("/receive_all", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        const body = request.body;
        const viewerId = body.viewer_id;
        const mailIds = body.mail_ids;
        if (!viewerId || isNaN(viewerId) || !mailIds || !Array.isArray(mailIds) || mailIds.length > MAX_MAIL_CLAIM_IDS)
            return reply.status(400).send({
                error: "Bad Request",
                message: "Invalid request body"
            });
        const session = yield (0, session_1.getSession)(viewerId.toString());
        if (!session)
            return reply.status(400).send({
                error: "Bad Request",
                message: "Invalid viewer_id"
            });
        const playerId = (0, activeAccount_1.resolvePlayerIdSync)(session.accountId);
        if (playerId === null)
            return reply.status(400).send({
                error: "Bad Request",
                message: "No player bound to account"
            });
        const claim = yield claimPlayerMailRewards(playerId, mailIds, body.request_id);
        const { alreadyCount, characterList, equipmentList, itemList, userInfo, degreeIds, claimedMailIds: claimed, } = claim;
        const reconciledCharacterList = (0, mission_1.reconcileAwakeUnlockCharacterList)(playerId, characterList);
        const responseData = {
            already_mail_count: alreadyCount,
            auto_sale_expired_mail_count: 0,
            deleted_mail_count: 0,
            dispose_expired_mail_count: 0,
            ex_boost_item_list: [],
            mail_ids: claimed,
            max_overed_mail_count: 0,
            outdated_mail_count: 0,
            total_count: (0, mail_1.getPlayerMailCountSync)(playerId),
            mail_arrived: (0, mail_1.getPlayerMailCountSync)(playerId, true) > 0,
        };
        if (reconciledCharacterList.length > 0)
            responseData.character_list = reconciledCharacterList;
        if (equipmentList.length > 0)
            responseData.equipment_list = equipmentList;
        if (Object.keys(itemList).length > 0)
            responseData.item_list = itemList;
        if (Object.keys(userInfo).length > 0)
            responseData.user_info = userInfo;
        if (degreeIds.length > 0) {
            responseData.degree_list = degreeIds.map(degreeId => ({
                viewer_id: viewerId,
                degree_id: degreeId,
            }));
        }
        reply.header("content-type", "application/x-msgpack");
        return reply.status(200).send({
            data_headers: (0, utils_1.generateDataHeaders)({ viewer_id: viewerId }),
            data: responseData
        });
    }));
});
exports.default = routes;
