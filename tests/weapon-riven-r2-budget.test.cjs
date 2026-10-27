// Round 2 (author 2026-10-27 15:1x): disposition tier table, per-card positive budget, rare independent multipliers, theme pools.
const test = require('node:test')
const assert = require('node:assert/strict')
require('ts-node/register/transpile-only')
const { weaponRivenRuleSet, getWeaponRivenAffixCapLevel, rollWeaponRivenQualitiesWithRules, weaponRivenDrawWeight,
    getWeaponRivenTheme, getWeaponRivenThemePool, weaponRivenValueToLevel } = require('../src/lib/weapon-riven/rules')
const { weaponRivenAffixBudget, weaponRivenDispositionCoefficient, isWeaponRivenBudgetAffix } = require('../src/lib/weapon-riven/quality')
const { displayWeaponRivenAffixes } = require('../src/lib/weapon-riven/display')
const { validateWeaponRivenRuleSet } = require('../src/lib/weapon-riven/validate-rules')
const { isUnknownWeaponRivenItemId, isWeaponRivenItemId, UNKNOWN_RIVEN_ITEM_IDS } = require('../src/lib/weapon-riven/constants')

const config = weaponRivenRuleSet
const byId = id => config.affixes.affixes.find(row => row.id === id)
const value = (row, card, d, q = 1) => weaponRivenAffixBudget(row, card.map(r => [r.key, q]), d, config, q)
const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-9, `${message}: ${actual} vs ${expected}`)
const seeded = seed => () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }

test('shipped configuration carries the round-2 tier table, budget model and both themes', () => {
    assert.deepEqual(config.rules.disposition_tiers, { 0: .08, 1: .18, 2: .3, 3: .45, 4: .8, 5: 1 })
    assert.equal(config.rules.value_model.kind, 'positive_budget')
    assert.equal(config.rules.value_model.positive_budget_percent, 500)
    near(config.rules.value_model.independent_weight_factor, 1 / 3, 'rare factor')
    // Round 3 (2026-10-27) added 903-905 and 907-918; 906 was refused (empty pool). 901/902 stay first and unchanged.
    assert.deepEqual(config.rules.themes.map(theme => theme.item_id), [16000901, 16000902, 16000903, 16000904, 16000905, 16000907, 16000908, 16000909, 16000910, 16000911, 16000912, 16000913, 16000914, 16000915, 16000916, 16000917, 16000918])
    assert.deepEqual([...UNKNOWN_RIVEN_ITEM_IDS], [16000000, ...[16000901, 16000902, 16000903, 16000904, 16000905, 16000907, 16000908, 16000909, 16000910, 16000911, 16000912, 16000913, 16000914, 16000915, 16000916, 16000917, 16000918]])
})

test('tier coefficient interpolates linearly between integer tiers', () => {
    for (const [d, expected] of [[5, 1], [4.5, .9], [4, .8], [3.5, .625], [3, .45], [2.5, .375], [2, .3], [1, .18], [.5, .13], [.1, .09], [0, .08]]) {
        near(weaponRivenDispositionCoefficient(d, config), expected, `d=${d}`)
    }
})

test('one positive takes its whole max_full x coefficient; three positives share the 500% budget', () => {
    const attack = byId('self_attack_up'), skill = byId('self_skill_damage_up'), direct = byId('self_direct_damage_up')
    // Raised caps (round 2): a single big positive takes the whole 500% budget.
    for (const id of ['self_attack_up', 'self_skill_damage_up', 'self_direct_damage_up', 'self_ability_damage_up', 'leader_power_flip_up']) {
        near(value(byId(id), [byId(id)], 5), 500, `single ${id} at d=5`)
        near(value(byId(id), [byId(id)], 4), 400, `single ${id} at d=4`)
        assert.ok(byId(id).hi >= 500, `${id} endpoint covers 500`)
    }
    for (const [party, self] of [['party_attack_up', 'self_attack_up'], ['party_skill_damage_up', 'self_skill_damage_up'],
        ['party_direct_damage_up', 'self_direct_damage_up'], ['party_ability_damage_up', 'self_ability_damage_up'], ['party_power_flip_up', 'leader_power_flip_up']]) {
        assert.ok(byId(party).max_full < byId(self).max_full && byId(party).hi >= byId(party).max_full, party)
    }
    const three = [attack, skill, direct]
    for (const [d, budget] of [[5, 500], [4, 400], [3, 225], [2, 150], [1, 90], [0.1, 45]]) {
        near(three.reduce((sum, row) => sum + value(row, three, d), 0), budget, `three-positive sum d=${d}`)
    }
    const mixed = [attack, byId('party_attack_up'), byId('leader_power_flip_up')]
    const total = mixed.reduce((sum, row) => sum + row.max_full, 0)
    near(value(attack, mixed, 5), attack.max_full * 500 / total, 'proportional share')
})

test('a negative does not raise the positive budget and negatives keep their own formula', () => {
    const attack = byId('self_attack_up'), skill = byId('self_skill_damage_up'), down = byId('self_attack_down')
    const withNegative = [attack, skill, down]
    near(value(attack, withNegative, 5) + value(skill, withNegative, 5), 500, 'two positives with a negative')
    const raw = down.max_full * 1 * .9
    near(weaponRivenAffixBudget(down, withNegative.map(r => [r.key, .9]), 5, config, .9), 100 * raw / (100 + raw), 'reciprocal negative')
    const hp = byId('self_max_hp_down')
    near(weaponRivenAffixBudget(hp, [[attack.key, 1], [hp.key, 1]], 3, config), 80 * .45, 'linear negative')
})

