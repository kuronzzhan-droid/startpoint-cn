import type { MultiRoom } from "../types"
import { QuestCategory } from "../../lib/types"
import { createRoom, getRoom, getRoomByToken, getRooms, getRoomsHostedBy,
    getRoomAcceptedSeatCount, isRoomWaitingForExpectedMember } from "../room/manager"
import type { RoomPublicState } from "../room/serializer"
import { sessionManager } from "../state/SessionManager"
import { roomAdmissionRegistry } from "../room/admission"
import { captureRoomCommandIdentity, roomCommandIdentityMatches, type RoomCommandIdentity } from "../state/battle-contract"
import { acceptRandomRecruitmentForViewer, isRandomRecruiting, takeRandomRecruitments,
    wasRandomRecruitmentDeliveredTo, wasStoppedRandomRecruitmentDeliveredTo } from "../recruitment"
import { getSelectRoomDenialRaisingState } from "../room/select-denial"
import { embeddedMultiCoordinator } from "./embedded"
import type { RoomCommandContext, RoomCommandExecutor } from "./command-executor"
import { isRealtimeOwnerChild } from "./runtime-role"
import { getPlayerBusinessFacts, refreshRealtimePlayerFacts } from "./business-facts"

export interface LobbyRoomProjection extends RoomPublicState {
    identity: RoomCommandIdentity
    phase: string
    hostOnline: boolean
    occupancy: number
    acceptedSeatCount: number
    returningMember: boolean
    restoreBlocked: boolean
    waitingForExpectedMember: boolean
}
export interface LobbySelectPayload {
    roomNumber: string
    viewerId: number
    identity: RoomCommandIdentity | null
    category: number
    questId: number
    rescueSelection: boolean
    guestAllowed: boolean
    mode15Closed: boolean
    mode15Helper: boolean
    hostNewbie: boolean
}
export interface LobbyRoomPage { rooms: LobbyRoomProjection[]; nextSequence: number | null; throughSequence: number }
export type LobbySelectResult = { status: "ready"; room: LobbyRoomProjection }
    | { status: "denied"; raisingState: number; roomNumber: string }
    | { status: "stale" | "expired" }

