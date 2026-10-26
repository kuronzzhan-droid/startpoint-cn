'use strict'
require('ts-node/register/transpile-only')
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const { randomUUID } = require('node:crypto'), { spawnSync } = require('node:child_process')
const root = path.resolve(process.env.STARPOINT_TEST_TMP_ROOT || os.tmpdir())
fs.mkdirSync(root, { recursive: true })
const directory = fs.mkdtempSync(path.join(root, 'default-save-clear-'))
Object.assign(process.env, { DATA_DIR: directory, TMP: directory, TEMP: directory, SQLITE_TMPDIR: directory,
    GACHA_SEED_DIR: path.join(directory, 'seeds'), CN_WRITER_THREAD: '0', MULTI_REALTIME_PROCESS: '0',
    MULTI_REALTIME_OWNER_CHILD: '0', MULTI_BATTLE_RELAY_PROCESS: '0', ADMIN_PANEL_PASSWORD: randomUUID() })
fs.mkdirSync(process.env.GACHA_SEED_DIR)
const load = file => require('../src/' + file)
const templates = load('data/defaultSave'), accounts = load('data/domains/account'), players = load('data/domains/player')
const file = path.join(directory, 'default_save.json'), backup = file + '.bak'
let db, app, cookie, snapshot, originalBytes, sourcePlayer, sourceRows
function account() {
    const account = accounts.insertAccountSync({ appId: 'wf_cn', idpAlias: '', idpCode: 'default-clear-test', idpId: randomUUID(), status: 'normal' })
    return { id: account.id, player: players.insertDefaultPlayerSync(account.id) }
}
function reset(mode) {
    fs.writeFileSync(file, mode === 'corrupt' ? '{corrupt-primary' : originalBytes)
    if (mode === 'missing') fs.unlinkSync(file)
    fs.writeFileSync(backup, originalBytes)
    assert.equal(templates.getDefaultSaveMeta().status, mode === 'valid' ? 'valid' : 'recovered')
}
function balance(value) {
    assert.ok(value, 'the configured template must remain readable')
    return value.data.tables.players.rows[0][value.data.tables.players.columns.indexOf('free_vmoney')]
}
function restartRead() {
    const child = spawnSync(process.execPath, ['-r', 'ts-node/register/transpile-only', '-e', `
        try {const templates=require('./src/data/defaultSave');
        console.log('RESULT='+JSON.stringify({template:templates.loadDefaultSaveTemplate(),meta:templates.getDefaultSaveMeta()}));
        const db=require('./src/data/db').getDb();db.close();process.exit(0)}
        catch(error){console.error(error);process.exit(1)}`],
        { cwd: path.resolve(__dirname, '..'), env: { ...process.env }, encoding: 'utf8', timeout: 30000 })
    assert.equal(child.status, 0, child.stdout + child.stderr)
    const result = child.stdout.split(/\r?\n/).find(line => line.startsWith('RESULT='))
    assert.ok(result, child.stdout + child.stderr)
    return JSON.parse(result.slice(7))
}
async function injectIo(target, phase, occurrence, callback) {
    const originals = Object.fromEntries(['openSync', 'writeFileSync', 'fsyncSync', 'renameSync'].map(key => [key, fs[key]]))
    const handles = new Map(); let matched = 0, injected = 0
    const isTemporary = filename => filename && path.dirname(filename) === path.dirname(target)
        && path.basename(filename).startsWith('.' + path.basename(target) + '.' + process.pid + '.')
    const fail = () => { injected++; throw Object.assign(Error('synthetic default clear ' + phase + ' failure'), { code: phase === 'rename' ? 'EPERM' : 'ENOSPC' }) }
    const shouldFail = () => ++matched === occurrence
    fs.openSync = function(filename, ...args) { const fd = originals.openSync(filename, ...args); handles.set(fd, String(filename)); return fd }
    fs.writeFileSync = function(filename, data, ...args) {
        const name = typeof filename === 'number' ? handles.get(filename) : String(filename)
        if (phase === 'write' && isTemporary(name) && shouldFail()) {
            originals.writeFileSync(filename, String(data).slice(0, 19), ...args); fail()
        }
        return originals.writeFileSync(filename, data, ...args)
    }
    fs.fsyncSync = function(fd) { if (phase === 'fsync' && isTemporary(handles.get(fd)) && shouldFail()) fail(); return originals.fsyncSync(fd) }
    fs.renameSync = function(from, to) { if (phase === 'rename' && String(to) === target && shouldFail()) fail(); return originals.renameSync(from, to) }
    try { await callback() }
    finally { Object.assign(fs, originals) }
    assert.equal(injected, 1, 'the requested persistence boundary must be exercised exactly once')
}
const request = (method, url) => app.inject({ method, url, headers: { cookie, accept: 'application/json' } })
before(async () => {
    db = load('data/db').getDb()
    assert.equal(path.dirname(fs.realpathSync(db.name)), fs.realpathSync(directory))
    sourcePlayer = account().player
    players.updatePlayerSync({ id: sourcePlayer.id, freeVmoney: 98765, name: 'synthetic-clear-template' })
    snapshot = load('data/snapshots/player-snapshot').createPlayerSaveSnapshotV2Sync(sourcePlayer.id)
    templates.saveDefaultSaveTemplate(snapshot)
    originalBytes = fs.readFileSync(file)
    sourceRows = db.prepare('SELECT * FROM players WHERE id=?').get(sourcePlayer.id)
    app = require('fastify')({ logger: false })
    load('lib/management-auth').installManagementAuth(app)
    await app.register(load('routes/web_api/server').default, { prefix: '/api/server' })
    const login = await app.inject({ method: 'POST', url: '/admin-login', payload: { password: process.env.ADMIN_PANEL_PASSWORD } })
    assert.equal(login.statusCode, 200); cookie = login.headers['set-cookie'].split(';')[0]
})
after(async () => {
    await app?.close(); await load('lib/seed-validator').default.close()
    await load('multi/npc/player-party-pool').stopQuestNpcPartyPoolWorker()
    if (db?.open) db.close()
    assert.equal(path.dirname(directory), root)
    fs.rmSync(directory, { recursive: true })
})

