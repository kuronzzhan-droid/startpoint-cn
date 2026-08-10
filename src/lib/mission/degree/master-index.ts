// Dormant degree (category 5) master index.
//
// This module is not exported from the mission barrel and the live registry never reaches it: the
// only consumers are the other degree v2 modules and their focused tests. It owns every read of the
// degree master tables so that a single normalisation rule decides what a cell means; the live
// facade parses the same asset twice (once through master-data, once through a private require())
// with two different rules, which is exactly how a coverage number and a compute result can end up
// disagreeing about the same row.
//
// Fail-closed by contract: a master that does not match the frozen shape aborts the whole build
// instead of dropping the offending row, because a silently shorter definition set still produces a
// plausible-looking coverage report.

import bossBattleQuestTable from "../../../../assets/boss_battle_quest.json"
import exQuestTable from "../../../../assets/ex_quest.json"
import mainQuestTable from "../../../../assets/main_quest.json"
import treasureShopTable from "../../../../assets/treasure_shop.json"
import { getMissionMasterDefinitions } from "../master-data"

export const DEGREE_CATEGORY = 5

// Frozen against the tracked assets. A change here is a review signal, never a number to update
// until the new master has been read.
const DEGREE_DEFINITION_COUNT = 1288
const DEGREE_ROW_LENGTH = 36
const DEGREE_TARGET_COUNT = 8
const TREASURE_SHOP_ITEM_COUNT = 108
const MAIN_QUEST_COUNT = 419
const EX_QUEST_COUNT = 221
const BOSS_QUEST_COUNT = 232

const DESCRIPTION_COLUMN = 2
const CONDITION_TYPE_COLUMN = 3
const STATISTIC_KIND_COLUMN = 4
const STATISTIC_CONDITION_TYPE = 28
const CHAPTER_DIVISOR = 1_000_000
const BOSS_QUEST_BASE = 1_000_000
const BOSS_DIVISOR = 1_000
const NONE_SENTINEL = "(None)"
// The two "absent" encodings are mixed per column in this master (col 4 uses "", col 12 uses
// "(None)"), so both have to be accepted everywhere; handling only one silently changes meaning.
const CANONICAL_INTEGER = /^(0|[1-9]\d*)$/
const CANONICAL_POSITIVE = /^[1-9]\d*$/
const TARGET_PATTERN = /玩家(?:达到|级别达到)\s*(\d+)/

const EMPTY_IDS: readonly number[] = Object.freeze([])

export interface DegreeDefinition {
    readonly missionId: number
    readonly conditionType: number
    readonly row: readonly string[]
    readonly description: string
    readonly pattern: string
}

export interface DegreeMasterSource {
    readonly definitions: unknown
    readonly treasureShopItems: unknown
    readonly mainQuests: unknown
    readonly exQuests: unknown
    readonly bossQuests: unknown
}

export interface DegreeMasterIndex {
    readonly definitionCount: number
    listDefinitions(): readonly DegreeDefinition[]
    getDefinition(missionId: number): DegreeDefinition | undefined
    getTargetDegree(missionId: number): number | undefined
    listChapters(): readonly number[]
    getMainQuestIds(chapter: number): readonly number[]
    getExQuestIds(chapter: number): readonly number[]
    getBossQuestIds(bossId: number): readonly number[]
    hasTreasureShopItem(itemId: number): boolean
    listTreasureShopItemIds(): readonly number[]
}

