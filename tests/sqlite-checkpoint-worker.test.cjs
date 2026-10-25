const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { setTimeout: delay } = require('node:timers/promises')
const Database = require('better-sqlite3')
const workerThreads = require('node:worker_threads')
const sqliteSettings = require('../out/lib/sqlite-settings')

process.env.SQLITE_DIAGNOSTICS = 'true'
const checkpoint = require('../out/lib/sqlite-checkpoint-worker')
// The worker now only backfills. Observe its actual messages while the parent
// reports maintenance through its own state counters.
function startObservedCheckpoint(databasePath, settings, callbacks, fixture) {
    const NativeWorker = workerThreads.Worker
    workerThreads.Worker = class extends NativeWorker {
        constructor(filename, options) {
            super(filename, options)
            this.on('message', message => fixture.messages.push(message))
        }
    }
    try { checkpoint.startSqliteCheckpointWorker(databasePath, settings, callbacks) }
    finally { workerThreads.Worker = NativeWorker }
}
const { collectMemoryDiagnostics } = require('../out/lib/memory-diagnostics')
const environment = {
    SQLITE_CHECKPOINT_WORKER: '1',
    SQLITE_CHECKPOINT_INTERVAL_MS: '3600000',
    SQLITE_CHECKPOINT_TRUNCATE_FRAMES: '1000',
    SQLITE_CHECKPOINT_TRUNCATE_BYTES: String(4 * 1024 * 1024),
    SQLITE_CHECKPOINT_TRUNCATE_COOLDOWN_MS: '5000',
}
const state = () => collectMemoryDiagnostics().counters.sqliteCheckpoint
async function until(predicate, label, timeout = 10000) {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
        if (predicate()) return
        await delay(20)
    }
    assert.fail(`${label}: ${JSON.stringify(state())}`)
}
function open(file) {
    const db = new Database(file)
    db.pragma('journal_mode=WAL')
    db.pragma('wal_autocheckpoint=0')
    db.exec('CREATE TABLE payloads(id INTEGER PRIMARY KEY, data BLOB)')
    db.prepare('INSERT INTO payloads VALUES(0,?)').run(Buffer.alloc(3800, 1))
    return db
}
function append(db) {
    const put = db.prepare('INSERT INTO payloads VALUES(?,?)')
    const data = Buffer.alloc(3800, 7)
    db.transaction(() => { for (let i = 1; i <= 1300; i++) put.run(i, data) })()
    assert.ok(fs.statSync(db.name + '-wal').size >= 4 * 1024 * 1024)
}
function assertPassiveDiagnostics() {
    const current = state()
    assert.equal(current.truncateAttempts, 0)
    assert.equal(current.truncateCompleted, 0)
    assert.equal(current.truncateBusy, 0)
    assert.equal(current.lastWasTruncate, false)
}

test('checkpoint ownership falls back after repeated errors and recovers on success', () => {
    const transitions = []
    const ownership = checkpoint.createCheckpointOwnershipController({
        onReady: () => transitions.push('external'),
        onStopped: () => transitions.push('automatic'),
    })

    ownership.checkpointFailed()
    ownership.checkpointFailed()
    ownership.checkpointFailed()
    assert.deepEqual(transitions, [])

    ownership.checkpointSucceeded()
    ownership.checkpointSucceeded()
    ownership.checkpointFailed()
    ownership.checkpointFailed()
    assert.deepEqual(transitions, ['external'])

    ownership.checkpointFailed()
    ownership.checkpointFailed()
    assert.deepEqual(transitions, ['external', 'automatic'])

    ownership.checkpointSucceeded()
    ownership.workerStopped()
    ownership.workerStopped()
    assert.deepEqual(transitions, ['external', 'automatic', 'external', 'automatic'])
})

