'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { Worker } = require('node:worker_threads')
const { setTimeout: delay } = require('node:timers/promises')
const Database = require('better-sqlite3')

function createDatabase(directory) {
    const database = new Database(path.join(directory, 'checkpoint.db'))
    database.pragma('journal_mode=WAL')
    database.pragma('synchronous=FULL')
    database.pragma('wal_autocheckpoint=0')
    database.exec('CREATE TABLE payloads(id INTEGER PRIMARY KEY,data BLOB)')
    database.prepare('INSERT INTO payloads VALUES(0,?)').run(Buffer.alloc(3800, 1))
    return database
}

function appendBacklog(database) {
    const insert = database.prepare('INSERT INTO payloads VALUES(?,?)')
    const data = Buffer.alloc(3800, 7)
    database.transaction(() => {
        for (let id = 1; id <= 1300; id++) insert.run(id, data)
    }).immediate()
    assert.ok(fs.statSync(database.name + '-wal').size >= 4 * 1024 * 1024)
}

function startWorker(databasePath) {
    const messages = []
    let failure
    const worker = new Worker(path.resolve(__dirname, '../out/workers/sqlite-checkpoint-worker.js'), {
        workerData: {
            databasePath,
            intervalMs: 3_600_000,
            busyTimeoutMs: 0,
            // A legacy launcher or direct caller must not re-enable truncation.
            truncateFrames: 1000,
            truncateBytes: 4 * 1024 * 1024,
            truncateCooldownMs: 0,
        },
    })
    worker.on('message', message => messages.push(message))
    worker.on('error', error => { failure = error })
    return {
        worker,
        messages,
        async waitForCheckpoint(previousCount = 0) {
            const deadline = Date.now() + 10_000
            while (Date.now() < deadline) {
                if (failure) throw failure
                const error = messages.find(message => message.type === 'checkpoint_error')
                if (error) assert.fail(error.error)
                const checkpoints = messages.filter(message => message.type === 'checkpoint')
                if (checkpoints.length > previousCount) return checkpoints.at(-1)
                await delay(10)
            }
            assert.fail(`checkpoint did not complete: ${JSON.stringify(messages)}`)
        },
        async close() {
            worker.postMessage({ type: 'close' })
            const deadline = Date.now() + 2000
            while (!failure && !messages.some(message => message.type === 'closed') && Date.now() < deadline) {
                await delay(10)
            }
            await worker.terminate()
        },
    }
}

function assertCompatiblePassiveMessage(message) {
    assert.equal(message.mode, 'passive')
    assert.equal(message.truncateAttempted, false)
    assert.equal(message.truncateBusy, 0)
    assert.equal(message.reclaimAttempted, false)
    assert.equal(message.reclaimBusy, false)
    assert.equal(message.reclaimedBytes, 0)
    assert.ok(message.logFrames > 0)
    assert.equal(message.checkpointedFrames, message.logFrames)
}

async function isolated(operation) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-checkpoint-online-'))
    const database = createDatabase(directory)
    let running
    try {
        await operation(database, databasePath => (running = startWorker(databasePath)))
    } finally {
        if (running) await running.close()
        database.close()
        const resolved = path.resolve(directory)
        assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep))
        fs.rmSync(resolved, { recursive: true })
    }
}

test('online checkpoint retains a WAL below 2 GiB at startup despite legacy truncate settings', async () => {
    await isolated(async (database, start) => {
        appendBacklog(database)
        const walBytes = fs.statSync(database.name + '-wal').size
        const running = start(database.name)
        const message = await running.waitForCheckpoint()
        // Check the physical effect before checking the declared mode.
        assert.equal(fs.statSync(database.name + '-wal').size, walBytes,
            'startup must retain WAL space below the reclamation target despite legacy truncate thresholds')
        assert.equal(database.prepare('SELECT count(*) FROM payloads').pluck().get(), 1301)
        assert.equal(database.pragma('quick_check', { simple: true }), 'ok')
        assertCompatiblePassiveMessage(message)
    })
})

test('online checkpoint_now retains a WAL below 2 GiB and later writes reuse it', async () => {
    await isolated(async (database, start) => {
        const running = start(database.name)
        await running.waitForCheckpoint()
        appendBacklog(database)
        const walBytes = fs.statSync(database.name + '-wal').size
        running.worker.postMessage({ type: 'checkpoint_now' })
        const message = await running.waitForCheckpoint(1)
        assert.equal(fs.statSync(database.name + '-wal').size, walBytes,
            'checkpoint_now must retain WAL space below the reclamation target')
        assertCompatiblePassiveMessage(message)
        const backlogFrames = message.logFrames
        for (let round = 0; round < 3; round++) {
            const payload = Buffer.alloc(3800, round + 20)
            database.prepare('UPDATE payloads SET data=? WHERE id=0').run(payload)
            running.worker.postMessage({ type: 'checkpoint_now' })
            const next = await running.waitForCheckpoint(round + 2)
            assertCompatiblePassiveMessage(next)
            assert.ok(next.logFrames < backlogFrames, 'the WAL should recycle frames instead of growing for small writes')
            assert.equal(fs.statSync(database.name + '-wal').size, walBytes)
            assert.deepEqual(database.prepare('SELECT data FROM payloads WHERE id=0').pluck().get(), payload)
        }
        assert.equal(database.prepare('SELECT count(*) FROM payloads').pluck().get(), 1301)
        assert.equal(database.pragma('quick_check', { simple: true }), 'ok')
    })
})
