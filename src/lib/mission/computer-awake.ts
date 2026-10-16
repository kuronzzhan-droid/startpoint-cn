// Character awakening mission computer (category 9)

import { getPlayerCharacterClearsSync } from "../../data/domains/character_clear"
import { getPlayerCharactersByIdsSync, getPlayerCharactersSync } from "../../data/domains/character"
import {
    countFinishedPlayerQuestsByCategorySync,
    getPlayerQuestProgressSync,
    getPlayerQuestProgressBySectionAndIdsSync,
} from "../../data/domains/quest"
import { getPlayerCategoryMissionsSync } from "../../data/domains/mission"
import { getPlayerSync } from "../../data/domains/player"
import { getDb } from "../../data/db"
import { getCharacterStoryQuestIds, getCharacterIdFromMission } from "./character-queries"
import { isMissionProgressComplete } from "./stages"
import type { MissionComputer, CategoryContext } from "./types"
import type { Player, PlayerActiveMission, PlayerCharacter, PlayerQuestProgress } from "../../data/types"
import { characterAwakeDefinitions } from "./awake-master-assets"
import { getCharacterDataSync } from "../assets"
import { estimateExtendedCharacterLevel, getAwakeLevelMissionTarget } from "../character-overlimit"
import {
    AWAKE_DIRECT_BATTLE_MISSION_IDS,
    BARAK_AWAKE_PRACTICE_QUEST_ID,
    getCharacterPairKey,
    isBondTokenMissionComplete,
    mergePartyCoClearRows,
} from "./awake-battle-rules"

// Slot 1 missions that count story reading (not party clears)
const STORY_MISSION_IDS = new Set<number>(
    Object.entries(characterAwakeDefinitions)
        .filter(([, rows]) => /阅读|剧情/.test((rows as any[][])[0][3]))
        .map(([mid]) => Number(mid))
)

// ─── Awake-specific context (extends base) ───

interface AwakeContext extends CategoryContext {
    charClears: Map<string, number>
    leaderClears: Map<string, number>
    multiClears: Map<string, number>
    leaderMultiClears: Map<string, number>
    leaderPowerflips: Map<string, number>
    coClears: Map<string, number>
    charData: Map<string, PlayerCharacter>
    categoryMissionProgress: Map<number, number>
    finishedQuestIds: Set<number>
}

export interface AwakeContextSnapshot {
    readonly player?: Player
    readonly characterList?: Record<string, PlayerCharacter>
    readonly questProgress?: Record<string, PlayerQuestProgress[]>
    readonly persistedMissions?: Record<string, PlayerActiveMission>
}

// ─── Special mission tables ───

interface QuestClearTarget {
    category: number
    questIds: number[]
    alternateTargets?: readonly {
        category: number
        questIds: readonly number[]
    }[]
    timeLimitMs?: number
    leaderCharId?: number
}

const QUEST_CLEAR_MAP: Map<number, QuestClearTarget> = new Map([
    [1110013, { category: 2, questIds: [1028004], leaderCharId: 111001 }],
    [1310052, { category: 15, questIds: [BARAK_AWAKE_PRACTICE_QUEST_ID], leaderCharId: 131005 }],
    [1410032, { category: 2, questIds: [1020003] }],
    [2110013, { category: 2, questIds: [1028004], leaderCharId: 211001 }],
    [2310013, {
        category: 21,
        questIds: [1006],
        alternateTargets: [{ category: 2, questIds: [1010004] }],
        timeLimitMs: 90000,
        leaderCharId: 231001,
    }],
    [2510032, { category: 13, questIds: [1020, 1023, 1026, 1029, 1032, 1035, 1038], leaderCharId: 251003 }],
    [2510033, { category: 13, questIds: [1020, 1023, 1026, 1029, 1032, 1035, 1038], timeLimitMs: 180000, leaderCharId: 251003 }],
    [2630023, { category: 18, questIds: [400001104], leaderCharId: 151006 }],
])

const BOND_TOKEN_MISSION_IDS = new Set([1410033, 2210043, 2510043, 2610073])
const LEADER_REQUIRED_IDS = new Set([1510062, 1610022, 1610023, 2610072])
const COOP_MISSION_IDS = new Set([1310053, 1510063])
const COMBO_MISSION_IDS = new Set([1210013])
const POWERFLIP_CHAR_IDS = new Set([1210012])