function currentViewers(room: MultiRoom): Set<number> {
    const viewers = new Set(room.member_viewer_ids ?? [room.host_viewer_id])
    for (const client of sessionManager.getClientsInRoom(room.room_number, room.lobby_generation)) {
        if (!client.isBattle && !client.socket.destroyed && client.socket.readable && client.socket.writable) viewers.add(client.viewerId)
    }
    return viewers
}
function returning(room: MultiRoom, viewerId: number): boolean {
    return room.host_viewer_id === viewerId || room.expected_real_viewer_ids.includes(viewerId)
        || room.mates.some(mate => mate.viewer_id === viewerId)
}
function project(room: MultiRoom, viewerId: number): LobbyRoomProjection {
    const lifecycle = embeddedMultiCoordinator.ensureLifecycle(room)
    return {
        access_token: room.access_token, category: room.category, host_entry_time: room.host_entry_time,
        host_main_character_id: room.host_main_character_id, host_player_id: room.host_player_id,
        host_viewer_id: room.host_viewer_id, is_npc_mode: room.is_npc_mode, quest_id: room.quest_id,
        raising_state: room.raising_state, room_number: room.room_number,
        share_room_options: room.share_room_options, room_sequence: room.room_sequence, mateCount: room.mates.length,
        identity: { ...captureRoomCommandIdentity(room), version: lifecycle.version }, phase: lifecycle.phase,
        hostOnline: sessionManager.isHostOnline(room.host_viewer_id, room.room_number, room.lobby_generation),
        occupancy: roomAdmissionRegistry.getOccupancy(room.room_number, room.lobby_generation, currentViewers(room)),
        acceptedSeatCount: getRoomAcceptedSeatCount(room), returningMember: returning(room, viewerId),
        restoreBlocked: sessionManager.isRoomRestoreBlocked(room.room_number, viewerId),
        waitingForExpectedMember: isRoomWaitingForExpectedMember(room),
    }
}
function idle(room: MultiRoom): boolean {
    return embeddedMultiCoordinator.ensureLifecycle(room).phase === "LOBBY"
        && !room.settlement_return_pending && !sessionManager.hasRoomConnections(room.room_number)
}
async function cleanupHosted(viewerId: number, context: RoomCommandContext): Promise<number> {
    let removed = 0
    for (const room of getRoomsHostedBy(viewerId)) {
        if (!idle(room)) continue
        const identity = { ...captureRoomCommandIdentity(room), version: room.lifecycle.version }
        await embeddedMultiCoordinator.enqueueRoomCommand(room.room_number, () => {
            if (context.remainingMs() <= 0) throw new Error("Lobby cleanup command expired before mutation")
            const current = getRoom(room.room_number)
            if (!roomCommandIdentityMatches(current, identity) || current!.host_viewer_id !== viewerId || !idle(current!)) return
            if (sessionManager.commitRoomDisband(room.room_number, "host_created_new_room")) removed++
        })
    }
    return removed
}
export function registerLobbyCommandHandlers(executor: RoomCommandExecutor): void {
    executor.register("lobby.query", raw => {
        const p = raw as { roomNumber?: string; accessToken?: string; viewerId: number }
        const room = p.roomNumber ? getRoom(p.roomNumber) : getRoomByToken(p.accessToken || "")
        return room ? project(room, p.viewerId) : null
    })
    executor.register("lobby.list", raw => {
        const p = raw as { categories?: number[]; eventId?: number; viewerId: number; afterSequence?: number; throughSequence?: number; onlyRecruiting?: boolean }
        const categories = p.categories ?? Object.values(QuestCategory).filter((value): value is number => typeof value === "number")
        const all = [...new Set(categories)].flatMap(category => getRooms(category, p.eventId))
            .filter(room => !p.onlyRecruiting || isRandomRecruiting(room.room_number))
        const throughSequence = p.throughSequence ?? all.reduce((max, room) => Math.max(max, room.room_sequence), 0)
        const remaining = all.filter(room => room.room_sequence > (p.afterSequence ?? 0) && room.room_sequence <= throughSequence)
            .sort((a, b) => p.onlyRecruiting ? b.room_sequence - a.room_sequence : a.room_sequence - b.room_sequence)
        const page = remaining.slice(0, 64)
        return { rooms: page.map(room => project(room, p.viewerId)), throughSequence,
            nextSequence: !p.onlyRecruiting && remaining.length > page.length ? page[page.length - 1].room_sequence : null }
    })
    executor.register("lobby.cleanupHosted", (raw, context) => cleanupHosted((raw as { viewerId: number }).viewerId, context))
    executor.register("lobby.create", async (raw, context) => {
        const p = raw as { viewerId: number; playerId: number; partyId: number; category: QuestCategory; questId: number; profileMainCharacterId: number }
        const scope = { category: p.category, questId: p.questId, partyId: p.partyId }
        if (isRealtimeOwnerChild()) await refreshRealtimePlayerFacts(p.playerId, scope)
        const assertHostFacts = () => {
            if (context.remainingMs() <= 0) throw new Error("Lobby create command expired before mutation")
            if (!isRealtimeOwnerChild()) return
            const facts = getPlayerBusinessFacts(p.playerId, scope)
            if (!facts || facts.playerId !== p.playerId || !facts.questPolicy.hostAllowed) throw new Error("LOBBY_HOST_FACTS_UNAVAILABLE")
        }
        // The parent-authenticated viewer/player pair is immutable command input.
        // Refresh through business RPC before deleting old rooms or publishing a new one.
        assertHostFacts()
        await cleanupHosted(p.viewerId, context)
        assertHostFacts()
        const room = createRoom(p.viewerId, p.playerId, p.partyId, p.category, p.questId, 0, p.profileMainCharacterId)
        return project(room, p.viewerId)
    })
    executor.register("lobby.select", (raw, context) => {
        const p = raw as LobbySelectPayload
        return embeddedMultiCoordinator.enqueueRoomCommand<LobbySelectResult>(p.roomNumber, () => {
            if (context.remainingMs() <= 0) return { status: "expired" }
            const room = p.identity ? getRoom(p.roomNumber) : undefined
            if (room && !roomCommandIdentityMatches(room, p.identity!)) return { status: "stale" }
            if (!room) return { status: "denied", raisingState: getSelectRoomDenialRaisingState({ battleStarted: false, roomFull: false }), roomNumber: p.roomNumber }
            const member = returning(room, p.viewerId)
            const randomRescue = !member && p.rescueSelection && wasRandomRecruitmentDeliveredTo(room.room_number, p.viewerId)
            const staleNotice = !member && p.rescueSelection && wasStoppedRandomRecruitmentDeliveredTo(room.room_number, p.viewerId)
                && (room.is_npc_mode || !isRandomRecruiting(room.room_number))
            const battleStarted = !member && ["STARTING", "BATTLE"].includes(embeddedMultiCoordinator.ensureLifecycle(room).phase)
            const waiting = !member && isRoomWaitingForExpectedMember(room)
            const full = !member && getRoomAcceptedSeatCount(room) >= 3
            const unavailable = p.category !== Number(room.category) || p.questId !== room.quest_id || p.mode15Closed
                || (!member && (battleStarted || waiting || full || staleNotice || (p.rescueSelection && !randomRescue) || !p.guestAllowed))
            const blocked = sessionManager.isRoomRestoreBlocked(room.room_number, p.viewerId)
            const capacityDenied = !member && !unavailable && !blocked && !roomAdmissionRegistry.reserve(
                room.room_number, room.lobby_generation, p.viewerId, currentViewers(room), 3, Date.now(), randomRescue ? "rescue" : "direct")
            if (unavailable || blocked || capacityDenied) {
                if (!member) roomAdmissionRegistry.release(room.room_number, p.viewerId)
                return { status: "denied", raisingState: getSelectRoomDenialRaisingState({ battleStarted, roomFull: waiting || full || capacityDenied }), roomNumber: room.room_number }
            }
            if (randomRescue || (!member && p.mode15Helper)) sessionManager.markRescueGuest(room.room_number, p.viewerId, p.hostNewbie, randomRescue)
            if (randomRescue) acceptRandomRecruitmentForViewer(room.room_number, p.viewerId)
            const result = project(room, p.viewerId)
            if (p.viewerId === room.host_viewer_id) result.raising_state = 1
            else if (!result.hostOnline) result.raising_state = 2
            return { status: "ready", room: result }
        })
    })
    executor.register("lobby.attention.take", raw => {
        const p = raw as { viewerId: number; limit: number; eligible: { roomNumber: string; identity: RoomCommandIdentity }[] }
        const eligible = new Map(p.eligible.map(item => [item.roomNumber, item.identity]))
        // The selection and delivery record update run synchronously on the owner.
        return takeRandomRecruitments(p.viewerId, p.limit, recruitment => {
            const room = getRoom(recruitment.roomNumber), identity = eligible.get(recruitment.roomNumber)
            if (!room || !identity || !roomCommandIdentityMatches(room, identity)) return false
            const state = project(room, p.viewerId)
            return room.host_viewer_id !== p.viewerId && !room.is_npc_mode && state.hostOnline
                && !["STARTING", "BATTLE"].includes(state.phase) && !state.waitingForExpectedMember && state.occupancy < 3
        }).map(recruitment => ({ attentionKey: recruitment.attentionKey, room: project(getRoom(recruitment.roomNumber)!, p.viewerId) }))
    })
}
