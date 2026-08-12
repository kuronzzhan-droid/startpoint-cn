import {
    getPlayerCategoryMissionsSync,
    updatePlayerCategoryMissionStageSync,
    updatePlayerCategoryMissionSync,
} from "../../data/domains/mission"
import { getPlayerSync } from "../../data/domains/player"
import { getDb } from "../../data/db"
import { runImmediateTransactionWithRetry, withPlayerWriteQueue } from "../sqlite-write-coordinator"
import { MissionRewardGranter } from "./grants"
import {
    getMissionMasterDefinition,
    isMissionDefinitionEnabledAt,
} from "./master-data"
import { getComputer } from "./registry"
import { getCategoryMissionRewardStageDefinition } from "./rewards"
import {
    getCompletedStageNumbers,
    getMissionFinalTargetProgress,
    getMissionIdsByCategory,
    isMissionProgressComplete,
} from "./stages"

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

export interface MissionSettlementScope {
    category: number
    eventId?: number
    missionIds?: readonly number[]
}

interface EvaluatedMission {
    category: number
    missionId: number
    pattern: string
    progress: number
    receivedStages: Record<string, boolean> | unknown[]
    dbProgress: number
}

function positiveSafeInteger(value: unknown, name: string): number {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new TypeError(`${name} must be a finite number`)
    }
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new RangeError(`${name} must be a positive safe integer`)
    }
    return value
}

function finiteProgress(value: unknown, name: string): number {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new TypeError(`${name} must be a finite number`)
    }
    if (value < 0) throw new RangeError(`${name} must be non-negative`)
    return value
}

function normalizedScopes(
    categories: readonly (number | MissionSettlementScope)[],
): MissionSettlementScope[] {
    if (!Array.isArray(categories)) throw new TypeError("mission settlement scopes must be an array")
    const result = new Map<string, MissionSettlementScope>()
    for (let index = 0; index < categories.length; index += 1) {
        if (!(index in categories)) throw new TypeError("mission settlement scopes must be dense")
        const raw = categories[index]
        if (typeof raw !== "number"
            && (!raw || typeof raw !== "object" || Array.isArray(raw))) {
            throw new TypeError("mission settlement scope must be a category or object")
        }
        const category = positiveSafeInteger(typeof raw === "number" ? raw : raw.category, "category")
        const eventId = typeof raw === "number" || raw.eventId === undefined
            ? undefined
            : positiveSafeInteger(raw.eventId, "eventId")
        let missionIds: number[] | undefined
        if (typeof raw !== "number" && raw.missionIds !== undefined) {
            const rawMissionIds = raw.missionIds
            if (!Array.isArray(rawMissionIds)) throw new TypeError("missionIds must be an array")
            missionIds = []
            for (let missionIndex = 0; missionIndex < rawMissionIds.length; missionIndex += 1) {
                if (!(missionIndex in rawMissionIds)) throw new TypeError("missionIds must be dense")
                missionIds.push(positiveSafeInteger(rawMissionIds[missionIndex], "missionId"))
            }
        }
        const key = `${category}:${eventId ?? ""}`
        const scope = { category, ...(eventId === undefined ? {} : { eventId }), ...(missionIds ? { missionIds } : {}) }
        const previous = result.get(key)
        if (!previous) {
            result.set(key, scope)
        } else if (previous.missionIds !== undefined || missionIds !== undefined) {
            result.set(key, {
                ...scope,
                missionIds: [...new Set([...(previous.missionIds ?? []), ...(missionIds ?? [])])],
            })
        }
    }
    return [...result.values()]
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
    const completedCoreCount = dailyMissions.filter(mission =>
        isDailyCoreMission(mission.pattern)
        && isMissionProgressComplete(2, mission.missionId, mission.progress)
    ).length
    for (const mission of dailyMissions) {
        if (!mission.pattern.startsWith("daily_quest_all_clear")) continue
        mission.progress = Math.max(mission.dbProgress, completedCoreCount)
    }
}

