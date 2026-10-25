'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { Worker } = require('node:worker_threads')
const { setTimeout: delay } = require('node:timers/promises')
const Database = require('better-sqlite3')
const {
    SQLITE_WAL_JOURNAL_SIZE_LIMIT_BYTES,
    SQLITE_WAL_RECLAIM_STEP_BYTES,
    applySqliteSettings,
    applySqliteWalSizeLimit,
} = require('../out/lib/sqlite-settings.js')
const { openWriterConnection } = require('../out/lib/persistence/writer-connection.js')

const GIB = 1024 * 1024 * 1024
const SCALED_LIMIT = 256 * 1024
const root = path.resolve(__dirname, '..')

function isolated(t) {
    const parent = path.join(root, 'tmp')
    fs.mkdirSync(parent, { recursive: true })
    const directory = fs.mkdtempSync(path.join(parent, 'sqlite-wal-reclamation-'))
    const connections = []
    const workers = []
    t.after(async () => {
        try {
            for (const worker of workers.reverse()) await worker.close()
        } finally {
            for (const database of connections.reverse()) {
                if (!database.open) continue
                if (database.inTransaction) database.exec('ROLLBACK')
                database.close()
            }
            assert.equal(path.dirname(path.resolve(directory)), parent)
            fs.rmSync(directory, { recursive: true })
        }
    })
    return {
        directory,
        keep(database) { connections.push(database); return database },
        worker(entry, input) {
            const worker = observeWorker(entry, input)
            workers.push(worker)
            return worker
        },
    }
}

function createDatabase(scope, name = 'data.db') {
    const db = scope.keep(new Database(path.join(scope.directory, name)))
    db.pragma('page_size = 4096')
    db.pragma('journal_mode = WAL')
    db.pragma('synchronous = FULL')
    db.pragma('wal_autocheckpoint = 0')
    db.exec('CREATE TABLE payloads(id INTEGER PRIMARY KEY, data BLOB NOT NULL)')
    db.prepare('INSERT INTO payloads VALUES(0, ?)').run(Buffer.alloc(3800, 1))
    return db
}

function appendBacklog(db) {
    const insert = db.prepare('INSERT INTO payloads VALUES(?, ?)')
    const payload = Buffer.alloc(3800, 7)
    db.transaction(() => {
        for (let id = 1; id <= 1300; id++) insert.run(id, payload)
    }).immediate()
    const bytes = walBytes(db)
    assert.ok(bytes >= 4 * 1024 * 1024, `expected an oversized WAL, got ${bytes}`)
    return bytes
}

function walBytes(db) {
    return fs.statSync(db.name + '-wal').size
}

function walGeneration(db) {
    const descriptor = fs.openSync(db.name + '-wal', 'r')
    try {
        const header = Buffer.alloc(32)
        assert.equal(fs.readSync(descriptor, header, 0, header.length, 0), header.length)
        return header.subarray(12, 24).toString('hex')
    } finally { fs.closeSync(descriptor) }
}

function passive(db) {
    const result = db.pragma('wal_checkpoint(PASSIVE)')[0]
    assert.equal(result.busy, 0)
    return result
}

function assertFullyBackfilled(db) {
    const result = passive(db)
    assert.ok(result.log > 0)
    assert.equal(result.checkpointed, result.log)
    return result
}

// Observe a real worker's actual connection without replacing SQLite results
// or adding a diagnostic message to the production worker implementation.
function observeWorker(entry, input) {
    const worker = new Worker(`
        const { parentPort, workerData } = require('node:worker_threads')
        const Database = require(workerData.testDatabaseModule)
        const original = Database.prototype.pragma
        let connection
        Database.prototype.pragma = function (...args) {
            connection = this
            return original.apply(this, args)
        }
        try { require(workerData.testEntry) }
        finally { Database.prototype.pragma = original }
        if (!connection) throw new Error('Worker did not initialize a SQLite connection')
        parentPort.postMessage({
            type: 'test_connection_policy',
            databasePath: connection.name,
            limit: connection.pragma('journal_size_limit', { simple: true }),
            synchronous: connection.pragma('synchronous', { simple: true }),
            busyTimeoutMs: connection.pragma('busy_timeout', { simple: true }),
        })
    `, {
        eval: true,
        workerData: {
            ...input,
            testDatabaseModule: require.resolve('better-sqlite3'),
            testEntry: path.join(root, 'out', 'workers', entry),
        },
    })
    const messages = []
    let failure
    let exited = false
    worker.on('message', message => messages.push(message))
    worker.on('error', error => { failure = error })
    worker.once('exit', code => {
        exited = true
        if (code !== 0 && !failure) failure = new Error(`Worker exited with code ${code}`)
    })
    async function waitFor(predicate, label) {
        const deadline = Date.now() + 10_000
        while (Date.now() < deadline) {
            if (failure) throw failure
            const message = messages.find(predicate)
            if (message) return message
            if (exited) assert.fail(`Worker exited before ${label}`)
            await delay(10)
        }
        assert.fail(`${label} timed out: ${JSON.stringify(messages)}`)
    }
    return {
        worker,
        waitFor,
        async close() {
            if (exited) return
            try {
                worker.postMessage({ type: 'close' })
                await waitFor(message => message.type === 'closed', 'worker close')
            } finally { await worker.terminate() }
        },
    }
}

