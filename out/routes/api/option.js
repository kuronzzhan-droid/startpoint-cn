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
const session_1 = require("../../data/domains/session");
const option_1 = require("../../data/domains/option");
const activeAccount_1 = require("../../data/activeAccount");
const utils_1 = require("../../utils");
const solo_runtime_1 = require("../../multi/five-boss/solo-runtime");
const persistence_coordinator_1 = require("../../lib/persistence-coordinator");
const updateRoute = (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
    const body = request.body;
    const viewerId = body.viewer_id;
    if (!viewerId || isNaN(viewerId))
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
            "message": "No player bound to account."
        });
    // update options
    const updatedOptions = body.option_params;
    yield (0, persistence_coordinator_1.runPersistenceTransaction)({
        domain: "player", playerId, operation: "update_options",
    }, () => {
        (0, option_1.updatePlayerOptionsInTransactionSync)(playerId, updatedOptions);
        // Match the option store's boolean coercion for values received on the wire.
        if (updatedOptions.auto_play)
            (0, solo_runtime_1.markFiveBossSoloAutoUsedSync)(playerId);
    });
    reply.header("content-type", "application/x-msgpack");
    return reply.status(200).send({
        "data_headers": (0, utils_1.generateDataHeaders)({
            viewer_id: viewerId
        }),
        "data": {
            "user_option": updatedOptions
        }
    });
});
const routes = (fastify) => __awaiter(void 0, void 0, void 0, function* () {
    fastify.post("/update", updateRoute);
    fastify.post("/update_in_battle", updateRoute);
});
exports.default = routes;
