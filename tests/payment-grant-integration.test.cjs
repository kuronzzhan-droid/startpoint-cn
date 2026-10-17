const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { spawnSync } = require('node:child_process')
const { setImmediate: nextTurn } = require('node:timers/promises')
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'payment-grant-integration-'))
process.env.DATA_DIR = directory
process.env.GACHA_SEED_DIR = path.join(directory, 'seeds')
process.env.CN_WRITER_THREAD = '0'
const output = path.resolve(__dirname, '../out')
const load = name => require(path.join(output, name))
const db = load('data/db').getDb()
const accounts = load('data/domains/account'), players = load('data/domains/player')
const selection = load('data/activeAccount')
const coordinator = load('lib/persistence-coordinator')
const { persistenceAdmission } = load('lib/persistence-admission')
const { persistenceWriteGate } = load('lib/persistence-write-gate')
const { paymentGrantGuard } = load('lib/payment-grant-guard')
const catalog = require('../assets/payment_products.json')
const products = Object.keys(catalog).filter(id => catalog[id].charge_vmoney_num > 0 || catalog[id].free_vmoney_num > 0)
const product = products[0]
let sequence = 0

after(async () => {
    await coordinator.drainPersistence()
    assert.equal(persistenceAdmission.stats().total, 0)
    db.close()
    fs.rmSync(directory, { recursive: true, force: true })
})
function addSession(accountId) {
    const viewerId = 88190000 + ++sequence
    db.prepare('INSERT INTO sessions(token,account_id,expires,type) VALUES (?,?,?,2)')
        .run(String(viewerId), accountId, '2099-01-01T00:00:00.000Z')
    return viewerId
}
async function subject() {
    const account = accounts.insertAccountSync({ appId: 'wf_cn', idpAlias: '', idpCode: 'payment-fixture', idpId: String(++sequence), status: 'normal' })
    const player = players.insertDefaultPlayerSync(account.id)
    selection.saveAccountDefaultPlayer(account.id, player.id)
    players.updatePlayerSync({ id: player.id, vmoney: 0, freeVmoney: 0 })
    await coordinator.runPersistenceTransaction({ domain: 'player', playerId: player.id, operation: 'payment_fixture' }, () => {})
    return { accountId: account.id, playerId: player.id, viewerId: addSession(account.id) }
}
async function appFor(t, initialClock = 0) {
    const app = require('fastify')({ logger: false })
    app.addHook('onSend', (_request, reply, payload, done) => done(null,
        String(reply.getHeader('content-type') || '').startsWith('application/x-msgpack') && typeof payload === 'object'
            ? JSON.stringify(payload) : payload))
    // Match the plugin scope explicitly; the production guard is keyed by this instance.
    await load('routes/api/payment').default(app)
    await app.ready()
    const guard = paymentGrantGuard(app)
    let clock = initialClock
    t.mock.method(guard, 'now', () => clock)
    t.after(() => app.close())
    return { app, guard, time: value => { clock = value } }
}
const finish = (app, p, id = product, identity) => app.inject({ method: 'POST', url: '/finish', payload: {
    viewer_id: p.viewerId, product_id: id, ...(identity === undefined ? {} : { payment: { transaction_id: identity } }),
} })
const balances = p => {
    const row = players.getPlayerSync(p.playerId)
    return { paid: row.vmoney, free: row.freeVmoney }
}
const receipts = p => db.prepare('SELECT * FROM player_payment_receipts WHERE player_id=? ORDER BY payment_key').all(p.playerId)
const digest = p => {
    const playerId = p.playerId
    assert.ok(Number.isSafeInteger(playerId) && playerId > 0)
    const quote = name => '"' + name.replaceAll('"', '""') + '"'
    const metadata = db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
        .map(({ name }) => ({ name, columns: db.prepare('PRAGMA table_info(' + quote(name) + ')').all(),
            keys: db.prepare('PRAGMA foreign_key_list(' + quote(name) + ')').all() }))
    const selectors = new Map([['players', 'id=' + playerId]])
    for (const table of metadata) {
        if (table.name === 'players') continue
        const terms = table.columns.some(c => c.name === 'player_id') ? ['player_id=' + playerId] : []
        for (const key of table.keys) if (key.table === 'players') terms.push(quote(key.from) + '=' + playerId)
        if (terms.length) selectors.set(table.name, terms.join(' OR '))
    }
    for (let remaining = metadata.length; remaining > 0; remaining--) {
        let changed = false
        for (const table of metadata) {
            if (selectors.has(table.name)) continue
            const terms = table.keys.filter(k => selectors.has(k.table) && k.to).map(k =>
                quote(k.from) + ' IN (SELECT ' + quote(k.to) + ' FROM ' + quote(k.table) + ' WHERE ' + selectors.get(k.table) + ')')
            if (terms.length) { selectors.set(table.name, terms.join(' OR ')); changed = true }
        }
        if (!changed) break
    }
    const hash = require('node:crypto').createHash('sha256')
    for (const { name } of metadata) {
        const selector = selectors.get(name)
        if (!selector) continue
        const rows = db.prepare('SELECT * FROM ' + quote(name) + ' WHERE ' + selector).all().map(row => JSON.stringify(row)).sort()
        hash.update(JSON.stringify([name, rows]))
    }
    return hash.digest('hex')
}
function data(response) {
    assert.equal(response.statusCode, 200, response.body)
    assert.match(response.headers['content-type'], /application\/x-msgpack/)
    return response.json().data
}
function denied(response, p, id, times) {
    const result = data(response), current = balances(p)
    assert.equal(result.after_vmoney, current.paid)
    assert.equal(result.after_free_vmoney, current.free)
    assert.equal(result.first_payment, false)
    assert.equal(result.first_time, false)
    assert.equal(result.purchased_times_list[id], times)
    assert.ok(Number(response.headers['retry-after']) >= 1)
}
async function until(condition) {
    const end = performance.now() + 5000
    while (!condition()) { assert.ok(performance.now() < end, 'fixture queue timed out'); await nextTurn() }
}

