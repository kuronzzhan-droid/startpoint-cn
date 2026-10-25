'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Database = require('better-sqlite3')

test('maintenance takes its fair turn before future gated multi-inflight writer commands', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-writer-fairness-'))
    const databasePath = path.join(directory, 'data.db')
    process.env.DATA_DIR = directory
    const extraCommands = path.join(directory, 'fairness-commands.cjs')
    process.env.SQLITE_WRITER_EXTRA_COMMANDS = extraCommands
    const registryModule = path.resolve(__dirname, '../out/lib/persistence/command-registry.js')
    const dbModule = path.resolve(__dirname, '../out/data/db.js')
    fs.writeFileSync(extraCommands, [
        `const {registerWriterCommand}=require(${JSON.stringify(registryModule)})`,
        `const {getDb}=require(${JSON.stringify(dbModule)})`,
        `registerWriterCommand('fairness.insert', args => {`,
        `  if(args.started){`,
        `    Atomics.store(new Int32Array(args.started),0,1)`,
        `    getDb().prepare('WITH RECURSIVE n(x) AS (VALUES(0) UNION ALL SELECT x+1 FROM n WHERE x<5000000) SELECT sum(x) FROM n').get()`,
        `  }`,
        `  getDb().prepare('INSERT INTO ledger(value) VALUES (?)').run(args.value)`,
        `  return args.value`,
        `})`,
    ].join('\n'))

    const settings = require('../out/lib/sqlite-settings')
    const savedTarget = settings.SQLITE_WAL_JOURNAL_SIZE_LIMIT_BYTES
    const savedStep = settings.SQLITE_WAL_RECLAIM_STEP_BYTES
    settings.SQLITE_WAL_JOURNAL_SIZE_LIMIT_BYTES = 64 * 1024
    settings.SQLITE_WAL_RECLAIM_STEP_BYTES = 16 * 1024
    const { createSqliteWalMaintenance } = require('../out/lib/sqlite-wal-maintenance')
    const { persistenceWriteGate } = require('../out/lib/persistence-write-gate')
    const { nativeSqliteWrites } = require('../out/lib/sqlite-native-writes')
    const writer = require('../out/lib/persistence/writer-client')
    const { runWriterCommand } = require('../out/lib/persistence-coordinator')
    const originalExecute = writer.executeSqliteWriterCommand
    const dispatched = [], windows = [], failures = []
    writer.executeSqliteWriterCommand = command => {
        if (command.name === 'fairness.insert') dispatched.push(command.args.value)
        return originalExecute(command)
    }
    const setup = new Database(databasePath)
    setup.pragma('journal_mode=WAL'); setup.pragma('synchronous=FULL'); setup.pragma('wal_autocheckpoint=0')
    setup.exec('CREATE TABLE ledger(id INTEGER PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE padding(b BLOB); INSERT INTO padding VALUES(zeroblob(131072))')
    const maintenance = createSqliteWalMaintenance(databasePath, result => windows.push({
        result, futureDispatched: dispatched.filter(value => value.startsWith('future-')).length,
        nativeActive: nativeSqliteWrites.activeCount(), gate: persistenceWriteGate.stats(),
    }), error => failures.push(error))
    const started = new SharedArrayBuffer(4), pending = []
    const until = async (predicate, description) => {
        const deadline = Date.now() + 30_000
        while (!predicate()) {
            if (Date.now() >= deadline) assert.fail(description)
            await new Promise(resolve => setTimeout(resolve, 10))
        }
    }
    const submit = (value, playerId, signal) => runWriterCommand('fairness.insert',
        { value, ...(signal ? { started: signal } : {}) },
        { domain: 'player', playerId, operation: 'fairness.insert' })
    try {
        writer.startSqliteWriter(databasePath, {
            CN_WRITER_THREAD: '1', SQLITE_WRITER_MAX_IN_FLIGHT: '2', SQLITE_WRITER_QUEUE_MAX: '64',
            SQLITE_GROUP_COMMIT_WINDOW_MS: '0', SQLITE_GROUP_COMMIT_MAX: '1',
            SQLITE_WRITER_BUSY_TIMEOUT_MS: '0', SQLITE_WRITER_COMMAND_TIMEOUT_MS: '0', SQLITE_WRITER_MAX_RESTARTS: '0',
        })
        assert.equal(await writer.waitForSqliteWriterReady(30_000), true)
        assert.equal(writer.writerThreadSettings().maxInFlight, 2)
        for (let i = 0; i < 4; i++) pending.push(submit(`initial-${i}`, i + 1, i === 0 ? started : undefined))
        const settled = Promise.all(pending)
        await until(() => Atomics.load(new Int32Array(started), 0) === 1
            && writer.sqliteWriterStats().inFlight === 2 && writer.sqliteWriterStats().waiting === 2,
        'real native writer did not establish two in-flight and two waiting gated commands')
        const atRequest = { nativeActive: nativeSqliteWrites.activeCount(), ...writer.sqliteWriterStats() }
        assert.equal(atRequest.nativeActive, 2)
        maintenance.request()
        const gateAfterRequest = persistenceWriteGate.stats()
        const future = Array.from({ length: 16 }, (_, i) => submit(`future-${i}`, 100 + i))
        await Promise.all([settled, ...future])
        await until(() => windows.length > 0 || failures.length > 0, 'real maintenance window did not finish')
        assert.equal(failures.length, 0)
        assert.equal(setup.prepare('SELECT count(*) n FROM ledger').get().n, 20)
        assert.equal(nativeSqliteWrites.activeCount(), 0)
        console.log(JSON.stringify({ atRequest, gateAfterRequest, firstWindow: windows[0], writes: 20 }))
        assert.equal(windows[0].futureDispatched, 0,
            'maintenance must enter the fair gate before future shared writers, not wait for the entire stream to finish')
        assert.equal(windows[0].nativeActive, 0)
        assert.equal(windows[0].gate.activeWrites, 0)
        assert.equal(windows[0].gate.exclusive, true)
        assert.equal(windows[0].result.resetObserved, true)
        assert.equal(windows[0].result.reclaimedBytes, 16 * 1024)
        assert.equal(gateAfterRequest.waiting, 1, 'request must queue its exclusive turn while native writes are active')
    } finally {
        maintenance.close()
        await writer.stopSqliteWriter()
        writer.executeSqliteWriterCommand = originalExecute
        settings.SQLITE_WAL_JOURNAL_SIZE_LIMIT_BYTES = savedTarget
        settings.SQLITE_WAL_RECLAIM_STEP_BYTES = savedStep
        setup.close()
        assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()))
        fs.rmSync(directory, { recursive: true })
    }
})
