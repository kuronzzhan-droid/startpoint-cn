const test = require("node:test")
const assert = require("node:assert/strict")
require("ts-node/register/transpile-only")

const {
    weaponRivenRuleSet, rollWeaponRivenAffixes, rollWeaponRivenAffixesWithRules,
    getWeaponRivenCost, getWeaponRivenDismantleReward, weaponRivenValueToLevel,
} = require("../src/lib/weapon-riven/rules")
const { validateWeaponRivenRuleSet } = require("../src/lib/weapon-riven/validate-rules")
const { normalizeWeaponRivenRuleSet } = require("../src/lib/weapon-riven/load-rules")

const legacy = require("./helpers/weapon-riven-v1-rules.json")
const clone = () => structuredClone(legacy)
function sequence(values) {
    let offset = 0
    return () => {
        assert.ok(offset < values.length, "random sequence was exhausted")
        return values[offset++]
    }
}
function seededRandom(seed) {
    return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32 }
}

test("reroll fees follow the paid count and remain capped", () => {
    assert.deepEqual([0, 1, 2, 3, 4, 11, 12, 13, 1000].map(count => getWeaponRivenCost(count)),
        [50, 200, 350, 500, 650, 1700, 1850, 2000, 2000])
    assert.deepEqual(getWeaponRivenDismantleReward(1, 0), { itemId: 16000900, amount: 3 })
    for (const value of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
        assert.throws(() => getWeaponRivenCost(value), /roll count/)
    }
})

test("generator JSON preserves its ordered fee schedules and configurable fragment return", () => {
    const rules = require("../assets/weapon_riven_rules.json")
    const affixes = require("../assets/weapon_riven_affixes.json")
    const disposition = require("../assets/weapon_riven_disposition.json")
    const normalized = normalizeWeaponRivenRuleSet(rules, affixes, disposition)
    assert.equal(rules.status, "v3_local_generated_not_deployed")
    assert.equal(rules.contract, "weapon-riven-v2.0")
    assert.ok(affixes.affixes.length > 31)
    assert.ok(Object.keys(disposition.weapons).length >= 579)
    validateWeaponRivenRuleSet(normalized)
    assert.deepEqual(normalized.rules.reroll, { cost_items: [
        { item_id: 2370099, costs: [50, 200, 350, 500, 650, 800, 950, 1100, 1250, 1400, 1550, 1700, 1850, 2000] },
        { item_id: 10000320, costs: [1] },
    ] })
    assert.deepEqual(normalized.rules.dismantle_return, { item_id: 16000900, base: 3, per_affix: 0, per_roll: 0 })
    assert.equal(normalized.disposition.default, 1)
    const oldRules = structuredClone(rules)
    delete oldRules.dismantle_return
    oldRules.dismantle = { refund_item_id: null, refund_amount: 0 }
    const legacy = normalizeWeaponRivenRuleSet(oldRules, affixes, disposition)
    validateWeaponRivenRuleSet(legacy)
    assert.equal(getWeaponRivenDismantleReward(4, 10, legacy), null)
    const optionalBonuses = structuredClone(rules)
    delete optionalBonuses.dismantle_return.per_affix
    delete optionalBonuses.dismantle_return.per_roll
    optionalBonuses.dismantle = { refund_item_id: null, refund_amount: 0 }
    assert.deepEqual(normalizeWeaponRivenRuleSet(optionalBonuses, affixes, disposition).rules.dismantle_return,
        normalized.rules.dismantle_return)
})

test("fragment return combines base, confirmed affix count and paid rerolls with safe integer validation", () => {
    const configuration = clone()
    configuration.rules.dismantle_return = { item_id: 16000900, base: 3, per_affix: 2, per_roll: 5 }
    validateWeaponRivenRuleSet(configuration)
    assert.deepEqual(getWeaponRivenDismantleReward(4, 7, configuration), { itemId: 16000900, amount: 46 })
    for (const [affixes, rolls] of [[0, 0], [5, 0], [1.5, 0], [1, -1], [1, 0.5], [1, NaN]]) {
        assert.throws(() => getWeaponRivenDismantleReward(affixes, rolls, configuration), /dismantle counts/)
    }
    for (const field of ['base', 'per_affix', 'per_roll']) {
        for (const value of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
            const invalid = clone()
            invalid.rules.dismantle_return[field] = value
            assert.throws(() => validateWeaponRivenRuleSet(invalid), /dismantle return amounts/)
        }
    }
    for (const item of [null, 0, 1.5, 16000001, 16000201, 16000999]) {
        const invalid = clone()
        invalid.rules.dismantle_return.item_id = item
        assert.throws(() => validateWeaponRivenRuleSet(invalid), /ordinary inventory item/)
    }
    configuration.rules.dismantle_return.per_roll = Number.MAX_SAFE_INTEGER
    assert.throws(() => getWeaponRivenDismantleReward(1, 2, configuration), /dismantle amount/)
})

test("global key endpoints preserve disposition scaling instead of scaling both endpoints", () => {
    const configuration = clone()
    configuration.affixes.affixes = configuration.affixes.affixes.filter(affix => affix.id === "self_attack_up")
    configuration.disposition.weapons = { "100": 1, "500": 5 }
    configuration.rules.affix_count_probabilities = [{ count: 1, probability: 1 }]
    configuration.rules.combinations = [configuration.rules.combinations[0]]
    // Same key and top quantile: disposition 1 reaches only ~20% of the global L range.
    assert.deepEqual(rollWeaponRivenAffixesWithRules(100, configuration, sequence([0, 0, 0, 1 - Number.EPSILON])), [[15990006, 21]])
    assert.deepEqual(rollWeaponRivenAffixesWithRules(500, configuration, sequence([0, 0, 0, 1 - Number.EPSILON])), [[15990006, 100]])
    assert.deepEqual(rollWeaponRivenAffixesWithRules(100, configuration, sequence([0, 0, 0, 0])), [[15990006, 1]])
    // k=0.25 gives u^k = 0.5 for u=1/16; scaled value is 250.5, which encodes to L=51.
    assert.deepEqual(rollWeaponRivenAffixesWithRules(500, configuration, sequence([0, 0, 0, 1 / 16])), [[15990006, 51]])
})

