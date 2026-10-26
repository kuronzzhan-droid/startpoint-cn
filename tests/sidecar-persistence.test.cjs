'use strict'
require('ts-node/register/transpile-only')
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const { randomUUID } = require('node:crypto'), { spawnSync } = require('node:child_process')
const root = path.resolve(process.env.STARPOINT_TEST_TMP_ROOT || os.tmpdir())
fs.mkdirSync(root, { recursive: true })
const directory = fs.mkdtempSync(path.join(root, 'sidecar-persistence-'))
Object.assign(process.env, { DATA_DIR: directory, TMP: directory, TEMP: directory, SQLITE_TMPDIR: directory,
    GACHA_SEED_DIR: path.join(directory, 'seeds'), CN_WRITER_THREAD: '0', MULTI_REALTIME_PROCESS: '0',
    MULTI_REALTIME_OWNER_CHILD: '0', MULTI_BATTLE_RELAY_PROCESS: '0', ADMIN_PANEL_PASSWORD: 'SyntheticSidecarOnly25' })
fs.mkdirSync(process.env.GACHA_SEED_DIR)
const load = file => require('../src/' + file)
const templates = load('data/defaultSave'), state = load('data/activeAccount')
const accounts = load('data/domains/account'), players = load('data/domains/player'), snapshots = load('data/snapshots/player-snapshot')
const templateFile = path.join(directory, 'default_save.json'), stateFile = path.join(directory, 'active_account.json')
let db, app, cookie, uploadSnapshot
function account() {
    const account = accounts.insertAccountSync({ appId: 'wf_cn', idpAlias: '', idpCode: 'sidecar-test', idpId: randomUUID(), status: 'normal' })
    return { id: account.id, player: players.insertDefaultPlayerSync(account.id) }
}
function template(balance = 98765) {
    const p = account().player
    players.updatePlayerSync({ id: p.id, freeVmoney: balance, name: 'synthetic-template' })
    return snapshots.createPlayerSaveSnapshotV2Sync(p.id)
}
const templateBalance = snapshot => snapshot.data.tables.players.rows[0][snapshot.data.tables.players.columns.indexOf('free_vmoney')]
function freshState() { fs.writeFileSync(stateFile, JSON.stringify({ activePlayerId: null, selectedAccountId: null,
    timeOffset: null, lastSetTime: null, defaultPlayers: {} })); if (fs.existsSync(stateFile + '.bak')) fs.unlinkSync(stateFile + '.bak') }
