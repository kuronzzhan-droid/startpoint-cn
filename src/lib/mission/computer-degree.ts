// Degree mission computer (category 5)

import { getDb } from "../../data/db"
import { getPlayerSync } from "../../data/domains/player"
import { getPlayerCharactersManaNodesSync, getPlayerCharactersSync } from "../../data/domains/character"
import { getPlayerEquipmentListSync } from "../../data/domains/equipment"
import { getPlayerItemsSync } from "../../data/domains/item"
import { getMissionBattleCountersSync } from "../../data/domains/mission_battle_facts"
import { getPlayerShopPurchasesMapSync } from "../../data/domains/shopPurchase"
import {
    countFinishedPlayerQuestsByCategorySync,
    getPlayerQuestProgressSync,
} from "../../data/domains/quest"
import type { PlayerCharacter, PlayerEquipment } from "../../data/types"
import { getCharacterDataSync, getCharacterManaNodesSync } from "../assets"
import { characterExpCaps } from "../character"
import { getRankDegree } from "../stamina"
import { getMissionMasterDefinition, getMissionMasterDefinitions } from "./master-data"
import { getMissionPattern } from "./patterns"
import type { MissionComputer, CategoryContext, PlayerQuestProgressEntry } from "./types"

type DegreeRow = readonly unknown[]

interface DegreeDefinition {
    conditionType: number
    row: DegreeRow
    description: string
    pattern: string
}

interface DegreeQuestProgressEntry extends PlayerQuestProgressEntry {
    section: number
    hostFinished?: boolean
    highScore?: number
}

interface QuestFilter {
    categories: number[]
    exactQuestIds?: Set<number>
    eventPrefix?: number
    bossId?: number
}

interface DegreeContext extends CategoryContext {
    characters: Record<string, PlayerCharacter>
    manaNodes: Record<string, number[]>
    equipment: Record<string, PlayerEquipment>
    items: Record<string, number>
    flatQuestProgress: DegreeQuestProgressEntry[]
    completedSecondBoards: Set<number>
    questClearCounters: Map<string, number>
    counterValues: Map<string, number>
    treasureShopPurchaseCount: number
}

// Degree mission target lookup
const degreeTargetMap: Record<number, number> = {}
{
    // Note: this import is resolved at module load time via the patterns file's data
    // but we use the same degreeDefs. For simplicity, inline the regex.
    const degreeDefs = require("../../../assets/mission_degree.json")
    const descRegex = /玩家(?:达到|级别达到)\s*(\d+)/
    for (const [mid, rows] of Object.entries(degreeDefs as Record<string, any>)) {
        const row = (rows as any[])[0]
        if (!row || !row[2]) continue
        const match = descRegex.exec(String(row[2]))
        if (match) degreeTargetMap[parseInt(mid)] = parseInt(match[1])
    }
}

export function getTargetDegree(missionId: number): number | undefined {
    return degreeTargetMap[missionId]
}

const degreeDefinitions = new Map<number, DegreeDefinition>()
const mainQuestIdsByChapter = new Map<number, number[]>()
const exQuestIdsByChapter = new Map<number, number[]>()
const bossQuestIdsByBoss = new Map<number, number[]>()
const treasureShopItemIds = new Set(
    Object.keys(require("../../../assets/treasure_shop.json") as Record<string, unknown>),
)

function optionalNumber(value: unknown): number | undefined {
    if (value === undefined || value === null) return undefined
    const text = String(value).trim()
    if (!text || text === "(None)") return undefined
    const parsed = Number(text)
    return Number.isFinite(parsed) ? parsed : undefined
}

function numberList(value: unknown): number[] {
    if (value === undefined || value === null) return []
    const text = String(value).trim()
    if (!text || text === "(None)") return []
    return text
        .split(",")
        .map(item => Number(item.trim()))
        .filter(Number.isFinite)
}

function addQuestIdByChapter(target: Map<number, number[]>, questIdText: string): void {
    const questId = Number(questIdText)
    if (!Number.isFinite(questId)) return
    const chapter = Math.floor(questId / 1_000_000)
    if (chapter <= 0) return
    const bucket = target.get(chapter) ?? []
    bucket.push(questId)
    target.set(chapter, bucket)
}

