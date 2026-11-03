"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isMultiFinishResponse = exports.multiFinishPlayId = exports.MULTI_FINISH_RECEIPT_OPERATION = void 0;
/** The request counter is session-local; only an actual play identity is durable. */
exports.MULTI_FINISH_RECEIPT_OPERATION = "quest_finish.multi";
function multiFinishPlayId(value) {
    return typeof value === "string" && value.trim().length > 0 ? value : null;
}
exports.multiFinishPlayId = multiFinishPlayId;
function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}
/** Malformed response data must block another payout without masquerading as success. */
function isMultiFinishResponse(value) {
    return isRecord(value) && isRecord(value.data_headers) && isRecord(value.data)
        && value.data.is_multi === "multi" && isRecord(value.data.user_info)
        && isRecord(value.data.rewards);
}
exports.isMultiFinishResponse = isMultiFinishResponse;
