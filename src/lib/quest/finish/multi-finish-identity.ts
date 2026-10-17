/** The request counter is session-local; only an actual play identity is durable. */
export const MULTI_FINISH_RECEIPT_OPERATION = "quest_finish.multi"

export function multiFinishPlayId(value: unknown): string | null {
    return typeof value === "string" && value.trim().length > 0 ? value : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value)
}

/** Malformed response data must block another payout without masquerading as success. */
export function isMultiFinishResponse(value: unknown): value is {
    data_headers: Record<string, unknown>, data: Record<string, any>
} {
    return isRecord(value) && isRecord(value.data_headers) && isRecord(value.data)
        && value.data.is_multi === "multi" && isRecord(value.data.user_info)
        && isRecord(value.data.rewards)
}
