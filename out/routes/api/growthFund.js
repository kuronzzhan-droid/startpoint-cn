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
const player_1 = require("../../data/domains/player");
const session_1 = require("../../data/domains/session");
const grants_1 = require("../../lib/mission/grants");
const growth_fund_1 = require("../../lib/growth-fund");
const persistence_coordinator_1 = require("../../lib/persistence-coordinator");
const utils_1 = require("../../utils");
function growthFundRoutes(fastify) {
    return __awaiter(this, void 0, void 0, function* () {
        fastify.post("/receive_fund_bonus", { bodyLimit: 8192 }, (request, reply) => __awaiter(this, void 0, void 0, function* () {
            const body = request.body;
            const bad = (message) => reply.status(400).send({ error: "Bad Request", message });
            if (typeof body !== "object" || body === null || Array.isArray(body))
                return bad("Invalid request body.");
            const viewerId = body.viewer_id;
            const bonusIds = body.bonus_ids;
            if (!Number.isSafeInteger(viewerId) || !Array.isArray(bonusIds) || bonusIds.length === 0 || bonusIds.length > 100
                || !bonusIds.every(id => Number.isSafeInteger(id)))
                return bad("Invalid request body.");
            const session = yield (0, session_1.getSession)(String(viewerId));
            const playerId = session ? (0, activeAccount_1.resolvePlayerIdSync)(session.accountId) : null;
            if (playerId === null || playerId === undefined)
                return bad("Invalid viewer id.");
            const result = yield (0, persistence_coordinator_1.runPersistenceTransaction)({
                domain: "event", playerId, operation: "receive_growth_fund",
            }, () => {
                const player = (0, player_1.getPlayerSync)(playerId);
                if (!player)
                    throw new Error(`Player ${playerId} not found during growth fund settlement.`);
                const plan = (0, growth_fund_1.receiveGrowthFundBonusesSync)(playerId, player, bonusIds);
                if (!plan.ok)
                    return { ok: false, message: plan.message };
                const granter = new grants_1.MissionRewardGranter(playerId, player);
                granter.grant(plan.rewards);
                granter.persistPlayer();
                return { ok: true, granter, receiveList: plan.receiveList };
            });
            if (!result.ok)
                return bad(result.message);
            const granter = result.granter;
            reply.header("content-type", "application/x-msgpack");
            return reply.send({
                data_headers: (0, utils_1.generateDataHeaders)({ viewer_id: viewerId }),
                data: Object.assign({ fund_receive_list: result.receiveList, item_list: granter.itemList }, (granter.hasPlayerChanges() ? { user_info: granter.getUserInfo() } : {}), { mail_arrived: (0, mail_1.getPlayerMailCountSync)(playerId, true) > 0 }),
            });
        }));
    });
}
exports.default = growthFundRoutes;