{
    for (const definition of getMissionMasterDefinitions(5)) {
        const conditionType = optionalNumber(definition.row[3])
        if (conditionType === undefined) continue
        degreeDefinitions.set(definition.missionId, {
            conditionType,
            row: definition.row,
            description: String(definition.row[2] ?? ""),
            pattern: definition.pattern,
        })
    }

    const mainQuests = require("../../../assets/main_quest.json") as Record<string, unknown>
    const exQuests = require("../../../assets/ex_quest.json") as Record<string, unknown>
    const bossQuests = require("../../../assets/boss_battle_quest.json") as Record<string, unknown>
    for (const questId of Object.keys(mainQuests)) addQuestIdByChapter(mainQuestIdsByChapter, questId)
    for (const questId of Object.keys(exQuests)) addQuestIdByChapter(exQuestIdsByChapter, questId)
    for (const questIdText of Object.keys(bossQuests)) {
        const questId = Number(questIdText)
        if (!Number.isFinite(questId) || questId < 1_000_000) continue
        const bossId = Math.floor((questId - 1_000_000) / 1_000)
        const bucket = bossQuestIdsByBoss.get(bossId) ?? []
        bucket.push(questId)
        bossQuestIdsByBoss.set(bossId, bucket)
    }
    for (const questIds of bossQuestIdsByBoss.values()) questIds.sort((a, b) => a - b)
}

function estimateCharacterLevel(characterId: number, exp: number): number {
    const rarity = getCharacterDataSync(characterId)?.rarity
    if (rarity === undefined) return 0
    const caps = characterExpCaps[rarity]
    if (!caps || caps.length === 0) return 0
    const baseLevel = 40 + (rarity - 1) * 10
    let level = baseLevel - 1
    for (let index = 0; index < caps.length; index++) {
        if (exp < caps[index]) break
        level = baseLevel + index * 5
    }
    return level
}

function counterKey(dimension: string, qualifier: Record<string, unknown> = {}): string {
    const normalized: Record<string, unknown> = {}
    for (const key of Object.keys(qualifier).sort()) {
        const value = qualifier[key]
        if (value !== undefined && value !== null && value !== "" && value !== "(None)") {
            normalized[key] = value
        }
    }
    return `${dimension}|${JSON.stringify(normalized)}`
}

function loadCounterMaps(playerId: number): {
    questClearCounters: Map<string, number>
    counterValues: Map<string, number>
} {
    const rows = getDb().prepare(`
        SELECT dimension, qualifier_json, value
        FROM players_mission_counters
        WHERE player_id = ?
    `).all(playerId) as { dimension: string; qualifier_json: string; value: number }[]

    const questClearCounters = new Map<string, number>()
    const counterValues = new Map<string, number>()
    for (const row of rows) {
        let qualifier: Record<string, unknown> = {}
        try {
            qualifier = JSON.parse(row.qualifier_json || "{}")
        } catch {
            qualifier = {}
        }
        counterValues.set(counterKey(row.dimension, qualifier), Number(row.value) || 0)
        if (row.dimension !== "battle.quest_clear") continue
        const questCategory = optionalNumber(qualifier.questCategory)
        const questId = optionalNumber(qualifier.questId)
        const mode = String(qualifier.mode ?? "any")
        if (questCategory !== undefined && questId !== undefined) {
            questClearCounters.set(
                `${questCategory}:${questId}:${mode}`,
                Number(row.value) || 0,
            )
        }
    }
    return { questClearCounters, counterValues }
}