// Multi-character party missions: mission_id → required character IDs (from col[24])
const MULTI_CHAR_MISSIONS: Map<number, number[]> = new Map([
    [2110012, [211001, 231001]],
    [2210042, [10, 221004]],
    [2410632, [241063, 243007]],
    [2410633, [241063, 243007, 361009]],
    [2510042, [251004, 1]],
])

// ─── Computer ───

function coClearKey(a: number, b: number): string {
    return getCharacterPairKey(a, b)
}

function expandAwakeMissionIds(missionIds?: readonly number[]): number[] | undefined {
    if (!missionIds) return undefined
    const expanded = new Set<number>()
    for (const missionId of missionIds) {
        expanded.add(missionId)
        if (missionId % 10 === AwakeType.ALL_COMPLETE) {
            expanded.add(missionId - 3)
            expanded.add(missionId - 2)
            expanded.add(missionId - 1)
        }
    }
    return [...expanded]
}

export function buildAwakeContext(
    playerId: number,
    missionIds?: readonly number[],
    snapshot: AwakeContextSnapshot = {},
): AwakeContext {
    const player = snapshot.player ?? getPlayerSync(playerId)!
    const scopedMissionIds = expandAwakeMissionIds(missionIds)
    const targetCharacterIds = scopedMissionIds === undefined
        ? undefined
        : new Set(scopedMissionIds.map(getCharacterIdFromMission).map(Number))

    let totalQuestClears = 0, ssClears = 0, sClears = 0, aClears = 0, bClears = 0, totalStories = 0
    const questProgress: CategoryContext["questProgress"] = {}
    const finishedQuestIds = new Set<number>()
    const seenQuests = new Set<string>()

    const appendQuestProgress = (section: string, qp: PlayerQuestProgress) => {
        const list = questProgress[section] ?? []
        const key = `${section}:${qp.questId}`
        if (seenQuests.has(key)) return
        seenQuests.add(key)
        list.push({
            questId: qp.questId, finished: qp.finished, clearRank: qp.clearRank,
            bestElapsedTimeMs: qp.bestElapsedTimeMs, leaderCharacterId: qp.leaderCharacterId,
            multiClearCount: qp.multiClearCount,
        })
        questProgress[section] = list
        if (!qp.finished) return
        finishedQuestIds.add(qp.questId)
        totalQuestClears++
        if (section === "3") totalStories++
        if (qp.clearRank === 5) ssClears++
        else if (qp.clearRank === 4) sClears++
        else if (qp.clearRank === 3) aClears++
        else if (qp.clearRank === 2) bClears++
    }

    if (scopedMissionIds === undefined) {
        const questProgressRaw = snapshot.questProgress ?? getPlayerQuestProgressSync(playerId)
        for (const [section, quests] of Object.entries(questProgressRaw)) {
            for (const qp of quests) appendQuestProgress(section, qp)
        }
    } else {
        const requestedQuests = new Map<string, Set<number>>()
        const addRequestedQuest = (section: number | string, questId: number) => {
            const key = String(section)
            const ids = requestedQuests.get(key) ?? new Set<number>()
            ids.add(questId)
            requestedQuests.set(key, ids)
        }
        for (const missionId of scopedMissionIds) {
            const target = QUEST_CLEAR_MAP.get(missionId)
            if (target) {
                for (const questId of target.questIds) addRequestedQuest(target.category, questId)
                for (const alternate of target.alternateTargets ?? []) {
                    for (const questId of alternate.questIds) {
                        addRequestedQuest(alternate.category, questId)
                    }
                }
            }
            if (STORY_MISSION_IDS.has(missionId)) {
                for (const questId of getCharacterStoryQuestIds(getCharacterIdFromMission(missionId))) {
                    addRequestedQuest(3, questId)
                }
            }
        }
        for (const [section, questIds] of requestedQuests) {
            for (const qp of getPlayerQuestProgressBySectionAndIdsSync(playerId, section, [...questIds])) {
                appendQuestProgress(section, qp)
            }
        }
        if (targetCharacterIds?.has(1)) {
            totalStories = countFinishedPlayerQuestsByCategorySync(playerId, 3)
        }
    }

    const charClears = new Map<string, number>()
    const leaderClears = new Map<string, number>()
    const multiClears = new Map<string, number>()
    const leaderMultiClears = new Map<string, number>()
    const leaderPowerflips = new Map<string, number>()
    const charData = new Map<string, PlayerCharacter>()
    const clearRows = getPlayerCharacterClearsSync(playerId, targetCharacterIds && [...targetCharacterIds])
    const chars = targetCharacterIds === undefined
        ? snapshot.characterList ?? getPlayerCharactersSync(playerId)
        : getPlayerCharactersByIdsSync(playerId, [...targetCharacterIds])
    for (const [cid, char] of Object.entries(chars)) {
        charData.set(cid, char)
    }
    for (const [cid, row] of Object.entries(clearRows)) {
        charClears.set(cid, row.clear_count)
        leaderClears.set(cid, row.leader_clear_count)
        multiClears.set(cid, row.multi_count)
        leaderMultiClears.set(cid, row.leader_multi_count)
        leaderPowerflips.set(cid, row.leader_power_flip_count)
    }

    const pairs = new Map<string, [number, number]>()
    for (const missionId of scopedMissionIds ?? []) {
        const ids = MULTI_CHAR_MISSIONS.get(missionId) ?? []
        for (let i = 0; i < ids.length; i++) {
            for (let j = i + 1; j < ids.length; j++) {
                // Both orientations remain readable for legacy, unnormalised rows.
                pairs.set(`${ids[i]}:${ids[j]}`, [ids[i], ids[j]])
                pairs.set(`${ids[j]}:${ids[i]}`, [ids[j], ids[i]])
            }
        }
    }
    const coClearSelect = "SELECT char_id_a, char_id_b, co_clear_count FROM players_party_member_co_clears WHERE player_id = ?"
    const rows = (scopedMissionIds === undefined
        ? getDb().prepare(coClearSelect).all(playerId)
        : pairs.size === 0 ? [] : getDb().prepare([...pairs].map(() => (
            `${coClearSelect} AND char_id_a = ? AND char_id_b = ?`
        )).join(" UNION ALL ")).all(...[...pairs.values()].flatMap(([a, b]) => [playerId, a, b]))) as {
            char_id_a: number; char_id_b: number; co_clear_count: number
        }[]
    const coClears = mergePartyCoClearRows(rows)

    const categoryMissionProgress = new Map<number, number>()
    const persistedMissions = scopedMissionIds === undefined && snapshot.persistedMissions
        ? snapshot.persistedMissions
        : getPlayerCategoryMissionsSync(playerId, 9, scopedMissionIds)
    for (const [missionId, progress] of Object.entries(persistedMissions)) {
        categoryMissionProgress.set(Number(missionId), progress.progress)
    }

    return {
        category: 9,
        playerId, player, questProgress,
        totalQuestClears, totalStories,
        rankCounts: { rank_ss: ssClears, rank_s: sClears, rank_a: aClears, rank_b: bClears },
        charClears, leaderClears, multiClears, leaderMultiClears,
        leaderPowerflips, coClears, charData, categoryMissionProgress,
        finishedQuestIds, persistedMissions,
    }
}

