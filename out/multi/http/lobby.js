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
exports.registerLobbyRoutes = exports.disbandIdleHostedLobbyRooms = exports.fetchLobbyRoomProjections = void 0;
const player_1 = require("../../data/domains/player");
const follow_1 = require("../../data/domains/follow");
const assets_1 = require("../../lib/assets");
const utils_1 = require("../../utils");
const profileFavorite_1 = require("../../lib/profileFavorite");
const serializer_1 = require("../room/serializer");
const sharing_1 = require("../room/sharing");
const newbie_1 = require("../../lib/newbie");
const mode15_optional_1 = require("../../lib/mode15-optional");
const mode15_room_gate_1 = require("../mode15-room-gate");
const select_denial_1 = require("../room/select-denial");
const player_context_1 = require("../player-context");
const party_snapshot_1 = require("../party-snapshot");
const guest_eligibility_1 = require("../guest-eligibility");
const default_runtime_1 = require("../coordinator/default-runtime");
const command_protocol_1 = require("../coordinator/command-protocol");
/** Bounded owner RPC pages; a fixed upper sequence avoids chasing new rooms forever. */
function fetchLobbyRoomProjections(viewerId_1, categories_1, eventId_1) {
    return __awaiter(this, arguments, void 0, function* (viewerId, categories, eventId, onlyRecruiting = false, accept = () => true) {
        const rooms = [];
        // Discovery views are capped at 256 rooms; attention examines at most 64
        // active recruitment candidates per poll. No mutation is silently dropped.
        const maximumRooms = onlyRecruiting ? 64 : 256;
        let afterSequence = 0, throughSequence, inspected = 0;
        do {
            const page = yield (0, default_runtime_1.getRoomCommandGateway)().execute("lobby.list", Object.assign(Object.assign(Object.assign({ viewerId, afterSequence, onlyRecruiting }, (categories ? { categories } : {})), (eventId === undefined ? {} : { eventId })), (throughSequence === undefined ? {} : { throughSequence })));
            inspected += page.rooms.length;
            rooms.push(...page.rooms.filter(accept));
            throughSequence = page.throughSequence;
            if (page.nextSequence === null || inspected >= maximumRooms)
                break;
            afterSequence = page.nextSequence;
        } while (true);
        return categories ? rooms.sort((a, b) => categories.indexOf(a.category) - categories.indexOf(b.category) || a.room_sequence - b.room_sequence) : rooms;
    });
}
exports.fetchLobbyRoomProjections = fetchLobbyRoomProjections;
function disbandIdleHostedLobbyRooms(hostViewerId) {
    return __awaiter(this, void 0, void 0, function* () {
        return yield (0, default_runtime_1.getRoomCommandGateway)().execute("lobby.cleanupHosted", { viewerId: hostViewerId });
    });
}
exports.disbandIdleHostedLobbyRooms = disbandIdleHostedLobbyRooms;
function query(viewerId, roomNumber, accessToken) {
    return (0, default_runtime_1.getRoomCommandGateway)().execute("lobby.query", { viewerId, roomNumber: roomNumber || "", accessToken: accessToken || "" });
}
function bad(reply) { return reply.status(400).send({ error: "Bad Request", message: "Invalid viewer id or no player bound." }); }
function send(reply, viewerId, data, resultCode) {
    reply.header("content-type", "application/x-msgpack");
    return reply.status(200).send({ data_headers: (0, utils_1.generateDataHeaders)(Object.assign({ viewer_id: viewerId }, (resultCode === undefined ? {} : { result_code: resultCode }))), data });
}
function registerLobbyRoutes(fastify) {
    fastify.post("/create_room_failure", (request, reply) => __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        const viewer = Number((_b = (_a = request.body) === null || _a === void 0 ? void 0 : _a.viewer_id) !== null && _b !== void 0 ? _b : 0);
        return send(reply, Number.isFinite(viewer) ? viewer : 0, {});
    }));
    fastify.post("/get_rooms", (request, reply) => __awaiter(this, void 0, void 0, function* () {
        const body = request.body;
        const ctx = body.viewer_id && !isNaN(body.viewer_id) ? yield (0, player_context_1.resolveMultiPlayerContext)(body.viewer_id) : null;
        if (!ctx)
            return bad(reply);
        const categories = body.category_id === 7 || body.category_id === 8 ? [7, 8] : [body.category_id];
        const projections = yield fetchLobbyRoomProjections(body.viewer_id, categories, body.event_id, false, room => room.host_viewer_id !== body.viewer_id && (0, sharing_1.isRoomSharedWithPlayer)(room, ctx.playerId)
            && !["STARTING", "BATTLE"].includes(room.phase) && !(0, mode15_room_gate_1.isMode15RoomClosed)(room)
            && room.hostOnline && room.occupancy < 3
            && (0, guest_eligibility_1.canJoinMultiGuestQuestSync)(ctx.playerId, room.category, room.quest_id, ctx.player).allowed);
        const rooms = projections.map(room => {
            const serialized = (0, serializer_1.serializeRoom)(room, ctx.playerId);
            if (!room.returningMember && room.acceptedSeatCount >= 3)
                serialized.raising_state = select_denial_1.SELECT_ROOM_FILLED_STATE;
            return serialized;
        });
        return send(reply, body.viewer_id, { rooms });
    }));
    fastify.post("/create_room", (request, reply) => __awaiter(this, void 0, void 0, function* () {
        var _c, _d;
        const body = request.body;
        const ctx = body.viewer_id && !isNaN(body.viewer_id) ? yield (0, player_context_1.resolveMultiPlayerContext)(body.viewer_id) : null;
        if (!ctx)
            return bad(reply);
        (0, player_context_1.cacheMultiPlayerContext)(body.viewer_id, ctx);
        (0, party_snapshot_1.primeRealPartySnapshot)(ctx.playerId);
        if (Number(body.category) === 20
            || !(0, assets_1.getQuestFromCategorySync)(body.category, body.quest_id)
            || ((0, mode15_optional_1.isMode15Quest)(body.category, body.quest_id) && !(0, mode15_optional_1.canStartMode15QuestSync)(ctx.playerId, body.category, body.quest_id).allowed)) {
            return send(reply, body.viewer_id, {}, 4507);
        }
        const favorite = (0, profileFavorite_1.getFavoritePartySelectionSync)(ctx.playerId, ctx.player.leaderCharacterId);
        const room = yield (0, default_runtime_1.getRoomCommandGateway)().execute("lobby.create", {
            viewerId: body.viewer_id, playerId: ctx.playerId, partyId: body.party_id,
            category: body.category, questId: body.quest_id,
            profileMainCharacterId: (_d = (_c = favorite.characterIds[0]) !== null && _c !== void 0 ? _c : ctx.player.leaderCharacterId) !== null && _d !== void 0 ? _d : 1,
        });
        return send(reply, body.viewer_id, { access_token: room.access_token, room_number: room.room_number, room_url: "" });
    }));
    fastify.post("/search_room", (request, reply) => __awaiter(this, void 0, void 0, function* () {
        var _e;
        const body = request.body;
        const ctx = body.viewer_id && !isNaN(body.viewer_id) ? yield (0, player_context_1.resolveMultiPlayerContext)(body.viewer_id) : null;
        if (!ctx)
            return bad(reply);
        const room = yield query(body.viewer_id, body.room_number);
        const visible = !!room && Number(room.category) !== 20 && !(0, mode15_room_gate_1.isMode15RoomClosed)(room) && !room.restoreBlocked
            && (room.returningMember || ((0, guest_eligibility_1.canJoinMultiGuestQuestSync)(ctx.playerId, room.category, room.quest_id, ctx.player).allowed
                && !["STARTING", "BATTLE"].includes(room.phase) && !room.waitingForExpectedMember && room.occupancy < 3));
        return send(reply, body.viewer_id, {
            room_exists: visible, category_id: visible ? room.category : 0, quest_id: visible ? room.quest_id : 0,
            room_number: (_e = room === null || room === void 0 ? void 0 : room.room_number) !== null && _e !== void 0 ? _e : body.room_number, establisher_viewer_id: visible ? room.host_viewer_id : 0,
            establisher_follow: visible ? (0, follow_1.getFollowRelationSync)(ctx.playerId, room.host_player_id).state : 0,
        });
    }));
    fastify.post("/select_room", (request, reply) => __awaiter(this, void 0, void 0, function* () {
        const body = request.body;
        const ctx = body.viewer_id && !isNaN(body.viewer_id) ? yield (0, player_context_1.resolveMultiPlayerContext)(body.viewer_id) : null;
        if (!ctx)
            return bad(reply);
        let room = yield query(body.viewer_id, body.room_number, body.access_token);
        function facts(snapshot) {
            var _a;
            return {
                roomNumber: (snapshot === null || snapshot === void 0 ? void 0 : snapshot.room_number) || body.room_number || "", viewerId: body.viewer_id,
                identity: (_a = snapshot === null || snapshot === void 0 ? void 0 : snapshot.identity) !== null && _a !== void 0 ? _a : null, category: Number(body.category), questId: Number(body.quest_id),
                rescueSelection: Number(body.accepted_type) === 2,
                guestAllowed: Number(body.category) !== 20 && (!snapshot || (Number(snapshot.category) !== 20 && (snapshot.returningMember || (0, guest_eligibility_1.canJoinMultiGuestQuestSync)(ctx.playerId, snapshot.category, snapshot.quest_id, ctx.player).allowed))),
                mode15Closed: !!snapshot && (0, mode15_room_gate_1.isMode15RoomClosed)(snapshot),
                mode15Helper: !!snapshot && (0, mode15_optional_1.isMode15Quest)(snapshot.category, snapshot.quest_id),
                hostNewbie: !!snapshot && (0, newbie_1.isNewbiePlayerSync)(snapshot.host_player_id, (0, player_1.getPlayerSync)(snapshot.host_player_id)),
            };
        }
        let commandId = (0, command_protocol_1.createRoomCommandId)();
        let result = yield (0, default_runtime_1.getRoomCommandGateway)().execute("lobby.select", facts(room), { commandId });
        // Retry only an explicit, unapplied stale decision within the same instance and generation.
        if (result.status === "stale" && room) {
            const fresh = yield query(body.viewer_id, room.room_number);
            if (fresh && fresh.identity.instanceId === room.identity.instanceId && fresh.identity.generation === room.identity.generation) {
                room = fresh;
                commandId = (0, command_protocol_1.createRoomCommandId)();
                result = (yield (0, default_runtime_1.getRoomCommandGateway)().execute("lobby.select", facts(room), { commandId }));
            }
        }
        if (result.status === "stale" || result.status === "expired")
            throw new command_protocol_1.RoomCommandError(result.status === "stale" ? "STALE_ROOM_IDENTITY" : "COMMAND_EXPIRED", "Lobby selection was not applied", commandId, false);
        if (result.status === "denied")
            return send(reply, body.viewer_id, {
                application_update_url: "", category_id: 0, host_entry_time: 0, ip_address: "", port: 0, quest_id: 0,
                raising_state: result.raisingState, room_number: result.roomNumber, room_sequence: 0, share_room_options: 0, is_pickup: null,
            });
        if (result.status === "ready") {
            (0, player_context_1.cacheMultiPlayerContext)(body.viewer_id, ctx);
            (0, party_snapshot_1.primeRealPartySnapshot)(ctx.playerId);
            return send(reply, body.viewer_id, (0, serializer_1.serializeRoomConnection)(result.room));
        }
        throw new command_protocol_1.RoomCommandError("COMMAND_REJECTED", "Lobby selection was not applied", commandId, false);
    }));
}
exports.registerLobbyRoutes = registerLobbyRoutes;