test('20 same-player finishes admit eight commands, grant once, reject twelve upstream and recover', async t => {
    const p = await subject(), { app, guard, time } = await appFor(t)
    const rejectedBefore = persistenceAdmission.stats().rejected
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => finish(app, p, product, 'burst-' + i)))
    const admitted = results.filter(r => r.statusCode === 200), busy = results.filter(r => r.statusCode === 503)
    assert.equal(admitted.length, 8)
    assert.equal(busy.length, 12)
    assert.ok(busy.every(r => r.json().code === 'PERSISTENCE_QUEUE_FULL'))
    assert.equal(admitted.filter(r => data(r).first_time).length, 1)
    assert.equal(admitted.filter(r => r.headers['retry-after'] !== undefined).length, 7)
    assert.equal(receipts(p).length, 1)
    assert.equal(guard.inspect().grants, 1)
    assert.equal(persistenceAdmission.stats().rejected - rejectedBefore, 12)
    assert.equal(persistenceAdmission.stats().total, 0)
    const before = digest(p)
    denied(await finish(app, p, product, 'still-cooling'), p, product, 1)
    assert.equal(digest(p), before)
    time(10000)
    assert.equal(data(await finish(app, p, product, 'recovered')).purchased_times_list[product], 2)
    assert.equal(receipts(p).length, 2)
    assert.equal(guard.inspect().grants, 2)
    assert.equal(persistenceAdmission.stats().total, 0)
})

