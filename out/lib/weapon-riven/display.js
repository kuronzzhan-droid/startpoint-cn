"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.displayWeaponRivenAffixes = void 0;
const rules_1 = require("./rules");
const quality_1 = require("./quality");
/** Stored cards, pending choices and overflow rewards share the same display encoding. */
function displayWeaponRivenAffixes(weaponId, affixes, format = 1, configuration = rules_1.weaponRivenRuleSet) {
    if (format === 3)
        (0, quality_1.validateWeaponRivenQualities)(affixes);
    return affixes.map(([key, stored]) => {
        const definition = configuration.affixes.affixes.find(row => row.key === key);
        if (format === 3 && !definition)
            throw new Error(`Missing historical weapon riven affix key ${key}`);
        const level = format === 1 ? stored : (0, rules_1.weaponRivenValueToLevel)((0, quality_1.weaponRivenAffixBudget)(definition, affixes, (0, rules_1.getWeaponRivenDisposition)(weaponId, configuration), configuration, stored), definition.lo, definition.hi);
        // Clients built before contract v1.2 only parse [key, level] pairs.
        const cap = process.env.WEAPON_RIVEN_LEGACY_AFFIX_PAIRS === "1" ? undefined : (0, rules_1.getWeaponRivenAffixCapLevel)(weaponId, key, configuration, affixes);
        return cap === undefined ? [key, level] : [key, level, cap];
    });
}
exports.displayWeaponRivenAffixes = displayWeaponRivenAffixes;
