'use strict'
// Real route, SQLite and writer-queue coverage. Only serialization and explicit
// failure injection are adapted; no business domain or receipt store is mocked.
const compiled = process.env.STARPOINT_TEST_COMPILED === '1'
if (!compiled) require('ts-node/register/transpile-only')
const load = name => require(`../${compiled ? 'out' : 'src'}/${name}`)
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { randomUUID } = require('node:crypto'), { spawnSync } = require('node:child_process')
const tempRoot = path.resolve(os.tmpdir())
const directory = fs.mkdtempSync(path.join(tempRoot, 'equipment-receipts-'))
Object.assign(process.env, { DATA_DIR: directory, GACHA_SEED_DIR: path.join(directory, 'seeds'),
    CN_WRITER_THREAD: '0', GAME_VERBOSE_LOGS: 'false', GAME_ROUTINE_LOGS: 'off' })
fs.mkdirSync(process.env.GACHA_SEED_DIR)
const equipment = load('data/domains/equipment'), items = load('data/domains/item')
const identities = load('lib/gameplay-request-identity'), counters = load('lib/mission/counters')
const equipmentId = 5010004, craftId = 100000, crystalId = 12002
const awakeningCounter = { dimension: 'equipment.awakening', scopeType: 'lifetime', scopeKey: 'all', qualifier: {} }
let app, db

function issueLogin(p) {
    return db.transaction(() => identities.issueGameplayLoginTokenSync(db, {
        accountId: p.accountId, viewerId: p.viewer, udid: 'equipment-' + p.viewer, expiresAt: Date.now() + 86400000,
    }))()
}
function fixture({ stack = 4, level = 1, craft = 1000, crystal = 0, protection = false } = {}) {
    const account = load('data/domains/account').insertAccountSync({ appId: 'wf_cn', idpAlias: '',
        idpCode: 'equipment-receipt-test', idpId: randomUUID(), status: 'normal' })
    const player = load('data/domains/player').insertDefaultPlayerSync(account.id)
    const p = { id: player.id, accountId: account.id, viewer: 880000000 + player.id }
    load('data/activeAccount').saveAccountDefaultPlayer(account.id, player.id)
    db.prepare('INSERT INTO sessions(token,account_id,expires,type) VALUES(?,?,?,2)')
        .run(String(p.viewer), p.accountId, '2099-01-01T00:00:00Z')
    p.nonce = issueLogin(p)
    equipment.insertPlayerEquipmentSync(p.id, equipmentId, { level, enhancementLevel: 0, stack, protection })
    items.setPlayerItemSync(p.id, craftId, craft)
    items.setPlayerItemSync(p.id, crystalId, crystal)
    return p
}
const upgradeBody = (extra = {}) => ({ equipment_id: equipmentId, use_stack: true, ...extra })
const saleBody = (number = 1) => ({ equipment_list: [{ equipment_id: equipmentId, number }] })
const bulkBody = { equipment_ids: [equipmentId] }
const post = (p, route, body, count = 1, nonce = p.nonce) => app.inject({ method: 'POST',
    url: '/equipment/' + route, headers: nonce === null ? {} : { login_token: nonce },
    payload: { viewer_id: p.viewer, api_count: count, ...body } })
function ok(response) { assert.equal(response.statusCode, 200, response.body); return response.json().data }
const balance = (p, id) => items.getPlayerItemSync(p.id, id) ?? 0
const owned = p => equipment.getPlayerEquipmentSync(p.id, equipmentId)
const receiptCount = p => db.prepare("SELECT COUNT(*) n FROM player_operation_receipts WHERE player_id=? AND operation='gameplay_mutation.v1'").get(p.id).n
function state(p) {
    return { equipment: owned(p), items: items.getPlayerItemsSync(p.id),
        awakenings: counters.getMissionCounterValueSync(p.id, awakeningCounter), receipts: receiptCount(p) }
}
function assertSaleRewards(p, previous, units) {
    const reward = load('lib/equipment-dissolve').calculateDissolveRewards(equipmentId, units)
    const expected = { [craftId]: reward.craftPoints, 990008: reward.starGrains, ...reward.abilitySouls }
    for (const [id, amount] of Object.entries(expected)) {
        assert.equal(balance(p, Number(id)), (previous.items[id] ?? 0) + amount)
    }
}
async function registerRoutes(server) {
    server.addHook('onSend', (_request, reply, payload, done) => done(null,
        String(reply.getHeader('content-type')).startsWith('application/x-msgpack') && typeof payload === 'object'
            ? JSON.stringify(payload) : payload))
    await server.register(load('routes/api/equipment').default, { prefix: '/equipment' })
    await server.register(load('routes/api/sell').default, { prefix: '/equipment' })
    await server.ready()
}
before(async () => {
    load('data').initializeDatabase()
    db = load('data/db').getDb()
    identities.initializeGameplayRequestIdentitySchemaSync(db)
    assert.equal(path.dirname(fs.realpathSync(db.name)), fs.realpathSync(directory))
    app = require('fastify')({ logger: false })
    await registerRoutes(app)
})
after(async () => {
    await app?.close()
    await load('lib/seed-validator').default.close()
    if (db?.open) db.close()
    assert.equal(path.dirname(directory), tempRoot)
    fs.rmSync(directory, { recursive: true })
})

