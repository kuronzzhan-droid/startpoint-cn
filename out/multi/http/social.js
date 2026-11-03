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
exports.registerSocialRoutes = void 0;
const utils_1 = require("../../utils");
const default_runtime_1 = require("../coordinator/default-runtime");
const player_context_1 = require("../player-context");
const follow_1 = require("../../data/domains/follow");
const character_1 = require("../../data/domains/character");
const player_1 = require("../../data/domains/player");
const stamina_1 = require("../../lib/stamina");
function registerSocialRoutes(fastify) {
    fastify.post("/verify_access_token", (request, reply) => __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c;
        const body = request.body;
        const ctx = yield (0, player_context_1.resolveMultiPlayerContext)(Number(body.viewer_id));
        if (!ctx)
            return reply.status(400).send({
                "error": "Bad Request", "message": "Invalid viewer id or no player bound."
            });
        const room = yield (0, default_runtime_1.getRoomCommandGateway)().execute("room.query", {
            accessToken: body.access_token || "",
        });
        if (!room) {
            reply.header("content-type", "application/x-msgpack");
            return reply.status(200).send({
                "data_headers": (0, utils_1.generateDataHeaders)({ viewer_id: body.viewer_id }),
                "data": { "room_exists": false }
            });
        }
        const host = (0, player_1.getPlayerSync)(room.host_player_id);
        const hostCharacter = (0, character_1.getPlayerCharacterSync)(room.host_player_id, room.host_main_character_id);
        reply.header("content-type", "application/x-msgpack");
        return reply.status(200).send({
            "data_headers": (0, utils_1.generateDataHeaders)({ viewer_id: body.viewer_id }),
            "data": {
                room_exists: true,
                category_id: room.category,
                establisher: room.host_viewer_id,
                establisher_character: room.host_main_character_id,
                establisher_character_evolution_img_level: (_a = hostCharacter === null || hostCharacter === void 0 ? void 0 : hostCharacter.evolutionLevel) !== null && _a !== void 0 ? _a : 0,
                establisher_follow: (0, follow_1.getFollowRelationSync)(ctx.playerId, room.host_player_id).state,
                establisher_name: (_b = host === null || host === void 0 ? void 0 : host.name) !== null && _b !== void 0 ? _b : `Player${room.host_viewer_id}`,
                establisher_rank: (0, stamina_1.getRankDegree)((_c = host === null || host === void 0 ? void 0 : host.rankPoint) !== null && _c !== void 0 ? _c : 0),
                host_entry_time: room.host_entry_time,
                quest_id: room.quest_id,
                room_number: room.room_number,
            }
        });
    }));
    fastify.post("/micro_community", (request, reply) => __awaiter(this, void 0, void 0, function* () {
        const body = request.body;
        reply.header("content-type", "application/x-msgpack");
        return reply.status(200).send({
            "data_headers": (0, utils_1.generateDataHeaders)({ viewer_id: body.viewer_id }),
            "data": {}
        });
    }));
    fastify.post("/publish_room", (request, reply) => __awaiter(this, void 0, void 0, function* () {
        const body = request.body;
        reply.header("content-type", "application/x-msgpack");
        return reply.status(200).send({
            "data_headers": (0, utils_1.generateDataHeaders)({ viewer_id: body.viewer_id }),
            "data": { success: false }
        });
    }));
}
exports.registerSocialRoutes = registerSocialRoutes;
