/** Persist only actual battle identities; api_count may be reused by a new session. */
export const SINGLE_FINISH_RECEIPT_OPERATION = "quest_finish.single"

export function singleFinishPlayId(value: unknown): string | null {
    return typeof value === "string" && value.trim().length > 0 ? value : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value)
}

/** A corrupt ledger entry still blocks payout, but cannot be replayed as success. */
export function isSingleFinishResponse(value: unknown): value is {
    data_headers: Record<string, unknown>, data: Record<string, any>
} {
    return isRecord(value) && isRecord(value.data_headers) && isRecord(value.data)
        && value.data.is_multi === "single" && isRecord(value.data.user_info)
        && isRecord(value.data.rewards)
}
