const test = require('node:test')
const assert = require('node:assert/strict')
require('ts-node/register/transpile-only')
const { weaponRivenRuleSet, getWeaponRivenAffixCapLevel, rerollWeaponRivenQualities,
    rollWeaponRivenQualitiesWithRules, rollWeaponRivenAffixesWithRules } = require('../src/lib/weapon-riven/rules')
const { weaponRivenAffixBudget } = require('../src/lib/weapon-riven/quality')
const { displayWeaponRivenAffixes } = require('../src/lib/weapon-riven/display')
const { migrateWeaponRivenAffixes, legacyWeaponRivenMagnitude } = require('../src/lib/weapon-riven/migrate-quality')
const { validateWeaponRivenRuleSet } = require('../src/lib/weapon-riven/validate-rules')
const { affixMagnitude } = require('./helpers/weapon-riven-v3-numeric-fixture.cjs')
require('./helpers/weapon-riven-legacy-value-model.cjs').pinLegacyValueModel(require('../src/lib/weapon-riven/rules').weaponRivenRuleSet)

const weapon = 100001
const coefficients = [[5,1],[4,.8915407599947129],[3,.7745261428108221],
    [1,.49309848950391444],[.1,.2985045254933018]]
const encode = (value,row) => Math.max(1,Math.min(100,Math.round(1 + 99 * (value-row.lo)/(row.hi-row.lo))))
function tunedConfiguration() {
    const configuration = structuredClone(weaponRivenRuleSet)
    Object.assign(configuration.rules,{
        disposition_curve:{floor:.25,exponent:.7}, count_coefficients:{1:1,2:.85,3:.75},
        negative_bonus:1.2, quality:{min:.9,max:1,precision:6},
    })
    return configuration
}
function compatibleCard(configuration,first,positiveCount,negativeCount) {
    const selected = [first]
    for (const polarity of [...Array(positiveCount - (first.polarity === '+' ? 1 : 0)).fill('+'),
        ...Array(negativeCount - (first.polarity === '-' ? 1 : 0)).fill('-')]) {
        const next = configuration.affixes.affixes.find(row => row.enabled && !row.legacy_only && row.polarity === polarity
            && selected.every(other => other.family !== row.family && (!row.exclusive_group || other.exclusive_group !== row.exclusive_group)))
        assert.ok(next)
        selected.push(next)
    }
    return selected.map(row => [row.key,1])
}

test('configured curve applies to all five structures, both polarities, decimal dispositions and projected caps', () => {
    const configuration = tunedConfiguration()
    validateWeaponRivenRuleSet(configuration)
    for (const [d,coefficient] of coefficients) {
        configuration.disposition.weapons[weapon] = d
        for (const structure of configuration.rules.structures) {
            for (const row of configuration.affixes.affixes.filter(row => row.enabled && !row.legacy_only
                && (row.polarity === '+' || structure.negative))) {
                const card = compatibleCard(configuration,row,structure.positive,structure.negative)
                const multiplier = row.polarity === '-' ? 1
                    : {1:1,2:.85,3:.75}[structure.positive] * (structure.negative ? 1.2 : 1)
                const equivalent = row.max_full * coefficient * multiplier
                const expected = affixMagnitude(equivalent,row)
                assert.ok(Math.abs(weaponRivenAffixBudget(row,card,d,configuration)-expected) < 1e-10,`${row.id}/${d}/${structure.id}`)
                const cap = getWeaponRivenAffixCapLevel(weapon,row.key,configuration,card)
                assert.equal(cap,encode(expected,row))
                for (const q of [.9,.95,1]) {
                    const projected = displayWeaponRivenAffixes(weapon,card.map(([key]) => [key,q]),3,configuration)[0]
                    assert.deepEqual(projected,[row.key,encode(affixMagnitude(equivalent*q,row),row),cap])
                    assert.ok(projected[1] <= cap)
                }
            }
        }
    }
})

