import { getPlayerCharacterSync } from "../../data/domains/character"
import { upsertPlayerCharacterAwakeUnlockSync } from "../../data/domains/character_awake"
import {
    updatePlayerCategoryMissionStageSync,
    updatePlayerCategoryMissionSync,
} from "../../data/domains/mission"
import { getPlayerSync } from "../../data/domains/player"
import { buildCharacterListEntry } from "../character-helpers"
import { runImmediateTransactionWithRetry, withPlayerWriteQueue } from "../sqlite-write-coordinator"
import { MissionRewardGranter } from "./grants"
import { getMissionMasterDefinition, isMissionDefinitionEnabledAt } from "./master-data"
import { getComputer } from "./registry"
import { getPlayerCategoryMissionsWithLegacyImportSync } from "./legacy-bridge"
import { getAwakeMissionRewardStageDefinition } from "./rewards"
import type { MissionSettlementResult } from "./settlement"
import { getCompletedStageNumbers, getMissionFinalTargetProgress } from "./stages"

function positiveSafeInteger(value: unknown, name: string): number {
    if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(`${name} must be finite`)
    if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${name} must be positive`)
    return value
}

function finiteProgress(value: unknown, name: string): number {
    if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(`${name} must be finite`)
    if (value < 0) throw new RangeError(`${name} must be non-negative`)
    return value
}

function canonicalMissionIds(values: readonly number[]): number[] {
    if (!Array.isArray(values)) throw new TypeError("awake missionIds must be an array")
    const result: number[] = []
    for (let index = 0; index < values.length; index += 1) {
        if (!(index in values)) throw new TypeError("awake missionIds must be dense")
        result.push(positiveSafeInteger(values[index], "awake missionId"))
    }
    return [...new Set(result)]
}

function settleAwakeMissionCandidates(
    playerId: number,
    rawMissionIds: readonly number[],
    evaluationTime: Date,
): MissionSettlementResult {
    positiveSafeInteger(playerId, "playerId")
    if (!(evaluationTime instanceof Date) || !Number.isFinite(evaluationTime.getTime())) {
        throw new TypeError("evaluationTime must be a valid Date")
    }
    const missionIds = canonicalMissionIds(rawMissionIds)
    const empty = { missionInfo: [], itemList: {}, characterList: [], equipmentList: [], degreeIds: [], passCardPoints: {} }
    if (missionIds.length === 0) return empty
    const player = getPlayerSync(playerId)
    if (!player) throw new Error(`Player ${playerId} not found during awake settlement.`)
    const enabledMissionIds = missionIds.filter(missionId => {
        const definition = getMissionMasterDefinition(9, missionId)
        return definition !== undefined && isMissionDefinitionEnabledAt(definition, evaluationTime)
    })
    const persisted = getPlayerCategoryMissionsWithLegacyImportSync(playerId, 9, enabledMissionIds)
    const computer = getComputer(9)
    const context = computer.buildContext(playerId, 9, evaluationTime, missionIds)
    const granter = new MissionRewardGranter(playerId, player)
    const missionInfo: MissionSettlementResult["missionInfo"] = []
    const awakeLevels = new Map<number, Record<number, number>>()

    function recordAwakeUnlock(reward: ReturnType<typeof getAwakeMissionRewardStageDefinition>): void {
        if (!reward?.specialReward || !upsertPlayerCharacterAwakeUnlockSync(
            playerId,
            reward.specialReward.characterId,
            reward.specialReward.boardIndex,
            reward.specialReward.awakeLevel,
        )) return
        const levels = awakeLevels.get(reward.specialReward.characterId) ?? {}
        levels[reward.specialReward.boardIndex] = reward.specialReward.awakeLevel
        awakeLevels.set(reward.specialReward.characterId, levels)
    }

    for (const missionId of missionIds) {
        const definition = getMissionMasterDefinition(9, missionId)
        if (!definition || !isMissionDefinitionEnabledAt(definition, evaluationTime)) continue
        const categoryMission = persisted[String(missionId)]
        const current = categoryMission
        const dbProgress = finiteProgress(current?.progress ?? 0, "stored awake progress")
        const computed = finiteProgress(computer.compute(missionId, context, dbProgress), "computed awake progress")
        const finalTarget = getMissionFinalTargetProgress(9, missionId)
        const progress = finalTarget === undefined
            ? Math.max(dbProgress, computed)
            : Math.min(Math.max(dbProgress, computed), finalTarget)
        if (context.activeMissionProgress) context.activeMissionProgress[String(missionId)] = progress
        if (progress !== dbProgress) {
            updatePlayerCategoryMissionSync(playerId, 9, missionId, progress)
        }

        for (const stage of getCompletedStageNumbers(9, missionId, progress)) {
            const reward = getAwakeMissionRewardStageDefinition(missionId, stage)
            if (!reward) throw new Error(`Awake reward ${missionId}:${stage} is missing.`)
            if (!Array.isArray(current?.stages) && current?.stages[String(stage)] === true) {
                recordAwakeUnlock(reward)
                continue
            }
            updatePlayerCategoryMissionStageSync(playerId, 9, stage, missionId, true)
            granter.grant(reward.rewards)
            missionInfo.push({ mission_category_id: 9, mission_id: missionId, mission_reward_id: reward.missionRewardId })
            recordAwakeUnlock(reward)
        }
    }
    granter.persistPlayer()
    const characterList = granter.characterList as Record<string, unknown>[]
    for (const [characterId, levels] of awakeLevels) {
        const character = getPlayerCharacterSync(playerId, characterId)
        if (!character) throw new Error(`Awake character ${characterId} is not owned.`)
        characterList.push(buildCharacterListEntry(characterId, character, { mana_board_awake: levels }))
    }
    return {
        missionInfo,
        itemList: granter.itemList,
        characterList,
        equipmentList: granter.equipmentList,
        degreeIds: granter.degreeList,
        passCardPoints: {},
        ...(granter.hasPlayerChanges() ? { userInfo: granter.getUserInfo() } : {}),
    }
}

export function settleAwakeMissionCandidatesAsync(
    playerId: number,
    missionIds: readonly number[],
    evaluationTime: Date,
): Promise<MissionSettlementResult> {
    return withPlayerWriteQueue(playerId, () => runImmediateTransactionWithRetry(() =>
        settleAwakeMissionCandidates(playerId, missionIds, evaluationTime)
    ))
}
