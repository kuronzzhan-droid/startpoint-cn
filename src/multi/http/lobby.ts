import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify"
import { GetRoomsBody, CreateRoomBody, SearchRoomBody, SelectRoomBody, MultiRoom } from "../types"
import { getPlayerSync } from "../../data/domains/player"
import { getFollowRelationSync } from "../../data/domains/follow"
import { getQuestFromCategorySync } from "../../lib/assets"
import { generateDataHeaders } from "../../utils"
import { getFavoritePartySelectionSync } from "../../lib/profileFavorite"
import { createRoom, getRoom, getRoomAcceptedSeatCount, getRoomByToken, getRooms,
    getRoomsHostedBy, isRoomWaitingForExpectedMember } from "../room/manager"
import { serializeRoom, serializeRoomConnection } from "../room/serializer"
import { isRoomSharedWithPlayer } from "../room/sharing"
import { sessionManager } from "../state/SessionManager"
import {
    acceptRandomRecruitmentForViewer,
    isRandomRecruiting,
    wasRandomRecruitmentDeliveredTo,
    wasStoppedRandomRecruitmentDeliveredTo,
} from "../recruitment"
import { gameVerboseLog } from "../../lib/game-logging"
import { isNewbiePlayerSync } from "../../lib/newbie"
import { canStartMode15QuestSync, isMode15Quest } from "../../lib/mode15-optional"
import { isMode15RoomClosed } from "../mode15-room-gate"
import { roomAdmissionRegistry } from "../room/admission"
import { getSelectRoomDenialRaisingState, SELECT_ROOM_FILLED_STATE } from "../room/select-denial"
import { embeddedMultiCoordinator } from "../coordinator/embedded"
import { cacheMultiPlayerContext, resolveMultiPlayerContext } from "../player-context"
import { primeRealPartySnapshot } from "../party-snapshot"
import { canJoinMultiGuestQuestSync } from "../guest-eligibility"

const ROOM_CAPACITY = 3

function isIdleHostedLobbyRoom(room: MultiRoom): boolean {
    return embeddedMultiCoordinator.ensureLifecycle(room).phase === "LOBBY"
        && !room.settlement_return_pending
        && !sessionManager.hasRoomConnections(room.room_number)
}

/**
 * A host that creates a new room can no longer be using an earlier lobby
 * that has no connection at all (for example a create_room retry, or a
 * room whose socket never connected). Disband those so one viewer cannot
 * accumulate unused rooms. Rooms with any live connection are untouched.
 */
export async function disbandIdleHostedLobbyRooms(hostViewerId: number): Promise<number> {
    let disbanded = 0
    for (const room of getRoomsHostedBy(hostViewerId)) {
        if (!isIdleHostedLobbyRoom(room)) continue
        const roomNumber = room.room_number
        const generation = room.lobby_generation
        await embeddedMultiCoordinator.enqueueRoomCommand(roomNumber, () => {
            if (getRoom(roomNumber) !== room || room.lobby_generation !== generation
                || room.host_viewer_id !== hostViewerId || !isIdleHostedLobbyRoom(room)) return
            if (sessionManager.commitRoomDisband(roomNumber, "host_created_new_room")) disbanded += 1
        }).catch(error => {
            console.error(`[MULTI] idle hosted room cleanup failed: room=${roomNumber}`, error)
        })
    }
    return disbanded
}

function isReturningMember(room: MultiRoom, viewerId: number): boolean {
    return room.host_viewer_id === viewerId
        || room.expected_real_viewer_ids.includes(viewerId)
        || room.mates.some(mate => mate.viewer_id === viewerId)
}

function getCurrentLobbyViewerIds(room: MultiRoom): Set<number> {
    const viewerIds = new Set<number>(room.member_viewer_ids ?? [room.host_viewer_id])
    for (const client of sessionManager.getClientsInRoom(room.room_number, room.lobby_generation)) {
        if (client.isBattle
            || client.socket.destroyed
            || !client.socket.readable
            || !client.socket.writable) continue
        viewerIds.add(client.viewerId)
    }
    return viewerIds
}

