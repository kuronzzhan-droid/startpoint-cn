import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { PrepareBody, SummonBody, RestoreRoomBody, ShareRoomBody } from "../types";
import { generateDataHeaders } from "../../utils";
import { getRoom, getRoomByToken, updateHostEntryTime, disbandRoom } from "../room/manager";
import { serializeRoomConnection } from "../room/serializer";
import { sessionManager } from "../state/SessionManager";
import { buildNpcMates } from "../npc/builder";
import { publishRandomRecruitment, stopRandomRecruitment } from "../recruitment";
import { recruitNpcMatesForRoom } from "../tcp/lobby";
import {
    AI_RECRUITMENT_SHARE_TYPE,
    encodeRoomShareOptions,
    normalizeRoomShareTypes,
    RANDOM_RECRUITMENT_SHARE_TYPE,
} from "../room/sharing";
import { gameVerboseLog } from "../../lib/game-logging";
import { isMode15RoomClosed } from "../mode15-room-gate";

export function registerRoomRoutes(fastify: FastifyInstance): void {

    // ---- prepare ----
    fastify.post("/prepare", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as PrepareBody;
        const viewerId = body.viewer_id;
        gameVerboseLog(() => `[MULTI] prepare: viewer=${viewerId} room=${body.room_number}`);

        if (!viewerId || isNaN(viewerId)) {
            return reply.status(400).send({
                "error": "Bad Request", "message": "Invalid request body."
            });
        }

        const room = body.room_number
            ? getRoom(body.room_number)
            : getRoomByToken(body.access_token || "");

        const mode15RoomClosed = !!room && isMode15RoomClosed(room);
        if (!room || mode15RoomClosed || sessionManager.isRoomRestoreBlocked(room.room_number, viewerId)) {
            if (mode15RoomClosed) {
                console.log(`[MODE15] prepare denied: completed host room=${room?.room_number} viewer=${viewerId}`);
            }
            reply.header("content-type", "application/x-msgpack");
            return reply.status(200).send({
                "data_headers": generateDataHeaders({ viewer_id: viewerId }),
                "data": {
                    application_update_url: "",
                    category_id: 0,
                    host_entry_time: 0,
                    ip_address: "",
                    port: 0,
                    quest_id: 0,
                    raising_state: 9,
                    room_number: room?.room_number || body.room_number || "",
                    room_sequence: 0,
                    share_room_options: 0,
                    is_pickup: null,
                }
            });
        }

        updateHostEntryTime(room.room_number);
        const data = serializeRoomConnection(room);
        if (viewerId === room.host_viewer_id) {
            data.raising_state = 1
        } else if (!sessionManager.isHostOnline(room.host_viewer_id, room.room_number, room.lobby_generation)) {
            data.raising_state = 2
            gameVerboseLog(() => `[MULTI] prepare: host offline, guest polls raising_state → 2`)
        }

        reply.header("content-type", "application/x-msgpack");
        return reply.status(200).send({
            "data_headers": generateDataHeaders({ viewer_id: viewerId }),
            "data": data,
        });
    });

    // ---- summon ----
    fastify.post("/summon", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as SummonBody;
        const viewerId = body.viewer_id;
        gameVerboseLog(() => `[MULTI] summon: viewer=${viewerId} room=${body.room_number}`);

        if (!viewerId || isNaN(viewerId)) {
            return reply.status(400).send({
                "error": "Bad Request", "message": "Invalid request body."
            });
        }

        const room = getRoom(body.room_number);
        if (!room || isMode15RoomClosed(room) || sessionManager.isRoomRestoreBlocked(body.room_number, viewerId)) {
            return reply.status(400).send({
                "error": "Bad Request", "message": "Room doesn't exist."
            });
        }

        // Random recruitment is a real-player broadcast.  The client still calls
        // /summon after its legacy COM timeout, so only return COM data for rooms
        // that explicitly selected the second (AI) share option.
        const mates = room.is_npc_mode
            ? buildNpcMates(body.quest_id, room.category)
            : { mate1: null, mate2: null };

        reply.header("content-type", "application/x-msgpack");
        return reply.status(200).send({
            "data_headers": generateDataHeaders({ viewer_id: viewerId }),
            "data": {
                "mate1": mates.mate1,
                "mate2": mates.mate2,
            }
        });
    });

    // ---- restore_room ----
    fastify.post("/restore_room", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as RestoreRoomBody;
        const viewerId = body.viewer_id;
        gameVerboseLog(() => `[MULTI] restore_room: viewer=${viewerId} room=${body.room_number}`);

        if (!viewerId || isNaN(viewerId)) {
            return reply.status(400).send({
                "error": "Bad Request", "message": "Invalid request body."
            });
        }

        const room = getRoom(body.room_number);
        const mode15RoomClosed = !!room && isMode15RoomClosed(room);
        if (!room || mode15RoomClosed || sessionManager.isRoomRestoreBlocked(body.room_number, viewerId)) {
            if (mode15RoomClosed) {
                console.log(`[MODE15] restore_room denied: completed host room=${body.room_number} viewer=${viewerId}`);
            }
            reply.header("content-type", "application/x-msgpack");
            return reply.status(200).send({
                "data_headers": generateDataHeaders({ viewer_id: viewerId }),
                "data": {
                    application_update_url: "",
                    category_id: 0,
                    host_entry_time: 0,
                    ip_address: "",
                    port: 0,
                    quest_id: 0,
                    raising_state: 9,
                    room_number: body.room_number,
                    room_sequence: 0,
                    share_room_options: 0,
                    is_pickup: null,
                    is_same_room: true,
                }
            });
        }

        const data = { ...serializeRoomConnection(room), is_same_room: true };
        if (viewerId === room.host_viewer_id) {
            data.raising_state = 1
        } else if (!sessionManager.isHostOnline(room.host_viewer_id, room.room_number, room.lobby_generation)) {
            data.raising_state = 2
            gameVerboseLog(() => `[MULTI] restore_room: host offline, guest polls raising_state → 2`)
        }

        reply.header("content-type", "application/x-msgpack");
        return reply.status(200).send({
            "data_headers": generateDataHeaders({ viewer_id: viewerId }),
            "data": data,
        });
    });

    // ---- share_room ----
    fastify.post("/share_room", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as ShareRoomBody;
        const viewerId = body.viewer_id;
        gameVerboseLog(() => `[MULTI] share_room: viewer=${viewerId} room=${body.room_number}`);

        if (!viewerId || isNaN(viewerId)) {
            return reply.status(400).send({
                "error": "Bad Request", "message": "Invalid request body."
            });
        }

        const room = getRoom(body.room_number);
        if (!room || room.host_viewer_id !== viewerId) {
            return reply.status(400).send({
                "error": "Bad Request", "message": "Room doesn't exist or viewer is not the host."
            });
        }

        if (isMode15RoomClosed(room)) {
            stopRandomRecruitment(room.room_number);
            console.log(`[MODE15] share_room ignored: completed host room=${room.room_number} viewer=${viewerId}`);
            reply.header("content-type", "application/x-msgpack");
            return reply.status(200).send({
                "data_headers": generateDataHeaders({ viewer_id: viewerId }),
                "data": {}
            });
        }

        const shareTypes = normalizeRoomShareTypes(body.share_type_list);
        room.share_room_options = encodeRoomShareOptions(shareTypes);

        // Option 2 is intentionally repurposed as the private-server AI switch.
        // If both 2 and 3 are selected, AI wins so a room is never advertised to
        // real players while it is being filled with COM mates.
        if (shareTypes.includes(AI_RECRUITMENT_SHARE_TYPE)) {
            room.is_npc_mode = true;
            stopRandomRecruitment(room.room_number);
            recruitNpcMatesForRoom(room.room_number);
            gameVerboseLog(() => `[MULTI] share_room: AI recruitment enabled room=${room.room_number}`);
        } else if (shareTypes.includes(RANDOM_RECRUITMENT_SHARE_TYPE)) {
            if (room.npc_count <= 0) room.is_npc_mode = false;
            const recruitment = publishRandomRecruitment(room.room_number);
            gameVerboseLog(() => `[MULTI] share_room: random recruitment published room=${room.room_number} key=${recruitment.attentionKey}`);
        } else {
            if (room.npc_count <= 0) room.is_npc_mode = false;
            stopRandomRecruitment(room.room_number);
            gameVerboseLog(() => `[MULTI] share_room: scoped visibility updated room=${room.room_number} options=${room.share_room_options}`);
        }

        reply.header("content-type", "application/x-msgpack");
        return reply.status(200).send({
            "data_headers": generateDataHeaders({ viewer_id: viewerId }),
            "data": {}
        });
    });

    // ---- disband_room ----
    fastify.post("/disband_room", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as RestoreRoomBody;
        const viewerId = body.viewer_id;
        gameVerboseLog(() => `[MULTI] disband_room: viewer=${viewerId} room=${body.room_number}`);

        if (!viewerId || isNaN(viewerId)) {
            return reply.status(400).send({
                "error": "Bad Request", "message": "Invalid request body."
            });
        }

        if (body.room_number) {
            sessionManager.broadcastToRoom(body.room_number, [1, [6, "multibattle_room_dismissed"]]);
            disbandRoom(body.room_number);
            gameVerboseLog(() => `[MULTI] room ${body.room_number} disbanded by viewer ${viewerId}`);
        }

        reply.header("content-type", "application/x-msgpack");
        return reply.status(200).send({
            "data_headers": generateDataHeaders({ viewer_id: viewerId }),
            "data": {}
        });
    });
}
