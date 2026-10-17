const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const Fastify = require('fastify')
const { unpack } = require('msgpackr')
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'persistence-admission-'))
process.env.DATA_DIR = dir
process.env.CN_WRITER_THREAD = '0'
const { createPersistenceAdmission, persistenceAdmission, PersistenceQueueFullError } = require('../out/lib/persistence-admission')
const coordinator = require('../out/lib/persistence-coordinator')
const { installPersistenceHttpErrors } = require('../out/lib/persistence-http-errors')
const { installCnResponseEncoding } = require('../out/lib/cn-response-hook')
const db = require('../out/data/db').getDb()
db.exec('CREATE TABLE queue_effects(id INTEGER PRIMARY KEY, value TEXT)')
const signal = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
after(async () => {
    coordinator.configurePersistenceSqlExecutor(null)
    await coordinator.drainPersistence()
    db.close()
    assert.equal(path.dirname(fs.realpathSync(dir)), fs.realpathSync(os.tmpdir()))
    fs.rmSync(dir, { recursive: true })
})

test('capacity includes all accepted work; per-player/global keys are bounded and release is idempotent', () => {
    const budget = createPersistenceAdmission({ total: 3, perPlayer: 1, withoutPlayer: 1 })
    const a = budget.acquire(1), b = budget.acquire(), c = budget.acquire(2)
    for (const key of [1, undefined, 3]) assert.throws(() => budget.acquire(key), PersistenceQueueFullError)
    a(); a()
    assert.equal(budget.stats().total, 2)
    const d = budget.acquire(3)
    assert.equal(budget.stats().players, 2)
    b(); c(); d()
    assert.deepEqual(budget.stats(), { total: 0, withoutPlayer: 0, players: 0, peak: 3, rejected: 3 })
})

test('all three coordinator entrances reject before side effects; accepted player work stays FIFO and recovers after failure', async () => {
    const gate = signal(), entered = signal(), seen = []
    coordinator.configurePersistenceSqlExecutor(async (context, statements) => {
        if (context.playerId === 101) { entered.resolve(); await gate.promise }
        const value = statements[0].params[0]
        seen.push(value)
        if (value === 'fail') throw new Error('fixture failure')
        db.prepare('INSERT INTO queue_effects(value) VALUES(?)').run(value)
    })
    const context = { domain: 'player', playerId: 101, operation: 'admission-fixture' }
    const pending = Array.from({ length: 8 }, (_, i) => coordinator.runPersistenceSqlCommand(context,
        [{ sql: 'fixture', params: [i === 3 ? 'fail' : `p${i}`] }], () => assert.fail('executor bypass')))
    const outcomes = Promise.allSettled(pending)
    await entered.promise
    await assert.rejects(coordinator.runPersistenceTransaction(context, () => assert.fail('rejected transaction ran')), PersistenceQueueFullError)
    await assert.rejects(coordinator.runPersistenceSqlCommand(context, [], () => assert.fail('rejected fallback ran')), PersistenceQueueFullError)
    await assert.rejects(coordinator.runWriterCommand('unregistered-and-must-not-be-looked-up', {}, context), PersistenceQueueFullError)
    await coordinator.runPersistenceSqlCommand({ ...context, playerId: 102 }, [{ sql: 'fixture', params: ['other'] }], () => {})
    assert.deepEqual(seen, ['other'], 'one player cannot block another before the database executor')
    gate.resolve()
    const results = await outcomes
    assert.equal(results.filter(result => result.status === 'rejected').length, 1)
    assert.deepEqual(seen, ['other', 'p0', 'p1', 'p2', 'fail', 'p4', 'p5', 'p6', 'p7'])
    assert.equal(db.prepare('SELECT count(*) n FROM queue_effects').get().n, 8)
    await coordinator.drainPersistence()
    assert.equal(persistenceAdmission.stats().total, 0)
    await coordinator.runPersistenceSqlCommand(context, [{ sql: 'fixture', params: ['recovered'] }], () => {})
    coordinator.configurePersistenceSqlExecutor(null)
})

test('rotating player IDs cannot grow the total upstream queue beyond its limit', async () => {
    const gate = signal()
    let executed = 0
    coordinator.configurePersistenceSqlExecutor(async () => { await gate.promise; executed++ })
    const tasks = Array.from({ length: 256 }, (_, playerId) => coordinator.runPersistenceSqlCommand(
        { domain: 'player', playerId, operation: 'global-cap' }, [], () => {}))
    await assert.rejects(coordinator.runPersistenceSqlCommand({ domain: 'player', playerId: 999, operation: 'denied' }, [], () => {}), PersistenceQueueFullError)
    assert.equal(persistenceAdmission.stats().total, 256)
    assert.equal(executed, 0)
    gate.resolve(); await Promise.all(tasks); await coordinator.drainPersistence()
    assert.equal(executed, 256)
    assert.equal(persistenceAdmission.stats().players, 0)
    coordinator.configurePersistenceSqlExecutor(null)
})

