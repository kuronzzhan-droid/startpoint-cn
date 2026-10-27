// Round 2 (author 2026-10-27 15:34): weapon_riven/dismantle_batch, all-or-nothing.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { fixture, post, storedState, beginBattle, load, db } = require('./helpers/weapon-riven-api-fixture.cjs')
const rivens = () => load('data/domains/weaponRiven')
const FRAGMENT = 16000900

function addCard(p, key) {
    return db.transaction(() => rivens().insertWeaponRivenSync(p.id, 300101, [[15990001, 50]], key, () => 0))()
}
const card = (p, item) => rivens().getPlayerWeaponRivenSync(p.id, item)
const ref = (p, item) => ({ item_id: item, revision: card(p, item).revision })
function equip(p, souls) {
    db.prepare(`INSERT OR IGNORE INTO players_party_groups(player_id,id,category,color_id) VALUES (?,1,1,15)`).run(p.id)
    db.prepare(`INSERT OR REPLACE INTO players_parties(player_id,group_id,slot,category,name,ability_soul_1,ability_soul_2,ability_soul_3,edited)
        VALUES (?,1,1,1,'Batch',?,?,?,1)`).run(p.id, ...souls)
}
const batch = (p, items, extra = {}) => post(p, 'dismantle_batch', { items, ...extra })

test('batch removes every card, sums fragments, unequips them and replays without a second grant', async () => {
    const p = await fixture(), b = addCard(p, 'batch-b'), c = addCard(p, 'batch-c')
    equip(p, [p.item, 16000000, null])
    load('data/domains/item').setPlayerItemSync(p.id, FRAGMENT, 5)
    const items = [ref(p, p.item), ref(p, b), { ...ref(p, c), riven_id: card(p, c).riven_id }]
    const response = await batch(p, items, { api_count: 7 })
    assert.equal(response.status, 200, JSON.stringify(response.body))
    const data = response.body.data
    assert.equal(data.weapon_riven_conflict, undefined)
    assert.deepEqual(data.dismantle_return_total, [[FRAGMENT, 9]])
    assert.equal(data.item_list[FRAGMENT], 14)
    assert.deepEqual([...data.weapon_riven_deleted].sort(), [p.item, b, c].sort())
    for (const id of [p.item, b, c]) { assert.equal(data.item_list[id], 0); assert.equal(card(p, id), null) }
    assert.deepEqual(data.weapon_riven_list, {})
    assert.equal(data.party_info_list.length, 1)
    assert.deepEqual(data.party_info_list[0].ability_soul_ids, [null, 16000000, null])
    const replay = await batch(p, items, { api_count: 7 })
    assert.equal(replay.status, 200)
    assert.deepEqual(replay.body.data.dismantle_return_total, [[FRAGMENT, 9]])
    assert.equal(load('data/domains/item').getPlayerItemSync(p.id, FRAGMENT), 14, 'replay grants nothing')
})

test('any failing item rejects the whole batch with HTTP 200 conflict and changes nothing', async () => {
    for (const [reason, prepare] of [
        ['locked', (p, b) => db.prepare('UPDATE player_weapon_rivens SET locked=1 WHERE player_id=? AND item_id=?').run(p.id, b)],
        ['pending', (p, b) => db.prepare(`UPDATE player_weapon_rivens SET pending_json=? WHERE player_id=? AND item_id=?`)
            .run(JSON.stringify({ draw_id: 'x', affixes: [[15990002, .95]], affix_version: 3 }), p.id, b)],
        ['riven_changed', (p, b) => db.prepare('UPDATE player_weapon_rivens SET revision=revision+5 WHERE player_id=? AND item_id=?').run(p.id, b)],
        ['battle_in_progress', p => beginBattle(p)],
    ]) {
        const p = await fixture(), b = addCard(p, `batch-${reason}`)
        const items = [ref(p, p.item), ref(p, b)]
        prepare(p, b)
        const before = storedState(p)
        const response = await batch(p, items)
        assert.equal(response.status, 200, reason)
        assert.equal(response.body.data.weapon_riven_conflict, true, reason)
        assert.equal(response.body.data.reason, reason)
        assert.deepEqual(response.body.data.dismantle_return_total, [])
        if (reason !== 'battle_in_progress') assert.deepEqual(response.body.data.weapon_riven_conflict_items, [b])
        assert.ok(response.body.data.weapon_riven_list[p.item], 'current state of every requested card is returned')
        assert.deepEqual(storedState(p), before, `${reason}: nothing changed`)
    }
})

test('missing card, wrong riven_id, malformed bodies and legacy clients', async () => {
    const p = await fixture()
    const missing = await batch(p, [ref(p, p.item), { item_id: 16000150, revision: 1 }])
    assert.equal(missing.body.data.reason, 'riven_changed')
    assert.deepEqual(missing.body.data.weapon_riven_conflict_items, [16000150])
    assert.deepEqual(missing.body.data.weapon_riven_deleted, [16000150])
    const wrong = await batch(p, [{ ...ref(p, p.item), riven_id: p.rivenId + 99 }])
    assert.equal(wrong.body.data.reason, 'riven_changed')
    assert.ok(card(p, p.item))
    for (const items of [[], Array.from({ length: 21 }, (_, i) => ({ item_id: 16000001 + i, revision: 1 })),
        [ref(p, p.item), ref(p, p.item)], [{ item_id: 16000000, revision: 1 }], [{ item_id: 16000901, revision: 1 }],
        [{ item_id: p.item }], 'x']) {
        assert.equal((await batch(p, items)).status, 400, JSON.stringify(items).slice(0, 60))
    }
    assert.equal((await post(p, 'dismantle_batch', { items: [ref(p, p.item)] }, false)).status, 403)
    assert.ok(card(p, p.item))
})

test('twenty cards in one batch', async () => {
    const p = await fixture()
    const ids = [p.item]
    for (let i = 1; i < 20; i++) ids.push(addCard(p, `batch-20-${i}`))
    const response = await batch(p, ids.map(id => ref(p, id)))
    assert.equal(response.status, 200)
    assert.deepEqual(response.body.data.dismantle_return_total, [[FRAGMENT, 60]])
    assert.equal(Object.keys(rivens().getPlayerWeaponRivenListSync(p.id)).length, 0)
})