test('upgrade replays the full committed response and charges/advances missions once', async () => {
    const p = fixture()
    const first = ok(await post(p, 'upgrade', upgradeBody()))
    const accepted = state(p)
    assert.deepEqual(ok(await post(p, 'upgrade', upgradeBody())), first)
    assert.deepEqual(state(p), accepted)
    assert.equal(owned(p).level, 2); assert.equal(owned(p).stack, 3)
    assert.equal(balance(p, craftId), 975); assert.equal(balance(p, equipmentId), 1)
    assert.equal(accepted.awakenings, 1); assert.equal(accepted.receipts, 1)
    ok(await post(p, 'upgrade', upgradeBody(), 2))
    assert.equal(owned(p).level, 3); assert.equal(balance(p, craftId), 950)
    const afterNewRequest = state(p)
    assert.deepEqual(ok(await post(p, 'upgrade', upgradeBody())), first)
    assert.deepEqual(state(p), afterNewRequest)
})

test('upgrade last duplicate, last craft points and maximum level still replay successfully', async () => {
    const p = fixture({ stack: 1, level: 4, craft: 25 })
    const first = ok(await post(p, 'upgrade', upgradeBody()))
    assert.equal(owned(p).level, 5); assert.equal(owned(p).stack, 0); assert.equal(balance(p, craftId), 0)
    assert.deepEqual(ok(await post(p, 'upgrade', upgradeBody())), first)
    assert.equal((await post(p, 'upgrade', upgradeBody(), 2)).statusCode, 400)
    assert.equal(receiptCount(p), 1)
})

test('upgrade last substitution crystal is consumed once and its zero balance is replayed', async () => {
    const p = fixture({ stack: 0, craft: 25, crystal: 1 })
    const body = upgradeBody({ use_stack: false, item_id: crystalId })
    const first = ok(await post(p, 'upgrade', body))
    assert.equal(balance(p, crystalId), 0); assert.equal(balance(p, craftId), 0)
    assert.equal(first.item_list[crystalId], 0)
    assert.deepEqual(ok(await post(p, 'upgrade', body)), first)
    assert.equal(owned(p).level, 2); assert.equal(owned(p).stack, 0); assert.equal(receiptCount(p), 1)
})

test('missing/invalid native identity cannot start equipment mutations', async () => {
    const p = fixture(), before = state(p)
    for (const count of [undefined, 0, -1, 1.5, '1', Number.MAX_SAFE_INTEGER + 1]) {
        const response = await post(p, 'upgrade', { ...upgradeBody(), api_count: count })
        assert.equal(response.statusCode, 400, response.body)
    }
    assert.equal((await post(p, 'sell_stack', saleBody(), 1, null)).statusCode, 400)
    assert.equal((await post(p, 'upgrade', upgradeBody(), 1, 'f'.repeat(64))).statusCode, 400)
    const other = fixture()
    assert.equal((await post(p, 'upgrade', upgradeBody(), 1, other.nonce)).statusCode, 400)
    assert.deepEqual(state(p), before)
})

test('one identity cannot change upgrade content or switch to sale; a fresh count is legitimate', async () => {
    const p = fixture()
    ok(await post(p, 'upgrade', upgradeBody()))
    const accepted = state(p)
    assert.equal((await post(p, 'upgrade', upgradeBody({ upgrade_count: 2 }))).statusCode, 400)
    assert.equal((await post(p, 'sell_stack', saleBody())).statusCode, 400)
    assert.deepEqual(state(p), accepted)
    ok(await post(p, 'sell_stack', saleBody(), 2))
    assert.equal(owned(p).stack, 2); assert.equal(receiptCount(p), 2)
})

