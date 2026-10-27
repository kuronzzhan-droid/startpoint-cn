import rulesJson from "../../../assets/weapon_riven_rules.json"
import affixesJson from "../../../assets/weapon_riven_affixes.json"
import dispositionJson from "../../../assets/weapon_riven_disposition.json"
import { WeaponRivenAffix, WeaponRivenAffixDefinition, WeaponRivenRandom, WeaponRivenRuleSet, WeaponRivenSlot, WeaponRivenTheme } from "./rule-types"
import { validateWeaponRivenRuleSet } from "./validate-rules"
import { isWeaponRivenRevealExcluded, resolveWeaponRivenThemePool } from "./validate-v3"
import { normalizeWeaponRivenRuleSet } from "./load-rules"
import { sampleWeaponRivenQuality, weaponRivenAffixBudget } from "./quality"

export type { WeaponRivenAffix, WeaponRivenAffixDefinition, WeaponRivenRuleSet, WeaponRivenTheme } from "./rule-types"

export const weaponRivenRuleSet = normalizeWeaponRivenRuleSet(
    rulesJson as Parameters<typeof normalizeWeaponRivenRuleSet>[0],
    affixesJson as WeaponRivenRuleSet["affixes"],
    dispositionJson,
)

validateWeaponRivenRuleSet(weaponRivenRuleSet)

function unitRandom(random: WeaponRivenRandom): number {
    const value = random()
    if (!Number.isFinite(value) || value < 0 || value >= 1) {
        throw new RangeError("Weapon riven random source must return a value in [0, 1).")
    }
    return value
}

function weightedChoice<T>(choices: readonly T[], weight: (choice: T) => number, random: WeaponRivenRandom): T {
    const eligible = choices.filter(choice => weight(choice) > 0)
    const total = eligible.reduce((sum, choice) => sum + weight(choice), 0)
    if (!Number.isFinite(total) || total <= 0) throw new Error("Weapon riven rule has no eligible weighted choice.")
    let remaining = unitRandom(random) * total
    for (const choice of eligible) {
        remaining -= weight(choice)
        if (remaining < 0) return choice
    }
    return eligible[eligible.length - 1]
}

/** Encode against the one global key's endpoints, never per-weapon endpoints. */
export function weaponRivenValueToLevel(value: number, lo: number, hi: number): number {
    if (![value, lo, hi].every(Number.isFinite) || hi < lo) throw new RangeError("Invalid weapon riven value endpoints.")
    if (lo === hi) return 1
    return Math.max(1, Math.min(100, Math.round(1 + 99 * (value - lo) / (hi - lo))))
}

export function getWeaponRivenDisposition(
    weaponId: number, configuration: WeaponRivenRuleSet = weaponRivenRuleSet,
): number {
    if (!Number.isSafeInteger(weaponId) || weaponId <= 0) throw new RangeError("Invalid weapon ID.")
    const { disposition } = configuration
    const level = disposition.weapons[String(weaponId)] ?? disposition.default
    if (!Number.isFinite(level) || level < .1 || level > 5) throw new Error("Weapon riven disposition is not configured.")
    return level
}

/** Sampling and cap previews share polarity scaling and the global key's level encoding. */
function affixMagnitudeToLevel(
    affix: WeaponRivenAffixDefinition,
    coefficients: WeaponRivenRuleSet["disposition"]["levels"][string],
    magnitude: number,
): number {
    const coefficient = affix.polarity === "+" ? coefficients.positive_coefficient : coefficients.negative_coefficient
    return weaponRivenValueToLevel(coefficient * magnitude, affix.lo, affix.hi)
}

/** Disabled definitions still describe old cards; a missing historical key has no known cap. */
export function getWeaponRivenAffixCapLevel(
    weaponId: number, key: number, configuration: WeaponRivenRuleSet = weaponRivenRuleSet,
    cardAffixes: readonly WeaponRivenAffix[] = [[key, 1]],
): number | undefined {
    const level = getWeaponRivenDisposition(weaponId, configuration)
    const affix = configuration.affixes.affixes.find(definition => definition.key === key)
    if (!affix) return undefined
    if (configuration.rules.schema_version === 3) {
        return weaponRivenValueToLevel(weaponRivenAffixBudget(affix, cardAffixes, level, configuration), affix.lo, affix.hi)
    }
    return affixMagnitudeToLevel(affix, configuration.disposition.levels[String(level)], affix.max_full)
}

