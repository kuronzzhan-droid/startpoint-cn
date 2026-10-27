const test = require("node:test")
const assert = require("node:assert/strict")
require("ts-node/register/transpile-only")

const {
    weaponRivenRuleSet, getWeaponRivenDisposition, getWeaponRivenAffixCapLevel,
    getWeaponRivenAffixCandidates, rerollWeaponRivenQualities,
} = require("../src/lib/weapon-riven/rules")
const { displayWeaponRivenAffixes } = require("../src/lib/weapon-riven/display")
const { dispositionCoefficient, affixMagnitude } = require('./helpers/weapon-riven-v3-numeric-fixture.cjs')
require('./helpers/weapon-riven-legacy-value-model.cjs').pinLegacyValueModel(require('../src/lib/weapon-riven/rules').weaponRivenRuleSet)

const clone = () => structuredClone(weaponRivenRuleSet)
const unknownWeaponId = Number.MAX_SAFE_INTEGER
const encode = (value, lo, hi) => lo === hi ? 1
    : Math.max(1, Math.min(100, Math.round(1 + 99 * (value - lo) / (hi - lo))))

test("v1.2 disposition resolves known weapons and configured defaults", () => {
    for (const [weaponId, disposition] of Object.entries(weaponRivenRuleSet.disposition.weapons)) {
        assert.equal(getWeaponRivenDisposition(Number(weaponId)), disposition)
    }
    assert.equal(getWeaponRivenDisposition(unknownWeaponId), weaponRivenRuleSet.disposition.default)
    const configuration = clone()
    configuration.disposition.default = 3
    assert.equal(getWeaponRivenDisposition(unknownWeaponId, configuration), 3)
    const affix = configuration.affixes.affixes[0]
    assert.equal(getWeaponRivenAffixCapLevel(unknownWeaponId, affix.key, configuration),
        encode(affixMagnitude(dispositionCoefficient(3, configuration) * affix.max_full, affix), affix.lo, affix.hi))
})

test("v1.2 cap triples retain global endpoints with v3 fractional dispositions", () => {
    const configuration = clone()
    assert.ok(configuration.affixes.affixes.some(affix => affix.polarity === "+"))
    assert.ok(configuration.affixes.affixes.some(affix => affix.polarity === "-"))
    for (const disposition of [.1, 1, 2, 3, 4, 5]) {
        configuration.disposition.weapons[String(unknownWeaponId)] = disposition
        for (const affix of configuration.affixes.affixes) {
            const cap = getWeaponRivenAffixCapLevel(unknownWeaponId, affix.key, configuration)
            assert.equal(cap, encode(affixMagnitude(dispositionCoefficient(disposition, configuration) * affix.max_full, affix), affix.lo, affix.hi), `${affix.id}: ${disposition}`)
            assert.ok(Number.isInteger(cap) && cap >= 1 && cap <= 100)
            if (affix.disposition_ranges?.[String(disposition)]) {
                assert.equal(cap, affix.disposition_ranges[String(disposition)].level_max,
                    `generator cap for ${affix.id}: ${disposition}`)
            }
        }
    }
})

test("v1.2 cap bounds v3 values rerolls without replacing keys and includes structure budget", () => {
    for (const affix of weaponRivenRuleSet.affixes.affixes.filter(row => row.enabled && row.weight > 0)) {
        const configuration = clone()
        const selected = [affix]
        if (affix.polarity === "-") {
            const positives = configuration.affixes.affixes.filter(row => row.enabled && row.weight > 0
                && row.polarity === "+" && (!affix.exclusive_group || row.exclusive_group !== affix.exclusive_group))
            const first = positives[0]
            const second = positives.find(row => row.family !== first.family)
            assert.ok(second, `no compatible positives for ${affix.id}`)
            selected.unshift(first, second)
        }
        const initial = selected.map(row => [row.key, 1])
        for (const disposition of [.1, 1, 3, 5]) {
            configuration.disposition.weapons[String(unknownWeaponId)] = disposition
            const cap = getWeaponRivenAffixCapLevel(unknownWeaponId, affix.key, configuration, initial)
            for (const quantile of [0, 0.01, 0.25, 0.9, 1 - Number.EPSILON]) {
                const qualities = rerollWeaponRivenQualities(initial, () => quantile, configuration)
                assert.deepEqual(qualities.map(([key]) => key), initial.map(([key]) => key))
                const result = displayWeaponRivenAffixes(unknownWeaponId, qualities, 3, configuration)
                const [, level] = result.find(([key]) => key === affix.key)
                const { min, max, precision } = configuration.rules.quality
                const quality = Number((min + (max - min) * quantile).toFixed(precision))
                const value = affixMagnitude(dispositionCoefficient(disposition, configuration) * affix.max_full * quality, affix)
                assert.equal(level, encode(value, affix.lo, affix.hi), `${affix.id}: ${disposition}/${quantile}`)
                assert.ok(level <= cap, `${affix.id} exceeds its cap`)
                if (quantile === 1 - Number.EPSILON) assert.equal(level, cap)
            }
        }
    }
})

test("v1.2 fixed magnitude and fixed global endpoints have defined cap levels", () => {
    const configuration = clone()
    const affix = { ...configuration.affixes.affixes.find(row => row.polarity === "+"), min: 10, max_full: 10, lo: 2, hi: 10 }
    configuration.affixes.affixes = [affix]
    for (let disposition = 1; disposition <= 5; disposition++) {
        configuration.disposition.weapons[String(unknownWeaponId)] = disposition
        assert.equal(getWeaponRivenAffixCapLevel(unknownWeaponId, affix.key, configuration), encode(dispositionCoefficient(disposition, configuration) * 10, 2, 10))
    }
    affix.min = affix.max_full = affix.lo = affix.hi = 0
    for (let disposition = 1; disposition <= 5; disposition++) {
        configuration.disposition.weapons[String(unknownWeaponId)] = disposition
        assert.equal(getWeaponRivenAffixCapLevel(unknownWeaponId, affix.key, configuration), 1)
    }
})

test("v1.2 disabled historical definitions retain caps while missing keys have no cap", () => {
    const configuration = clone()
    const affix = configuration.affixes.affixes[0]
    const cap = getWeaponRivenAffixCapLevel(unknownWeaponId, affix.key, configuration)
    affix.enabled = false
    affix.weight = 0
    assert.equal(getWeaponRivenAffixCapLevel(unknownWeaponId, affix.key, configuration), cap)
    assert.ok(!getWeaponRivenAffixCandidates(affix, [], configuration.affixes.affixes).some(row => row.key === affix.key))
    configuration.affixes.affixes = configuration.affixes.affixes.filter(row => row.key !== affix.key)
    assert.equal(getWeaponRivenAffixCapLevel(unknownWeaponId, affix.key, configuration), undefined)
    assert.equal(getWeaponRivenAffixCapLevel(unknownWeaponId, -1), undefined)
})

test("v1.2 disposition and cap reject invalid weapons or out-of-range decimal dispositions", () => {
    const key = weaponRivenRuleSet.affixes.affixes[0].key
    for (const weaponId of [0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
        assert.throws(() => getWeaponRivenDisposition(weaponId), /weapon ID/)
        assert.throws(() => getWeaponRivenAffixCapLevel(weaponId, key), /weapon ID/)
    }
    const configuration = clone()
    configuration.disposition.default = .01
    assert.throws(() => getWeaponRivenDisposition(unknownWeaponId, configuration), /not configured/)
    assert.throws(() => getWeaponRivenAffixCapLevel(unknownWeaponId, key, configuration), /not configured/)
})
