import type { PlayerActiveMission } from "../../data/types"
import {
    getPlayerActiveMissionsSync,
    getPlayerCategoryMissionsSync,
    updatePlayerCategoryMissionStageSync,
    updatePlayerCategoryMissionSync,
} from "../../data/domains/mission"
import { getMissionStageIds } from "./stages"

function positiveSafeInteger(value: unknown, name: string): number {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
        throw new RangeError(`${name} must be a positive safe integer`)
    }
    return value
}

function finiteProgress(value: unknown): number {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new TypeError("legacy mission progress must be finite")
    }
    if (value < 0) throw new RangeError("legacy mission progress must be non-negative")
    return value
}

function importLegacyStages(
    playerId: number,
    category: number,
    missionId: number,
    stages: PlayerActiveMission["stages"],
): void {
    if (Array.isArray(stages)) {
        if (stages.length !== 0) throw new TypeError("legacy mission stage array must be empty")
        return
    }
    const allowedStages = new Set(getMissionStageIds(category, missionId))
    for (const [stage, received] of Object.entries(stages)) {
        if (typeof received !== "boolean") throw new TypeError("legacy mission stage status must be boolean")
        if (!received) continue
        const stageId = Number(stage)
        if (!Number.isSafeInteger(stageId) || stageId <= 0 || String(stageId) !== stage) {
            throw new Error(`Legacy mission stage ${missionId}:${stage} is not canonical.`)
        }
        if (!allowedStages.has(stageId)) {
            throw new Error(`Legacy mission stage ${category}:${missionId}:${stage} is unknown.`)
        }
        updatePlayerCategoryMissionStageSync(playerId, category, stageId, missionId, true)
    }
}

/** Import requested legacy rows into one category without deleting the legacy source. */
export function getPlayerCategoryMissionsWithLegacyImportSync(
    playerId: number,
    category: number,
    rawMissionIds: readonly number[],
): Record<string, PlayerActiveMission> {
    positiveSafeInteger(playerId, "playerId")
    positiveSafeInteger(category, "category")
    if (!Array.isArray(rawMissionIds)) throw new TypeError("missionIds must be an array")
    const missionIds: number[] = []
    for (let index = 0; index < rawMissionIds.length; index += 1) {
        if (!(index in rawMissionIds)) throw new TypeError("missionIds must be dense")
        missionIds.push(positiveSafeInteger(rawMissionIds[index], "missionId"))
    }

    const categoryMissions = getPlayerCategoryMissionsSync(playerId, category)
    const missing = [...new Set(missionIds)].filter(missionId => categoryMissions[String(missionId)] === undefined)
    if (missing.length === 0) return categoryMissions
    const legacyMissions = getPlayerActiveMissionsSync(playerId)
    for (const missionId of missing) {
        const legacy = legacyMissions[String(missionId)]
        if (!legacy) continue
        const progress = finiteProgress(legacy.progress)
        updatePlayerCategoryMissionSync(playerId, category, missionId, progress)
        importLegacyStages(playerId, category, missionId, legacy.stages)
        categoryMissions[String(missionId)] = {
            progress,
            stages: Array.isArray(legacy.stages) ? [] : { ...legacy.stages },
        }
    }
    return categoryMissions
}