function buildStats(
    playerId: number,
    category: number,
    missionIds?: readonly number[],
): DegreeContext {
    const selectedDefinitions = missionIds === undefined
        ? [...degreeDefinitions.values()]
        : missionIds
            .map(missionId => degreeDefinitions.get(missionId))
            .filter((definition): definition is DegreeDefinition => definition !== undefined)
    const conditionTypes = new Set(selectedDefinitions.map(definition => definition.conditionType))
    const needsQuestProgress = [14, 15, 16, 22, 23, 25, 26]
        .some(conditionType => conditionTypes.has(conditionType))
    const needsCharacters = [4, 5, 8, 9, 44, 48]
        .some(conditionType => conditionTypes.has(conditionType))
    const needsManaNodes = conditionTypes.has(7) || conditionTypes.has(48)
    const needsCounters = [3, 14, 16, 17, 19, 20, 23, 26, 28, 30, 31, 34, 36, 45, 92]
        .some(conditionType => conditionTypes.has(conditionType))
    const needsBattleCounters = conditionTypes.has(16)
        || conditionTypes.has(17)
        || conditionTypes.has(26)
    const player = getPlayerSync(playerId)!
    const characters = needsCharacters ? getPlayerCharactersSync(playerId) : {}
    const manaNodes = needsManaNodes ? getPlayerCharactersManaNodesSync(playerId) : {}
    const battleCounters = needsBattleCounters
        ? getMissionBattleCountersSync(playerId)
        : {
            singlePlayCount: 0,
            singleClearCount: 0,
            multiPlayCount: 0,
            multiClearCount: 0,
            multiHostClearCount: 0,
            multiGuestClearCount: 0,
            singleRankSsCount: 0,
            rankSsCount: 0,
            rankSCount: 0,
            rankACount: 0,
            rankBCount: 0,
        }
    const rawQuestProgress = needsQuestProgress ? getPlayerQuestProgressSync(playerId) : {}
    const questProgress: Record<string, PlayerQuestProgressEntry[]> = {}
    const flatQuestProgress: DegreeQuestProgressEntry[] = []
    for (const [sectionText, entries] of Object.entries(rawQuestProgress)) {
        const section = Number(sectionText)
        questProgress[sectionText] = entries.map(entry => ({
            questId: entry.questId,
            finished: entry.finished,
            clearRank: entry.clearRank,
            bestElapsedTimeMs: entry.bestElapsedTimeMs,
            leaderCharacterId: entry.leaderCharacterId,
            multiClearCount: entry.multiClearCount,
        }))
        for (const entry of entries) {
            flatQuestProgress.push({
                section,
                questId: entry.questId,
                finished: entry.finished,
                hostFinished: entry.hostFinished,
                highScore: entry.highScore,
                clearRank: entry.clearRank,
                bestElapsedTimeMs: entry.bestElapsedTimeMs,
                leaderCharacterId: entry.leaderCharacterId,
                multiClearCount: entry.multiClearCount,
            })
        }
    }
    const characterLevels = new Map<number, number>()
    const completedSecondManaBoardCharacterIds = new Set<number>()
    for (const [characterIdValue, character] of Object.entries(characters)) {
        const characterId = Number(characterIdValue)
        characterLevels.set(characterId, estimateCharacterLevel(characterId, character.exp))

        const secondBoard = getCharacterManaNodesSync(characterId, 2)
        if (!secondBoard) continue
        const requiredNodes = Object.keys(secondBoard).map(Number)
        if (requiredNodes.length === 0) continue
        const unlockedNodes = new Set(manaNodes[characterIdValue] ?? [])
        if (requiredNodes.every(nodeId => unlockedNodes.has(nodeId))) {
            completedSecondManaBoardCharacterIds.add(characterId)
        }
    }
    const counters = needsCounters
        ? loadCounterMaps(playerId)
        : { questClearCounters: new Map<string, number>(), counterValues: new Map<string, number>() }
    const shopPurchases = conditionTypes.has(45) ? getPlayerShopPurchasesMapSync(playerId) : {}
    return {
        category,
        playerId,
        player,
        questProgress,
        totalQuestClears: 0,
        totalStories: 0,
        rankCounts: {},
        characters,
        manaNodes,
        equipment: conditionTypes.has(34) || conditionTypes.has(36)
            ? getPlayerEquipmentListSync(playerId)
            : {},
        items: conditionTypes.has(37) ? getPlayerItemsSync(playerId) : {},
        flatQuestProgress,
        completedSecondBoards: completedSecondManaBoardCharacterIds,
        ...counters,
        treasureShopPurchaseCount: [...treasureShopItemIds].reduce(
            (total, shopItemId) => total + Math.max(0, shopPurchases[Number(shopItemId)] ?? 0),
            0,
        ),
        battleCounters,
        degreeStats: {
            companionCount: Object.keys(characters).length,
            maxCharacterLevel: Math.max(0, ...characterLevels.values()),
            overLimitCount: Object.values(characters)
                .reduce((total, character) => total + character.overLimitStep, 0),
            manaBoardCount: Object.values(manaNodes)
                .reduce((total, nodes) => total + nodes.length, 0),
            secondManaBoardCompleteCount: completedSecondManaBoardCharacterIds.size,
            bondTokenCount: Object.values(characters)
                .reduce((total, character) => total
                    + character.bondTokenList.filter(token => token.status >= 2).length, 0),
            singleSsCount: battleCounters.singleRankSsCount,
            multiClearCount: battleCounters.multiClearCount,
            multiHostClearCount: battleCounters.multiHostClearCount,
            episodeClearCount: conditionTypes.has(21)
                ? countFinishedPlayerQuestsByCategorySync(playerId, 3)
                : 0,
            level100BondedCharacterIds: new Set(Object.entries(characters)
                .filter(([characterId, character]) => (
                    (characterLevels.get(Number(characterId)) ?? 0) >= 100
                    && character.bondTokenList.some(token => token.status >= 2)
                ))
                .map(([characterId]) => Number(characterId))),
            completedSecondManaBoardCharacterIds,
        },
    }
}

