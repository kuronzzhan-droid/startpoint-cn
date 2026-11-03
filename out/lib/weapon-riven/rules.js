"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getWeaponRivenDismantleReward = exports.getWeaponRivenCost = exports.getWeaponRivenCostOptions = exports.rollWeaponRivenAffixes = exports.rollWeaponRivenAffixesWithRules = exports.rerollWeaponRivenQualities = exports.rollWeaponRivenQualities = exports.rollWeaponRivenQualitiesWithRules = exports.isWeaponRivenRevealCandidate = exports.getWeaponRivenThemePool = exports.getWeaponRivenTheme = exports.weaponRivenDrawWeight = exports.getWeaponRivenAffixCandidates = exports.getWeaponRivenAffixCapLevel = exports.getWeaponRivenDisposition = exports.weaponRivenValueToLevel = exports.weaponRivenRuleSet = void 0;
const weapon_riven_rules_json_1 = __importDefault(require("../../../assets/weapon_riven_rules.json"));
const weapon_riven_affixes_json_1 = __importDefault(require("../../../assets/weapon_riven_affixes.json"));
const weapon_riven_disposition_json_1 = __importDefault(require("../../../assets/weapon_riven_disposition.json"));
const validate_rules_1 = require("./validate-rules");
const validate_v3_1 = require("./validate-v3");
const load_rules_1 = require("./load-rules");
const quality_1 = require("./quality");
exports.weaponRivenRuleSet = (0, load_rules_1.normalizeWeaponRivenRuleSet)(weapon_riven_rules_json_1.default, weapon_riven_affixes_json_1.default, weapon_riven_disposition_json_1.default);
(0, validate_rules_1.validateWeaponRivenRuleSet)(exports.weaponRivenRuleSet);
function unitRandom(random) {
    const value = random();
    if (!Number.isFinite(value) || value < 0 || value >= 1) {
        throw new RangeError("Weapon riven random source must return a value in [0, 1).");
    }
    return value;
}
function weightedChoice(choices, weight, random) {
    const eligible = choices.filter(choice => weight(choice) > 0);
    const total = eligible.reduce((sum, choice) => sum + weight(choice), 0);
    if (!Number.isFinite(total) || total <= 0)
        throw new Error("Weapon riven rule has no eligible weighted choice.");
    let remaining = unitRandom(random) * total;
    for (const choice of eligible) {
        remaining -= weight(choice);
        if (remaining < 0)
            return choice;
    }
    return eligible[eligible.length - 1];
}
/** Encode against the one global key's endpoints, never per-weapon endpoints. */
function weaponRivenValueToLevel(value, lo, hi) {
    if (![value, lo, hi].every(Number.isFinite) || hi < lo)
        throw new RangeError("Invalid weapon riven value endpoints.");
    if (lo === hi)
        return 1;
    return Math.max(1, Math.min(100, Math.round(1 + 99 * (value - lo) / (hi - lo))));
}
exports.weaponRivenValueToLevel = weaponRivenValueToLevel;
function getWeaponRivenDisposition(weaponId, configuration = exports.weaponRivenRuleSet) {
    var _a;
    if (!Number.isSafeInteger(weaponId) || weaponId <= 0)
        throw new RangeError("Invalid weapon ID.");
    const { disposition } = configuration;
    const level = (_a = disposition.weapons[String(weaponId)]) !== null && _a !== void 0 ? _a : disposition.default;
    if (!Number.isFinite(level) || level < .1 || level > 5)
        throw new Error("Weapon riven disposition is not configured.");
    return level;
}
exports.getWeaponRivenDisposition = getWeaponRivenDisposition;
/** Sampling and cap previews share polarity scaling and the global key's level encoding. */
function affixMagnitudeToLevel(affix, coefficients, magnitude) {
    const coefficient = affix.polarity === "+" ? coefficients.positive_coefficient : coefficients.negative_coefficient;
    return weaponRivenValueToLevel(coefficient * magnitude, affix.lo, affix.hi);
}
/** Disabled definitions still describe old cards; a missing historical key has no known cap. */
function getWeaponRivenAffixCapLevel(weaponId, key, configuration = exports.weaponRivenRuleSet, cardAffixes = [[key, 1]]) {
    const level = getWeaponRivenDisposition(weaponId, configuration);
    const affix = configuration.affixes.affixes.find(definition => definition.key === key);
    if (!affix)
        return undefined;
    if (configuration.rules.schema_version === 3) {
        return weaponRivenValueToLevel((0, quality_1.weaponRivenAffixBudget)(affix, cardAffixes, level, configuration), affix.lo, affix.hi);
    }
    return affixMagnitudeToLevel(affix, configuration.disposition.levels[String(level)], affix.max_full);
}
exports.getWeaponRivenAffixCapLevel = getWeaponRivenAffixCapLevel;
function getWeaponRivenAffixCandidates(slot, selected, definitions) {
    const usedKeys = new Set(selected.map(affix => affix.key));
    const groups = new Set(selected.map(affix => affix.exclusive_group).filter(Boolean));
    return definitions.filter(affix => affix.enabled && affix.weight > 0
        && affix.polarity === slot.polarity && affix.tier === slot.tier
        && !usedKeys.has(affix.key) && (!affix.exclusive_group || !groups.has(affix.exclusive_group))
        && (!affix.family || selected.every(previous => previous.family !== affix.family)));
}
exports.getWeaponRivenAffixCandidates = getWeaponRivenAffixCandidates;
/** Independent-multiplier positives are rare under the budget model. */
function weaponRivenDrawWeight(affix, configuration) {
    const model = configuration.rules.value_model;
    return model && affix.polarity === "+" && affix.independent_damage
        ? affix.weight * model.independent_weight_factor : affix.weight;
}
exports.weaponRivenDrawWeight = weaponRivenDrawWeight;
/** Configured theme for a themed unknown card; undefined for the plain unknown card. */
function getWeaponRivenTheme(itemId, configuration = exports.weaponRivenRuleSet) {
    var _a;
    return (_a = configuration.rules.themes) === null || _a === void 0 ? void 0 : _a.find(theme => theme.item_id === itemId);
}
exports.getWeaponRivenTheme = getWeaponRivenTheme;
/** Union of category, explicit IDs and ranges, restricted to weapons the disposition table knows,
 * minus excluded themes' pools and the global reveal exclusions. */
