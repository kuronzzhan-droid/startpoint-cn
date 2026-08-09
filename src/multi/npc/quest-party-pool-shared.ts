import { QuestCategory } from "../../lib/types/quest"

export const QUEST_NPC_POOL_MAX_POWER = 30
export const QUEST_NPC_POOL_MAX_RECENT = 20
export const QUEST_NPC_POOL_MIN_POWER = 8_000

const ELIGIBLE_QUEST_CATEGORIES = new Set<number>([
    QuestCategory.BOSS_BATTLE,
    QuestCategory.ADVENT_EVENT_SINGLE,
    QuestCategory.ADVENT_EVENT_MULTI,
    QuestCategory.WORLD_STORY_EVENT_BOSS_BATTLE,
    QuestCategory.HARD_MULTI_EVENT,
])

export interface QuestNpcPartySnapshot {
    questCategory: number
    questId: number
    sourcePlayerId: number
    partySlot: number
    battlePower: number
    partyElement: number | null
    clearedAt: number
    party: any
}

export interface QuestNpcPartyRankCandidate {
    sourcePlayerId: number
    battlePower: number
    clearedAt: number
}

export function isQuestNpcPartyPoolEligibleCategory(category: number): boolean {
    return ELIGIBLE_QUEST_CATEGORIES.has(Number(category))
}

export function getQuestNpcPartyPoolKey(category: number, questId: number): string {
    return `${Number(category)}:${Number(questId)}`
}

export function selectQuestNpcPartySourceIds(
    candidates: readonly QuestNpcPartyRankCandidate[],
): number[] {
    const top = [...candidates]
        .sort((a, b) => b.battlePower - a.battlePower || b.clearedAt - a.clearedAt)
        .slice(0, QUEST_NPC_POOL_MAX_POWER)
    const keep = new Set(top.map(candidate => candidate.sourcePlayerId))
    const recent = candidates
        .filter(candidate => !keep.has(candidate.sourcePlayerId))
        .sort((a, b) => b.clearedAt - a.clearedAt)
        .slice(0, QUEST_NPC_POOL_MAX_RECENT)
    for (const candidate of recent) keep.add(candidate.sourcePlayerId)
    return [...keep]
}