test("negative affixes use negative coefficients and respect the selected positive's exclusive group", () => {
    const configuration = clone()
    configuration.affixes.affixes = configuration.affixes.affixes.filter(affix => ["self_attack_up", "self_attack_down", "self_direct_damage_down"].includes(affix.id))
    configuration.rules.affix_count_probabilities = [{ count: 2, probability: 1 }]
    configuration.rules.combinations = [configuration.rules.combinations.find(row => row.id === "strong_positive_and_strong_negative")]
    const result = rollWeaponRivenAffixesWithRules(99999999, configuration, sequence([0, 0, 0, 0, 0, 1 - Number.EPSILON]))
    // Attack-down is excluded by attack-up. V2 direct-down reaches 0.6*80=48; global 30..80 encodes L=37.
    assert.deepEqual(result, [[15990006, 1], [15990008, 37]])
})

test("all legal combinations preserve order and never duplicate an affix or exclusive group", () => {
    const definitions = new Map(legacy.affixes.affixes.map(affix => [affix.key, affix]))
    const combinations = new Set()
    const random = seededRandom(42)
    for (let sample = 0; sample < 1200; sample++) {
        const rolled = rollWeaponRivenAffixesWithRules(100013, legacy, random)
        assert.ok(rolled.length >= 1 && rolled.length <= 4)
        assert.equal(new Set(rolled.map(([key]) => key)).size, rolled.length)
        const selected = rolled.map(([key]) => definitions.get(key))
        const groups = selected.map(affix => affix.exclusive_group).filter(Boolean)
        assert.equal(new Set(groups).size, groups.length)
        const signature = selected.map(affix => affix.polarity + ":" + affix.tier).join(",")
        assert.ok(legacy.rules.combinations.some(row => row.slots.map(slot => slot.polarity + ":" + slot.tier).join(",") === signature))
        combinations.add(signature)
        for (const [, level] of rolled) assert.ok(Number.isInteger(level) && level >= 1 && level <= 100)
    }
    assert.equal(combinations.size, 6)
})

test("level quantization clamps endpoints and returns the nearest global step", () => {
    assert.equal(weaponRivenValueToLevel(-10, 0.2, 500), 1)
    assert.equal(weaponRivenValueToLevel(600, 0.2, 500), 100)
    assert.equal(weaponRivenValueToLevel(3, 3, 3), 1)
    for (const affix of weaponRivenRuleSet.affixes.affixes) {
        const step = (affix.hi - affix.lo) / 99
        for (let point = 0; point <= 100; point++) {
            const value = affix.lo + (affix.hi - affix.lo) * point / 100
            const level = weaponRivenValueToLevel(value, affix.lo, affix.hi)
            const reconstructed = affix.lo + step * (level - 1)
            assert.ok(Math.abs(value - reconstructed) <= step / 2 + 1e-9)
        }
    }
    assert.throws(() => weaponRivenValueToLevel(NaN, 0, 1))
    assert.throws(() => weaponRivenValueToLevel(1, 2, 1))
})

test("all generated affix levels read back within one client quantization step for every disposition", () => {
    const affixes = legacy.affixes.affixes
    for (const affix of affixes) {
        for (const coefficient of Object.values(legacy.disposition.levels)) {
            const multiplier = affix.polarity === "+" ? coefficient.positive_coefficient : coefficient.negative_coefficient
            for (let index = 0; index <= 100; index++) {
                const value = multiplier * (affix.min + (affix.max_full - affix.min) * (index / 100) ** coefficient.k)
                const level = weaponRivenValueToLevel(value, affix.lo, affix.hi)
                const raw = Math.round(affix.raw_lo + (affix.raw_hi - affix.raw_lo) * (level - 1) / 99)
                const actual = affix.resolve_int ? Math.round(raw / affix.raw_per_unit) : raw / affix.raw_per_unit
                assert.ok(Math.abs(Math.abs(actual) - value) <= affix.quantization_step + 1e-9, `${affix.id}: L=${level}`)
            }
        }
    }
})

test("invalid random values, unavailable combinations, duplicate keys and inadequate endpoints are rejected", () => {
    for (const value of [-0.01, 1, Infinity, NaN]) assert.throws(() => rollWeaponRivenAffixes(100013, () => value), /random source/)
    const deadEnd = clone()
    deadEnd.affixes.affixes = deadEnd.affixes.affixes.filter(affix => affix.polarity === "+")
    assert.throws(() => validateWeaponRivenRuleSet(deadEnd), /exhaust/)
    const duplicate = clone()
    duplicate.affixes.affixes[1].key = duplicate.affixes.affixes[0].key
    assert.throws(() => validateWeaponRivenRuleSet(duplicate), /duplicate affix key/)
    const badEndpoints = clone()
    badEndpoints.affixes.affixes[0].lo += 1
    assert.throws(() => validateWeaponRivenRuleSet(badEndpoints), /global endpoints/)
    const badCostItem = clone()
    badCostItem.rules.reroll.cost_items[0].item_id = 16000001
    assert.throws(() => validateWeaponRivenRuleSet(badCostItem), /ordinary inventory item/)
})