function evaluateMissionCategories(
    playerId: number,
    categories: readonly (number | MissionSettlementScope)[],
    evaluationTime: Date,
) {
    positiveSafeInteger(playerId, "playerId")
    if (!(evaluationTime instanceof Date) || !Number.isFinite(evaluationTime.getTime())) {
        throw new TypeError("evaluationTime must be a valid Date")
    }
    const player = getPlayerSync(playerId)
    if (!player) throw new Error(`Player ${playerId} not found during mission settlement.`)

    const evaluatedMissions: EvaluatedMission[] = []
    const evaluatedMissionKeys = new Set<string>()
    for (const scope of normalizedScopes(categories)) {
        const candidateMissionIds = scope.missionIds ?? getMissionIdsByCategory(scope.category)
        if (candidateMissionIds.length === 0) continue
        const computer = getComputer(scope.category)
        const context = computer.buildContext(playerId, scope.category, evaluationTime, candidateMissionIds)
        const persisted = getPlayerCategoryMissionsSync(playerId, scope.category)
        for (const missionId of candidateMissionIds) {
            const definition = getMissionMasterDefinition(scope.category, missionId)
            if (!definition || !isMissionDefinitionEnabledAt(definition, evaluationTime, scope.eventId)) continue
            const missionKey = `${scope.category}:${missionId}`
            if (evaluatedMissionKeys.has(missionKey)) continue
            evaluatedMissionKeys.add(missionKey)
            const current = persisted[String(missionId)]
            const dbProgress = finiteProgress(current?.progress ?? 0, "stored mission progress")
            const computed = finiteProgress(
                computer.compute(missionId, context, dbProgress),
                `computed mission ${missionKey} progress`,
            )
            const finalTarget = getMissionFinalTargetProgress(scope.category, missionId)
            if (finalTarget !== undefined) finiteProgress(finalTarget, `mission ${missionKey} final target`)
            const monotonicProgress = Math.max(dbProgress, computed)
            evaluatedMissions.push({
                category: scope.category,
                missionId,
                pattern: definition.pattern,
                progress: finalTarget === undefined
                    ? monotonicProgress
                    : scope.category === 2
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

function persistMissionEvaluation(
    playerId: number,
    evaluation: ReturnType<typeof evaluateMissionCategories>,
): MissionSettlementResult {
    const granter = new MissionRewardGranter(playerId, evaluation.player)
    const missionInfo: MissionSettlementInfo[] = []
    for (const mission of evaluation.evaluatedMissions) {
        if (mission.progress !== mission.dbProgress) {
            updatePlayerCategoryMissionSync(playerId, mission.category, mission.missionId, mission.progress)
        }
    }

    for (const mission of evaluation.evaluatedMissions) {
        for (const stage of getCompletedStageNumbers(mission.category, mission.missionId, mission.progress)) {
            const definition = getCategoryMissionRewardStageDefinition(mission.category, mission.missionId, stage)
            if (!definition) {
                throw new Error(`Mission reward definition ${mission.category}:${mission.missionId}:${stage} is missing.`)
            }
            if (!Array.isArray(mission.receivedStages)
                && mission.receivedStages[String(stage)] === true) {
                if (mission.category === 5) {
                    for (const reward of definition.rewards) {
                        if (reward.kind === 6 && reward.degreeId !== undefined) {
                            granter.grantDegreeOwnershipOnly(reward.degreeId)
                        }
                    }
                }
                continue
            }
            updatePlayerCategoryMissionStageSync(playerId, mission.category, stage, mission.missionId, true)
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

export function settleMissionCategories(
    playerId: number,
    categories: readonly (number | MissionSettlementScope)[],
    evaluationTime: Date,
): MissionSettlementResult {
    return getDb().transaction(() => persistMissionEvaluation(
        playerId,
        evaluateMissionCategories(playerId, categories, evaluationTime),
    ))()
}

export async function settleMissionCategoriesAsync(
    playerId: number,
    categories: readonly (number | MissionSettlementScope)[],
    evaluationTime: Date,
): Promise<MissionSettlementResult> {
    return withPlayerWriteQueue(playerId, () => runImmediateTransactionWithRetry(() =>
        persistMissionEvaluation(playerId, evaluateMissionCategories(playerId, categories, evaluationTime))
    ))
}
