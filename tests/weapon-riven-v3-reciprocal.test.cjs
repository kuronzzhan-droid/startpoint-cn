const test = require('node:test')
const assert = require('node:assert/strict')
require('ts-node/register/transpile-only')
const { weaponRivenRuleSet, getWeaponRivenAffixCapLevel, rerollWeaponRivenQualities,
    rollWeaponRivenQualitiesWithRules, rollWeaponRivenAffixesWithRules } = require('../src/lib/weapon-riven/rules')
const { weaponRivenAffixBudget } = require('../src/lib/weapon-riven/quality')
const { displayWeaponRivenAffixes } = require('../src/lib/weapon-riven/display')
const { migrateWeaponRivenAffixes, legacyWeaponRivenMagnitude } = require('../src/lib/weapon-riven/migrate-quality')
const { validateWeaponRivenRuleSet } = require('../src/lib/weapon-riven/validate-rules')
const { dispositionCoefficient } = require('./helpers/weapon-riven-v3-numeric-fixture.cjs')
require('./helpers/weapon-riven-legacy-value-model.cjs').pinLegacyValueModel(require('../src/lib/weapon-riven/rules').weaponRivenRuleSet)

const weapon = 100001
const ids = ['self_attack_down','party_attack_down','self_direct_damage_down','party_direct_damage_down',
    'self_skill_damage_down','party_skill_damage_down','self_ability_damage_down','party_ability_damage_down','party_power_flip_down']
const convert = value => 100 * value / (100 + value)
const encode = (value,row) => Math.max(1,Math.min(100,Math.round(1 + 99 * (value-row.lo)/(row.hi-row.lo))))
const clone = () => structuredClone(weaponRivenRuleSet)
function cardFor(configuration,negative,count) {
    const selected = [negative]
    for (let index=0; index<count; index++) {
        const row = configuration.affixes.affixes.find(row => row.enabled && !row.legacy_only && row.polarity === '+'
            && selected.every(other => other.family !== row.family
                && (!row.exclusive_group || other.exclusive_group !== row.exclusive_group)))
        assert.ok(row)
        selected.push(row)
    }
    return selected.map(row => [row.key,1])
}
function readback(row,level) {
    const value = Math.round(row.raw_lo + (row.raw_hi-row.raw_lo)*(level-1)/99) / row.raw_per_unit
    return row.resolve_int ? Math.round(value) : value
}

test('generated reciprocal configuration is limited to the nine damage penalties and keeps shipped legacy encodings', () => {
    const configuration = clone()
    const rows = configuration.affixes.affixes.filter(row => row.curve === 'reciprocal')
    assert.deepEqual(rows.map(row => row.id).sort(),[...ids].sort())
    validateWeaponRivenRuleSet(configuration)
    for (const row of rows) {
        assert.equal(row.polarity,'-')
        assert.equal(row.lo,0)
        assert.ok(Math.abs(row.hi-convert(row.max_full)) < 1e-10)
        assert.ok(readback(row,100) > -100)
        if (row.legacy_encoding) {
            assert.equal(row.legacy_encoding.raw_lo,-30000)
            assert.equal(row.legacy_encoding.raw_hi,-80000)
        }
    }
})

test('quality is applied before reciprocal conversion and stored q is reprojected without mutation', () => {
    const configuration = clone()
    configuration.disposition.weapons[weapon] = 5
    const row = configuration.affixes.affixes.find(row => row.id === 'self_attack_down')
    const stored = cardFor(configuration,row,3).map(([key]) => [key,.5])
    const before = structuredClone(stored)
    const value = weaponRivenAffixBudget(row,stored,5,configuration,.5)
    assert.equal(value,convert(180))
    assert.notEqual(value,convert(360)*.5)
    assert.deepEqual(displayWeaponRivenAffixes(weapon,stored,3,configuration)[0],
        [row.key,encode(convert(180),row),100])
    row.enabled = false
    assert.equal(displayWeaponRivenAffixes(weapon,stored,3,configuration)[0][1],encode(convert(180),row))
    assert.deepEqual(stored,before)
})

test('all nine penalties stay above -100% across both negative structures, dispositions, stored quality and values rerolls', () => {
    const configuration = clone()
    for (const row of configuration.affixes.affixes.filter(row => row.curve === 'reciprocal')) {
        for (const count of [2,3]) {
            const card = cardFor(configuration,row,count)
            for (const disposition of [5,4,3,1,.1]) {
                configuration.disposition.weapons[weapon] = disposition
                const equivalent = row.max_full * dispositionCoefficient(disposition,configuration)
                const cap = getWeaponRivenAffixCapLevel(weapon,row.key,configuration,card)
                assert.equal(cap,encode(convert(equivalent),row))
                for (const q of [0,.01,.5,.9,.95,1]) {
                    const [,level,projectedCap] = displayWeaponRivenAffixes(weapon,card.map(([key]) => [key,q]),3,configuration)[0]
                    assert.equal(level,encode(convert(equivalent*q),row))
                    assert.equal(projectedCap,cap)
                    assert.ok(level <= cap)
                    assert.ok(readback(row,level) > -100,`${row.id}/${count}/${disposition}/${q}`)
                }
                for (const random of [0,.5,1-Number.EPSILON]) {
                    const rerolled = rerollWeaponRivenQualities(card,() => random,configuration)
                    assert.deepEqual(rerolled.map(([key]) => key),card.map(([key]) => key))
                    const [,level] = displayWeaponRivenAffixes(weapon,rerolled,3,configuration)[0]
                    assert.ok(level <= cap)
                    assert.ok(readback(row,level) >= readback(row,cap))
                }
            }
        }
    }
})

