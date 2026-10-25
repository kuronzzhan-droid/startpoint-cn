'use strict'
// Real routes and temporary SQLite; no CDN/runtime configuration or game database writes.
const compiled = process.env.STARPOINT_TEST_COMPILED === '1'
if (!compiled) require('ts-node/register/transpile-only')
const load = name => require(`../${compiled ? 'out' : 'src'}/${name}`)
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { randomUUID } = require('node:crypto')
const root = path.resolve(os.tmpdir()), directory = fs.mkdtempSync(path.join(root, 'equipment-rarity-'))
Object.assign(process.env, { DATA_DIR: directory, GACHA_SEED_DIR: path.join(directory, 'seeds'),
    CN_WRITER_THREAD: '0', GAME_VERBOSE_LOGS: 'false', GAME_ROUTINE_LOGS: 'off' })
fs.mkdirSync(process.env.GACHA_SEED_DIR)
const equipment = load('data/domains/equipment'), items = load('data/domains/item')
const identities = load('lib/gameplay-request-identity'), { getEquipmentRaritySync } = load('lib/equipment-rarity')
const counters = load('lib/mission/counters')
const craftId = 100000, crystalId = 12002
const awakeningCounter = { dimension: 'equipment.awakening', scopeType: 'lifetime', scopeKey: 'all', qualifier: {} }
let db, app
function fixture(id = 100013, { stack = 4, level = 1, craft = 1000, protection = false, crystal = 0 } = {}) {
    const account = load('data/domains/account').insertAccountSync({ appId: 'wf_cn', idpAlias: '',
        idpCode: 'rarity-test', idpId: randomUUID(), status: 'normal' })
    const player = load('data/domains/player').insertDefaultPlayerSync(account.id)
    const p = { id: player.id, accountId: account.id, viewer: 870000000 + player.id }
    load('data/activeAccount').saveAccountDefaultPlayer(account.id, player.id)
    db.prepare('INSERT INTO sessions(token,account_id,expires,type) VALUES(?,?,?,2)')
        .run(String(p.viewer), p.accountId, '2099-01-01T00:00:00Z')
    p.nonce = db.transaction(() => identities.issueGameplayLoginTokenSync(db, { accountId: account.id,
        viewerId: p.viewer, udid: 'rarity-' + p.viewer, expiresAt: Date.now() + 86400000 }))()
    equipment.insertPlayerEquipmentSync(p.id, id, { level, enhancementLevel: 0, stack, protection })
    items.setPlayerItemSync(p.id, craftId, craft)
    items.setPlayerItemSync(p.id, crystalId, crystal)
    return p
}
const post = (p, route, body, count = 1) => app.inject({ method: 'POST', url: '/equipment/' + route,
    headers: { login_token: p.nonce }, payload: { viewer_id: p.viewer, api_count: count, ...body } })
function ok(response) { assert.equal(response.statusCode, 200, response.body); return response.json().data }
const balance = (p, id = craftId) => items.getPlayerItemSync(p.id, id) ?? 0
const owned = (p, id) => equipment.getPlayerEquipmentSync(p.id, id)
const state = p => ({ equipment: equipment.getPlayerEquipmentListSync(p.id), items: items.getPlayerItemsSync(p.id),
    counter: counters.getMissionCounterValueSync(p.id, awakeningCounter),
    receipts: db.prepare('SELECT COUNT(*) n FROM player_operation_receipts WHERE player_id=?').get(p.id).n })
before(async () => {
    load('data').initializeDatabase(); db = load('data/db').getDb()
    identities.initializeGameplayRequestIdentitySchemaSync(db)
    assert.equal(path.dirname(fs.realpathSync(db.name)), fs.realpathSync(directory))
    app = require('fastify')({ logger: false })
    app.addHook('onSend', (_request, reply, payload, done) => done(null,
        String(reply.getHeader('content-type')).startsWith('application/x-msgpack') && typeof payload === 'object'
            ? JSON.stringify(payload) : payload))
    await app.register(load('routes/api/equipment').default, { prefix: '/equipment' })
    await app.register(load('routes/api/sell').default, { prefix: '/equipment' }); await app.ready()
})
after(async () => {
    await app?.close(); await load('lib/seed-validator').default.close()
    if (db?.open) db.close()
    assert.equal(path.dirname(directory), root); fs.rmSync(directory, { recursive: true })
})

