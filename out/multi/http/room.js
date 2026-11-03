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
exports.registerRoomRoutes = void 0;
const utils_1 = require("../../utils");
const serializer_1 = require("../room/serializer");
const builder_1 = require("../npc/builder");
const game_logging_1 = require("../../lib/game-logging");
const mode15_room_gate_1 = require("../mode15-room-gate");
const player_context_1 = require("../player-context");
const attention_config_1 = require("../attention-config");
const default_runtime_1 = require("../coordinator/default-runtime");
const command_protocol_1 = require("../coordinator/command-protocol");
function hasValidViewer(viewerId) {
    return __awaiter(this, void 0, void 0, function* () {
        return (yield (0, player_context_1.resolveMultiPlayerContext)(viewerId)) !== null;
    });
}
function forbidden(reply) {
    return reply.status(403).send({ error: "Forbidden", message: "Room permission denied." });
}
function numberOrNull(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}
function roomFacts(roomNumber, accessToken) {
    return __awaiter(this, void 0, void 0, function* () {
        return yield (0, default_runtime_1.getRoomCommandGateway)().execute("room.query", roomNumber
            ? { roomNumber } : { accessToken: accessToken || "" });
    });
}
/**
 * Every co-op client simulates the whole battle from its own copy of the
 * master data and DSL, so a member on an older resource edge plays a different
 * boss. MULTI_REQUIRE_CURRENT_ASSETS=1 makes such a client update first.
 */
