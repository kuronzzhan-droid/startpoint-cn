'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const { Worker } = require('node:worker_threads')
const { setTimeout: delay, setImmediate: nextTurn } = require('node:timers/promises')
const Database = require('better-sqlite3')

const MIB = 1024 ** 2, TARGET = 2 * MIB, STEP = MIB
const settingsEntry = require.resolve('../out/lib/sqlite-settings')
const settings = require(settingsEntry)
// Scale this process's imported constants before loading the real class/helper.
// No SQLite result, native operation or maintenance implementation is replaced.
const originalSettings = require.cache[settingsEntry].exports
require.cache[settingsEntry].exports = { ...settings,
    SQLITE_WAL_JOURNAL_SIZE_LIMIT_BYTES: TARGET, SQLITE_WAL_RECLAIM_STEP_BYTES: STEP }
const { createSqliteWalMaintenance } = require('../out/lib/sqlite-wal-maintenance')
const { persistenceWriteGate: gate } = require('../out/lib/persistence-write-gate')
const { nativeSqliteWrites: native } = require('../out/lib/sqlite-native-writes')
test.after(() => { require.cache[settingsEntry].exports = originalSettings })

const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
function wal(file) {
    const descriptor = fs.openSync(file + '-wal', 'r')
    try {
        const header = Buffer.alloc(32)
        assert.equal(fs.readSync(descriptor, header, 0, 32, 0), 32)
        return { bytes: fs.fstatSync(descriptor).size, generation: header.subarray(12, 24).toString('hex') }
    } finally { fs.closeSync(descriptor) }
}
function configure(db) {
    for (const sql of ['journal_mode=WAL', 'synchronous=FULL', 'busy_timeout=0',
        'wal_autocheckpoint=0', 'journal_size_limit=-1']) db.pragma(sql)
    return db
}
async function until(predicate, label) {
    const deadline = Date.now() + 10_000
    while (Date.now() < deadline) {
        const value = predicate()
        if (value) return value
        await delay(5)
    }
    assert.fail(`${label} timed out`)
}
function fixture(t, { small = false, keepReader = false } = {}) {
    assert.deepEqual(gate.stats(), { activeWrites: 0, exclusive: false, waiting: 0 })
    assert.equal(native.activeCount(), 0)
    const parent = path.resolve(process.env.SQLITE_WAL_MAINTENANCE_TMP_DIR || os.tmpdir())
    fs.mkdirSync(parent, { recursive: true })
    const directory = fs.mkdtempSync(path.join(parent, 'sp-wal-maintenance-'))
    const db = configure(new Database(path.join(directory, 'data.db')))
    const connections = [db], maintenance = [], releases = [], workers = []
    db.pragma('user_version=-173')
    db.exec('CREATE TABLE marker(id INTEGER PRIMARY KEY,value INTEGER NOT NULL); INSERT INTO marker VALUES(1,0); CREATE TABLE payload(id INTEGER PRIMARY KEY,data BLOB NOT NULL)')
    let payload = Buffer.alloc(64 * 1024, 1), reader
    db.prepare('INSERT INTO payload VALUES(1,?)').run(payload)
    const bulk = configure(new Database(db.name, { fileMustExist: true }))
    connections.push(bulk)
    if (!small) {
        const checkpoint = bulk.pragma('wal_checkpoint(PASSIVE)')[0]
        assert.equal(checkpoint.log, checkpoint.checkpointed)
        db.prepare('UPDATE payload SET data=? WHERE id=1').run(Buffer.alloc(64 * 1024, 2))
        reader = new Database(db.name, { readonly: true, fileMustExist: true })
        connections.push(reader)
        reader.exec('BEGIN')
        assert.equal(reader.prepare('SELECT value FROM marker').pluck().get(), 0)
        const generation = wal(db.name).generation
        const update = db.prepare('UPDATE payload SET data=? WHERE id=1')
        for (let round = 0; wal(db.name).bytes < 4 * MIB; round++) {
            payload = Buffer.alloc(64 * 1024, round + 3)
            update.run(payload)
        }
        assert.equal(wal(db.name).generation, generation)
        if (!keepReader) { reader.exec('ROLLBACK'); reader.close() }
    }
    const payloadHash = hash(payload), known = new Set(connections), events = []
    const trace = { passives: [], exec: [], fault: false, afterPassive: undefined }
    const nativePragma = Database.prototype.pragma, nativeExec = Database.prototype.exec
    let connection
    Database.prototype.pragma = function (...args) {
        if (known.has(this) || this.name !== db.name) return nativePragma.apply(this, args)
        connection ??= this
        if (this !== connection) return nativePragma.apply(this, args)
        if (trace.fault && /^user_version\s*=/i.test(args[0])) {
            // A genuine SQLite statement error after the real helper BEGIN.
            return nativeExec.call(this, 'INSERT INTO deliberately_missing_maintenance_table VALUES(1)')
        }
        const result = nativePragma.apply(this, args)
        if (/^wal_checkpoint\(PASSIVE\)$/i.test(args[0])) {
            events.push('final-passive')
            trace.passives.push({ result, wal: wal(db.name) })
            trace.afterPassive?.()
        }
        return result
    }
    Database.prototype.exec = function (sql) {
        if (this !== connection) return nativeExec.call(this, sql)
        const item = { sql, before: wal(db.name) }
        trace.exec.push(item)
        events.push(sql)
        try {
            const result = nativeExec.call(this, sql)
            item.succeeded = true
            item.after = wal(db.name)
            return result
        } catch (error) {
            item.succeeded = false
            item.code = error.code
            throw error
        }
    }
    t.after(async () => {
        try {
            for (const item of maintenance) item.close()
            for (const release of releases.reverse()) release()
            for (const item of workers) await item.close()
            await nextTurn()
            assert.equal(native.activeCount(), 0)
            assert.deepEqual(gate.stats(), { activeWrites: 0, exclusive: false, waiting: 0 })
        } finally {
            Database.prototype.pragma = nativePragma
            Database.prototype.exec = nativeExec
            for (const item of connections.reverse()) if (item.open) {
                if (item.inTransaction) item.exec('ROLLBACK')
                item.close()
            }
            assert.equal(path.dirname(path.resolve(directory)), parent)
            fs.rmSync(directory, { recursive: true })
        }
    })
    return {
        db, reader, trace, events, connection: () => connection,
        mark: () => db.prepare('UPDATE marker SET value=value+1 WHERE id=1').run(),
        bulk: () => bulk.pragma('wal_checkpoint(PASSIVE)')[0],
        async hold() { const release = await gate.acquire(false); releases.push(release); return release },
        ticket() { const release = native.acquire(); releases.push(release); return release },
        maintenance() {
            const results = [], errors = []
            const item = createSqliteWalMaintenance(db.name, result => {
                events.push('result')
                results.push({ ...result, gate: gate.stats(), nativeActive: native.activeCount() })
            }, error => {
                events.push('error')
                errors.push({ error, gate: gate.stats(), nativeActive: native.activeCount() })
            })
            maintenance.push(item)
            return { ...item, results, errors, async result(index = 0) {
                return until(() => {
                    assert.equal(errors.length, 0, errors[0]?.error?.stack)
                    return results[index]
                }, 'maintenance result')
            } }
        },
        async nativeWriter(mode, releaseTicket) {
            const worker = new Worker(`
                const { parentPort, workerData } = require('node:worker_threads')
                const Database = require(workerData.module)
                const db = new Database(workerData.file, { fileMustExist: true })
                db.pragma('journal_mode=WAL'); db.pragma('synchronous=FULL')
                db.pragma('wal_autocheckpoint=0'); db.pragma('journal_size_limit=-1')
                db.exec('BEGIN IMMEDIATE')
                db.prepare('UPDATE marker SET value=value+1 WHERE id=1').run()
                parentPort.postMessage('started')
                parentPort.on('message', message => {
                    if (message !== 'commit') return
                    db.exec('COMMIT'); parentPort.postMessage('ack')
                    db.close(); parentPort.close()
                })
            `, { eval: true, workerData: { module: require.resolve('better-sqlite3'), file: db.name } })
            let started = false, ack = false, exited = false, failure
            const closed = new Promise(resolve => worker.once('exit', () => {
                exited = true
                releaseTicket()
                resolve()
            }))
            worker.on('error', error => { failure = error })
            worker.on('message', message => {
                if (message === 'started') started = true
                if (message === 'ack') { ack = true; if (mode === 'ack') releaseTicket() }
            })
            const item = { worker, closed, ack: () => ack, exited: () => exited,
                commit: () => worker.postMessage('commit'),
                async close() { if (!exited) await worker.terminate(); await closed } }
            workers.push(item)
            await until(() => { if (failure) throw failure; return started }, 'native transaction started')
            return item
        },
        unchanged(marker = 0) {
            assert.equal(db.pragma('user_version', { simple: true }), -173)
            assert.equal(db.pragma('journal_size_limit', { simple: true }), -1)
            assert.equal(db.prepare('SELECT value FROM marker').pluck().get(), marker)
            assert.equal(hash(db.prepare('SELECT data FROM payload').pluck().get()), payloadHash)
            assert.equal(db.pragma('integrity_check', { simple: true }), 'ok')
            assert.deepEqual(db.pragma('foreign_key_check'), [])
        },
    }
}
function assertShrunk(f, result) {
    assert.equal(result.attempted, true)
    assert.equal(result.busy, false)
    assert.equal(result.resetObserved, true)
    assert.ok(result.reclaimedBytes > 0 && result.reclaimedBytes <= STEP)
    const commit = f.trace.exec.filter(item => item.sql === 'COMMIT').at(-1)
    assert.equal(commit.succeeded, true)
    assert.notEqual(commit.before.generation, commit.after.generation)
    assert.equal(commit.after.bytes, Math.max(TARGET, commit.before.bytes - STEP))
    assert.equal(result.reclaimedBytes, commit.before.bytes - commit.after.bytes)
    assert.equal(result.logFrames, result.checkpointedFrames)
    assert.equal(result.nativeActive, 0)
    assert.equal(f.connection().pragma('synchronous', { simple: true }), 2)
    assert.equal(f.connection().pragma('busy_timeout', { simple: true }), 0)
    assert.equal(f.connection().pragma('wal_autocheckpoint', { simple: true }), 0)
}