test('the 1.02 positive multiplier retains the existing discrete L=100 endpoint ceiling', () => {
    const configuration = tunedConfiguration()
    configuration.disposition.weapons[weapon] = 5
    const guarded = configuration.affixes.affixes.filter(row => row.enabled && row.polarity === '+'
        && (row.independent_damage || row.family === 'initial_skill_gauge'))
    assert.ok(guarded.length > 2)
    for (const row of guarded) {
        const card = compatibleCard(configuration,row,2,1)
        const budget = weaponRivenAffixBudget(row,card,5,configuration)
        assert.ok(budget > row.max_full)
        const [,level,cap] = displayWeaponRivenAffixes(weapon,card,3,configuration)[0]
        assert.equal(level,100)
        assert.equal(cap,100)
        const raw = Math.round(row.raw_lo + (row.raw_hi-row.raw_lo)*(level-1)/99)
        const readback = raw / row.raw_per_unit
        assert.ok(readback <= (row.independent_damage ? 20 : 100),`${row.id}: ${readback}`)
    }
})

test('curve migrations preserve uncapped legacy values and durable q reprojects after tuning', () => {
    const configuration = tunedConfiguration(), key = 15990006
    const row = configuration.affixes.affixes.find(row => row.key === key)
    for (const [d,coefficient] of coefficients) {
        configuration.disposition.weapons[weapon] = d
        for (const level of [1,10,100]) {
            const original = [[key,level]], records = []
            const value = legacyWeaponRivenMagnitude(key,level,configuration)
            const budget = row.max_full * coefficient
            const q = Number(Math.min(1,value/budget).toFixed(6))
            assert.deepEqual(migrateWeaponRivenAffixes(weapon,original,configuration,record => records.push(record)),[[key,q]])
            assert.equal(records[0].capped,value > budget)
            assert.equal(records[0].new_value,budget*q)
            assert.deepEqual(original,[[key,level]])
        }
    }
    const stored = [[key,.95]]
    const tuned = displayWeaponRivenAffixes(weapon,stored,3,configuration)
    delete configuration.rules.disposition_curve
    const old = displayWeaponRivenAffixes(weapon,stored,3,configuration)
    assert.ok(tuned[0][1] > old[0][1])
    assert.deepEqual(stored,[[key,.95]])
    for (const [d] of coefficients) assert.equal(weaponRivenAffixBudget(row,stored,d,configuration),row.max_full*(d/5))
})

test('configured quality boundaries and full sampler use the same curve projection', () => {
    const configuration = tunedConfiguration(), stored = [[15990006,.85]]
    assert.deepEqual(rerollWeaponRivenQualities(stored,() => 0,configuration),[[15990006,.9]])
    assert.deepEqual(rerollWeaponRivenQualities(stored,() => .5,configuration),[[15990006,.95]])
    assert.deepEqual(rerollWeaponRivenQualities(stored,() => 1-Number.EPSILON,configuration),[[15990006,1]])
    for (const [d] of coefficients) {
        configuration.disposition.weapons[weapon] = d
        const qualities = rollWeaponRivenQualitiesWithRules(weapon,configuration,() => .5)
        const levels = rollWeaponRivenAffixesWithRules(weapon,configuration,() => .5)
        assert.deepEqual(levels,displayWeaponRivenAffixes(weapon,qualities,3,configuration).map(([key,level]) => [key,level]))
    }
})

test('curve validation rejects malformed parameters while omitted and zero-floor curves remain valid', () => {
    const configuration = tunedConfiguration()
    for (const curve of [null,{},[],{floor:.25},{exponent:.7},
        ...[-.1,1,NaN,Infinity,'0.25'].map(floor => ({floor,exponent:.7})),
        ...[0,-1,NaN,Infinity,'0.7'].map(exponent => ({floor:.25,exponent}))]) {
        configuration.rules.disposition_curve = curve
        assert.throws(() => validateWeaponRivenRuleSet(configuration),/invalid disposition curve/)
    }
    configuration.rules.disposition_curve = {floor:0,exponent:1}
    validateWeaponRivenRuleSet(configuration)
    const row = configuration.affixes.affixes[0], card = [[row.key,1]]
    assert.equal(weaponRivenAffixBudget(row,card,1,configuration),affixMagnitude(row.max_full*.2,row))
    configuration.rules.disposition_curve = {floor:.5,exponent:2}
    validateWeaponRivenRuleSet(configuration)
    assert.equal(weaponRivenAffixBudget(row,card,1,configuration),affixMagnitude(row.max_full*.52,row))
    delete configuration.rules.disposition_curve
    validateWeaponRivenRuleSet(configuration)
})
