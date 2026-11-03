"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeFreeFirstDeduction = void 0;
/**
 * Computes a free-currency-first deduction without performing any I/O.
 * Returns null when the balances or cost are invalid, or the combined balance
 * cannot cover the cost.
 */
function computeFreeFirstDeduction(freeBalance, paidBalance, cost) {
    if (!Number.isSafeInteger(freeBalance)
        || !Number.isSafeInteger(paidBalance)
        || !Number.isSafeInteger(cost)
        || freeBalance < 0
        || paidBalance < 0
        || cost < 0)
        return null;
    const freeSpent = Math.min(freeBalance, cost);
    const paidSpent = cost - freeSpent;
    if (paidSpent > paidBalance)
        return null;
    return {
        freeBalance: freeBalance - freeSpent,
        paidBalance: paidBalance - paidSpent,
        freeSpent,
        paidSpent,
    };
}
exports.computeFreeFirstDeduction = computeFreeFirstDeduction;