function getCharacterFavorProgress(
    characterId: number,
    character: PlayerCharacter | undefined,
): number {
    if (!character) return 0
    const asset = getCharacterDataSync(characterId)
    const expCaps = asset ? characterExpCaps[asset.rarity] : undefined
    const level100Exp = expCaps?.[expCaps.length - 1]
    const reachedLevel100 = level100Exp !== undefined && character.exp >= level100Exp
    const receivedBondToken = character.bondTokenList.some(token => token.status >= 2)
    return Number(reachedLevel100) + Number(receivedBondToken)
}

function questCategoriesForKind(kind: number | undefined): number[] {
    switch (kind) {
        case 0: return [1]
        case 1: return [4]
        case 2: return [2]
        case 3: return [6]
        case 4: return [14]
        case 5: return [7, 8]
        case 6: return [10]
        case 7: return [13]
        case 8: return [11]
        case 9: return [18]
        case 10: return [19]
        case 11: return [15]
        case 12: return [13, 14, 20]
        case 13: return [20]
        case 14: return [21]
        case 15: return [22]
        case 16: return [23]
        case 17: return [24]
        case 18: return [25]
        case 19: return [26]
        case 20: return [27]
        default: return []
    }
}

function resolveQuestFilter(row: DegreeRow): QuestFilter {
    const kind = optionalNumber(row[8])
    const eventOrChapter = optionalNumber(row[9])
    const bossId = optionalNumber(row[10])
    const questRankOrId = optionalNumber(row[11])
    const difficultyId = optionalNumber(row[12])
    const filter: QuestFilter = { categories: questCategoriesForKind(kind) }

    if (kind === 2) {
        if (bossId !== undefined && difficultyId !== undefined) {
            const requestedQuestId = 1_000_000 + bossId * 1_000 + difficultyId
            const availableQuestIds = bossQuestIdsByBoss.get(bossId) ?? []
            const resolvedQuestId = availableQuestIds.includes(requestedQuestId)
                ? requestedQuestId
                : availableQuestIds[availableQuestIds.length - 1]
            if (resolvedQuestId !== undefined) {
                filter.exactQuestIds = new Set([resolvedQuestId])
            } else {
                filter.bossId = bossId
            }
        } else if (bossId !== undefined) {
            filter.bossId = bossId
        }
        return filter
    }

    if (kind === 11) {
        const practiceIds = numberList(row[11])
        if (practiceIds.length > 0) filter.exactQuestIds = new Set(practiceIds)
        return filter
    }

    if (kind === 19 && eventOrChapter !== undefined) {
        filter.exactQuestIds = new Set([eventOrChapter])
        return filter
    }

    if (eventOrChapter !== undefined && questRankOrId !== undefined) {
        filter.exactQuestIds = new Set([eventOrChapter * 1_000 + questRankOrId])
    } else if (eventOrChapter !== undefined) {
        filter.eventPrefix = eventOrChapter
    }
    return filter
}

