import { getPlayerCollectedItemTotalsSync } from "../../data/domains/item"
import { getPlayerSync } from "../../data/domains/player"
import { getMissionMasterDefinitions } from "./master-data"
import type { CategoryContext, MissionComputer } from "./types"

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

function canonicalPositiveItemId(value: unknown): number {
    if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
        throw new Error("invalid collect mission item ID")
    }
    const itemId = Number(value)
    if (!Number.isSafeInteger(itemId)) throw new Error("invalid collect mission item ID")
    return itemId
}

const itemIdByMissionId = (() => {
    const index = new Map<number, number | undefined>()
    for (const definition of getMissionMasterDefinitions(4)) {
        assertPositiveSafeId(definition.missionId, "master mission ID")
        if (!Array.isArray(definition.row) || definition.row.length !== 37) {
            throw new Error("invalid collect mission row")
        }
        if (index.has(definition.missionId)) throw new Error("duplicate collect mission ID")
        const cell = definition.row[14]
        index.set(
            definition.missionId,
            cell === "(None)" ? undefined : canonicalPositiveItemId(cell),
        )
    }
    return index
})()

export function getCollectMissionItemId(missionId: number): number | undefined {
    assertPositiveSafeId(missionId, "mission ID")
    return itemIdByMissionId.get(missionId)
}

export const CollectComputer: MissionComputer = {
    name: "CollectItemEvent",

    buildContext(playerId: number, category: number): CategoryContext {
        assertPositiveSafeId(playerId, "player ID")
        assertPositiveSafeId(category, "category")
        if (category !== 4) throw new RangeError("collect category")
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
        const itemId = itemIdByMissionId.get(missionId)
        if (itemId === undefined) return dbProgress
        const total = ctx.collectedItemTotals?.[String(itemId)]
        return total === undefined ? dbProgress : Math.max(dbProgress, collectedTotal(total))
    },
}