for (const id of [100013, 100023]) {
    test(`${id} single awakening costs 25 and native retry replays after last materials`, async () => {
        const p = fixture(id, { stack: 1, craft: 25 }), body = { equipment_id: id, use_stack: true }
        const first = ok(await post(p, 'upgrade', body))
        assert.equal(balance(p), 0); assert.equal(owned(p, id).level, 2); assert.equal(owned(p, id).stack, 0)
        assert.equal(first.item_list[id], 1); assert.equal(first.item_list[craftId], 0)
        const committed = state(p)
        assert.deepEqual(ok(await post(p, 'upgrade', body)), first); assert.deepEqual(state(p), committed)
        assert.equal((await post(p, 'upgrade', body, 2)).statusCode, 400)
        equipment.updatePlayerEquipmentSync(p.id, id, { stack: 1 }); items.setPlayerItemSync(p.id, craftId, 25)
        ok(await post(p, 'upgrade', body, 2)); assert.equal(balance(p), 0); assert.equal(owned(p, id).level, 3)
    })
    test(`${id} bulk awakening uses the same rarity and refuses insufficient craft atomically`, async () => {
        const p = fixture(id, { stack: 3, craft: 74 }), body = { equipment_ids: [id] }, initial = state(p)
        assert.equal((await post(p, 'bulk_upgrade', body)).statusCode, 400); assert.deepEqual(state(p), initial)
        items.setPlayerItemSync(p.id, craftId, 75)
        const first = ok(await post(p, 'bulk_upgrade', body)), committed = state(p)
        assert.equal(balance(p), 0); assert.equal(owned(p, id).level, 4); assert.equal(owned(p, id).stack, 0)
        assert.equal(first.item_list[id], 3); assert.equal(committed.counter, 3)
        assert.deepEqual(ok(await post(p, 'bulk_upgrade', body)), first); assert.deepEqual(state(p), committed)
    })
    test(`${id} single and bulk duplicate dissolve grant 5 per unit without star grains`, async () => {
        const p = fixture(id, { stack: 3, craft: 0 }), body = { equipment_list: [{ equipment_id: id, number: 1 }] }
        const first = ok(await post(p, 'sell_stack', body)), committed = state(p)
        assert.equal(balance(p), 5); assert.equal(balance(p, id), 1); assert.equal(balance(p, 990008), 0)
        assert.deepEqual(ok(await post(p, 'sell_stack', body)), first); assert.deepEqual(state(p), committed)
        const bulk = { equipment_ids: [id] }, second = ok(await post(p, 'bulk_sell_stack', bulk, 2))
        assert.equal(balance(p), 15); assert.equal(balance(p, id), 3); assert.equal(owned(p, id).stack, 0)
        assert.deepEqual(ok(await post(p, 'bulk_sell_stack', bulk, 2)), second)
    })
    test(`${id} base-sale handler still retains the base and obeys protection`, async () => {
        const p = fixture(id, { stack: 1, craft: 0, protection: true }), body = { equipment_list: [{ equipment_id: id }] }
        const initial = state(p)
        assert.equal((await post(p, 'sell_equipment', body)).statusCode, 400); assert.deepEqual(state(p), initial)
        equipment.updatePlayerEquipmentSync(p.id, id, { protection: false })
        const first = ok(await post(p, 'sell_equipment', body))
        assert.equal(balance(p), 5); assert.equal(owned(p, id).stack, 0)
        assert.deepEqual(ok(await post(p, 'sell_equipment', body)), first)
        assert.equal((await post(p, 'sell_equipment', body, 2)).statusCode, 400)
    })
}

