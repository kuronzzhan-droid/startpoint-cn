import { WeaponRivenAffixDefinition, WeaponRivenRuleSet, WeaponRivenTheme, WeaponRivenWeaponSet } from "./rule-types"

const FIRST_THEME_ITEM_ID = 16_000_901, LAST_THEME_ITEM_ID = 16_000_919

function inWeaponRivenSet(set: WeaponRivenWeaponSet | undefined, weaponId: number, configuration: WeaponRivenRuleSet): boolean {
    if (!set) return false
    const categories = set.disposition_categories ?? []
    return (set.weapon_ids ?? []).some(id => Number(id) === weaponId)
        || (set.id_ranges ?? []).some(([low, high]) => weaponId >= low && weaponId <= high)
        || (categories.length > 0 && (configuration.disposition.metadata?.[String(weaponId)]?.categories ?? [])
            .some(category => categories.includes(category)))
}

/** Global reveal exclusions apply to every weapon ID, registered in the disposition table or not. */
export function isWeaponRivenRevealExcluded(weaponId: number, configuration: WeaponRivenRuleSet): boolean {
    return inWeaponRivenSet(configuration.rules.reveal_exclusions, weaponId, configuration)
}

/** Disposition-registered weapons in the theme pool, minus excluded themes' pools and global exclusions. */
export function resolveWeaponRivenThemePool(
    theme: WeaponRivenTheme, configuration: WeaponRivenRuleSet, visiting: ReadonlySet<string> = new Set(),
): number[] {
    if (visiting.has(theme.id)) throw new Error(`Invalid weapon riven configuration: theme ${theme.id} exclusion cycle`)
    const path = new Set([...visiting, theme.id])
    const excluded = new Set<number>()
    for (const id of theme.pool.exclude_themes ?? []) {
        const other = configuration.rules.themes?.find(row => row.id === id)
        if (!other) throw new Error(`Invalid weapon riven configuration: theme ${theme.id} excludes unknown theme ${id}`)
        for (const weaponId of resolveWeaponRivenThemePool(other, configuration, path)) excluded.add(weaponId)
    }
    return Object.keys(configuration.disposition.weapons).map(Number)
        .filter(id => Number.isSafeInteger(id) && inWeaponRivenSet(theme.pool, id, configuration)
            && !excluded.has(id) && !isWeaponRivenRevealExcluded(id, configuration))
        .sort((a, b) => a - b)
}

function validWeaponRivenSet(set: WeaponRivenWeaponSet | undefined): boolean {
    return !!set && typeof set === "object"
        && (set.disposition_categories === undefined || Array.isArray(set.disposition_categories)
            && set.disposition_categories.every(category => typeof category === "string"))
        && (set.weapon_ids === undefined || Array.isArray(set.weapon_ids)
            && set.weapon_ids.every(id => Number.isSafeInteger(Number(id)) && Number(id) > 0))
        && (set.id_ranges === undefined || Array.isArray(set.id_ranges) && set.id_ranges.every(range => Array.isArray(range)
            && range.length === 2 && Number.isSafeInteger(range[0]) && Number.isSafeInteger(range[1]) && range[0] <= range[1]))
}

