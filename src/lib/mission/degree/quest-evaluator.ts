// Dormant degree (category 5) quest evaluator.
//
// Pure functions over an already-built DegreeContext: no database handle, no runtime producer, no
// asset parsing of its own. Every master cell it reads goes through the master-index cell readers,
// so a non-canonical selector aborts instead of quietly resolving to a different quest.
//
// The one deliberate behaviour change against SOURCE is in countQuestClears: SOURCE credited
// `Math.max(1, multiClearCount)` in multi mode, which turns a solo clear whose multiClearCount is 0
// into a multiplayer clear. Only clears the storage can prove were multiplayer count in that mode.

import { masterIntegerList, optionalMasterInteger } from "./master-index"
import type { DegreeMasterIndex } from "./master-index"
import { degreeCounterKey, safeAdd, unsignedSafeInteger } from "./context"
import type { DegreeContext, DegreeCounterQualifier } from "./context"

const BATTLE_KIND_COLUMN = 6
const QUEST_KIND_COLUMN = 8
const EVENT_OR_CHAPTER_COLUMN = 9
const BOSS_ID_COLUMN = 10
const QUEST_RANK_COLUMN = 11
const DIFFICULTY_COLUMN = 12

const BOSS_QUEST_KIND = 2
const PRACTICE_QUEST_KIND = 11
const EXACT_EVENT_QUEST_KIND = 19
const BOSS_QUEST_BASE = 1_000_000
const BOSS_DIVISOR = 1_000
const EVENT_DIVISOR = 1_000
const MAIN_QUEST_SECTION = 1
const EX_QUEST_SECTION = 4
const RANK_CLEAR_DIMENSION = "battle.rank_clear"

export type DegreeBattleMode = "single" | "multi" | "any"

export interface QuestFilter {
    readonly categories: readonly number[]
    readonly exactQuestIds?: ReadonlySet<number>
    readonly eventPrefix?: number
    readonly bossId?: number
}

const EMPTY_CATEGORIES: readonly number[] = Object.freeze([])

const QUEST_CATEGORIES_BY_KIND: Readonly<Record<number, readonly number[]>> = Object.freeze({
    0: [1], 1: [4], 2: [2], 3: [6], 4: [14], 5: [7, 8], 6: [10], 7: [13], 8: [11], 9: [18],
    10: [19], 11: [15], 12: [13, 14, 20], 13: [20], 14: [21], 15: [22], 16: [23], 17: [24],
    18: [25], 19: [26], 20: [27],
})
for (const categories of Object.values(QUEST_CATEGORIES_BY_KIND)) Object.freeze(categories)

/** An unmapped kind means "any section"; an out-of-domain kind is a master defect. */
export function questCategoriesForKind(kind: number | undefined): readonly number[] {
    if (kind === undefined) return EMPTY_CATEGORIES
    unsignedSafeInteger(kind, "degree quest kind")
    return QUEST_CATEGORIES_BY_KIND[kind] ?? EMPTY_CATEGORIES
}

function positiveCell(value: unknown, name: string): number | undefined {
    const parsed = optionalMasterInteger(value, name)
    if (parsed === undefined) return undefined
    if (parsed <= 0) throw new RangeError(`${name} must be a positive selector`)
    return parsed
}

function frozenFilter(filter: QuestFilter): QuestFilter {
    if (filter.exactQuestIds !== undefined) Object.freeze(filter.exactQuestIds)
    return Object.freeze(filter)
}

export function resolveQuestFilter(row: readonly string[], masterIndex: DegreeMasterIndex): QuestFilter {
    if (!Array.isArray(row)) throw new TypeError("degree quest filter row must be an array")
    const kind = optionalMasterInteger(row[QUEST_KIND_COLUMN], "degree quest kind cell")
    const categories = questCategoriesForKind(kind)
    // Each cell is read only by the branch that uses it. Column 11 carries a plain id for most
    // kinds but a CSV for kind 11, so parsing it up front would reject a legal master.
    if (kind === BOSS_QUEST_KIND) {
        const bossId = positiveCell(row[BOSS_ID_COLUMN], "degree quest boss cell")
        const difficultyId = optionalMasterInteger(row[DIFFICULTY_COLUMN], "degree quest difficulty cell")
        if (bossId === undefined) return frozenFilter({ categories })
        if (difficultyId === undefined) return frozenFilter({ categories, bossId })
        const requestedQuestId = BOSS_QUEST_BASE + bossId * BOSS_DIVISOR + difficultyId
        const availableQuestIds = masterIndex.getBossQuestIds(bossId)
        // The buckets are sorted, so the fallback is the hardest difficulty that actually exists.
        const resolvedQuestId = availableQuestIds.includes(requestedQuestId)
            ? requestedQuestId
            : availableQuestIds[availableQuestIds.length - 1]
        if (resolvedQuestId === undefined) return frozenFilter({ categories, bossId })
        return frozenFilter({ categories, exactQuestIds: new Set([resolvedQuestId]) })
    }
    if (kind === PRACTICE_QUEST_KIND) {
        const practiceIds = masterIntegerList(row[QUEST_RANK_COLUMN], "degree practice quest cell")
        if (practiceIds.length === 0) return frozenFilter({ categories })
        return frozenFilter({ categories, exactQuestIds: new Set(practiceIds) })
    }
    const eventOrChapter = positiveCell(row[EVENT_OR_CHAPTER_COLUMN], "degree quest event cell")
    if (kind === EXACT_EVENT_QUEST_KIND && eventOrChapter !== undefined) {
        return frozenFilter({ categories, exactQuestIds: new Set([eventOrChapter]) })
    }
    const questRankOrId = positiveCell(row[QUEST_RANK_COLUMN], "degree quest rank cell")
    if (eventOrChapter !== undefined && questRankOrId !== undefined) {
        const questId = safeAdd(eventOrChapter * EVENT_DIVISOR, questRankOrId, "degree quest selector")
        return frozenFilter({ categories, exactQuestIds: new Set([questId]) })
    }
    if (eventOrChapter !== undefined) return frozenFilter({ categories, eventPrefix: eventOrChapter })
    return frozenFilter({ categories })
}

