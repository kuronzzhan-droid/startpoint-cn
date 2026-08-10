import { getDb } from "../db"
import type { PlayerActiveMission } from "../types"
import { serializeBoolean } from "../utils"

function categoryPositiveId(value: unknown, name: string): number {
    if (typeof value === "string") {
        if (!/^[1-9]\d*$/.test(value)) {
            throw new TypeError(`${name} must be a canonical positive decimal integer`)
        }
        value = Number(value)
    }
    if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new TypeError(`${name} must be a finite number`)
    }
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new RangeError(`${name} must be a positive safe integer`)
    }
    return value
}

function categoryProgress(value: unknown, name: string, allowZero: boolean): number {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new TypeError(`${name} must be a finite number`)
    }
    if (value < 0 || (!allowZero && value === 0)) {
        throw new RangeError(`${name} is outside its allowed range`)
    }
    return value
}

function categoryStatus(value: unknown, name: string): boolean {
    if (typeof value === "boolean") return value
    if (value === 0 || value === 1) return value === 1
    throw new TypeError(`${name} must be a boolean or stored as 0/1`)
}

export function getPlayerCategoryMissionsSync(
    playerId: number,
    category: number
): Record<string, PlayerActiveMission> {
    const validPlayerId = categoryPositiveId(playerId, "playerId")
    const validCategory = categoryPositiveId(category, "category")
    const missions = getDb().prepare(`
    SELECT id, progress FROM players_category_missions
    WHERE player_id = ? AND category = ? ORDER BY id
    `).all(validPlayerId, validCategory) as Array<{ id: unknown; progress: unknown }>
    const stages = getDb().prepare(`
    SELECT id, status, mission_id FROM players_category_mission_stages
    WHERE player_id = ? AND category = ? ORDER BY mission_id, id
    `).all(validPlayerId, validCategory) as Array<{ id: unknown; status: unknown; mission_id: unknown }>

    const result: Record<string, PlayerActiveMission> = {}
    for (const mission of missions) {
        const missionId = categoryPositiveId(mission.id, "stored missionId")
        result[String(missionId)] = {
            progress: categoryProgress(mission.progress, "stored progress", true),
            stages: [],
        }
    }
    for (const stage of stages) {
        const missionId = categoryPositiveId(stage.mission_id, "stored stage missionId")
        const mission = result[String(missionId)]
        if (mission === undefined) throw new Error("category mission stage has no parent mission")
        const stageId = categoryPositiveId(stage.id, "stored stageId")
        const bucket = Array.isArray(mission.stages) ? {} : mission.stages
        bucket[String(stageId)] = categoryStatus(stage.status, "stored stage status")
        mission.stages = bucket
    }
    return result
}

export function getPlayerCategoryMissionListSync(
    playerId: number
): Record<string, Record<string, PlayerActiveMission>> {
    const validPlayerId = categoryPositiveId(playerId, "playerId")
    const rows = getDb().prepare(`
    SELECT DISTINCT category FROM players_category_missions
    WHERE player_id = ? ORDER BY category
    `).all(validPlayerId) as Array<{ category: unknown }>
    const result: Record<string, Record<string, PlayerActiveMission>> = {}
    for (const row of rows) {
        const category = categoryPositiveId(row.category, "stored category")
        result[String(category)] = getPlayerCategoryMissionsSync(validPlayerId, category)
    }
    return result
}

export function getPlayerClearedCollectItemEventMissionListSync(
    playerId: number
): Record<string, number> {
    const validPlayerId = categoryPositiveId(playerId, "playerId")
    const rows = getDb().prepare(`
    SELECT id, status, mission_id FROM players_category_mission_stages
    WHERE player_id = ? AND category = 4 ORDER BY mission_id, id
    `).all(validPlayerId) as Array<{ id: unknown; status: unknown; mission_id: unknown }>
    const result: Record<string, number> = {}
    for (const row of rows) {
        const stageId = categoryPositiveId(row.id, "stored stageId")
        const missionId = categoryPositiveId(row.mission_id, "stored missionId")
        if (categoryStatus(row.status, "stored stage status")) {
            result[String(missionId)] = Math.max(result[String(missionId)] ?? 0, stageId)
        }
    }
    return result
}

interface CategoryMissionImportEntry {
    category: number
    missionId: number
    progress: number
    stages: Array<{ stageId: number; status: boolean }>
}