test('the real maintenance class waits for active writes and catches a tail committed after bulk PASSIVE', async t => {
    const f = fixture(t), maintenance = f.maintenance(), release = await f.hold()
    f.db.exec('BEGIN IMMEDIATE')
    const bulk = f.bulk()
    assert.equal(bulk.log, bulk.checkpointed)
    maintenance.request()
    assert.equal(f.trace.passives.length, 0)
    gate.assertSynchronousWriteAllowed()
    f.mark()
    f.db.exec('COMMIT')
    const before = wal(f.db.name)
    release()
    const result = await maintenance.result()
    assertShrunk(f, result)
    assert.equal(result.reclaimedBytes, STEP)
    assert.equal(result.walBytes, before.bytes - STEP)
    assert.equal(f.trace.passives.length, 1)
    f.unchanged(1)
})

test('an ordinary SQL microtask queued after final PASSIVE cannot run before helper COMMIT', async t => {
    const f = fixture(t), maintenance = f.maintenance()
    const bulk = f.bulk()
    assert.equal(bulk.log, bulk.checkpointed)
    let wrote = false
    f.trace.afterPassive = () => queueMicrotask(() => {
        gate.assertSynchronousWriteAllowed()
        f.events.push('microtask-write')
        f.mark(); wrote = true
    })
    maintenance.request()
    assert.equal(wrote, false)
    const result = await maintenance.result()
    assertShrunk(f, result)
    await nextTurn()
    assert.equal(wrote, true)
    assert.deepEqual(f.events, ['final-passive', 'BEGIN IMMEDIATE', 'COMMIT', 'result', 'microtask-write'])
    f.unchanged(1)
})

