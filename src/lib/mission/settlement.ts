import {
    getPlayerCategoryMissionsForCategoriesSync,
    getPlayerCategoryMissionsForScopesSync,
    updatePlayerCategoryMissionBatchSync,
    updatePlayerCategoryMissionStageBatchSync,
} from "../../data/domains/mission"
import type { Player } from "../../data/types"
import { getPlayerDegreeIdsSync } from "../../data/domains/degree"
import { getComputer } from "./registry"
import { getCategoryMissionRewardStageDefinition } from "./rewards"
import { getCompletedStageNumbers, getMissionFinalTargetProgress, getMissionIdsByCategory, isMissionProgressComplete } from "./stages"
import { getMissionPattern, isMissionEnabledAt } from "./patterns"
import { isClientProgressMissionPattern } from "./client-progress"
import { MissionRewardGranter } from "./grants"
import { getMissionMasterDefinition } from "./master-data"
import { runPersistenceTransaction, runPersistenceTransactionSync, runWriterCommand } from "../persistence-coordinator"
import { MISSION_SETTLE_CATEGORIES, type MissionSettleCategoriesArgs } from "../persistence/command-names"
import { MissionEvaluationReadContext } from "./evaluation-context"

export interface MissionSettlementInfo {
    mission_category_id: number
    mission_id: number
    mission_reward_id: number
}

export interface MissionSettlementResult {
    missionInfo: MissionSettlementInfo[]
    itemList: Record<string, number>
    characterList: Object[]
    equipmentList: Object[]
    degreeIds: number[]
    passCardPoints: Record<string, number>
    userInfo?: Record<string, number>
}

export interface MissionSettlementProgress {
    readonly category: number
    readonly missionId: number
    readonly progress: number
}

export interface MissionSettlementWithProgressResult {
    readonly settlement: MissionSettlementResult
    readonly evaluatedProgress: readonly MissionSettlementProgress[]
}

export interface MissionSettlementScope {
    category: number
    eventId?: number
    /** Restrict evaluation to missions that this mutation can affect. */
    missionIds?: readonly number[]
}

interface EvaluatedMission {
    category: number
    missionId: number
    progress: number
    receivedStages: Record<string, boolean> | unknown[]
    dbProgress: number
}

interface PendingMissionReward {
    readonly mission: EvaluatedMission
    readonly stage: number
    readonly definition: NonNullable<ReturnType<typeof getCategoryMissionRewardStageDefinition>>
}

interface PreparedMissionPersistence {
    readonly progressUpdates: EvaluatedMission[]
    readonly pendingRewards: PendingMissionReward[]
    readonly missingLegacyDegreeIds: number[]
}

function isDailyCoreMission(pattern: string): boolean {
    return /^single_battle_play(?:_[23])?$/.test(pattern)
        || /^multi_battle_play(?:_[23])?$/.test(pattern)
        || /^use_dash(?:_[23])?$/.test(pattern)
        || pattern === "daily_quest_stamina_use_2024_02"
}

function applyDailyCompletionProgress(missions: EvaluatedMission[]): void {
    const dailyMissions = missions.filter(mission => mission.category === 2)
    if (dailyMissions.length === 0) return

    const completedCoreCount = dailyMissions.filter(mission => {
        const pattern = getMissionPattern(2, mission.missionId)
        return isDailyCoreMission(pattern)
            && isMissionProgressComplete(2, mission.missionId, mission.progress)
    }).length

    for (const mission of dailyMissions) {
        if (!getMissionPattern(2, mission.missionId).startsWith("daily_quest_all_clear")) continue
        mission.progress = Math.max(mission.dbProgress, completedCoreCount)
    }
}