function buildCategoryMissionImport(
    categories: Record<string, Record<string, PlayerActiveMission>>
): CategoryMissionImportEntry[] {
    if (typeof categories !== "object" || categories === null || Array.isArray(categories)) {
        throw new TypeError("category mission list must be an object")
    }
    const plan: CategoryMissionImportEntry[] = []
    for (const [categoryKey, missions] of Object.entries(categories)) {
        const category = categoryPositiveId(categoryKey, "category key")
        if (typeof missions !== "object" || missions === null || Array.isArray(missions)) {
            throw new TypeError("category mission bucket must be an object")
        }
        for (const [missionKey, rawMission] of Object.entries(missions)) {
            if (typeof rawMission !== "object" || rawMission === null || Array.isArray(rawMission)) {
                throw new TypeError("category mission must be an object")
            }
            const mission = rawMission as PlayerActiveMission
            const stages: CategoryMissionImportEntry["stages"] = []
            if (Array.isArray(mission.stages)) {
                if (mission.stages.length !== 0) throw new TypeError("only an empty stage array is valid")
            } else if (typeof mission.stages === "object" && mission.stages !== null) {
                for (const [stageKey, status] of Object.entries(mission.stages)) {
                    if (typeof status !== "boolean") throw new TypeError("stage status must be a boolean")
                    stages.push({ stageId: categoryPositiveId(stageKey, "stage key"), status })
                }
            } else {
                throw new TypeError("category mission stages must be an object or empty array")
            }
            plan.push({
                category,
                missionId: categoryPositiveId(missionKey, "mission key"),
                progress: categoryProgress(mission.progress, "mission progress", true),
                stages,
            })
        }
    }
    return plan
}

export function insertPlayerCategoryMissionListSync(
    playerId: number,
    categories: Record<string, Record<string, PlayerActiveMission>>
) {
    const validPlayerId = categoryPositiveId(playerId, "playerId")
    const plan = buildCategoryMissionImport(categories)
    getDb().transaction(() => {
        for (const entry of plan) {
            updatePlayerCategoryMissionSync(validPlayerId, entry.category, entry.missionId, entry.progress)
            for (const stage of entry.stages) {
                updatePlayerCategoryMissionStageSync(
                    validPlayerId, entry.category, stage.stageId, entry.missionId, stage.status
                )
            }
        }
    })()
}

export function updatePlayerCategoryMissionSync(
    playerId: number,
    category: number,
    missionId: number | string,
    progress: number
) {
    const result = getDb().prepare(`
    INSERT INTO players_category_missions (category, id, progress, player_id)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(category, id, player_id) DO UPDATE SET progress = excluded.progress
    `).run(
        categoryPositiveId(category, "category"),
        categoryPositiveId(missionId, "missionId"),
        categoryProgress(progress, "progress", true),
        categoryPositiveId(playerId, "playerId")
    )
    if (result.changes !== 1) throw new Error("category mission write count mismatch")
}

export function incrementPlayerCategoryMissionSync(
    playerId: number,
    category: number,
    missionId: number | string,
    delta: number
) {
    const validDelta = categoryProgress(delta, "delta", false)
    const result = getDb().prepare(`
    INSERT INTO players_category_missions (category, id, progress, player_id)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(category, id, player_id) DO UPDATE SET progress = progress + excluded.progress
    WHERE typeof(progress) IN ('integer', 'real') AND progress >= 0 AND progress <= ?
    `).run(
        categoryPositiveId(category, "category"),
        categoryPositiveId(missionId, "missionId"),
        validDelta,
        categoryPositiveId(playerId, "playerId"),
        Number.MAX_VALUE - validDelta
    )
    if (result.changes !== 1) throw new RangeError("category progress cannot be incremented safely")
}

export function updatePlayerCategoryMissionStageSync(
    playerId: number,
    category: number,
    stageId: number | string,
    missionId: number | string,
    status: boolean
) {
    if (typeof status !== "boolean") throw new TypeError("status must be a boolean")
    const result = getDb().prepare(`
    INSERT INTO players_category_mission_stages (category, id, status, player_id, mission_id)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(category, id, mission_id, player_id) DO UPDATE SET status = excluded.status
    `).run(
        categoryPositiveId(category, "category"),
        categoryPositiveId(stageId, "stageId"),
        serializeBoolean(status),
        categoryPositiveId(playerId, "playerId"),
        categoryPositiveId(missionId, "missionId")
    )
    if (result.changes !== 1) throw new Error("category stage write count mismatch")
}

export function deletePlayerCategoryMissionsSync(playerId: number, category: number) {
    const validPlayerId = categoryPositiveId(playerId, "playerId")
    const validCategory = categoryPositiveId(category, "category")
    getDb().transaction(() => {
        getDb().prepare(`DELETE FROM players_category_mission_stages WHERE player_id = ? AND category = ?`)
            .run(validPlayerId, validCategory)
        getDb().prepare(`DELETE FROM players_category_missions WHERE player_id = ? AND category = ?`)
            .run(validPlayerId, validCategory)
    })()
}
