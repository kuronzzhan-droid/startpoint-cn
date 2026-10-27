// Round 3: themed unknown rivens 16000903-16000918 (16000906 refused: empty pool) and global reveal exclusions.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { load, getDb, items, rivens, unknown, player, multi, finishMulti, savedSouls } =
    require('./helpers/weapon-riven-five-boss-fixture.cjs')
const rules = load('lib/weapon-riven/rules')
const constants = load('lib/weapon-riven/constants')
const { validateWeaponRivenRuleSet } = load('lib/weapon-riven/validate-rules')
const set = rules.weaponRivenRuleSet
const meta = set.disposition.metadata
const pool = itemId => rules.getWeaponRivenThemePool(rules.getWeaponRivenTheme(itemId))
const excluded = id => (id >= 5920000 && id <= 5929999) || (id >= 5990001 && id <= 5990999) || (id >= 5900911 && id <= 5900916)
const own = (p, weaponId) => load('data/domains/equipment').insertPlayerEquipmentSync(p.id, weaponId,
    { level: 1, enhancementLevel: 0, protection: false, stack: 0 })
const ownOnly = (p, ids) => { getDb().prepare('DELETE FROM players_equipment WHERE player_id=?').run(p.id); ids.forEach(id => own(p, id)) }
const cards = p => Object.values(rivens.getPlayerWeaponRivenListSync(p.id))
const reveal = (card, u, owned) => {
    const p = player([card, 0, 0])
    items.setPlayerItemSync(p.id, card, 1)
    if (owned) ownOnly(p, owned)
    const settled = finishMulti(p, multi(p), true, () => u)
    return { p, settled, weapons: (settled.reward.weapon_riven_granted ?? []).map(id => settled.reward.weapon_riven_list[id].weapon_id) }
}

const EXPECTED = {
    16000901: 30, 16000902: 24, 16000903: 22, 16000904: 29, 16000905: 42, 16000907: 80, 16000908: 46,
    16000909: 57, 16000910: 26, 16000911: 24, 16000912: 20, 16000913: 23, 16000914: 28, 16000915: 22,
    16000916: 21, 16000917: 72, 16000918: 16,
}
const THEMED = Object.keys(EXPECTED).map(Number)

test('configured themes: 901-918 without 906, with the expected pool sizes; 906 stays an inert reserved ID', () => {
    assert.deepEqual(set.rules.themes.map(theme => theme.item_id), THEMED)
    assert.deepEqual([...constants.THEMED_UNKNOWN_RIVEN_ITEM_IDS], THEMED)
    for (const id of THEMED) assert.equal(pool(id).length, EXPECTED[id], `pool size ${id}`)
    assert.equal(rules.getWeaponRivenTheme(16000906), undefined)
    assert.equal(constants.isUnknownWeaponRivenItemId(16000906), false)
    assert.equal(constants.isWeaponRivenItemId(16000906), false, 'the reserved block is never an instance')
    for (const id of THEMED) {
        assert.equal(constants.isUnknownWeaponRivenItemId(id), true)
        assert.equal(constants.isWeaponRivenItemId(id), false)
    }
})

test('round-2 pools are unchanged: spirit = the 30 shop weapons, abyss = 8000101-8000124', () => {
    assert.deepEqual(pool(16000901), Object.keys(set.disposition.weapons).map(Number)
        .filter(id => (meta[String(id)]?.categories ?? []).includes('spirit_beast_shop')).sort((a, b) => a - b))
    assert.deepEqual(pool(16000902), Array.from({ length: 24 }, (_, i) => 8000101 + i))
})

test('pool contents: exclusions everywhere, fantasy without PARADOX, lord without spirit/cursed, star tiers by rarity', () => {
    const all = THEMED.flatMap(pool)
    assert.ok(all.every(id => !excluded(id)), 'no PARADOX / GM / test copy in any pool')
    assert.ok(all.every(id => set.disposition.weapons[String(id)] !== undefined), 'pools only hold registered weapons')
    assert.deepEqual(pool(16000903), [...Array.from({ length: 11 }, (_, i) => 100013 + i), ...Array.from({ length: 11 }, (_, i) => 8000201 + i)])
    assert.deepEqual(pool(16000904), Array.from({ length: 29 }, (_, i) => 5910101 + i))
    const lord = pool(16000905)
    assert.ok(lord.every(id => id >= 5930000 && id <= 5939999))
    assert.ok(lord.every(id => !pool(16000901).includes(id) && !pool(16000904).includes(id)))
    assert.ok(lord.includes(5930071) && lord.includes(5930072), '咒剑 boss weapons are not in the 29-weapon cursed list')
    const official = rarity => id => meta[String(id)].origin === 'official' && rarity(meta[String(id)].rarity)
    assert.ok(pool(16000907).every(official(r => r === 4)))
    assert.ok(pool(16000908).every(official(r => r <= 3)))
    const star5 = THEMED.filter(id => id >= 16000909).flatMap(pool)
    assert.equal(new Set(star5).size, star5.length, 'weapon kinds are disjoint')
    assert.ok(star5.every(official(r => r === 5)))
    const allOfficial5 = Object.keys(meta).map(Number).filter(official(r => r === 5))
    assert.deepEqual(allOfficial5.filter(id => !star5.includes(id)), [5095000], 'only the 占位 row is left out')
    assert.ok(pool(16000909).includes(300001) && pool(16000917).includes(200002) && pool(16000913).includes(5045000),
        '破星剑 -> 剑, 超越之证 -> 饰, 恩赐秘典 (ID prefix 504) -> 书')
})

