import { updatePlayerCategoryMissionSync } from "../../data/domains/mission"
import { QuestCategory } from "../types"

interface SteamRobotChallengeDefinition {
    missionId: number
    questId: number
    clientCheck?: string
}

const STEAM_ROBOT_CHALLENGES: readonly SteamRobotChallengeDefinition[] = [
    { missionId: 900809, questId: 1001001 },
    { missionId: 900810, questId: 1002001, clientCheck: "hard_multi_steam_robot_water" },
    { missionId: 900811, questId: 1003001, clientCheck: "hard_multi_steam_robot_thunder" },
    { missionId: 900812, questId: 1004001, clientCheck: "hard_multi_steam_robot_wind_coffin_count" },
    { missionId: 900813, questId: 1005001, clientCheck: "hard_multi_steam_robot_light" },
    { missionId: 900814, questId: 1006001, clientCheck: "hard_multi_steam_robot_dark" },
]

function getChallenge(
    questCategory: number,
    questId: number,
): SteamRobotChallengeDefinition | undefined {
    if (questCategory !== QuestCategory.HARD_MULTI_EVENT) return undefined
    return STEAM_ROBOT_CHALLENGES.find(challenge => challenge.questId === questId)
}

function hasPositiveResistanceDebuffCount(value: unknown): boolean {
    if (Array.isArray(value)) {
        return value.some(entry => hasPositiveResistanceDebuffCount(entry))
    }
    if (!value || typeof value !== "object") return false

    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
        if (key === "debuff_r" && Number(entry) > 0) return true
        if (hasPositiveResistanceDebuffCount(entry)) return true
    }
    return false
}

function getClearedClientChecks(statistics: any): Set<string> {
    const result = new Set<string>()
    const add = (value: string): void => {
        const normalized = value.trim()
        if (normalized) result.add(normalized)
    }
    const isSuccessfulCheckValue = (value: unknown): boolean => (
        value === true
        || value === 1
        || value === "1"
        || (typeof value === "string" && ["true", "success", "cleared", "clear"].includes(value.trim().toLowerCase()))
    )
    const visit = (value: unknown, key = "", insideCheckField = false): void => {
        const isCheckField = insideCheckField || key.includes("check")
        if (Array.isArray(value)) {
            for (const entry of value) visit(entry, key, isCheckField)
            return
        }
        if (typeof value === "string") {
            if (isCheckField) add(value)
            return
        }
        if (!value || typeof value !== "object") return
        const objectValue = value as Record<string, unknown>
        const explicitName = ["name", "id", "check", "check_id", "value"]
            .map(field => objectValue[field])
            .find(entry => typeof entry === "string")
        const explicitResult = ["cleared", "success", "result", "passed", "is_cleared"]
            .map(field => objectValue[field])
            .find(entry => entry !== undefined)
        if (
            isCheckField
            && typeof explicitName === "string"
            && (explicitResult === undefined || isSuccessfulCheckValue(explicitResult))
        ) {
            add(explicitName)
        }
        for (const [childKeyRaw, child] of Object.entries(objectValue)) {
            const childKey = childKeyRaw.toLowerCase()
            if (
                explicitName !== undefined
                && (["name", "id", "check", "check_id", "value"].includes(childKey)
                    || ["cleared", "success", "result", "passed", "is_cleared"].includes(childKey))
            ) {
                continue
            }
            // Some client revisions serialize checks as
            // `{ hard_multi_steam_robot_wind_coffin_count: true }`.
            if (isCheckField && isSuccessfulCheckValue(child)) add(childKeyRaw)
            visit(child, childKey, isCheckField)
        }
    }
    visit(statistics)
    return result
}

export function getSteamRobotMissionClientChecks(
    questCategory: number,
    questId: number,
): string[] {
    const challenge = getChallenge(questCategory, questId)
    return challenge?.clientCheck ? [challenge.clientCheck] : []
}

export function isSteamRobotChallengeMissionCleared(params: {
    questCategory: number
    questId: number
    questAccomplished: boolean
    clearRank: number | null
    statistics: any
}): boolean {
    const challenge = getChallenge(params.questCategory, params.questId)
    if (!challenge || !params.questAccomplished || params.clearRank !== 5) return false

    // The red robot uses the legacy member statistic. A positive debuff_r
    // means at least one elemental-resistance-down effect was received.
    if (!challenge.clientCheck) {
        // Old and new clients nest zone/member statistics differently, so scan
        // the complete statistics payload instead of assuming a top-level
        // `zones` array.
        return !hasPositiveResistanceDebuffCount(params.statistics)
    }

    // The other five robots use the mission client-check system. The client
    // returns only checks that remained satisfied for the whole battle.
    return getClearedClientChecks(params.statistics).has(challenge.clientCheck)
}

export function trackSteamRobotChallengeMission(params: {
    playerId: number
    questCategory: number
    questId: number
    questAccomplished: boolean
    clearRank: number | null
    statistics: any
}): number | null {
    const challenge = getChallenge(params.questCategory, params.questId)
    if (!challenge || !isSteamRobotChallengeMissionCleared(params)) return null

    // These definitions come from mission_event.json and therefore belong to
    // mission category 3.  Writing them to players_active_missions makes the
    // server log a successful clear, but mission/get_mission_progress never
    // sees it because that endpoint reads players_category_missions.
    updatePlayerCategoryMissionSync(params.playerId, 3, challenge.missionId, 1)
    return challenge.missionId
}
