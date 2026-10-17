import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify"
import { GetRoomsBody, CreateRoomBody, SearchRoomBody, SelectRoomBody } from "../types"
import { getPlayerSync } from "../../data/domains/player"
import { getFollowRelationSync } from "../../data/domains/follow"
import { getQuestFromCategorySync } from "../../lib/assets"
import { generateDataHeaders } from "../../utils"
import { getFavoritePartySelectionSync } from "../../lib/profileFavorite"
import { serializeRoom, serializeRoomConnection } from "../room/serializer"
import { isRoomSharedWithPlayer } from "../room/sharing"
import { isNewbiePlayerSync } from "../../lib/newbie"
import { canStartMode15QuestSync, isMode15Quest } from "../../lib/mode15-optional"
import { isMode15RoomClosed } from "../mode15-room-gate"
import { SELECT_ROOM_FILLED_STATE } from "../room/select-denial"
import { cacheMultiPlayerContext, resolveMultiPlayerContext } from "../player-context"
import { primeRealPartySnapshot } from "../party-snapshot"
import { canJoinMultiGuestQuestSync } from "../guest-eligibility"
import { getRoomCommandGateway } from "../coordinator/default-runtime"
import { createRoomCommandId, RoomCommandError } from "../coordinator/command-protocol"
import type { LobbyRoomProjection, LobbyRoomPage, LobbySelectPayload, LobbySelectResult } from "../coordinator/lobby-command-handlers"

/** Bounded owner RPC pages; a fixed upper sequence avoids chasing new rooms forever. */
export async function fetchLobbyRoomProjections(viewerId: number, categories?: number[], eventId?: number, onlyRecruiting = false,
    accept: (room: LobbyRoomProjection) => boolean = () => true): Promise<LobbyRoomProjection[]> {
    const rooms: LobbyRoomProjection[] = []
    // Discovery views are capped at 256 rooms; attention examines at most 64
    // active recruitment candidates per poll. No mutation is silently dropped.
    const maximumRooms = onlyRecruiting ? 64 : 256
    let afterSequence = 0, throughSequence: number | undefined, inspected = 0
    do {
        const page = await getRoomCommandGateway().execute("lobby.list", {
            viewerId, afterSequence, onlyRecruiting, ...(categories ? { categories } : {}),
            ...(eventId === undefined ? {} : { eventId }), ...(throughSequence === undefined ? {} : { throughSequence }),
        }) as LobbyRoomPage
        inspected += page.rooms.length; rooms.push(...page.rooms.filter(accept)); throughSequence = page.throughSequence
        if (page.nextSequence === null || inspected >= maximumRooms) break
        afterSequence = page.nextSequence
    } while (true)
    return categories ? rooms.sort((a, b) => categories.indexOf(a.category) - categories.indexOf(b.category) || a.room_sequence - b.room_sequence) : rooms
}

