import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify"
import { PrepareBody, SummonBody, RestoreRoomBody, ShareRoomBody } from "../types"
import { generateDataHeaders } from "../../utils"
import { getDisplayHost } from "../room/serializer"
import { buildNpcMates } from "../npc/builder"
import { gameVerboseLog } from "../../lib/game-logging"
import { isMode15RoomClosed } from "../mode15-room-gate"
import { resolveMultiPlayerContext } from "../player-context"
import { getAttentionConfig } from "../attention-config"
import { getRoomCommandGateway } from "../coordinator/default-runtime"
import { createRoomCommandId, RoomCommandError } from "../coordinator/command-protocol"
import type { RoomQueryProjection, RoomDecisionPayload, RoomDecisionResult, RoomConnectionState } from "../coordinator/room-command-handlers"

async function hasValidViewer(viewerId: number): Promise<boolean> {
    return await resolveMultiPlayerContext(viewerId) !== null
}
function forbidden(reply: FastifyReply): FastifyReply {
    return reply.status(403).send({ error: "Forbidden", message: "Room permission denied." })
}
function numberOrNull(value: unknown): number | null {
    const number = Number(value)
    return Number.isFinite(number) ? number : null
}
async function roomFacts(roomNumber?: string, accessToken?: string): Promise<RoomQueryProjection | null> {
    return await getRoomCommandGateway().execute("room.query", roomNumber
        ? { roomNumber } : { accessToken: accessToken || "" }) as RoomQueryProjection | null
}
function decisionPayload(room: RoomQueryProjection | null, roomNumber: string, viewerId: number): RoomDecisionPayload {
    return { roomNumber: room?.room_number || roomNumber, viewerId,
        identity: room?.identity ?? null, mode15Closed: !!room && isMode15RoomClosed(room) }
}
async function execute(kind: string, payload: RoomDecisionPayload,
    commandId = createRoomCommandId()): Promise<RoomDecisionResult> {
    const result = await getRoomCommandGateway().execute(kind, payload, { commandId }) as RoomDecisionResult
    if (result.status === "expired") {
        throw new RoomCommandError("COMMAND_EXPIRED", "Room command expired before application", commandId, false)
    }
    return result
}
async function executeConnection(kind: "room.prepare" | "room.restore", payload: RoomDecisionPayload): Promise<RoomDecisionResult> {
    let commandId = createRoomCommandId()
    let result = await execute(kind, payload, commandId)
    if (result.status !== "stale") return result
    // Only a definitive, unapplied stale result permits one new command.
    // A timeout or unknown result throws above and never reaches this path.
    const latest = await roomFacts(payload.roomNumber)
    if (latest && payload.identity && latest.identity.instanceId === payload.identity.instanceId
        && latest.identity.generation === payload.identity.generation) {
        commandId = createRoomCommandId()
        result = await execute(kind, { ...payload,
            ...decisionPayload(latest, payload.roomNumber, payload.viewerId) }, commandId)
    }
    if (result.status === "stale") {
        throw new RoomCommandError("STALE_ROOM_IDENTITY", "Room identity changed during connection decision", commandId, false)
    }
    return result
}
function connectionData(connection: RoomConnectionState, disabled = false) {
    return { application_update_url: "", ...connection,
        ip_address: disabled ? "" : getDisplayHost(),
        port: disabled ? 0 : parseInt(process.env.SESSION_PORT || "8003"), is_pickup: null }
}
function missingConnection(roomNumber: string): RoomConnectionState {
    return { category_id: 0, host_entry_time: 0, quest_id: 0, raising_state: 9,
        room_number: roomNumber, room_sequence: 0, share_room_options: 0 }
}
function send(reply: FastifyReply, viewerId: number, data: unknown) {
    reply.header("content-type", "application/x-msgpack")
    return reply.status(200).send({ data_headers: generateDataHeaders({ viewer_id: viewerId }), data })
}

export function registerRoomRoutes(fastify: FastifyInstance): void {
    fastify.post("/prepare", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as PrepareBody, viewerId = body.viewer_id
        gameVerboseLog(() => `[MULTI] prepare: viewer=${viewerId} room=${body.room_number}`)
        if (!await hasValidViewer(viewerId)) return reply.status(400).send({ error: "Bad Request", message: "Invalid request body." })
        const room = await roomFacts(body.room_number, body.access_token)
        const payload = { ...decisionPayload(room, body.room_number || "", viewerId),
            category: numberOrNull(body.category), questId: numberOrNull(body.quest_id) }
        const result = await executeConnection("room.prepare", payload)
        if (result.status !== "ready") {
            console.warn(`[MULTI] room connection acknowledged as unavailable: viewer=${viewerId} room=${payload.roomNumber} reason=${result.status}`)
            return send(reply, viewerId, connectionData(missingConnection(payload.roomNumber), true))
        }
        return send(reply, viewerId, connectionData(result.connection))
    })
    fastify.post("/summon", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as SummonBody, viewerId = body.viewer_id
        if (!await hasValidViewer(viewerId)) return reply.status(400).send({ error: "Bad Request", message: "Invalid request body." })
        const room = await roomFacts(body.room_number)
        const result = await execute("room.summon", { ...decisionPayload(room, body.room_number, viewerId),
            category: numberOrNull(body.category_id), questId: numberOrNull(body.quest_id) })
        if (result.status === "forbidden") return forbidden(reply)
        const mates = result.status === "summon" && result.npcMode
            ? buildNpcMates(body.quest_id, result.category) : { mate1: null, mate2: null }
        return send(reply, viewerId, { mate1: mates.mate1, mate2: mates.mate2 })
    })
    fastify.post("/restore_room", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as RestoreRoomBody, viewerId = body.viewer_id
        if (!await hasValidViewer(viewerId)) return reply.status(400).send({ error: "Bad Request", message: "Invalid request body." })
        const room = await roomFacts(body.room_number)
        const result = await executeConnection("room.restore", decisionPayload(room, body.room_number, viewerId))
        const connection = result.status === "ready" ? result.connection : missingConnection(body.room_number)
        return send(reply, viewerId, { ...connectionData(connection, [9, 13].includes(connection.raising_state)), is_same_room: true })
    })
    fastify.post("/share_room", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as ShareRoomBody, viewerId = body.viewer_id
        if (!await hasValidViewer(viewerId)) return reply.status(400).send({ error: "Bad Request", message: "Invalid request body." })
        const room = await roomFacts(body.room_number)
        const payload: RoomDecisionPayload = { ...decisionPayload(room, body.room_number, viewerId), shareTypes: body.share_type_list ?? null }
        if (body.category !== undefined) payload.category = numberOrNull(body.category)
        if (body.quest_id !== undefined) payload.questId = numberOrNull(body.quest_id)
        const result = await execute("room.share", payload)
        if (result.status === "forbidden") return forbidden(reply)
        if (result.status !== "done") console.warn(`[MULTI] stale share_room acknowledged: viewer=${viewerId} reason=${result.status}`)
        return send(reply, viewerId, { config: getAttentionConfig() })
    })
    fastify.post("/disband_room", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as RestoreRoomBody, viewerId = body?.viewer_id, roomNumber = body?.room_number
        if (typeof roomNumber !== "string" || !roomNumber || !await hasValidViewer(viewerId)) {
            return reply.status(400).send({ error: "Bad Request", message: "Invalid request body." })
        }
        const room = await roomFacts(roomNumber)
        const result = await execute("room.disband", { roomNumber, viewerId, identity: room?.identity ?? null, mode15Closed: false })
        if (result.status === "forbidden") return forbidden(reply)
        return send(reply, viewerId, {})
    })
}