function getCurrentLobbyOccupancy(room: MultiRoom): number {
    return roomAdmissionRegistry.getOccupancy(
        room.room_number,
        room.lobby_generation,
        getCurrentLobbyViewerIds(room),
    )
}

function canEnterMode15Room(playerId: number, room: Pick<MultiRoom, "category" | "quest_id">): boolean {
    if (!isMode15Quest(room.category, room.quest_id)) return true
    return canStartMode15QuestSync(playerId, room.category, room.quest_id).allowed
}

function canJoinRoomAsGuest(
    playerId: number,
    player: Parameters<typeof canJoinMultiGuestQuestSync>[3],
    room: Pick<MultiRoom, "category" | "quest_id">,
): boolean {
    return canJoinMultiGuestQuestSync(playerId, room.category, room.quest_id, player).allowed
}

export function registerLobbyRoutes(fastify: FastifyInstance): void {

    // The legacy client posts this telemetry endpoint after handling native
    // create-room error 4507.  A successful empty response is required; a 404
    // is promoted by the client to a fatal H404 screen.
    fastify.post("/create_room_failure", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as { viewer_id?: number }
        const viewerId = Number(body?.viewer_id ?? 0)
        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            data_headers: generateDataHeaders({ viewer_id: Number.isFinite(viewerId) ? viewerId : 0 }),
            data: {},
        })
    })

    fastify.post("/get_rooms", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as GetRoomsBody
        const viewerId = body.viewer_id
        if (!viewerId || isNaN(viewerId)) return reply.status(400).send({
            "error": "Bad Request", "message": "Invalid request body."
        })
        const ctx = await resolveMultiPlayerContext(viewerId)
        if (!ctx) return reply.status(400).send({
            "error": "Bad Request", "message": "Invalid viewer id or no player bound."
        })
        const viewerPlayerId = ctx.playerId

        const requestedCategories = body.category_id === 7 || body.category_id === 8
            ? [7, 8]
            : [body.category_id]
        const rooms = requestedCategories
            .flatMap(categoryId => getRooms(categoryId, body.event_id))
            .filter(r => r.host_viewer_id !== viewerId)
            .filter(r => isRoomSharedWithPlayer(
                r,
                viewerPlayerId,
            ))
            // AI-filled rooms stay visible to viewers who pass the share
            // check, but a roster completed with COM seats is reported as
            // full so the client shows its native "room is full" state
            // instead of attempting an entry that would be rejected.
            .filter(r => !["STARTING", "BATTLE"].includes(embeddedMultiCoordinator.ensureLifecycle(r).phase))
            .filter(r => !isMode15RoomClosed(r))
            .filter(r => sessionManager.isHostOnline(r.host_viewer_id, r.room_number, r.lobby_generation))
            .filter(r => getCurrentLobbyOccupancy(r) < ROOM_CAPACITY)
            // Every non-host entrant to a Mode15 boss room is a helper.  Room
            // code, follow sharing and random recruitment must therefore use
            // the same repeatable rescue gate instead of the helper's own run
            // position.
            .filter(r => canJoinRoomAsGuest(viewerPlayerId, ctx.player, r))
            .map(r => {
                const serialized = serializeRoom(r, viewerPlayerId)
                if (!isReturningMember(r, viewerId)
                    && getRoomAcceptedSeatCount(r) >= ROOM_CAPACITY) {
                    serialized.raising_state = SELECT_ROOM_FILLED_STATE
                }
                return serialized
            })

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({ viewer_id: viewerId }),
            "data": { "rooms": rooms }
        })
    })

    fastify.post("/create_room", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as CreateRoomBody
        const { viewer_id, category, quest_id, party_id } = body
        if (!viewer_id || isNaN(viewer_id)) return reply.status(400).send({
            "error": "Bad Request", "message": "Invalid request body."
        })
        const ctx = await resolveMultiPlayerContext(viewer_id)
        if (!ctx) return reply.status(400).send({
            "error": "Bad Request", "message": "Invalid viewer id or no player bound."
        })

        // Warm the party snapshot while this HTTP request is already doing
        // database work. The subsequent TCP room handshake can then read the
        // complete party from memory instead of blocking the event loop.
        cacheMultiPlayerContext(viewer_id, ctx)
        primeRealPartySnapshot(ctx.playerId)

        const quest = getQuestFromCategorySync(category, quest_id)
        if (!quest) {
            console.warn(`[MULTI] create_room acknowledged as unavailable:`
                + ` viewer=${viewer_id} category=${category} quest=${quest_id}`)
            reply.header("content-type", "application/x-msgpack")
            return reply.status(200).send({
                data_headers: generateDataHeaders({ viewer_id, result_code: 4507 }),
                data: {},
            })
        }

        if (isMode15Quest(category, quest_id)) {
            const gate = canStartMode15QuestSync(ctx.playerId, category, quest_id)
            if (!gate.allowed) {
                // The legacy client treats a non-2xx response as a fatal HTTP
                // error (H409).  Result code 4507 is its native
                // create-room-failure branch, which closes the processing
                // dialog normally while still creating no room.
                console.log(
                    `[MODE15] create_room denied: player=${ctx.playerId} requested=${gate.stage} expected=${gate.expectedStage} result=4507`,
                )
                reply.header("content-type", "application/x-msgpack")
                return reply.status(200).send({
                    data_headers: generateDataHeaders({ viewer_id, result_code: 4507 }),
                    data: {},
                })
            }
        }

        const favorite = getFavoritePartySelectionSync(
            ctx.playerId,
            ctx.player.leaderCharacterId,
        )
        const profileMainCharacterId =
            favorite.characterIds[0] ?? ctx.player.leaderCharacterId ?? 1

        await disbandIdleHostedLobbyRooms(Number(viewer_id))

        const room = createRoom(
            viewer_id,
            ctx.playerId,
            party_id,
            category,
            quest_id,
            0,
            profileMainCharacterId
        )

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({ viewer_id }),
            "data": {
                "access_token": room.access_token,
                "room_number": room.room_number,
                "room_url": ""
            }
        })
    })

    fastify.post("/search_room", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as SearchRoomBody
        const viewerId = body.viewer_id
        if (!viewerId || isNaN(viewerId)) return reply.status(400).send({
            "error": "Bad Request", "message": "Invalid request body."
        })
        const ctx = await resolveMultiPlayerContext(viewerId)
        if (!ctx) return reply.status(400).send({
            "error": "Bad Request", "message": "Invalid viewer id or no player bound."
        })
        const viewerPlayerId = ctx.playerId

        const room = getRoom(body.room_number)
        const returningMember = !!room && isReturningMember(room, viewerId)
        const roomVisible = !!room
            && !isMode15RoomClosed(room)
            && !sessionManager.isRoomRestoreBlocked(room.room_number, viewerId)
            && (returningMember || (
                canJoinRoomAsGuest(viewerPlayerId, ctx.player, room)
                && !["STARTING", "BATTLE"].includes(embeddedMultiCoordinator.ensureLifecycle(room).phase)
                && !isRoomWaitingForExpectedMember(room)
                && getCurrentLobbyOccupancy(room) < ROOM_CAPACITY
            ))
        const followState = roomVisible
            ? getFollowRelationSync(viewerPlayerId, room.host_player_id).state
            : 0
        gameVerboseLog(() =>
            `[MULTI] search_room: viewer=${viewerId} room=${body.room_number}`
            + ` found=${!!room} visible=${roomVisible}`
            + ` category=${room?.category ?? 0} quest=${room?.quest_id ?? 0}`
        )
        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({ viewer_id: viewerId }),
            "data": {
                "room_exists": roomVisible,
                "category_id": roomVisible ? room.category : 0,
                "quest_id": roomVisible ? room.quest_id : 0,
                "room_number": room?.room_number ?? body.room_number,
                "establisher_viewer_id": roomVisible ? room.host_viewer_id : 0,
                "establisher_follow": followState
            }
        })
    })

    fastify.post("/select_room", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as SelectRoomBody
        const viewerId = body.viewer_id
        if (!viewerId || isNaN(viewerId)) return reply.status(400).send({
            "error": "Bad Request", "message": "Invalid request body."
        })
        const ctx = await resolveMultiPlayerContext(viewerId)
        if (!ctx) return reply.status(400).send({
            "error": "Bad Request", "message": "Invalid viewer id or no player bound."
        })

        const room = body.room_number ? getRoom(body.room_number) : getRoomByToken(body.access_token || "")
        const roomQuestMismatch = !!room
            && (room.category !== Number(body.category) || room.quest_id !== Number(body.quest_id))
        const returningMember = !!room && isReturningMember(room, viewerId)
        const rescueSelection = Number(body.accepted_type) === 2
        const randomRescue = !!room
            && !returningMember
            && rescueSelection
            && wasRandomRecruitmentDeliveredTo(room.room_number, viewerId)
        const invalidRescueSelection = !!room
            && !returningMember
            && rescueSelection
            && !randomRescue
        const guestEligibility = room && !returningMember
            ? canJoinMultiGuestQuestSync(ctx.playerId, room.category, room.quest_id, ctx.player)
            : null
        const guestIneligible = guestEligibility?.allowed === false
        const mode15RoomClosed = !!room && isMode15RoomClosed(room)
        // A rescue notice remains visible on the client for roughly 30 seconds.
        // If the host enabled AI or started/stopped recruitment after delivery,
        // reject only that stale notice recipient. Direct room-code entrants are
        // unaffected and may still replace one COM slot normally.
        const staleRescueNotice = !!room
            && !returningMember
            && rescueSelection
            && wasStoppedRandomRecruitmentDeliveredTo(room.room_number, viewerId)
            && (room.is_npc_mode || !isRandomRecruiting(room.room_number))
        const battleStarted = !!room
            && !returningMember
            && ["STARTING", "BATTLE"].includes(embeddedMultiCoordinator.ensureLifecycle(room).phase)
        const waitingForExpectedMember = !!room
            && !returningMember
            && isRoomWaitingForExpectedMember(room)
        // COM seats count as occupied: a room that filled its free seats with
        // AI is full for anyone outside the original party. Only the host,
        // expected members and recorded mates may take a seat back.
        const lobbySeatsFull = !!room
            && !returningMember
            && getRoomAcceptedSeatCount(room) >= ROOM_CAPACITY
        const isUnavailableWithoutCapacity = !!room && (
            roomQuestMismatch
            ||
            mode15RoomClosed
            || (!returningMember && (
                battleStarted
                || waitingForExpectedMember
                || lobbySeatsFull
                || staleRescueNotice
                || invalidRescueSelection
                || guestIneligible
            ))
        )
        const restoreBlocked = !!room && sessionManager.isRoomRestoreBlocked(room.room_number, viewerId)
        const capacityDenied = !!room
            && !returningMember
            && !isUnavailableWithoutCapacity
            && !restoreBlocked
            && !roomAdmissionRegistry.reserve(
                room.room_number,
                room.lobby_generation,
                viewerId,
                getCurrentLobbyViewerIds(room),
                ROOM_CAPACITY,
                Date.now(),
                randomRescue ? "rescue" : "direct",
            )
        if (!room || isUnavailableWithoutCapacity || restoreBlocked || capacityDenied) {
            if (room && !returningMember) {
                roomAdmissionRegistry.release(room.room_number, viewerId)
            }
            if (mode15RoomClosed) {
                console.log(
                    `[MODE15] select_room denied: completed host room=${room?.room_number} viewer=${viewerId}`,
                )
            }
            if (roomQuestMismatch) {
                console.log(
                    `[MULTI] select_room denied before TCP: viewer=${viewerId}`
                    + ` room=${room?.room_number} reason=quest_mismatch`,
                )
            }
            if (capacityDenied) {
                console.log(
                    `[MULTI] select_room denied before TCP: viewer=${viewerId}`
                    + ` room=${room?.room_number} reason=capacity_reserved`,
                )
            }
            if (lobbySeatsFull) {
                console.log(
                    `[MULTI] select_room denied before TCP: viewer=${viewerId}`
                    + ` room=${room?.room_number} reason=room_seats_full`,
                )
            }
            if (guestIneligible) {
                console.log(
                    `[MULTI] guest select denied: viewer=${viewerId}`
                    + ` room=${room?.room_number} category=${room?.category} quest=${room?.quest_id}`
                    + ` source=${rescueSelection ? "rescue" : "direct"}`
                    + ` reason=${guestEligibility?.reason}`
                    + ` rank=${guestEligibility?.playerRank ?? "unknown"}`
                    + ` requiredRank=${guestEligibility?.minimumPlayerRank ?? "none"}`
                    + ` prerequisite=${guestEligibility?.requiredQuestCategories?.join("|") ?? "none"}`
                    + `:${guestEligibility?.requiredQuestId ?? "none"}`
                    + ` requiredItem=${guestEligibility?.requiredItemId ?? "none"}`
                    + ` itemCount=${guestEligibility?.currentItemCount ?? "unknown"}`,
                )
            }
            if (invalidRescueSelection) {
                console.log(
                    `[MULTI] rescue select denied: viewer=${viewerId}`
                    + ` room=${room?.room_number} reason=notice_not_delivered`,
                )
            }
            const denialRaisingState = getSelectRoomDenialRaisingState({
                battleStarted,
                // A disconnected expected member still owns that seat, so the
                // room is full from a new entrant's point of view. The same
                // applies once COM mates occupy the remaining seats.
                roomFull: capacityDenied || waitingForExpectedMember || lobbySeatsFull,
            })
            reply.header("content-type", "application/x-msgpack")
            return reply.status(200).send({
                "data_headers": generateDataHeaders({ viewer_id: viewerId }),
                "data": {
                    application_update_url: "",
                    category_id: 0,
                    host_entry_time: 0,
                    ip_address: "",
                    port: 0,
                    quest_id: 0,
                    raising_state: denialRaisingState,
                    room_number: room?.room_number || body.room_number || "",
                    room_sequence: 0,
                    share_room_options: 0,
                    is_pickup: null
                }
            })
        }

        // select_room is the last HTTP step before the client opens the lobby
        // socket. Make the party snapshot authoritative before that boundary.
        cacheMultiPlayerContext(viewerId, ctx)
        primeRealPartySnapshot(ctx.playerId)

        // A Fantasy room-code/follow entrant is also a helper for lifecycle
        // and progression purposes, but only a delivered rescue selection is
        // eligible for the repeatable fragment reward.
        if (randomRescue || (!returningMember && isMode15Quest(room.category, room.quest_id))) {
            const host = getPlayerSync(room.host_player_id)
            sessionManager.markRescueGuest(
                room.room_number,
                viewerId,
                isNewbiePlayerSync(room.host_player_id, host),
                randomRescue,
            )
        }
        if (randomRescue) acceptRandomRecruitmentForViewer(room.room_number, viewerId)

        const selectData = serializeRoomConnection(room)
        if (viewerId === room.host_viewer_id) {
            selectData.raising_state = 1
            gameVerboseLog(() => `[MULTI] select_room: host override raising_state → 1`)
        } else if (!sessionManager.isHostOnline(room.host_viewer_id, room.room_number, room.lobby_generation)) {
            selectData.raising_state = 2
            gameVerboseLog(() => `[MULTI] select_room: host offline, guest polls raising_state → 2`)
        }

        reply.header("content-type", "application/x-msgpack")
        return reply.status(200).send({
            "data_headers": generateDataHeaders({ viewer_id: viewerId }),
            "data": selectData
        })
    })
}