test('parallel identical upgrades charge once while a distinct request remains independent', async () => {
    const p = fixture()
    const replies = await Promise.all([post(p, 'upgrade', upgradeBody()), post(p, 'upgrade', upgradeBody()),
        post(p, 'upgrade', upgradeBody(), 2), post(p, 'upgrade', upgradeBody())])
    const data = replies.map(ok)
    assert.deepEqual(data[0], data[1]); assert.deepEqual(data[0], data[3])
    assert.equal(owned(p).level, 3); assert.equal(owned(p).stack, 2)
    assert.equal(balance(p, craftId), 950); assert.equal(balance(p, equipmentId), 2)
    assert.equal(counters.getMissionCounterValueSync(p.id, awakeningCounter), 2)
    assert.equal(receiptCount(p), 2)
})

test('sell_stack last duplicate replays the same grant and rejects changed quantity', async () => {
    const p = fixture({ stack: 1 }), before = state(p)
    const first = ok(await post(p, 'sell_stack', saleBody()))
    assert.equal(owned(p).stack, 0); assertSaleRewards(p, before, 1)
    const accepted = state(p)
    assert.deepEqual(ok(await post(p, 'sell_stack', saleBody())), first)
    assert.equal((await post(p, 'sell_stack', saleBody(2))).statusCode, 400)
    assert.equal((await post(p, 'sell_stack', saleBody(), 2)).statusCode, 400)
    assert.deepEqual(state(p), accepted)
})

test('sell_stack validates the combined duplicate quantity before applying any sale', async () => {
    const p = fixture({ stack: 2 }), before = state(p)
    const body = { equipment_list: [{ equipment_id: equipmentId, number: 1 }, { equipment_id: equipmentId, number: 2 }] }
    assert.equal((await post(p, 'sell_stack', body)).statusCode, 400)
    assert.deepEqual(state(p), before)
    // Business validation failures do not consume the identity.
    ok(await post(p, 'sell_stack', saleBody(2)))
    assert.equal(owned(p).stack, 0); assertSaleRewards(p, before, 2)
})

test('parallel sale retries grant once per identity and fresh sale still works', async () => {
    const p = fixture({ stack: 2 }), before = state(p)
    const replies = await Promise.all([post(p, 'sell_stack', saleBody()), post(p, 'sell_stack', saleBody()),
        post(p, 'sell_stack', saleBody(), 2)])
    const data = replies.map(ok)
    assert.deepEqual(data[0], data[1]); assert.equal(owned(p).stack, 0)
    assertSaleRewards(p, before, 2); assert.equal(receiptCount(p), 2)
})

test('bulk awakening and sale replay their first data rather than reconstructing an empty response', async () => {
    for (const route of ['bulk_upgrade', 'bulk_sell_stack']) {
        const p = fixture({ stack: 2 }), first = ok(await post(p, route, bulkBody))
        const accepted = state(p)
        assert.ok(first.equipment_list.length > 0)
        assert.deepEqual(ok(await post(p, route, bulkBody)), first)
        assert.deepEqual(state(p), accepted)
    }
})

test('empty bulk successes remain empty when later inventory arrives', async () => {
    for (const route of ['bulk_upgrade', 'bulk_sell_stack']) {
        const p = fixture({ stack: 0 }), first = ok(await post(p, route, bulkBody))
        assert.deepEqual(first, { equipment_list: [], item_list: {}, mail_arrived: false })
        equipment.updatePlayerEquipmentSync(p.id, equipmentId, { stack: 2 })
        const afterGrant = state(p)
        assert.deepEqual(ok(await post(p, route, bulkBody)), first)
        assert.deepEqual(state(p), afterGrant)
        ok(await post(p, route, bulkBody, 2))
        assert.equal(owned(p).stack, 0); assert.equal(receiptCount(p), 2)
    }
})

test('sell_equipment gains replay protection without changing its existing duplicate-only rule', async () => {
    const p = fixture({ stack: 1 }), before = state(p), body = { equipment_list: [{ equipment_id: equipmentId }] }
    const first = ok(await post(p, 'sell_equipment', body))
    assert.deepEqual(ok(await post(p, 'sell_equipment', body)), first)
    assert.equal(owned(p).stack, 0); assertSaleRewards(p, before, 1)
    assert.equal((await post(p, 'sell_equipment', body, 2)).statusCode, 400)
    assert.ok(owned(p), 'base equipment is retained by the existing rule')
})

test('protected-equipment failures do not award or record a successful receipt', async () => {
    const p = fixture({ protection: true }), before = state(p)
    for (const [route, body] of [['sell_stack', saleBody()], ['sell_equipment', saleBody()], ['bulk_sell_stack', bulkBody]]) {
        assert.equal((await post(p, route, body)).statusCode, 400)
        assert.deepEqual(state(p), before)
    }
})

