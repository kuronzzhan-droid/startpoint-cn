import { incrementActiveMissionPracticeQuestChallengeCountSync } from "../../data/domains/active_mission_counters"
import { QuestCategory } from "../types/quest"

function safeInteger(value: unknown, field: string, minimum: number): number {
    if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) {
        throw new TypeError(`${field} must be a finite integer`)
    }
    if (!Number.isSafeInteger(value) || value < minimum) {
        throw new RangeError(`${field} must be a safe integer of at least ${minimum}`)
    }
    return value
}

export function recordActiveMissionQuestChallengeFactSync(
    playerId: number,
    questCategory: number,
): void {
    const validPlayerId = safeInteger(playerId, "playerId", 1)
    const validCategory = safeInteger(questCategory, "questCategory", 0)
    if (validCategory === QuestCategory.PRACTICE) {
        incrementActiveMissionPracticeQuestChallengeCountSync(validPlayerId)
    }
}
