import { getPlayerCharactersManaNodesSync, getPlayerCharactersSync } from "../../data/domains/character"
import { upsertPlayerCharacterAwakeUnlockSync } from "../../data/domains/character_awake"
import {
    getPlayerCategoryMissionsSync,
    updatePlayerCategoryMissionStageSync,
    updatePlayerCategoryMissionSync,
} from "../../data/domains/mission"
import { getPlayerSync } from "../../data/domains/player"
import { getDb } from "../../data/db"
import { buildManaBoardAwakeCharacterList } from "../character-helpers"
import { MissionRewardGranter } from "./grants"
import { getAwakeMissionRewardStageDefinition } from "./rewards"
import { getCompletedStageNumbers } from "./stages"
import { getMissionFinalTargetProgress, getMissionIdsByCategory } from "./stages"
import { getCharacterIdFromMission } from "./character-queries"
import { getComputer } from "./registry"

export interface AwakeMissionComputedProgress {
    missionId: number
    progress: number
}

export interface AwakeMissionInfo {
    mission_category_id: 9
    mission_id: number
    mission_reward_id: number
}

export interface AwakeMissionSettlementResult {
    missionInfo: AwakeMissionInfo[]
    itemList: Record<string, number>
    characterList: Record<string, unknown>[]
    equipmentList: Object[]
    degreeIds: number[]
    passCardPoints: Record<string, number>
    userInfo?: Record<string, number>
}

export function getAwakeBattleMissionIds(
    characterIds: readonly number[],
    directlyChangedMissionIds: readonly number[] = [],
): number[] {
    const targetCharacterIds = new Set(
        characterIds.filter(characterId => Number.isSafeInteger(characterId) && characterId > 0),
    )
    const missionIds = new Set(
        directlyChangedMissionIds.filter(missionId => Number.isSafeInteger(missionId) && missionId > 0),
    )
    for (const missionId of getMissionIdsByCategory(9)) {
        if (targetCharacterIds.has(Number(getCharacterIdFromMission(missionId)))) {
            missionIds.add(missionId)
        }
    }
    return [...missionIds]
}

export function settleAwakeMissionCandidates(
    playerId: number,
    missionIds: readonly number[],
    evaluationTime: Date,
): AwakeMissionSettlementResult {
    const uniqueMissionIds = [...new Set(missionIds)]
    if (uniqueMissionIds.length === 0) {
        return {
            missionInfo: [], itemList: {}, characterList: [], equipmentList: [],
            degreeIds: [], passCardPoints: {},
        }
    }
    const persisted = getPlayerCategoryMissionsSync(playerId, 9)
    const computer = getComputer(9)
    const context = computer.buildContext(playerId, 9, evaluationTime, uniqueMissionIds)
    const progressList = uniqueMissionIds.map(missionId => {
        const dbProgress = persisted[String(missionId)]?.progress ?? 0
        const computed = computer.compute(missionId, context, dbProgress)
        const monotonicProgress = Math.max(
            0,
            dbProgress,
            Number.isFinite(computed) ? computed : 0,
        )
        const finalTarget = getMissionFinalTargetProgress(9, missionId)
        return {
            missionId,
            progress: finalTarget === undefined
                ? monotonicProgress
                : Math.min(monotonicProgress, finalTarget),
        }
    })
    return settleAwakeMissionRewards(playerId, progressList)
}

export function settleAwakeMissionRewards(
    playerId: number,
    progressList: AwakeMissionComputedProgress[]
): AwakeMissionSettlementResult {
    const progressByMissionId = new Map<number, number>()
    for (const entry of progressList) {
        const currentProgress = progressByMissionId.get(entry.missionId)
        if (currentProgress === undefined || entry.progress > currentProgress) {
            progressByMissionId.set(entry.missionId, entry.progress)
        }
    }
    const aggregatedProgressList = [...progressByMissionId].map(([missionId, progress]) => ({
        missionId,
        progress,
    }))

    const player = getPlayerSync(playerId)
    if (!player) throw new Error(`Player ${playerId} not found during CharacterAwake settlement.`)

    const persistedMissions = getPlayerCategoryMissionsSync(playerId, 9)
    const granter = new MissionRewardGranter(playerId, player)
    const missionInfo: AwakeMissionInfo[] = []
    const unlockMap = new Map<string, Record<number, number>>()

    getDb().transaction(() => {
        for (const entry of aggregatedProgressList) {
            updatePlayerCategoryMissionSync(playerId, 9, entry.missionId, entry.progress)
        }

        for (const entry of aggregatedProgressList) {
            const persistedStages = persistedMissions[String(entry.missionId)]?.stages
            for (const stage of getCompletedStageNumbers(9, entry.missionId, entry.progress)) {
                if (!Array.isArray(persistedStages) && persistedStages?.[String(stage)] === true) continue

                const definition = getAwakeMissionRewardStageDefinition(entry.missionId, stage)
                if (!definition) continue

                updatePlayerCategoryMissionStageSync(playerId, 9, stage, entry.missionId, true)
                granter.grant(definition.rewards)
                missionInfo.push({
                    mission_category_id: 9,
                    mission_id: entry.missionId,
                    mission_reward_id: definition.missionRewardId,
                })

                if (definition.specialReward) {
                    const special = definition.specialReward
                    if (upsertPlayerCharacterAwakeUnlockSync(
                        playerId,
                        special.characterId,
                        special.boardIndex,
                        special.awakeLevel
                    )) {
                        const levels = unlockMap.get(String(special.characterId)) ?? {}
                        levels[special.boardIndex] = Math.max(levels[special.boardIndex] ?? 0, special.awakeLevel)
                        unlockMap.set(String(special.characterId), levels)
                    }
                }
            }
        }

        granter.persistPlayer()
    })()

    const unlockCharacterList = unlockMap.size === 0 ? [] : buildManaBoardAwakeCharacterList(
        getPlayerCharactersSync(playerId),
        unlockMap,
        getPlayerCharactersManaNodesSync(playerId),
    )
    const characterList = [
        ...(granter.characterList as Record<string, unknown>[]),
        ...unlockCharacterList,
    ]

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