test('ordinary equipment preserves costs for all five rarities', async () => {
    for (const [rarity, id] of [[1, 1010001], [2, 2010002], [3, 3010006], [4, 4010003], [5, 5010004]]) {
        const p = fixture(id, { stack: 2, craft: rarity * 5 })
        assert.equal(getEquipmentRaritySync(id), rarity)
        ok(await post(p, 'upgrade', { equipment_id: id, use_stack: true }))
        assert.equal(balance(p), 0)
        ok(await post(p, 'sell_stack', { equipment_list: [{ equipment_id: id, number: 1 }] }, 2))
        assert.equal(balance(p), rarity)
    }
})

test('dissolve still follows source and soul-generation metadata', async () => {
    const p = fixture(3010007, { stack: 1, craft: 0 })
    ok(await post(p, 'sell_stack', { equipment_list: [{ equipment_id: 3010007, number: 1 }] }))
    assert.equal(balance(p), 3); assert.equal(balance(p, 990008), 1); assert.equal(balance(p, 3010007), 1)
    const q = fixture(5020043, { stack: 1, craft: 0 })
    ok(await post(q, 'sell_stack', { equipment_list: [{ equipment_id: 5020043, number: 1 }] }))
    assert.equal(balance(q), 5); assert.equal(balance(q, 990008), 0); assert.equal(balance(q, 5020043), 0)
})

test('level-one pearl remains non-awakenable in both entry points', async () => {
    const id = 100001, p = fixture(id), initial = state(p)
    assert.equal(getEquipmentRaritySync(id), 5)
    assert.equal((await post(p, 'upgrade', { equipment_id: id, use_stack: true })).statusCode, 400)
    assert.deepEqual(state(p), initial)
    ok(await post(p, 'bulk_upgrade', { equipment_ids: [id] }, 2))
    assert.deepEqual(state(p).equipment, initial.equipment); assert.deepEqual(state(p).items, initial.items)
    assert.equal(state(p).counter, 0)
})

test('new abyss rarity supports the fitting crystal without changing equipment reward eligibility', async () => {
    const id = 8000201, p = fixture(id, { stack: 0, crystal: 1, craft: 25 })
    assert.equal(require('../assets/equipment_ids.json').includes(id), false)
    assert.equal(getEquipmentRaritySync(id), 5)
    const first = ok(await post(p, 'upgrade', { equipment_id: id, use_stack: false, item_id: crystalId }))
    assert.equal(balance(p), 0); assert.equal(balance(p, crystalId), 0); assert.equal(owned(p, id).level, 2)
    assert.deepEqual(ok(await post(p, 'upgrade', { equipment_id: id, use_stack: false, item_id: crystalId })), first)
    assert.equal(require('../assets/equipment_ids.json').includes(id), false)
})

test('new abyss duplicate awakening and dissolve keep the former clamped-five costs', async () => {
    const id = 8000201, p = fixture(id, { stack: 2, craft: 25 })
    ok(await post(p, 'upgrade', { equipment_id: id, use_stack: true }))
    assert.equal(balance(p), 0); assert.equal(owned(p, id).stack, 1)
    ok(await post(p, 'sell_stack', { equipment_list: [{ equipment_id: id, number: 1 }] }, 2))
    assert.equal(balance(p), 5)
    // This cost fix deliberately leaves pre-existing missing soul metadata unchanged.
    assert.equal(balance(p, id), 0); assert.equal(balance(p, 990008), 0)
})

