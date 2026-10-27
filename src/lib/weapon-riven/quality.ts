import { WeaponRivenAffix, WeaponRivenAffixDefinition, WeaponRivenRandom, WeaponRivenRuleSet } from "./rule-types"

export function sampleWeaponRivenQuality(configuration: WeaponRivenRuleSet, random: WeaponRivenRandom): number {
    const value = random()
    if (!Number.isFinite(value) || value < 0 || value >= 1) throw new RangeError("Weapon riven random source must return a value in [0, 1).")
    const { min = .85, max = 1, precision = 6 } = configuration.rules.quality ?? {}
    return Number((min + (max - min) * value).toFixed(precision))
}

/** Tier table (linear between integer tiers) wins over the legacy power curve. */
export function weaponRivenDispositionCoefficient(disposition: number, configuration: WeaponRivenRuleSet): number {
    const tiers = configuration.rules.disposition_tiers
    if (tiers) {
        const clamped = Math.max(0, Math.min(5, disposition))
        const low = Math.floor(clamped), high = Math.min(5, low + 1)
        const a = tiers[String(low)], b = tiers[String(high)]
        return a + (b - a) * (clamped - low)
    }
    const curve = configuration.rules.disposition_curve
    return curve
        ? curve.floor + (1 - curve.floor) * (disposition / 5) ** curve.exponent
        : disposition / 5
}

/** Positive affixes that share the per-card percentage budget. */
export function isWeaponRivenBudgetAffix(affix: WeaponRivenAffixDefinition, configuration: WeaponRivenRuleSet): boolean {
    const model = configuration.rules.value_model
    return !!model && affix.polarity === "+" && !affix.independent_damage
        && model.budget_units.includes(affix.unit ?? "")
}

export function weaponRivenAffixBudget(
    affix: WeaponRivenAffixDefinition, affixes: readonly WeaponRivenAffix[],
    disposition: number, configuration: WeaponRivenRuleSet,
    quality = 1,
): number {
    const definitions = new Map(configuration.affixes.affixes.map(row => [row.key, row]))
    const dispositionCoefficient = weaponRivenDispositionCoefficient(disposition, configuration)
    const model = configuration.rules.value_model
    let value: number
    if (model) {
        if (affix.polarity === "-") value = affix.max_full * dispositionCoefficient * quality
        else if (isWeaponRivenBudgetAffix(affix, configuration)) {
            // Proportional shares of budget*coef never exceed max_full*coef, so one ratio covers every case.
            const total = affixes.reduce((sum, [key]) => {
                const row = definitions.get(key)
                return row && isWeaponRivenBudgetAffix(row, configuration) ? sum + row.max_full : sum
            }, 0) || affix.max_full
            value = affix.max_full * dispositionCoefficient * Math.min(1, model.positive_budget_percent / total) * quality
        } else {
            const ceiling = affix.independent_damage ? Math.min(affix.max_full, model.independent_positive_max_percent) : affix.max_full
            value = ceiling * dispositionCoefficient * quality
        }
    } else {
        const positive = affixes.filter(([key]) => definitions.get(key)?.polarity === "+").length
        const negative = affixes.some(([key]) => definitions.get(key)?.polarity === "-")
        const coefficient = affix.polarity === "-" ? 1
            : (configuration.rules.count_coefficients?.[String(positive)] ?? 1)
                * (negative ? configuration.rules.negative_bonus ?? 1.25 : 1)
        value = affix.max_full * dispositionCoefficient * coefficient * quality
    }
    // Quality belongs inside the nonlinear mapping; scaling a mapped cap would change its meaning.
    return affix.curve === "reciprocal" ? 100 * value / (100 + value) : value
}


/** Quality is a multiplier, not a level: 1 is explicitly a perfect quality. */
export function validateWeaponRivenQualities(
    affixes: unknown, configuration?: WeaponRivenRuleSet,
): asserts affixes is WeaponRivenAffix[] {
    if (!Array.isArray(affixes) || affixes.length < 1 || affixes.length > 4
        || affixes.some(pair => !Array.isArray(pair) || pair.length !== 2
            || !Number.isSafeInteger(pair[0]) || pair[0] < 15990001 || pair[0] >= 16000000
            || !Number.isFinite(pair[1]) || pair[1] < 0 || pair[1] > 1
            || Math.abs(pair[1] * 1e6 - Math.round(pair[1] * 1e6)) > 1e-7)
        || new Set(affixes.map(pair => pair[0])).size !== affixes.length) {
        throw new Error("Invalid weapon riven quality affixes")
    }
    if (configuration) {
        const keys = new Set(configuration.affixes.affixes.map(affix => affix.key))
        // Disabled definitions still own historical keys; only absent keys are invalid.
        for (const [key] of affixes) {
            if (!keys.has(key)) throw new Error(`Missing historical weapon riven affix key ${key}`)
        }
    }
}