function isAssetStale(request) {
    var _a;
    if (!/^(1|true|yes|on)$/i.test((_a = process.env.MULTI_REQUIRE_CURRENT_ASSETS) !== null && _a !== void 0 ? _a : ""))
        return false;
    const resVer = request.headers["res_ver"];
    if (typeof resVer !== "string" || !resVer)
        return false;
    try {
        const { computeAssetTarget } = require("../../lib/version");
        const target = computeAssetTarget(resVer);
        return !target.isFirstTime && target.targetVersion !== resVer;
    }
    catch (_b) {
        return false;
    }
}
function decisionPayload(room, roomNumber, viewerId) {
    var _a;
    return { roomNumber: (room === null || room === void 0 ? void 0 : room.room_number) || roomNumber, viewerId,
        identity: (_a = room === null || room === void 0 ? void 0 : room.identity) !== null && _a !== void 0 ? _a : null, mode15Closed: !!room && (0, mode15_room_gate_1.isMode15RoomClosed)(room) };
}
function execute(kind_1, payload_1) {
    return __awaiter(this, arguments, void 0, function* (kind, payload, commandId = (0, command_protocol_1.createRoomCommandId)()) {
        const result = yield (0, default_runtime_1.getRoomCommandGateway)().execute(kind, payload, { commandId });
        if (result.status === "expired") {
            throw new command_protocol_1.RoomCommandError("COMMAND_EXPIRED", "Room command expired before application", commandId, false);
        }
        return result;
    });
}
function executeConnection(kind, payload) {
    return __awaiter(this, void 0, void 0, function* () {
        let commandId = (0, command_protocol_1.createRoomCommandId)();
        let result = yield execute(kind, payload, commandId);
        if (result.status !== "stale")
            return result;
        // Only a definitive, unapplied stale result permits one new command.
        // A timeout or unknown result throws above and never reaches this path.
        const latest = yield roomFacts(payload.roomNumber);
        if (latest && payload.identity && latest.identity.instanceId === payload.identity.instanceId
            && latest.identity.generation === payload.identity.generation) {
            commandId = (0, command_protocol_1.createRoomCommandId)();
            result = yield execute(kind, Object.assign(Object.assign({}, payload), decisionPayload(latest, payload.roomNumber, payload.viewerId)), commandId);
        }
        if (result.status === "stale") {
            throw new command_protocol_1.RoomCommandError("STALE_ROOM_IDENTITY", "Room identity changed during connection decision", commandId, false);
        }
        return result;
    });
}
function connectionData(connection, disabled = false) {
    return Object.assign(Object.assign({ application_update_url: "" }, connection), { ip_address: disabled ? "" : (0, serializer_1.getDisplayHost)(), port: disabled ? 0 : parseInt(process.env.SESSION_PORT || "8003"), is_pickup: null });
}
function missingConnection(roomNumber) {
    return { category_id: 0, host_entry_time: 0, quest_id: 0, raising_state: 9,
        room_number: roomNumber, room_sequence: 0, share_room_options: 0 };
}
function send(reply, viewerId, data) {
    reply.header("content-type", "application/x-msgpack");
    return reply.status(200).send({ data_headers: (0, utils_1.generateDataHeaders)({ viewer_id: viewerId }), data });
}
function registerRoomRoutes(fastify) {
    fastify.post("/prepare", (request, reply) => __awaiter(this, void 0, void 0, function* () {
        const body = request.body, viewerId = body.viewer_id;
        (0, game_logging_1.gameVerboseLog)(() => `[MULTI] prepare: viewer=${viewerId} room=${body.room_number}`);
        if (!(yield hasValidViewer(viewerId)))
            return reply.status(400).send({ error: "Bad Request", message: "Invalid request body." });
        const room = yield roomFacts(body.room_number, body.access_token);
        const payload = Object.assign(Object.assign({}, decisionPayload(room, body.room_number || "", viewerId)), { category: numberOrNull(body.category), questId: numberOrNull(body.quest_id), assetStale: isAssetStale(request) });
        const result = yield executeConnection("room.prepare", payload);
        if (result.status !== "ready") {
            console.warn(`[MULTI] room connection acknowledged as unavailable: viewer=${viewerId} room=${payload.roomNumber} reason=${result.status}`);
            return send(reply, viewerId, connectionData(missingConnection(payload.roomNumber), true));
        }
        return send(reply, viewerId, connectionData(result.connection));
    }));
    fastify.post("/summon", (request, reply) => __awaiter(this, void 0, void 0, function* () {
        const body = request.body, viewerId = body.viewer_id;
        if (!(yield hasValidViewer(viewerId)))
            return reply.status(400).send({ error: "Bad Request", message: "Invalid request body." });
        const room = yield roomFacts(body.room_number);
        const result = yield execute("room.summon", Object.assign(Object.assign({}, decisionPayload(room, body.room_number, viewerId)), { category: numberOrNull(body.category_id), questId: numberOrNull(body.quest_id) }));
        if (result.status === "forbidden")
            return forbidden(reply);
        const mates = result.status === "summon" && result.npcMode
            ? (0, builder_1.buildNpcMates)(body.quest_id, result.category) : { mate1: null, mate2: null };
        return send(reply, viewerId, { mate1: mates.mate1, mate2: mates.mate2 });
    }));
    fastify.post("/restore_room", (request, reply) => __awaiter(this, void 0, void 0, function* () {
        const body = request.body, viewerId = body.viewer_id;
        if (!(yield hasValidViewer(viewerId)))
            return reply.status(400).send({ error: "Bad Request", message: "Invalid request body." });
        const room = yield roomFacts(body.room_number);
        const result = yield executeConnection("room.restore", Object.assign(Object.assign({}, decisionPayload(room, body.room_number, viewerId)), { assetStale: isAssetStale(request) }));
        const connection = result.status === "ready" ? result.connection : missingConnection(body.room_number);
        return send(reply, viewerId, Object.assign(Object.assign({}, connectionData(connection, [9, 13].includes(connection.raising_state))), { is_same_room: true }));
    }));
    fastify.post("/share_room", (request, reply) => __awaiter(this, void 0, void 0, function* () {
        var _a;
        const body = request.body, viewerId = body.viewer_id;
        if (!(yield hasValidViewer(viewerId)))
            return reply.status(400).send({ error: "Bad Request", message: "Invalid request body." });
        const room = yield roomFacts(body.room_number);
        const payload = Object.assign(Object.assign({}, decisionPayload(room, body.room_number, viewerId)), { shareTypes: (_a = body.share_type_list) !== null && _a !== void 0 ? _a : null });
        if (body.category !== undefined)
            payload.category = numberOrNull(body.category);
        if (body.quest_id !== undefined)
            payload.questId = numberOrNull(body.quest_id);
        const result = yield execute("room.share", payload);
        if (result.status === "forbidden")
            return forbidden(reply);
        if (result.status !== "done")
            console.warn(`[MULTI] stale share_room acknowledged: viewer=${viewerId} reason=${result.status}`);
        return send(reply, viewerId, { config: (0, attention_config_1.getAttentionConfig)() });
    }));
    fastify.post("/disband_room", (request, reply) => __awaiter(this, void 0, void 0, function* () {
        var _b;
        const body = request.body, viewerId = body === null || body === void 0 ? void 0 : body.viewer_id, roomNumber = body === null || body === void 0 ? void 0 : body.room_number;
        if (typeof roomNumber !== "string" || !roomNumber || !(yield hasValidViewer(viewerId))) {
            return reply.status(400).send({ error: "Bad Request", message: "Invalid request body." });
        }
        const room = yield roomFacts(roomNumber);
        const result = yield execute("room.disband", { roomNumber, viewerId, identity: (_b = room === null || room === void 0 ? void 0 : room.identity) !== null && _b !== void 0 ? _b : null, mode15Closed: false });
        if (result.status === "forbidden")
            return forbidden(reply);
        return send(reply, viewerId, {});
    }));
}
exports.registerRoomRoutes = registerRoomRoutes;