export function matchesQuest(filter: QuestFilter, section: number, questId: number): boolean {
    if (filter.categories.length > 0 && !filter.categories.includes(section)) return false
    if (filter.exactQuestIds !== undefined && !filter.exactQuestIds.has(questId)) return false
    if (filter.bossId !== undefined
        && Math.floor((questId - BOSS_QUEST_BASE) / BOSS_DIVISOR) !== filter.bossId) {
        return false
    }
    if (filter.eventPrefix !== undefined && Math.floor(questId / EVENT_DIVISOR) !== filter.eventPrefix) {
        return false
    }
    return true
}

export function requestedBattleMode(row: readonly string[]): DegreeBattleMode {
    const battleKind = optionalMasterInteger(row[BATTLE_KIND_COLUMN], "degree battle kind cell")
    if (battleKind === 1) return "single"
    if (battleKind === 2) return "multi"
    return "any"
}

/**
 * Persisted quest rows and the lifetime counter describe the same clears from two sides, so the two
 * totals are combined with max rather than added.
 */
export function countQuestClears(
    ctx: DegreeContext,
    filter: QuestFilter,
    mode: DegreeBattleMode,
): number {
    let storedProgressCount = 0
    for (const entry of ctx.flatQuestProgress) {
        if (!entry.finished || !matchesQuest(filter, entry.section, entry.questId)) continue
        const multiClearCount = entry.multiClearCount ?? 0
        const contribution = mode === "single"
            ? 1
            : mode === "multi" ? multiClearCount : Math.max(1, multiClearCount)
        storedProgressCount = safeAdd(storedProgressCount, contribution, "degree stored quest clears")
    }
    let counterCount = 0
    for (const counter of ctx.questClearCounters) {
        if (counter.mode !== mode) continue
        if (!matchesQuest(filter, counter.questCategory, counter.questId)) continue
        counterCount = safeAdd(counterCount, counter.value, "degree counted quest clears")
    }
    return Math.max(storedProgressCount, counterCount)
}

export function readCounter(
    ctx: DegreeContext,
    dimension: string,
    qualifier: DegreeCounterQualifier = {},
): number {
    if (typeof dimension !== "string" || dimension === "") {
        throw new TypeError("degree counter dimension must be a non-empty string")
    }
    return ctx.counterValues[degreeCounterKey(dimension, qualifier)] ?? 0
}

/** A chapter with an empty main or ex master set can never complete, so it never reports complete. */
export function completedChapter(ctx: DegreeContext, chapter: number): boolean {
    const requiredMain = ctx.masterIndex.getMainQuestIds(chapter)
    const requiredEx = ctx.masterIndex.getExQuestIds(chapter)
    if (requiredMain.length === 0 || requiredEx.length === 0) return false
    const finished = new Set<string>()
    for (const entry of ctx.flatQuestProgress) {
        if (!entry.finished) continue
        if (entry.section === MAIN_QUEST_SECTION || entry.section === EX_QUEST_SECTION) {
            finished.add(`${entry.section}:${entry.questId}`)
        }
    }
    return requiredMain.every(questId => finished.has(`${MAIN_QUEST_SECTION}:${questId}`))
        && requiredEx.every(questId => finished.has(`${EX_QUEST_SECTION}:${questId}`))
}

/** Loops instead of `Math.min(...times)`: one argument per cleared quest overflows the call stack. */
export function bestSingleClearTimeMs(ctx: DegreeContext): number | undefined {
    let best: number | undefined
    for (const entry of ctx.flatQuestProgress) {
        const elapsed = entry.bestElapsedTimeMs
        if (!entry.finished || elapsed === undefined || elapsed <= 0) continue
        if (best === undefined || elapsed < best) best = elapsed
    }
    return best
}

export function maxHighScore(ctx: DegreeContext): number {
    let best = 0
    for (const entry of ctx.flatQuestProgress) {
        const highScore = entry.highScore ?? 0
        if (highScore > best) best = highScore
    }
    return best
}

export function maxClearRankCount(ctx: DegreeContext, rank: number): number {
    unsignedSafeInteger(rank, "degree clear rank")
    let historical = 0
    for (const entry of ctx.flatQuestProgress) {
        if (entry.finished && entry.clearRank === rank) {
            historical = safeAdd(historical, 1, "degree historical rank clears")
        }
    }
    return Math.max(historical, readCounter(ctx, RANK_CLEAR_DIMENSION, { rank }))
}