test('non-player work has a separate cap while already accepted writes drain normally', async () => {
    const gate = signal(), seen = []
    coordinator.configurePersistenceSqlExecutor(async (_ctx, statements) => { await gate.promise; seen.push(statements[0].params[0]) })
    const context = { domain: 'maintenance', operation: 'global-fifo' }
    const tasks = Array.from({ length: 32 }, (_, i) => coordinator.runPersistenceSqlCommand(context, [{ sql: 'fixture', params: [i] }], () => {}))
    await assert.rejects(coordinator.runPersistenceSqlCommand(context, [], () => {}), PersistenceQueueFullError)
    gate.resolve(); await Promise.all(tasks); await coordinator.drainPersistence()
    assert.deepEqual(seen, Array.from({ length: 32 }, (_, i) => i))
    assert.equal(persistenceAdmission.stats().total, 0)
    coordinator.configurePersistenceSqlExecutor(null)
})

test('backpressure preserves the encoded game protocol and does not relabel unknown or in-flight failures', async t => {
    const app = Fastify({ logger: false })
    installCnResponseEncoding(app)
    installPersistenceHttpErrors(app)
    app.post('/api/index.php/load', async () => { throw new PersistenceQueueFullError() })
    app.post('/api/fixture', async () => { throw new PersistenceQueueFullError() })
    app.post('/api/worker-full', async () => { throw Object.assign(new Error('full'), { code: 'SQLITE_WRITER_QUEUE_FULL' }) })
    app.post('/api/worker-timeout', async () => { throw Object.assign(new Error('outcome unknown'), { code: 'SQLITE_WRITER_TIMEOUT' }) })
    app.post('/api/invalid', async () => { throw Object.assign(new Error('invalid fixture'), { statusCode: 400 }) })
    t.after(() => app.close())
    const game = await app.inject({ method: 'POST', url: '/%61pi/index.php/load' })
    assert.equal(game.statusCode, 200)
    assert.equal(unpack(Buffer.from(game.body, 'base64')).data_headers.result_code, 516)
    assert.equal(game.headers['retry-after'], '1')
    for (const url of ['/api/fixture', '/api/worker-full']) {
        const result = await app.inject({ method: 'POST', url })
        assert.equal(result.statusCode, 503)
        assert.equal(result.json().code, 'SERVER_BUSY')
    }
    const uncertain = await app.inject({ method: 'POST', url: '/api/worker-timeout' })
    assert.equal(uncertain.statusCode, 500)
    assert.equal(uncertain.headers['retry-after'], undefined)
    assert.equal((await app.inject({ method: 'POST', url: '/api/invalid' })).statusCode, 400)
})

test('legacy sync writes cannot bypass pending per-player or unattributed capacity', () => {
    for (const [playerId, count] of [[777, 8], [undefined, 32]]) {
        const releases = Array.from({ length: count }, () => persistenceAdmission.acquire(playerId))
        const ctx = { domain: 'player', playerId, operation: 'legacy-sync' }
        try {
            assert.throws(() => coordinator.runPersistenceTransactionSync(ctx, () => assert.fail('write bypassed admission')), PersistenceQueueFullError)
            releases.pop()()
            coordinator.runPersistenceTransactionSync(ctx, () => {
                assert.equal(persistenceAdmission.stats().total, count)
                coordinator.runPersistenceTransactionSync(ctx, () => db.prepare('INSERT INTO queue_effects(value) VALUES(?)').run('nested'))
            })
            assert.equal(persistenceAdmission.stats().total, count - 1)
            assert.throws(() => coordinator.runPersistenceTransactionSync(ctx, () => { throw new Error('sync rollback') }), /sync rollback/)
            assert.equal(persistenceAdmission.stats().total, count - 1)
        } finally { releases.forEach(release => release()) }
    }
})

test('admitted writer fallbacks reuse their slot; detached callbacks cannot reuse it after release', async () => {
    const { registerWriterCommand } = require('../out/lib/persistence/command-registry')
    const context = { domain: 'player', playerId: 888, operation: 'nested-writer' }
    const gate = signal()
    let detached
    registerWriterCommand('fixture.admitted_sync', n => {
        if (n === 0) detached = gate.promise.then(() => {
            assert.throws(() => coordinator.runPersistenceTransactionSync(context, () => assert.fail('released slot reused')), PersistenceQueueFullError)
        })
        return coordinator.runPersistenceTransactionSync(context, () => n)
    })
    assert.deepEqual(await Promise.all(Array.from({ length: 8 }, (_, n) =>
        coordinator.runWriterCommand('fixture.admitted_sync', n, context))), [0, 1, 2, 3, 4, 5, 6, 7])
    assert.equal(persistenceAdmission.stats().total, 0)
    const releases = Array.from({ length: 8 }, () => persistenceAdmission.acquire(888))
    try { gate.resolve(); await detached } finally { releases.forEach(release => release()) }
})
