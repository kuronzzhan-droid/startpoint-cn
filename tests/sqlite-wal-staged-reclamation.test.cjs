'use strict'
process.env.SQLITE_DIAGNOSTICS = 'true'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { setTimeout: delay } = require('node:timers/promises')
const Database = require('better-sqlite3')
const settings = require('../out/lib/sqlite-settings.js')

const root = path.resolve(__dirname, '..')
const GIB = 1024 ** 3
const FINAL = 256 * 1024
const STEP = 512 * 1024
const realTarget = settings.SQLITE_WAL_JOURNAL_SIZE_LIMIT_BYTES
const realStep = settings.SQLITE_WAL_RECLAIM_STEP_BYTES
assert.equal(realTarget, 2 * GIB)
assert.equal(realStep, GIB)
// Scale only this isolated test process before loading the actual helper.
// The precise production constants are checked above and in the policy suite.
settings.SQLITE_WAL_JOURNAL_SIZE_LIMIT_BYTES = FINAL
settings.SQLITE_WAL_RECLAIM_STEP_BYTES = STEP
const { reclaimSqliteWalSpace } = require('../out/lib/sqlite-wal-reclamation.js')
test.after(() => {
    settings.SQLITE_WAL_JOURNAL_SIZE_LIMIT_BYTES = realTarget
    settings.SQLITE_WAL_RECLAIM_STEP_BYTES = realStep
})

