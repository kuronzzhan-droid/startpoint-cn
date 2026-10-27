const test = require('node:test')
const assert = require('node:assert/strict')
require('ts-node/register/transpile-only')
const { weaponRivenRuleSet, rollWeaponRivenQualitiesWithRules, rerollWeaponRivenQualities,
    getWeaponRivenDisposition, getWeaponRivenCostOptions, rollWeaponRivenAffixesWithRules } = require('../src/lib/weapon-riven/rules')
const { displayWeaponRivenAffixes } = require('../src/lib/weapon-riven/display')
const { migrateWeaponRivenAffixes, legacyWeaponRivenMagnitude } = require('../src/lib/weapon-riven/migrate-quality')
const { validateWeaponRivenQualities } = require('../src/lib/weapon-riven/quality')
const { validateWeaponRivenRuleSet } = require('../src/lib/weapon-riven/validate-rules')
const { dispositionCoefficient, affixMagnitude } = require('./helpers/weapon-riven-v3-numeric-fixture.cjs')
require('./helpers/weapon-riven-legacy-value-model.cjs').pinLegacyValueModel(require('../src/lib/weapon-riven/rules').weaponRivenRuleSet)
const clone = () => structuredClone(weaponRivenRuleSet)
const weapon = 100001
function random(seed = 17) {
    return () => { seed = (Math.imul(seed,1664525) + 1013904223) >>> 0; return seed / 2 ** 32 }
}
function positive(configuration, count) {
    const families = new Set()
    return configuration.affixes.affixes.filter(row => {
        if (!row.enabled || row.polarity !== '+' || families.has(row.family)) return false
        families.add(row.family); return true
    }).slice(0,count)
}

test('v3 q sampling follows all five structures, six digits and family exclusion across both polarities', () => {
    assert.equal(weaponRivenRuleSet.rules.schema_version,3)
    const definitions = new Map(weaponRivenRuleSet.affixes.affixes.map(row => [row.key,row]))
    const structures = new Map(), rng = random()
    for (let index = 0; index < 10000; index++) {
        const affixes = rollWeaponRivenQualitiesWithRules(weapon,weaponRivenRuleSet,rng)
        validateWeaponRivenQualities(affixes)
        const rows = affixes.map(([key]) => definitions.get(key))
        assert.equal(new Set(rows.map(row => row.family)).size,rows.length)
        const signature = `${rows.filter(row => row.polarity === '+').length}+${rows.filter(row => row.polarity === '-').length}`
        structures.set(signature,(structures.get(signature) ?? 0) + 1)
        for (const [,q] of affixes) assert.ok(q >= weaponRivenRuleSet.rules.quality.min && q <= weaponRivenRuleSet.rules.quality.max)
    }
    for (const structure of weaponRivenRuleSet.rules.structures) {
        const actual = (structures.get(`${structure.positive}+${structure.negative}`) ?? 0) / 10000
        assert.ok(Math.abs(actual - structure.probability) < .025)
    }
    assert.equal(structures.size,5)
})

test('durable q is reprojected for decimal disposition and full card structure on each response', () => {
    const configuration = clone(), rows = positive(configuration,3)
    const affixes = rows.map(row => [row.key,1])
    for (const d of [5,3,1,.1]) {
        configuration.disposition.weapons[weapon] = d
        assert.equal(getWeaponRivenDisposition(weapon,configuration),d)
        const projected = displayWeaponRivenAffixes(weapon,affixes,3,configuration)
        for (let index = 0; index < rows.length; index++) {
            const row = rows[index], expected = Math.max(1,Math.min(100,Math.round(1 + 99
                * (row.max_full * dispositionCoefficient(d,configuration) * configuration.rules.count_coefficients[3] - row.lo) / (row.hi - row.lo))))
            assert.deepEqual(projected[index],[row.key,expected,expected])
        }
    }
    assert.deepEqual(affixes,rows.map(row => [row.key,1]))
})

test('values mode keeps ordered keys even for old disabled definitions, varies quality and respects current caps', () => {
    const configuration = clone(), rows = positive(configuration,2)
    rows[0].enabled = false
    const original = rows.map(row => [row.key,.9])
    for (const d of [.1,.6,1,3,5]) {
        configuration.disposition.weapons[weapon] = d
        for (const quantile of [0,.25,.99,1-Number.EPSILON]) {
            const changed = rerollWeaponRivenQualities(original,() => quantile,configuration)
            assert.deepEqual(changed.map(row => row[0]),original.map(row => row[0]))
            for (const [,level,cap] of displayWeaponRivenAffixes(weapon,changed,3,configuration)) assert.ok(level <= cap)
        }
    }
    assert.equal(rerollWeaponRivenQualities(original,() => 0,configuration)[0][1],configuration.rules.quality.min)
    assert.equal(rerollWeaponRivenQualities(original,() => 1-Number.EPSILON,configuration)[0][1],configuration.rules.quality.max)
})

