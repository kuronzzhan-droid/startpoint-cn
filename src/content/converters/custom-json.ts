import type { OrderedMapTextRow } from "../sync/ordered-map"

export const ROGUE_EVENT_SOURCE_PATH = "master/custom/rogue_event.orderedmap"

export interface CustomJsonSourceReader {
    read(logicalPath: string): Promise<readonly OrderedMapTextRow[]>
}

export interface CustomJsonConversionOutput {
    readonly "rogue_event.json": unknown
}

/**
 * Fork-specific converter for operator/mode configuration tables that live
 * on the CDN under custom logical paths (a single-row orderedmap whose
 * `config` row text is a JSON document). Chains without the source table
 * yield an explicitly disabled sentinel instead of failing the sync, so
 * receivers who never installed the content keep building releases —
 * a deliberate relaxation of the strict source closure, acceptable because
 * the consuming mode module treats "absent" and "disabled" identically.
 */
export async function convertCustomJson(
    reader: CustomJsonSourceReader,
): Promise<CustomJsonConversionOutput> {
    let rows: readonly OrderedMapTextRow[]
    try {
        rows = await reader.read(ROGUE_EVENT_SOURCE_PATH)
    } catch {
        return { "rogue_event.json": { enabled: false, events: {} } }
    }
    const configRow = rows.find(row => row.key === "config")
    if (configRow === undefined) {
        throw new Error("invalid custom config table: missing 'config' row")
    }
    let parsed: unknown
    try {
        parsed = JSON.parse(configRow.text)
    } catch (error) {
        throw new Error(`invalid custom config table: ${(error as Error).message}`)
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error("invalid custom config table: config must be a JSON object")
    }
    return { "rogue_event.json": parsed }
}