export function validateWeaponRivenV3(configuration: WeaponRivenRuleSet): void {
    const require = (condition: unknown, message: string): void => {
        if (!condition) throw new Error(`Invalid weapon riven configuration: ${message}`)
    }
    const { rules, affixes, disposition } = configuration
    require(rules.max_rivens_per_party === 1, "v3 must limit each party to one revealed riven")
    require(!!rules.quality && rules.quality.min >= 0 && rules.quality.max <= 1
        && rules.quality.min < rules.quality.max && rules.quality.precision === 6, "invalid quality range")
    require(!!rules.count_coefficients && [1, 2, 3].every(count =>
        Number.isFinite(rules.count_coefficients![count]) && rules.count_coefficients![count] > 0), "invalid count coefficients")
    require(Number.isFinite(rules.negative_bonus) && rules.negative_bonus! > 0, "invalid negative bonus")
    if (rules.disposition_curve !== undefined) {
        const curve = rules.disposition_curve
        require(!!curve && Number.isFinite(curve.floor) && curve.floor >= 0 && curve.floor < 1
            && Number.isFinite(curve.exponent) && curve.exponent > 0, "invalid disposition curve")
    }
    if (rules.disposition_tiers !== undefined) {
        const tiers = rules.disposition_tiers
        const values = [0, 1, 2, 3, 4, 5].map(tier => tiers?.[String(tier)])
        require(!!tiers && values.every(value => Number.isFinite(value) && value! > 0 && value! <= 1)
            && values.every((value, index) => index === 0 || value! >= values[index - 1]!), "invalid disposition tiers")
    }
    if (rules.value_model !== undefined) {
        const model = rules.value_model
        require(!!model && model.kind === "positive_budget" && Number.isFinite(model.positive_budget_percent)
            && model.positive_budget_percent > 0 && Array.isArray(model.budget_units)
            && Number.isFinite(model.independent_weight_factor) && model.independent_weight_factor > 0
            && model.independent_weight_factor <= 1 && Number.isFinite(model.independent_positive_max_percent)
            && model.independent_positive_max_percent > 0, "invalid value model")
    }
    if (rules.reveal_exclusions !== undefined) {
        require(validWeaponRivenSet(rules.reveal_exclusions), "invalid reveal exclusions")
    }
    if (rules.themes !== undefined) {
        require(Array.isArray(rules.themes), "invalid themes")
        const ids = new Set<number>(), names = new Set<string>()
        for (const theme of rules.themes) {
            require(!!theme && typeof theme.id === "string" && !names.has(theme.id) && Number.isSafeInteger(theme.item_id)
                && theme.item_id >= FIRST_THEME_ITEM_ID && theme.item_id <= LAST_THEME_ITEM_ID && !ids.has(theme.item_id)
                && validWeaponRivenSet(theme.pool)
                && (theme.pool.exclude_themes === undefined || Array.isArray(theme.pool.exclude_themes)
                    && theme.pool.exclude_themes.every(id => typeof id === "string"))
                && (theme.fallback === undefined || theme.fallback === "pool"), "invalid theme")
            ids.add(theme.item_id)
            names.add(theme.id)
        }
        // A theme whose pool is empty after exclusions could never reveal: refuse the whole configuration.
        for (const theme of rules.themes) {
            require(resolveWeaponRivenThemePool(theme, configuration).length > 0, `theme ${theme.id} has an empty weapon pool`)
        }
    }
    for (const value of [disposition.default, ...Object.values(disposition.weapons)]) {
        require(Number.isFinite(value) && value >= .1 && value <= 5, "unknown disposition level")
    }
    const structures = rules.structures ?? []
    // Scope variants in the same family have identical exclusion behavior.
    // Validate their reachable family states once, not once per cosmetic key permutation.
    const representatives = [...new Map(affixes.affixes.filter(row => row.enabled && !row.legacy_only && row.weight > 0)
        .map(row => [`${row.polarity}:${row.family}:${row.exclusive_group ?? ""}`,row])).values()]
    require(structures.length > 0 && Math.abs(structures.reduce((sum, row) => sum + row.probability, 0) - 1) < 1e-9,
        "invalid structure probabilities")
    for (const structure of structures) {
        require(Number.isInteger(structure.positive) && structure.positive >= 1 && structure.positive <= 3
            && (structure.negative === 0 || structure.negative === 1)
            && Number.isFinite(structure.probability) && structure.probability >= 0, "invalid structure")
        if (!structure.probability) continue
        const visited = new Set<string>()
        const visit = (selected: WeaponRivenAffixDefinition[]): void => {
            if (selected.length === structure.positive + structure.negative) return
            const state = selected.map(row => `${row.family}:${row.exclusive_group ?? ""}`).sort().join(",")
            if (visited.has(state)) return
            visited.add(state)
            const polarity = selected.length < structure.positive ? "+" : "-"
            const eligible = representatives.filter(row => row.polarity === polarity && selected.every(previous => previous.key !== row.key
                    && previous.family !== row.family
                    && (!row.exclusive_group || previous.exclusive_group !== row.exclusive_group)))
            require(eligible.length > 0, "a combination can exhaust its eligible affix pool")
            for (const candidate of eligible) visit([...selected, candidate])
        }
        visit([])
    }
    for (const affix of affixes.affixes) {
        require(typeof affix.family === "string" && affix.family.length > 0 && typeof affix.scope === "string", "missing family or scope")
        require(affix.curve === undefined || affix.curve === "reciprocal", "invalid affix curve")
        if (affix.curve === "reciprocal") {
            require(affix.polarity === "-" && affix.max_full > 0 && affix.lo === 0 && affix.hi < 100,
                "invalid reciprocal affix endpoints or polarity")
            require(affix.unit === "percent" && affix.raw_sign === -1
                && [723, 693, 694, 695, 55].includes(affix.kind?.id ?? -1), "invalid reciprocal damage encoding")
            const scale = affix.raw_per_unit
            require(Number.isFinite(scale) && scale! > 0 && affix.raw_lo === 0
                && affix.raw_hi === Math.round(-affix.hi * scale!)
                && affix.raw_hi! / scale! > -100, "invalid reciprocal raw endpoints")
        }
        const maximum = affix.curve === "reciprocal" ? 100 * affix.max_full / (100 + affix.max_full) : affix.max_full
        // Legacy-only rows are still re-projected from stored q, so they need the same coverage.
        require(affix.lo === 0 && affix.hi + 1e-9 >= maximum, "global endpoints do not cover every disposition")
    }
}
