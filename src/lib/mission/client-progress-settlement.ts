import { getPlayerCategoryMissionsSync, updatePlayerCategoryMissionSync } from "../../data/domains/mission"
import { runImmediateTransactionWithRetry, withPlayerWriteQueue } from "../sqlite-write-coordinator"
import { resolveClientProgressTargets } from "./client-progress"
import { getPlayerCategoryMissionsWithLegacyImportSync } from "./legacy-bridge"
import { addMissionProgressDelta } from "./progress"
import { settleMissionCategories, type MissionSettlementResult } from "./settlement"
import { getMissionFinalTargetProgress } from "./stages"

export interface ClientMissionProgressParam {
    progress_value: number
    mission_pattern: string
}

export interface ClientProgressSettlementResult {
    updatedCount: number
    settlement: MissionSettlementResult
}

function positiveSafeInteger(value: unknown, name: string): number {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
        throw new RangeError(`${name} must be a positive safe integer`)
    }
    return value
}

function validatedParams(rawParams: readonly ClientMissionProgressParam[]): ClientMissionProgressParam[] {
    if (!Array.isArray(rawParams)) throw new TypeError("mission progress params must be an array")
    const result: ClientMissionProgressParam[] = []
    for (let index = 0; index < rawParams.length; index += 1) {
        if (!(index in rawParams)) throw new TypeError("mission progress params must be dense")
        const value = rawParams[index]
        if (!value || typeof value !== "object" || Array.isArray(value)) {
            throw new TypeError("mission progress param must be an object")
        }
        result.push(value)
    }
    return result
}

function safeStoredProgress(value: unknown): number {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
        throw new RangeError("client mission progress must be a non-negative safe integer")
    }
    return value
}

function settleClientProgress(
    playerId: number,
    rawParams: readonly ClientMissionProgressParam[],
    evaluationTime: Date,
): ClientProgressSettlementResult {
    positiveSafeInteger(playerId, "playerId")
    if (!(evaluationTime instanceof Date) || !Number.isFinite(evaluationTime.getTime())) {
        throw new TypeError("evaluationTime must be a valid Date")
    }
    const updates: Array<{ category: number; missionId: number; delta: number }> = []
    for (const param of validatedParams(rawParams)) {
        const delta = addMissionProgressDelta(0, param.progress_value)
        if (typeof param.mission_pattern !== "string" || delta === null) continue
        for (const target of resolveClientProgressTargets(param.mission_pattern, evaluationTime)) {
            updates.push({ category: target.category, missionId: target.missionId, delta })
        }
    }

    const missionIdsByCategory = new Map<number, number[]>()
    for (const update of updates) {
        const missionIds = missionIdsByCategory.get(update.category) ?? []
        missionIds.push(update.missionId)
        missionIdsByCategory.set(update.category, missionIds)
    }
    const categoryMissions = new Map<number, ReturnType<typeof getPlayerCategoryMissionsSync>>()
    for (const [category, missionIds] of missionIdsByCategory) {
        categoryMissions.set(
            category,
            getPlayerCategoryMissionsWithLegacyImportSync(playerId, category, missionIds),
        )
    }

    let updatedCount = 0
    for (const update of updates) {
        const missions = categoryMissions.get(update.category)!
        const current = missions[String(update.missionId)]
        const previousProgress = safeStoredProgress(current?.progress ?? 0)
        const unboundedProgress = addMissionProgressDelta(previousProgress, update.delta)
        if (unboundedProgress === null) throw new RangeError("client mission progress overflow")
        const finalTarget = getMissionFinalTargetProgress(update.category, update.missionId)
        const nextProgress = finalTarget === undefined
            ? unboundedProgress
            : Math.min(unboundedProgress, safeStoredProgress(finalTarget))
        updatePlayerCategoryMissionSync(playerId, update.category, update.missionId, nextProgress)
        missions[String(update.missionId)] = { progress: nextProgress, stages: current?.stages ?? [] }
        updatedCount += 1
    }
    return { updatedCount, settlement: settleMissionCategories(playerId, [5], evaluationTime) }
}

export function settleClientProgressAsync(
    playerId: number,
    params: readonly ClientMissionProgressParam[],
    evaluationTime: Date,
): Promise<ClientProgressSettlementResult> {
    return withPlayerWriteQueue(playerId, () => runImmediateTransactionWithRetry(() =>
        settleClientProgress(playerId, params, evaluationTime)
    ))
}
