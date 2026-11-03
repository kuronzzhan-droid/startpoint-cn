"use strict";
// Handles the insertion of mana into characters.
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
const player_1 = require("../../data/domains/player");
const session_1 = require("../../data/domains/session");
const party_1 = require("../../data/domains/party");
const activeAccount_1 = require("../../data/activeAccount");
const persistence_coordinator_1 = require("../../lib/persistence-coordinator");
const utils_1 = require("../../utils");
const special_event_parties_1 = require("../../lib/special-event-parties");
const routes = (fastify) => __awaiter(void 0, void 0, void 0, function* () {
    fastify.post("/edit", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        const body = request.body;
        const viewerId = body.viewer_id;
        if (!viewerId || isNaN(viewerId))
            return reply.status(400).send({
                "error": "Bad Request",
                "message": "Invalid request body."
            });
        if (!Array.isArray(body.party_group_edit_params_list)
            || body.party_group_edit_params_list.some(params => !(0, special_event_parties_1.hasValidPartyCategory)(params))) {
            return reply.status(400).send({
                "error": "Bad Request",
                "message": "Invalid party category."
            });
        }
        const viewerIdSession = yield (0, session_1.getSession)(viewerId.toString());
        if (!viewerIdSession)
            return reply.status(400).send({
                "error": "Bad Request",
                "message": "Invalid viewer id."
            });
        // get player
        const playerId = (0, activeAccount_1.resolvePlayerIdSync)(viewerIdSession.accountId);
        const player = playerId !== null ? (0, player_1.getPlayerSync)(playerId) : null;
        if (player === null)
            return reply.status(500).send({
                "error": "Internal Server Error",
                "message": "No players bound to account."
            });
        // update party groups as one player-owned persistence operation
        yield (0, persistence_coordinator_1.runPersistenceTransaction)({
            domain: "player", playerId, operation: "party_group_edit",
        }, () => {
            for (const editParamsList of body.party_group_edit_params_list) {
                (0, party_1.updatePlayerPartyGroupSync)(playerId, editParamsList.party_group_id, editParamsList.party_group_color_id, editParamsList.party_category);
            }
        });
        reply.header("content-type", "application/x-msgpack");
        return reply.status(200).send({
            "data_headers": (0, utils_1.generateDataHeaders)({
                viewer_id: viewerId
            }),
            "data": {}
        });
    }));
});
exports.default = routes;