function plainRecord(value: unknown, name: string): Record<string, unknown> {
    if (typeof value !== "object" || value === null || Array.isArray(value)
        || Object.getOwnPropertySymbols(value).length !== 0) {
        throw new TypeError(`${name} must be a plain record`)
    }
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${name} must be a plain record`)
    return value as Record<string, unknown>
}

function ownDataEntries(source: Record<string, unknown>, name: string): Array<[string, unknown]> {
    return Object.getOwnPropertyNames(source).map(key => {
        const descriptor = Object.getOwnPropertyDescriptor(source, key)
        if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
            throw new TypeError(`${name} has a non-data property`)
        }
        return [key, descriptor.value] as [string, unknown]
    })
}

function denseArray(value: unknown, length: number, name: string): unknown[] {
    if (!Array.isArray(value) || Object.getOwnPropertySymbols(value).length !== 0) {
        throw new TypeError(`${name} must be a dense array`)
    }
    const names = Object.getOwnPropertyNames(value)
    if (names.length !== length + 1 || !names.includes("length")) throw new TypeError(`${name} must be dense`)
    const result: unknown[] = []
    for (let index = 0; index < length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
        if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
            throw new TypeError(`${name} must be a dense data array`)
        }
        result.push(descriptor.value)
    }
    return result
}

function canonicalKey(key: string, name: string): number {
    if (!CANONICAL_POSITIVE.test(key)) throw new RangeError(`${name} must be a canonical positive decimal`)
    const id = Number(key)
    if (!Number.isSafeInteger(id)) throw new RangeError(`${name} must stay a safe integer`)
    return id
}

function positiveSafe(value: unknown, name: string): number {
    if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError(`${name} must be a finite number`)
    if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${name} must be a positive safe integer`)
    return value
}

/** Cell reader for every optional integer column: "" and "(None)" mean absent, nothing else is lax. */
export function optionalMasterInteger(value: unknown, name: string): number | undefined {
    if (typeof value !== "string") throw new TypeError(`${name} must be a master string cell`)
    if (value === "" || value === NONE_SENTINEL) return undefined
    if (!CANONICAL_INTEGER.test(value)) throw new RangeError(`${name} must be a canonical decimal integer`)
    const parsed = Number(value)
    if (!Number.isSafeInteger(parsed)) throw new RangeError(`${name} must stay a safe integer`)
    return parsed
}

export function requiredMasterInteger(value: unknown, name: string): number {
    const parsed = optionalMasterInteger(value, name)
    if (parsed === undefined) throw new RangeError(`${name} must not be an empty sentinel`)
    return parsed
}

/** CSV cell reader. Sorted and unique is required so a selector cannot hide a duplicate id. */
export function masterIntegerList(value: unknown, name: string): readonly number[] {
    if (typeof value !== "string") throw new TypeError(`${name} must be a master string cell`)
    if (value === "" || value === NONE_SENTINEL) return EMPTY_IDS
    const result: number[] = []
    for (const part of value.split(",")) {
        if (!CANONICAL_INTEGER.test(part)) throw new RangeError(`${name} must be a canonical decimal CSV`)
        const entry = Number(part)
        if (!Number.isSafeInteger(entry)) throw new RangeError(`${name} must stay a safe integer`)
        if (result.length !== 0 && entry <= result[result.length - 1]) {
            throw new RangeError(`${name} must be sorted and unique`)
        }
        result.push(entry)
    }
    return Object.freeze(result)
}

function parseDefinition(raw: unknown): DegreeDefinition {
    if (typeof raw !== "object" || raw === null) throw new TypeError("degree definition must be an object")
    const source = raw as { missionId?: unknown; pattern?: unknown; row?: unknown }
    const missionId = positiveSafe(source.missionId, "degree mission id")
    const pattern = source.pattern
    if (typeof pattern !== "string" || pattern === "" || pattern === NONE_SENTINEL) {
        throw new TypeError(`degree mission ${missionId} pattern must be a non-empty string`)
    }
    const cells = denseArray(source.row, DEGREE_ROW_LENGTH, `degree mission ${missionId} row`)
    const row = cells.map((cell, column) => {
        if (typeof cell !== "string") {
            throw new TypeError(`degree mission ${missionId} cell ${column} must be a master string cell`)
        }
        return cell
    })
    const conditionType = requiredMasterInteger(row[CONDITION_TYPE_COLUMN],
        `degree mission ${missionId} condition type`)
    // A statistic title whose kind cell is empty would be read as kind 0 by a lax partitioner and as
    // "absent" by the compute path — the same row, two opposite answers. Refuse the master instead.
    // This closes that one variant and no other: a condition listed in coverage.ts but missing from
    // the computer's switch is invisible here, and is pinned by a cross-module assertion instead.
    if (conditionType === STATISTIC_CONDITION_TYPE) {
        requiredMasterInteger(row[STATISTIC_KIND_COLUMN], `degree mission ${missionId} statistic kind`)
    }
    return Object.freeze({
        missionId,
        conditionType,
        row: Object.freeze(row),
        description: row[DESCRIPTION_COLUMN],
        pattern,
    })
}