function matchesQuest(filter: QuestFilter, section: number, questId: number): boolean {
    if (filter.categories.length > 0 && !filter.categories.includes(section)) return false
    if (filter.exactQuestIds && !filter.exactQuestIds.has(questId)) return false
    if (filter.bossId !== undefined) {
        const actualBossId = Math.floor((questId - 1_000_000) / 1_000)
        if (actualBossId !== filter.bossId) return false
    }
    if (
        filter.eventPrefix !== undefined
        && Math.floor(questId / 1_000) !== filter.eventPrefix
    ) {
        return false
    }
    return true
}

function requestedBattleMode(row: DegreeRow): "single" | "multi" | "any" {
    const battleKind = optionalNumber(row[6])
    if (battleKind === 1) return "single"
    if (battleKind === 2) return "multi"
    return "any"
}

function countQuestClears(
    ctx: DegreeContext,
    filter: QuestFilter,
    mode: "single" | "multi" | "any",
): number {
    let storedProgressCount = 0
    for (const entry of ctx.flatQuestProgress) {
        if (!entry.finished || !matchesQuest(filter, entry.section, entry.questId)) continue
        if (mode === "multi" || mode === "any") {
            storedProgressCount += Math.max(1, entry.multiClearCount ?? 0)
        } else {
            storedProgressCount += 1
        }
    }

    let counterCount = 0
    for (const [key, value] of ctx.questClearCounters) {
        const [categoryText, questIdText, counterMode] = key.split(":")
        if (counterMode !== mode) continue
        const section = Number(categoryText)
        const questId = Number(questIdText)
        if (matchesQuest(filter, section, questId)) counterCount += value
    }
    return Math.max(storedProgressCount, counterCount)
}

function readCounter(
    ctx: DegreeContext,
    dimension: string,
    qualifier: Record<string, unknown> = {},
): number {
    return ctx.counterValues.get(counterKey(dimension, qualifier)) ?? 0
}

function completedChapter(ctx: DegreeContext, chapter: number): boolean {
    const requiredMain = mainQuestIdsByChapter.get(chapter) ?? []
    const requiredEx = exQuestIdsByChapter.get(chapter) ?? []
    if (requiredMain.length === 0 || requiredEx.length === 0) return false
    const finished = new Set(
        ctx.flatQuestProgress
            .filter(entry => entry.finished && (entry.section === 1 || entry.section === 4))
            .map(entry => `${entry.section}:${entry.questId}`),
    )
    return requiredMain.every(id => finished.has(`1:${id}`))
        && requiredEx.every(id => finished.has(`4:${id}`))
}

function bestSingleClearTimeMs(ctx: DegreeContext): number | undefined {
    const times = ctx.flatQuestProgress
        .filter(entry => entry.finished && entry.bestElapsedTimeMs !== undefined)
        .map(entry => Number(entry.bestElapsedTimeMs))
        .filter(value => Number.isFinite(value) && value > 0)
    return times.length > 0 ? Math.min(...times) : undefined
}

function maxHighScore(ctx: DegreeContext): number {
    return Math.max(0, ...ctx.flatQuestProgress.map(entry => Number(entry.highScore) || 0))
}

function maxClearRankCount(ctx: DegreeContext, rank: number): number {
    const historical = ctx.flatQuestProgress
        .filter(entry => entry.finished && entry.clearRank === rank)
        .length
    const counter = readCounter(ctx, "battle.rank_clear", { rank })
    return Math.max(historical, counter)
}

