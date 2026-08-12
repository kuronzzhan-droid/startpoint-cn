import { ensurePlayerPassCardLoginProgressSync } from "../../data/domains/pass-card"
import { getMissionMasterDefinition, getMissionMasterDefinitions, isMissionDefinitionEnabledAt } from "./master-data"
import { RegularComputer } from "./computer-regular"
import {
    buildPeriodicSnapshotData,
    getPassWeekSnapshotType,
    getSnapshot,
    takeSnapshot,
} from "./snapshot"
import type { CategoryContext, MissionComputer } from "./types"

function periodValue(current: number, baseline: number | undefined): number {
    return Math.max(0, current - (baseline ?? 0))
}

function activeEventIds(category: number, at: Date): number[] {
    return [...new Set(getMissionMasterDefinitions(category)
        .filter(definition => definition.eventId !== undefined && isMissionDefinitionEnabledAt(definition, at))
        .map(definition => definition.eventId!))]
}

function computePeriodicPassProgress(
    patternType: number | undefined,
    context: CategoryContext,
    dbProgress: number,
): number {
    const counters = context.battleCounters
    if (!counters) return dbProgress
    switch (patternType) {
        case 14:
            return Math.max(dbProgress, periodValue(counters.singleClearCount, context.snapshot?.singleClearCount))
        case 16:
            return Math.max(dbProgress, periodValue(counters.multiClearCount, context.snapshot?.multiClearCount))
        case 28:
            return Math.max(dbProgress, periodValue(context.player.totalDashes ?? 0, context.snapshot?.dashCount))
        case 39:
            return Math.max(dbProgress, periodValue(context.player.totalStaminaUsed ?? 0, context.snapshot?.staminaUsed))
        default:
            return dbProgress
    }
}

export const PassComputer: MissionComputer = {
    name: "Pass",
    buildContext(playerId: number, category: number, evaluationTime?: Date): CategoryContext {
        if (!(evaluationTime instanceof Date) || !Number.isFinite(evaluationTime.getTime())) {
            throw new TypeError("Pass evaluationTime must be a valid Date")
        }
        if (![6, 7, 8].includes(category)) throw new RangeError("Pass category is invalid")
        const context = RegularComputer.buildContext(playerId, category, evaluationTime)
        if (category === 7) {
            const eventIds = activeEventIds(7, evaluationTime)
            if (eventIds.length > 1) throw new Error("Multiple Pass week events are active.")
            if (eventIds.length === 1) {
                const snapshotType = getPassWeekSnapshotType(eventIds[0])
                context.snapshot = getSnapshot(playerId, snapshotType)
                if (!context.snapshot) {
                    context.snapshot = buildPeriodicSnapshotData(
                        playerId,
                        context.player,
                        context.totalQuestClears,
                    )
                    takeSnapshot(playerId, snapshotType, context.snapshot)
                }
            }
        } else if (category === 8) {
            const loginProgress: Record<number, number> = {}
            for (const definition of getMissionMasterDefinitions(8)) {
                if (definition.patternType !== 0
                    || definition.eventId === undefined
                    || !isMissionDefinitionEnabledAt(definition, evaluationTime)) continue
                loginProgress[definition.missionId] = ensurePlayerPassCardLoginProgressSync(
                    playerId,
                    definition.eventId,
                    context.player.totalLoginDays ?? 0,
                )
            }
            context.passEventLoginProgress = loginProgress
        }
        return context
    },
    compute(missionId: number, context: CategoryContext, dbProgress: number): number {
        const definition = getMissionMasterDefinition(context.category, missionId)
        if (!definition) return dbProgress
        if (context.category === 6 || context.category === 7) {
            return computePeriodicPassProgress(definition.patternType, context, dbProgress)
        }
        if (context.category === 8 && definition.patternType === 0) {
            return Math.max(dbProgress, context.passEventLoginProgress?.[missionId] ?? 0)
        }
        return dbProgress
    },
}