export function getWeaponRivenAffixCandidates(
    slot: WeaponRivenSlot,
    selected: readonly WeaponRivenAffixDefinition[],
    definitions: readonly WeaponRivenAffixDefinition[],
): WeaponRivenAffixDefinition[] {
    const usedKeys = new Set(selected.map(affix => affix.key))
    const groups = new Set(selected.map(affix => affix.exclusive_group).filter(Boolean))
    return definitions.filter(affix => affix.enabled && affix.weight > 0
        && affix.polarity === slot.polarity && affix.tier === slot.tier
        && !usedKeys.has(affix.key) && (!affix.exclusive_group || !groups.has(affix.exclusive_group))
        && (!affix.family || selected.every(previous => previous.family !== affix.family)))
}

/** Independent-multiplier positives are rare under the budget model. */
export function weaponRivenDrawWeight(affix: WeaponRivenAffixDefinition, configuration: WeaponRivenRuleSet): number {
    const model = configuration.rules.value_model
    return model && affix.polarity === "+" && affix.independent_damage
        ? affix.weight * model.independent_weight_factor : affix.weight
}

/** Configured theme for a themed unknown card; undefined for the plain unknown card. */
export function getWeaponRivenTheme(itemId: number, configuration: WeaponRivenRuleSet = weaponRivenRuleSet): WeaponRivenTheme | undefined {
    return configuration.rules.themes?.find(theme => theme.item_id === itemId)
}

/** Union of category, explicit IDs and ranges, restricted to weapons the disposition table knows,
 * minus excluded themes' pools and the global reveal exclusions. */
export function getWeaponRivenThemePool(theme: WeaponRivenTheme, configuration: WeaponRivenRuleSet = weaponRivenRuleSet): number[] {
    return resolveWeaponRivenThemePool(theme, configuration)
}

/** PARADOX, GM test weapons and test copies never come out of any unknown card, plain or themed. */
export function isWeaponRivenRevealCandidate(weaponId: number, configuration: WeaponRivenRuleSet = weaponRivenRuleSet): boolean {
    return !isWeaponRivenRevealExcluded(weaponId, configuration)
}

/** v3 draws persist actual quality multipliers; only response projection produces levels. */
export function rollWeaponRivenQualitiesWithRules(
    weaponId: number, configuration: WeaponRivenRuleSet, random: WeaponRivenRandom = Math.random,
): WeaponRivenAffix[] {
    getWeaponRivenDisposition(weaponId, configuration)
    const structures = configuration.rules.structures
    if (!structures?.length) throw new Error("Weapon riven v3 structures are missing")
    const structure = weightedChoice(structures, row => row.probability, random)
    const selected: WeaponRivenAffixDefinition[] = []
    const result: WeaponRivenAffix[] = []
    for (let index = 0; index < structure.positive + structure.negative; index++) {
        const polarity = index < structure.positive ? "+" : "-"
        const candidates = configuration.affixes.affixes.filter(affix => affix.enabled && affix.weight > 0
            && affix.polarity === polarity && !affix.legacy_only
            && selected.every(previous => previous.key !== affix.key
                && (!affix.family || previous.family !== affix.family)
                && (!affix.exclusive_group || previous.exclusive_group !== affix.exclusive_group)))
        const affix = weightedChoice(candidates, candidate => weaponRivenDrawWeight(candidate, configuration), random)
        selected.push(affix)
        result.push([affix.key, sampleWeaponRivenQuality(configuration, random)])
    }
    return result
}

export function rollWeaponRivenQualities(weaponId: number, random: WeaponRivenRandom = Math.random): WeaponRivenAffix[] {
    return rollWeaponRivenQualitiesWithRules(weaponId, weaponRivenRuleSet, random)
}