test('independent multipliers and non-percentage positives sit outside the budget', () => {
    const attack = byId('self_attack_up'), slayer = byId('self_race_slayer'), cut = byId('self_flat_damage_cut')
    assert.equal(isWeaponRivenBudgetAffix(slayer, config), false)
    assert.equal(isWeaponRivenBudgetAffix(cut, config), false)
    assert.equal(isWeaponRivenBudgetAffix(attack, config), true)
    const card = [attack, slayer, cut]
    near(value(attack, card, 5), 500, 'attack keeps its full share')
    near(value(slayer, card, 4, .95), 20 * .8 * .95, 'independent = cap x coef x q')
    near(value(cut, card, 3), 800 * .45, 'flat cut = max_full x coef')
    for (const row of config.affixes.affixes.filter(r => r.independent_damage && r.polarity === '+')) {
        assert.ok(value(row, [row], 5) <= config.rules.value_model.independent_positive_max_percent + 1e-9, row.id)
        near(weaponRivenDrawWeight(row, config), row.weight / 3, `rare weight ${row.id}`)
    }
    near(weaponRivenDrawWeight(attack, config), attack.weight, 'ordinary weight unchanged')
})

test('20000 random cards never exceed the budget and always encode inside 1..100', () => {
    const random = seeded(20261027)
    const independent = new Set(config.affixes.affixes.filter(r => r.independent_damage).map(r => r.key))
    const weapons = [5, 4, 3, 1, .1].map(d => Number(Object.entries(config.disposition.weapons).find(([, level]) => level === d)?.[0] ?? 100001))
    let independentDraws = 0, positives = 0
    for (let index = 0; index < 20000; index++) {
        const weapon = weapons[index % weapons.length]
        const level = config.disposition.weapons[String(weapon)] ?? config.disposition.default
        const card = rollWeaponRivenQualitiesWithRules(weapon, config, random)
        let sum = 0
        for (const [key, q] of card) {
            const row = config.affixes.affixes.find(r => r.key === key)
            const v = weaponRivenAffixBudget(row, card, level, config, q)
            if (row.polarity === '+') positives++
            if (row.polarity === '+' && independent.has(key)) independentDraws++
            if (isWeaponRivenBudgetAffix(row, config)) sum += v
            assert.ok(v >= row.lo - 1e-9 && v <= row.hi + 1e-9, `${row.id} ${v} outside [${row.lo},${row.hi}]`)
            const cap = getWeaponRivenAffixCapLevel(weapon, key, config, card)
            assert.ok(cap >= 1 && cap <= 100)
            assert.ok(weaponRivenValueToLevel(v, row.lo, row.hi) <= cap)
        }
        assert.ok(sum <= 500 * weaponRivenDispositionCoefficient(level, config) + 1e-6, `card sum ${sum} at d=${level}`)
    }
    assert.ok(independentDraws / positives < .1, `independent share ${independentDraws / positives}`)
})

test('existing cards reproject from stored q under the new model', () => {
    const attack = byId('self_attack_up'), skill = byId('self_skill_damage_up')
    const stored = [[attack.key, .95], [skill.key, .9]]
    const [[, attackLevel], [, skillLevel]] = displayWeaponRivenAffixes(100001, stored, 3, config)
    const d = config.disposition.weapons['100001']
    const coef = weaponRivenDispositionCoefficient(d, config), ratio = Math.min(1, 500 / (attack.max_full + skill.max_full))
    assert.equal(attackLevel, weaponRivenValueToLevel(attack.max_full * coef * ratio * .95, attack.lo, attack.hi))
    assert.equal(skillLevel, weaponRivenValueToLevel(skill.max_full * coef * ratio * .9, skill.lo, skill.hi))
})

test('theme pools resolve from the disposition table and themed IDs are stackable, not instances', () => {
    const spirit = getWeaponRivenTheme(16000901), abyss = getWeaponRivenTheme(16000902)
    assert.equal(getWeaponRivenThemePool(spirit).length, 30)
    assert.deepEqual(getWeaponRivenThemePool(abyss), Array.from({ length: 24 }, (_, i) => 8000101 + i))
    assert.ok(getWeaponRivenThemePool(spirit).includes(4040034) && getWeaponRivenThemePool(spirit).includes(5930262))
    for (const id of [16000000, 16000901, 16000902]) {
        assert.equal(isUnknownWeaponRivenItemId(id), true)
        assert.equal(isWeaponRivenItemId(id), false)
    }
    for (const id of [16000906, 16000919]) {  // still reserved but unconfigured after round 3
        assert.equal(isUnknownWeaponRivenItemId(id), false, 'reserved but unconfigured')
        assert.equal(isWeaponRivenItemId(id), false, 'reserved block is never an instance')
    }
    assert.equal(isWeaponRivenItemId(16000920), true)
    assert.equal(getWeaponRivenTheme(16000000), undefined)
})

test('validation rejects malformed tiers, value model and themes', () => {
    for (const mutate of [
        c => { c.rules.disposition_tiers['3'] = 2 },
        c => { delete c.rules.disposition_tiers['0'] },
        c => { c.rules.disposition_tiers['2'] = .9 },
        c => { c.rules.value_model.positive_budget_percent = 0 },
        c => { c.rules.value_model.independent_weight_factor = 2 },
        c => { c.rules.value_model.kind = 'other' },
        c => { c.rules.themes[0].item_id = 16000000 },
        c => { c.rules.themes[1].item_id = 16000901 },
        c => { c.rules.themes[0].pool = { weapon_ids: [123] } },
    ]) {
        const copy = structuredClone(config)
        mutate(copy)
        assert.throws(() => validateWeaponRivenRuleSet(copy), /Invalid weapon riven configuration/)
    }
    validateWeaponRivenRuleSet(structuredClone(config))
})
