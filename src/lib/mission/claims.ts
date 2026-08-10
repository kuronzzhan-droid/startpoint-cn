import { getMissionRewardStageDefinition } from "./rewards"
import type { ActiveMissionReward } from "./rewards"
import {
    isActiveMissionClaimable,
    type ActiveMissionAvailabilityContext,
    type ActiveMissionProgressState,
} from "./active-core"
import { getActiveMissionMasterDefinition } from "./active-master-data"

interface MissionClaimState {
    progress: number
    stages?: Record<string, boolean> | unknown[]
}

export interface ValidatedMissionRewardClaim {
    missionId: number
    stage: number
    progress: number
    rewards: ActiveMissionReward[]
}

export type MissionRewardClaimValidation =
    | { ok: true; claims: ValidatedMissionRewardClaim[] }
    | { ok: false; message: string }

export type MissionRewardClaimContext = Omit<ActiveMissionAvailabilityContext, "activeMissions">

function hasCompleteClaimContext(context: MissionRewardClaimContext): boolean {
    const repository = context.repository as Partial<MissionRewardClaimContext["repository"]> | undefined
    const now = context.now instanceof Date ? context.now.getTime() : context.now
    if (!repository
        || typeof repository.table !== "function"
        || typeof repository.info !== "function"
        || !Number.isFinite(now)
        || !context.questProgress
        || typeof context.questProgress !== "object"
        || Array.isArray(context.questProgress)) return false

    return Object.values(context.questProgress).every(progressList =>
        Array.isArray(progressList) && progressList.every(progress =>
            progress !== null
            && typeof progress === "object"
            && Number.isSafeInteger(progress.questId)
            && progress.questId > 0
            && typeof progress.finished === "boolean"))
}

function buildAvailabilityMissions(
    activeMissions: Record<string, MissionClaimState>,
): Readonly<Record<string, ActiveMissionProgressState>> | undefined {
    if (!activeMissions || typeof activeMissions !== "object" || Array.isArray(activeMissions)) return undefined
    const entries = Object.entries(activeMissions)
    if (entries.some(([, state]) =>
        !state
        || typeof state !== "object"
        || !Number.isFinite(state.progress)
        || state.progress < 0)) return undefined

    return Object.fromEntries(entries.map(([missionId, state]) => [
        missionId,
        {
            progress: state.progress,
            stages: state.stages && !Array.isArray(state.stages) ? state.stages : {},
        },
    ]))
}

export function validateMissionRewardClaims(
    activeMissions: Record<string, MissionClaimState>,
    requestList: unknown,
    context?: MissionRewardClaimContext,
): MissionRewardClaimValidation {
    if (!Array.isArray(requestList)) return { ok: false, message: "Invalid active mission claim." }

    const claims: ValidatedMissionRewardClaim[] = []
    const seenClaims = new Set<string>()
    const availabilityMissions = context === undefined
        ? undefined
        : buildAvailabilityMissions(activeMissions)
    if (context !== undefined
        && (!hasCompleteClaimContext(context) || availabilityMissions === undefined)) {
        return { ok: false, message: "Active mission is not available." }
    }

    for (const rawEntry of requestList) {
        if (!rawEntry || typeof rawEntry !== "object") {
            return { ok: false, message: "Invalid active mission claim." }
        }

        const entry = rawEntry as { mission_id?: unknown; stages?: unknown }
        const missionId = Number(entry.mission_id)
        if (!Number.isInteger(missionId) || missionId <= 0 || !Array.isArray(entry.stages)) {
            return { ok: false, message: "Invalid active mission claim." }
        }

        if (context !== undefined) {
            let missionMaster
            try {
                missionMaster = getActiveMissionMasterDefinition(missionId, context.repository)
            } catch {
                return { ok: false, message: "Active mission is not available." }
            }
            if (!missionMaster) {
                return { ok: false, message: "Unknown active mission." }
            }
            if (!isActiveMissionClaimable(missionId, {
                ...context,
                activeMissions: availabilityMissions!,
            })) {
                return { ok: false, message: "Active mission is not available." }
            }
        }

        const currentMission = activeMissions[String(missionId)]
        if (!currentMission) return { ok: false, message: "Mission is not active." }

        const existingStages = currentMission.stages && !Array.isArray(currentMission.stages)
            ? currentMission.stages
            : {}

        for (const rawStage of entry.stages) {
            const stage = Number(rawStage)
            if (!Number.isInteger(stage) || stage <= 0) {
                return { ok: false, message: "Invalid mission stage." }
            }

            const claimKey = `${missionId}:${stage}`
            if (seenClaims.has(claimKey)) continue
            seenClaims.add(claimKey)

            const stageState = existingStages[String(stage)]
            if (stageState === true) continue

            let definition
            try {
                definition = getMissionRewardStageDefinition(missionId, stage, context?.repository)
            } catch (error) {
                if (context !== undefined) {
                    return { ok: false, message: "Active mission is not available." }
                }
                throw error
            }
            if (!definition) return { ok: false, message: "Unknown mission reward stage." }

            const explicitlyClaimable = stageState === false
            if (!explicitlyClaimable && (
                currentMission.progress < definition.targetProgress || definition.targetClearSeconds !== undefined
            )) {
                return { ok: false, message: "Mission stage is not complete." }
            }

            claims.push({
                missionId,
                stage,
                progress: currentMission.progress,
                rewards: definition.rewards,
            })
        }
    }

    return { ok: true, claims }
}
