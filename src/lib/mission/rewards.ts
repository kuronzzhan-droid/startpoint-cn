// Mission reward parsers — from CDN reward tables

import activeRewards from "../../../assets/mission_active_reward.json"
import regularRewards from "../../../assets/mission_regular_reward.json"
import dailyRewards from "../../../assets/mission_daily_reward.json"
import eventRewards from "../../../assets/mission_event_reward.json"
import degreeRewards from "../../../assets/mission_degree_reward.json"
import collectRewards from "../../../assets/mission_collect_item_reward.json"
import weeklyRewards from "../../../assets/mission_weekly_reward.json"
import charAwakeRewards from "../../../assets/mission_char_awake_reward.json"
import type { ReadonlyContentRepository } from "../../content/runtime/content-snapshot"

export interface ActiveMissionReward {
    kind: number
    amount: number
    itemId?: number
    characterId?: number
    equipmentId?: number
}

export interface MissionRewardStageDefinition {
    source: "active" | "awake"
    targetProgress: number
    targetClearSeconds?: number
    rewards: ActiveMissionReward[]
}

function getRewardRow(
    table: Record<string, Record<string, any[]>>,
    missionId: number,
    stage: number
): any[] | undefined {
    return table[String(missionId)]?.[String(stage)]?.[0]
}

function getActiveRewardTable(
    repository?: ReadonlyContentRepository,
): Record<string, Record<string, any[]>> {
    return repository !== undefined
        ? repository.table<Record<string, Record<string, any[]>>>("mission_active_reward.json")
        : activeRewards as Record<string, Record<string, any[]>>
}

function hasCanonicalContinuousStageIds(stageTable: Record<string, any[]>): boolean {
    const stageIds = Object.keys(stageTable).map(rawStageId => {
        const stageId = Number(rawStageId)
        if (!Number.isSafeInteger(stageId)
            || stageId <= 0
            || String(stageId) !== rawStageId) return null
        return stageId
    })
    if (stageIds.some(stageId => stageId === null)) return false
    return (stageIds as number[])
        .sort((left, right) => left - right)
        .every((stageId, index) => stageId === index + 1)
}

function getActiveMissionStageTable(
    missionId: number,
    repository?: ReadonlyContentRepository,
): Record<string, any[]> | undefined {
    const rewardTable = getActiveRewardTable(repository) as unknown
    if (!rewardTable || typeof rewardTable !== "object" || Array.isArray(rewardTable)) return undefined
    const stageTable = (rewardTable as Record<string, unknown>)[String(missionId)]
    if (stageTable === undefined) return undefined
    if (!stageTable || typeof stageTable !== "object" || Array.isArray(stageTable)) return undefined
    if (repository !== undefined
        && !hasCanonicalContinuousStageIds(stageTable as Record<string, any[]>)) return undefined
    return stageTable as Record<string, any[]>
}

function parseRepositoryNonNegativeSafeInteger(value: unknown): number | null {
    const parsed = Number(value)
    if (!Number.isSafeInteger(parsed)
        || parsed < 0
        || String(parsed) !== String(value)) return null
    return parsed
}

function parseRepositoryOptionalNonNegativeSafeInteger(
    value: unknown,
): { readonly valid: true, readonly value?: number } | { readonly valid: false } {
    if (value === undefined || value === null || value === "" || value === "(None)") {
        return { valid: true }
    }
    const parsed = parseRepositoryNonNegativeSafeInteger(value)
    return parsed === null ? { valid: false } : { valid: true, value: parsed }
}

function parseOptionalInteger(value: unknown): number | undefined {
    if (value === undefined || value === null || value === "" || value === "(None)") return undefined
    const parsed = parseInt(String(value))
    return Number.isNaN(parsed) ? undefined : parsed
}

function parseMissionRewardSlots(row: any[], firstKindIndex: number, slotCount: number): ActiveMissionReward[] {
    const result: ActiveMissionReward[] = []
    for (let slot = 0; slot < slotCount; slot++) {
        const base = firstKindIndex + slot * 6
        const kindRaw = row[base]
        if (kindRaw === undefined || kindRaw === "" || kindRaw === "(None)") continue
        const kind = parseInt(kindRaw)
        if (Number.isNaN(kind)) continue

        const amount = parseInt(row[base + 1]) || 0
        if (amount === 0 && kind !== 6) continue

        const itemId = row[base + 2] ? parseInt(row[base + 2]) : undefined
        const charId = row[base + 3] ? parseInt(row[base + 3]) : undefined
        const equipId = row[base + 4] ? parseInt(row[base + 4]) : undefined

        if (kind === 1 && !itemId) continue
        if (kind === 2 && !equipId) continue

        const reward: ActiveMissionReward = { kind, amount }
        if (itemId) reward.itemId = itemId
        if (charId) reward.characterId = charId
        if (equipId) reward.equipmentId = equipId
        result.push(reward)
    }
    return result
}