test('checkpoint worker handles passive backlog, pinned readers, WAL reuse and lifecycle on isolated databases', async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-checkpoint-worker-'))
    try {
        await t.test('disabled switch does not start a worker', async () => {
            const before = state().completed
            checkpoint.startSqliteCheckpointWorker(path.join(directory, 'disabled.db'), { SQLITE_CHECKPOINT_WORKER: '0' })
            assert.equal(state().started, false)
            assert.equal(state().completed, before)
            assert.equal(fs.existsSync(path.join(directory, 'disabled.db')), false)
            await checkpoint.stopSqliteCheckpointWorker()
        })
        await t.test('startup retains a WAL below 2 GiB despite legacy truncate thresholds', async () => {
            const db = open(path.join(directory, 'backlog.db'))
            let ready = 0, stopped = 0
            try {
                append(db)
                const walBytes = fs.statSync(db.name + '-wal').size
                const before = state().completed
                checkpoint.startSqliteCheckpointWorker(db.name, environment, {
                    onReady: () => { ready++ },
                    onStopped: () => { stopped++ },
                })
                await until(() => state().completed > before, 'startup passive checkpoint')
                assert.equal(fs.statSync(db.name + '-wal').size, walBytes,
                    'a WAL below the reclamation target must retain its physical space despite legacy truncate thresholds')
                assertPassiveDiagnostics()
                assert.equal(ready, 1)
                await until(() => {
                    const worker = collectMemoryDiagnostics().workers.find(row => row.name === 'sqlite-checkpoint')
                    return worker && !worker.stale && worker.pendingMs === 0
                }, 'checkpoint memory probe')
                assert.ok(state().lastPassiveLogFrames > 0)
                assert.equal(state().lastPassiveCheckpointedFrames, state().lastPassiveLogFrames)
                const worker = collectMemoryDiagnostics().workers.find(row => row.name === 'sqlite-checkpoint')
                assert.equal(worker.counters.truncateAttempts, 0)
                assert.equal(worker.counters.truncateCompleted, 0)
                assert.equal(worker.counters.truncateBusy, 0)
                assert.equal(db.prepare('SELECT count(*) FROM payloads').pluck().get(), 1301)
                assert.equal(db.pragma('integrity_check', { simple: true }), 'ok')
            } finally {
                await checkpoint.stopSqliteCheckpointWorker()
                assert.equal(state().started, false)
                await until(() => stopped === 1, 'checkpoint owner release')
                assert.ok(!collectMemoryDiagnostics().workers.some(worker => worker.name === 'sqlite-checkpoint'))
                db.close()
            }
        })
        await t.test('pinned reader allows partial checkpoints and writes, then catches up and reuses a WAL below 2 GiB', async () => {
            const db = open(path.join(directory, 'reader.db'))
            const reader = new Database(db.name, { readonly: true })
            try {
                reader.exec('BEGIN')
                assert.equal(reader.prepare('SELECT count(*) FROM payloads').pluck().get(), 1)
                append(db)
                db.pragma('busy_timeout=25')
                const before = state()
                checkpoint.startSqliteCheckpointWorker(db.name, environment)
                await until(() => state().completed > before.completed, 'pinned-reader partial checkpoint')
                assert.equal(state().errors, before.errors)
                assert.ok(state().lastPassiveCheckpointedFrames < state().lastPassiveLogFrames)
                assertPassiveDiagnostics()
                assert.equal(reader.prepare('SELECT count(*) FROM payloads').pluck().get(), 1)
                db.transaction(() => db.prepare('INSERT INTO payloads VALUES(1301,?)').run(Buffer.alloc(3800, 8))).immediate()
                const first = state()
                checkpoint.requestSqliteCheckpoint()
                await until(() => state().completed > first.completed, 'another partial passive checkpoint')
                assert.ok(state().lastPassiveCheckpointedFrames < state().lastPassiveLogFrames)
                reader.exec('COMMIT')
                const afterRelease = state().completed
                checkpoint.requestSqliteCheckpoint()
                await until(() => state().completed > afterRelease
                    && state().lastPassiveCheckpointedFrames === state().lastPassiveLogFrames,
                'full backfill after reader release')
                const retainedBytes = fs.statSync(db.name + '-wal').size
                const backlogFrames = state().lastPassiveLogFrames
                assert.ok(retainedBytes >= 4 * 1024 * 1024)
                assert.equal(db.prepare('SELECT count(*) FROM payloads').pluck().get(), 1302)
                assert.equal(reader.prepare('SELECT count(*) FROM payloads').pluck().get(), 1302)
                for (let i = 0; i < 3; i++) {
                    db.prepare('UPDATE payloads SET data=? WHERE id=0').run(Buffer.alloc(3800, i + 10))
                    const completed = state().completed
                    checkpoint.requestSqliteCheckpoint()
                    await until(() => state().completed > completed, 'reused WAL checkpoint')
                    assert.equal(state().lastPassiveCheckpointedFrames, state().lastPassiveLogFrames)
                    assert.ok(state().lastPassiveLogFrames < backlogFrames,
                        'a later small write should reuse WAL frames after a completed checkpoint')
                    assert.equal(fs.statSync(db.name + '-wal').size, retainedBytes)
                    assert.equal(db.prepare('SELECT hex(substr(data,1,1)) FROM payloads WHERE id=0').pluck().get(),
                        (i + 10).toString(16).padStart(2, '0').toUpperCase())
                    assertPassiveDiagnostics()
                }
                assert.equal(db.pragma('integrity_check', { simple: true }), 'ok')
            } finally {
                if (reader.inTransaction) reader.exec('ROLLBACK')
                reader.close()
                await checkpoint.stopSqliteCheckpointWorker()
                db.close()
            }
        })
        await t.test('real maintenance BEGIN busy preserves PASSIVE ownership and a later checkpoint reclaims space', async () => {
            const db = open(path.join(directory, 'maintenance-busy.db'))
            const fixture = { messages: [] }
            const originalTarget = sqliteSettings.SQLITE_WAL_JOURNAL_SIZE_LIMIT_BYTES
            const originalStep = sqliteSettings.SQLITE_WAL_RECLAIM_STEP_BYTES
            let ready = 0, stopped = 0
            try {
                // Scale the parent's imported settings only. The real worker
                // executes ordinary PASSIVE and never owns reclamation.
                sqliteSettings.SQLITE_WAL_JOURNAL_SIZE_LIMIT_BYTES = 256 * 1024
                sqliteSettings.SQLITE_WAL_RECLAIM_STEP_BYTES = 512 * 1024
                append(db)
                db.pragma('user_version=173')
                const backfill = db.pragma('wal_checkpoint(PASSIVE)')[0]
                assert.equal(backfill.log, backfill.checkpointed)
                const walBefore = fs.statSync(db.name + '-wal').size
                db.exec('BEGIN IMMEDIATE')
                const errorsBefore = state().errors
                const busyBefore = state().reclaimBusy
                const windowsBefore = state().reclaimWindows
                startObservedCheckpoint(db.name, {
                    ...environment,
                    // A legacy value must not make maintenance wait for us.
                    SQLITE_CHECKPOINT_BUSY_TIMEOUT_MS: '5000',
                }, { onReady: () => { ready++ }, onStopped: () => { stopped++ } }, fixture)
                for (let round = 0; round < 3; round++) {
                    if (round > 0) checkpoint.requestSqliteCheckpoint()
                    await until(() => (fixture.messages.filter(message => message.type === 'checkpoint').length > round
                        && state().reclaimBusy > busyBefore + round)
                        || fixture.messages.some(message => message.type === 'checkpoint_error'),
                    'maintenance busy checkpoint')
                    const failure = fixture.messages.find(message => message.type === 'checkpoint_error')
                    assert.equal(failure, undefined, failure?.error)
                    const message = fixture.messages.filter(message => message.type === 'checkpoint')[round]
                    assert.equal(message.mode, 'passive')
                    assert.equal(message.passiveCheckpointedFrames, message.passiveLogFrames)
                    assert.equal(message.reclaimAttempted, false, 'the bulk worker must not shrink the WAL')
                    assert.equal(message.reclaimBusy, false)
                    assert.equal(message.reclaimedBytes, 0)
                    assert.equal(state().reclaimWindows, windowsBefore + round + 1)
                    assert.equal(state().reclaimBusy, busyBefore + round + 1)
                    assert.equal(state().lastReclaimedBytes, 0)
                    assert.equal(state().errors, errorsBefore)
                    assert.equal(state().lastError, false)
                    assert.equal(ready, 1)
                    assert.equal(stopped, 0, 'normal maintenance contention must not switch checkpoint ownership')
                    assert.equal(state().enabled, true)
                    assert.equal(fs.statSync(db.name + '-wal').size, walBefore)
                }
                db.exec('ROLLBACK')
                const count = fixture.messages.filter(message => message.type === 'checkpoint').length
                const reclaimedBefore = state().reclaimedBytes
                const resetsBefore = state().reclaimResetsObserved
                checkpoint.requestSqliteCheckpoint()
                await until(() => (fixture.messages.filter(message => message.type === 'checkpoint').length > count
                    && state().reclaimedBytes > reclaimedBefore)
                    || fixture.messages.some(message => message.type === 'checkpoint_error'),
                'maintenance reclaim after writer release')
                assert.equal(fixture.messages.some(message => message.type === 'checkpoint_error'), false)
                const recovered = fixture.messages.filter(message => message.type === 'checkpoint').at(-1)
                assert.equal(recovered.reclaimAttempted, false)
                assert.equal(recovered.reclaimBusy, false)
                assert.equal(recovered.reclaimedBytes, 0)
                assert.ok(state().lastReclaimedBytes > 0 && state().lastReclaimedBytes <= 512 * 1024)
                assert.equal(walBefore - fs.statSync(db.name + '-wal').size, state().lastReclaimedBytes)
                assert.equal(state().reclaimResetsObserved, resetsBefore + 1)
                assert.equal(state().reclaimBusy, busyBefore + 3)
                assert.equal(db.pragma('user_version', { simple: true }), 173)
                assert.equal(db.prepare('SELECT count(*) FROM payloads').pluck().get(), 1301)
                assert.equal(db.pragma('integrity_check', { simple: true }), 'ok')
                assert.equal(state().errors, errorsBefore)
                assert.equal(ready, 1)
                assert.equal(stopped, 0)
                assertPassiveDiagnostics()
            } finally {
                if (db.inTransaction) db.exec('ROLLBACK')
                await checkpoint.stopSqliteCheckpointWorker()
                assert.equal(stopped, 1)
                db.close()
                sqliteSettings.SQLITE_WAL_JOURNAL_SIZE_LIMIT_BYTES = originalTarget
                sqliteSettings.SQLITE_WAL_RECLAIM_STEP_BYTES = originalStep
            }
        })
        await t.test('failed startup is observable and a later start can recover', async () => {
            const before = state().errors
            checkpoint.startSqliteCheckpointWorker(path.join(directory, 'missing', 'db.sqlite'), environment)
            await until(() => state().errors > before && !state().started, 'startup failure')
            const db = open(path.join(directory, 'recovered.db'))
            try {
                const completed = state().completed
                checkpoint.startSqliteCheckpointWorker(db.name, environment)
                await until(() => state().completed > completed, 'restart after failure')
                assert.equal(state().lastError, false)
            } finally {
                await checkpoint.stopSqliteCheckpointWorker()
                await checkpoint.stopSqliteCheckpointWorker()
                db.close()
            }
        })
    } finally {
        await checkpoint.stopSqliteCheckpointWorker()
        const resolved = path.resolve(directory)
        assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep))
        fs.rmSync(resolved, { recursive: true })
    }
})