test('production WAL policy retains a 2 GiB target and 1 GiB step while ordinary writers leave reclamation to maintenance', t => {
    const scope = isolated(t)
    const db = createDatabase(scope)
    const peer = scope.keep(new Database(db.name))
    const reader = scope.keep(new Database(db.name, { readonly: true, fileMustExist: true }))
    reader.pragma('query_only = ON')
    const peerBefore = peer.pragma('journal_size_limit', { simple: true })
    const readerBefore = reader.pragma('journal_size_limit', { simple: true })
    const readerSynchronous = reader.pragma('synchronous', { simple: true })

    assert.equal(SQLITE_WAL_JOURNAL_SIZE_LIMIT_BYTES, 2 * GIB)
    assert.equal(SQLITE_WAL_RECLAIM_STEP_BYTES, GIB)
    applySqliteSettings(db)
    assert.equal(db.pragma('journal_size_limit', { simple: true }), -1)
    assert.equal(peer.pragma('journal_size_limit', { simple: true }), peerBefore,
        'one connection must not silently configure another connection')
    applySqliteWalSizeLimit(peer)
    assert.equal(peer.pragma('journal_size_limit', { simple: true }), -1)

    applySqliteSettings(reader, true)
    assert.equal(reader.pragma('journal_size_limit', { simple: true }), readerBefore)
    assert.equal(reader.pragma('synchronous', { simple: true }), readerSynchronous)
    assert.equal(reader.pragma('query_only', { simple: true }), 1)
    assert.equal(reader.prepare('SELECT count(*) FROM payloads').pluck().get(), 1)
})

test('the real writer connection factory applies the policy again when a connection is reopened', t => {
    const scope = isolated(t)
    const databasePath = path.join(scope.directory, 'writer.db')
    const open = () => scope.keep(openWriterConnection({ databasePath, busyTimeoutMs: 0 }))
    const first = open()
    assert.equal(first.pragma('journal_size_limit', { simple: true }), -1)
    first.exec('CREATE TABLE ledger(id INTEGER PRIMARY KEY, value TEXT NOT NULL)')
    first.prepare('INSERT INTO ledger VALUES(1, ?)').run('preserved')
    first.close()
    const second = open()
    assert.equal(second.pragma('journal_size_limit', { simple: true }), -1)
    assert.equal(second.prepare('SELECT value FROM ledger WHERE id=1').pluck().get(), 'preserved')
})

test('native fixed-limit control: reclamation waits for a natural reset and the setting is connection-local', t => {
    const scope = isolated(t)
    const db = createDatabase(scope)
    const oversizedBytes = appendBacklog(db)
    const peer = scope.keep(new Database(db.name))
    peer.pragma('wal_autocheckpoint = 0')
    peer.pragma('journal_size_limit = -1')
    db.pragma(`journal_size_limit = ${SCALED_LIMIT}`)
    assert.equal(walBytes(db), oversizedBytes, 'setting the limit must not immediately truncate an active WAL')
    assertFullyBackfilled(db)
    assert.equal(walBytes(db), oversizedBytes, 'PASSIVE backfill must not force physical truncation')

    const oldGeneration = walGeneration(db)
    peer.prepare('UPDATE payloads SET data=? WHERE id=0').run(Buffer.alloc(3800, 20))
    assert.notEqual(walGeneration(db), oldGeneration, 'the second writer should naturally reset the WAL')
    assert.equal(walBytes(db), oversizedBytes,
        'a writer without the policy retains high water even when another connection is configured')

    peer.pragma(`journal_size_limit = ${SCALED_LIMIT}`)
    assertFullyBackfilled(peer)
    const beforeReclamation = walGeneration(db)
    peer.prepare('UPDATE payloads SET data=? WHERE id=0').run(Buffer.alloc(3800, 21))
    assert.notEqual(walGeneration(db), beforeReclamation)
    assert.ok(walBytes(db) <= SCALED_LIMIT, 'the first small commit after reset should reclaim unused WAL space')
    assert.equal(db.prepare('SELECT count(*) FROM payloads').pluck().get(), 1301)
    assert.deepEqual(db.prepare('SELECT data FROM payloads WHERE id=0').pluck().get(), Buffer.alloc(3800, 21))
    assert.equal(db.pragma('quick_check', { simple: true }), 'ok')
})

