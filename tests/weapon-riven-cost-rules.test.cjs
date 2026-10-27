const test = require("node:test")
const assert = require("node:assert/strict")
require("ts-node/register/transpile-only")

const { weaponRivenRuleSet, getWeaponRivenCost, getWeaponRivenCostOptions } = require("../src/lib/weapon-riven/rules")
const { normalizeWeaponRivenRuleSet } = require("../src/lib/weapon-riven/load-rules")
const { validateWeaponRivenRuleSet } = require("../src/lib/weapon-riven/validate-rules")
const generatedRules = require("../assets/weapon_riven_rules.json")
const generatedAffixes = require("../assets/weapon_riven_affixes.json")
const generatedDisposition = require("../assets/weapon_riven_disposition.json")

const clone = () => structuredClone(weaponRivenRuleSet)
const normalize = rules => normalizeWeaponRivenRuleSet(rules, generatedAffixes, generatedDisposition)
const abyssCosts = [50, 200, 350, 500, 650, 800, 950, 1100, 1250, 1400, 1550, 1700, 1850, 2000]

test("author's 14-tier abyss costs and fixed crystal cost share the card's paid count", () => {
    for (let count = 0; count < abyssCosts.length; count++) {
        assert.deepEqual(getWeaponRivenCostOptions(count), [[2370099, abyssCosts[count]], [10000320, 1]])
        assert.equal(getWeaponRivenCost(count), abyssCosts[count])
    }
    for (const count of [14, 1000, Number.MAX_SAFE_INTEGER]) {
        assert.deepEqual(getWeaponRivenCostOptions(count), [[2370099, 2000], [10000320, 1]])
        assert.equal(getWeaponRivenCost(count), 2000)
    }
    for (const count of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
        assert.throws(() => getWeaponRivenCostOptions(count), /roll count/)
    }
})

test("configured order controls the compatibility fee and every item's schedule caps independently", () => {
    const configuration = clone()
    configuration.rules.reroll.cost_items = [
        { item_id: 10000320, costs: [1] },
        { item_id: 2370099, costs: abyssCosts },
        { item_id: 16000900, costs: [2, 4] },
    ]
    validateWeaponRivenRuleSet(configuration)
    assert.deepEqual(getWeaponRivenCostOptions(0, configuration), [[10000320, 1], [2370099, 50], [16000900, 2]])
    assert.deepEqual(getWeaponRivenCostOptions(4, configuration), [[10000320, 1], [2370099, 650], [16000900, 4]])
    assert.equal(getWeaponRivenCost(4, configuration), 1)
})

test("new cost_items overrides the legacy generated schedule without reordering", () => {
    const rules = structuredClone(generatedRules)
    rules.reroll.cost_items = [
        { item_id: 10000320, costs: [3] },
        { item_id: 2370099, costs: [99, 111] },
    ]
    rules.reroll.currency = { item_id: 2370099 }
    rules.reroll.costs = [{ paid_reroll_ordinal: 99, amount: -10 }]
    const normalized = normalize(rules)
    validateWeaponRivenRuleSet(normalized)
    assert.deepEqual(normalized.rules.reroll, { cost_items: rules.reroll.cost_items })
    assert.deepEqual(getWeaponRivenCostOptions(9, normalized), [[10000320, 3], [2370099, 111]])
})

function legacyRules() {
    const rules = structuredClone(generatedRules)
    delete rules.reroll.cost_items
    rules.reroll.currency = { item_id: 2370099 }
    rules.reroll.costs = [
        { paid_reroll_ordinal: 1, amount: 700 },
        { paid_reroll_ordinal: 2, amount: 1400 },
        { paid_reroll_ordinal_from: 3, amount: 3500 },
    ]
    return rules
}

test("absent cost_items retains legacy generated ordinals as one option", () => {
    const rules = legacyRules()
    const normalized = normalize(rules)
    validateWeaponRivenRuleSet(normalized)
    assert.deepEqual(normalized.rules.reroll, { cost_items: [{ item_id: 2370099, costs: [700, 1400, 3500] }] })
    assert.deepEqual(getWeaponRivenCostOptions(8, normalized), [[2370099, 3500]])
    rules.reroll.costs[1].paid_reroll_ordinal = 7
    assert.throws(() => normalize(rules), /ordinals/)
    const uncapped = legacyRules()
    uncapped.reroll.costs[2] = { paid_reroll_ordinal: 3, amount: 3500 }
    assert.throws(() => normalize(uncapped), /ordinals/)
    const absent = legacyRules()
    delete absent.reroll.costs
    assert.throws(() => normalize(absent), /reroll costs are missing/)
})

test("explicit malformed cost_items never falls back to a valid legacy schedule", () => {
    for (const table of [null, undefined, [], {}, "legacy", [null]]) {
        const rules = legacyRules()
        rules.reroll.cost_items = table
        assert.throws(() => validateWeaponRivenRuleSet(normalize(rules)), /reroll cost/)
    }
})

test("cost rule validation rejects duplicate IDs, instance slots and invalid amounts", () => {
    const duplicate = clone()
    duplicate.rules.reroll.cost_items.push(structuredClone(duplicate.rules.reroll.cost_items[0]))
    assert.throws(() => validateWeaponRivenRuleSet(duplicate), /duplicate reroll cost item/)
    for (const itemId of [null, 0, -1, 0.5, NaN, Infinity, "2370099", Number.MAX_SAFE_INTEGER + 1, 16000001, 16000201, 16000999]) {
        const invalid = clone()
        invalid.rules.reroll.cost_items[0].item_id = itemId
        assert.throws(() => validateWeaponRivenRuleSet(invalid), /ordinary inventory item/)
    }
    for (const costs of [null, undefined, [], {}, [0], [-1], [0.5], [NaN], [Infinity], ["1"], [Number.MAX_SAFE_INTEGER + 1]]) {
        const invalid = clone()
        invalid.rules.reroll.cost_items[0].costs = costs
        assert.throws(() => validateWeaponRivenRuleSet(invalid), /invalid reroll costs/)
    }
})
