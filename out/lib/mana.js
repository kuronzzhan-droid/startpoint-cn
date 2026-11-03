"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateFreeManaGrant = exports.canReceiveMana = exports.getTotalMana = exports.getMaxManaSync = exports.OFFICIAL_MAX_MANA = void 0;
const assets_1 = require("./assets");
exports.OFFICIAL_MAX_MANA = 999999999;
function getMaxManaSync() {
    const configuredMaxMana = (0, assets_1.getConfigSync)().max_mana;
    return Number.isSafeInteger(configuredMaxMana) && configuredMaxMana > 0
        ? configuredMaxMana
        : exports.OFFICIAL_MAX_MANA;
}
exports.getMaxManaSync = getMaxManaSync;
function getTotalMana(balances) {
    return balances.freeMana + balances.paidMana;
}
exports.getTotalMana = getTotalMana;
function canReceiveMana(balances, amount, maxMana = getMaxManaSync()) {
    return Number.isFinite(amount)
        && amount >= 0
        && getTotalMana(balances) + amount <= maxMana;
}
exports.canReceiveMana = canReceiveMana;
/**
 * Applies the CN client rule for free-Mana rewards: free and paid Mana share
 * one cap, and only the portion that still fits is credited.
 */
function calculateFreeManaGrant(balances, amount, maxMana = getMaxManaSync()) {
    if (!Number.isFinite(amount) || amount <= 0) {
        return { freeMana: balances.freeMana, creditedMana: 0 };
    }
    const availableMana = Math.max(0, maxMana - getTotalMana(balances));
    const creditedMana = Math.min(amount, availableMana);
    return {
        freeMana: balances.freeMana + creditedMana,
        creditedMana,
    };
}
exports.calculateFreeManaGrant = calculateFreeManaGrant;
