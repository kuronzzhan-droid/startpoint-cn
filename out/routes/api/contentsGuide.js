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
const player_1 = require("../../data/domains/player");
const session_1 = require("../../data/domains/session");
const content_snapshot_1 = require("../../content/runtime/content-snapshot");
const contents_guide_start_1 = require("../../lib/mission/contents-guide-start");
const utils_1 = require("../../utils");
const routes = (fastify_1, ...args_1) => __awaiter(void 0, [fastify_1, ...args_1], void 0, function* (fastify, options = {}) {
    fastify.post("/start", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        const body = request.body;
        const viewerId = body === null || body === void 0 ? void 0 : body.viewer_id;
        const eventId = body === null || body === void 0 ? void 0 : body.event_id;
        if (typeof viewerId !== "number" || !Number.isSafeInteger(viewerId) || viewerId <= 0
            || typeof eventId !== "number" || !Number.isSafeInteger(eventId) || eventId <= 0)
            return reply.status(400).send({
                "error": "Bad Request", "message": "Invalid request body."
            });
        const session = yield (0, session_1.getSession)(viewerId.toString());
        if (!session)
            return reply.status(400).send({
                "error": "Bad Request", "message": "Invalid viewer id."
            });
        const playerId = (0, activeAccount_1.resolvePlayerIdSync)(session.accountId);
        if (playerId === null || !(0, player_1.getPlayerSync)(playerId))
            return reply.status(400).send({
                "error": "Bad Request", "message": "Invalid player."
            });
        const snapshot = (0, content_snapshot_1.getContentSnapshot)();
        const result = ((_a = options.startMission) !== null && _a !== void 0 ? _a : contents_guide_start_1.startContentsGuideMission)({
            playerId,
            eventId,
            repository: snapshot.repository,
            now: (0, utils_1.getServerTime)() * 1000,
        });
        if (!result.ok)
            return reply.status(400).send({
                "error": "Bad Request", "message": result.message
            });
        reply.header("content-type", "application/x-msgpack");
        return reply.status(200).send({
            "data_headers": (0, utils_1.generateDataHeaders)({ viewer_id: viewerId }),
            "data": {
                "active_mission_list": result.delta === null ? [] : [result.delta]
            }
        });
    }));
});
exports.default = routes;
