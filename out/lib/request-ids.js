"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.uniqueIds = exports.parsePositiveSafeIntegerList = exports.parsePositiveSafeInteger = void 0;
/**
 * Request id normalization shared by economy routes.
 *
 * Clients send ids as msgpack integers, but some transports (GET query
 * strings, JSON object keys) deliver them as decimal strings. Database helpers
 * coerce with Number(), so every route must dedupe and aggregate on the
 * normalized integer, never on the raw request value.
 */
function parsePositiveSafeInteger(value) {
    let parsed;
    if (typeof value === "number") {
        parsed = value;
    }
    else if (typeof value === "string" && /^[0-9]{1,16}$/.test(value)) {
        parsed = Number(value);
    }
    else {
        return null;
    }
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}
exports.parsePositiveSafeInteger = parsePositiveSafeInteger;
/** Normalize every id or return null when any entry is not a positive safe integer. */
function parsePositiveSafeIntegerList(values) {
    const result = [];
    for (const value of values) {
        const parsed = parsePositiveSafeInteger(value);
        if (parsed === null)
            return null;
        result.push(parsed);
    }
    return result;
}
exports.parsePositiveSafeIntegerList = parsePositiveSafeIntegerList;
/** Keep the first occurrence of each id, preserving request order. */
function uniqueIds(ids) {
    return [...new Set(ids)];
}
exports.uniqueIds = uniqueIds;
