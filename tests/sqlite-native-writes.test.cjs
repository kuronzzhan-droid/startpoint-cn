'use strict'

const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const threads = require('node:worker_threads')
const Database = require('better-sqlite3')

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-native-writes-'))
process.env.DATA_DIR = directory
const extraCommands = path.join(directory, 'native-test-commands.cjs')
process.env.SQLITE_WRITER_EXTRA_COMMANDS = extraCommands

const actualWorker = threads.Worker
const workers = []
threads.Worker = class ObservedWorker extends actualWorker {
    constructor(...args) {
        super(...args)
        const record = { worker: this, filename: String(args[0]), exited: false }
        record.exit = new Promise(resolve => this.once('exit', code => {
            record.exited = true
            record.exitCode = code
            resolve(code)
        }))
        workers.push(record)
    }
}

const { nativeSqliteWrites, createNativeSqliteWriteRegistry } = require('../out/lib/sqlite-native-writes')
const writer = require('../out/lib/persistence/writer-client')
const persistence = require('../out/lib/sqlite-persistence-worker')
const commandRegistry = path.resolve(__dirname, '../out/lib/persistence/command-registry.js')
const dbModule = path.resolve(__dirname, '../out/data/db.js')
fs.writeFileSync(extraCommands, [
    `const { registerWriterCommand } = require(${JSON.stringify(commandRegistry)})`,
    `const { getDb } = require(${JSON.stringify(dbModule)})`,
    `registerWriterCommand('native.insert', args => {`,
    `  getDb().prepare('INSERT INTO ledger(value) VALUES (?)').run(args.value)`,
    `  return args.value`,
    `})`,
    `registerWriterCommand('native.slow_sql', args => {`,
    `  Atomics.store(new Int32Array(args.started), 0, 1)`,
    `  getDb().prepare('WITH RECURSIVE n(x) AS (VALUES(0) UNION ALL SELECT x+1 FROM n WHERE x<5000000) SELECT sum(x) FROM n').get()`,
    `  getDb().prepare('INSERT INTO ledger(value) VALUES (?)').run('after-slow-sql')`,
    `  return true`,
    `})`,
].join('\n'))

const environment = timeout => ({
    CN_WRITER_THREAD: '1', SQLITE_GROUP_COMMIT_WINDOW_MS: '0', SQLITE_GROUP_COMMIT_MAX: '1',
    SQLITE_WRITER_MAX_IN_FLIGHT: '2', SQLITE_WRITER_BUSY_TIMEOUT_MS: '0',
    SQLITE_WRITER_COMMAND_TIMEOUT_MS: String(timeout), SQLITE_WRITER_MAX_RESTARTS: '0',
})
function makeDatabase(name) {
    const file = path.join(directory, name + '.db')
    const db = new Database(file)
    db.pragma('journal_mode=WAL')
    db.exec('CREATE TABLE ledger(id INTEGER PRIMARY KEY,value TEXT NOT NULL)')
    db.close()
    return file
}
async function until(predicate, message, timeout = 30_000) {
    const deadline = Date.now() + timeout
    while (!predicate()) {
        if (Date.now() >= deadline) assert.fail(message)
        await new Promise(resolve => setTimeout(resolve, 10))
    }
}
function command(name, args) {
    return writer.executeSqliteWriterCommand({ name, args, meta: { domain: 'player', operation: name } })
}

after(async () => {
    // Exit actual threads first, including any test that failed before its ACK.
    await Promise.all(workers.filter(record => !record.exited).map(record => record.worker.terminate()))
    await writer.stopSqliteWriter()
    await persistence.stopSqlitePersistenceWorker()
    threads.Worker = actualWorker
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()))
    fs.rmSync(directory, { recursive: true })
})

test('native write tickets are idempotent and signal idle only after the last release', () => {
    const registry = createNativeSqliteWriteRegistry()
    let idle = 0
    const unsubscribe = registry.onIdle(() => { idle++ })
    const first = registry.acquire(), second = registry.acquire()
    first(); first()
    assert.equal(registry.activeCount(), 1)
    assert.equal(idle, 0)
    second()
    assert.equal(registry.activeCount(), 0)
    assert.equal(idle, 1)
    unsubscribe()
    registry.acquire()()
    assert.equal(idle, 1)
})