test('reciprocal migration inverts actual shipped values, caps unrepresentable penalties and reports mapped magnitudes', () => {
    const configuration = clone()
    for (const row of configuration.affixes.affixes.filter(row => row.curve === 'reciprocal' && row.legacy_encoding)) {
        for (const disposition of [5,4,3,1,.1]) {
            configuration.disposition.weapons[weapon] = disposition
            for (const level of [1,50,100]) {
                const before = [[row.key,level]], records = []
                const value = legacyWeaponRivenMagnitude(row.key,level,configuration)
                const equivalent = row.max_full * dispositionCoefficient(disposition,configuration)
                const cap = convert(equivalent), capped = value > cap
                const expectedQ = capped ? 1 : Number((100*value/(100-value)/equivalent).toFixed(6))
                const migrated = migrateWeaponRivenAffixes(weapon,before,configuration,record => records.push(record))
                assert.deepEqual(migrated,[[row.key,expectedQ]])
                assert.deepEqual(before,[[row.key,level]])
                assert.equal(records[0].capped,capped)
                assert.equal(records[0].old_value,-value)
                assert.ok(Math.abs(records[0].new_value + convert(equivalent*expectedQ)) < 1e-10)
                if (!capped) assert.ok(Math.abs(records[0].new_value + value) < .001)
            }
        }
        row.legacy_encoding.raw_hi = -360000
        assert.deepEqual(migrateWeaponRivenAffixes(weapon,[[row.key,100]],configuration),[[row.key,1]])
    }
})

test('omitting the affix curve preserves linear budgets, projection and legacy migration', () => {
    const configuration = clone()
    configuration.disposition.weapons[weapon] = 5
    for (const row of configuration.affixes.affixes.filter(row => row.curve === 'reciprocal')) {
        delete row.curve
        row.hi = row.max_full
        const card = cardFor(configuration,row,2)
        assert.equal(weaponRivenAffixBudget(row,card,5,configuration,.5),row.max_full*.5)
        assert.equal(displayWeaponRivenAffixes(weapon,card.map(([key]) => [key,.5]),3,configuration)[0][1],51)
        if (row.legacy_encoding) {
            const value = legacyWeaponRivenMagnitude(row.key,1,configuration)
            assert.deepEqual(migrateWeaponRivenAffixes(weapon,[[row.key,1]],configuration),
                [[row.key,Number((value/row.max_full).toFixed(6))]])
        }
    }
    validateWeaponRivenRuleSet(configuration)
})

test('level sampler and response projection agree when a reciprocal penalty is selected', () => {
    const configuration = clone()
    const negative = configuration.affixes.affixes.find(row => row.id === 'self_attack_down')
    const selected = new Set(cardFor(configuration,negative,2).map(([key]) => key))
    for (const row of configuration.affixes.affixes) row.enabled = selected.has(row.key)
    configuration.rules.structures = [{id:'test',positive:2,negative:1,probability:1}]
    for (const disposition of [5,4,3,1,.1]) {
        configuration.disposition.weapons[weapon] = disposition
        const qualities = rollWeaponRivenQualitiesWithRules(weapon,configuration,() => .5)
        assert.ok(qualities.some(([key]) => key === negative.key))
        assert.deepEqual(rollWeaponRivenAffixesWithRules(weapon,configuration,() => .5),
            displayWeaponRivenAffixes(weapon,qualities,3,configuration).map(([key,level]) => [key,level]))
    }
})

test('invalid reciprocal modes, polarity and endpoints fail configuration loading', () => {
    for (const invalid of [null,'linear','unknown',{},1]) {
        const configuration = clone()
        configuration.affixes.affixes[0].curve = invalid
        assert.throws(() => validateWeaponRivenRuleSet(configuration),/invalid affix curve/)
    }
    for (const change of [{polarity:'+'},{hi:100},{hi:20},{lo:1},{min:0,max_full:0}]) {
        const configuration = clone()
        Object.assign(configuration.affixes.affixes.find(row => row.curve === 'reciprocal'),change)
        assert.throws(() => validateWeaponRivenRuleSet(configuration),/endpoints|polarity/)
    }
})

test('reciprocal configuration rejects non-damage metadata and unsafe or inconsistent client raw endpoints', () => {
    for (const change of [{unit:'count'},{raw_sign:1},{kind:{id:13}},{kind:undefined},
        {raw_hi:-100000},{raw_hi:-1},{raw_hi:1000},{raw_lo:-1000},{raw_per_unit:0},{raw_per_unit:NaN}]) {
        const configuration = clone()
        Object.assign(configuration.affixes.affixes.find(row => row.curve === 'reciprocal'),change)
        assert.throws(() => validateWeaponRivenRuleSet(configuration),/reciprocal damage encoding|reciprocal raw endpoints/)
    }
})
