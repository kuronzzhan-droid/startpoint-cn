// Dormant degree (category 5) evaluation context: one read pass per compute round, handed on as a
// frozen snapshot. Two SOURCE defects are corrected rather than ported. (1) The counter reader keyed
// rows by `dimension|qualifier` while the stored counter_key is the four segment
// `dimension|scopeType|scopeKey|qualifier`, and its SELECT had no scope filter, so every
// character-scoped row collapsed onto the lifetime key and the last row read won. Only lifetime/all
// rows load now and each key is re-derived and compared against the stored column; under the tracked
// writers that is behaviour preserving, because all fourteen dimensions the compute path reads are
// written with scopeType "lifetime" / scopeKey "all". (2) Bad storage used to become 0 (`catch ->
// {}`, `Number(x) || 0`, `getPlayerSync(...)!`); it aborts the build here instead, because a title
// that silently reads 0 cannot be told apart from one that is genuinely at 0.

import { getDb } from "../../../data/db"
import { getPlayerCharactersManaNodesSync, getPlayerCharactersSync } from "../../../data/domains/character"
import { getPlayerEquipmentListSync } from "../../../data/domains/equipment"
import { getPlayerItemsSync } from "../../../data/domains/item"
import { getMissionBattleCountersSync } from "../../../data/domains/mission_battle_facts"
import { getPlayerSync } from "../../../data/domains/player"
import {
    countFinishedPlayerQuestsByCategorySync,
    getPlayerQuestProgressSync,
} from "../../../data/domains/quest"
import { getPlayerShopPurchasesMapSync } from "../../../data/domains/shopPurchase"
import type { PlayerCharacter, PlayerEquipment } from "../../../data/types"
import { getCharacterDataSync, getCharacterManaNodesSync } from "../../assets"
import { characterExpCaps } from "../../character"
import type { CategoryContext, PlayerQuestProgressEntry } from "../types"
import { DEGREE_CATEGORY, getDegreeMasterIndex } from "./master-index"
import type { DegreeMasterIndex } from "./master-index"

const COUNTER_TABLE = "players_mission_counters"
const LIFETIME_SCOPE_TYPE = "lifetime"
const LIFETIME_SCOPE_KEY = "all"
const QUEST_CLEAR_DIMENSION = "battle.quest_clear"
const NONE_SENTINEL = "(None)"
const BATTLE_MODES: readonly string[] = ["single", "multi", "any"]
const CANONICAL_UNSIGNED = /^(0|[1-9]\d*)$/
const CANONICAL_POSITIVE = /^[1-9]\d*$/
// The board the "all nodes unlocked" titles ask about, the quest section holding character
// episodes, the bonded level and the received bond-token status. One per line: unrelated targets.
const SECOND_MANA_BOARD = 2
const EPISODE_QUEST_SECTION = 3
const BONDED_LEVEL = 100
const BOND_TOKEN_RECEIVED = 2

// Which condition types force which table to be read; needing none of them never touches the table.
const NEEDS_QUEST_PROGRESS = [14, 15, 16, 22, 23, 25, 26]
const NEEDS_CHARACTERS = [4, 5, 8, 9, 44, 48]
const NEEDS_MANA_NODES = [7, 48]
const NEEDS_COUNTERS = [3, 14, 16, 17, 19, 20, 23, 26, 28, 30, 31, 34, 36, 45, 92]
const NEEDS_BATTLE_COUNTERS = [16, 17, 26]
const NEEDS_EQUIPMENT = [34, 36]
const NEEDS_ITEMS = [37]
const NEEDS_SHOP_PURCHASES = [45]
const NEEDS_EPISODE_CLEARS = [21]

const DEGREE_CONTEXT_BRAND: unique symbol = Symbol("wdfp/degree-context/v2")
const EMPTY_RECORD = Object.freeze({}) as Readonly<Record<string, never>>
const EMPTY_BATTLE_COUNTERS = Object.freeze({
    singlePlayCount: 0, singleClearCount: 0, multiPlayCount: 0, multiClearCount: 0,
    multiHostClearCount: 0, multiGuestClearCount: 0, singleRankSsCount: 0, rankSsCount: 0,
    rankSCount: 0, rankACount: 0, rankBCount: 0,
})

