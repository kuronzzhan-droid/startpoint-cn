const QUEST_CATEGORY_BY_RANGE_KIND: Readonly<Record<number, number | readonly number[]>> = Object.freeze({
    0: 1,
    1: 4,
    2: 2,
    3: 6,
    4: 14,
    5: 7,
    6: 10,
    7: 13,
    8: 11,
    9: 18,
    10: 19,
    11: 15,
    12: Object.freeze([6, 14, 13, 20]),
    13: 20,
    14: 21,
    15: 22,
    16: 23,
    17: 24,
    18: 25,
    19: 26,
    20: 27,
})

const CANONICAL_NON_NEGATIVE_INTEGER = /^(0|[1-9]\d*)$/

export function parseCanonicalNonNegativeInteger(value: unknown, field: string): number {
    if (typeof value === "number") {
        if (!Number.isSafeInteger(value) || value < 0) {
            throw new TypeError(`Invalid Active Mission ${field}.`)
        }
        return value
    }
    if (typeof value !== "string" || !CANONICAL_NON_NEGATIVE_INTEGER.test(value)) {
        throw new TypeError(`Invalid Active Mission ${field}.`)
    }
    const parsed = Number(value)
    if (!Number.isSafeInteger(parsed)) throw new RangeError(`Unsafe Active Mission ${field}.`)
    return parsed
}

export function parseCanonicalIntegerList(value: unknown, field: string): number[] {
    if (value === undefined || value === null || value === "(None)" || value === "") return []
    if (typeof value === "number") return [parseCanonicalNonNegativeInteger(value, field)]
    if (typeof value !== "string") throw new TypeError(`Invalid Active Mission ${field}.`)
    return value.split(",").map(item => parseCanonicalNonNegativeInteger(item, field))
}

function parseOptionalSelector(value: unknown, field: string): readonly number[] | null {
    if (value === undefined || value === null || value === "(None)") return null
    return parseCanonicalIntegerList(value, field)
}

function requireNonEmpty(values: readonly number[], field: string): readonly number[] {
    if (values.length === 0) throw new TypeError(`Missing Active Mission ${field}.`)
    return values
}

function requirePositiveSafe(value: number, field: string): number {
    if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`Unsafe Active Mission ${field}.`)
    return value
}

function safeQuestId(base: number, first: number, second: number, third: number): number {
    const value = base + first * 1_000_000 + second * 1_000 + third
    return requirePositiveSafe(value, "quest id")
}

function matchesSelector(selector: readonly number[] | null, value: number): boolean {
    return selector === null || selector.includes(value)
}

function categoriesForRangeKind(kind: number): readonly number[] | undefined {
    const raw = QUEST_CATEGORY_BY_RANGE_KIND[kind]
    if (raw === undefined) return undefined
    return Array.isArray(raw) ? raw : [raw]
}

export function validateActiveMissionQuestRange(row: readonly unknown[]): void {
    const rawKind = row[34]
    if (rawKind === undefined || rawKind === null || rawKind === "(None)" || rawKind === "") return
    const kind = parseCanonicalNonNegativeInteger(rawKind, "quest range kind")
    if (categoriesForRangeKind(kind) === undefined) {
        throw new TypeError(`Unsupported Active Mission quest range kind ${kind}.`)
    }
    if (kind <= 2) {
        parseOptionalSelector(row[35], "quest range first")
        parseOptionalSelector(row[36], "quest range second")
        parseOptionalSelector(row[37], "quest range third")
    } else if (kind !== 12) {
        parseOptionalSelector(row[35], "quest event id")
        parseOptionalSelector(row[37], "quest numbers")
    }
}

function matchesStructuredQuest(
    kind: number,
    row: readonly unknown[],
    questId: number,
): boolean {
    const normalized = kind === 1 && questId < 10_000_000 ? questId + 10_000_000 : questId
    const encoded = kind === 1 ? normalized - 10_000_000 : normalized
    const first = Math.floor(encoded / 1_000_000)
    const remainder = encoded % 1_000_000
    const second = Math.floor(remainder / 1_000)
    const third = remainder % 1_000
    return matchesSelector(parseOptionalSelector(row[35], "quest range first"), first)
        && matchesSelector(parseOptionalSelector(row[36], "quest range second"), second)
        && matchesSelector(parseOptionalSelector(row[37], "quest range third"), third)
}

export function matchesActiveMissionQuestRange(
    row: readonly unknown[],
    category: number,
    questId: number,
): boolean {
    const validCategory = parseCanonicalNonNegativeInteger(category, "quest category")
    const validQuestId = parseCanonicalNonNegativeInteger(questId, "quest id")
    const rawKind = row[34]
    if (rawKind === undefined || rawKind === null || rawKind === "(None)") return true
    if (rawKind === "") return false
    const kind = parseCanonicalNonNegativeInteger(rawKind, "quest range kind")
    const categories = categoriesForRangeKind(kind)
    if (!categories || !categories.includes(validCategory)) return false
    if (kind <= 2) return matchesStructuredQuest(kind, row, validQuestId)
    if (kind === 12) return true
    const eventIds = parseOptionalSelector(row[35], "quest event id")
    const questNumbers = parseOptionalSelector(row[37], "quest numbers")
    return matchesSelector(eventIds, Math.floor(validQuestId / 1_000))
        && matchesSelector(questNumbers, validQuestId % 1_000)
}

export function resolveActiveMissionQuestIds(row: readonly unknown[]): number[] {
    const kind = parseCanonicalNonNegativeInteger(row[34], "quest range kind")
    if (kind === 0 || kind === 1) {
        const first = requireNonEmpty(parseCanonicalIntegerList(row[35], "quest worlds"), "quest worlds")
        const second = requireNonEmpty(parseCanonicalIntegerList(row[36], "quest chapters"), "quest chapters")
        const third = requireNonEmpty(parseCanonicalIntegerList(row[37], "quest numbers"), "quest numbers")
        const ids = first.flatMap(world => second.flatMap(chapter => third.map(quest => (
            safeQuestId(kind === 1 ? 10_000_000 : 0, world, chapter, quest)
        ))))
        return [...new Set(ids)]
    }
    if (kind === 9) {
        const eventId = parseCanonicalNonNegativeInteger(row[35], "world story event id")
        const questNumbers = requireNonEmpty(
            parseCanonicalIntegerList(row[37], "world story event quest numbers"),
            "world story event quest numbers",
        )
        return [...new Set(questNumbers.map(number => (
            requirePositiveSafe(eventId * 1_000 + number, "quest id")
        )))]
    }
    throw new TypeError(`Unsupported Active Mission quest range kind ${kind}.`)
}