interface DefinitionIndex {
    ordered: readonly DegreeDefinition[]
    byId: ReadonlyMap<number, DegreeDefinition>
    targets: ReadonlyMap<number, number>
}

function buildDefinitionIndex(rawDefinitions: unknown): DefinitionIndex {
    if (!Array.isArray(rawDefinitions)) throw new TypeError("degree master definitions must be an array")
    const byId = new Map<number, DegreeDefinition>()
    const patterns = new Set<string>()
    const targets = new Map<number, number>()
    const ordered: DegreeDefinition[] = []
    for (const raw of rawDefinitions) {
        const definition = parseDefinition(raw)
        if (byId.has(definition.missionId)) {
            throw new RangeError(`degree mission ${definition.missionId} is duplicated`)
        }
        if (patterns.has(definition.pattern)) {
            throw new RangeError(`degree pattern ${definition.pattern} is duplicated`)
        }
        byId.set(definition.missionId, definition)
        patterns.add(definition.pattern)
        ordered.push(definition)
        const match = TARGET_PATTERN.exec(definition.description)
        if (match !== null) {
            targets.set(definition.missionId,
                requiredMasterInteger(match[1], `degree mission ${definition.missionId} degree target`))
        }
    }
    if (ordered.length !== DEGREE_DEFINITION_COUNT) {
        throw new RangeError(`degree definition count mismatch: ${ordered.length}`)
    }
    if (targets.size !== DEGREE_TARGET_COUNT) {
        throw new RangeError(`degree target count mismatch: ${targets.size}`)
    }
    return { ordered: Object.freeze(ordered), byId, targets }
}

function bucketQuestIds(
    raw: unknown,
    name: string,
    expectedCount: number,
    bucketOf: (questId: number) => number,
): ReadonlyMap<number, readonly number[]> {
    const entries = ownDataEntries(plainRecord(raw, `${name} table`), `${name} table`)
    if (entries.length !== expectedCount) throw new RangeError(`${name} count mismatch: ${entries.length}`)
    const buckets = new Map<number, number[]>()
    const seen = new Set<number>()
    for (const [key] of entries) {
        const questId = canonicalKey(key, `${name} key`)
        if (seen.has(questId)) throw new RangeError(`${name} key ${key} is duplicated`)
        seen.add(questId)
        const bucket = bucketOf(questId)
        if (!Number.isSafeInteger(bucket) || bucket <= 0) {
            throw new RangeError(`${name} ${questId} has no valid bucket`)
        }
        const questIds = buckets.get(bucket) ?? []
        questIds.push(questId)
        buckets.set(bucket, questIds)
    }
    const frozen = new Map<number, readonly number[]>()
    // The boss fallback in the quest evaluator takes the last element of a bucket, so the sort is
    // part of the contract rather than cosmetic.
    for (const [bucket, questIds] of buckets) {
        frozen.set(bucket, Object.freeze(questIds.sort((left, right) => left - right)))
    }
    return frozen
}

function sharedChapters(
    mainQuests: ReadonlyMap<number, readonly number[]>,
    exQuests: ReadonlyMap<number, readonly number[]>,
): readonly number[] {
    const ascending = (left: number, right: number): number => left - right
    const mainChapters = [...mainQuests.keys()].sort(ascending)
    const exChapters = [...exQuests.keys()].sort(ascending)
    // Chapter completion needs both halves; a chapter present in only one table can never complete,
    // so an unpaired chapter is a master defect rather than a runtime condition.
    if (mainChapters.length !== exChapters.length
        || mainChapters.some((chapter, position) => chapter !== exChapters[position])) {
        throw new RangeError("degree chapter set mismatch between main and ex quests")
    }
    return Object.freeze(mainChapters)
}