test('multiple requests while queued merge into one window and release at most one physical step', async t => {
    const f = fixture(t), maintenance = f.maintenance(), release = await f.hold()
    const before = wal(f.db.name)
    for (let index = 0; index < 20; index++) maintenance.request()
    assert.equal(gate.stats().waiting, 1)
    assert.equal(gate.stats().exclusive, false)
    release()
    assertShrunk(f, await maintenance.result())
    await nextTurn()
    assert.equal(maintenance.results.length, 1)
    assert.equal(f.trace.passives.length, 1)
    assert.equal(f.trace.exec.filter(item => item.sql === 'COMMIT').length, 1)
    assert.equal(before.bytes - wal(f.db.name).bytes, STEP)
    assert.ok(wal(f.db.name).bytes > TARGET, 'one request batch must not shrink every stage to the target')
    f.unchanged()
})

test('a fixed old reader safely delays reclamation and releasing it permits a later window', async t => {
    const f = fixture(t, { keepReader: true }), maintenance = f.maintenance(), before = wal(f.db.name)
    maintenance.request()
    const partial = await maintenance.result()
    assert.equal(partial.attempted, false)
    assert.equal(partial.reclaimedBytes, 0)
    assert.ok(partial.checkpointedFrames < partial.logFrames)
    assert.equal(f.trace.exec.length, 0)
    assert.equal(wal(f.db.name).bytes, before.bytes)
    assert.equal(f.reader.prepare('SELECT hex(substr(data,1,1)) FROM payload').pluck().get(), '02')
    f.reader.exec('ROLLBACK')
    await nextTurn()
    maintenance.request()
    assertShrunk(f, await maintenance.result(1))
    assert.equal(f.trace.passives.length, 2)
    f.unchanged()
})