test('receipt insertion failure rolls back equipment, materials, souls and mission counters for every route', async () => {
    for (const [route, body] of [['upgrade', upgradeBody()], ['bulk_upgrade', bulkBody], ['sell_stack', saleBody()],
        ['sell_equipment', saleBody()], ['bulk_sell_stack', bulkBody]]) {
        const p = fixture(), before = state(p)
        db.exec(`CREATE TRIGGER fail_equipment_receipt BEFORE INSERT ON player_operation_receipts
            WHEN NEW.operation='gameplay_mutation.v1' BEGIN SELECT RAISE(ABORT,'receipt failure'); END`)
        try { assert.equal((await post(p, route, body)).statusCode, 500) }
        finally { db.exec('DROP TRIGGER fail_equipment_receipt') }
        assert.deepEqual(state(p), before, route)
        ok(await post(p, route, body))
        assert.equal(receiptCount(p), 1)
    }
})

test('deferred foreign-key COMMIT failure rolls back the success data and receipt together', async () => {
    const coordinator = load('lib/persistence-coordinator'), original = coordinator.runPersistenceTransaction
    const p = fixture(), before = state(p)
    db.exec('CREATE TABLE equipment_commit_guard (player_id INTEGER REFERENCES players(id) DEFERRABLE INITIALLY DEFERRED)')
    coordinator.runPersistenceTransaction = (context, callback, options) => original(context, () => {
        const result = callback()
        if (context.operation === 'equipment_upgrade') db.prepare('INSERT INTO equipment_commit_guard(player_id) VALUES(-1234567)').run()
        return result
    }, options)
    try { assert.equal((await post(p, 'upgrade', upgradeBody())).statusCode, 500) }
    finally { coordinator.runPersistenceTransaction = original; db.exec('DROP TABLE equipment_commit_guard') }
    assert.deepEqual(state(p), before)
    ok(await post(p, 'upgrade', upgradeBody()))
    assert.equal(owned(p).level, 2); assert.equal(receiptCount(p), 1)
})

test('superseded login replays accepted upgrades and sales but cannot start another mutation', async () => {
    for (const [route, body] of [['upgrade', upgradeBody()], ['sell_stack', saleBody()]]) {
        const p = fixture(), oldNonce = p.nonce, first = ok(await post(p, route, body))
        const accepted = state(p)
        p.nonce = issueLogin(p)
        assert.deepEqual(ok(await post(p, route, body, 1, oldNonce)), first)
        assert.equal((await post(p, route, body, 2, oldNonce)).statusCode, 400)
        assert.deepEqual(state(p), accepted)
        ok(await post(p, route, body, 1))
        assert.equal(receiptCount(p), 2)
    }
})

test('a fresh process reads durable SQLite receipts and replays the actual routes', async () => {
    for (const [route, body] of [['upgrade', upgradeBody()], ['sell_stack', saleBody()]]) {
        const p = fixture({ stack: 1 }), first = ok(await post(p, route, body)), accepted = state(p)
        const script = `
            const load = name => require('./${compiled ? 'out' : 'src'}/' + name);
            (async () => {
                load('data').initializeDatabase();
                const app = require('fastify')({logger:false});
                app.addHook('onSend', (_request, reply, payload, done) => done(null,
                    String(reply.getHeader('content-type')).startsWith('application/x-msgpack') && typeof payload==='object' ? JSON.stringify(payload) : payload));
                await app.register(load('routes/api/equipment').default,{prefix:'/equipment'});
                await app.register(load('routes/api/sell').default,{prefix:'/equipment'});
                const input=JSON.parse(process.env.EQUIPMENT_REPLAY_INPUT);
                const response=await app.inject(input);
                console.log('REPLAY_RESULT='+JSON.stringify({status:response.statusCode,body:response.json()}));
                await app.close(); await load('lib/seed-validator').default.close(); load('data/db').getDb().close();
            })().catch(error=>{console.error(error);process.exitCode=1});`
        const args = compiled ? ['-e', script] : ['-r', 'ts-node/register/transpile-only', '-e', script]
        const child = spawnSync(process.execPath, args, { cwd: path.resolve(__dirname, '..'), encoding: 'utf8', timeout: 60000,
            env: { ...process.env, EQUIPMENT_REPLAY_INPUT: JSON.stringify({ method: 'POST', url: '/equipment/' + route,
                headers: { login_token: p.nonce }, payload: { viewer_id: p.viewer, api_count: 1, ...body } }) } })
        assert.equal(child.status, 0, child.stderr + child.stdout)
        const result = JSON.parse(child.stdout.split(/\r?\n/).find(line => line.startsWith('REPLAY_RESULT=')).slice('REPLAY_RESULT='.length))
        assert.equal(result.status, 200); assert.deepEqual(result.body.data, first)
        assert.deepEqual(state(p), accepted)
    }
})
