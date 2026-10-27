// Round 2 review (Argon finding 4): dismantle_batch receipts must not report an old success for a card
// that is present again, and the request key is order-independent and bound to riven_id.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { fixture, post, load, db } = require('./helpers/weapon-riven-api-fixture.cjs')
const rivens = () => load('data/domains/weaponRiven')
const FRAGMENT = 16000900

const addCard = (p, key) => db.transaction(() => rivens().insertWeaponRivenSync(p.id, 300101, [[15990001, 50]], key, () => 0))()
const card = (p, item) => rivens().getPlayerWeaponRivenSync(p.id, item)
const ref = (p, item) => ({ item_id: item, revision: card(p, item).revision })
const fragments = p => load('data/domains/item').getPlayerItemSync(p.id, FRAGMENT) ?? 0
const batch = (p, items, extra = {}) => post(p, 'dismantle_batch', { items, ...extra })

test('a receipt hit whose card is present again (slot reuse / restored save) is a conflict, not an old success', async () => {
    const p = await fixture(), items = [ref(p, p.item)]
    const first = await batch(p, items, { api_count: 3 })
    assert.equal(first.status, 200)
    assert.equal(first.body.data.weapon_riven_conflict, undefined)
    const granted = fragments(p)
    assert.ok(granted > 0)
    // Genuine retry: the card is gone, the stored result is returned and nothing is granted twice.
    const retry = await batch(p, items, { api_count: 3 })
    assert.deepEqual(retry.body.data.dismantle_return_total, first.body.data.dismantle_return_total)
    assert.equal(fragments(p), granted)
    // The lowest free slot is reused with revision 1: the same request key would match the old receipt.
    const reused = addCard(p, 'review-reused')
    assert.equal(reused, p.item)
    assert.equal(card(p, reused).revision, items[0].revision)
    const stale = await batch(p, items, { api_count: 3 })
    assert.equal(stale.status, 200)
    assert.equal(stale.body.data.weapon_riven_conflict, true)
    assert.equal(stale.body.data.reason, 'riven_changed')
    assert.deepEqual(stale.body.data.weapon_riven_conflict_items, [reused])
    assert.deepEqual(stale.body.data.dismantle_return_total, [])
    assert.ok(stale.body.data.weapon_riven_list[reused], 'the present card is reported as still owned')
    assert.ok(card(p, reused), 'nothing was deleted')
    assert.equal(fragments(p), granted, 'nothing was granted')
    // A fresh request (new api_count) dismantles the new card normally.
    const fresh = await batch(p, [{ ...ref(p, reused), riven_id: card(p, reused).riven_id }], { api_count: 4 })
    assert.equal(fresh.body.data.weapon_riven_conflict, undefined)
    assert.equal(card(p, reused), null)
})

test('the batch request key ignores item order, so a reordered retry replays instead of conflicting', async () => {
    const p = await fixture(), b = addCard(p, 'review-order-b')
    const items = [ref(p, p.item), ref(p, b)]
    const first = await batch(p, items, { api_count: 9 })
    assert.equal(first.body.data.weapon_riven_conflict, undefined)
    const granted = fragments(p)
    const replay = await batch(p, [...items].reverse(), { api_count: 9 })
    assert.equal(replay.body.data.weapon_riven_conflict, undefined, JSON.stringify(replay.body.data))
    assert.deepEqual(replay.body.data.dismantle_return_total, first.body.data.dismantle_return_total)
    assert.equal(fragments(p), granted)
})

test('the batch request key includes riven_id: a different named identity is not served the old receipt', async () => {
    const p = await fixture(), rivenId = card(p, p.item).riven_id
    const first = await batch(p, [{ ...ref(p, p.item), riven_id: rivenId }], { api_count: 11 })
    assert.equal(first.body.data.weapon_riven_conflict, undefined)
    const reused = addCard(p, 'review-identity')
    assert.equal(reused, p.item)
    const other = await batch(p, [{ ...ref(p, reused), riven_id: card(p, reused).riven_id }], { api_count: 11 })
    assert.equal(other.body.data.weapon_riven_conflict, undefined, 'new identity => new key => normal dismantle')
    assert.equal(card(p, reused), null)
})