test('native fixed-limit control: pinned readers and oversized transactions remain safe above a soft target', t => {
    const scope = isolated(t)
    const db = createDatabase(scope)
    db.pragma(`journal_size_limit = ${SCALED_LIMIT}`)
    const reader = scope.keep(new Database(db.name, { readonly: true, fileMustExist: true }))
    reader.pragma('query_only = ON')
    reader.exec('BEGIN')
    assert.equal(reader.prepare('SELECT count(*) FROM payloads').pluck().get(), 1)
    assert.deepEqual(reader.prepare('SELECT data FROM payloads WHERE id=0').pluck().get(), Buffer.alloc(3800, 1))

    const oversizedBytes = appendBacklog(db)
    assert.ok(oversizedBytes > SCALED_LIMIT, 'the retention target must not cap a live transaction')
    const checkpoint = passive(db)
    assert.ok(checkpoint.checkpointed < checkpoint.log, 'the old snapshot should prevent complete backfill')
    db.prepare('INSERT INTO payloads VALUES(1301, ?)').run(Buffer.alloc(3800, 30))
    assert.ok(walBytes(db) >= oversizedBytes, 'a pinned snapshot must not be truncated to the target')
    assert.equal(reader.prepare('SELECT count(*) FROM payloads').pluck().get(), 1)
    assert.equal(db.prepare('SELECT count(*) FROM payloads').pluck().get(), 1302)

    reader.exec('COMMIT')
    assertFullyBackfilled(db)
    assert.equal(reader.prepare('SELECT count(*) FROM payloads').pluck().get(), 1302)
    const oldGeneration = walGeneration(db)
    db.prepare('UPDATE payloads SET data=? WHERE id=0').run(Buffer.alloc(3800, 31))
    assert.notEqual(walGeneration(db), oldGeneration)
    assert.ok(walBytes(db) <= SCALED_LIMIT)
    assert.deepEqual(reader.prepare('SELECT data FROM payloads WHERE id=0').pluck().get(), Buffer.alloc(3800, 31))
    assert.equal(db.prepare('SELECT count(*) FROM payloads').pluck().get(), 1302)
    assert.equal(db.pragma('quick_check', { simple: true }), 'ok')
})

test('the real checkpoint worker keeps FULL durability and timeout zero while small WAL files only need PASSIVE', async t => {
    const scope = isolated(t)
    const db = createDatabase(scope)
    appendBacklog(db)
    const before = walBytes(db)
    const running = scope.worker('sqlite-checkpoint-worker.js', {
        databasePath: db.name,
        intervalMs: 3_600_000,
        busyTimeoutMs: 5000,
    })
    const policy = await running.waitFor(message => message.type === 'test_connection_policy', 'checkpoint connection policy')
    assert.equal(policy.limit, -1)
    assert.equal(policy.synchronous, 2)
    assert.equal(policy.busyTimeoutMs, 0, 'maintenance must not inherit a nonzero lock wait')
    assert.equal(path.resolve(policy.databasePath), path.resolve(db.name))
    const result = await running.waitFor(message => message.type === 'checkpoint', 'PASSIVE checkpoint')
    assert.equal(result.mode, 'passive')
    assert.equal(result.truncateAttempted, false)
    assert.equal(result.checkpointedFrames, result.logFrames)
    assert.equal(result.reclaimAttempted, false)
    assert.equal(result.reclaimBusy, false)
    assert.equal(result.reclaimedBytes, 0)
    assert.equal(walBytes(db), before, 'the checkpoint itself must not force reclamation')
    assert.equal(db.prepare('SELECT count(*) FROM payloads').pluck().get(), 1301)
})

test('the real persistence worker leaves reclamation to maintenance and preserves committed and rolled-back writes', async t => {
    const scope = isolated(t)
    const db = createDatabase(scope)
    const running = scope.worker('sqlite-persistence-worker.js', {
        databasePath: db.name,
        busyTimeoutMs: 0,
        maxAttempts: 1,
        settings: { synchronous: 'FULL', cacheKiB: 2048, mmapBytes: 0 },
    })
    const policy = await running.waitFor(message => message.type === 'test_connection_policy', 'persistence connection policy')
    assert.equal(policy.limit, -1)
    assert.equal(path.resolve(policy.databasePath), path.resolve(db.name))
    running.worker.postMessage({
        id: 1,
        operation: 'wal_reclamation_success',
        statements: [{ sql: 'INSERT INTO payloads VALUES(1, ?)', params: [Buffer.alloc(3800, 40)] }],
    })
    const completed = await running.waitFor(message => message.type === 'result' && message.id === 1, 'committed write')
    assert.equal(completed.changes, 1)
    running.worker.postMessage({
        id: 2,
        operation: 'wal_reclamation_rollback',
        statements: [
            { sql: 'INSERT INTO payloads VALUES(2, ?)', params: [Buffer.alloc(3800, 41)] },
            { sql: 'INSERT INTO absent_table VALUES(1)', params: [] },
        ],
    })
    const failed = await running.waitFor(message => message.type === 'error' && message.id === 2, 'rolled-back write')
    assert.match(failed.error, /absent_table/)
    assert.equal(db.prepare('SELECT count(*) FROM payloads').pluck().get(), 2)
    assert.equal(db.prepare('SELECT count(*) FROM payloads WHERE id=2').pluck().get(), 0)
    assert.deepEqual(db.prepare('SELECT data FROM payloads WHERE id=1').pluck().get(), Buffer.alloc(3800, 40))
    assert.equal(db.pragma('quick_check', { simple: true }), 'ok')
})
