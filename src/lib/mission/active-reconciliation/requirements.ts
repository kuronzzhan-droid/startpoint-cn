import { parseCanonicalNonNegativeInteger } from "./quest-range"

export interface ActiveMissionFactRequirements {
    readonly patterns: ReadonlySet<number>
    readonly characters: boolean
    readonly characterStories: boolean
    readonly equipment: boolean
    readonly manaNodes: boolean
    readonly purchases: boolean
    readonly party: boolean
    readonly counters: boolean
    readonly battleCounters: boolean
    readonly chapterQuests: boolean
    readonly practiceCounter: boolean
    readonly leaderClears: boolean
    readonly conditionalBattleFacts: boolean
    readonly loadoutBattleFacts: boolean
}

export interface ActiveMissionRequirementDefinition {
    readonly row: readonly unknown[]
}

function hasAny(patterns: ReadonlySet<number>, values: readonly number[]): boolean {
    return values.some(value => patterns.has(value))
}

export function buildActiveMissionFactRequirements(
    definitions: readonly ActiveMissionRequirementDefinition[],
): ActiveMissionFactRequirements {
    const patterns = new Set(definitions.map(definition => (
        parseCanonicalNonNegativeInteger(definition.row[29], "mission pattern")
    )))
    return Object.freeze({
        patterns: Object.freeze(patterns),
        characters: hasAny(patterns, [4, 5, 8, 9, 21, 61]),
        characterStories: patterns.has(21),
        equipment: hasAny(patterns, [34, 36]),
        manaNodes: hasAny(patterns, [7, 48, 62]),
        purchases: hasAny(patterns, [45, 64, 84]),
        party: patterns.has(35),
        counters: hasAny(patterns, [46, 58, 59, 60, 63, 78, 83]),
        battleCounters: hasAny(patterns, [14, 16, 17, 26]),
        chapterQuests: patterns.has(66),
        practiceCounter: patterns.has(65),
        leaderClears: patterns.has(70),
        conditionalBattleFacts: hasAny(patterns, [71, 72, 73]),
        loadoutBattleFacts: patterns.has(89),
    })
}
