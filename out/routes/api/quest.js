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
const public_payload_1 = require("../../lib/weapon-riven/public-payload");
const activeAccount_1 = require("../../data/activeAccount");
const session_1 = require("../../data/domains/session");
const recommended_party_history_1 = require("../../lib/quest/recommended-party-history");
const utils_1 = require("../../utils");
const skipChapter_1 = require("./skipChapter");
/**
 * Returns up to ten distinct parties that actually cleared this quest. Frozen
 * clear snapshots are ordered only by the battle power used for that clear.
 * Without a matching snapshot, a player's current party is never substituted.
 */
const routes = (fastify) => __awaiter(void 0, void 0, void 0, function* () {
    fastify.register(skipChapter_1.default);
    fastify.post("/get_recent_other_player_party", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        const body = request.body;
        const viewerId = Number(body === null || body === void 0 ? void 0 : body.viewer_id);
        const category = Number(body === null || body === void 0 ? void 0 : body.category);
        const questId = Number(body === null || body === void 0 ? void 0 : body.quest_id);
        if (!Number.isFinite(viewerId) ||
            !Number.isFinite(category) ||
            !Number.isFinite(questId)) {
            return reply.status(400).send({
                error: "Bad Request",
                message: "Invalid request body.",
            });
        }
        const session = yield (0, session_1.getSession)(String(viewerId));
        if (!session) {
            return reply.status(400).send({
                error: "Bad Request",
                message: "Invalid viewer id.",
            });
        }
        const playerId = (0, activeAccount_1.resolvePlayerIdSync)(session.accountId);
        if (playerId === null) {
            return reply.status(400).send({
                error: "Bad Request",
                message: "No player bound to account.",
            });
        }
        const recommendations = (0, recommended_party_history_1.getRecommendedQuestPartiesSync)(playerId, category, questId);
        console.log(`[QUEST-RECOMMEND] player=${playerId} category=${category} ` +
            `quest=${questId} exact=${recommendations.exactCandidateCount} ` +
            `returned=${recommendations.parties.length}`);
        reply.header("content-type", "application/x-msgpack");
        return reply.status(200).send({
            data_headers: (0, utils_1.generateDataHeaders)({ viewer_id: viewerId }),
            data: {
                recent_other_player_party: (0, public_payload_1.stripWeaponRivenPublicPayload)(recommendations.parties),
            },
        });
    }));
});
exports.default = routes;