const SUPPORTED_FAMILIES = {
    playerRank: "degree_player_rank_growth_",
    companionCount: "degree_companion_add_",
    characterLevel: "degree_character_lv_growth_",
    overLimitCount: "degree_overlimit_growth_",
    manaBoardCount: "degree_manaboard_growth_",
    secondManaBoardCompleteCount: "degree_manaboard_all_growth_",
    bondTokenCount: "degree_proof_of_bond_get_",
    singleSsCount: "degree_rank_ss_clear_single_",
    multiClearCount: "degree_multi_battle_clear_",
    multiHostClearCount: "degree_multi_battle_by_host_clear_",
    episodeClearCount: "degree_character_episode_read_",
} as const

const SERVER_COMPUTED_CONDITION_TYPES = new Set([
    0, 1, 3, 4, 5, 7, 8, 9, 14, 15, 16, 17, 19, 20, 21, 22, 23, 25, 26,
    28, 30, 31, 34, 36, 37, 39, 44, 45, 48, 92,
])

const CLIENT_REPORTED_CONDITION_TYPES = new Set([40, 41, 42, 43])

export function getDegreeMissionCoverageReport() {
    const definitions = getMissionMasterDefinitions(5)
    const conditionTypeCounts: Record<number, number> = {}
    for (const definition of definitions) {
        const conditionType = optionalNumber(definition.row[3])
        if (conditionType === undefined) continue
        conditionTypeCounts[conditionType] = (conditionTypeCounts[conditionType] ?? 0) + 1
    }
    const serverComputed = definitions.filter(definition => (
        SERVER_COMPUTED_CONDITION_TYPES.has(Number(definition.row[3]))
        || (
            Number(definition.row[3]) === 28
            && [0, 2, 4, 5, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16].includes(Number(definition.row[4]))
        )
    )).length
    const clientReported = definitions.filter(definition => (
        CLIENT_REPORTED_CONDITION_TYPES.has(Number(definition.row[3]))
    )).length
    return {
        total: definitions.length,
        serverComputed,
        clientReported,
        persistedOnly: definitions.length - serverComputed - clientReported,
        conditionTypeCounts,
    }
}

/** Reverse-index title missions by the master-data condition they use. */
export function getDegreeMissionIdsForConditionTypes(
    conditionTypes: readonly number[],
    characterIds?: readonly number[],
    itemIds?: readonly number[],
): number[] {
    const requested = new Set(conditionTypes)
    const requestedCharacters = characterIds === undefined
        ? undefined
        : new Set(characterIds.filter(characterId => Number.isFinite(characterId) && characterId > 0))
    const requestedItems = itemIds === undefined
        ? undefined
        : new Set(itemIds.filter(itemId => Number.isFinite(itemId) && itemId > 0))
    if (requested.size === 0) return []
    return [...degreeDefinitions.entries()]
        .filter(([, definition]) => {
            if (!requested.has(definition.conditionType)) return false
            if (
                requestedCharacters !== undefined
                && (definition.conditionType === 44 || definition.conditionType === 48)
            ) {
                const targetCharacterId = optionalNumber(definition.row[15])
                return targetCharacterId === undefined || requestedCharacters.has(targetCharacterId)
            }
            if (requestedItems !== undefined && definition.conditionType === 37) {
                const targetItemId = optionalNumber(definition.row[13])
                return targetItemId === undefined || requestedItems.has(targetItemId)
            }
            return true
        })
        .map(([missionId]) => missionId)
}

export function getSpecificCharacterId(
    missionId: number,
    missionType: 44 | 48,
): number | undefined {
    const definition = getMissionMasterDefinition(5, missionId)
    if (!definition || Number(definition.row[3]) !== missionType) return undefined
    const characterId = Number(definition.row[15])
    return Number.isSafeInteger(characterId) && characterId > 0 ? characterId : undefined
}

