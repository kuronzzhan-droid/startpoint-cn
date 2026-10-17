const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const Fastify = require('fastify')
const { unpack } = require('msgpackr')
const shutdown = require('../out/lib/shutdown-state')
const { createGracefulShutdown, shutdownDeadlines } = require('../out/lib/graceful-shutdown')
const signal = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
const turn = () => new Promise(resolve => setImmediate(resolve))
const logger = { log() {}, warn() {}, error() {} }

test('closing drains accepted parents and independent queued children; expired detached callbacks lose admission', async () => {
    const state = shutdown.createServerShutdownState(), gate = signal(), parentGate = signal(), events = []
    let detached, child
    state.run(() => {
        detached = new Promise(resolve => setImmediate(() => {
            assert.throws(() => state.run(() => events.push('detached')), shutdown.ServerClosingError)
            resolve()
        }))
        child = state.run(async () => { await gate.promise; state.run(() => events.push('child')) })
    })
    const parent = state.run(async () => {
        await parentGate.promise
        await state.run(async () => { await turn(); events.push('follow-up') })
    })
    state.beginClosing()
    assert.throws(() => state.run(() => assert.fail('new work ran')), shutdown.ServerClosingError)
    let drained = false
    const drain = state.drain().then(() => { drained = true })
    await detached; await turn()
    assert.equal(drained, false)
    gate.resolve(); await child; await turn()
    assert.equal(drained, false, 'the parent still owns a future write')
    parentGate.resolve(); await parent; await drain
    assert.deepEqual(events, ['child', 'follow-up'])
    state.cleanup(() => events.push('cleanup'))
    assert.throws(() => state.run(() => {}), shutdown.ServerClosingError)
})

test('normal shutdown quiesces synchronously once and cancels no completed work', async () => {
    const gate = signal(), events = []
    const close = createGracefulShutdown({ timeoutMs: 180000, logger,
        quiesce: () => events.push('quiesce'), close: () => { events.push('close'); return gate.promise },
        cancel: () => assert.fail('premature cancellation'), terminate: async () => assert.fail('premature termination'),
        failed: error => assert.fail(String(error)),
    })
    const first = close('IPC'), duplicate = close('SIGBREAK')
    assert.strictEqual(first, duplicate)
    assert.deepEqual(events, ['quiesce', 'close'])
    gate.resolve(); await first
    assert.deepEqual(shutdownDeadlines(180000), { totalMs: 180000, cancelAtMs: 150000, terminateAtMs: 165000 })
})

test('short configured deadline reserves cooperative cancellation then waits for actual worker termination', async () => {
    const exited = signal(), events = []
    const close = createGracefulShutdown({ timeoutMs: 5000, logger,
        quiesce: () => events.push('quiesce'), close: () => exited.promise,
        cancel: () => events.push('cancel'), terminate: async () => { events.push('terminate'); await turn(); exited.resolve() },
        failed: error => assert.fail(String(error)),
    })
    await close('fixture')
    assert.deepEqual(events, ['quiesce', 'cancel', 'terminate'])
})

test('a quiesce exception still closes accepted work and follows the failure path', async () => {
    const events = [], fault = new Error('fixture readiness removal failed')
    const close = createGracefulShutdown({ timeoutMs: 5000, logger,
        quiesce: () => { events.push('quiesce'); throw fault }, close: async () => { events.push('close') },
        cancel: () => assert.fail('premature cancellation'), terminate: async () => assert.fail('premature termination'),
        failed: error => { assert.strictEqual(error, fault); events.push('failed') },
    })
    await close('fixture')
    assert.deepEqual(events, ['quiesce', 'close', 'failed'])
})

