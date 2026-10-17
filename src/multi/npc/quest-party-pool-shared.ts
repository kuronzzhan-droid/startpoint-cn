import { QuestCategory } from "../../lib/types/quest"

export const QUEST_NPC_POOL_MAX_RECENT = 50
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

/** Each battle/settlement owns its wire roster independently of the live room. */
export function cloneQuestNpcPartySnapshot(
    snapshot: QuestNpcPartySnapshot | undefined,
): QuestNpcPartySnapshot | undefined {
    return snapshot ? { ...snapshot, party: JSON.parse(JSON.stringify(snapshot.party)) } : undefined
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
    // Power remains a selection gate, never a reason to retain an older clear.
    return [...candidates]
        .sort((a, b) => b.clearedAt - a.clearedAt || a.sourcePlayerId - b.sourcePlayerId)
        .slice(0, QUEST_NPC_POOL_MAX_RECENT)
        .map(candidate => candidate.sourcePlayerId)
}