test('writer tickets end at real result/error ACK and undelivered clone failure', async () => {
    const file = makeDatabase('writer-acks')
    assert.equal(writer.startSqliteWriter(file, environment(0)), true)
    assert.equal(nativeSqliteWrites.activeCount(), 1, 'spawn is native initialization, not idle')
    assert.equal(await writer.waitForSqliteWriterReady(30_000), true)
    assert.equal(nativeSqliteWrites.activeCount(), 0)
    assert.equal(await command('native.insert', { value: 'committed' }), 'committed')
    assert.equal(nativeSqliteWrites.activeCount(), 0)
    await assert.rejects(command('native.unknown', {}), /unknown|registered/i)
    assert.equal(nativeSqliteWrites.activeCount(), 0)
    await assert.rejects(command('native.insert', { value: () => 'not-cloneable' }), /clone/i)
    assert.equal(nativeSqliteWrites.activeCount(), 0, 'a synchronous post failure never reached SQLite')
    await writer.stopSqliteWriter()
    assert.equal(nativeSqliteWrites.activeCount(), 0)
})

test('writer caller timeout and rejectAll retain native tickets until actual thread exit', async () => {
    const file = makeDatabase('writer-timeout'), started = new SharedArrayBuffer(4)
    assert.equal(writer.startSqliteWriter(file, environment(50)), true)
    assert.equal(await writer.waitForSqliteWriterReady(30_000), true)
    const record = workers.at(-1)
    const slow = command('native.slow_sql', { started })
    const abandoned = command('native.insert', { value: 'must-not-dispatch-after-timeout' })
    const outcomes = Promise.allSettled([slow, abandoned])
    await until(() => Atomics.load(new Int32Array(started), 0) === 1, 'native SQL command did not start')
    const results = await outcomes
    assert.equal(results[0].status, 'rejected')
    assert.equal(results[0].reason.code, 'SQLITE_WRITER_TIMEOUT')
    assert.equal(results[1].status, 'rejected')
    assert.equal(writer.sqliteWriterQueueDepth(), 0, 'caller-facing promises have been removed')
    assert.equal(record.exited, false, 'the real worker is still inside native SQL')
    assert(nativeSqliteWrites.activeCount() >= 2, 'both posted commands remain tracked after caller rejection')
    await record.exit
    assert.equal(nativeSqliteWrites.activeCount(), 0, 'exit closes native handles and releases abandoned tickets')
    const db = new Database(file)
    try { assert.equal(db.prepare('SELECT count(*) n FROM ledger').get().n, 0) }
    finally { db.close() }
    await writer.stopSqliteWriter()
})