for (const mode of ['valid', 'corrupt', 'missing']) {
    const stages = mode === 'valid' ? [['backup', backup, 1], ['primary', file, 1]]
        : [['repair', file, 1], ['backup', backup, 1], ['primary', file, 2]]
    for (const [stage, target, occurrence] of stages) for (const phase of ['write', 'fsync', 'rename']) {
        test(`${mode} primary: ${stage} ${phase} failure keeps the configured template, including after restart`, async () => {
            reset(mode)
            const beforeCount = db.prepare('SELECT count(*) n FROM players').get().n
            await injectIo(target, phase, occurrence, async () => {
                const response = await request('DELETE', '/api/server/defaultSave')
                assert.equal(response.statusCode, 500, response.body)
                assert.match(response.json().message, /synthetic default clear/)
            })
            assert.equal(balance(templates.loadDefaultSaveTemplate()), 98765)
            assert.equal(templates.getDefaultSaveMeta().exists, true)
            const restarted = restartRead()
            assert.equal(balance(restarted.template), 98765)
            assert.equal(restarted.meta.exists, true)
            assert.equal(db.prepare('SELECT count(*) n FROM players').get().n, beforeCount)
            assert.deepEqual(db.prepare('SELECT * FROM players WHERE id=?').get(sourcePlayer.id), sourceRows)
            assert.deepEqual(fs.readdirSync(directory).filter(name => name.startsWith('.default_save.json.')), [])
        })
    }
}

test('the original recovered-primary EPERM failure keeps the template usable by the real new-save route', async () => {
    reset('corrupt')
    const target = account()
    await injectIo(file, 'rename', 2, async () => assert.equal((await request('DELETE', '/api/server/defaultSave')).statusCode, 500))
    const response = await request('POST', '/api/server/newSave?accountId=' + target.id)
    assert.equal(response.statusCode, 200, response.body)
    assert.equal(response.json().appliedTemplate, true)
    assert.equal(players.getPlayerSync(response.json().playerId).freeVmoney, 98765)
    assert.deepEqual(db.prepare('SELECT * FROM players WHERE id=?').get(sourcePlayer.id), sourceRows)
})

for (const mode of ['valid', 'corrupt', 'missing']) {
    test(`${mode} primary: a successful clear removes both recovery copies and cannot revive after restart`, async () => {
        reset(mode)
        const response = await request('DELETE', '/api/server/defaultSave')
        assert.equal(response.statusCode, 200, response.body)
        assert.deepEqual(response.json(), { ok: true, removed: true })
        for (const location of [file, backup]) assert.equal(JSON.parse(fs.readFileSync(location)).cleared, true)
        fs.writeFileSync(file, '{corrupt-after-clear')
        const restarted = restartRead()
        assert.equal(restarted.template, null)
        assert.equal(restarted.meta.status, 'cleared')
        const target = account(), created = await request('POST', '/api/server/newSave?accountId=' + target.id)
        assert.equal(created.statusCode, 200, created.body)
        assert.equal(created.json().appliedTemplate, false)
        assert.deepEqual(db.prepare('SELECT * FROM players WHERE id=?').get(sourcePlayer.id), sourceRows)
    })
}

test('explicit clear still repairs unusable files and reports an absent template without creating files', async () => {
    fs.writeFileSync(file, '{bad-primary'); fs.writeFileSync(backup, '{bad-backup')
    assert.equal(templates.getDefaultSaveMeta().status, 'invalid')
    assert.equal((await request('DELETE', '/api/server/defaultSave')).statusCode, 200)
    assert.equal(restartRead().template, null)
    fs.unlinkSync(file); fs.unlinkSync(backup)
    assert.equal(templates.clearDefaultSaveTemplate(), false)
    assert.equal(fs.existsSync(file), false); assert.equal(fs.existsSync(backup), false)
})
