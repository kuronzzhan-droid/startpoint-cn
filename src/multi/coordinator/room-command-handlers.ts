import type { MultiRoom } from "../types"
import { getRoom, getRoomByToken, isRoomMember, updateHostEntryTime } from "../room/manager"
import { sessionManager } from "../state/SessionManager"
import { captureRoomCommandIdentity, roomCommandIdentityMatches, type RoomCommandIdentity } from "../state/battle-contract"
import { embeddedMultiCoordinator } from "./embedded"
import type { RoomCommandExecutor, RoomCommandContext } from "./command-executor"
import { isRandomRecruiting, publishRandomRecruitment, stopRandomRecruitment } from "../recruitment"
import { scheduleAiFallback } from "../ai-fill"
import { encodeRoomShareOptions, mergeRoomShareTypes, RANDOM_RECRUITMENT_SHARE_TYPE } from "../room/sharing"

/** HTTP evaluates business facts against this exact, copied projection. */
export interface RoomQueryProjection {
    room_number: string
    category: MultiRoom["category"]
    quest_id: number
    host_viewer_id: number
    host_player_id: number
    host_main_character_id: number
    host_entry_time: number
    identity: RoomCommandIdentity
}
export interface RoomDecisionPayload {
    roomNumber: string
    viewerId: number
    identity: RoomCommandIdentity | null
    mode15Closed: boolean
    category?: number | null
    questId?: number | null
    shareTypes?: number[] | null
}
export interface RoomConnectionState {
    category_id: number
    host_entry_time: number
    quest_id: number
    raising_state: number
    room_number: string
    room_sequence: number
    share_room_options: number
}
export type RoomDecisionResult =
    | { status: "ready"; connection: RoomConnectionState }
    | { status: "summon"; category: MultiRoom["category"]; npcMode: boolean }
    | { status: "done" }
    | { status: "missing" | "stale" | "expired" | "forbidden" | "mode15_closed" | "restore_blocked" | "quest_mismatch" }

function connectionState(room: MultiRoom): RoomConnectionState {
    return {
        category_id: Number(room.category), host_entry_time: room.host_entry_time,
        quest_id: room.quest_id, raising_state: room.raising_state,
        room_number: room.room_number, room_sequence: room.room_sequence,
        share_room_options: room.share_room_options,
    }
}
function projection(room: MultiRoom): RoomQueryProjection {
    return {
        room_number: room.room_number, category: room.category, quest_id: room.quest_id,
        host_viewer_id: room.host_viewer_id, host_player_id: room.host_player_id,
        host_main_character_id: room.host_main_character_id, host_entry_time: room.host_entry_time,
        identity: { ...captureRoomCommandIdentity(room), version: room.lifecycle.version },
    }
}
function decide(payload: RoomDecisionPayload, context: RoomCommandContext,
    operation: (room: MultiRoom) => RoomDecisionResult): Promise<RoomDecisionResult> {
    return embeddedMultiCoordinator.enqueueRoomCommand<RoomDecisionResult>(payload.roomNumber, () => {
        if (context.remainingMs() <= 0) return { status: "expired" }
        // Observing no room never authorizes a newly created instance.
        if (!payload.identity) return { status: "missing" }
        const room = getRoom(payload.roomNumber)
        if (!room) return { status: "missing" }
        if (!roomCommandIdentityMatches(room, payload.identity)) return { status: "stale" }
        return operation(room)
    })
}
function unavailable(room: MultiRoom, payload: RoomDecisionPayload): RoomDecisionResult | null {
    if (payload.mode15Closed) return { status: "mode15_closed" }
    if (sessionManager.isRoomRestoreBlocked(room.room_number, payload.viewerId)) return { status: "restore_blocked" }
    return null
}
function questMismatch(room: MultiRoom, payload: RoomDecisionPayload): boolean {
    return payload.category !== Number(room.category) || payload.questId !== room.quest_id
}

export function registerRoomCommandHandlers(executor: RoomCommandExecutor): void {
    executor.register("room.query", raw => {
        const lookup = raw as { roomNumber?: string; accessToken?: string }
        // This pure read and its projection are one owner-local synchronous
        // operation. Queuing another lookup could silently retarget a request
        // to a replacement instance before its mutation captures the fence.
        const room = lookup.roomNumber ? getRoom(lookup.roomNumber) : getRoomByToken(lookup.accessToken || "")
        return room ? projection(room) : null
    })
    executor.register("room.prepare", (raw, context) => {
        const payload = raw as RoomDecisionPayload
        return decide(payload, context, room => {
            const denied = unavailable(room, payload)
            if (denied) return denied
            if (questMismatch(room, payload)) return { status: "quest_mismatch" }
            if (payload.viewerId === room.host_viewer_id) updateHostEntryTime(room.room_number)
            const connection = connectionState(room)
            if (payload.viewerId === room.host_viewer_id) connection.raising_state = 1
            else if (!sessionManager.isHostOnline(room.host_viewer_id, room.room_number, room.lobby_generation)) connection.raising_state = 2
            return { status: "ready", connection }
        })
    })
    executor.register("room.restore", (raw, context) => {
        const payload = raw as RoomDecisionPayload
        return decide(payload, context, room => {
            const denied = unavailable(room, payload)
            if (denied) return denied
            const connection = connectionState(room)
            if (!isRoomMember(room, payload.viewerId)) connection.raising_state = 13
            else if (room.lifecycle.phase !== "BATTLE") {
                if (payload.viewerId === room.host_viewer_id) connection.raising_state = 1
                else if (!sessionManager.isHostOnline(room.host_viewer_id, room.room_number, room.lobby_generation)) connection.raising_state = 2
            }
            return { status: "ready", connection }
        })
    })
    executor.register("room.summon", (raw, context) => {
        const payload = raw as RoomDecisionPayload
        return decide(payload, context, room => {
            const denied = unavailable(room, payload)
            if (denied) return denied
            if (payload.viewerId !== room.host_viewer_id) return { status: "forbidden" }
            if (questMismatch(room, payload)) return { status: "quest_mismatch" }
            return { status: "summon", category: room.category, npcMode: room.is_npc_mode }
        })
    })
    executor.register("room.share", (raw, context) => {
        const payload = raw as RoomDecisionPayload
        return decide(payload, context, room => {
            if (payload.viewerId !== room.host_viewer_id) return { status: "forbidden" }
            if ((payload.category !== undefined && payload.category !== Number(room.category))
                || (payload.questId !== undefined && payload.questId !== room.quest_id)) return { status: "quest_mismatch" }
            if (payload.mode15Closed) {
                stopRandomRecruitment(room.room_number)
                return { status: "mode15_closed" }
            }
            const types = mergeRoomShareTypes(room.share_room_options, payload.shareTypes)
            room.share_room_options = encodeRoomShareOptions(types)
            if (types.includes(RANDOM_RECRUITMENT_SHARE_TYPE) && !room.is_npc_mode) {
                const wasRecruiting = isRandomRecruiting(room.room_number)
                publishRandomRecruitment(room.room_number)
                if (!wasRecruiting) scheduleAiFallback(room.room_number)
            }
            return { status: "done" }
        })
    })
    executor.register("room.disband", (raw, context) => {
        const payload = raw as RoomDecisionPayload
        return decide(payload, context, room => {
            if (payload.viewerId !== room.host_viewer_id) return { status: "forbidden" }
            if (!sessionManager.commitRoomDisband(room.room_number, `viewer_${payload.viewerId}_requested`)) return { status: "stale" }
            return { status: "done" }
        })
    })
}
