import { FIRST_RIVEN_ITEM_ID, LAST_RIVEN_ITEM_ID, isWeaponRivenItemId } from "./constants"
import { WeaponRivenAffixDefinition, WeaponRivenRuleSet, WeaponRivenSlot } from "./rule-types"
import { validateWeaponRivenV3 } from "./validate-v3"

function requireRule(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(`Invalid weapon riven configuration: ${message}`)
}

function nonnegative(value: number): boolean {
    return Number.isFinite(value) && value >= 0
}

/** Reject any reachable dead end rather than silently dropping slots or rerolling a combination. */
function validateSelectionPaths(
    slots: WeaponRivenSlot[], definitions: WeaponRivenAffixDefinition[],
    selected: WeaponRivenAffixDefinition[] = [], verified = new Set<string>(),
): void {
    if (selected.length === slots.length) return
    // Only the used keys/groups affect later slots; permutations share a state.
    // Supported cards have at most four slots, so validation never grows with an unbounded depth.
    const state = selected.map(affix => affix.key).sort((a, b) => a - b).join(",")
    if (verified.has(state)) return
    const slot = slots[selected.length]
    const candidates = definitions.filter(affix => affix.enabled && affix.weight > 0
        && affix.polarity === slot.polarity && affix.tier === slot.tier
        && selected.every(previous => previous.key !== affix.key
            && (!affix.exclusive_group || previous.exclusive_group !== affix.exclusive_group)))
    requireRule(candidates.length > 0, "a combination can exhaust its eligible affix pool")
    for (const candidate of candidates) validateSelectionPaths(slots, definitions, [...selected, candidate], verified)
    verified.add(state)
}

export function validateWeaponRivenRuleSet(configuration: WeaponRivenRuleSet): void {
    const { rules, affixes, disposition } = configuration
    requireRule([1,3].includes(rules.schema_version) && affixes.schema_version === rules.schema_version
        && disposition.schema_version === rules.schema_version, "unsupported schema version")
    requireRule(Number.isSafeInteger(rules.items?.holding_limit) && rules.items.holding_limit > 0
        && rules.items.holding_limit <= LAST_RIVEN_ITEM_ID - FIRST_RIVEN_ITEM_ID + 1, "invalid holding limit")
    const costItems = rules.reroll.cost_items
    requireRule(Array.isArray(costItems) && costItems.length > 0, "reroll cost_items must be a nonempty list")
    for (const item of costItems) {
        requireRule(!!item && Number.isSafeInteger(item.item_id) && item.item_id > 0
            && !isWeaponRivenItemId(item.item_id), "reroll cost item must be an ordinary inventory item")
        requireRule(Array.isArray(item.costs) && item.costs.length > 0
            && item.costs.every(value => Number.isSafeInteger(value) && value > 0), "invalid reroll costs")
    }
    requireRule(new Set(costItems.map(item => item.item_id)).size === costItems.length, "duplicate reroll cost item")
    const refund = rules.dismantle_return
    requireRule(!!refund && [refund.base, refund.per_affix, refund.per_roll]
        .every(value => Number.isSafeInteger(value) && value >= 0), "invalid dismantle return amounts")
    requireRule(refund.item_id === null
        ? refund.base === 0 && refund.per_affix === 0 && refund.per_roll === 0
        : Number.isSafeInteger(refund.item_id) && refund.item_id > 0 && !isWeaponRivenItemId(refund.item_id),
    "dismantle reward must be an ordinary inventory item")
    for (const value of rules.schema_version === 3 ? [] : [disposition.default, ...Object.values(disposition.weapons)]) {
        requireRule(Number.isInteger(value) && value >= 1 && value <= 5 && disposition.levels[String(value)], "unknown disposition level")
    }
    for (const value of Object.values(disposition.levels)) {
        requireRule(nonnegative(value.positive_coefficient) && value.positive_coefficient > 0
            && nonnegative(value.negative_coefficient) && value.negative_coefficient > 0
            && Number.isFinite(value.k) && value.k > 0, "invalid disposition coefficient or exponent")
    }
    requireRule(affixes.affixes.length > 0, "empty affix list")
    requireRule(new Set(affixes.affixes.map(affix => affix.key)).size === affixes.affixes.length, "duplicate affix key")
    requireRule(new Set(affixes.affixes.map(affix => affix.id)).size === affixes.affixes.length, "duplicate affix ID")
    for (const affix of affixes.affixes) {
        requireRule(Number.isSafeInteger(affix.key) && affix.key >= 15_990_001 && affix.key < 16_000_000, "affix key outside allocated range")
        requireRule(affix.id.length > 0 && affix.tier.length > 0 && ["+", "-"].includes(affix.polarity), "invalid affix identity or slot")
        requireRule(typeof affix.enabled === "boolean" && nonnegative(affix.weight), "invalid affix selection weight")
        requireRule([affix.min, affix.max_full, affix.lo, affix.hi].every(nonnegative)
            && affix.min <= affix.max_full && affix.lo <= affix.hi, "invalid affix magnitude range")
        for (const level of rules.schema_version === 3 ? [] : Object.values(disposition.levels)) {
            const coefficient = affix.polarity === "+" ? level.positive_coefficient : level.negative_coefficient
            requireRule(coefficient * affix.min >= affix.lo - 1e-9
                && coefficient * affix.max_full <= affix.hi + 1e-9, "global endpoints do not cover every disposition")
        }
    }
    if (rules.schema_version === 3) return validateWeaponRivenV3(configuration)
    requireRule(rules.affix_count_probabilities.length > 0
        && rules.affix_count_probabilities.some(row => row.probability > 0), "empty affix count distribution")
    requireRule(new Set(rules.affix_count_probabilities.map(row => row.count)).size === rules.affix_count_probabilities.length, "duplicate affix count")
    for (const row of rules.affix_count_probabilities) {
        requireRule(Number.isInteger(row.count) && row.count >= 1 && row.count <= 4 && nonnegative(row.probability), "invalid affix count distribution")
        if (row.probability === 0) continue
        const combinations = rules.combinations.filter(combination => combination.count === row.count)
        requireRule(combinations.some(combination => combination.conditional_probability > 0), "affix count has no combinations")
        for (const combination of combinations) {
            requireRule(nonnegative(combination.conditional_probability) && combination.slots.length === row.count, "invalid combination")
            requireRule(combination.slots.every(slot => ["+", "-"].includes(slot.polarity)
                && typeof slot.tier === "string" && slot.tier.length > 0), "invalid combination slot")
            const negatives = combination.slots.filter(slot => slot.polarity === "-").length
            requireRule(negatives <= 1 && (row.count !== 1 || negatives === 0)
                && (row.count !== 4 || negatives === 1), "unsupported polarity combination")
            if (combination.conditional_probability > 0) validateSelectionPaths(combination.slots, affixes.affixes)
        }
    }
}
