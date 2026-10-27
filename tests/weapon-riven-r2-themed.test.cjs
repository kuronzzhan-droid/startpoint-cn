// Round 2: themed unknown rivens (16000901 spirit beast, 16000902 abyss) and the over-limit battle rule.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { load, getDb, items, rivens, unknown, player, multi, finishMulti, appFor, startBody, finishBody,
    savedParty, savedSouls } = require('./helpers/weapon-riven-five-boss-fixture.cjs')
const spirit = 16000901, abyss = 16000902
const rules = load('lib/weapon-riven/rules')
const spiritPool = rules.getWeaponRivenThemePool(rules.getWeaponRivenTheme(spirit))
const own = (p, weaponId) => load('data/domains/equipment').insertPlayerEquipmentSync(p.id, weaponId,
    { level: 1, enhancementLevel: 0, protection: false, stack: 0 })
const stock = (p, amounts) => { for (const [id, n] of Object.entries(amounts)) items.setPlayerItemSync(p.id, Number(id), n) }
const cards = p => Object.values(rivens.getPlayerWeaponRivenListSync(p.id))

test('themed cards reveal from their own pool: owned pool weapons first, otherwise the whole pool', () => {
    const p = player([spirit, abyss, unknown])
    stock(p, { [spirit]: 3, [abyss]: 2 })
    own(p, 4050030)
    const room = multi(p), first = finishMulti(p, room, true, () => .999)
    const granted = first.reward.weapon_riven_granted.map(id => first.reward.weapon_riven_list[id].weapon_id)
    assert.equal(granted.length, 3)
    assert.equal(granted[0], 4050030, 'spirit: the only owned pool weapon')
    assert.equal(granted[1], 8000124, 'abyss: none owned, last of the 24-weapon pool for u=.999')
    assert.ok([300101, 4050030].includes(granted[2]), 'plain unknown: any owned weapon')
    assert.equal(first.reward.itemTotals[spirit], 2)
    assert.equal(first.reward.itemTotals[abyss], 1)
    assert.equal(first.reward.itemTotals[unknown], 4)
    assert.deepEqual(savedSouls(p), [null, null, null])
    const replay = finishMulti(p, room, true, () => assert.fail('Replay must not draw'))
    assert.equal(replay.receiptStatus, 'already_settled')
    assert.deepEqual(replay.reward, first.reward)
    assert.equal(items.getPlayerItemSync(p.id, spirit), 2)
})

test('spirit card with no owned pool weapon draws from the whole 30-weapon pool', () => {
    const p = player([spirit, 0, 0])
    stock(p, { [spirit]: 1 })
    finishMulti(p, multi(p), true, () => 0)
    assert.deepEqual(cards(p).map(card => card.weapon_id), [spiritPool[0]])
    assert.equal(items.getPlayerItemSync(p.id, spirit), 0)
})

test('themed cards without balance are not converted, and excess themed references are trimmed per card', () => {
    const p = player([spirit, abyss, 0])
    stock(p, { [spirit]: 1, [abyss]: 0 })
    savedParty(p, 1, 1, 2, [spirit, spirit, abyss])
    const settled = finishMulti(p, multi(p), true, () => 0)
    assert.equal(settled.reward.weapon_riven_granted.length, 1, 'abyss slot had no balance')
    assert.deepEqual(savedSouls(p), [null, abyss, null], 'converted slot cleared, unconverted abyss slot kept')
    assert.deepEqual(savedSouls(p, 1, 1, 2), [null, null, abyss], 'spirit balance 0: both references trimmed; abyss untouched')
})

test('failed battle keeps themed cards and slots', () => {
    const p = player([spirit, abyss, 0])
    stock(p, { [spirit]: 1, [abyss]: 1 })
    finishMulti(p, multi(p), false)
    assert.equal(items.getPlayerItemSync(p.id, spirit), 1)
    assert.equal(items.getPlayerItemSync(p.id, abyss), 1)
    assert.equal(cards(p).length, 0)
    assert.deepEqual(savedSouls(p), [spirit, abyss, null])
})

test('solo HTTP five-boss converts a themed card and retries refresh its balance', async () => {
    const p = player([abyss, 0, 0]), app = await appFor(p)
    stock(p, { [abyss]: 4 })
    try {
        assert.equal((await app.inject({ method: 'POST', url: '/start', payload: startBody(p) })).statusCode, 200)
        const first = await app.inject({ method: 'POST', url: '/finish', payload: finishBody(p) })
        assert.equal(first.statusCode, 200, first.body)
        const data = first.json().data
        assert.equal(data.item_list[abyss], 3)
        assert.equal(data.weapon_riven_granted.length, 1)
        const weaponId = data.weapon_riven_list[data.weapon_riven_granted[0]].weapon_id
        assert.ok(weaponId >= 8000101 && weaponId <= 8000124)
        items.setPlayerItemSync(p.id, abyss, 10)
        const retry = await app.inject({ method: 'POST', url: '/finish', payload: { ...finishBody(p), api_count: 9 } })
        assert.equal(retry.json().data.item_list[abyss], 10)
        assert.equal(cards(p).length, 1)
    } finally { await app.close() }
})

test('over-limit party: every revealed riven is ineffective at battle start; themed and plain unknown cards stay', () => {
    const p = player([unknown, spirit, 0])
    stock(p, { [spirit]: 1 })
    const insert = key => getDb().transaction(() => rivens.insertWeaponRivenSync(p.id, 300101, [[15990001, 50]], key, () => 0))()
    const a = insert('r2:a'), b = insert('r2:b')
    getDb().prepare('UPDATE players_parties SET ability_soul_1=?,ability_soul_2=?,ability_soul_3=? WHERE player_id=?').run(a, b, spirit, p.id)
    const battle = load('lib/weapon-riven/battle')
    assert.deepEqual(battle.getSoloWeaponRivenStartLoadoutSync(p.id, 1).abilitySoulIds, [0, 0, spirit])
    assert.deepEqual(savedSouls(p), [null, null, spirit])
    assert.equal(cards(p).length, 2, 'cards are not deleted')
    getDb().prepare('UPDATE players_parties SET ability_soul_1=?,ability_soul_2=?,ability_soul_3=? WHERE player_id=?').run(a, spirit, unknown, p.id)
    assert.deepEqual(battle.getSoloWeaponRivenStartLoadoutSync(p.id, 1).abilitySoulIds, [a, spirit, unknown],
        'one revealed riven plus unknown cards is within the limit')
    assert.deepEqual(load('lib/weapon-riven/party-limit').limitWeaponRivenPartySouls([a, b, spirit]), [a, null, spirit],
        'party edits still keep the first card')
})

test('public payloads hide themed cards like the plain unknown card', () => {
    const { stripWeaponRivenPublicPayload } = load('lib/weapon-riven/public-payload')
    assert.deepEqual(stripWeaponRivenPublicPayload({ abilitySoulIds: [[0, spirit], abyss, 5010001], item_list: { [spirit]: 2, 1: 3 } }),
        { abilitySoulIds: [[1], null, 5010001], item_list: { 1: 3 } })
})