function evaluateMissionCategories(
    playerId: number,
    categories: readonly (number | MissionSettlementScope)[],
    evaluationTime: Date,
): { player: Player, evaluatedMissions: EvaluatedMission[] } {
    const evaluatedMissions: EvaluatedMission[] = []
    const evaluatedMissionKeys = new Set<string>()
    const scopes = new Map<string, MissionSettlementScope>()
    for (const entry of categories) {
        const scope = typeof entry === "number" ? { category: entry } : entry
        scopes.set(`${scope.category}:${scope.eventId ?? ""}`, scope)
    }
    const preparedScopes = [...scopes.values()].map(scope => ({
        scope,
        candidateMissionIds: scope.missionIds ?? getMissionIdsByCategory(scope.category),
    })).filter(entry => entry.candidateMissionIds.length > 0)
    const persistedByCategory = /^(0|false|no|off)$/i.test(process.env.MISSION_SCOPED_READS ?? "true")
        ? getPlayerCategoryMissionsForCategoriesSync(playerId, preparedScopes.map(entry => entry.scope.category))
        : getPlayerCategoryMissionsForScopesSync(playerId, preparedScopes.map(entry => ({
            category: entry.scope.category, missionIds: entry.candidateMissionIds,
        })))
    const readContext = new MissionEvaluationReadContext(playerId)
    const player = readContext.player

    for (const { scope, candidateMissionIds } of preparedScopes) {
        const { category, eventId } = scope
        const computer = getComputer(category)
        const persisted = persistedByCategory[String(category)] ?? {}
        // Title progress is monotonic and capped at its final target. Completed
        // titles need no fact scan, but still enter persistence preparation so
        // unreceived stages and missing legacy degree ownership can be repaired.
        const factMissionIds = category === 5 ? candidateMissionIds.filter(missionId => {
            if (!isMissionEnabledAt(category, missionId, evaluationTime, eventId)) return false
            const target = getMissionFinalTargetProgress(category, missionId)
            return target === undefined || (persisted[String(missionId)]?.progress ?? 0) < target
        }) : candidateMissionIds
        const factMissionIdSet = new Set(factMissionIds)
        const context = factMissionIds.length > 0 ? computer.buildContext(
            playerId,
            category,
            evaluationTime,
            factMissionIds,
            readContext,
        ) : undefined
        for (const missionId of candidateMissionIds) {
            if (!isMissionEnabledAt(category, missionId, evaluationTime, eventId)) continue
            const missionKey = `${category}:${missionId}`
            if (evaluatedMissionKeys.has(missionKey)) continue
            evaluatedMissionKeys.add(missionKey)
            const current = persisted[String(missionId)]
            const dbProgress = current?.progress ?? 0
            const computed = context && factMissionIdSet.has(missionId)
                ? computer.compute(missionId, context, dbProgress) : dbProgress
            const finalTarget = getMissionFinalTargetProgress(category, missionId)
            const monotonicProgress = Math.max(0, dbProgress, Number.isFinite(computed) ? computed : 0)
            evaluatedMissions.push({
                category,
                missionId,
                progress: finalTarget === undefined
                    ? monotonicProgress
                    : category === 2 || isClientProgressMissionPattern(getMissionPattern(category, missionId))
                        ? Math.max(dbProgress, Math.min(monotonicProgress, finalTarget))
                        : Math.min(monotonicProgress, finalTarget),
                receivedStages: current?.stages ?? [],
                dbProgress,
            })
        }
    }
    applyDailyCompletionProgress(evaluatedMissions)
    return { player, evaluatedMissions }
}

function emptyMissionSettlementResult(): MissionSettlementResult {
    return {
        missionInfo: [],
        itemList: {},
        characterList: [],
        equipmentList: [],
        degreeIds: [],
        passCardPoints: {},
    }
}

function prepareMissionPersistence(
    playerId: number,
    evaluatedMissions: EvaluatedMission[],
): PreparedMissionPersistence {
    const progressUpdates = evaluatedMissions.filter(mission => mission.progress !== mission.dbProgress)
    const pendingRewards: PendingMissionReward[] = []
    const legacyDegreeIds = new Set<number>()
    for (const mission of evaluatedMissions) {
        for (const stage of getCompletedStageNumbers(mission.category, mission.missionId, mission.progress)) {
            const definition = getCategoryMissionRewardStageDefinition(mission.category, mission.missionId, stage)
            if (!definition) continue
            if (!Array.isArray(mission.receivedStages)
                && mission.receivedStages[String(stage)] === true) {
                if (mission.category === 5) {
                    for (const reward of definition.rewards) {
                        if (reward.kind === 6 && reward.degreeId !== undefined) {
                            legacyDegreeIds.add(reward.degreeId)
                        }
                    }
                }
                continue
            }
            pendingRewards.push({ mission, stage, definition })
        }
    }
    const ownedDegrees = legacyDegreeIds.size > 0
        ? new Set(getPlayerDegreeIdsSync(playerId))
        : new Set<number>()
    return {
        progressUpdates,
        pendingRewards,
        missingLegacyDegreeIds: [...legacyDegreeIds].filter(degreeId => !ownedDegrees.has(degreeId)),
    }
}