test('a real late ACK releases native work after its caller and worker have been detached', async () => {
    const file = makeDatabase('writer-late-ack'), started = new SharedArrayBuffer(4)
    writer.startSqliteWriter(file, environment(50))
    assert.equal(await writer.waitForSqliteWriterReady(30_000), true)
    const record = workers.at(-1), originalPost = record.worker.postMessage
    const originalTerminate = record.worker.terminate, originalTimeout = global.setTimeout
    let terminateRequests = 0, resolveTermination, stopping
    const termination = new Promise(resolve => { resolveTermination = resolve })
    // Fault injection delays thread termination and loses only the close
    // control message. The original worker still executes and commits real SQL.
    record.worker.terminate = () => { terminateRequests++; return termination }
    record.worker.postMessage = function (message, ...args) {
        if (message?.type !== 'close') return originalPost.call(this, message, ...args)
    }
    const ack = new Promise(resolve => record.worker.on('message', message => {
        if (message?.type === 'result') resolve(message)
    }))
    try {
        const pending = command('native.slow_sql', { started })
        const rejected = assert.rejects(pending, error => error.code === 'SQLITE_WRITER_TIMEOUT')
        await until(() => Atomics.load(new Int32Array(started), 0) === 1, 'late-ACK SQL did not start')
        await rejected
        assert(nativeSqliteWrites.activeCount() > 0)
        // Shorten only stop's lost-close reply deadline, not SQL or command
        // execution. Its second terminate request occurs after worker=null.
        global.setTimeout = (callback, ms, ...args) => originalTimeout(callback, ms === 5000 ? 10 : ms, ...args)
        stopping = writer.stopSqliteWriter()
        await until(() => terminateRequests >= 2, 'stop did not detach the worker')
        global.setTimeout = originalTimeout
        assert.equal(record.exited, false)
        await ack
        assert.equal(nativeSqliteWrites.activeCount(), 0, 'old real ACK is processed before current-worker and pending guards')
        assert.equal(record.exited, false, 'ACK, rather than exit, released the ticket')
        const verify = new Database(file)
        try { assert.equal(verify.prepare('SELECT count(*) n FROM ledger').get().n, 1) }
        finally { verify.close() }
    } finally {
        global.setTimeout = originalTimeout
        record.worker.postMessage = originalPost
        record.worker.terminate = originalTerminate
        const code = await actualWorker.prototype.terminate.call(record.worker)
        resolveTermination(code)
        if (stopping) await stopping
    }
    assert.equal(nativeSqliteWrites.activeCount(), 0)
})

test('SQL dispatcher releases final ACK and failed post tickets', async () => {
    const file = makeDatabase('sql-acks')
    assert.equal(persistence.startSqlitePersistenceWorker(file, { SQLITE_PERSISTENCE_WORKER: '1' }), true)
    assert.equal(nativeSqliteWrites.activeCount(), 1)
    const first = persistence.executeSqlitePersistenceCommand({ operation: 'insert', statements: [
        { sql: 'INSERT INTO ledger(value) VALUES (?)', params: ['committed'] },
    ] })
    assert.equal((await first).changes, 1)
    assert.equal(nativeSqliteWrites.activeCount(), 0)
    await assert.rejects(persistence.executeSqlitePersistenceCommand({ operation: 'rollback', statements: [
        { sql: 'INSERT INTO ledger(value) VALUES (?)', params: ['rolled-back'] },
        { sql: 'INSERT INTO missing_table VALUES (?)', params: [1] },
    ] }), /missing_table/)
    assert.equal(nativeSqliteWrites.activeCount(), 0)
    await assert.rejects(persistence.executeSqlitePersistenceCommand({ operation: 'clone-failure', statements: [
        { sql: 'INSERT INTO ledger(value) VALUES (?)', params: [() => 'not-cloneable'] },
    ] }), /clone/i)
    assert.equal(nativeSqliteWrites.activeCount(), 0)
    await persistence.stopSqlitePersistenceWorker()
})

test('SQL dispatcher error does not report native idle before a detached worker exits', async () => {
    const invalidDatabase = path.join(directory, 'directory-is-not-a-database')
    fs.mkdirSync(invalidDatabase)
    assert.equal(persistence.startSqlitePersistenceWorker(invalidDatabase, { SQLITE_PERSISTENCE_WORKER: '1' }), true)
    const record = workers.at(-1)
    let activeAtError, exitedAtError, stop
    record.worker.on('error', () => {
        // Registered after the real dispatcher's error handler/rejectAll.
        activeAtError = nativeSqliteWrites.activeCount()
        exitedAtError = record.exited
        stop = persistence.stopSqlitePersistenceWorker()
    })
    await assert.rejects(persistence.executeSqlitePersistenceCommand({ operation: 'startup-failure', statements: [
        { sql: 'SELECT 1', params: [] },
    ] }))
    assert.equal(exitedAtError, false)
    assert(activeAtError >= 1, 'worker error/rejectAll is not native exit')
    await record.exit
    await stop
    assert.equal(nativeSqliteWrites.activeCount(), 0, 'exit cleanup runs even after stop detached current worker')
})