export type DegreeCounterQualifier = Record<string, string | number | boolean>

export interface DegreeQuestProgressEntry extends PlayerQuestProgressEntry {
    readonly section: number
    readonly highScore: number | undefined
}

/** Parsed once here so the evaluator never has to `Number()` its way back out of a joined key. */
export interface DegreeQuestClearCounter {
    readonly questCategory: number
    readonly questId: number
    readonly mode: string
    readonly value: number
}

export interface DegreeContext extends CategoryContext {
    readonly [DEGREE_CONTEXT_BRAND]: true
    /** Always present here, unlike on CategoryContext, so the computer needs no fallback branch. */
    readonly degreeStats: NonNullable<CategoryContext["degreeStats"]>
    readonly evaluationTime: Date
    readonly masterIndex: DegreeMasterIndex
    readonly characters: Readonly<Record<string, PlayerCharacter>>
    readonly manaNodes: Readonly<Record<string, readonly number[]>>
    readonly equipment: Readonly<Record<string, PlayerEquipment>>
    readonly items: Readonly<Record<string, number>>
    readonly flatQuestProgress: readonly DegreeQuestProgressEntry[]
    readonly completedSecondBoards: ReadonlySet<number>
    readonly questClearCounters: readonly DegreeQuestClearCounter[]
    readonly counterValues: Readonly<Record<string, number>>
    readonly treasureShopPurchaseCount: number
}

export function unsignedSafeInteger(value: unknown, name: string): number {
    if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(`${name} must be a finite number`)
    if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${name} must be a non-negative safe integer`)
    return value
}
export function positiveSafeInteger(value: unknown, name: string): number {
    if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(`${name} must be a finite number`)
    if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${name} must be a positive safe integer`)
    return value
}
const optionalUnsigned = (value: unknown, name: string): number | undefined =>
    value === undefined || value === null ? undefined : unsignedSafeInteger(value, name)
/** Record keys arrive as strings from the database and the assets alike; `Number()` is too lax. */
function canonicalRecordKey(key: string, name: string, allowZero = false): number {
    if (!(allowZero ? CANONICAL_UNSIGNED : CANONICAL_POSITIVE).test(key)) {
        throw new RangeError(`${name} must be a canonical decimal key`)
    }
    const parsed = Number(key)
    if (!Number.isSafeInteger(parsed)) throw new RangeError(`${name} must stay a safe integer`)
    return parsed
}
export function safeAdd(left: number, right: number, name: string): number {
    const total = left + right
    if (!Number.isSafeInteger(total)) throw new RangeError(`${name} left the safe integer range`)
    return total
}
/** Loops rather than `Math.max(...values)`: one argument per row overflows the call stack. */
export function safeMax(values: Iterable<number>, initial: number): number {
    let result = initial
    for (const value of values) if (value > result) result = value
    return result
}
/** A frozen `Set` still accepts `add`, so the mutators are replaced: a snapshot cannot be edited. */
function sealedSet(values: Iterable<number>): ReadonlySet<number> {
    const set = new Set(values)
    const reject = (): never => { throw new TypeError("a degree context set is read-only") }
    for (const mutator of ["add", "delete", "clear"]) Object.defineProperty(set, mutator, { value: reject })
    return Object.freeze(set)
}

function normalizedQualifierJson(qualifier: DegreeCounterQualifier): string {
    const normalized: Record<string, unknown> = {}
    for (const key of Object.keys(qualifier).sort()) {
        const value = qualifier[key]
        if (value === null || value === undefined || value === "" || value === NONE_SENTINEL) continue
        normalized[key] = value
    }
    return JSON.stringify(normalized)
}
/** The in-memory counter key. Scope is not part of it because only lifetime/all rows are loaded. */
export function degreeCounterKey(dimension: string, qualifier: DegreeCounterQualifier = {}): string {
    return `${dimension}|${normalizedQualifierJson(qualifier)}`
}