test('same-product cooldown uses a monotonic execution clock with an exact ten-second boundary', async t => {
    const p = await subject(), { app, guard, time } = await appFor(t, 1234)
    data(await finish(app, p, product, 'first'))
    time(11233)
    const before = digest(p)
    denied(await finish(app, p, product, 'early'), p, product, 1)
    assert.equal(digest(p), before)
    t.mock.method(Date, 'now', () => Date.parse('2098-01-01T00:00:00Z'))
    denied(await finish(app, p, product, 'wall-clock-jump'), p, product, 1)
    time(11234)
    assert.equal(data(await finish(app, p, product, 'boundary')).purchased_times_list[product], 2)
    assert.equal(guard.inspect().grants, 2)
    assert.equal(receipts(p).length, 2)
})

test('sixty successful grants share one fixed hour across products; duplicates still replay while full', async t => {
    assert.ok(products.length > 60)
    const p = await subject(), start = 12345, { app, guard, time } = await appFor(t, start)
    let first
    for (let i = 0; i < 60; i++) {
        time(start + i)
        const response = data(await finish(app, p, products[i], 'hour-' + i))
        if (!i) first = response
    }
    assert.equal(receipts(p).length, 60)
    assert.equal(guard.inspect().grants, 60)
    const before = digest(p)
    denied(await finish(app, p, products[60], 'overflow'), p, products[60], 0)
    assert.equal(digest(p), before)
    assert.deepEqual(data(await finish(app, p, product, 'hour-0')), first)
    assert.equal(guard.inspect().grants, 60)
    assert.equal(digest(p), before)
    time(start + 3599999)
    denied(await finish(app, p, products[60], 'hour-early'), p, products[60], 0)
    assert.equal(digest(p), before)
    time(start + 3600000)
    data(await finish(app, p, products[60], 'hour-boundary'))
    assert.equal(receipts(p).length, 61)
    assert.equal(guard.inspect().grants, 1)
})

test('two concurrent products compete for the final hourly slot without exceeding sixty', async t => {
    const p = await subject(), { app, guard } = await appFor(t)
    for (let i = 0; i < 59; i++) data(await finish(app, p, products[i], 'last-slot-' + i))
    const before = balances(p)
    const responses = await Promise.all([59, 60].map(i => finish(app, p, products[i], 'last-slot-' + i)))
    const accepted = responses.filter(r => !r.headers['retry-after'])
    const refused = responses.filter(r => r.headers['retry-after'])
    assert.equal(accepted.length, 1)
    assert.equal(refused.length, 1)
    assert.equal(receipts(p).length, 60)
    assert.equal(guard.inspect().grants, 60)
    const winner = responses[0] === accepted[0] ? 59 : 60
    const reward = catalog[products[winner]]
    assert.deepEqual(balances(p), { paid: before.paid + reward.charge_vmoney_num, free: before.free + reward.free_vmoney_num })
    assert.equal(persistenceAdmission.stats().total, 0)
})

test('V2 restore preserves target receipts, account identity and its active grant budget', async t => {
    const source = await subject(), target = await subject(), { app, guard } = await appFor(t)
    const first = data(await finish(app, target, product, 'before-restore'))
    const ledger = receipts(target), budget = guard.inspect()
    const identities = db.prepare('SELECT * FROM sessions ORDER BY token').all()
    const snapshots = load('data/snapshots/player-snapshot')
    const archive = snapshots.createPlayerSaveSnapshotV2Sync(source.playerId)
    snapshots.restorePlayerSaveSnapshotV2Sync(archive, target.playerId)
    assert.equal(db.prepare('SELECT account_id FROM players WHERE id=?').get(target.playerId).account_id, target.accountId)
    assert.deepEqual(db.prepare('SELECT * FROM sessions ORDER BY token').all(), identities)
    assert.deepEqual(receipts(target), ledger)
    assert.deepEqual(guard.inspect(), budget)
    const before = digest(target)
    denied(await finish(app, target, product, 'after-restore'), target, product, 1)
    assert.equal(digest(target), before)
    assert.deepEqual(data(await finish(app, target, product, 'before-restore')), first)
    assert.equal(digest(target), before)
    assert.deepEqual(guard.inspect(), budget)
})

