import { WeaponRivenRuleSet, WeaponRivenRules } from "./rule-types"

interface GeneratedRules extends Omit<WeaponRivenRules, "reroll" | "dismantle_return"> {
    reroll: {
        cost_items?: WeaponRivenRules["reroll"]["cost_items"]
        currency?: { item_id: number }
        costs?: { amount: number, paid_reroll_ordinal?: number, paid_reroll_ordinal_from?: number }[]
    }
    dismantle_return?: { item_id: number | null, base: number, per_affix?: number, per_roll?: number }
    dismantle?: { refund_item_id: number | null, refund_amount: number }
}

function normalizeReroll(reroll: GeneratedRules["reroll"]): WeaponRivenRules["reroll"] {
    // An explicitly supplied new table is authoritative, including invalid tables rejected by validation.
    if (Object.prototype.hasOwnProperty.call(reroll, "cost_items")) return { cost_items: reroll.cost_items! }
    if (!reroll.currency || !Array.isArray(reroll.costs)) {
        throw new Error("Invalid weapon riven configuration: reroll costs are missing")
    }
    const costs = reroll.costs.map((row, index, rows) => {
        const ordinal = index === rows.length - 1 ? row.paid_reroll_ordinal_from : row.paid_reroll_ordinal
        if (ordinal !== index + 1) throw new Error("Invalid weapon riven configuration: reroll cost ordinals must be consecutive and end with a capped tier")
        return row.amount
    })
    return { cost_items: [{ item_id: reroll.currency.item_id, costs }] }
}

/** Normalize the generator's documented JSON shape without changing its economic parameters. */
export function normalizeWeaponRivenRuleSet(
    rules: GeneratedRules,
    affixes: WeaponRivenRuleSet["affixes"],
    disposition: Omit<WeaponRivenRuleSet["disposition"], "default"> & { default?: number },
): WeaponRivenRuleSet {
    const reroll = normalizeReroll(rules.reroll)
    const refund = rules.dismantle_return ?? (rules.dismantle && {
        item_id: rules.dismantle.refund_item_id, base: rules.dismantle.refund_amount,
    })
    if (!refund) throw new Error("Invalid weapon riven configuration: dismantle return is missing")
    return {
        rules: {
            ...rules,
            reroll,
            dismantle_return: { per_affix: 0, per_roll: 0, ...refund },
        },
        affixes,
        // Future weapons remain conservative until the disposition map is refreshed.
        disposition: { ...disposition, default: disposition.default ?? 1 },
    }
}