type RawCounterRow = { counter_key: unknown; dimension: unknown; qualifier_json: unknown; value: unknown }

function parseQualifier(raw: unknown, dimension: string): DegreeCounterQualifier {
    if (typeof raw !== "string") throw new TypeError(`degree counter ${dimension} qualifier must be text`)
    let parsed: unknown
    // Rethrown, never downgraded to {}: an unparsable qualifier used to collide with the legitimate
    // "no qualifier" row of the same dimension, and the two then overwrote each other.
    try { parsed = JSON.parse(raw) } catch {
        throw new RangeError(`degree counter ${dimension} qualifier is not valid JSON`)
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new TypeError(`degree counter ${dimension} qualifier must be a JSON object`)
    }
    const qualifier: DegreeCounterQualifier = {}
    for (const [key, value] of Object.entries(parsed)) {
        if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
            throw new TypeError(`degree counter ${dimension} qualifier ${key} must be a primitive`)
        }
        qualifier[key] = value
    }
    return qualifier
}

function counterId(value: unknown, name: string): number {
    if (typeof value === "number") return unsignedSafeInteger(value, name)
    if (typeof value !== "string") throw new TypeError(`${name} must be a number or a decimal string`)
    return canonicalRecordKey(value, name, true)
}

function questClearCounter(qualifier: DegreeCounterQualifier, value: number): DegreeQuestClearCounter {
    const questCategory = counterId(qualifier.questCategory, "degree quest clear questCategory")
    const questId = counterId(qualifier.questId, "degree quest clear questId")
    const mode = qualifier.mode ?? "any"
    if (typeof mode !== "string" || !BATTLE_MODES.includes(mode)) {
        throw new RangeError(`degree quest clear mode ${String(mode)} is not a battle mode`)
    }
    return Object.freeze({ questCategory, questId, mode, value })
}

interface CounterMaps {
    counterValues: Readonly<Record<string, number>>
    questClearCounters: readonly DegreeQuestClearCounter[]
}
const EMPTY_COUNTERS: CounterMaps = {
    counterValues: Object.freeze(Object.create(null) as Record<string, number>),
    questClearCounters: Object.freeze([]),
}

/** The only SQL in the degree engine, and it is a read. */
function loadCounterMaps(playerId: number): CounterMaps {
    const rows = getDb().prepare(`
        SELECT counter_key, dimension, qualifier_json, value
        FROM ${COUNTER_TABLE}
        WHERE player_id = ? AND scope_type = ? AND scope_key = ?
    `).all(playerId, LIFETIME_SCOPE_TYPE, LIFETIME_SCOPE_KEY) as RawCounterRow[]
    const counterValues: Record<string, number> = Object.create(null)
    const questClearCounters: DegreeQuestClearCounter[] = []
    const questClearKeys = new Set<string>()
    for (const row of rows) {
        const dimension = row.dimension
        if (typeof dimension !== "string" || dimension === "") {
            throw new TypeError("degree counter dimension must be a non-empty string")
        }
        const qualifier = parseQualifier(row.qualifier_json, dimension)
        const qualifierJson = normalizedQualifierJson(qualifier)
        const stored = [dimension, LIFETIME_SCOPE_TYPE, LIFETIME_SCOPE_KEY, qualifierJson].join("|")
        if (row.counter_key !== stored) {
            throw new RangeError(`degree counter key ${String(row.counter_key)} is not canonical`)
        }
        const value = unsignedSafeInteger(row.value, `degree counter ${dimension} value`)
        const key = `${dimension}|${qualifierJson}`
        // Defence in depth: the (player_id, counter_key) primary key already rules this out.
        if (key in counterValues) throw new RangeError(`degree counter ${key} is duplicated`)
        counterValues[key] = value
        if (dimension !== QUEST_CLEAR_DIMENSION) continue
        const counter = questClearCounter(qualifier, value)
        // Reachable: {questCategory: 1} and {questCategory: "1"} normalise onto the same triple.
        const questKey = `${counter.questCategory}:${counter.questId}:${counter.mode}`
        if (questClearKeys.has(questKey)) throw new RangeError(`degree quest clear counter ${questKey} is duplicated`)
        questClearKeys.add(questKey)
        questClearCounters.push(counter)
    }
    return {
        counterValues: Object.freeze(counterValues),
        questClearCounters: Object.freeze(questClearCounters),
    }
}

