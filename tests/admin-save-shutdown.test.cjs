'use strict'
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path')
const { spawn } = require('node:child_process')
const { test } = require('node:test')
const out = process.env.STARPOINT_TEST_OUT_DIR
if (!out) throw Error('Use the current isolated build via STARPOINT_TEST_OUT_DIR')
const load = name => require(path.join(out, name))
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(predicate, label) {
    const end = Date.now() + 10000
    while (!predicate()) { if (Date.now() >= end) throw Error(`timeout: ${label}`); await sleep(5) }
}

async function scenario(name) {
    const directory = fs.mkdtempSync(path.join(path.resolve(__dirname, '../tmp'), 'admin-close-'))
    process.env.DATA_DIR = directory; process.env.MULTI_REALTIME_PROCESS = '0'
    process.env.MULTI_REALTIME_OWNER_CHILD = '0'; process.env.MULTI_BATTLE_RELAY_PROCESS = '0'
    const shutdown = load('lib/shutdown-state')
    let app, db
    try {
        if (name.startsWith('export-')) {
            const { EventEmitter } = require('node:events'), threads = require('node:worker_threads')
            let worker
            class ControlledWorker extends EventEmitter {
                constructor() { super(); worker = this; this.terminates = 0; this.threadId = 99 }
                unref() {}
                terminate() { this.terminates++; return new Promise(resolve => { this.terminateDone = resolve }) }
                exit(code) { this.emit('exit', code); this.terminateDone?.(code) }
            }
            threads.Worker = ControlledWorker
            const exports = load('lib/player-save-export')
            let settled = false
            const controller = new AbortController()
            const pending = exports.exportPlayerSaveInWorker(1, { signal: controller.signal, timeoutMs: 1000 })
            const observed = pending.then(value => { settled = true; return { value } }, error => { settled = true; return { error } })
            let drained = false
            const drain = exports.drainPlayerSaveExports().then(() => { drained = true })
            if (name === 'export-success') {
                const bytes = new TextEncoder().encode('{"save":true}')
                worker.emit('message', { type: 'completed', payload: bytes.buffer, byteLength: bytes.byteLength, rowCount: 4 })
            } else if (name === 'export-abort') controller.abort()
            else if (name === 'export-timeout') await until(() => worker.terminates > 0, 'timeout requests terminate')
            else {
                const stop = exports.stopPlayerSaveExports()
                await assert.rejects(exports.exportPlayerSaveInWorker(1), error => error instanceof shutdown.ServerClosingError)
                assert.equal(worker.terminates, 1)
                await sleep(5); assert.equal(settled, false); assert.equal(drained, false)
                worker.exit(1); await stop; await observed; await drain
                return
            }
            await sleep(5)
            assert.equal(settled, false, 'message/terminate request is not actual worker exit')
            assert.equal(drained, false)
            await assert.rejects(exports.exportPlayerSaveInWorker(1), error => error.code === 'busy')
            worker.exit(name === 'export-success' ? 0 : 1)
            const result = await observed; await drain
            assert.equal(drained, true)
            if (name === 'export-success') assert.equal(result.value.rowCount, 4)
            else assert.equal(result.error.code, name === 'export-abort' ? 'aborted' : 'timeout')
            return
        }

        db = load('data/db').getDb()
        const accounts = load('data/domains/account'), players = load('data/domains/player')
        function player(label) {
            const account = accounts.insertAccountSync({ appId: 'wf_cn', idpAlias: '', idpCode: 'fixture', idpId: label, status: 'normal' })
            const value = players.insertDefaultPlayerSync(account.id)
            load('data/activeAccount').saveAccountDefaultPlayer(account.id, value.id)
            return { ...value, accountId: account.id }
        }
        app = require('fastify')({ logger: false })
        load('lib/persistence-http-errors').installPersistenceHttpErrors(app)
        const persistence = load('lib/persistence-coordinator'), original = persistence.runPersistenceTransaction
        if (name.startsWith('import-')) {
            const source = player('source'), target = player('target')
            players.updatePlayerSync({ id: source.id, name: 'imported-name' })
            const snapshots = load('data/snapshots/player-snapshot')
            const snapshot = snapshots.createPlayerSaveSnapshotV2Sync(source.id)
            const targetBefore = snapshots.createPlayerSaveSnapshotV2Sync(target.id)
            const identitiesBefore = db.prepare('SELECT id, account_id FROM players ORDER BY id').all()
            let writes = 0, releaseUpload
            const upload = new Promise(resolve => { releaseUpload = resolve })
            app.decorateRequest('file', function () { return Promise.resolve({ toBuffer: async () => {
                if (name === 'import-upload-close') { shutdown.beginServerShutdown(); await upload }
                return Buffer.from(JSON.stringify(snapshot))
            } }) })
            persistence.runPersistenceTransaction = (context, operation, options) => {
                assert.equal(context.operation, 'import_save'); writes++
                const accepted = original(context, operation, options)
                if (name === 'import-accepted-close') shutdown.beginServerShutdown()
                return accepted
            }
            if (name === 'import-rollback') {
                const restore = snapshots.restorePlayerSaveSnapshotV2Sync
                snapshots.restorePlayerSaveSnapshotV2Sync = (...args) => { restore(...args); throw Error('post-restore validation fixture') }
            }
            await app.register(load('routes/web_api/player').default, { prefix: '/player' }); await app.ready()
            const pending = app.inject({ method: 'POST', url: `/player/save?id=${target.id}`, headers: { accept: 'application/json' }, payload: {} })
            if (name === 'import-upload-close') { await sleep(20); releaseUpload() }
            const response = await pending
            if (name === 'import-upload-close') {
                assert.equal(response.statusCode, 503, response.body)
                assert.equal(response.json().code, 'SERVER_CLOSING')
                assert.equal(writes, 1, 'attempt reaches the actual coordinator boundary, which refuses it')
                assert.deepEqual(snapshots.createPlayerSaveSnapshotV2Sync(target.id).data.tables, targetBefore.data.tables)
                assert.equal(fs.existsSync(path.join(directory, 'admin-backups')), false)
            } else {
                assert.equal(writes, 1)
                assert.equal(response.statusCode, name === 'import-rollback' ? 500 : 200, response.body)
                const folders = fs.readdirSync(path.join(directory, 'admin-backups'))
                assert.equal(folders.length, 1)
                const backup = JSON.parse(fs.readFileSync(path.join(directory, 'admin-backups', folders[0], 'player-save.json')))
                assert.deepEqual(backup.data.tables, targetBefore.data.tables)
                assert.equal(players.getPlayerSync(target.id).name, name === 'import-rollback' ? target.name : 'imported-name')
                if (name === 'import-rollback') assert.deepEqual(snapshots.createPlayerSaveSnapshotV2Sync(target.id).data.tables, targetBefore.data.tables)
            }
            assert.deepEqual(db.prepare('SELECT id, account_id FROM players ORDER BY id').all(), identitiesBefore)
            assert.equal(db.pragma('quick_check', { simple: true }), 'ok')
        } else {
            const candidates = Array.from({ length: 12 }, (_, index) => player(`cleanup-${index}`))
            const backups = load('lib/admin-database-backup'), originalBackup = backups.createFullDatabaseBackup
            let deletes = 0, indexes = 0
            if (name === 'cleanup-backup-close') backups.createFullDatabaseBackup = async (...args) => {
                const backup = await originalBackup(...args); shutdown.beginServerShutdown(); return backup
            }
            persistence.runPersistenceTransaction = (context, operation, options) => {
                if (context.operation === 'delete_unnoted_accounts') deletes++
                if (context.operation === 'ensure_cleanup_indexes') indexes++
                const accepted = original(context, operation, options)
                if (context.operation === 'delete_unnoted_accounts' && name === 'cleanup-batch-close') shutdown.beginServerShutdown()
                return accepted
            }
            await app.register(load('routes/web_api/server').default, { prefix: '/server' }); await app.ready()
            const response = await app.inject({ method: 'POST', url: '/server/deleteUnnotedAccounts', payload: { confirm: 'DELETE_UNNOTED_ACCOUNTS' } })
            assert.equal(response.statusCode, 202, response.body)
            let job
            const deadline = Date.now() + 10000
            do {
                job = (await app.inject({ url: '/server/deleteUnnotedAccounts/status' })).json()
                if (job.status !== 'running') break
                await sleep(10)
            } while (Date.now() < deadline)
            assert.equal(job.status, 'failed', JSON.stringify(job))
            assert.equal(job.interrupted, true)
            const completed = name === 'cleanup-batch-close' ? 5 : 0
            assert.equal(deletes, completed ? 1 : 0); assert.equal(indexes, completed ? 1 : 0)
            assert.equal(job.processedAccounts, completed)
            assert.equal(job.deletedAccounts, completed); assert.equal(job.deletedSaves, completed)
            assert.equal(job.remainingAccounts, candidates.length - completed)
            assert.equal(db.prepare('SELECT COUNT(*) n FROM accounts').get().n, candidates.length - completed)
            const backupDir = path.join(directory, 'admin-backups', path.basename(job.backup))
            const recorded = JSON.parse(fs.readFileSync(path.join(backupDir, 'cleanup-result.json')))
            assert.equal(recorded.interrupted, true)
            assert.equal(recorded.deletedAccountIds.length, completed)
            assert.equal(recorded.remainingAccounts, candidates.length - completed)
            assert.equal((await app.inject({ method: 'POST', url: '/server/deleteUnnotedAccounts', payload: { confirm: 'DELETE_UNNOTED_ACCOUNTS' } })).statusCode, 503)
            assert.equal(deletes, completed ? 1 : 0, 'close cannot create another deletion batch')
            assert.equal(db.pragma('quick_check', { simple: true }), 'ok')
            assert.deepEqual(db.pragma('foreign_key_check'), [])
        }
    } finally {
        if (app) await app.close()
        if (db) { await load('multi/npc/player-party-pool').stopQuestNpcPartyPoolWorker(); db.close() }
        fs.rmSync(directory, { recursive: true, force: true })
    }
}

if (process.argv[2] === '--scenario') {
    scenario(process.argv[3]).catch(error => { console.error(error); process.exitCode = 1 })
} else {
    for (const name of ['export-success', 'export-abort', 'export-timeout', 'export-stop', 'import-upload-close', 'import-accepted-close', 'import-rollback', 'cleanup-backup-close', 'cleanup-batch-close']) {
        test(`admin shutdown boundary: ${name}`, { timeout: 20000 }, async () => {
            const child = spawn(process.execPath, [__filename, '--scenario', name], { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
            let output = ''
            child.stdout.on('data', value => { output += value }); child.stderr.on('data', value => { output += value })
            const code = await new Promise(resolve => child.once('exit', resolve))
            assert.equal(code, 0, output)
        })
    }
}
