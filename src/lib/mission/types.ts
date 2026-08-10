// Mission computer core types

import type { Player, PlayerCharacter, RawPlayerQuestProgress } from "../../data/types"
import type { MissionBattleCounters } from "../../data/domains/mission_battle_facts"
import type { SnapshotData } from "./snapshot"

export interface PlayerQuestProgressEntry {
    questId: number
    finished: boolean
    clearRank: number | null | undefined
    bestElapsedTimeMs: number | undefined
    leaderCharacterId: number | undefined
    multiClearCount: number | undefined
}

/** Per-category pre-computed context — built once, read many times */
export interface CategoryContext {
    playerId: number
    category: number
    player: Player
    questProgress: Record<string, PlayerQuestProgressEntry[]>
    totalQuestClears: number
    totalStories: number
    rankCounts: Record<string, number>
    activeMissionProgress?: Record<string, number>
    collectedItemTotals?: Record<string, number>
    degreeStats?: {
        companionCount: number
        maxCharacterLevel: number
        overLimitCount: number
        manaBoardCount: number
        secondManaBoardCompleteCount: number
        bondTokenCount: number
        singleSsCount: number
        multiClearCount: number
        multiHostClearCount: number
        episodeClearCount: number
        level100BondedCharacterIds: ReadonlySet<number>
        completedSecondManaBoardCharacterIds: ReadonlySet<number>
    }
    battleCounters?: MissionBattleCounters
    snapshot?: SnapshotData | null
    passEventLoginProgress?: Record<number, number>
}

/** A mission computer handles one or more categories */
export interface MissionComputer {
    readonly name: string

    /**
     * Build pre-cached context for this category.
     * Prefer loading shared category data here so repeated mission evaluation stays cheap.
     */
    buildContext(
        playerId: number,
        category: number,
        evaluationTime?: Date,
        missionIds?: readonly number[],
    ): CategoryContext

    /**
     * Compute progress for a single mission.
     * Keep this read-only: calculators may read fresh counter state, but must not mutate progress.
     */
    compute(missionId: number, ctx: CategoryContext, dbProgress: number): number
}

export type ComputerRegistry = Map<number, MissionComputer>
