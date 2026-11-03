"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateDissolveRewards = void 0;
const assets_1 = require("./assets");
/**
 * Calculate dissolve rewards for one equipment type × count stacks.
 *
 * CDN checks applied:
 * - generate_ability_soul: only grant ability souls if `true`
 * - obtain_source: only grant star grains if `0`
 *
 * Craft-point and star-grain values loaded from CDN equipment_craft.json.
 *
 * @param equipmentId  The equipment ID being dissolved.
 * @param count        How many stacks to dissolve.
 * @returns Rewards struct (always non-null, zero values for missing rewards).
 */
function calculateDissolveRewards(equipmentId, count) {
    var _a, _b;
    const rarity = Math.floor(equipmentId / 1000000); // 1-indexed, matches CDN keys
    const craftEntry = (0, assets_1.getEquipmentCraftSync)(rarity);
    const craftPoints = ((_a = craftEntry === null || craftEntry === void 0 ? void 0 : craftEntry.dissolve_craft) !== null && _a !== void 0 ? _a : (rarity + 1)) * count;
    const cdn = (0, assets_1.getEquipmentDissolveSync)(equipmentId);
    // Star grains: only if obtain_source == 0
    const starGrains = cdn && cdn.obtain_source === 0
        ? ((_b = craftEntry === null || craftEntry === void 0 ? void 0 : craftEntry.dissolve_star) !== null && _b !== void 0 ? _b : 0) * count
        : 0;
    // Ability souls: only if generate_ability_soul == true
    const abilitySouls = {};
    if (cdn && cdn.generate_ability_soul) {
        const soulId = cdn.ability_soul_id;
        abilitySouls[soulId] = count;
    }
    return { craftPoints, starGrains, abilitySouls };
}
exports.calculateDissolveRewards = calculateDissolveRewards;
