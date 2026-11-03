"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getContinueItemCost = exports.parseContinueCosts = void 0;
const fs_1 = require("fs");
const path_1 = require("path");
/** Both values cross the AS3 Int wire boundary. Invalid deployment data fails closed. */
function parseContinueCosts(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error("Invalid continue_cost.json object");
    const result = Object.create(null);
    for (const [questId, entry] of Object.entries(value)) {
        const cost = entry;
        if (!/^[1-9][0-9]*$/.test(questId) || Number(questId) > 2147483647
            || !cost || typeof cost !== "object" || Array.isArray(cost)
            || Object.keys(cost).sort().join(",") !== "amount,item_id"
            || !Number.isSafeInteger(cost.item_id) || cost.item_id <= 0 || cost.item_id > 2147483647
            || !Number.isSafeInteger(cost.amount) || cost.amount <= 0 || cost.amount > 2147483647) {
            throw new Error(`Invalid continue_cost.json entry: ${questId}`);
        }
        result[questId] = Object.freeze({ item_id: cost.item_id, amount: cost.amount });
    }
    return Object.freeze(result);
}
exports.parseContinueCosts = parseContinueCosts;
const costs = parseContinueCosts(JSON.parse((0, fs_1.readFileSync)((0, path_1.join)(__dirname, "..", "..", "assets", "continue_cost.json"), "utf8")));
function getContinueItemCost(questId) {
    return costs[String(questId)];
}
exports.getContinueItemCost = getContinueItemCost;
