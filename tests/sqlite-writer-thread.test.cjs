'use strict'

const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Database = require('better-sqlite3')

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'startpoint-writer-thread-'))
const databasePath = path.join(tempRoot, 'writer.db')
const extraCommands = path.join(__dirname, 'helpers', 'writer-test-commands.cjs')

// Point DATA_DIR at the temporary directory before anything can resolve a
// database path: no command in this suite may touch the real local database.
process.env.DATA_DIR = tempRoot
process.env.CN_WRITER_THREAD = '1'
process.env.SQLITE_GROUP_COMMIT_WINDOW_MS = '5'
process.env.SQLITE_GROUP_COMMIT_MAX = '16'
process.env.SQLITE_WRITER_BUSY_TIMEOUT_MS = '0'
process.env.SQLITE_WRITER_MAX_IN_FLIGHT = '16'
process.env.SQLITE_WRITER_COMMAND_TIMEOUT_MS = '0'
process.env.SQLITE_WRITER_EXTRA_COMMANDS = extraCommands

require(extraCommands)

const writerClient = require('../out/lib/persistence/writer-client.js')
const { runWriterCommand } = require('../out/lib/persistence-coordinator.js')
const { getServerTime, getTimeOffset, setServerTimeOffset } = require('../out/utils.js')

before(async () => {
    const setup = new Database(databasePath)
    setup.pragma('journal_mode = WAL')
    setup.exec('CREATE TABLE IF NOT EXISTS writer_test (id INTEGER PRIMARY KEY AUTOINCREMENT, value TEXT NOT NULL)')
    setup.close()

    assert.equal(writerClient.startSqliteWriter(databasePath), true)
    assert.equal(await writerClient.waitForSqliteWriterReady(30_000), true)
})

after(async () => {
    await writerClient.stopSqliteWriter()
    fs.rmSync(tempRoot, { recursive: true, force: true })
})

test('concurrent commands share one commit and a failing command rolls back only itself', async () => {
    const before = writerClient.sqliteWriterStats()

    const settled = await Promise.allSettled([
        runWriterCommand('test.insert', { value: 'a' }, { domain: 'player', playerId: 101, operation: 'test.insert' }),
        runWriterCommand('test.insert_nested', { value: 'b' }, { domain: 'player', playerId: 102, operation: 'test.insert_nested' }),
        runWriterCommand('test.fail', { value: 'doomed' }, { domain: 'player', playerId: 103, operation: 'test.fail' }),
        runWriterCommand('test.insert', { value: 'c' }, { domain: 'player', playerId: 104, operation: 'test.insert' }),
    ])

    assert.deepEqual(settled.map(entry => entry.status), ['fulfilled', 'fulfilled', 'rejected', 'fulfilled'])
    assert.match(String(settled[2].reason.message), /intentional test failure/)

    const stats = writerClient.sqliteWriterStats()
    assert.ok(stats.batches > before.batches, 'expected at least one writer batch')
    assert.ok(
        stats.maxBatchSize >= 4,
        `expected four commands to share a group commit, saw maxBatchSize=${stats.maxBatchSize}`,
    )
    assert.ok(stats.savepointRollbacks >= 1, 'expected the failing command to roll back through its savepoint')

    const rows = await runWriterCommand('test.rows', {}, { domain: 'player', operation: 'test.rows' })
    assert.deepEqual(rows, ['a', 'b', 'c'])
})

test('a result that cannot cross the thread boundary rolls the command back', async () => {
    const before = await runWriterCommand('test.rows', {}, { domain: 'player', operation: 'test.rows' })

    await assert.rejects(
        runWriterCommand(
            'test.non_cloneable',
            { value: 'ghost' },
            { domain: 'player', playerId: 201, operation: 'test.non_cloneable' },
        ),
        /could not be cloned/,
    )

    const after = await runWriterCommand('test.rows', {}, { domain: 'player', operation: 'test.rows' })
    assert.deepEqual(after, before)
    assert.equal(after.includes('ghost'), false)
})