function persistMissionEvaluation(
    playerId: number,
    player: Player,
    prepared: PreparedMissionPersistence,
): MissionSettlementResult {
    const granter = new MissionRewardGranter(playerId, player)
    const missionInfo: MissionSettlementInfo[] = []
    updatePlayerCategoryMissionBatchSync(
        playerId,
        prepared.progressUpdates
            .map(mission => ({
                category: mission.category,
                missionId: mission.missionId,
                progress: mission.progress,
            })),
    )
    for (const degreeId of prepared.missingLegacyDegreeIds) {
        granter.grantDegreeOwnershipOnly(degreeId)
    }
    updatePlayerCategoryMissionStageBatchSync(
        playerId,
        prepared.pendingRewards.map(({ mission, stage }) => ({
            category: mission.category,
            missionId: mission.missionId,
            stageId: stage,
            status: true,
        })),
    )
    for (const { mission, definition } of prepared.pendingRewards) {
        const passCardEventId = mission.category >= 6 && mission.category <= 8
            ? getMissionMasterDefinition(mission.category, mission.missionId)?.eventId
            : undefined
        granter.grant(definition.rewards, { passCardEventId })
        missionInfo.push({
            mission_category_id: mission.category,
            mission_id: mission.missionId,
            mission_reward_id: definition.missionRewardId,
        })
    }
    granter.persistPlayer()
    return {
        missionInfo,
        itemList: granter.itemList,
        characterList: granter.characterList,
        equipmentList: granter.equipmentList,
        degreeIds: granter.degreeList,
        passCardPoints: granter.passCardPoints,
        ...(granter.hasPlayerChanges() ? { userInfo: granter.getUserInfo() } : {}),
    }
}

function evaluatedProgressOf(evaluatedMissions: readonly EvaluatedMission[]): MissionSettlementProgress[] {
    return evaluatedMissions.map(mission => ({
        category: mission.category,
        missionId: mission.missionId,
        progress: mission.progress,
    }))
}

export function settleMissionCategoriesWithProgress(
    playerId: number,
    categories: readonly (number | MissionSettlementScope)[],
    evaluationTime: Date,
): MissionSettlementWithProgressResult {
    const evaluation = evaluateMissionCategories(playerId, categories, evaluationTime)
    const prepared = prepareMissionPersistence(playerId, evaluation.evaluatedMissions)
    const settlement = prepared.progressUpdates.length === 0
        && prepared.pendingRewards.length === 0
        && prepared.missingLegacyDegreeIds.length === 0
        ? emptyMissionSettlementResult()
        : runPersistenceTransactionSync({
            domain: "mission", playerId, operation: "settle_categories_sync",
        }, () => persistMissionEvaluation(
            playerId,
            evaluation.player,
            prepared,
        ))
    return {
        settlement,
        evaluatedProgress: evaluatedProgressOf(evaluation.evaluatedMissions),
    }
}

export function settleMissionCategories(
    playerId: number,
    categories: readonly (number | MissionSettlementScope)[],
    evaluationTime: Date,
): MissionSettlementResult {
    return settleMissionCategoriesWithProgress(playerId, categories, evaluationTime).settlement
}

export async function settleMissionCategoriesAsync(
    playerId: number,
    categories: readonly (number | MissionSettlementScope)[],
    evaluationTime: Date,
): Promise<MissionSettlementResult> {
    // The whole settlement (context scan plus persistence) is a registered
    // command so it can run inside the SQLite writer thread without holding the
    // main event loop. With the writer disabled the same registry entry runs
    // in-process and keeps the previous behaviour.
    return runWriterCommand<MissionSettleCategoriesArgs, MissionSettlementResult>(
        MISSION_SETTLE_CATEGORIES,
        {
            playerId,
            categories: [...categories],
            evaluationTimeMs: evaluationTime.getTime(),
        },
        { domain: "mission", playerId, operation: "settle_categories" },
    )
}
