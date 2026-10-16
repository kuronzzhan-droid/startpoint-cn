/**
 * Request id normalization shared by economy routes.
 *
 * Clients send ids as msgpack integers, but some transports (GET query
 * strings, JSON object keys) deliver them as decimal strings. Database helpers
 * coerce with Number(), so every route must dedupe and aggregate on the
 * normalized integer, never on the raw request value.
 */
export function parsePositiveSafeInteger(value: unknown): number | null {
    let parsed: number
    if (typeof value === "number") {
        parsed = value
    } else if (typeof value === "string" && /^[0-9]{1,16}$/.test(value)) {
        parsed = Number(value)
    } else {
        return null
    }
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

/** Normalize every id or return null when any entry is not a positive safe integer. */
export function parsePositiveSafeIntegerList(values: readonly unknown[]): number[] | null {
    const result: number[] = []
    for (const value of values) {
        const parsed = parsePositiveSafeInteger(value)
        if (parsed === null) return null
        result.push(parsed)
    }
    return result
}

/** Keep the first occurrence of each id, preserving request order. */
export function uniqueIds(ids: readonly number[]): number[] {
    return [...new Set(ids)]
}
