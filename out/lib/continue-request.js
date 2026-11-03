"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.continueRequestIdentity = void 0;
const crypto_1 = require("crypto");
const continue_payment_1 = require("./continue-payment");
function stableJson(value) {
    var _a;
    if (Array.isArray(value))
        return "[" + value.map(stableJson).join(",") + "]";
    if (value !== null && typeof value === "object") {
        const record = value;
        return "{" + Object.keys(record).sort().map(key => JSON.stringify(key) + ":" + stableJson(record[key])).join(",") + "}";
    }
    return (_a = JSON.stringify(value)) !== null && _a !== void 0 ? _a : "null";
}
function continueRequestIdentity(input) {
    if (typeof input.playId !== "string" || !input.playId.length || input.playId.length > 255) {
        throw new continue_payment_1.ContinuePaymentError("Invalid continue request identity.");
    }
    const stats = input.statistics;
    const hasOrdinal = stats !== null && typeof stats === "object"
        && Object.prototype.hasOwnProperty.call(stats, "wfx_continue_count");
    let token;
    let expectedCount;
    if (hasOrdinal) {
        const count = stats.wfx_continue_count;
        if (typeof count !== "number" || !Number.isInteger(count) || count < 0 || count >= 2147483647) {
            throw new continue_payment_1.ContinuePaymentError("Invalid continue count identity.");
        }
        expectedCount = count;
        token = ["ordinal", count];
    }
    else {
        const apiCount = Number(input.apiCount);
        if ((typeof input.apiCount !== "number" && typeof input.apiCount !== "string")
            || (typeof input.apiCount === "string" && !/^[0-9]+$/.test(input.apiCount))
            || !Number.isSafeInteger(apiCount) || apiCount < 0) {
            throw new continue_payment_1.ContinuePaymentError("Invalid continue request identity.");
        }
        // Legacy clients have no battle-local nonce; preserve network retries and
        // distinguish most requests after accessCount resets at login by statistics.
        token = ["legacy", apiCount, stableJson(input.statistics)];
    }
    return { requestKey: (0, crypto_1.createHash)("sha256").update(JSON.stringify([
            input.playId, input.isMulti, input.category, input.questId, ...token,
        ])).digest("hex"), expectedCount };
}
exports.continueRequestIdentity = continueRequestIdentity;
