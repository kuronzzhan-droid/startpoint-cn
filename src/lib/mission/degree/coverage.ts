// Dormant degree (category 5) coverage report and reverse index.
//
// Which titles the server can recompute and which it can only replay from stored progress is the
// one question this module answers, and it has to answer it the same way twice. SOURCE did not: it
// counted condition types through `optionalNumber()` but partitioned them through a bare
// `Number()`, so an empty condition cell was "absent" for the counts and condition 0 for the
// partition, and an empty statistic kind cell became kind 0 — a supported one. Everything here goes
// through the master index cell readers, and the master index refuses a condition 28 row whose kind
// cell is empty. That closes the empty-cell variant, and only that one.
//
// The other way the two views can disagree is a condition being listed below but not handled by the
// switch in `computer.ts`, or the reverse. Neither module can see that on its own — the two lists
// are written by hand and nothing links them — so `mission_degree_progress.test.cjs` runs the switch
// over every tracked title and compares the conditions it actually answers for against the set
// below. Both sides of that comparison come from production, so editing one module alone is what
// turns it red, no matter how the test's own literals are adjusted.
//
// The frozen sets below are a review signal, not a number to update: moving a condition between
// them silently changes whether real titles are computed or frozen at their stored value.

import { getDegreeMasterIndex, optionalMasterInteger } from "./master-index"
import type { DegreeDefinition, DegreeMasterIndex } from "./master-index"

const STATISTIC_CONDITION_TYPE = 28
const STATISTIC_KIND_COLUMN = 4
const ITEM_CONDITION_TYPE = 37
const ITEM_COLUMN = 13
const CHARACTER_COLUMN = 15
const EMPTY_IDS: readonly number[] = Object.freeze([])

/** Pattern prefixes whose whole family is answered from one derived statistic. */
export const SUPPORTED_FAMILIES = Object.freeze({
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
})

/** Frozen arrays rather than Sets: a Set handed out here could be added to from the outside. */
export const SERVER_COMPUTED_CONDITION_TYPES: readonly number[] = Object.freeze([
    0, 1, 3, 4, 5, 7, 8, 9, 14, 15, 16, 17, 19, 20, 21, 22, 23, 25, 26,
    28, 30, 31, 34, 36, 37, 39, 44, 45, 48, 92,
])
export const CLIENT_REPORTED_CONDITION_TYPES: readonly number[] = Object.freeze([40, 41, 42, 43])
/** Only these condition 28 statistic kinds have a counter behind them. */
export const SERVER_COMPUTED_STATISTIC_KINDS: readonly number[] = Object.freeze([
    0, 2, 4, 5, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
])
/** Conditions 44 and 48 name their character in column 15; everything else ignores it. */
export const CHARACTER_CONDITION_TYPES: readonly number[] = Object.freeze([44, 48])

const serverConditions = new Set(SERVER_COMPUTED_CONDITION_TYPES)
const clientConditions = new Set(CLIENT_REPORTED_CONDITION_TYPES)
const serverStatisticKinds = new Set(SERVER_COMPUTED_STATISTIC_KINDS)

export type DegreeCoverageBucket = "serverComputed" | "clientReported" | "persistedOnly"

export interface DegreeCoverageReport {
    readonly total: number
    readonly serverComputed: number
    readonly clientReported: number
    readonly persistedOnly: number
    readonly conditionTypeCounts: Readonly<Record<number, number>>
    readonly serverComputedConditionTypes: readonly number[]
    readonly clientReportedConditionTypes: readonly number[]
    readonly persistedOnlyConditionTypes: readonly number[]
    readonly persistedOnlyByConditionType: Readonly<Record<number, number>>
}

/**
 * Which partition one title belongs to. A condition 28 row is only server-computed when its
 * statistic kind is one this engine knows: being in the condition set is not enough, or an unknown
 * kind would be reported as computable and then compute to nothing.
 */
export function classifyDegreeDefinition(definition: DegreeDefinition): DegreeCoverageBucket {
    const conditionType = definition.conditionType
    if (conditionType === STATISTIC_CONDITION_TYPE) {
        const kind = optionalMasterInteger(definition.row[STATISTIC_KIND_COLUMN],
            `degree mission ${definition.missionId} statistic kind`)
        return kind !== undefined && serverStatisticKinds.has(kind) ? "serverComputed" : "persistedOnly"
    }
    if (serverConditions.has(conditionType)) return "serverComputed"
    if (clientConditions.has(conditionType)) return "clientReported"
    return "persistedOnly"
}

const sortedFrozen = (values: Iterable<number>): readonly number[] =>
    Object.freeze([...values].sort((left, right) => left - right))