test('unknown owned equipment cannot awaken or dissolve, including mixed batches', async () => {
    const unknown = 5019999, p = fixture(unknown), initial = state(p)
    assert.equal(getEquipmentRaritySync(unknown), null)
    for (const [route, body] of [['upgrade', { equipment_id: unknown, use_stack: true }],
        ['bulk_upgrade', { equipment_ids: [unknown] }], ['sell_stack', { equipment_list: [{ equipment_id: unknown, number: 1 }] }],
        ['sell_equipment', { equipment_list: [{ equipment_id: unknown }] }], ['bulk_sell_stack', { equipment_ids: [unknown] }]]) {
        assert.equal((await post(p, route, body)).statusCode, 400, route); assert.deepEqual(state(p), initial)
    }
    equipment.insertPlayerEquipmentSync(p.id, 100013, { level: 1, enhancementLevel: 0, stack: 1, protection: false })
    const mixed = state(p)
    for (const route of ['bulk_upgrade', 'bulk_sell_stack']) {
        assert.equal((await post(p, route, { equipment_ids: [100013, unknown] })).statusCode, 400)
        assert.deepEqual(state(p), mixed)
    }
})

test('saved pre-fix responses replay their original balances; new identities use corrected costs', async () => {
    const id = 100013, p = fixture(id, { stack: 1, level: 2, craft: 25 })
    const receipts = load('lib/gameplay-mutation-receipt'), { runPersistenceTransaction } = load('lib/persistence-coordinator')
    const oldResponse = { equipment_list: load('lib/equipment').buildFullEquipmentList(p.id),
        item_list: { [craftId]: 25, [id]: 1 }, mail_arrived: false }
    await runPersistenceTransaction({ domain: 'player', playerId: p.id, operation: 'fixture_legacy_rarity_receipt' }, () => {
        const mutation = receipts.readGameplayMutationRequestSync(p.id, { headerToken: p.nonce, accountId: p.accountId,
            body: { viewer_id: p.viewer, api_count: 1 } }, 'equipment_upgrade',
        { equipment_id: id, use_stack: true, upgrade_count: 1, item_id: undefined })
        receipts.recordGameplayMutationResponseSync(p.id, mutation, oldResponse)
    })
    const committed = state(p), body = { equipment_id: id, use_stack: true }
    assert.deepEqual(ok(await post(p, 'upgrade', body)), oldResponse); assert.deepEqual(state(p), committed)
    ok(await post(p, 'upgrade', body, 2)); assert.equal(balance(p), 0); assert.equal(owned(p, id).level, 3)
    const latest = state(p)
    assert.deepEqual(ok(await post(p, 'upgrade', body)), oldResponse); assert.deepEqual(state(p), latest)
})

test('saved pre-fix dissolve response is replayed before a fresh sale grants five', async () => {
    const id = 100023, p = fixture(id, { stack: 1, craft: 1 })
    const receipts = load('lib/gameplay-mutation-receipt'), { runPersistenceTransaction } = load('lib/persistence-coordinator')
    items.setPlayerItemSync(p.id, id, 1)
    const oldResponse = { equipment_list: load('lib/equipment').buildFullEquipmentList(p.id),
        item_list: { [craftId]: 1, [id]: 1 }, mail_arrived: false }
    await runPersistenceTransaction({ domain: 'player', playerId: p.id, operation: 'fixture_legacy_dissolve_receipt' }, () => {
        const mutation = receipts.readGameplayMutationRequestSync(p.id, { headerToken: p.nonce, accountId: p.accountId,
            body: { viewer_id: p.viewer, api_count: 1 } }, 'sell_equipment_stack',
        { equipment_list: [{ equipmentId: id, sellCount: 1 }] })
        receipts.recordGameplayMutationResponseSync(p.id, mutation, oldResponse)
    })
    const committed = state(p), body = { equipment_list: [{ equipment_id: id, number: 1 }] }
    assert.deepEqual(ok(await post(p, 'sell_stack', body)), oldResponse); assert.deepEqual(state(p), committed)
    ok(await post(p, 'sell_stack', body, 2)); assert.equal(balance(p), 6); assert.equal(owned(p, id).stack, 0)
    const latest = state(p)
    assert.deepEqual(ok(await post(p, 'sell_stack', body)), oldResponse); assert.deepEqual(state(p), latest)
})