function hash(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex') }
function wal(db) {
    const descriptor = fs.openSync(db.name + '-wal', 'r')
    try {
        const header = Buffer.alloc(32)
        assert.equal(fs.readSync(descriptor, header, 0, 32, 0), 32)
        return { bytes: fs.fstatSync(descriptor).size, generation: header.subarray(12, 24).toString('hex') }
    } finally { fs.closeSync(descriptor) }
}
function passive(db, complete = true) {
    const result = db.pragma('wal_checkpoint(PASSIVE)')[0]
    assert.equal(result.busy, 0)
    if (complete) assert.equal(result.log, result.checkpointed)
    return result
}
function fixture(t) {
    const parent = path.join(root, 'tmp')
    fs.mkdirSync(parent, { recursive: true })
    const directory = fs.mkdtempSync(path.join(parent, 'sqlite-wal-staged-'))
    const connections = [], workers = []
    t.after(async () => {
        try { for (const worker of workers.reverse()) await worker.close() }
        finally {
            for (const db of connections.reverse()) if (db.open) {
                if (db.inTransaction) db.exec('ROLLBACK')
                db.close()
            }
            assert.equal(path.dirname(path.resolve(directory)), parent)
            fs.rmSync(directory, { recursive: true })
        }
    })
    function keep(db) { connections.push(db); return db }
    function configure(db) {
        settings.applySqliteWalSizeLimit(db)
        db.pragma('synchronous = FULL')
        db.pragma('busy_timeout = 0')
        db.pragma('wal_autocheckpoint = 0')
        return db
    }
    const db = configure(keep(new Database(path.join(directory, 'data.db'))))
    db.pragma('journal_mode = WAL')
    db.pragma('user_version = -173')
    db.exec('CREATE TABLE marker(id INTEGER PRIMARY KEY, value INTEGER NOT NULL); INSERT INTO marker VALUES(1, 0); CREATE TABLE payload(id INTEGER PRIMARY KEY, data BLOB NOT NULL)')
    const initial = crypto.randomBytes(64 * 1024)
    db.prepare('INSERT INTO payload VALUES(1, ?)').run(initial)
    let latestHash = hash(initial)
    function peer() { return configure(keep(new Database(db.name, { fileMustExist: true }))) }
    function mark(connection = db) { connection.prepare('UPDATE marker SET value=value+1 WHERE id=1').run() }
    function grow(keepReader = false) {
        passive(db); mark()
        const reader = keep(new Database(db.name, { readonly: true, fileMustExist: true }))
        reader.exec('BEGIN')
        const pinnedValue = reader.prepare('SELECT value FROM marker').pluck().get()
        const pinnedHash = hash(reader.prepare('SELECT data FROM payload').pluck().get())
        const update = db.prepare('UPDATE payload SET data=? WHERE id=1')
        const generation = wal(db).generation
        while (wal(db).bytes < 4 * 1024 ** 2) {
            const data = crypto.randomBytes(64 * 1024)
            update.run(data); latestHash = hash(data)
        }
        assert.equal(wal(db).generation, generation)
        const checkpoint = passive(db, false)
        assert.ok(checkpoint.checkpointed < checkpoint.log)
        assert.equal(reader.prepare('SELECT value FROM marker').pluck().get(), pinnedValue)
        assert.equal(hash(reader.prepare('SELECT data FROM payload').pluck().get()), pinnedHash)
        if (!keepReader) { reader.exec('ROLLBACK'); reader.close(); passive(db) }
        return { reader, pinnedValue, pinnedHash }
    }
    function unchanged() {
        assert.equal(db.pragma('user_version', { simple: true }), -173)
        assert.equal(hash(db.prepare('SELECT data FROM payload').pluck().get()), latestHash)
        assert.equal(db.pragma('integrity_check', { simple: true }), 'ok')
    }
    return {
        db, peer, mark, grow, unchanged,
        worker(intervalMs) {
            const worker = checkpointWorker(db.name, intervalMs)
            workers.push(worker)
            return worker
        },
    }
}

// Exercise the real parent controller: bulk PASSIVE belongs to its worker,
// and the final maintenance connection belongs to this main thread. These
// observations are controller counter deltas, not fabricated SQLite returns.
function checkpointWorker(databasePath, intervalMs = 3_600_000) {
    const checkpoint = require('../out/lib/sqlite-checkpoint-worker.js')
    const { collectMemoryDiagnostics } = require('../out/lib/memory-diagnostics.js')
    const current = () => collectMemoryDiagnostics().counters.sqliteCheckpoint
    const initial = current()
    let seen = initial, policySent = false, connection
    const originalPragma = Database.prototype.pragma
    Database.prototype.pragma = function (...args) {
        connection = this
        return originalPragma.apply(this, args)
    }
    checkpoint.startSqliteCheckpointWorker(databasePath, {
        SQLITE_CHECKPOINT_WORKER: '1', SQLITE_CHECKPOINT_INTERVAL_MS: String(intervalMs),
    })
    const messages = [], checkpointReceivedAtMs = []
    function observe() {
        const value = current()
        if (value.errors > seen.errors) messages.push({ type: 'checkpoint_error', error: value.lastErrorLength })
        if (value.completed === seen.completed) return
        const reclaimAttempted = value.reclaimAttempts > seen.reclaimAttempts
        const reclaimBusy = value.reclaimBusy > seen.reclaimBusy
        messages.push({ type: 'checkpoint', mode: value.lastWasTruncate ? 'truncate' : 'passive',
            truncateAttempted: value.truncateAttempts > seen.truncateAttempts,
            reclaimAttempted, reclaimBusy, reclaimedBytes: value.reclaimedBytes - seen.reclaimedBytes,
            busy: value.busy > seen.busy || reclaimBusy ? 1 : 0,
            walBytes: value.lastWalBytes, logFrames: value.lastLogFrames,
            checkpointedFrames: value.lastCheckpointedFrames })
        checkpointReceivedAtMs.push(Date.now())
        if (!policySent && value.reclaimWindows > initial.reclaimWindows && connection) {
            Database.prototype.pragma = originalPragma
            messages.push({ type: 'test_policy',
                synchronous: originalPragma.call(connection, 'synchronous', { simple: true }),
                busyTimeoutMs: originalPragma.call(connection, 'busy_timeout', { simple: true }) })
            policySent = true
        }
        seen = value
    }
    async function waitFor(predicate, label) {
        const deadline = Date.now() + 20_000
        while (Date.now() < deadline) {
            observe()
            const error = messages.find(message => message.type === 'checkpoint_error')
            if (error) assert.fail('Unexpected checkpoint error: ' + JSON.stringify(error))
            const result = messages.find(predicate)
            if (result) return result
            await delay(10)
        }
        assert.fail(label + ' timed out: ' + JSON.stringify(messages))
    }
    return {
        messages, checkpointReceivedAtMs, waitFor,
        async checkpoint() {
            observe()
            const count = messages.filter(message => message.type === 'checkpoint').length
            checkpoint.requestSqliteCheckpoint()
            await waitFor(() => messages.filter(message => message.type === 'checkpoint').length > count, 'next checkpoint')
            return messages.filter(message => message.type === 'checkpoint')[count]
        },
        async close() {
            Database.prototype.pragma = originalPragma
            await checkpoint.stopSqliteCheckpointWorker()
        },
    }
}

test('scaled real helper skips WAL at or below target without starting an extra write transaction', t => {
    const f = fixture(t), before = wal(f.db), calls = []
    assert.ok(before.bytes <= FINAL)
    const original = f.db.exec
    f.db.exec = function (sql) { calls.push(sql); return original.call(this, sql) }
    try { assert.deepEqual(reclaimSqliteWalSpace(f.db), { attempted: false, busy: false, reclaimedBytes: 0, resetObserved: false }) }
    finally { f.db.exec = original }
    assert.deepEqual(calls, [])
    assert.deepEqual(wal(f.db), before)
    f.unchanged()
})

test('scaled real helper bounds every natural-reset stage and converges while ordinary connections reopen and reset first', t => {
    const f = fixture(t)
    f.grow()
    let maintenance = f.peer(), ordinary = f.peer(), stages = 0
    const markerBefore = f.db.prepare('SELECT value FROM marker').pluck().get()
    while (wal(f.db).bytes > FINAL) {
        if (stages === 2) { ordinary.close(); ordinary = f.peer(); maintenance.close(); maintenance = f.peer() }
        assert.equal(ordinary.pragma('journal_size_limit', { simple: true }), -1)
        passive(f.db)
        const beforeOrdinary = wal(f.db)
        f.mark(ordinary)
        assert.notEqual(wal(f.db).generation, beforeOrdinary.generation)
        assert.equal(wal(f.db).bytes, beforeOrdinary.bytes, 'ordinary autocommit must only reuse high water')
        passive(maintenance)
        const before = wal(f.db), result = reclaimSqliteWalSpace(maintenance), after = wal(f.db)
        assert.equal(result.attempted, true)
        assert.equal(result.busy, false)
        assert.ok(result.reclaimedBytes > 0 && result.reclaimedBytes <= STEP)
        assert.equal(result.reclaimedBytes, before.bytes - after.bytes)
        assert.equal(after.bytes, Math.max(FINAL, before.bytes - STEP))
        assert.notEqual(after.generation, before.generation)
        assert.equal(maintenance.inTransaction, false)
        assert.ok(++stages < 20)
    }
    assert.ok(stages > 2)
    assert.equal(wal(f.db).bytes, FINAL)
    assert.equal(f.db.prepare('SELECT value FROM marker').pluck().get(), markerBefore + stages)
    f.unchanged()
})

test('scaled real helper accepts a smaller main-thread step without exceeding its global step cap', t => {
    const f = fixture(t)
    f.grow()
    const maintenance = f.peer()
    passive(maintenance)
    const before = wal(f.db)
    const smaller = reclaimSqliteWalSpace(maintenance, STEP / 2)
    assert.equal(smaller.reclaimedBytes, STEP / 2)
    assert.equal(before.bytes - wal(f.db).bytes, STEP / 2)
    passive(maintenance)
    const capped = reclaimSqliteWalSpace(maintenance, STEP * 2)
    assert.equal(capped.reclaimedBytes, STEP)
    f.unchanged()
})

test('scaled real helper reports a real competing write lock as busy and resumes after its release', t => {
    const f = fixture(t)
    f.grow()
    const maintenance = f.peer(), before = wal(f.db)
    f.db.exec('BEGIN IMMEDIATE')
    try { assert.deepEqual(reclaimSqliteWalSpace(maintenance), { attempted: true, busy: true, reclaimedBytes: 0, resetObserved: false }) }
    finally { f.db.exec('ROLLBACK') }
    assert.equal(maintenance.inTransaction, false)
    assert.deepEqual(wal(f.db), before)
    passive(maintenance)
    assert.deepEqual(reclaimSqliteWalSpace(maintenance), { attempted: true, busy: false, reclaimedBytes: STEP, resetObserved: true })
    f.unchanged()
})

test('scaled real helper propagates non-busy errors and rolls its actual metadata transaction back', t => {
    const f = fixture(t)
    f.grow()
    const maintenance = f.peer(), before = wal(f.db), expected = new Error('injected after real metadata write')
    const originalPragma = maintenance.pragma, originalExec = maintenance.exec, calls = []
    maintenance.exec = function (sql) { calls.push(sql); return originalExec.call(this, sql) }
    maintenance.pragma = function (...args) {
        const result = originalPragma.apply(this, args)
        // Execute SQLite's true metadata write first, then inject the failure
        // whose propagation and transaction rollback this test observes.
        if (/^user_version\s*=/i.test(args[0])) throw expected
        return result
    }
    try { assert.throws(() => reclaimSqliteWalSpace(maintenance), error => error === expected) }
    finally { maintenance.pragma = originalPragma; maintenance.exec = originalExec }
    assert.ok(calls.some(sql => /^ROLLBACK\b/i.test(sql)))
    assert.equal(maintenance.inTransaction, false)
    assert.equal(wal(f.db).bytes, before.bytes)
    f.unchanged()
    passive(maintenance)
    assert.equal(reclaimSqliteWalSpace(maintenance).reclaimedBytes, STEP)
    f.unchanged()
})

test('scaled real helper samples physical high water after a rolled-back savepoint spill immediately before COMMIT', t => {
    const f = fixture(t)
    f.grow()
    const maintenance = f.peer(), before = wal(f.db), original = maintenance.pragma
    maintenance.pragma('cache_size = -256')
    let spilledBytes
    maintenance.pragma = function (...args) {
        const result = original.apply(this, args)
        if (/^user_version\s*=/i.test(args[0])) {
            // Inject real native writes between the helper's metadata write
            // and its target selection. Rolling them back keeps logical data
            // intact while retaining the enlarged physical WAL high water.
            this.exec('SAVEPOINT wal_spill')
            this.prepare('UPDATE payload SET data=? WHERE id=1').run(Buffer.alloc(8 * 1024 ** 2, 91))
            this.exec('ROLLBACK TO wal_spill; RELEASE wal_spill')
            spilledBytes = wal(this).bytes
        }
        return result
    }
    let result
    try { result = reclaimSqliteWalSpace(maintenance) }
    finally { maintenance.pragma = original }
    assert.ok(spilledBytes > before.bytes + STEP, 'the real rolled-back write must enlarge physical high water')
    assert.deepEqual(result, { attempted: true, busy: false, reclaimedBytes: STEP, resetObserved: true })
    assert.equal(wal(f.db).bytes, spilledBytes - STEP,
        'sampling before the metadata/body phase would reclaim more than one stage')
    assert.equal(maintenance.inTransaction, false)
    f.unchanged()
})

test('scaled real helper respects a writer racing after PASSIVE and reads the current negative user_version under its lock', t => {
    const f = fixture(t)
    f.grow()
    const maintenance = f.peer(), ordinary = f.peer()
    passive(maintenance)
    const beforeRace = wal(f.db)
    ordinary.pragma('user_version = -2147483648')
    assert.notEqual(wal(f.db).generation, beforeRace.generation)
    const afterRace = wal(f.db)
    assert.deepEqual(reclaimSqliteWalSpace(maintenance), { attempted: true, busy: false, reclaimedBytes: 0, resetObserved: false })
    assert.deepEqual(wal(f.db), afterRace, 'a same-generation commit cannot start another reclamation stage')
    assert.equal(f.db.pragma('user_version', { simple: true }), -2147483648)
    passive(maintenance)
    assert.equal(reclaimSqliteWalSpace(maintenance).reclaimedBytes, STEP)
    assert.equal(f.db.pragma('user_version', { simple: true }), -2147483648)
    ordinary.pragma('user_version = -173')
    f.unchanged()
})

test('scaled real checkpoint controller reclaims successive bounded stages and reports maintenance diagnostics', async t => {
    const f = fixture(t)
    f.grow()
    const running = f.worker()
    const policy = await running.waitFor(message => message.type === 'test_policy', 'native worker settings')
    assert.equal(policy.synchronous, 2)
    assert.equal(policy.busyTimeoutMs, 0)
    let result = await running.waitFor(message => message.type === 'checkpoint', 'startup checkpoint')
    let rounds = 0
    for (;;) {
        assert.equal(result.mode, 'passive')
        assert.equal(result.truncateAttempted, false)
        assert.equal(result.reclaimAttempted, true)
        assert.equal(result.reclaimBusy, false)
        assert.ok(result.reclaimedBytes > 0 && result.reclaimedBytes <= STEP)
        assert.equal(result.walBytes, wal(f.db).bytes)
        assert.ok(++rounds < 20)
        if (wal(f.db).bytes === FINAL) break
        result = await running.checkpoint()
    }
    assert.ok(rounds > 2)
    const atTarget = await running.checkpoint()
    assert.equal(atTarget.reclaimAttempted, false)
    assert.equal(atTarget.reclaimedBytes, 0)
    f.unchanged()
})

test('scaled real checkpoint controller leaves a pinned snapshot intact and starts reclamation after full PASSIVE backfill', async t => {
    const f = fixture(t), pinned = f.grow(true), before = wal(f.db)
    const running = f.worker()
    const result = await running.waitFor(message => message.type === 'checkpoint', 'pinned-reader checkpoint')
    assert.ok(result.checkpointedFrames < result.logFrames)
    assert.equal(result.reclaimAttempted, false)
    assert.equal(result.reclaimedBytes, 0)
    assert.deepEqual(wal(f.db), before)
    assert.equal(pinned.reader.prepare('SELECT value FROM marker').pluck().get(), pinned.pinnedValue)
    assert.equal(hash(pinned.reader.prepare('SELECT data FROM payload').pluck().get()), pinned.pinnedHash)
    pinned.reader.exec('ROLLBACK'); pinned.reader.close()
    const resumed = await running.checkpoint()
    assert.equal(resumed.checkpointedFrames, resumed.logFrames)
    assert.equal(resumed.reclaimAttempted, true)
    assert.equal(resumed.reclaimedBytes, STEP)
    f.unchanged()
})

test('scaled real checkpoint controller reports write-lock contention as maintenance busy without a checkpoint error', async t => {
    const f = fixture(t)
    f.grow()
    const running = f.worker()
    await running.waitFor(message => message.type === 'checkpoint', 'startup checkpoint')
    f.db.exec('BEGIN IMMEDIATE')
    let result
    try { result = await running.checkpoint() }
    finally { f.db.exec('ROLLBACK') }
    assert.equal(result.reclaimAttempted, true)
    assert.equal(result.reclaimBusy, true)
    assert.equal(result.reclaimedBytes, 0)
    assert.equal(result.busy, 1)
    const resumed = await running.checkpoint()
    assert.equal(resumed.reclaimBusy, false)
    assert.equal(resumed.reclaimedBytes, STEP)
    assert.equal(running.messages.some(message => message.type === 'checkpoint_error'), false)
    f.unchanged()
})

test('scaled real checkpoint controller automatic timer advances successive stages to target without checkpoint_now', async t => {
    const f = fixture(t)
    f.grow()
    const before = wal(f.db), running = f.worker(1000)
    // Scale the scheduling period as well as the fixture limits. This covers
    // the actual timer callback; it is not a five-second production latency
    // measurement. No checkpoint_now message is sent by this test.
    await running.waitFor(message => message.type === 'checkpoint' && message.walBytes === FINAL,
        'automatic timer reclamation to target')
    const rounds = running.messages.filter(message => message.type === 'checkpoint' && message.reclaimAttempted)
    assert.ok(rounds.length > 2, 'startup alone must not be able to reach the target')
    assert.equal(rounds.reduce((total, message) => total + message.reclaimedBytes, 0), before.bytes - FINAL)
    for (const result of rounds) {
        assert.equal(result.mode, 'passive')
        assert.equal(result.truncateAttempted, false)
        assert.equal(result.reclaimBusy, false)
        assert.ok(result.reclaimedBytes > 0 && result.reclaimedBytes <= STEP)
    }
    assert.equal(wal(f.db).bytes, FINAL)
    const firstToFinalMs = running.checkpointReceivedAtMs.at(-1) - running.checkpointReceivedAtMs[0]
    assert.ok(firstToFinalMs >= 1000, 'later reclamation must come from a subsequent scheduled callback')
    t.diagnostic(JSON.stringify({ intervalMs: 1000, automaticRounds: rounds.length, firstToFinalMs,
        checkpointNowMessagesSent: 0, scope: 'scaled timer semantics, not production latency' }))
    f.unchanged()
})
