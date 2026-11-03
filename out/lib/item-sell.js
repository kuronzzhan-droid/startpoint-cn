"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sellItemSync = void 0;
const assets_1 = require("./assets");
const party_1 = require("../data/domains/party");
const item_1 = require("../data/domains/item");
const player_1 = require("../data/domains/player");
const mana_1 = require("./mana");
/**
 * Sell items for mana. Performs server-side validation:
 * - Item must be sellable (CDN sellable=true)
 * - Player must own enough items
 * - Ability souls in use by parties cannot be sold
 * - Mana must not overflow max_mana
 */
function sellItemSync(playerId, itemId, sellNumber) {
    var _a, _b;
    // Validate sell number
    if (!Number.isInteger(sellNumber) || sellNumber <= 0) {
        return { ok: false, error: "Invalid sell number." };
    }
    // Look up item sale data
    const saleData = (0, assets_1.getItemSaleSync)(itemId);
    if (!saleData) {
        return { ok: false, error: "Item not found in sale data." };
    }
    if (!saleData.sellable) {
        return { ok: false, error: "This item cannot be sold." };
    }
    // Check ownership
    const ownedCount = (_a = (0, item_1.getPlayerItemSync)(playerId, itemId)) !== null && _a !== void 0 ? _a : 0;
    if (ownedCount < sellNumber) {
        return { ok: false, error: "Not enough items owned." };
    }
    // Ability soul check: cannot sell souls equipped in parties
    if (saleData.category === 5) {
        const usedInParties = (0, party_1.countAbilitySoulUsedInPartiesSync)(playerId, itemId);
        const sellable = ownedCount - usedInParties;
        if (sellable < sellNumber) {
            return { ok: false, error: "Some ability souls are in use. Cannot sell more than available." };
        }
    }
    // Check mana limit
    const player = (0, player_1.getPlayerSync)(playerId);
    if (!player)
        return { ok: false, error: "Player not found." };
    const manaGained = saleData.sale_price * sellNumber;
    const maxMana = (0, mana_1.getMaxManaSync)();
    if (!(0, mana_1.canReceiveMana)(player, manaGained, maxMana)) {
        return { ok: false, errorCode: 2102, error: "Mana would exceed maximum." };
    }
    // Deduct item
    const newCount = ownedCount - sellNumber;
    (0, item_1.updatePlayerItemSync)(playerId, itemId, newCount);
    // Add mana
    const newMana = player.freeMana + manaGained;
    (0, player_1.updatePlayerSync)({ id: playerId, freeMana: newMana, totalManaObtained: ((_b = player.totalManaObtained) !== null && _b !== void 0 ? _b : 0) + manaGained });
    return { ok: true, newCount, freeMana: newMana, manaGained };
}
exports.sellItemSync = sellItemSync;