export function getActiveMissionRewards(
    missionId: number,
    stage: number,
    repository?: ReadonlyContentRepository,
): ActiveMissionReward[] {
    const mission = getActiveMissionStageTable(missionId, repository)
    if (!mission) return []
    const stageData = mission[String(stage)]
    if (!stageData || !stageData[0]) return []
    const row = stageData[0]

    return parseMissionRewardSlots(row, 7, 4)
}

export function getMissionRewardStageDefinition(
    missionId: number,
    stage: number,
    repository?: ReadonlyContentRepository,
): MissionRewardStageDefinition | null {
    if (repository === undefined) {
        const awakeRow = getRewardRow(
            charAwakeRewards as Record<string, Record<string, any[]>>,
            missionId,
            stage,
        )
        if (awakeRow) {
            const targetProgress = parseFloat(String(awakeRow[5]))
            if (!Number.isFinite(targetProgress)) return null
            return {
                source: "awake",
                targetProgress,
                targetClearSeconds: parseOptionalInteger(awakeRow[6]),
                rewards: parseMissionRewardSlots(awakeRow, 9, 4),
            }
        }
    }

    const activeRow = getActiveMissionStageTable(missionId, repository)?.[String(stage)]?.[0]
    if (!activeRow) return null
    const targetProgress = repository === undefined
        ? parseFloat(String(activeRow[3]))
        : parseRepositoryNonNegativeSafeInteger(activeRow[3])
    if (targetProgress === null || !Number.isFinite(targetProgress)) return null
    const repositoryClearSeconds = repository === undefined
        ? undefined
        : parseRepositoryOptionalNonNegativeSafeInteger(activeRow[4])
    if (repositoryClearSeconds?.valid === false) return null
    return {
        source: "active",
        targetProgress,
        targetClearSeconds: repository === undefined
            ? parseOptionalInteger(activeRow[4])
            : repositoryClearSeconds?.value,
        rewards: parseMissionRewardSlots(activeRow, 7, 4),
    }
}

export function getRegularMissionRewards(missionId: number, stage: number): ActiveMissionReward[] {
    const mission = (regularRewards as Record<string, Record<string, any[]>>)[String(missionId)]
    if (!mission) return []
    const stageData = mission[String(stage)]
    if (!stageData || !stageData[0]) return []
    return parseMissionRewardSlots(stageData[0], 5, 4)
}

export function getDailyMissionRewards(missionId: number, stage: number): ActiveMissionReward[] {
    const mission = (dailyRewards as Record<string, Record<string, any[]>>)[String(missionId)]
    if (!mission) return []
    const stageData = mission[String(stage)]
    if (!stageData || !stageData[0]) return []
    return parseMissionRewardSlots(stageData[0], 5, 4)
}

export function getAwakeMissionRewards(missionId: number, stage: number): ActiveMissionReward[] {
    const mission = (charAwakeRewards as Record<string, Record<string, any[]>>)[String(missionId)]
    if (!mission) return []
    const stageData = mission[String(stage)]
    if (!stageData || !stageData[0]) return []
    return parseMissionRewardSlots(stageData[0], 9, 4)
}

export function getEventMissionRewards(missionId: number, stage: number): ActiveMissionReward[] {
    const mission = (eventRewards as Record<string, Record<string, any[]>>)[String(missionId)]
    if (!mission) return []
    const stageData = mission[String(stage)]
    if (!stageData || !stageData[0]) return []
    const row = stageData[0]

    return parseMissionRewardSlots(row, 5, 4)
}

export function getDegreeMissionRewards(missionId: number, stage: number): ActiveMissionReward[] {
    const mission = (degreeRewards as Record<string, Record<string, any[]>>)[String(missionId)]
    if (!mission) return []
    const stageData = mission[String(stage)]
    if (!stageData || !stageData[0]) return []
    return parseMissionRewardSlots(stageData[0], 5, 4)
}

export function getCollectMissionRewards(missionId: number, stage: number): ActiveMissionReward[] {
    const mission = (collectRewards as Record<string, Record<string, any[]>>)[String(missionId)]
    if (!mission) return []
    const stageData = mission[String(stage)]
    if (!stageData || !stageData[0]) return []
    return parseMissionRewardSlots(stageData[0], 6, 4)
}

export function getWeeklyMissionRewards(missionId: number, stage: number): ActiveMissionReward[] {
    const mission = (weeklyRewards as Record<string, Record<string, any[]>>)[String(missionId)]
    if (!mission) return []
    const stageData = mission[String(stage)]
    if (!stageData || !stageData[0]) return []
    return parseMissionRewardSlots(stageData[0], 5, 4)
}