test('closing errors keep CN encoding and management 503 even with a nested route error handler', async () => {
    const { installPersistenceHttpErrors } = require('../out/lib/persistence-http-errors')
    const { installCnResponseEncoding } = require('../out/lib/cn-response-hook')
    const app = Fastify({ logger: false })
    installCnResponseEncoding(app); installPersistenceHttpErrors(app)
    app.post('/api/index.php/load', async () => { throw new shutdown.ServerClosingError() })
    app.register(async child => {
        child.setErrorHandler((error, _request, reply) => reply.send(error))
        child.post('/web/leaderboard', async () => { throw new shutdown.ServerClosingError() })
    })
    try {
        const game = await app.inject({ method: 'POST', url: '/api/index.php/load' })
        assert.equal(game.statusCode, 200)
        assert.equal(game.headers['retry-after'], '1')
        assert.equal(unpack(Buffer.from(game.body, 'base64')).data_headers.result_code, 516)
        const web = await app.inject({ method: 'POST', url: '/web/leaderboard' })
        assert.equal(web.statusCode, 503)
        assert.equal(web.headers['retry-after'], '1')
        assert.equal(web.json().code, 'SERVER_CLOSING')
    } finally { await app.close() }
})

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'server-shutdown-'))
process.env.DATA_DIR = dir
process.env.CN_WRITER_THREAD = '0'
const coordinator = require('../out/lib/persistence-coordinator')
const db = require('../out/data/db').getDb()
db.exec('CREATE TABLE shutdown_effects(value TEXT)')
after(async () => {
    coordinator.configurePersistenceSqlExecutor(null)
    await shutdown.drainServerWork(); await coordinator.drainPersistence()
    db.close()
    assert.equal(path.dirname(fs.realpathSync(dir)), fs.realpathSync(os.tmpdir()))
    fs.rmSync(dir, { recursive: true })
})

test('real coordinator drains queued and later accepted writes while all new entrances reject before SQL', async () => {
    const gate = signal(), entered = signal(), later = signal()
    coordinator.configurePersistenceSqlExecutor(async (_context, statements) => {
        entered.resolve(); await gate.promise
        db.prepare('INSERT INTO shutdown_effects VALUES(?)').run(statements[0].params[0])
    })
    const context = { domain: 'maintenance', operation: 'shutdown-fixture' }
    const first = coordinator.runPersistenceSqlCommand(context, [{ sql: 'fixture', params: ['first'] }], () => {})
    const queued = coordinator.runPersistenceSqlCommand(context, [{ sql: 'fixture', params: ['queued'] }], () => {})
    const followUp = shutdown.withServerWorkAdmission(async () => {
        await later.promise
        await coordinator.runPersistenceTransaction(context, () => {
            coordinator.runPersistenceTransactionSync(context, () => db.prepare('INSERT INTO shutdown_effects VALUES(?)').run('follow-up'))
        })
    })
    await entered.promise
    shutdown.beginServerShutdown()
    const reject = () => assert.fail('rejected SQL was executed')
    await assert.rejects(coordinator.runPersistenceTransaction(context, reject), { code: 'SERVER_CLOSING' })
    await assert.rejects(coordinator.runPersistenceSqlCommand(context, [], reject), { code: 'SERVER_CLOSING' })
    await assert.rejects(coordinator.runWriterCommand('must-not-resolve', {}, context), { code: 'SERVER_CLOSING' })
    await assert.rejects(coordinator.runBackgroundPersistenceTask(context, async () => reject(), reject), { code: 'SERVER_CLOSING' })
    assert.throws(() => coordinator.runPersistenceTransactionSync(context, reject), { code: 'SERVER_CLOSING' })
    const { runLeaderboardWork } = require('../out/lib/leaderboard/work-control')
    assert.throws(() => runLeaderboardWork.background('fixture', 'settle', async () => reject()), { code: 'SERVER_CLOSING' })
    let drained = false
    const drain = shutdown.drainServerWork().then(() => { drained = true })
    gate.resolve(); await Promise.all([first, queued]); await turn()
    assert.equal(drained, false)
    later.resolve(); await followUp; await drain; await coordinator.drainPersistence()
    assert.deepEqual(db.prepare('SELECT value FROM shutdown_effects ORDER BY rowid').all().map(row => row.value), ['first', 'queued', 'follow-up'])
})