export function rerollWeaponRivenQualities(
    affixes: readonly WeaponRivenAffix[], random: WeaponRivenRandom = Math.random,
    configuration: WeaponRivenRuleSet = weaponRivenRuleSet,
): WeaponRivenAffix[] {
    return affixes.map(([key]) => [key, sampleWeaponRivenQuality(configuration, random)])
}

/** Pure sampling entry point for tests and generator contract checks. Validate custom rule sets first. */
export function rollWeaponRivenAffixesWithRules(
    weaponId: number,
    configuration: WeaponRivenRuleSet,
    random: WeaponRivenRandom = Math.random,
): WeaponRivenAffix[] {
    const level = getWeaponRivenDisposition(weaponId, configuration)
    if (configuration.rules.schema_version === 3) {
        const qualities = rollWeaponRivenQualitiesWithRules(weaponId, configuration, random)
        return qualities.map(([key, quality]) => {
            const definition = configuration.affixes.affixes.find(affix => affix.key === key)!
            return [key, weaponRivenValueToLevel(
                weaponRivenAffixBudget(definition, qualities, level, configuration, quality),
                definition.lo, definition.hi)]
        })
    }
    const { rules, affixes, disposition } = configuration
    const count = weightedChoice(rules.affix_count_probabilities, row => row.probability, random).count
    const combination = weightedChoice(rules.combinations.filter(row => row.count === count), row => row.conditional_probability, random)
    const coefficients = disposition.levels[String(level)]
    const selected: WeaponRivenAffixDefinition[] = []
    const result: WeaponRivenAffix[] = []
    for (const slot of combination.slots) {
        const candidates = getWeaponRivenAffixCandidates(slot, selected, affixes.affixes)
        const affix = weightedChoice(candidates, candidate => candidate.weight, random)
        selected.push(affix)
        const magnitude = affix.min + (affix.max_full - affix.min) * unitRandom(random) ** coefficients.k
        result.push([affix.key, affixMagnitudeToLevel(affix, coefficients, magnitude)])
    }
    return result
}

export function rollWeaponRivenAffixes(weaponId: number, random: WeaponRivenRandom = Math.random): WeaponRivenAffix[] {
    return rollWeaponRivenAffixesWithRules(weaponId, weaponRivenRuleSet, random)
}

export function getWeaponRivenCostOptions(
    rollCount: number, configuration: WeaponRivenRuleSet = weaponRivenRuleSet,
): [number, number][] {
    if (!Number.isSafeInteger(rollCount) || rollCount < 0) throw new RangeError("Invalid weapon riven roll count.")
    return configuration.rules.reroll.cost_items.map(({ item_id, costs }) =>
        [item_id, costs[Math.min(rollCount, costs.length - 1)]])
}

/** Legacy clients display the first configured payment option. */
export function getWeaponRivenCost(
    rollCount: number, configuration: WeaponRivenRuleSet = weaponRivenRuleSet,
): number {
    return getWeaponRivenCostOptions(rollCount, configuration)[0][1]
}

/** Count confirmed affixes and paid rerolls; a pending candidate does not replace the card's affixes. */
export function getWeaponRivenDismantleReward(
    affixCount: number, rollCount: number, configuration: WeaponRivenRuleSet = weaponRivenRuleSet,
): { itemId: number, amount: number } | null {
    if (!Number.isSafeInteger(affixCount) || affixCount < 1 || affixCount > 4
        || !Number.isSafeInteger(rollCount) || rollCount < 0) throw new RangeError("Invalid weapon riven dismantle counts.")
    const { item_id, base, per_affix, per_roll } = configuration.rules.dismantle_return
    const amount = base + per_affix * affixCount + per_roll * rollCount
    if (!Number.isSafeInteger(amount) || amount < 0) throw new RangeError("Invalid weapon riven dismantle amount.")
    return item_id !== null && amount > 0 ? { itemId: item_id, amount } : null
}