test('native tickets postpone maintenance until an actual writer ACK or exit without an async exclusive window', async t => {
    for (const mode of ['ack', 'exit']) await t.test(mode, async subtest => {
        const f = fixture(subtest), maintenance = f.maintenance(), release = f.ticket()
        const writer = await f.nativeWriter(mode, release)
        maintenance.request()
        assert.equal(native.activeCount(), 1)
        assert.equal(gate.stats().exclusive, false)
        assert.equal(gate.stats().waiting, 0)
        assert.equal(maintenance.results.length, 0)
        assert.equal(f.db.prepare('SELECT value FROM marker').pluck().get(), 0)
        gate.assertSynchronousWriteAllowed()
        // A caller deadline does not release the native ticket.
        await Promise.reject(new Error('caller stopped waiting')).catch(() => {})
        assert.equal(native.activeCount(), 1)
        assert.equal(maintenance.results.length, 0)
        if (mode === 'ack') writer.commit()
        else await writer.close()
        const result = await maintenance.result()
        assertShrunk(f, result)
        assert.equal(mode === 'ack' ? writer.ack() : writer.exited(), true)
        await writer.closed
        f.unchanged(mode === 'ack' ? 1 : 0)
    })
})

test('close cancels queued work and unsubscribes native-idle notification before any maintenance SQL', async t => {
    const f = fixture(t), queued = f.maintenance(), releaseGate = await f.hold(), before = wal(f.db.name)
    queued.request()
    queued.close()
    releaseGate()
    await nextTurn()
    assert.equal(queued.results.length, 0)
    assert.equal(queued.errors.length, 0)
    assert.equal(f.connection(), undefined)
    const idle = f.maintenance(), releaseNative = f.ticket()
    idle.request()
    idle.close()
    releaseNative()
    await nextTurn()
    idle.request()
    assert.equal(idle.results.length, 0)
    assert.equal(idle.errors.length, 0)
    assert.equal(f.trace.passives.length, 0)
    assert.equal(f.connection(), undefined)
    assert.equal(wal(f.db.name).bytes, before.bytes)
    f.unchanged()
})

test('a genuine SQL error rolls back the helper and reports only after the gate is released', async t => {
    const f = fixture(t), maintenance = f.maintenance()
    f.trace.fault = true
    maintenance.request()
    const failure = await until(() => maintenance.errors[0], 'native SQL failure')
    assert.equal(failure.error.code, 'SQLITE_ERROR')
    assert.match(failure.error.message, /no such table/i)
    assert.equal(failure.gate.exclusive, false)
    assert.equal(f.connection().inTransaction, false)
    assert.deepEqual(f.trace.exec.map(item => item.sql), ['BEGIN IMMEDIATE', 'ROLLBACK'])
    assert.equal(f.trace.exec[1].succeeded, true)
    gate.assertSynchronousWriteAllowed()
    f.mark()
    f.unchanged(1)
    f.trace.fault = false
    await nextTurn()
    maintenance.request()
    assertShrunk(f, await until(() => maintenance.results[0], 'recovery after native SQL failure'))
    assert.equal(maintenance.errors.length, 1)
    f.unchanged(1)
})

test('a below-target WAL opens no maintenance connection and starts no write transaction', async t => {
    const f = fixture(t, { small: true }), maintenance = f.maintenance(), before = wal(f.db.name)
    assert.ok(before.bytes < TARGET)
    maintenance.request()
    await nextTurn()
    assert.equal(maintenance.results.length, 0)
    assert.equal(maintenance.errors.length, 0)
    assert.equal(f.connection(), undefined)
    assert.equal(wal(f.db.name).bytes, before.bytes)
    f.unchanged()
})
