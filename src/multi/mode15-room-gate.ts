import { canStartMode15QuestSync, isMode15Quest } from "../lib/mode15-optional"
import type { MultiRoom } from "./types"

export interface Mode15RoomGate {
    stage: number | null
    expectedStage: number
    allowed: boolean
}

/**
 * A Mode15 multiplayer room is valid only while its host still expects that
 * exact boss stage. Rescue guests intentionally do not participate in this
 * check: their repeatable-helper rule is separate from ownership of the room.
 */
export function getMode15HostRoomGate(room: Pick<
    MultiRoom,
    "host_player_id" | "category" | "quest_id"
>): Mode15RoomGate | null {
    if (!isMode15Quest(room.category, room.quest_id)) return null
    return canStartMode15QuestSync(
        room.host_player_id,
        room.category,
        room.quest_id,
    )
}

export function isMode15RoomClosed(room: Pick<
    MultiRoom,
    "host_player_id" | "category" | "quest_id"
>): boolean {
    const gate = getMode15HostRoomGate(room)
    return gate !== null && !gate.allowed
}