export async function disbandIdleHostedLobbyRooms(hostViewerId: number): Promise<number> {
    return await getRoomCommandGateway().execute("lobby.cleanupHosted", { viewerId: hostViewerId }) as number
}
function query(viewerId: number, roomNumber?: string, accessToken?: string): Promise<LobbyRoomProjection | null> {
    return getRoomCommandGateway().execute("lobby.query", { viewerId, roomNumber: roomNumber || "", accessToken: accessToken || "" }) as Promise<LobbyRoomProjection | null>
}
function bad(reply: FastifyReply) { return reply.status(400).send({ error: "Bad Request", message: "Invalid viewer id or no player bound." }) }
function send(reply: FastifyReply, viewerId: number, data: unknown, resultCode?: number) {
    reply.header("content-type", "application/x-msgpack")
    return reply.status(200).send({ data_headers: generateDataHeaders({ viewer_id: viewerId, ...(resultCode === undefined ? {} : { result_code: resultCode }) }), data })
}
export function registerLobbyRoutes(fastify: FastifyInstance): void {
    fastify.post("/create_room_failure", async (request, reply) => {
        const viewer = Number((request.body as { viewer_id?: number })?.viewer_id ?? 0)
        return send(reply, Number.isFinite(viewer) ? viewer : 0, {})
    })
    fastify.post("/get_rooms", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as GetRoomsBody
        const ctx = body.viewer_id && !isNaN(body.viewer_id) ? await resolveMultiPlayerContext(body.viewer_id) : null
        if (!ctx) return bad(reply)
        const categories = body.category_id === 7 || body.category_id === 8 ? [7, 8] : [body.category_id]
        const projections = await fetchLobbyRoomProjections(body.viewer_id, categories, body.event_id, false, room =>
            room.host_viewer_id !== body.viewer_id && isRoomSharedWithPlayer(room, ctx.playerId)
            && !["STARTING", "BATTLE"].includes(room.phase) && !isMode15RoomClosed(room)
            && room.hostOnline && room.occupancy < 3
            && canJoinMultiGuestQuestSync(ctx.playerId, room.category, room.quest_id, ctx.player).allowed)
        const rooms = projections.map(room => {
                const serialized = serializeRoom(room, ctx.playerId)
                if (!room.returningMember && room.acceptedSeatCount >= 3) serialized.raising_state = SELECT_ROOM_FILLED_STATE
                return serialized
            })
        return send(reply, body.viewer_id, { rooms })
    })
    fastify.post("/create_room", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as CreateRoomBody
        const ctx = body.viewer_id && !isNaN(body.viewer_id) ? await resolveMultiPlayerContext(body.viewer_id) : null
        if (!ctx) return bad(reply)
        cacheMultiPlayerContext(body.viewer_id, ctx)
        primeRealPartySnapshot(ctx.playerId)
        if (!getQuestFromCategorySync(body.category, body.quest_id)
            || (isMode15Quest(body.category, body.quest_id) && !canStartMode15QuestSync(ctx.playerId, body.category, body.quest_id).allowed)) {
            return send(reply, body.viewer_id, {}, 4507)
        }
        const favorite = getFavoritePartySelectionSync(ctx.playerId, ctx.player.leaderCharacterId)
        const room = await getRoomCommandGateway().execute("lobby.create", {
            viewerId: body.viewer_id, playerId: ctx.playerId, partyId: body.party_id,
            category: body.category, questId: body.quest_id,
            profileMainCharacterId: favorite.characterIds[0] ?? ctx.player.leaderCharacterId ?? 1,
        }) as LobbyRoomProjection
        return send(reply, body.viewer_id, { access_token: room.access_token, room_number: room.room_number, room_url: "" })
    })
    fastify.post("/search_room", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as SearchRoomBody
        const ctx = body.viewer_id && !isNaN(body.viewer_id) ? await resolveMultiPlayerContext(body.viewer_id) : null
        if (!ctx) return bad(reply)
        const room = await query(body.viewer_id, body.room_number)
        const visible = !!room && !isMode15RoomClosed(room) && !room.restoreBlocked
            && (room.returningMember || (canJoinMultiGuestQuestSync(ctx.playerId, room.category, room.quest_id, ctx.player).allowed
                && !["STARTING", "BATTLE"].includes(room.phase) && !room.waitingForExpectedMember && room.occupancy < 3))
        return send(reply, body.viewer_id, {
            room_exists: visible, category_id: visible ? room.category : 0, quest_id: visible ? room.quest_id : 0,
            room_number: room?.room_number ?? body.room_number, establisher_viewer_id: visible ? room.host_viewer_id : 0,
            establisher_follow: visible ? getFollowRelationSync(ctx.playerId, room.host_player_id).state : 0,
        })
    })
    fastify.post("/select_room", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as SelectRoomBody
        const ctx = body.viewer_id && !isNaN(body.viewer_id) ? await resolveMultiPlayerContext(body.viewer_id) : null
        if (!ctx) return bad(reply)
        let room = await query(body.viewer_id, body.room_number, body.access_token)
        function facts(snapshot: LobbyRoomProjection | null): LobbySelectPayload {
            return {
                roomNumber: snapshot?.room_number || body.room_number || "", viewerId: body.viewer_id,
                identity: snapshot?.identity ?? null, category: Number(body.category), questId: Number(body.quest_id),
                rescueSelection: Number(body.accepted_type) === 2,
                guestAllowed: !snapshot || snapshot.returningMember || canJoinMultiGuestQuestSync(ctx!.playerId, snapshot.category, snapshot.quest_id, ctx!.player).allowed,
                mode15Closed: !!snapshot && isMode15RoomClosed(snapshot),
                mode15Helper: !!snapshot && isMode15Quest(snapshot.category, snapshot.quest_id),
                hostNewbie: !!snapshot && isNewbiePlayerSync(snapshot.host_player_id, getPlayerSync(snapshot.host_player_id)),
            }
        }
        let commandId = createRoomCommandId()
        let result = await getRoomCommandGateway().execute("lobby.select", facts(room), { commandId }) as LobbySelectResult
        // Retry only an explicit, unapplied stale decision within the same instance and generation.
        if (result.status === "stale" && room) {
            const fresh = await query(body.viewer_id, room.room_number)
            if (fresh && fresh.identity.instanceId === room.identity.instanceId && fresh.identity.generation === room.identity.generation) {
                room = fresh; commandId = createRoomCommandId()
                result = await getRoomCommandGateway().execute("lobby.select", facts(room), { commandId }) as LobbySelectResult
            }
        }
        if (result.status === "stale" || result.status === "expired") throw new RoomCommandError(
            result.status === "stale" ? "STALE_ROOM_IDENTITY" : "COMMAND_EXPIRED", "Lobby selection was not applied", commandId, false)
        if (result.status === "denied") return send(reply, body.viewer_id, {
            application_update_url: "", category_id: 0, host_entry_time: 0, ip_address: "", port: 0, quest_id: 0,
            raising_state: result.raisingState, room_number: result.roomNumber, room_sequence: 0, share_room_options: 0, is_pickup: null,
        })
        if (result.status === "ready") {
            cacheMultiPlayerContext(body.viewer_id, ctx)
            primeRealPartySnapshot(ctx.playerId)
            return send(reply, body.viewer_id, serializeRoomConnection(result.room))
        }
        throw new RoomCommandError("COMMAND_REJECTED", "Lobby selection was not applied", commandId, false)
    })
}