export function estimateCharacterLevel(characterId: number, exp: number): number {
    const rarity = getCharacterDataSync(characterId)?.rarity
    if (typeof rarity !== "number" || !Number.isSafeInteger(rarity) || rarity <= 0) return 0
    const caps = characterExpCaps[rarity]
    if (caps === undefined || caps.length === 0) return 0
    const baseLevel = 40 + (rarity - 1) * 10
    let level = baseLevel - 1
    for (let index = 0; index < caps.length; index++) {
        if (exp < caps[index]) break
        level = baseLevel + index * 5
    }
    return level
}

function validatedRecord<T>(
    record: Record<string, T>,
    name: string,
    check: (value: T, key: string) => void,
): Readonly<Record<string, T>> {
    for (const [key, value] of Object.entries(record)) {
        canonicalRecordKey(key, `degree ${name} id ${key}`)
        check(value, key)
        Object.freeze(value)
    }
    return Object.freeze(record)
}
const readCharacters = (playerId: number): Readonly<Record<string, PlayerCharacter>> =>
    validatedRecord(getPlayerCharactersSync(playerId), "character", (character, key) => {
        unsignedSafeInteger(character.exp, `degree character ${key} exp`)
        unsignedSafeInteger(character.overLimitStep, `degree character ${key} over limit step`)
        if (!Array.isArray(character.bondTokenList)) {
            throw new TypeError(`degree character ${key} bond token list must be an array`)
        }
        for (const token of character.bondTokenList) {
            unsignedSafeInteger(token?.status, `degree character ${key} bond token status`)
        }
        Object.freeze(character.bondTokenList)
    })
const readManaNodes = (playerId: number): Readonly<Record<string, readonly number[]>> =>
    validatedRecord(getPlayerCharactersManaNodesSync(playerId), "mana node owner", (nodes, key) => {
        if (!Array.isArray(nodes)) throw new TypeError(`degree mana nodes of ${key} must be an array`)
        for (const node of nodes) unsignedSafeInteger(node, `degree mana node of ${key}`)
    })
const readEquipment = (playerId: number): Readonly<Record<string, PlayerEquipment>> =>
    validatedRecord(getPlayerEquipmentListSync(playerId), "equipment", (piece, key) => {
        unsignedSafeInteger(piece.level, `degree equipment ${key} level`)
        unsignedSafeInteger(piece.enhancementLevel, `degree equipment ${key} enhancement level`)
    })
const readItems = (playerId: number): Readonly<Record<string, number>> =>
    validatedRecord(getPlayerItemsSync(playerId), "item", (amount, key) =>
        unsignedSafeInteger(amount, `degree item ${key} amount`))

function readQuestEntry(section: number, raw: unknown): DegreeQuestProgressEntry {
    if (typeof raw !== "object" || raw === null) {
        throw new TypeError(`degree quest entry in section ${section} must be an object`)
    }
    const entry = raw as Record<string, unknown>
    const questId = positiveSafeInteger(entry.questId, `degree quest id in section ${section}`)
    if (typeof entry.finished !== "boolean") throw new TypeError(`degree quest ${questId} finished must be a boolean`)
    return Object.freeze({
        section, questId, finished: entry.finished,
        highScore: optionalUnsigned(entry.highScore, `degree quest ${questId} high score`),
        clearRank: optionalUnsigned(entry.clearRank, `degree quest ${questId} clear rank`),
        bestElapsedTimeMs: optionalUnsigned(entry.bestElapsedTimeMs, `degree quest ${questId} elapsed time`),
        leaderCharacterId: optionalUnsigned(entry.leaderCharacterId, `degree quest ${questId} leader`),
        multiClearCount: optionalUnsigned(entry.multiClearCount, `degree quest ${questId} multi clear count`),
    })
}