test('durable duplicate survives route reload and a fresh process without a second grant', async t => {
    const p = await subject(), { app, guard } = await appFor(t)
    const first = data(await finish(app, p, product, 'durable-replay')), before = digest(p)
    assert.deepEqual(data(await finish(app, p, product, 'durable-replay')), first)
    assert.equal(guard.inspect().grants, 1)
    const routePath = require.resolve(path.join(output, 'routes/api/payment'))
    delete require.cache[routePath]
    const reloaded = await appFor(t)
    assert.deepEqual(data(await finish(reloaded.app, p, product, 'durable-replay')), first)
    assert.equal(reloaded.guard.inspect().grants, 0)
    assert.equal(digest(p), before)
    const script = `const path=require('node:path');const load=n=>require(path.join(process.env.PAYMENT_TEST_OUT,n));
        (async()=>{const app=require('fastify')({logger:false});app.addHook('onSend',(_q,r,p,d)=>d(null,typeof p==='object'?JSON.stringify(p):p));
        await load('routes/api/payment').default(app);const r=await app.inject({method:'POST',url:'/finish',payload:JSON.parse(process.env.PAYMENT_TEST_BODY)});
        const guard=load('lib/payment-grant-guard').paymentGrantGuard(app);console.log('REPLAY_RESULT '+JSON.stringify({status:r.statusCode,data:r.json().data,grants:guard.inspect().grants}));
        await app.close();await load('lib/persistence-coordinator').drainPersistence();load('data/db').getDb().close()})().catch(e=>{console.error(e);process.exitCode=1})`
    const child = spawnSync(process.execPath, ['--preserve-symlinks', '--preserve-symlinks-main', '-e', script], {
        cwd: path.resolve(__dirname, '..'), encoding: 'utf8', timeout: 20000,
        env: { ...process.env, PAYMENT_TEST_OUT: output, PAYMENT_TEST_BODY: JSON.stringify({
            viewer_id: p.viewerId, product_id: product, payment: { transaction_id: 'durable-replay' },
        }) },
    })
    assert.equal(child.status, 0, child.stdout + child.stderr)
    const record = child.stdout.split(/\r?\n/).find(line => line.startsWith('REPLAY_RESULT '))
    assert.ok(record, child.stdout)
    assert.deepEqual(JSON.parse(record.slice('REPLAY_RESULT '.length)), { status: 200, data: first, grants: 0 })
    assert.equal(digest(p), before)
    assert.equal(receipts(p).length, 1)
})

test('receipt insert failure rolls back money and leaves budget available for count-one retry', async t => {
    const p = await subject(), { app, guard } = await appFor(t), before = digest(p)
    db.exec(`CREATE TRIGGER payment_fixture_receipt BEFORE INSERT ON player_payment_receipts
        WHEN NEW.player_id=${p.playerId} BEGIN SELECT RAISE(ABORT,'fixture receipt failure'); END`)
    try {
        const failed = await finish(app, p, product, 'failed-insert')
        assert.equal(failed.statusCode, 500, failed.body)
        assert.equal(digest(p), before)
        assert.equal(receipts(p).length, 0)
        assert.equal(guard.inspect().grants, 0)
    } finally { db.exec('DROP TRIGGER payment_fixture_receipt') }
    const retry = data(await finish(app, p, product, 'failed-insert'))
    assert.equal(retry.first_time, true)
    assert.equal(retry.purchased_times_list[product], 1)
    assert.equal(receipts(p).length, 1)
    assert.equal(guard.inspect().grants, 1)
})

