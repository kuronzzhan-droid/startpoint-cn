"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeWeaponRivenRuleSet = void 0;
function normalizeReroll(reroll) {
    // An explicitly supplied new table is authoritative, including invalid tables rejected by validation.
    if (Object.prototype.hasOwnProperty.call(reroll, "cost_items"))
        return { cost_items: reroll.cost_items };
    if (!reroll.currency || !Array.isArray(reroll.costs)) {
        throw new Error("Invalid weapon riven configuration: reroll costs are missing");
    }
    const costs = reroll.costs.map((row, index, rows) => {
        const ordinal = index === rows.length - 1 ? row.paid_reroll_ordinal_from : row.paid_reroll_ordinal;
        if (ordinal !== index + 1)
            throw new Error("Invalid weapon riven configuration: reroll cost ordinals must be consecutive and end with a capped tier");
        return row.amount;
    });
    return { cost_items: [{ item_id: reroll.currency.item_id, costs }] };
}
/** Normalize the generator's documented JSON shape without changing its economic parameters. */
function normalizeWeaponRivenRuleSet(rules, affixes, disposition) {
    var _a, _b;
    const reroll = normalizeReroll(rules.reroll);
    const refund = (_a = rules.dismantle_return) !== null && _a !== void 0 ? _a : (rules.dismantle && {
        item_id: rules.dismantle.refund_item_id, base: rules.dismantle.refund_amount,
    });
    if (!refund)
        throw new Error("Invalid weapon riven configuration: dismantle return is missing");
    return {
        rules: Object.assign(Object.assign({}, rules), { reroll, dismantle_return: Object.assign({ per_affix: 0, per_roll: 0 }, refund) }),
        affixes,
        // Future weapons remain conservative until the disposition map is refreshed.
        disposition: Object.assign(Object.assign({}, disposition), { default: (_b = disposition.default) !== null && _b !== void 0 ? _b : 1 }),
    };
}
exports.normalizeWeaponRivenRuleSet = normalizeWeaponRivenRuleSet;