function readQuestProgress(playerId: number, needed: boolean) {
    const flatQuestProgress: DegreeQuestProgressEntry[] = []
    const questProgress: Record<string, PlayerQuestProgressEntry[]> = {}
    // The grouped record exists only to satisfy CategoryContext, and shares the very same entries.
    const sections = needed ? Object.entries(getPlayerQuestProgressSync(playerId)) : []
    for (const [text, entries] of sections) {
        const section = canonicalRecordKey(text, `degree quest section ${text}`, true)
        if (!Array.isArray(entries)) throw new TypeError(`degree quest section ${section} must hold an array`)
        const bucket: DegreeQuestProgressEntry[] = entries.map(entry => readQuestEntry(section, entry))
        Object.freeze(bucket)
        questProgress[text] = bucket
        for (const entry of bucket) flatQuestProgress.push(entry)
    }
    return { flatQuestProgress: Object.freeze(flatQuestProgress), questProgress: Object.freeze(questProgress) }
}

function readTreasureShopPurchaseCount(playerId: number, masterIndex: DegreeMasterIndex): number {
    const purchases = getPlayerShopPurchasesMapSync(playerId)
    let total = 0
    for (const shopItemId of masterIndex.listTreasureShopItemIds()) {
        if (purchases[shopItemId] === undefined) continue
        total = safeAdd(total, unsignedSafeInteger(purchases[shopItemId], `degree shop purchase ${shopItemId}`),
            "degree treasure shop purchase count")
    }
    return total
}

// Unknown but canonical ids stay: the computer keeps them as persisted-only. Malformed ones throw.
function validMissionIds(missionIds: readonly number[] | undefined): readonly number[] | undefined {
    if (missionIds === undefined) return undefined
    if (!Array.isArray(missionIds)) throw new TypeError("degree missionIds must be an array")
    for (const missionId of missionIds) positiveSafeInteger(missionId, "degree missionId")
    return missionIds
}

export function isDegreeContext(value: unknown): value is DegreeContext {
    return typeof value === "object" && value !== null
        && (value as Record<symbol, unknown>)[DEGREE_CONTEXT_BRAND] === true
}

