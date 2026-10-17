const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { test, after } = require('node:test')
const Fastify = require('fastify')
const Sqlite = require('better-sqlite3')
const { pack, unpack } = require('msgpackr')

// All state is disposable and repository-local; never import the server entrypoint.
const scratchRoot = path.resolve(__dirname, '../tmp')
fs.mkdirSync(scratchRoot, { recursive: true })
const dir = fs.mkdtempSync(path.join(scratchRoot, 'security-route-guards-'))
process.env.DATA_DIR = dir
process.env.SQLITE_WRITER_ENABLED = 'false'
require('ts-node/register/transpile-only')
const db = new Sqlite(path.join(dir, 'fixture.db'))
const { setDbOverride } = require('../src/data/db')
setDbOverride(db)
const auth = require('../src/lib/player-login')
const { requestRoutePath } = require('../src/lib/request-route-path')
const { installClientAdmission, ClientAdmission, proofMessage } = require('../src/lib/client-admission')
const { installPlayerLoginGuard } = require('../src/routes/cn/playerLogin')
const { installTakeoverUdidGuard } = require('../src/lib/takeover-access')
const { installManagementAuth } = require('../src/lib/management-auth')
db.exec(`
    CREATE TABLE accounts(id INTEGER PRIMARY KEY, username TEXT, status TEXT, takeover_udid TEXT);
    CREATE TABLE sessions(token TEXT PRIMARY KEY, account_id INTEGER, type INTEGER);
    CREATE TABLE device_bindings(device_id INTEGER PRIMARY KEY, account_id INTEGER);
    CREATE TABLE handler_effects(id INTEGER PRIMARY KEY);
    INSERT INTO accounts VALUES(1,NULL,'normal','current-device'),(2,'FixtureUser','normal','managed-device');
    INSERT INTO sessions VALUES('12345',1,2),('23456',2,2);
    INSERT INTO device_bindings VALUES(22,2);
`)
auth.initializePlayerLogin(() => {})
const session = 'a'.repeat(64)
db.prepare('INSERT INTO player_login_credentials VALUES(?,?,?)').run(2, 'FixturePass7', Date.now())
db.prepare('INSERT INTO player_login_sessions VALUES(?,?,?,?,?)').run(session, 2, 23456, 'managed-device', Date.now() + 60000)
after(() => {
    db.close()
    setDbOverride(null)
    const resolved = fs.realpathSync(dir)
    assert.equal(path.dirname(resolved), fs.realpathSync(scratchRoot))
    fs.rmSync(resolved, { recursive: true })
})
function appFixture(t) {
    const app = Fastify({ logger: false })
    app.addHook('onSend', async (_req, reply, payload) =>
        reply.getHeader('content-type') === 'application/x-msgpack' && typeof payload === 'object'
            ? pack(payload) : payload)
    t.after(() => app.close())
    return app
}
function effectFixture() {
    let handlers = 0, databaseCalls = 0
    return {
        handler: async () => {
            handlers++
            databaseCalls++
            db.prepare('INSERT INTO handler_effects DEFAULT VALUES').run()
            return { allowed: true }
        },
        assertUntouched: () => { assert.equal(handlers, 0); assert.equal(databaseCalls, 0) },
        count: () => handlers,
    }
}
function post(app, url, payload = {}, headers = {}) {
    return app.inject({ method: 'POST', url, payload, headers })
}
function gameDenied(response) {
    assert.equal(response.statusCode, 200)
    assert.equal(unpack(response.rawPayload).data_headers.result_code, 516)
}
function gateFixture() {
    const key = crypto.randomBytes(32).toString('hex')
    const config = path.join(dir, crypto.randomUUID() + '.json')
    const keys = path.join(dir, crypto.randomUUID() + '.keys.json')
    fs.writeFileSync(config, JSON.stringify({ enforce: true, updateMessage: '更新客户端', builds: [{ id: 'fixture', name: 'fixture', enabled: true, allowUntil: null }] }))
    fs.writeFileSync(keys, JSON.stringify({ fixture: key }))
    const gate = new ClientAdmission(config, keys, Date.now, () => {})
    assert.equal(gate.reload(), true)
    const challenge = gate.challenge({ protocol: 1, build: 'fixture' }, 'fixture-peer').data
    const proof = crypto.createHmac('sha256', Buffer.from(key, 'hex'))
        .update(proofMessage('fixture', challenge.challenge, challenge.nonce)).digest('hex')
    const ticket = gate.prove({ challenge: challenge.challenge, proof }, 'fixture-peer').data.token
    return { gate, ticket }
}
test('route identity has no raw URL fallback for unmatched requests', async t => {
    assert.equal(requestRoutePath({ routeOptions: undefined, url: '/api/index.php/tool/signup' }), '')
    assert.equal(requestRoutePath({ routeOptions: { url: '/api/index.php/tool/signup' }, url: '/%61pi/index.php/tool/signup?x=1' }), '/api/index.php/tool/signup')
    const app = appFixture(t)
    app.setNotFoundHandler(req => ({ path: requestRoutePath(req) }))
    assert.equal((await app.inject('/%61pi/index.php/missing?x=1')).json().path, '')
})
test('encoded player-auth and game prefixes cannot bypass admission before handlers or DB', async t => {
    const app = appFixture(t), effects = effectFixture(), { gate } = gateFixture()
    installClientAdmission(app, gate)
    app.post('/player-auth/register', effects.handler)
    app.post('/api/index.php/tool/signup', effects.handler)
    for (const url of ['/player-auth/register', '/%70layer-auth/register?x=1', '/player%2dauth/register']) {
        const response = await post(app, url)
        assert.equal(response.json().ok, false)
        assert.equal(response.json().code, 'CLIENT_ADMISSION_REQUIRED')
    }
    for (const url of ['/api/index.php/tool/signup', '/%61pi/index.php/tool/signup?x=1', '/api/index%2ephp/tool/signup']) gameDenied(await post(app, url))
    effects.assertUntouched()
})
test('encoded bootstrap keeps ticket-only behavior; game writes require a bound session', async t => {
    const app = appFixture(t), effects = effectFixture(), { gate, ticket } = gateFixture()
    installClientAdmission(app, gate)
    app.post('/player-auth/login', async () => ({ ok: true, data: { token: session } }))
    app.post('/api/index.php/asset/get_path', async () => ({ allowed: true }))
    app.post('/api/index.php/assetintitle/version_info_in_title', async () => ({ allowed: true }))
    app.post('/api/index.php/tool/auth', async () => ({ allowed: true }))
    app.post('/api/index.php/tool/signup', effects.handler)
    const headers = { 'x-sp-admission': ticket }
    for (const url of ['/%61pi/index.php/asset/get_path?x=1', '/api/index.php/%61ssetintitle/version_info_in_title', '/api/index.php/tool/%61uth']) {
        gameDenied(await post(app, url))
        assert.equal((await post(app, url, {}, headers)).json().allowed, true)
    }
    gameDenied(await post(app, '/%61pi/index.php/tool/signup?x=1', {}, headers))
    effects.assertUntouched()
    assert.equal((await post(app, '/%70layer-auth/login?x=1', {}, headers)).json().ok, true)
    assert.equal((await post(app, '/%61pi/index.php/tool/signup?x=1', {}, { ...headers, 'x-sp-session': session })).json().allowed, true)
    assert.equal(effects.count(), 1)
    gameDenied(await post(app, '/%61pi/index.php/tool/signup', {}, { ...headers, 'x-sp-session': 'wrong-session' }))
    assert.equal(effects.count(), 1)
})
test('player login guard rejects encoded managed-save reads and managed-device signup', async t => {
    const app = appFixture(t), effects = effectFixture()
    installPlayerLoginGuard(app)
    app.post('/api/index.php/load', effects.handler)
    app.post('/api/index.php/tool/signup', effects.handler)
    for (const url of ['/api/index.php/load', '/%61pi/index.php/load?x=1', '/api/index%2ephp/load']) gameDenied(await post(app, url, { viewer_id: 23456 }))
    gameDenied(await post(app, '/%61pi/index.php/tool/signup', { device_id: 22 }))
    gameDenied(await post(app, '/%61pi/index.php/load', { viewer_id: 23456 }, { 'x-sp-session': 'forged-session' }))
    gameDenied(await post(app, '/%61pi/index.php/load', { viewer_id: 12345 }, { 'x-sp-session': session }))
    effects.assertUntouched()
    assert.equal((await post(app, '/%61pi/index.php/load?x=1', { viewer_id: 23456 }, { 'x-sp-session': session })).json().allowed, true)
    assert.equal(effects.count(), 1)
})
test('old UDID guard rejects encoded legacy-save writes and permits current UDID', async t => {
    const app = appFixture(t), effects = effectFixture()
    installTakeoverUdidGuard(app)
    app.post('/api/index.php/save', effects.handler)
    app.post('/api/index.php/event/rush/leaderboard', async () => ({ allowed: true }))
    for (const url of ['/api/index.php/save', '/%61pi/index.php/save?x=1', '/api/index%2ephp/save']) gameDenied(await post(app, url, { viewer_id: 12345 }, { udid: 'old-device' }))
    effects.assertUntouched()
    assert.equal((await post(app, '/%61pi/index.php/save?x=1', { viewer_id: 12345 }, { udid: 'current-device' })).json().allowed, true)
    assert.equal((await post(app, '/%61pi/index.php/event/rush/leaderboard?x=1', { viewer_id: 12345 })).json().allowed, true)
    assert.equal(effects.count(), 1)
})
test('verified player session retains the old UDID guard exemption on encoded paths', async t => {
    const app = appFixture(t)
    installPlayerLoginGuard(app)
    installTakeoverUdidGuard(app)
    app.post('/api/index.php/load', req => ({ allowed: !!auth.verifiedPlayerLogin(req) }))
    assert.equal((await post(app, '/%61pi/index.php/load?x=1', { viewer_id: 23456 }, { 'x-sp-session': session, udid: 'old-device' })).json().allowed, true)
})
test('all leaderboard management methods reject anonymous calls before handler and DB', async t => {
    const app = appFixture(t), effects = effectFixture()
    const priorPassword = process.env.ADMIN_PANEL_PASSWORD
    process.env.ADMIN_PANEL_PASSWORD = 'FixtureAdmin7'
    installManagementAuth(app)
    if (priorPassword === undefined) delete process.env.ADMIN_PANEL_PASSWORD
    else process.env.ADMIN_PANEL_PASSWORD = priorPassword
    for (const [method, url] of [['GET', '/api/leaderboards'], ['GET', '/api/leaderboards/:key'], ['PATCH', '/api/leaderboards/:key/availability'], ['PATCH', '/api/leaderboards/:key/config'], ['POST', '/api/leaderboards/:key/settle'], ['POST', '/api/leaderboards/:key/rollover']]) app.route({ method, url, handler: effects.handler })
    const calls = [['GET', '/api/leaderboards'], ['GET', '/api/leaderboards/fixture?page=1'], ['PATCH', '/api/leaderboards/fixture/availability'], ['PATCH', '/api/leaderboards/fixture/config'], ['POST', '/api/leaderboards/fixture/settle'], ['POST', '/api/leaderboards/fixture/rollover']]
    for (const [method, url] of calls) {
        for (const variant of [url, url.replace('/api/', '/%61pi/'), url.replace('leaderboards', 'leader%62oards')]) {
            const response = await app.inject({ method, url: variant, ...(method === 'GET' ? {} : { payload: { enabled: false } }) })
            assert.equal(response.statusCode, 401, method + ' ' + variant)
        }
    }
    effects.assertUntouched()
    const login = await post(app, '/admin-login', { password: 'FixtureAdmin7' })
    assert.equal(login.statusCode, 200)
    const cookie = login.headers['set-cookie'].split(';', 1)[0]
    for (const [method, url] of calls) {
        const response = await app.inject({ method, url: url.replace('/api/', '/%61pi/'), headers: { cookie }, ...(method === 'GET' ? {} : { payload: { enabled: false } }) })
        assert.equal(response.statusCode, 200)
        assert.equal(response.json().allowed, true)
    }
    assert.equal(effects.count(), calls.length)
})
