"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isSingleFinishResponse = exports.singleFinishPlayId = exports.SINGLE_FINISH_RECEIPT_OPERATION = void 0;
/** Persist only actual battle identities; api_count may be reused by a new session. */
exports.SINGLE_FINISH_RECEIPT_OPERATION = "quest_finish.single";
function singleFinishPlayId(value) {
    return typeof value === "string" && value.trim().length > 0 ? value : null;
}
exports.singleFinishPlayId = singleFinishPlayId;
function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}
/** A corrupt ledger entry still blocks payout, but cannot be replayed as success. */
function isSingleFinishResponse(value) {
    return isRecord(value) && isRecord(value.data_headers) && isRecord(value.data)
        && value.data.is_multi === "single" && isRecord(value.data.user_info)
        && isRecord(value.data.rewards);
}
exports.isSingleFinishResponse = isSingleFinishResponse;