test('all 31 shipped legacy keys migrate across 100 levels, preserving uncapped values within one new L step', () => {
    const configuration = clone()
    configuration.disposition.weapons[weapon] = 5
    const legacy = configuration.affixes.affixes.filter(row => row.legacy_encoding)
    assert.equal(legacy.length,31)
    let preserved = 0, capped = 0
    for (const row of legacy) {
        for (let level = 1; level <= 100; level++) {
            const value = legacyWeaponRivenMagnitude(row.key,level,configuration)
            const migrated = migrateWeaponRivenAffixes(weapon,[[row.key,level]],configuration)
            validateWeaponRivenQualities(migrated)
            assert.equal(migrated[0].length,2)
            const [,projected,cap] = displayWeaponRivenAffixes(weapon,migrated,3,configuration)[0]
            assert.ok(projected <= cap)
            if (value > affixMagnitude(row.max_full,row)) {
                assert.equal(migrated[0][1],1,`${row.id}: ${level}`)
                assert.equal(projected,cap)
                capped++
                continue
            }
            const reconstructed = row.lo + (row.hi-row.lo) * (projected-1) / 99
            assert.ok(Math.abs(reconstructed-value) <= (row.hi-row.lo) / 99 + .001,`${row.id}: ${level}`)
            preserved++
        }
    }
    assert.equal(preserved+capped,3100)
    assert.ok(preserved > 2000)
    assert.ok(capped > 100)
})

test('older v3 parameters still migrate signed values, cap overflow and respect the complete card structure', () => {
    const configuration = clone(), records = []
    delete configuration.rules.disposition_curve
    configuration.rules.count_coefficients = {1:1,2:.75,3:.6}
    configuration.rules.negative_bonus = 1.25
    configuration.disposition.weapons[weapon] = 5
    const original = [[15990006,100],[15990009,1],[15990015,100]]
    const migrated = migrateWeaponRivenAffixes(weapon,original,configuration,record => records.push(record))
    assert.deepEqual(migrated,[[15990006,1],[15990009,.000474],[15990015,.4]])
    assert.deepEqual(original,[[15990006,100],[15990009,1],[15990015,100]])
    assert.deepEqual(records,[
        {affix_key:15990006,old_level:100,old_value:500,new_value:337.5,q:1,capped:true},
        {affix_key:15990009,old_level:1,old_value:.2,new_value:421.875*.000474,q:.000474,capped:false},
        {affix_key:15990015,old_level:100,old_value:-32,new_value:-32,q:.4,capped:false},
    ])
    // Negative affixes have their own budget, without the positive count or negative bonus.
    configuration.disposition.weapons[weapon] = .1
    const lowRecords = []
    assert.deepEqual(migrateWeaponRivenAffixes(weapon,[[15990006,100],[15990015,100]],configuration,
        record => lowRecords.push(record)),[[15990006,1],[15990015,1]])
    assert.equal(lowRecords[0].new_value,9)
    assert.equal(lowRecords[1].old_value,-32)
    assert.equal(lowRecords[1].new_value,-1.6)
    assert.ok(lowRecords.every(record => record.capped))
})

test('clamping historical overflow does not permit unknown keys or invalid legacy levels', () => {
    const configuration = clone()
    assert.throws(() => migrateWeaponRivenAffixes(weapon,[[15999999,100]],configuration),/Missing historical/)
    for (const level of [0,101,1.5,NaN,Infinity]) {
        assert.throws(() => migrateWeaponRivenAffixes(weapon,[[15990006,level]],configuration),/Invalid historical/)
    }
})

test('q=1 remains perfect and never becomes legacy L=1; old pair-only clients receive integer L pairs', () => {
    const configuration = clone(), row = positive(configuration,1)[0]
    configuration.disposition.weapons[weapon] = 5
    assert.equal(displayWeaponRivenAffixes(weapon,[[row.key,1]],3,configuration)[0][1],100)
    assert.equal(displayWeaponRivenAffixes(weapon,[[row.key,1]],1,configuration)[0][1],1)
    const previous = process.env.WEAPON_RIVEN_LEGACY_AFFIX_PAIRS
    process.env.WEAPON_RIVEN_LEGACY_AFFIX_PAIRS = '1'
    try { assert.deepEqual(displayWeaponRivenAffixes(weapon,[[row.key,1]],3,configuration),[[row.key,100]]) }
    finally {
        if (previous === undefined) delete process.env.WEAPON_RIVEN_LEGACY_AFFIX_PAIRS
        else process.env.WEAPON_RIVEN_LEGACY_AFFIX_PAIRS = previous
    }
})

test('v3 prices contain all 14 abyss tiers and the shared fixed crystal tier', () => {
    const costs = [50,200,350,500,650,800,950,1100,1250,1400,1550,1700,1850,2000]
    for (let count=0; count<30; count++) assert.deepEqual(getWeaponRivenCostOptions(count),[[2370099,costs[Math.min(count,13)]],[10000320,1]])
    const invalid = clone(); invalid.disposition.default = .099
    assert.throws(() => validateWeaponRivenRuleSet(invalid),/disposition/)
    for (const q of [-.1,1.1,NaN,.1234567]) assert.throws(() => validateWeaponRivenQualities([[15990001,q]]))
})

test('the level-returning sampler remains compatible with a v3 configuration', () => {
    const configuration = clone()
    const quality = rollWeaponRivenQualitiesWithRules(weapon, configuration, random(78))
    const levels = rollWeaponRivenAffixesWithRules(weapon, configuration, random(78))
    const projected = displayWeaponRivenAffixes(weapon, quality, 3, configuration)
    assert.deepEqual(levels, projected.map(([key, level]) => [key, level]))
})