test('afterCommit effects run only for commands that committed', async () => {
    await runWriterCommand(
        'test.insert_with_effect',
        { value: 'eff-1' },
        { domain: 'player', playerId: 301, operation: 'test.effect' },
    )
    await assert.rejects(
        runWriterCommand(
            'test.fail_after_effect',
            { value: 'eff-2' },
            { domain: 'player', playerId: 302, operation: 'test.effect' },
        ),
        /intentional failure/,
    )

    const log = await runWriterCommand('test.effect_log', {}, { domain: 'player', operation: 'test.effect_log' })
    assert.deepEqual(log, ['eff-1'])
})

test('the writer thread executes commands and survives a command deadline', async () => {
    const viaWorker = await runWriterCommand('test.pure', { value: 1 }, { domain: 'player', operation: 'test.pure' })
    assert.equal(viaWorker.thread, 'worker')

    // Restart with a short deadline so the timeout path can be exercised.
    await writerClient.stopSqliteWriter()
    process.env.SQLITE_WRITER_COMMAND_TIMEOUT_MS = '150'
    assert.equal(writerClient.startSqliteWriter(databasePath), true)
    assert.equal(await writerClient.waitForSqliteWriterReady(30_000), true)

    await assert.rejects(
        runWriterCommand('test.slow', { ms: 2_000 }, { domain: 'player', playerId: 401, operation: 'test.slow' }),
        error => error.code === 'SQLITE_WRITER_TIMEOUT',
    )

    // The client terminates and restarts the worker after a deadline so the
    // abandoned transaction cannot keep the connection in an unknown state.
    assert.equal(await writerClient.waitForSqliteWriterReady(30_000), true)
    const recovered = await runWriterCommand('test.pure', { value: 2 }, { domain: 'player', operation: 'test.pure' })
    assert.equal(recovered.thread, 'worker')
})

test('the writer thread shares the main thread virtual clock', async () => {
    // The worker is a separate thread with its own copy of the clock module,
    // so the main thread has to push the offset before commands run.
    const originalOffset = getTimeOffset()
    await writerClient.stopSqliteWriter()
    const startupOffset = -421 * 24 * 60 * 60 * 1000 - 12_345
    setServerTimeOffset(startupOffset)
    assert.equal(writerClient.startSqliteWriter(databasePath), true)
    assert.equal(await writerClient.waitForSqliteWriterReady(30_000), true)

    const fromWorker = await runWriterCommand('test.clock', {}, { domain: 'player', operation: 'test.clock' })
    assert.equal(fromWorker.thread, 'worker')
    assert.equal(fromWorker.offset, startupOffset)
    assert.ok(Math.abs(fromWorker.serverTime - getServerTime()) <= 2,
        `worker serverTime=${fromWorker.serverTime} main serverTime=${getServerTime()}`)

    // A management-panel time change must reach the already running worker.
    const changedOffset = -90 * 24 * 60 * 60 * 1000
    setServerTimeOffset(changedOffset)
    const afterChange = await runWriterCommand('test.clock', {}, { domain: 'player', operation: 'test.clock' })
    assert.equal(afterChange.offset, changedOffset)
    assert.ok(Math.abs(afterChange.serverTime - getServerTime()) <= 2)

    // Resetting to system time is a change too (null is not "keep previous").
    setServerTimeOffset(null)
    const afterReset = await runWriterCommand('test.clock', {}, { domain: 'player', operation: 'test.clock' })
    assert.equal(afterReset.offset, 0)
    assert.ok(Math.abs(afterReset.serverTime - getServerTime()) <= 2)

    setServerTimeOffset(originalOffset)
})

test('an unavailable writer fails loudly instead of writing in-process', async () => {
    await writerClient.stopSqliteWriter()
    assert.equal(writerClient.isSqliteWriterReady(), false)

    await assert.rejects(
        runWriterCommand('test.pure', { value: 3 }, { domain: 'player', operation: 'test.pure' }),
        /not ready/,
    )
})

console.log('sqlite writer thread tests passed')