test('every configured themed card reveals only into its own pool (no owned pool weapon -> whole pool)', () => {
    for (const card of THEMED) {
        const expected = pool(card)
        for (const u of [0, .5, .999]) {
            const { p, weapons } = reveal(card, u)
            assert.equal(weapons.length, 1, `card ${card} u=${u}`)
            assert.equal(weapons[0], expected[Math.floor(u * expected.length)], `card ${card} u=${u}`)
            assert.equal(items.getPlayerItemSync(p.id, card), 0)
            assert.deepEqual(savedSouls(p), [null, null, null])
        }
    }
})

test('owned pool weapons come first for the new themes too', () => {
    const { weapons } = reveal(16000917, .999, [300101, 200002, 5010012])
    assert.deepEqual(weapons, [200002], '星辉·饰: the only owned 饰 weapon')
    const { weapons: lord } = reveal(16000905, 0, [5930211, 5930001])
    assert.deepEqual(lord, [5930001], 'an owned spirit-shop boss weapon is not a lord weapon')
})

test('global exclusions: a plain unknown card never reveals PARADOX / GM / test copies', () => {
    const blocked = [5920001, 5990001, 5990006, 5900911, 5900916]
    const none = reveal(unknown, .999, blocked)
    assert.equal(none.weapons.length, 0, 'only excluded weapons owned: nothing to reveal')
    assert.equal(items.getPlayerItemSync(none.p.id, unknown), 1, 'card kept')
    assert.equal(cards(none.p).length, 0)
    for (const u of [0, .5, .999]) assert.deepEqual(reveal(unknown, u, [...blocked, 5010012]).weapons, [5010012])
})

test('global exclusions: an owned PARADOX never satisfies the fantasy theme', () => {
    const { weapons } = reveal(16000903, 0, [5920001])
    assert.deepEqual(weapons, [100013], 'falls back to the whole fantasy pool')
})

test('16000906 (refused theme) is inert: kept in the slot and never converted', () => {
    const p = player([16000906, 0, 0])
    items.setPlayerItemSync(p.id, 16000906, 2)
    const settled = finishMulti(p, multi(p), true, () => 0)
    assert.equal(settled.reward.weapon_riven_granted?.length ?? 0, 0)
    assert.equal(items.getPlayerItemSync(p.id, 16000906), 2)
})

test('validation refuses an empty pool, unknown or cyclic exclude_themes, and malformed exclusions', () => {
    const withRules = patch => { const copy = structuredClone(set); patch(copy.rules); return copy }
    assert.doesNotThrow(() => validateWeaponRivenRuleSet(structuredClone(set)))
    assert.throws(() => validateWeaponRivenRuleSet(withRules(r => r.themes.push({ id: 'curio', item_id: 16000906,
        pool: { id_ranges: [[5910000, 5919999]], exclude_themes: ['cursed'] }, fallback: 'pool' }))), /curio has an empty weapon pool/)
    assert.throws(() => validateWeaponRivenRuleSet(withRules(r => r.themes.push({ id: 'paradox', item_id: 16000906,
        pool: { weapon_ids: [5920001] } }))), /paradox has an empty weapon pool/, 'exclusions apply before the emptiness check')
    assert.throws(() => validateWeaponRivenRuleSet(withRules(r => { r.themes.find(t => t.id === 'lord').pool.exclude_themes = ['nope'] })),
        /excludes unknown theme nope/)
    assert.throws(() => validateWeaponRivenRuleSet(withRules(r => {
        r.themes.find(t => t.id === 'cursed').pool.exclude_themes = ['lord']
    })), /exclusion cycle/)
    assert.throws(() => validateWeaponRivenRuleSet(withRules(r => { r.reveal_exclusions = { id_ranges: [[3, 1]] } })), /invalid reveal exclusions/)
    assert.throws(() => validateWeaponRivenRuleSet(withRules(r => { r.themes[2].id = 'abyss' })), /invalid theme/, 'duplicate theme id')
})

test('public payloads hide the new themed cards like the plain unknown card', () => {
    const { stripWeaponRivenPublicPayload } = load('lib/weapon-riven/public-payload')
    assert.deepEqual(stripWeaponRivenPublicPayload({ abilitySoulIds: [16000917, [0, 16000903], 5010001], item_list: { 16000918: 1, 1: 3 } }),
        { abilitySoulIds: [null, [1], 5010001], item_list: { 1: 3 } })
})