for (const fault of ['update', 'commit']) test(`no-identity ${fault} failure does not consume budget or advance fallback count`, async t => {
    const p = await subject(), { app, guard } = await appFor(t), before = digest(p)
    if (fault === 'commit') {
        db.exec(`CREATE TABLE payment_fixture_parent(id INTEGER PRIMARY KEY);
            CREATE TABLE payment_fixture_child(id INTEGER REFERENCES payment_fixture_parent(id) DEFERRABLE INITIALLY DEFERRED);
            CREATE TRIGGER payment_fixture_fault AFTER UPDATE OF vmoney,free_vmoney ON players
                WHEN NEW.id=${p.playerId} BEGIN INSERT INTO payment_fixture_child VALUES(1); END`)
    } else db.exec(`CREATE TRIGGER payment_fixture_fault BEFORE UPDATE OF vmoney,free_vmoney ON players
        WHEN NEW.id=${p.playerId} BEGIN SELECT RAISE(ABORT,'fixture update failure'); END`)
    try {
        const failed = await finish(app, p)
        assert.equal(failed.statusCode, 500, failed.body)
        assert.equal(db.inTransaction, false)
        assert.equal(digest(p), before)
        assert.equal(guard.inspect().grants, 0)
        assert.equal(receipts(p).length, 0)
        if (fault === 'commit') assert.equal(db.prepare('SELECT count(*) n FROM payment_fixture_child').get().n, 0)
    } finally {
        db.exec('DROP TRIGGER payment_fixture_fault')
        if (fault === 'commit') db.exec('DROP TABLE payment_fixture_child; DROP TABLE payment_fixture_parent')
    }
    const retry = data(await finish(app, p))
    assert.equal(retry.first_time, true)
    assert.equal(retry.purchased_times_list[product], 1)
    assert.equal(guard.inspect().grants, 1)
    assert.equal(receipts(p).length, 0)
    denied(await finish(app, p), p, product, 1)
})

test('the account-selected player receives grants and multiple sessions share its budget', async t => {
    const original = await subject(), selected = players.insertDefaultPlayerSync(original.accountId)
    players.updatePlayerSync({ id: selected.id, vmoney: 0, freeVmoney: 0 })
    selection.saveAccountDefaultPlayer(original.accountId, selected.id)
    const p = { ...original, playerId: selected.id }, second = { ...p, viewerId: addSession(p.accountId) }
    const { app, guard } = await appFor(t), originalBefore = balances(original)
    data(await finish(app, p, product, 'selected'))
    assert.deepEqual(balances(original), originalBefore)
    assert.equal(receipts(original).length, 0)
    assert.equal(receipts(p).length, 1)
    denied(await finish(app, second, product, 'other-session'), p, product, 1)
    assert.equal(guard.inspect().players, 1)
    assert.equal(guard.inspect().grants, 1)
    assert.equal(receipts(p).length, 1)
})

test('a queued finish evaluates cooldown after entering its transaction', async t => {
    const p = await subject(), { app, guard, time } = await appFor(t)
    data(await finish(app, p, product, 'queue-first'))
    time(9999)
    const release = await persistenceWriteGate.acquire(true)
    let pending
    try {
        pending = finish(app, p, product, 'queued-boundary')
        // LightMyRequest starts its injection when its thenable is observed.
        pending = Promise.resolve(pending)
        await until(() => persistenceAdmission.stats().total === 1)
        assert.equal(guard.inspect().grants, 1)
        time(10000)
    } finally { release() }
    assert.equal(data(await pending).purchased_times_list[product], 2)
    assert.equal(guard.inspect().grants, 2)
    assert.equal(receipts(p).length, 2)
})

test('unknown and prototype product keys never grant or occupy the guard', async t => {
    const p = await subject(), { app, guard } = await appFor(t), before = digest(p)
    for (const id of ['unknown-payment-fixture', 'constructor', 'toString', '__proto__']) {
        assert.deepEqual(data(await finish(app, p, id, 'unknown-' + id)), {})
    }
    assert.equal(digest(p), before)
    assert.deepEqual(guard.inspect(), { players: 0, products: 0, grants: 0 })
})