function injectIo(target, phase, callback) {
    const originals = Object.fromEntries(['openSync', 'writeFileSync', 'fsyncSync', 'renameSync'].map(key => [key, fs[key]]))
    const handles = new Map(); let injected = 0
    const isTemporary = file => path.dirname(String(file)) === path.dirname(target) && path.basename(String(file)).startsWith('.' + path.basename(target) + '.')
    const fail = () => { injected++; throw Object.assign(Error('synthetic sidecar ' + phase + ' failure'), { code: 'ENOSPC' }) }
    fs.openSync = function(file, ...args) { const fd = originals.openSync(file, ...args); handles.set(fd, String(file)); return fd }
    fs.writeFileSync = function(file, data, ...args) {
        const filename = typeof file === 'number' ? handles.get(file) : String(file)
        if (phase === 'write' && (filename === target || isTemporary(filename))) {
            originals.writeFileSync(file, String(data).slice(0, 23), ...args); fail()
        }
        return originals.writeFileSync(file, data, ...args)
    }
    fs.fsyncSync = function(fd) { if (phase === 'fsync' && isTemporary(handles.get(fd))) fail(); return originals.fsyncSync(fd) }
    fs.renameSync = function(from, to) {
        if ((phase === 'replace' && String(to) === target) || (phase === 'backup' && String(to) === target + '.bak')) fail()
        return originals.renameSync(from, to)
    }
    return Promise.resolve().then(callback).finally(() => {
        Object.assign(fs, originals); assert.ok(injected >= 1, 'the requested I/O boundary was exercised')
    })
}
function reopen(expression) {
    const child = spawnSync(process.execPath, ['-r', 'ts-node/register/transpile-only', '-e', `
        try {const result=(${expression});console.log('RESULT='+JSON.stringify(result));
        const db=require('./src/data/db').getDb();db.close();process.exit(0)}
        catch(error){console.error(error.message);process.exit(1)}`],
        { cwd: path.resolve(__dirname, '..'), env: { ...process.env }, encoding: 'utf8', timeout: 30000 })
    return { status: child.status, text: child.stdout + child.stderr,
        value: child.stdout.split(/\r?\n/).find(line => line.startsWith('RESULT='))?.slice(7) }
}
const request = (method, url, extra = {}) => app.inject({ method, url, headers: { cookie, accept: 'application/json' }, ...extra })
before(async () => {
    db = load('data/db').getDb()
    assert.equal(path.dirname(fs.realpathSync(db.name)), fs.realpathSync(directory))
    app = require('fastify')({ logger: false })
    load('lib/management-auth').installManagementAuth(app)
    app.decorateRequest('file', function() { return Promise.resolve({ toBuffer: async () => Buffer.from(JSON.stringify(uploadSnapshot)) }) })
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

test('failed template replacement preserves the last valid bytes and applies that template to the next save', async () => {
    uploadSnapshot = template(); templates.saveDefaultSaveTemplate(uploadSnapshot)
    const before = fs.readFileSync(templateFile)
    await injectIo(templateFile, 'write', async () => assert.equal((await request('POST', '/api/server/defaultSave')).statusCode, 500))
    assert.deepEqual(fs.readFileSync(templateFile), before)
    const target = account(), result = await request('POST', '/api/server/newSave?accountId=' + target.id)
    assert.equal(result.statusCode, 200, result.body); assert.equal(result.json().appliedTemplate, true)
    assert.equal(players.getPlayerSync(result.json().playerId).freeVmoney, 98765)
})

test('failed selection replacement preserves a non-first save after a new process', async () => {
    freshState(); const a = account(), second = players.insertDefaultPlayerSync(a.id)
    state.saveAccountDefaultPlayer(a.id, second.id)
    const before = fs.readFileSync(stateFile)
    await injectIo(stateFile, 'write', () => assert.throws(() => state.setSelectedAccountId(a.id), /synthetic/))
    const child = reopen(`require('./src/data/activeAccount').resolvePlayerIdSync(${a.id})`)
    assert.equal(child.status, 0, child.text); assert.equal(JSON.parse(child.value), second.id)
    assert.deepEqual(fs.readFileSync(stateFile), before)
})

for (const phase of ['fsync', 'backup', 'replace']) {
    test(`template ${phase} failure preserves both valid files and the previous effective template`, async () => {
        templates.saveDefaultSaveTemplate(template(111)); templates.saveDefaultSaveTemplate(template(222))
        const primary = fs.readFileSync(templateFile), backup = fs.readFileSync(templateFile + '.bak')
        const next = template(333)
        await injectIo(templateFile, phase, () => assert.throws(() => templates.saveDefaultSaveTemplate(next), /synthetic/))
        assert.deepEqual(fs.readFileSync(templateFile), primary)
        // Before the main replacement the backup may advance to the still-valid primary.
        if (phase !== 'replace') assert.deepEqual(fs.readFileSync(templateFile + '.bak'), backup)
        assert.equal(templateBalance(templates.loadDefaultSaveTemplate()), 222)
    })
    test(`selection ${phase} failure keeps all accounts and the selected save after restart`, async () => {
        freshState(); const a = account(), b = account(), second = players.insertDefaultPlayerSync(a.id)
        state.activatePlayerSave(a.id, second.id); state.saveAccountDefaultPlayer(b.id, b.player.id)
        const primary = fs.readFileSync(stateFile)
        await injectIo(stateFile, phase, () => assert.throws(() => state.activatePlayerSave(a.id, a.player.id), /synthetic/))
        assert.deepEqual(fs.readFileSync(stateFile), primary)
        const child = reopen(`require('./src/data/activeAccount').getAdminPlayerSelectionState()`)
        assert.equal(child.status, 0, child.text)
        assert.deepEqual(JSON.parse(child.value), { activePlayerId: second.id, defaultPlayers: { [a.id]: second.id, [b.id]: b.player.id } })
    })
}

test('domain-invalid JSON cannot replace a good template backup, and recovery is explicit in metadata and the real route', async () => {
    templates.saveDefaultSaveTemplate(template(444)); templates.saveDefaultSaveTemplate(template(555))
    const backup = fs.readFileSync(templateFile + '.bak')
    fs.writeFileSync(templateFile, JSON.stringify({ schema: 'starpoint-cn-save', version: 2, scope: 'player-archive', data: {} }))
    const meta = (await request('GET', '/api/server/defaultSave')).json()
    assert.equal(meta.status, 'recovered'); assert.equal(meta.exists, true); assert.ok(meta.warning)
    freshState(); const target = account(), response = await request('POST', '/api/server/newSave?accountId=' + target.id)
    assert.equal(response.statusCode, 200, response.body)
    assert.equal(players.getPlayerSync(response.json().playerId).freeVmoney, 444)
    templates.saveDefaultSaveTemplate(template(666))
    assert.deepEqual(fs.readFileSync(templateFile + '.bak'), backup, 'invalid domain structure never replaces the valid backup')
})

test('unusable primary and backup expose repairable metadata and prevent any new save, including an unsupported V1 template', async () => {
    const target = account()
    for (const value of ['{broken', JSON.stringify({ schema: 'starpoint-cn-save', version: 1 })]) {
        fs.writeFileSync(templateFile, value); fs.writeFileSync(templateFile + '.bak', '{bad-backup')
        const count = db.prepare('SELECT count(*) n FROM players').get().n
        const metaResponse = await request('GET', '/api/server/defaultSave')
        assert.equal(metaResponse.statusCode, 200)
        assert.equal(metaResponse.json().exists, true); assert.equal(metaResponse.json().status, 'invalid'); assert.ok(metaResponse.json().error)
        const response = await request('POST', '/api/server/newSave?accountId=' + target.id)
        assert.equal(response.statusCode, 409, response.body)
        assert.equal(db.prepare('SELECT count(*) n FROM players').get().n, count)
    }
})

test('a successful clear cannot revive an old template from backup after corruption or restart', async () => {
    templates.saveDefaultSaveTemplate(template(777))
    const response = await request('DELETE', '/api/server/defaultSave')
    assert.equal(response.statusCode, 200); assert.equal(templates.getDefaultSaveMeta().status, 'cleared')
    assert.equal(JSON.parse(fs.readFileSync(templateFile + '.bak')).cleared, true)
    fs.writeFileSync(templateFile, '{interrupted-external-file')
    assert.equal(templates.loadDefaultSaveTemplate(), null)
    const child = reopen(`require('./src/data/defaultSave').loadDefaultSaveTemplate()`)
    assert.equal(child.status, 0, child.text); assert.equal(JSON.parse(child.value), null)
    freshState(); const target = account(), created = await request('POST', '/api/server/newSave?accountId=' + target.id)
    assert.equal(created.statusCode, 200, created.body); assert.equal(created.json().appliedTemplate, false)
    assert.notEqual(players.getPlayerSync(created.json().playerId).freeVmoney, 777)
})

test('failed clear reports failure and a valid old primary remains configured', async () => {
    templates.saveDefaultSaveTemplate(template(888))
    const before = fs.readFileSync(templateFile)
    await injectIo(templateFile, 'replace', async () => assert.equal((await request('DELETE', '/api/server/defaultSave')).statusCode, 500))
    assert.deepEqual(fs.readFileSync(templateFile), before)
    assert.equal(templateBalance(templates.loadDefaultSaveTemplate()), 888)
    assert.equal(JSON.parse(fs.readFileSync(templateFile + '.bak')).cleared, true)
    assert.equal((await request('DELETE', '/api/server/defaultSave')).statusCode, 200)
})

test('valid in-memory selections stay cheap but cannot overwrite corrupt disk state, and restart fails explicitly', async () => {
    freshState(); const a = account(), second = players.insertDefaultPlayerSync(a.id)
    state.activatePlayerSave(a.id, second.id)
    const originalRead = fs.readFileSync, originalStat = fs.statSync; let reads = 0, stats = 0
    fs.readFileSync = function(file, ...args) { if ([stateFile, stateFile + '.bak'].includes(String(file))) reads++; return originalRead(file, ...args) }
    fs.statSync = function(file, ...args) { if ([stateFile, stateFile + '.bak'].includes(String(file))) stats++; return originalStat(file, ...args) }
    try { for (let i = 0; i < 1000; i++) assert.equal(state.resolvePlayerIdSync(a.id), second.id) }
    finally { fs.readFileSync = originalRead; fs.statSync = originalStat }
    assert.equal(reads, 0); assert.equal(stats, 0)
    fs.writeFileSync(stateFile, '{bad-primary'); fs.writeFileSync(stateFile + '.bak', JSON.stringify({ defaultPlayers: { [a.id]: 'not-an-id' } }))
    const before = [fs.readFileSync(stateFile), fs.readFileSync(stateFile + '.bak')]
    assert.throws(() => state.setSelectedAccountId(a.id), /均不可用/)
    assert.deepEqual([fs.readFileSync(stateFile), fs.readFileSync(stateFile + '.bak')], before)
    const child = reopen(`require('./src/data/activeAccount').resolvePlayerIdSync(${a.id})`)
    assert.equal(child.status, 1); assert.match(child.text, /均不可用/)
})

test('a structurally valid selection backup recovers read-only and intentional account removal stays removed', () => {
    freshState(); const a = account(), b = account()
    state.activatePlayerSave(a.id, a.player.id); state.saveAccountDefaultPlayer(b.id, b.player.id)
    const expected = JSON.parse(fs.readFileSync(stateFile + '.bak'))
    fs.writeFileSync(stateFile, '{bad-primary')
    const child = reopen(`require('./src/data/activeAccount').getAdminPlayerSelectionState()`)
    assert.equal(child.status, 0, child.text)
    assert.deepEqual(JSON.parse(child.value), { activePlayerId: expected.activePlayerId, defaultPlayers: expected.defaultPlayers })
    assert.equal(fs.readFileSync(stateFile, 'utf8'), '{bad-primary', 'reading a backup never silently repairs disk')
    state.removeDeletedAccountFromState(a.id, [a.player.id])
    const next = reopen(`require('./src/data/activeAccount').getAdminPlayerSelectionState()`)
    assert.equal(next.status, 0, next.text); assert.equal(JSON.parse(next.value).defaultPlayers[a.id], undefined)
})

test('the real activate route persists panel and account selection through one primary replacement', async () => {
    freshState(); const a = account(), b = account(), second = players.insertDefaultPlayerSync(a.id)
    state.saveAccountDefaultPlayer(a.id, a.player.id); state.saveAccountDefaultPlayer(b.id, b.player.id)
    const rename = fs.renameSync; let replacements = 0
    fs.renameSync = function(from, to) { if (String(to) === stateFile) replacements++; return rename(from, to) }
    let result; try { result = await request('POST', '/api/server/activateSave?playerId=' + second.id) } finally { fs.renameSync = rename }
    assert.equal(result.statusCode, 200, result.body); assert.equal(replacements, 1)
    assert.equal(state.getActivePlayerId(), second.id); assert.equal(state.getAccountDefaultPlayer(a.id), second.id)
    assert.equal(state.getAccountDefaultPlayer(b.id), b.player.id)
})

test('template application failure rolls the new player back in the same SQLite transaction', async () => {
    freshState(); templates.saveDefaultSaveTemplate(template()); const target = account()
    state.activatePlayerSave(target.id, target.player.id)
    const beforeCount = db.prepare('SELECT count(*) n FROM players').get().n, beforeSelection = fs.readFileSync(stateFile)
    db.exec("CREATE TRIGGER fail_template_player BEFORE UPDATE ON players WHEN NEW.name='synthetic-template' BEGIN SELECT RAISE(ABORT,'synthetic template restore failure'); END")
    try { assert.equal((await request('POST', '/api/server/newSave?accountId=' + target.id)).statusCode, 409) }
    finally { db.exec('DROP TRIGGER fail_template_player') }
    assert.equal(db.prepare('SELECT count(*) n FROM players').get().n, beforeCount)
    assert.deepEqual(fs.readFileSync(stateFile), beforeSelection)
    assert.deepEqual(db.pragma('foreign_key_check'), [])
})

test('selection failure after a database commit reports the created save and permits selecting it without creating again', async () => {
    freshState(); templates.saveDefaultSaveTemplate(template()); const target = account()
    state.activatePlayerSave(target.id, target.player.id)
    const beforeCount = accounts.getAccountPlayersSync(target.id).length
    let result
    await injectIo(stateFile, 'replace', async () => { result = await request('POST', '/api/server/newSave?accountId=' + target.id) })
    assert.equal(result.statusCode, 500); assert.equal(result.json().created, true); assert.match(result.json().error, /无需再次新建/)
    const id = result.json().playerId
    assert.equal(players.getPlayerSync(id).freeVmoney, 98765)
    assert.equal(accounts.getAccountPlayersSync(target.id).length, beforeCount + 1)
    assert.equal(state.getAccountDefaultPlayer(target.id), target.player.id)
    assert.equal((await request('POST', '/api/server/activateSave?playerId=' + id)).statusCode, 200)
    assert.equal(state.getAccountDefaultPlayer(target.id), id)
})

test('a completed clone remains available when the later selection commit fails', async () => {
    freshState(); const source = account(), target = account()
    players.updatePlayerSync({ id: source.player.id, freeVmoney: 76543 })
    state.activatePlayerSave(target.id, target.player.id)
    let result
    await injectIo(stateFile, 'replace', async () => { result = await request('POST', `/api/server/cloneSave?playerId=${source.player.id}&accountId=${target.id}`) })
    assert.equal(result.statusCode, 500); assert.equal(result.json().created, true); assert.match(result.json().error, /无需再次克隆/)
    assert.equal(players.getPlayerSync(result.json().playerId).freeVmoney, 76543)
    assert.equal(state.getAccountDefaultPlayer(target.id), target.player.id)
    assert.equal((await request('POST', '/api/server/activateSave?playerId=' + result.json().playerId)).statusCode, 200)
})

test('deleting the selected non-final save updates its panel and default references in one file replacement', async () => {
    freshState(); const a = account(), b = account(), second = players.insertDefaultPlayerSync(a.id)
    state.activatePlayerSave(a.id, second.id); state.saveAccountDefaultPlayer(b.id, b.player.id)
    const rename = fs.renameSync; let replacements = 0
    fs.renameSync = function(from, to) { if (String(to) === stateFile) replacements++; return rename(from, to) }
    let result; try { result = await request('POST', '/api/server/deleteSave?playerId=' + second.id) } finally { fs.renameSync = rename }
    assert.equal(result.statusCode, 200, result.body); assert.equal(replacements, 1)
    assert.equal(state.getActivePlayerId(), null); assert.equal(state.getAccountDefaultPlayer(a.id), a.player.id)
    assert.equal(state.getAccountDefaultPlayer(b.id), b.player.id)
    assert.equal(players.getPlayerSync(second.id), null)
})