function buildTreasureShopItemIds(raw: unknown): readonly number[] {
    const entries = ownDataEntries(plainRecord(raw, "treasure shop table"), "treasure shop table")
    if (entries.length !== TREASURE_SHOP_ITEM_COUNT) {
        throw new RangeError(`treasure shop count mismatch: ${entries.length}`)
    }
    const itemIds = entries.map(([key]) => canonicalKey(key, "treasure shop key"))
    if (new Set(itemIds).size !== itemIds.length) throw new RangeError("treasure shop key collision")
    return Object.freeze(itemIds.sort((left, right) => left - right))
}

export function buildDegreeMasterIndex(source: DegreeMasterSource): DegreeMasterIndex {
    if (typeof source !== "object" || source === null) throw new TypeError("degree master source must be an object")
    const { ordered, byId, targets } = buildDefinitionIndex(source.definitions)
    const chapterOf = (questId: number): number => Math.floor(questId / CHAPTER_DIVISOR)
    const bossOf = (questId: number): number => questId < BOSS_QUEST_BASE
        ? 0
        : Math.floor((questId - BOSS_QUEST_BASE) / BOSS_DIVISOR)
    const mainQuests = bucketQuestIds(source.mainQuests, "main quest", MAIN_QUEST_COUNT, chapterOf)
    const exQuests = bucketQuestIds(source.exQuests, "ex quest", EX_QUEST_COUNT, chapterOf)
    const bossQuests = bucketQuestIds(source.bossQuests, "boss quest", BOSS_QUEST_COUNT, bossOf)
    const chapters = sharedChapters(mainQuests, exQuests)
    const treasureShopItemIds = buildTreasureShopItemIds(source.treasureShopItems)
    const treasureShopItemSet = new Set(treasureShopItemIds)
    const bucket = (
        source_: ReadonlyMap<number, readonly number[]>,
        key: number,
        name: string,
    ): readonly number[] => source_.get(positiveSafe(key, name)) ?? EMPTY_IDS
    return Object.freeze({
        definitionCount: ordered.length,
        listDefinitions: () => ordered,
        getDefinition: (missionId: number) => byId.get(positiveSafe(missionId, "degree mission id")),
        getTargetDegree: (missionId: number) => targets.get(positiveSafe(missionId, "degree mission id")),
        listChapters: () => chapters,
        getMainQuestIds: (chapter: number) => bucket(mainQuests, chapter, "degree chapter"),
        getExQuestIds: (chapter: number) => bucket(exQuests, chapter, "degree chapter"),
        getBossQuestIds: (bossId: number) => bucket(bossQuests, bossId, "degree boss id"),
        hasTreasureShopItem: (itemId: number) =>
            treasureShopItemSet.has(positiveSafe(itemId, "treasure shop item id")),
        listTreasureShopItemIds: () => treasureShopItemIds,
    })
}

/** The single production master source: one parse of the degree table, shared by every lookup. */
export function createProductionDegreeMasterSource(): DegreeMasterSource {
    return {
        definitions: getMissionMasterDefinitions(DEGREE_CATEGORY),
        treasureShopItems: treasureShopTable,
        mainQuests: mainQuestTable,
        exQuests: exQuestTable,
        bossQuests: bossBattleQuestTable,
    }
}

let productionIndex: DegreeMasterIndex | undefined

export function getDegreeMasterIndex(): DegreeMasterIndex {
    // Published only after the build returns, so a rejected master leaves no half-filled cache; test
    // sources go through buildDegreeMasterIndex() and never reach this slot.
    if (productionIndex === undefined) {
        productionIndex = buildDegreeMasterIndex(createProductionDegreeMasterSource())
    }
    return productionIndex
}
