"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.continueItemBalance = exports.debitContinueItem = exports.ContinuePaymentError = void 0;
const item_1 = require("../data/domains/item");
class ContinuePaymentError extends Error {
}
exports.ContinuePaymentError = ContinuePaymentError;
/** Must be called inside the same persistence transaction as the count/receipt. */
function debitContinueItem(playerId, cost) {
    var _a;
    const owned = (_a = (0, item_1.getPlayerItemSync)(playerId, cost.item_id)) !== null && _a !== void 0 ? _a : 0;
    if (owned < cost.amount)
        throw new ContinuePaymentError("Not enough items to continue.");
    const remaining = owned - cost.amount;
    (0, item_1.updatePlayerItemSync)(playerId, cost.item_id, remaining);
    return { [String(cost.item_id)]: remaining };
}
exports.debitContinueItem = debitContinueItem;
function continueItemBalance(playerId, itemId) {
    var _a;
    return { [String(itemId)]: (_a = (0, item_1.getPlayerItemSync)(playerId, itemId)) !== null && _a !== void 0 ? _a : 0 };
}
exports.continueItemBalance = continueItemBalance;
