"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateWeaponRivenQualities = exports.weaponRivenAffixBudget = exports.isWeaponRivenBudgetAffix = exports.weaponRivenDispositionCoefficient = exports.sampleWeaponRivenQuality = void 0;
function sampleWeaponRivenQuality(configuration, random) {
    var _a;
    const value = random();
    if (!Number.isFinite(value) || value < 0 || value >= 1)
        throw new RangeError("Weapon riven random source must return a value in [0, 1).");
    const { min = .85, max = 1, precision = 6 } = (_a = configuration.rules.quality) !== null && _a !== void 0 ? _a : {};
    return Number((min + (max - min) * value).toFixed(precision));
}
exports.sampleWeaponRivenQuality = sampleWeaponRivenQuality;
/** Tier table (linear between integer tiers) wins over the legacy power curve. */
function weaponRivenDispositionCoefficient(disposition, configuration) {
    const tiers = configuration.rules.disposition_tiers;
    if (tiers) {
        const clamped = Math.max(0, Math.min(5, disposition));
        const low = Math.floor(clamped), high = Math.min(5, low + 1);
        const a = tiers[String(low)], b = tiers[String(high)];
        return a + (b - a) * (clamped - low);
    }
    const curve = configuration.rules.disposition_curve;
    return curve
        ? curve.floor + (1 - curve.floor) * (disposition / 5) ** curve.exponent
        : disposition / 5;
}
exports.weaponRivenDispositionCoefficient = weaponRivenDispositionCoefficient;
/** Positive affixes that share the per-card percentage budget. */
function isWeaponRivenBudgetAffix(affix, configuration) {
    var _a;
    const model = configuration.rules.value_model;
    return !!model && affix.polarity === "+" && !affix.independent_damage
        && model.budget_units.includes((_a = affix.unit) !== null && _a !== void 0 ? _a : "");
}
exports.isWeaponRivenBudgetAffix = isWeaponRivenBudgetAffix;
function weaponRivenAffixBudget(affix, affixes, disposition, configuration, quality = 1) {
    var _a, _b, _c;
    const definitions = new Map(configuration.affixes.affixes.map(row => [row.key, row]));
    const dispositionCoefficient = weaponRivenDispositionCoefficient(disposition, configuration);
    const model = configuration.rules.value_model;
    let value;
    if (model) {
        if (affix.polarity === "-")
            value = affix.max_full * dispositionCoefficient * quality;
        else if (isWeaponRivenBudgetAffix(affix, configuration)) {
            // Proportional shares of budget*coef never exceed max_full*coef, so one ratio covers every case.
            const total = affixes.reduce((sum, [key]) => {
                const row = definitions.get(key);
                return row && isWeaponRivenBudgetAffix(row, configuration) ? sum + row.max_full : sum;
            }, 0) || affix.max_full;
            value = affix.max_full * dispositionCoefficient * Math.min(1, model.positive_budget_percent / total) * quality;
        }
        else {
            const ceiling = affix.independent_damage ? Math.min(affix.max_full, model.independent_positive_max_percent) : affix.max_full;
            value = ceiling * dispositionCoefficient * quality;
        }
    }
    else {
        const positive = affixes.filter(([key]) => { var _a; return ((_a = definitions.get(key)) === null || _a === void 0 ? void 0 : _a.polarity) === "+"; }).length;
        const negative = affixes.some(([key]) => { var _a; return ((_a = definitions.get(key)) === null || _a === void 0 ? void 0 : _a.polarity) === "-"; });
        const coefficient = affix.polarity === "-" ? 1
            : ((_b = (_a = configuration.rules.count_coefficients) === null || _a === void 0 ? void 0 : _a[String(positive)]) !== null && _b !== void 0 ? _b : 1)
                * (negative ? (_c = configuration.rules.negative_bonus) !== null && _c !== void 0 ? _c : 1.25 : 1);
        value = affix.max_full * dispositionCoefficient * coefficient * quality;
    }
    // Quality belongs inside the nonlinear mapping; scaling a mapped cap would change its meaning.
    return affix.curve === "reciprocal" ? 100 * value / (100 + value) : value;
}
exports.weaponRivenAffixBudget = weaponRivenAffixBudget;
/** Quality is a multiplier, not a level: 1 is explicitly a perfect quality. */
function validateWeaponRivenQualities(affixes, configuration) {
    if (!Array.isArray(affixes) || affixes.length < 1 || affixes.length > 4
        || affixes.some(pair => !Array.isArray(pair) || pair.length !== 2
            || !Number.isSafeInteger(pair[0]) || pair[0] < 15990001 || pair[0] >= 16000000
            || !Number.isFinite(pair[1]) || pair[1] < 0 || pair[1] > 1
            || Math.abs(pair[1] * 1e6 - Math.round(pair[1] * 1e6)) > 1e-7)
        || new Set(affixes.map(pair => pair[0])).size !== affixes.length) {
        throw new Error("Invalid weapon riven quality affixes");
    }
    if (configuration) {
        const keys = new Set(configuration.affixes.affixes.map(affix => affix.key));
        // Disabled definitions still own historical keys; only absent keys are invalid.
        for (const [key] of affixes) {
            if (!keys.has(key))
                throw new Error(`Missing historical weapon riven affix key ${key}`);
        }
    }
}
exports.validateWeaponRivenQualities = validateWeaponRivenQualities;