export function buildDegreeContext(
    playerId: number,
    category: number,
    evaluationTime: Date = new Date(),
    missionIds?: readonly number[],
    masterIndex: DegreeMasterIndex = getDegreeMasterIndex(),
): DegreeContext {
    positiveSafeInteger(playerId, "degree playerId")
    if (category !== DEGREE_CATEGORY) throw new RangeError(`degree category must be ${DEGREE_CATEGORY}`)
    if (!(evaluationTime instanceof Date) || !Number.isFinite(evaluationTime.getTime())) {
        throw new TypeError("degree evaluationTime must be a valid Date")
    }
    if (typeof masterIndex?.getDefinition !== "function") {
        throw new TypeError("degree masterIndex must be a built master index")
    }
    const selection = validMissionIds(missionIds)
    const definitions = selection === undefined
        ? masterIndex.listDefinitions()
        : selection.map(missionId => masterIndex.getDefinition(missionId))
    const conditionTypes = new Set<number>()
    for (const definition of definitions) if (definition !== undefined) conditionTypes.add(definition.conditionType)
    const needs = (types: readonly number[]): boolean => types.some(type => conditionTypes.has(type))

    // One read transaction for the whole pass. The reads below are ten independent statements, so
    // without it a context could pair a character list with a counter table written after it.
    return getDb().transaction((): DegreeContext => {
        // No non-null assertion: a missing player used to surface as a TypeError deep inside a title.
        const player = getPlayerSync(playerId)
        if (player === null || player === undefined) throw new RangeError(`degree player ${playerId} does not exist`)
        const characters = needs(NEEDS_CHARACTERS) ? readCharacters(playerId) : EMPTY_RECORD
        const manaNodes = needs(NEEDS_MANA_NODES) ? readManaNodes(playerId) : EMPTY_RECORD
        const battleCounters = needs(NEEDS_BATTLE_COUNTERS)
            ? getMissionBattleCountersSync(playerId) : EMPTY_BATTLE_COUNTERS
        const quests = readQuestProgress(playerId, needs(NEEDS_QUEST_PROGRESS))
        const counters = needs(NEEDS_COUNTERS) ? loadCounterMaps(playerId) : EMPTY_COUNTERS

        const characterLevels = new Map<number, number>()
        const completedSecondBoards = new Set<number>()
        const bondedAtLevel100: number[] = []
        let overLimitCount = 0
        let bondTokenCount = 0
        let manaBoardCount = 0
        for (const [key, character] of Object.entries(characters)) {
            const characterId = canonicalRecordKey(key, `degree character id ${key}`)
            const level = estimateCharacterLevel(characterId, character.exp)
            characterLevels.set(characterId, level)
            overLimitCount = safeAdd(overLimitCount, character.overLimitStep, "degree over limit count")
            const bonded = character.bondTokenList.filter(token => token.status >= BOND_TOKEN_RECEIVED).length
            bondTokenCount = safeAdd(bondTokenCount, bonded, "degree bond token count")
            if (level >= BONDED_LEVEL && bonded > 0) bondedAtLevel100.push(characterId)
            const secondBoard = getCharacterManaNodesSync(characterId, SECOND_MANA_BOARD)
            if (secondBoard === null) continue
            const requiredNodes = Object.keys(secondBoard)
                .map(node => canonicalRecordKey(node, `degree mana node ${node} of ${characterId}`))
            if (requiredNodes.length === 0) continue
            const unlockedNodes = new Set(manaNodes[key] ?? [])
            if (requiredNodes.every(nodeId => unlockedNodes.has(nodeId))) completedSecondBoards.add(characterId)
        }
        for (const nodes of Object.values(manaNodes)) {
            manaBoardCount = safeAdd(manaBoardCount, nodes.length, "degree mana board count")
        }
        const sealedSecondBoards = sealedSet(completedSecondBoards)

        return Object.freeze({
            [DEGREE_CONTEXT_BRAND]: true as const,
            playerId,
            category,
            evaluationTime,
            masterIndex,
            player,
            questProgress: quests.questProgress,
            // Interface filler: CategoryContext declares these three, the degree engine reads none.
            totalQuestClears: 0, totalStories: 0, rankCounts: EMPTY_RECORD,
            characters,
            manaNodes,
            battleCounters,
            equipment: needs(NEEDS_EQUIPMENT) ? readEquipment(playerId) : EMPTY_RECORD,
            items: needs(NEEDS_ITEMS) ? readItems(playerId) : EMPTY_RECORD,
            flatQuestProgress: quests.flatQuestProgress,
            completedSecondBoards: sealedSecondBoards,
            questClearCounters: counters.questClearCounters,
            counterValues: counters.counterValues,
            treasureShopPurchaseCount:
                needs(NEEDS_SHOP_PURCHASES) ? readTreasureShopPurchaseCount(playerId, masterIndex) : 0,
            degreeStats: Object.freeze({
                companionCount: Object.keys(characters).length,
                maxCharacterLevel: safeMax(characterLevels.values(), 0),
                overLimitCount,
                manaBoardCount,
                bondTokenCount,
                secondManaBoardCompleteCount: completedSecondBoards.size,
                singleSsCount: battleCounters.singleRankSsCount,
                multiClearCount: battleCounters.multiClearCount,
                multiHostClearCount: battleCounters.multiHostClearCount,
                episodeClearCount: needs(NEEDS_EPISODE_CLEARS)
                    ? countFinishedPlayerQuestsByCategorySync(playerId, EPISODE_QUEST_SECTION) : 0,
                level100BondedCharacterIds: sealedSet(bondedAtLevel100),
                completedSecondManaBoardCharacterIds: sealedSecondBoards,
            }),
        })
    })()
}
