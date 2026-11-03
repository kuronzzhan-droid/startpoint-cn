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
const player_1 = require("../../data/domains/player");
const character_1 = require("../../data/domains/character");
const follow_1 = require("../../data/domains/follow");
const utils_1 = require("../../utils");
const attention_rank_1 = require("../../lib/attention-rank");
const profileFavorite_1 = require("../../lib/profileFavorite");
const game_logging_1 = require("../../lib/game-logging");
const newbie_1 = require("../../lib/newbie");
const player_context_1 = require("../../multi/player-context");
const attention_config_1 = require("../../multi/attention-config");
const mode15_room_gate_1 = require("../../multi/mode15-room-gate");
const guest_eligibility_1 = require("../../multi/guest-eligibility");
const default_runtime_1 = require("../../multi/coordinator/default-runtime");
const lobby_1 = require("../../multi/http/lobby");
const command_error_1 = require("../../multi/http/command-error");
const routes = (fastify) => __awaiter(void 0, void 0, void 0, function* () {
    (0, command_error_1.installRealtimeHttpFailureHandler)(fastify);
    fastify.post("/check", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        const body = request.body;
        const viewerId = body.viewer_id;
        if (!viewerId || isNaN(viewerId))
            return reply.status(400).send({
                "error": "Bad Request",
                "message": "Invalid request body."
            });
        const ctx = yield (0, player_context_1.resolveMultiPlayerContext)(viewerId);
        if (!ctx)
            return reply.status(400).send({
                "error": "Bad Request",
                "message": "Invalid viewer id or no player bound."
            });
        const { playerId, player } = ctx;
        const requested = Number.isFinite(body.request_number) ? body.request_number : 3;
        const holding = Number.isFinite(body.holding_number) ? body.holding_number : 0;
        const availableSlots = Math.max(0, Math.min(3, requested) - Math.max(0, holding));
        const guestEligibilityByQuest = new Map();
        const candidates = yield (0, lobby_1.fetchLobbyRoomProjections)(viewerId, undefined, undefined, true);
        const eligible = candidates.filter(room => {
            if (room.host_viewer_id === viewerId || room.is_npc_mode || (0, mode15_room_gate_1.isMode15RoomClosed)(room))
                return false;
            if (!room.hostOnline || room.occupancy >= 3 || room.waitingForExpectedMember || ["STARTING", "BATTLE"].includes(room.phase))
                return false;
            const key = `${room.category}:${room.quest_id}`;
            let allowed = guestEligibilityByQuest.get(key);
            if (allowed === undefined) {
                allowed = (0, guest_eligibility_1.canJoinMultiGuestQuestSync)(playerId, room.category, room.quest_id, player).allowed;
                guestEligibilityByQuest.set(key, allowed);
            }
            // Do not consume delivery quota for an absent host business record.
            return allowed && !!(0, player_1.getPlayerSync)(room.host_player_id);
        });
        const recruitments = yield (0, default_runtime_1.getRoomCommandGateway)().execute("lobby.attention.take", {
            viewerId, limit: availableSlots,
            eligible: eligible.map(room => ({ roomNumber: room.room_number, identity: room.identity })),
        });
        const multi = recruitments.flatMap(recruitment => {
            var _a, _b, _c, _d;
            const room = recruitment.room;
            const host = (0, player_1.getPlayerSync)(room.host_player_id);
            if (!host)
                return [];
            // Rescue cards must use the same avatar source as the public
            // profile. The legacy leaderCharacterId is still character 1
            // (Arcl) on many old saves, even after the player edits favorites.
            const favorite = (0, profileFavorite_1.getFavoritePartySelectionSync)(room.host_player_id, host.leaderCharacterId);
            const profileLeaderId = (_c = (_b = (_a = favorite.characterIds[0]) !== null && _a !== void 0 ? _a : room.host_main_character_id) !== null && _b !== void 0 ? _b : host.leaderCharacterId) !== null && _c !== void 0 ? _c : 1;
            const leader = (0, character_1.getPlayerCharacterSync)(room.host_player_id, profileLeaderId);
            const isNewbie = (0, newbie_1.isNewbiePlayerSync)(room.host_player_id, host);
            return [{
                    "attention_key": recruitment.attentionKey,
                    "quest_info": {
                        "category_id": room.category,
                        "establisher_character": profileLeaderId,
                        "establisher_character_evolution_img_level": (_d = leader === null || leader === void 0 ? void 0 : leader.evolutionLevel) !== null && _d !== void 0 ? _d : 0,
                        "establisher_follow": (0, follow_1.getFollowRelationSync)(playerId, room.host_player_id).state,
                        "establisher_rank": (0, attention_rank_1.resolveAttentionEstablisherRank)(host.rankPoint || 0),
                        "host_entry_time": room.host_entry_time,
                        "is_newbie": isNewbie,
                        "quest_id": room.quest_id,
                        "room_number": room.room_number,
                    }
                }];
        });
        if (multi.length > 0) {
            (0, game_logging_1.gameVerboseLog)(() => `[ATTENTION] check: viewer=${viewerId} delivered=${multi.length} rooms=${multi.map(item => item.quest_info.room_number).join(",")}`);
        }
        reply.header("content-type", "application/x-msgpack");
        return reply.status(200).send({
            "data_headers": (0, utils_1.generateDataHeaders)({
                viewer_id: viewerId
            }),
            "data": {
                "config": (0, attention_config_1.getAttentionConfig)(),
                "multi": multi.length > 0 ? multi : null,
            }
        });
    }));
    // ---- action (stub: NPC-only, no real matching) ----
    fastify.post("/action", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        const body = request.body;
        const viewerId = body.viewer_id;
        if (!(yield (0, player_context_1.resolveMultiPlayerContext)(viewerId))) {
            console.log(`[ATTENTION] action: 400 invalid viewer_id=${viewerId}`);
            return reply.status(400).send({
                "error": "Bad Request", "message": "Invalid request body."
            });
        }
        (0, game_logging_1.gameVerboseLog)(() => { var _a, _b; return `[ATTENTION] action: viewer=${viewerId} factors=${(_b = (_a = body.priority_factors) === null || _a === void 0 ? void 0 : _a.length) !== null && _b !== void 0 ? _b : 0}`; });
        (0, game_logging_1.gameVerboseLog)(() => `[ATTENTION] action: factors_detail=${JSON.stringify(body.priority_factors)}`);
        reply.header("content-type", "application/x-msgpack");
        return reply.status(200).send({
            "data_headers": (0, utils_1.generateDataHeaders)({ viewer_id: viewerId }),
            "data": {
                "priority_action_score": 0,
                "priority_playing_score": 0
            }
        });
    }));
    // ---- logger ----
    fastify.post("/logger", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        const body = request.body;
        const viewerId = body.viewer_id;
        if (!(yield (0, player_context_1.resolveMultiPlayerContext)(viewerId))) {
            console.log(`[ATTENTION] logger: 400 invalid viewer_id=${viewerId}`);
            return reply.status(400).send({
                "error": "Bad Request", "message": "Invalid request body."
            });
        }
        (0, game_logging_1.gameVerboseLog)(() => { var _a, _b; return `[ATTENTION] logger: viewer=${viewerId} logs=${(_b = (_a = body.client_logs) === null || _a === void 0 ? void 0 : _a.length) !== null && _b !== void 0 ? _b : 0}`; });
        reply.header("content-type", "application/x-msgpack");
        return reply.status(200).send({
            "data_headers": (0, utils_1.generateDataHeaders)({ viewer_id: viewerId }),
            "data": {}
        });
    }));
});
exports.default = routes;