function computeRecoverableProgress(
    definition: DegreeDefinition,
    ctx: DegreeContext,
): number | undefined {
    const { conditionType, row, description, pattern } = definition
    const stats = ctx.degreeStats
    switch (conditionType) {
        case 0:
            return ctx.player.totalLoginDays
        case 1:
            return getRankDegree(ctx.player.rankPoint)
        case 3:
            return readCounter(ctx, "shop.treasure_mana_spent")
        case 4:
            return stats?.companionCount
        case 5:
            return stats?.maxCharacterLevel
        case 7:
            return stats?.manaBoardCount
        case 8:
            return stats?.bondTokenCount
        case 9:
            return stats?.overLimitCount
        case 14:
            return countQuestClears(ctx, resolveQuestFilter(row), "single")
        case 15: {
            const secondsMatch = description.match(/(\d+)/)
            const seconds = secondsMatch ? Number(secondsMatch[1]) : undefined
            const bestMs = bestSingleClearTimeMs(ctx)
            return seconds !== undefined && bestMs !== undefined && bestMs <= seconds * 1000
                ? 1
                : 0
        }
        case 16: {
            const persistedMulti = ctx.flatQuestProgress.reduce(
                (sum, entry) => sum + Math.max(0, entry.multiClearCount ?? 0),
                0,
            )
            return Math.max(
                persistedMulti,
                stats?.multiClearCount ?? 0,
                readCounter(ctx, "battle.clear", { mode: "multi" }),
            )
        }
        case 17:
            return Math.max(
                stats?.multiHostClearCount ?? 0,
                readCounter(ctx, "battle.multi_role_clear", { role: "host" }),
            )
        case 19:
            return readCounter(ctx, "battle.multi_mvp")
        case 20:
            return readCounter(ctx, "battle.multi_rescue_clear")
        case 92:
            return readCounter(ctx, "battle.multi_newbie_rescue_clear")
        case 21:
            return stats?.episodeClearCount
        case 22: {
            const chapter = optionalNumber(row[9])
            return chapter !== undefined && completedChapter(ctx, chapter) ? 1 : 0
        }
        case 23:
            return countQuestClears(ctx, resolveQuestFilter(row), requestedBattleMode(row))
        case 25:
            return maxHighScore(ctx)
        case 26: {
            if (pattern.startsWith(SUPPORTED_FAMILIES.singleSsCount)) {
                return stats?.singleSsCount
            }
            const filter = resolveQuestFilter(row)
            if (filter.exactQuestIds && filter.exactQuestIds.size > 0) {
                return ctx.flatQuestProgress.some(
                    entry => entry.finished
                        && entry.clearRank === 5
                        && matchesQuest(filter, entry.section, entry.questId),
                ) ? 1 : 0
            }
            return maxClearRankCount(ctx, 5)
        }
        case 28: {
            const statisticKind = optionalNumber(row[4])
            const mode = requestedBattleMode(row)
            const kindByStatistic: Readonly<Record<number, string>> = {
                0: "weak_point",
                2: "dash",
                4: "skill",
                5: "fever",
                7: "enemy_kill",
                8: "emotion",
                9: "buff_companion",
                10: "heal_companion",
                11: "coffin_reduce",
                12: "clear_debuff_self",
                13: "debuff_enemy",
                14: "clear_buff_enemy",
                15: "fever_time_ms",
                16: "power_flip_lv3",
            }
            const kind = statisticKind === undefined ? undefined : kindByStatistic[statisticKind]
            if (!kind) return undefined
            const currentCounter = readCounter(ctx, "battle.stat", { kind, mode })
            const legacyCounter = mode === "any"
                ? readCounter(ctx, "battle.stat", { kind })
                : 0
            if (statisticKind === 2 && mode === "any") {
                return Math.max(
                    ctx.player.totalDashes,
                    currentCounter,
                    legacyCounter,
                )
            }
            if (statisticKind === 15) {
                return Math.floor(Math.max(currentCounter, legacyCounter) / 1000)
            }
            return Math.max(currentCounter, legacyCounter)
        }
        case 30:
            return Math.max(ctx.player.maxComboAchieved, readCounter(ctx, "battle.max_combo"))
        case 31:
            return readCounter(ctx, "battle.max_skill_chain")
        case 34:
            return Math.max(
                Object.values(ctx.equipment).reduce(
                    (sum, equipment) => sum + Math.max(0, equipment.level - 1),
                    0,
                ),
                readCounter(ctx, "equipment.awakening"),
            )
        case 36:
            return Math.max(
                Object.values(ctx.equipment)
                    .filter(equipment => equipment.level >= 5)
                    .length,
                readCounter(ctx, "equipment.lv5_count"),
            )
        case 37: {
            const itemId = optionalNumber(row[13])
            return itemId === undefined ? undefined : (ctx.items[String(itemId)] ?? 0)
        }
        case 39:
            return ctx.player.totalStaminaUsed
        case 44: {
            const characterId = optionalNumber(row[15])
            if (characterId === undefined) return 0
            return getCharacterFavorProgress(characterId, ctx.characters[String(characterId)])
        }
        case 45:
            return Math.max(
                ctx.treasureShopPurchaseCount,
                readCounter(ctx, "shop.treasure_purchase"),
            )
        case 48: {
            const characterId = optionalNumber(row[15])
            return characterId === undefined
                ? ctx.completedSecondBoards.size
                : Number(ctx.completedSecondBoards.has(characterId))
        }
        default:
            return undefined
    }
}

