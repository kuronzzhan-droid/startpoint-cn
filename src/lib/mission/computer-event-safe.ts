import { getPlayerCollectedItemTotalsSync } from "../../data/domains/item"
import { getPlayerSync } from "../../data/domains/player"
import { getMissionMasterDefinitions } from "./master-data"
import type { CategoryContext, MissionComputer } from "./types"

const GET_ITEM_COUNT_PATTERN_TYPE = 37

function assertPositiveSafeId(value: unknown, label: string): asserts value is number {
    if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(label)
    if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(label)
}

function assertProgress(value: unknown): asserts value is number {
    if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError("mission progress")
    if (value < 0) throw new RangeError("mission progress")
}

function collectedTotal(value: unknown): number {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new TypeError("collected item total")
    }
    if (!Number.isSafeInteger(value) || value < 0) throw new RangeError("collected item total")
    return value
}

function canonicalNonNegativeInteger(value: unknown, label: string): number {
    if (typeof value !== "string" || !/^(?:0|[1-9]\d*)$/.test(value)) {
        throw new Error(`invalid ${label}`)
    }
    const numberValue = Number(value)
    if (!Number.isSafeInteger(numberValue)) throw new Error(`invalid ${label}`)
    return numberValue
}

function canonicalPositiveItemId(value: unknown): number {
    const itemId = canonicalNonNegativeInteger(value, "event mission item ID")
    if (itemId <= 0) throw new Error("invalid event mission item ID")
    return itemId
}

const eventItemIndex = (() => {
    const itemIdByMissionId = new Map<number, number>()
    const missionIdsByItemId = new Map<number, number[]>()
    const seenMissionIds = new Set<number>()
    for (const definition of getMissionMasterDefinitions(3)) {
        assertPositiveSafeId(definition.missionId, "master mission ID")
        if (!Array.isArray(definition.row) || definition.row.length !== 35) {
            throw new Error("invalid event mission row")
        }
        if (seenMissionIds.has(definition.missionId)) throw new Error("duplicate event mission ID")
        seenMissionIds.add(definition.missionId)
        const patternType = canonicalNonNegativeInteger(definition.row[2], "event mission pattern type")
        if (patternType !== GET_ITEM_COUNT_PATTERN_TYPE) continue
        const itemId = canonicalPositiveItemId(definition.row[12])
        itemIdByMissionId.set(definition.missionId, itemId)
        const missionIds = missionIdsByItemId.get(itemId) ?? []
        missionIds.push(definition.missionId)
        missionIdsByItemId.set(itemId, missionIds)
    }
    for (const missionIds of missionIdsByItemId.values()) missionIds.sort((a, b) => a - b)
    return { itemIdByMissionId, missionIdsByItemId }
})()

export function getEventItemMissionItemId(missionId: number): number | undefined {
    assertPositiveSafeId(missionId, "mission ID")
    const itemId = eventItemIndex.itemIdByMissionId.get(missionId)
    return itemId
}

export function getEventItemMissionIdsForItems(itemIds: readonly number[]): number[] {
    const missionIds = new Set<number>()
    for (const itemId of itemIds) {
        assertPositiveSafeId(itemId, "item ID")
        for (const missionId of eventItemIndex.missionIdsByItemId.get(itemId) ?? []) {
            missionIds.add(missionId)
        }
    }
    return [...missionIds].sort((a, b) => a - b)
}

export const EventSafeComputer: MissionComputer = {
    name: "EventSafe",

    buildContext(playerId: number, category: number): CategoryContext {
        assertPositiveSafeId(playerId, "player ID")
        assertPositiveSafeId(category, "category")
        if (category !== 3) throw new RangeError("event category")
        const player = getPlayerSync(playerId)
        if (!player) throw new Error("player not found")
        return {
            playerId,
            category,
            player,
            questProgress: {},
            totalQuestClears: 0,
            totalStories: 0,
            rankCounts: {},
            collectedItemTotals: getPlayerCollectedItemTotalsSync(playerId),
        }
    },

    compute(missionId: number, ctx: CategoryContext, dbProgress: number): number {
        assertPositiveSafeId(missionId, "mission ID")
        assertProgress(dbProgress)
        const itemId = eventItemIndex.itemIdByMissionId.get(missionId)
        if (itemId === undefined) return dbProgress
        const total = ctx.collectedItemTotals?.[String(itemId)]
        return total === undefined ? dbProgress : Math.max(dbProgress, collectedTotal(total))
    },
}
