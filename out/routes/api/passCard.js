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
const activeAccount_1 = require("../../data/activeAccount");
const mail_1 = require("../../data/domains/mail");
const pass_card_1 = require("../../data/domains/pass-card");
const player_1 = require("../../data/domains/player");
const session_1 = require("../../data/domains/session");
const grants_1 = require("../../lib/mission/grants");
const pass_card_2 = require("../../lib/pass-card");
const utils_1 = require("../../utils");
const persistence_coordinator_1 = require("../../lib/persistence-coordinator");
function isPassCardBody(body) {
    return typeof body === "object" && body !== null && !Array.isArray(body);
}
function resolvePlayerId(body, reply) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!Number.isSafeInteger(body.viewer_id) || !Number.isSafeInteger(body.pass_card_id)) {
            reply.status(400).send({ error: "Bad Request", message: "Invalid request body." });
            return undefined;
        }
        const session = yield (0, session_1.getSession)(String(body.viewer_id));
        const playerId = session ? (0, activeAccount_1.resolvePlayerIdSync)(session.accountId) : null;
        if (playerId === null || playerId === undefined) {
            reply.status(400).send({ error: "Bad Request", message: "Invalid viewer id." });
            return undefined;
        }
        return playerId;
    });
}
function responseRecords(playerId, eventId) {
    return (0, pass_card_1.getPlayerPassCardRewardRecordsSync)(playerId, eventId).map(record => ({
        reward_id: record.rewardId,
        is_received_1: record.isReceived1,
        is_received_2: record.isReceived2,
    }));
}
function collectRequestedTracks(body) {
    var _a, _b, _c;
    const result = new Map();
    const add = (values, receive1, receive2) => {
        var _a;
        if (!Array.isArray(values))
            return false;
        for (const rewardId of values) {
            if (!Number.isSafeInteger(rewardId))
                return false;
            const tracks = (_a = result.get(rewardId)) !== null && _a !== void 0 ? _a : { receive1: false, receive2: false };
            tracks.receive1 || (tracks.receive1 = receive1);
            tracks.receive2 || (tracks.receive2 = receive2);
            result.set(rewardId, tracks);
        }
        return true;
    };
    if (!add((_a = body.all_receive) !== null && _a !== void 0 ? _a : [], true, true)
        || !add((_b = body.reward1_receive) !== null && _b !== void 0 ? _b : [], true, false)
        || !add((_c = body.reward2_receive) !== null && _c !== void 0 ? _c : [], false, true))
        return undefined;
    return result;
}
function passCardRoutes(fastify) {
    return __awaiter(this, void 0, void 0, function* () {
        fastify.post("/get_pass_card", (request, reply) => __awaiter(this, void 0, void 0, function* () {
            const body = request.body;
            if (!isPassCardBody(body)) {
                return reply.status(400).send({ error: "Bad Request", message: "Invalid request body." });
            }
            const playerId = yield resolvePlayerId(body, reply);
            if (playerId === undefined)
                return reply;
            const event = (0, pass_card_2.getPassCardEventDefinition)(body.pass_card_id);
            if (!event || !(0, pass_card_2.isPassCardEventActiveAt)(event, new Date((0, utils_1.getServerTime)() * 1000))) {
                return reply.status(400).send({ error: "Bad Request", message: "Unknown pass card." });
            }
            const state = (0, pass_card_1.getPlayerPassCardStateSync)(playerId, body.pass_card_id);
            reply.header("content-type", "application/x-msgpack");
            return reply.send({
                data_headers: (0, utils_1.generateDataHeaders)({ viewer_id: body.viewer_id }),
                data: {
                    point: state.point,
                    is_buy: state.isBuy,
                    all_received_record: responseRecords(playerId, body.pass_card_id),
                },
            });
        }));
        fastify.post("/receive_all", (request, reply) => __awaiter(this, void 0, void 0, function* () {
            const body = request.body;
            if (!isPassCardBody(body)) {
                return reply.status(400).send({ error: "Bad Request", message: "Invalid request body." });
            }
            const playerId = yield resolvePlayerId(body, reply);
            if (playerId === undefined)
                return reply;
            const event = (0, pass_card_2.getPassCardEventDefinition)(body.pass_card_id);
            const requested = collectRequestedTracks(body);
            if (!event
                || !(0, pass_card_2.isPassCardEventActiveAt)(event, new Date((0, utils_1.getServerTime)() * 1000))
                || !requested) {
                return reply.status(400).send({ error: "Bad Request", message: "Invalid pass reward request." });
            }
            const result = yield (0, persistence_coordinator_1.runPersistenceTransaction)({
                domain: "event", playerId, operation: "receive_pass_card",
            }, () => {
                const event = (0, pass_card_2.getPassCardEventDefinition)(body.pass_card_id);
                if (!event || !(0, pass_card_2.isPassCardEventActiveAt)(event, (0, utils_1.getServerDate)())) {
                    return { ok: false, message: "Invalid pass reward request." };
                }
                const state = (0, pass_card_1.getPlayerPassCardStateSync)(playerId, body.pass_card_id);
                const currentLevel = Math.floor(state.point / event.levelThreshold);
                const definitions = new Map();
                for (const [rewardId, tracks] of requested) {
                    const definition = (0, pass_card_2.getPassCardRewardDefinition)(rewardId);
                    if (!definition
                        || definition.eventId !== body.pass_card_id
                        || definition.level > currentLevel
                        || (tracks.receive2 && !state.isBuy)) {
                        return { ok: false, message: "Pass reward is not available." };
                    }
                    definitions.set(rewardId, definition);
                }
                const player = (0, player_1.getPlayerSync)(playerId);
                if (!player)
                    throw new Error(`Player ${playerId} not found during pass reward settlement.`);
                const granter = new grants_1.MissionRewardGranter(playerId, player);
                const received = new Map((0, pass_card_1.getPlayerPassCardRewardRecordsSync)(playerId, body.pass_card_id)
                    .map(record => [record.rewardId, record]));
                for (const [rewardId, tracks] of requested) {
                    const definition = definitions.get(rewardId);
                    const current = received.get(rewardId);
                    const grant1 = tracks.receive1 && (current === null || current === void 0 ? void 0 : current.isReceived1) !== 1;
                    const grant2 = tracks.receive2 && (current === null || current === void 0 ? void 0 : current.isReceived2) !== 1;
                    if (grant1)
                        granter.grant([definition.reward1]);
                    if (grant2)
                        granter.grant([definition.reward2]);
                    if (grant1 || grant2) {
                        (0, pass_card_1.setPlayerPassCardRewardReceivedSync)(playerId, body.pass_card_id, rewardId, grant1, grant2);
                    }
                }
                granter.persistPlayer();
                return { ok: true, granter };
            });
            if (!result.ok)
                return reply.status(400).send({ error: "Bad Request", message: result.message });
            const granter = result.granter;
            reply.header("content-type", "application/x-msgpack");
            return reply.send({
                data_headers: (0, utils_1.generateDataHeaders)({ viewer_id: body.viewer_id }),
                data: Object.assign(Object.assign({ all_received_record: responseRecords(playerId, body.pass_card_id), item_list: granter.itemList, character_list: granter.characterList, equipment_list: granter.equipmentList, degree_list: granter.degreeList.map(degreeId => ({
                        viewer_id: body.viewer_id,
                        degree_id: degreeId,
                    })) }, (granter.hasPlayerChanges() ? { user_info: granter.getUserInfo() } : {})), { mail_arrived: (0, mail_1.getPlayerMailCountSync)(playerId, true) > 0 }),
            });
        }));
    });
}
exports.default = passCardRoutes;