export const DegreeComputer: MissionComputer = {
    name: "Degree",

    buildContext(
        playerId: number,
        category: number,
        _evaluationTime: Date,
        missionIds?: readonly number[],
    ): CategoryContext {
        return buildStats(playerId, category, missionIds)
    },

    compute(missionId: number, ctx: CategoryContext, dbProgress: number): number {
        const definition = degreeDefinitions.get(missionId)
        if (definition) {
            const recoverable = computeRecoverableProgress(definition, ctx as DegreeContext)
            if (recoverable !== undefined) return Math.max(dbProgress, recoverable)
        }

        const pattern = getMissionPattern(5, missionId)
        const stats = ctx.degreeStats
        if (pattern.startsWith(SUPPORTED_FAMILIES.playerRank)) return getRankDegree(ctx.player.rankPoint)
        if (!stats) return dbProgress
        const bondCharacterId = getSpecificCharacterId(missionId, 44)
        if (bondCharacterId !== undefined) {
            return Math.max(dbProgress, stats.level100BondedCharacterIds.has(bondCharacterId) ? 1 : 0)
        }
        const secondManaBoardCharacterId = getSpecificCharacterId(missionId, 48)
        if (secondManaBoardCharacterId !== undefined) {
            return Math.max(
                dbProgress,
                stats.completedSecondManaBoardCharacterIds.has(secondManaBoardCharacterId) ? 1 : 0,
            )
        }
        if (pattern.startsWith(SUPPORTED_FAMILIES.companionCount)) return stats.companionCount
        if (pattern.startsWith(SUPPORTED_FAMILIES.characterLevel)) {
            return Math.max(dbProgress, stats.maxCharacterLevel)
        }
        if (pattern.startsWith(SUPPORTED_FAMILIES.overLimitCount)) return stats.overLimitCount
        if (pattern.startsWith(SUPPORTED_FAMILIES.manaBoardCount)) return stats.manaBoardCount
        if (pattern.startsWith(SUPPORTED_FAMILIES.secondManaBoardCompleteCount)) {
            return Math.max(dbProgress, stats.secondManaBoardCompleteCount)
        }
        if (pattern.startsWith(SUPPORTED_FAMILIES.bondTokenCount)) return stats.bondTokenCount
        if (pattern.startsWith(SUPPORTED_FAMILIES.singleSsCount)) return stats.singleSsCount
        if (pattern.startsWith(SUPPORTED_FAMILIES.multiClearCount)) {
            return Math.max(dbProgress, stats.multiClearCount)
        }
        if (pattern.startsWith(SUPPORTED_FAMILIES.multiHostClearCount)) {
            return Math.max(dbProgress, stats.multiHostClearCount)
        }
        if (pattern.startsWith(SUPPORTED_FAMILIES.episodeClearCount)) {
            return Math.max(dbProgress, stats.episodeClearCount)
        }
        return dbProgress
    },
}
