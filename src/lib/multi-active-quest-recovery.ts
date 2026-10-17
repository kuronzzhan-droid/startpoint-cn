import type { PlayerActiveQuest } from "../data/types"
import type { MultiRoom } from "./types"
import type { BattleMemberPhase } from "../multi/state/battle-contract"

export interface MultiActiveQuestBinding {
    roomInstanceId: string
    battleSessionId: string
    generation: number
    playId: string
    category: number
    questId: number
    phase: BattleMemberPhase
    current: boolean
}

export type MultiActiveQuestRecoveryReason =
    | "single"
    | "recoverable"
    | "missing_room_number"
    | "room_missing"
    | "room_not_in_battle"
    | "quest_mismatch"
    | "member_not_in_battle"
    | "battle_identity_missing"
    | "battle_identity_mismatch"
    | "result_pending"

export interface MultiActiveQuestRecoveryDecision {
    recoverable: boolean
    reason: MultiActiveQuestRecoveryReason
    /** Preserve a known old play for settlement without advertising gameplay restore. */
    retained?: true
}

/**
 * Only publish a multiplayer unfinished quest when the exact room battle can
 * still accept this viewer. Anything else is an orphan that makes the client
 * retry restore on every login.
 */
export function classifyMultiActiveQuestRecovery(
    quest: Pick<PlayerActiveQuest, "isMulti" | "roomNumber" | "category" | "questId"> & { playId?: string },
    room: MultiRoom | undefined,
    viewerId: number,
    battleSeatRetired = false,
    binding?: MultiActiveQuestBinding | null,
): MultiActiveQuestRecoveryDecision {
    if (!quest.isMulti) return { recoverable: true, reason: "single" }
    if (typeof quest.roomNumber !== "string" || quest.roomNumber.trim().length === 0) {
        return { recoverable: false, reason: "missing_room_number" }
    }
    if (!room) return { recoverable: false, reason: "room_missing" }
    if (binding !== undefined) {
        if (!binding) return { recoverable: false, reason: "battle_identity_missing" }
        if (binding.roomInstanceId !== room.lifecycle?.instanceId || binding.playId !== quest.playId
            || binding.category !== Number(quest.category) || binding.questId !== Number(quest.questId)) {
            return { recoverable: false, reason: "battle_identity_mismatch" }
        }
        if (binding.phase === "RETIRED" || battleSeatRetired) {
            return { recoverable: false, reason: "member_not_in_battle" }
        }
        if (!binding.current || binding.phase === "FINALIZED" || binding.phase === "SETTLED"
            || binding.phase === "RETURNED" || room.lifecycle.phase !== "BATTLE") {
            return { recoverable: false, reason: "result_pending", retained: true }
        }
        if (binding.generation !== room.lobby_generation
            || binding.battleSessionId !== room.lifecycle.battleSessionId) {
            return { recoverable: false, reason: "battle_identity_mismatch" }
        }
    }
    if (room.lifecycle?.phase !== "BATTLE") {
        return { recoverable: false, reason: "room_not_in_battle" }
    }
    if (Number(room.category) !== Number(quest.category)
        || Number(room.quest_id) !== Number(quest.questId)) {
        return { recoverable: false, reason: "quest_mismatch" }
    }
    const expectedViewerIds = room.expected_real_viewer_ids.length > 0
        ? room.expected_real_viewer_ids
        : room.member_viewer_ids
    if (!expectedViewerIds.includes(Number(viewerId))) {
        return { recoverable: false, reason: "member_not_in_battle" }
    }
    if (battleSeatRetired) {
        return { recoverable: false, reason: "member_not_in_battle" }
    }
    return { recoverable: true, reason: "recoverable" }
}