export function getDegreeMissionCoverageReport(
    masterIndex: DegreeMasterIndex = getDegreeMasterIndex(),
): DegreeCoverageReport {
    if (typeof masterIndex?.listDefinitions !== "function") {
        throw new TypeError("degree coverage needs a built master index")
    }
    const definitions = masterIndex.listDefinitions()
    const counts = { serverComputed: 0, clientReported: 0, persistedOnly: 0 }
    const conditionTypeCounts: Record<number, number> = {}
    const persistedOnlyByConditionType: Record<number, number> = {}
    const buckets: Record<DegreeCoverageBucket, Set<number>> = {
        serverComputed: new Set(),
        clientReported: new Set(),
        persistedOnly: new Set(),
    }
    for (const definition of definitions) {
        const conditionType = definition.conditionType
        conditionTypeCounts[conditionType] = (conditionTypeCounts[conditionType] ?? 0) + 1
        const bucket = classifyDegreeDefinition(definition)
        counts[bucket]++
        buckets[bucket].add(conditionType)
        if (bucket !== "persistedOnly") continue
        persistedOnlyByConditionType[conditionType] = (persistedOnlyByConditionType[conditionType] ?? 0) + 1
    }
    const total = definitions.length
    // Mutually exclusive by construction; this is the check that they are also exhaustive, so a
    // title can never fall out of the report while the three numbers still look plausible.
    if (counts.serverComputed + counts.clientReported + counts.persistedOnly !== total) {
        throw new RangeError(`degree coverage partitions do not sum to ${total}`)
    }
    return Object.freeze({
        total,
        serverComputed: counts.serverComputed,
        clientReported: counts.clientReported,
        persistedOnly: counts.persistedOnly,
        conditionTypeCounts: Object.freeze(conditionTypeCounts),
        serverComputedConditionTypes: sortedFrozen(buckets.serverComputed),
        clientReportedConditionTypes: sortedFrozen(buckets.clientReported),
        persistedOnlyConditionTypes: sortedFrozen(buckets.persistedOnly),
        persistedOnlyByConditionType: Object.freeze(persistedOnlyByConditionType),
    })
}

/** Rejects instead of filtering: SOURCE dropped illegal ids and answered "nothing matches". */
function requestedIds(values: readonly number[], name: string, allowZero: boolean): Set<number> {
    if (!Array.isArray(values)) throw new TypeError(`degree ${name}s must be an array`)
    const result = new Set<number>()
    for (const value of values) {
        if (typeof value !== "number" || !Number.isFinite(value)) {
            throw new TypeError(`degree ${name} must be a finite number`)
        }
        if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1)) {
            throw new RangeError(`degree ${name} must be a ${allowZero ? "non-negative" : "positive"} safe integer`)
        }
        result.add(value)
    }
    return result
}

function targetId(definition: DegreeDefinition, column: number, name: string): number | undefined {
    const id = optionalMasterInteger(definition.row[column], `degree mission ${definition.missionId} ${name}`)
    if (id !== undefined && id <= 0) {
        throw new RangeError(`degree mission ${definition.missionId} ${name} must be a positive id`)
    }
    return id
}

/** Reverse index by condition, optionally narrowed to the titles about given characters or items. */
export function getDegreeMissionIdsForConditionTypes(
    conditionTypes: readonly number[],
    characterIds?: readonly number[],
    itemIds?: readonly number[],
    masterIndex: DegreeMasterIndex = getDegreeMasterIndex(),
): readonly number[] {
    const requested = requestedIds(conditionTypes, "condition type", true)
    const requestedCharacters = characterIds === undefined
        ? undefined
        : requestedIds(characterIds, "character id", false)
    const requestedItems = itemIds === undefined ? undefined : requestedIds(itemIds, "item id", false)
    if (requested.size === 0) return EMPTY_IDS
    const missionIds = new Set<number>()
    for (const definition of masterIndex.listDefinitions()) {
        if (!requested.has(definition.conditionType)) continue
        // A title with no target is about every character or item, so it always stays in.
        if (requestedCharacters !== undefined && CHARACTER_CONDITION_TYPES.includes(definition.conditionType)) {
            const characterId = targetId(definition, CHARACTER_COLUMN, "character id")
            if (characterId !== undefined && !requestedCharacters.has(characterId)) continue
        }
        if (requestedItems !== undefined && definition.conditionType === ITEM_CONDITION_TYPE) {
            const itemId = targetId(definition, ITEM_COLUMN, "item id")
            if (itemId !== undefined && !requestedItems.has(itemId)) continue
        }
        missionIds.add(definition.missionId)
    }
    return sortedFrozen(missionIds)
}

/** The character a condition 44 or 48 title is about, or undefined when it is about all of them. */
export function getDegreeSpecificCharacterId(
    missionId: number,
    missionType: number,
    masterIndex: DegreeMasterIndex = getDegreeMasterIndex(),
): number | undefined {
    if (!CHARACTER_CONDITION_TYPES.includes(missionType)) {
        throw new RangeError(`degree character mission type ${missionType} is not 44 or 48`)
    }
    const definition = masterIndex.getDefinition(missionId)
    if (definition === undefined || definition.conditionType !== missionType) return undefined
    return targetId(definition, CHARACTER_COLUMN, "character id")
}