function getWeaponRivenThemePool(theme, configuration = exports.weaponRivenRuleSet) {
    return (0, validate_v3_1.resolveWeaponRivenThemePool)(theme, configuration);
}
exports.getWeaponRivenThemePool = getWeaponRivenThemePool;
/** PARADOX, GM test weapons and test copies never come out of any unknown card, plain or themed. */
function isWeaponRivenRevealCandidate(weaponId, configuration = exports.weaponRivenRuleSet) {
    return !(0, validate_v3_1.isWeaponRivenRevealExcluded)(weaponId, configuration);
}
exports.isWeaponRivenRevealCandidate = isWeaponRivenRevealCandidate;
/** v3 draws persist actual quality multipliers; only response projection produces levels. */
function rollWeaponRivenQualitiesWithRules(weaponId, configuration, random = Math.random) {
    getWeaponRivenDisposition(weaponId, configuration);
    const structures = configuration.rules.structures;
    if (!(structures === null || structures === void 0 ? void 0 : structures.length))
        throw new Error("Weapon riven v3 structures are missing");
    const structure = weightedChoice(structures, row => row.probability, random);
    const selected = [];
    const result = [];
    for (let index = 0; index < structure.positive + structure.negative; index++) {
        const polarity = index < structure.positive ? "+" : "-";
        const candidates = configuration.affixes.affixes.filter(affix => affix.enabled && affix.weight > 0
            && affix.polarity === polarity && !affix.legacy_only
            && selected.every(previous => previous.key !== affix.key
                && (!affix.family || previous.family !== affix.family)
                && (!affix.exclusive_group || previous.exclusive_group !== affix.exclusive_group)));
        const affix = weightedChoice(candidates, candidate => weaponRivenDrawWeight(candidate, configuration), random);
        selected.push(affix);
        result.push([affix.key, (0, quality_1.sampleWeaponRivenQuality)(configuration, random)]);
    }
    return result;
}
exports.rollWeaponRivenQualitiesWithRules = rollWeaponRivenQualitiesWithRules;
function rollWeaponRivenQualities(weaponId, random = Math.random) {
    return rollWeaponRivenQualitiesWithRules(weaponId, exports.weaponRivenRuleSet, random);
}
exports.rollWeaponRivenQualities = rollWeaponRivenQualities;
function rerollWeaponRivenQualities(affixes, random = Math.random, configuration = exports.weaponRivenRuleSet) {
    return affixes.map(([key]) => [key, (0, quality_1.sampleWeaponRivenQuality)(configuration, random)]);
}
exports.rerollWeaponRivenQualities = rerollWeaponRivenQualities;
/** Pure sampling entry point for tests and generator contract checks. Validate custom rule sets first. */
function rollWeaponRivenAffixesWithRules(weaponId, configuration, random = Math.random) {
    const level = getWeaponRivenDisposition(weaponId, configuration);
    if (configuration.rules.schema_version === 3) {
        const qualities = rollWeaponRivenQualitiesWithRules(weaponId, configuration, random);
        return qualities.map(([key, quality]) => {
            const definition = configuration.affixes.affixes.find(affix => affix.key === key);
            return [key, weaponRivenValueToLevel((0, quality_1.weaponRivenAffixBudget)(definition, qualities, level, configuration, quality), definition.lo, definition.hi)];
        });
    }
    const { rules, affixes, disposition } = configuration;
    const count = weightedChoice(rules.affix_count_probabilities, row => row.probability, random).count;
    const combination = weightedChoice(rules.combinations.filter(row => row.count === count), row => row.conditional_probability, random);
    const coefficients = disposition.levels[String(level)];
    const selected = [];
    const result = [];
    for (const slot of combination.slots) {
        const candidates = getWeaponRivenAffixCandidates(slot, selected, affixes.affixes);
        const affix = weightedChoice(candidates, candidate => candidate.weight, random);
        selected.push(affix);
        const magnitude = affix.min + (affix.max_full - affix.min) * unitRandom(random) ** coefficients.k;
        result.push([affix.key, affixMagnitudeToLevel(affix, coefficients, magnitude)]);
    }
    return result;
}
exports.rollWeaponRivenAffixesWithRules = rollWeaponRivenAffixesWithRules;
function rollWeaponRivenAffixes(weaponId, random = Math.random) {
    return rollWeaponRivenAffixesWithRules(weaponId, exports.weaponRivenRuleSet, random);
}
exports.rollWeaponRivenAffixes = rollWeaponRivenAffixes;
function getWeaponRivenCostOptions(rollCount, configuration = exports.weaponRivenRuleSet) {
    if (!Number.isSafeInteger(rollCount) || rollCount < 0)
        throw new RangeError("Invalid weapon riven roll count.");
    return configuration.rules.reroll.cost_items.map(({ item_id, costs }) => [item_id, costs[Math.min(rollCount, costs.length - 1)]]);
}
exports.getWeaponRivenCostOptions = getWeaponRivenCostOptions;
/** Legacy clients display the first configured payment option. */
function getWeaponRivenCost(rollCount, configuration = exports.weaponRivenRuleSet) {
    return getWeaponRivenCostOptions(rollCount, configuration)[0][1];
}
exports.getWeaponRivenCost = getWeaponRivenCost;
/** Count confirmed affixes and paid rerolls; a pending candidate does not replace the card's affixes. */
function getWeaponRivenDismantleReward(affixCount, rollCount, configuration = exports.weaponRivenRuleSet) {
    if (!Number.isSafeInteger(affixCount) || affixCount < 1 || affixCount > 4
        || !Number.isSafeInteger(rollCount) || rollCount < 0)
        throw new RangeError("Invalid weapon riven dismantle counts.");
    const { item_id, base, per_affix, per_roll } = configuration.rules.dismantle_return;
    const amount = base + per_affix * affixCount + per_roll * rollCount;
    if (!Number.isSafeInteger(amount) || amount < 0)
        throw new RangeError("Invalid weapon riven dismantle amount.");
    return item_id !== null && amount > 0 ? { itemId: item_id, amount } : null;
}
exports.getWeaponRivenDismantleReward = getWeaponRivenDismantleReward;
