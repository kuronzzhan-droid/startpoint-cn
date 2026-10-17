import { isRealtimeOwnerChild } from "./coordinator/runtime-role"
import { getPlayerBusinessFacts, getQuestBusinessClassification } from "./coordinator/business-facts"
import type { MultiRoom } from "./types"

export interface Mode15RoomGate {
    stage: number | null
    expectedStage: number
    allowed: boolean
    unknown?: boolean
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
    if (isRealtimeOwnerChild()) {
        if (getQuestBusinessClassification(room.category, room.quest_id) === false) return null
        const facts = getPlayerBusinessFacts(room.host_player_id, { category: room.category, questId: room.quest_id })
        if (!facts) return { stage: null, expectedStage: 0, allowed: false, unknown: true }
        return facts.questPolicy.isMode15 ? { stage: null, expectedStage: 0, allowed: facts.questPolicy.hostAllowed } : null
    }
    const mode = require("../lib/mode15-optional") as typeof import("../lib/mode15-optional")
    if (!mode.isMode15Quest(room.category, room.quest_id)) return null
    return mode.canStartMode15QuestSync(
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
    return gate !== null && !gate.allowed && gate.unknown !== true
}