export const AwakeComputer: MissionComputer = {
    name: "Awake",

    buildContext(
        playerId: number,
        _category: number,
        _evaluationTime: Date,
        missionIds?: readonly number[],
    ): AwakeContext {
        return buildAwakeContext(playerId, missionIds)
    },

    compute(missionId: number, ctx: CategoryContext, dbProgress: number): number {
        const actx = ctx as AwakeContext
        const charId = getCharacterIdFromMission(missionId)
        const lastDigit = missionId % 10

        // Quest-clear missions (checked first, independent of lastDigit)
        const qc = QUEST_CLEAR_MAP.get(missionId)
        if (qc) {
            const targets = [
                { category: qc.category, questIds: qc.questIds as readonly number[] },
                ...(qc.alternateTargets ?? []),
            ]
            const matches = targets.flatMap(target => (
                ctx.questProgress[String(target.category)] ?? []
            ).filter(q => target.questIds.includes(q.questId) && q.finished))
            if (matches.length === 0) return dbProgress
            if (qc.timeLimitMs) {
                const limit = qc.timeLimitMs
                if (!matches.some(q => (q.bestElapsedTimeMs ?? Infinity) <= limit)) return dbProgress
            }
            if (qc.leaderCharId) {
                if (!matches.some(q => q.leaderCharacterId === qc.leaderCharId)) return dbProgress
            }
            return Math.max(dbProgress, 1)
        }

        // Over-limit level missions: progress is the character's current level.
        if (getAwakeLevelMissionTarget(missionId) !== undefined) {
            const char = actx.charData.get(charId)
            const rarity = getCharacterDataSync(Number(charId))?.rarity
            const level = char && rarity !== undefined
                ? estimateExtendedCharacterLevel(Number(charId), rarity, char.exp)
                : 0
            return Math.max(dbProgress, level)
        }

        // Race-composition missions (e.g., 人+龙+魔)
        if (AWAKE_DIRECT_BATTLE_MISSION_IDS.has(missionId)) {
            return Math.max(dbProgress, actx.categoryMissionProgress.get(missionId) ?? 0)
        }

        // Multi-character party missions
        const reqChars = MULTI_CHAR_MISSIONS.get(missionId)
        if (reqChars) {
            // Check min co_clear_count across all pairs
            let minCo = Infinity
            for (let i = 0; i < reqChars.length - 1; i++) {
                for (let j = i + 1; j < reqChars.length; j++) {
                    const count = actx.coClears.get(coClearKey(reqChars[i], reqChars[j])) ?? 0
                    if (count < minCo) minCo = count
                }
            }
            return Math.max(dbProgress, minCo === Infinity ? 0 : minCo)
        }

        const isLeaderRequired = LEADER_REQUIRED_IDS.has(missionId)

        switch (lastDigit) {
            case AwakeType.STORY_READ:
                return Math.max(dbProgress, computeStoryOrParty(missionId, actx, charId))

            case AwakeType.PARTY_OR_SPECIAL:
                if (charId === '1') return Math.max(dbProgress, ctx.totalStories)
                if (charId === '263002') return Math.max(dbProgress, ctx.player.totalManaObtained ?? 0)
                if (POWERFLIP_CHAR_IDS.has(missionId)) {
                    return Math.max(dbProgress, actx.leaderPowerflips.get(charId) ?? 0)
                }
                return Math.max(dbProgress, isLeaderRequired
                    ? actx.leaderClears.get(charId) ?? 0
                    : actx.charClears.get(charId) ?? 0)

            case AwakeType.SPECIAL:
                if (charId === '1') return Math.max(dbProgress, ctx.player.totalPowerflips ?? 0)
                if (BOND_TOKEN_MISSION_IDS.has(missionId)) {
                    const char = actx.charData.get(charId)
                    return Math.max(dbProgress, isBondTokenMissionComplete(char?.bondTokenList) ? 1 : 0)
                }
                if (COOP_MISSION_IDS.has(missionId)) {
                    return Math.max(dbProgress, actx.leaderMultiClears.get(charId) ?? 0)
                }
                if (COMBO_MISSION_IDS.has(missionId)) {
                    return Math.max(dbProgress, ctx.player.maxComboAchieved ?? 0)
                }
                return Math.max(dbProgress, isLeaderRequired
                    ? actx.leaderClears.get(charId) ?? 0
                    : actx.charClears.get(charId) ?? 0)

            case AwakeType.ALL_COMPLETE: {
                let completedCount = 0
                for (const childMissionId of [missionId - 3, missionId - 2, missionId - 1]) {
                    const childDbProgress = actx.categoryMissionProgress.get(childMissionId) ?? 0
                    const childProgress = AwakeComputer.compute(childMissionId, ctx, childDbProgress)
                    if (isMissionProgressComplete(9, childMissionId, childProgress)) completedCount++
                }
                return completedCount
            }
        }

        return dbProgress
    },
}

enum AwakeType {
    STORY_READ = 1,
    PARTY_OR_SPECIAL = 2,
    SPECIAL = 3,
    ALL_COMPLETE = 4,
}

function computeStoryOrParty(missionId: number, actx: AwakeContext, charId: string): number {
    if (STORY_MISSION_IDS.has(missionId)) {
        const storyIds = getCharacterStoryQuestIds(charId)
        let count = 0
        for (const qid of storyIds) if (actx.finishedQuestIds.has(qid)) count++
        return count
    }
    return actx.charClears.get(charId) ?? 0
}
