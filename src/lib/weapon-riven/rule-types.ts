export type WeaponRivenAffix = [number, number]
export type WeaponRivenRandom = () => number

export interface WeaponRivenSlot {
    polarity: "+" | "-"
    /** Legacy slots restrict a tier; v3 structures use only polarity. */
    tier?: string
}

export interface WeaponRivenAffixDefinition extends WeaponRivenSlot {
    tier: string
    id: string
    key: number
    enabled: boolean
    weight: number
    exclusive_group: string | null
    min: number
    max_full: number
    /** Optional percentage-magnitude mapping, applied after disposition, count and quality. */
    curve?: "reciprocal"
    /** Global, nonnegative magnitude endpoints, shared by all dispositions. */
    lo: number
    hi: number
    raw_lo?: number
    raw_hi?: number
    raw_per_unit?: number
    raw_sign?: number
    unit?: string
    kind?: { id: number }
    resolve_int?: boolean
    family?: string
    scope?: string
    legacy_only?: boolean
    /** Independent multiplier affixes sit outside the positive budget. */
    independent_damage?: boolean
    legacy_encoding?: { lo: number; hi: number; raw_lo?: number; raw_hi?: number; raw_per_unit?: number; resolve_int?: boolean }
}

export interface WeaponRivenRules {
    schema_version: number
    items: { holding_limit: number }
    affix_count_probabilities: { count: number, probability: number }[]
    combinations: {
        id: string
        count: number
        conditional_probability: number
        slots: WeaponRivenSlot[]
    }[]
    reroll: { cost_items: { item_id: number, costs: number[] }[] }
    dismantle_return: { item_id: number | null, base: number, per_affix: number, per_roll: number }
    structures?: { id: string; positive: number; negative: number; probability: number }[]
    count_coefficients?: Record<string, number>
    negative_bonus?: number
    /** Omitted by older v3 configurations, which retain linear d / 5 scaling. */
    disposition_curve?: { floor: number; exponent: number }
    /** Integer disposition tier -> coefficient, linearly interpolated; supersedes disposition_curve. */
    disposition_tiers?: Record<string, number>
    /** Absent: legacy per-count coefficients. positive_budget: one shared positive percentage budget per card. */
    value_model?: WeaponRivenValueModel
    /** Themed unknown cards reveal only into their own weapon pool. */
    themes?: WeaponRivenTheme[]
    /** Weapons no unknown card (plain or themed) may ever reveal into. */
    reveal_exclusions?: WeaponRivenWeaponSet
    quality?: { min: number; max: number; precision: number }
    max_rivens_per_party?: number
}

export interface WeaponRivenValueModel {
    kind: "positive_budget"
    positive_budget_percent: number
    budget_units: string[]
    independent_weight_factor: number
    independent_positive_max_percent: number
}

export interface WeaponRivenWeaponSet {
    disposition_categories?: string[]
    weapon_ids?: (number | string)[]
    /** Inclusive [low, high] pairs; validated as pairs (JSON imports type them as number[][]). */
    id_ranges?: number[][]
}

export interface WeaponRivenTheme {
    id: string
    item_id: number
    name_zh?: string
    /** Union of the three selectors, minus the pools of the themes named in exclude_themes. */
    pool: WeaponRivenWeaponSet & { exclude_themes?: string[] }
    /** pool: no owned pool weapon reveals from the whole pool. */
    fallback?: "pool"
}

export interface WeaponRivenDispositions {
    schema_version: number
    default: number
    levels: Record<string, { positive_coefficient: number, negative_coefficient: number, k: number }>
    weapons: Record<string, number>
    metadata?: Record<string, { categories?: string[] }>
    categories?: { id: string }[]
}

export interface WeaponRivenRuleSet {
    rules: WeaponRivenRules
    affixes: { schema_version: number, affixes: WeaponRivenAffixDefinition[] }
    disposition: WeaponRivenDispositions
}
