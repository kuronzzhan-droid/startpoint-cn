import type { Player } from "../../data/types"
import { deletePlayerCategoryMissionsSync } from "../../data/domains/mission"
import { ensurePlayerPassCardLoginProgressSync } from "../../data/domains/pass-card"
import { getMissionMasterDefinitions, isMissionDefinitionEnabledAt } from "./master-data"
import {
    buildPeriodicSnapshotData,
    getPassWeekSnapshotType,
    getSnapshot,
    initializePeriodicMissionSnapshots,
    takeSnapshot,
} from "./snapshot"

type PeriodicPlayer = Pick<Player, "totalStaminaUsed" | "totalDashes" | "totalPowerflips" | "totalLoginDays">

function activeEventIds(category: 7 | 8, evaluationTime: Date): number[] {
    return [...new Set(getMissionMasterDefinitions(category)
        .filter(definition => definition.eventId !== undefined && isMissionDefinitionEnabledAt(definition, evaluationTime))
        .map(definition => definition.eventId!))]
}

function initializePassWeekSnapshot(
    playerId: number,
    player: PeriodicPlayer,
    evaluationTime: Date,
    questClears: number,
): void {
    const eventIds = activeEventIds(7, evaluationTime)
    if (eventIds.length > 1) throw new Error("Multiple Pass week events are active.")
    if (eventIds.length === 0) return
    const snapshotType = getPassWeekSnapshotType(eventIds[0])
    if (!getSnapshot(playerId, snapshotType)) {
        takeSnapshot(playerId, snapshotType, buildPeriodicSnapshotData(playerId, player, questClears))
    }
}

function recordPassLogin(playerId: number, totalLoginDays: number, evaluationTime: Date): void {
    for (const eventId of activeEventIds(8, evaluationTime)) {
        ensurePlayerPassCardLoginProgressSync(playerId, eventId, totalLoginDays)
    }
}

export function initializePlayerPeriodicMissionState(
    playerId: number,
    player: PeriodicPlayer,
    evaluationTime: Date,
    questClears = 0,
    countCurrentLoginDay = false,
): void {
    initializePeriodicMissionSnapshots(playerId, player, { countCurrentLoginDay })
    initializePassWeekSnapshot(playerId, player, evaluationTime, questClears)
    recordPassLogin(playerId, player.totalLoginDays ?? 0, evaluationTime)
}

export function resetPlayerPeriodicMissionState(
    playerId: number,
    player: PeriodicPlayer,
    evaluationTime: Date,
    questClears: number,
    crossedWeek: boolean,
): void {
    recordPassLogin(playerId, player.totalLoginDays ?? 0, evaluationTime)
    const baseline = buildPeriodicSnapshotData(playerId, player, questClears)
    takeSnapshot(playerId, "daily", baseline)
    deletePlayerCategoryMissionsSync(playerId, 2)
    deletePlayerCategoryMissionsSync(playerId, 6)

    const eventIds = activeEventIds(7, evaluationTime)
    if (eventIds.length > 1) throw new Error("Multiple Pass week events are active.")
    if (eventIds.length === 1) {
        const snapshotType = getPassWeekSnapshotType(eventIds[0])
        if (crossedWeek || !getSnapshot(playerId, snapshotType)) takeSnapshot(playerId, snapshotType, baseline)
    }
    if (crossedWeek) {
        takeSnapshot(playerId, "weekly", baseline)
        deletePlayerCategoryMissionsSync(playerId, 7)
        deletePlayerCategoryMissionsSync(playerId, 10)
    }
}

export function forcePlayerPeriodicMissionReset(
    playerId: number,
    player: PeriodicPlayer,
    questClears: number,
    period: "daily" | "weekly",
): void {
    const baseline = buildPeriodicSnapshotData(playerId, player, questClears)
    takeSnapshot(playerId, period, baseline)
    if (period === "daily") {
        deletePlayerCategoryMissionsSync(playerId, 2)
        deletePlayerCategoryMissionsSync(playerId, 6)
    } else {
        deletePlayerCategoryMissionsSync(playerId, 7)
        deletePlayerCategoryMissionsSync(playerId, 10)
    }
}
