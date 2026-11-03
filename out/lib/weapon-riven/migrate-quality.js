"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.migrateWeaponRivenAffixes = exports.legacyWeaponRivenMagnitude = void 0;
const rules_1 = require("./rules");
const quality_1 = require("./quality");
/** Decode the endpoint table that actually shipped, before translating to v3 quality. */
function legacyWeaponRivenMagnitude(key, level, configuration) {
    var _a;
    const definition = configuration.affixes.affixes.find(affix => affix.key === key);
    if (!definition)
        throw new Error(`Missing historical weapon riven affix key ${key}`);
    if (!Number.isInteger(level) || level < 1 || level > 100)
        throw new Error("Invalid historical weapon riven level");
    const encoding = (_a = definition.legacy_encoding) !== null && _a !== void 0 ? _a : definition;
    if (encoding.raw_lo !== undefined && encoding.raw_hi !== undefined && encoding.raw_per_unit) {
        const value = Math.round(encoding.raw_lo + (encoding.raw_hi - encoding.raw_lo) * (level - 1) / 99) / encoding.raw_per_unit;
        return Math.abs(encoding.resolve_int ? Math.round(value) : value);
    }
    return encoding.lo + (encoding.hi - encoding.lo) * (level - 1) / 99;
}
exports.legacyWeaponRivenMagnitude = legacyWeaponRivenMagnitude;
/** Preserve representable values; old test cards above the v3 budget become perfect quality. */
function migrateWeaponRivenAffixes(weaponId, affixes, configuration, onMigrate) {
    const disposition = (0, rules_1.getWeaponRivenDisposition)(weaponId, configuration);
    return affixes.map(([key, level]) => {
        const definition = configuration.affixes.affixes.find(affix => affix.key === key);
        if (!definition)
            throw new Error(`Missing historical weapon riven affix key ${key}`);
        const value = legacyWeaponRivenMagnitude(key, level, configuration);
        const budget = (0, quality_1.weaponRivenAffixBudget)(definition, affixes, disposition, configuration);
        const capped = value > budget;
        // Invert the curve only for representable magnitudes; historical penalties may exceed 100%.
        const quality = capped ? 1 : definition.curve === "reciprocal"
            ? (value / (100 - value)) / (budget / (100 - budget)) : value / budget;
        if (!Number.isFinite(quality) || quality < 0) {
            throw new Error(`Invalid weapon riven migration budget: weapon=${weaponId}, key=${key}, L=${level}, q=${quality}`);
        }
        const q = Number(Math.min(1, quality).toFixed(6));
        const sign = definition.polarity === "-" ? -1 : 1;
        onMigrate === null || onMigrate === void 0 ? void 0 : onMigrate({ affix_key: key, old_level: level, old_value: sign * value,
            new_value: sign * (0, quality_1.weaponRivenAffixBudget)(definition, affixes, disposition, configuration, q), q, capped });
        return [key, q];
    });
}
exports.migrateWeaponRivenAffixes = migrateWeaponRivenAffixes;
