const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { test, after } = require('node:test')
const repo = process.env.PLAYER_LOGIN_TEST_REPO || path.resolve(__dirname, '..')
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'player-auth-limits-'))
process.env.DATA_DIR = dataDir
require('ts-node/register/transpile-only')
const auth = require(path.join(repo, 'src/lib/player-login'))
const routes = require(path.join(repo, 'src/routes/cn/playerLogin'))
const db = require(path.join(repo, 'src/data/db')).getDb()
const Fastify = require('fastify')
auth.initializePlayerLogin(() => {})
const fixtures = Array.from({ length: 40 }, (_, i) => auth.registerPlayerLogin('LimitFixture' + i, 'FixturePass7', true))
after(() => { db.close(); fs.rmSync(dataDir, { recursive: true }) })
async function appFixture(t) {
    const app = Fastify({ logger: false, trustProxy: false })
    await app.register(routes.default); await app.ready(); t.after(() => app.close())
    return (url, payload, ip = '127.0.0.1', headers = {}) => app.inject({ method: 'POST', url, payload, remoteAddress: ip, headers }).then(r => {
        assert.equal(r.statusCode, 200); assert.equal(r.headers['cache-control'], 'no-store'); return r.json()
    })
}
test('shared loopback supports more than thirty different valid player logins', async t => {
    const post = await appFixture(t)
    for (let i = 0; i < 36; i++) {
        const r = await post('/player-auth/login', { username: 'LimitFixture' + i, password: 'FixturePass7' })
        assert.equal(r.ok, true, 'shared peer account ' + i + ': ' + r.code)
    }
})
test('login and binding share normalized identities without locking registration', async t => {
    const post = await appFixture(t)
    for (let i = 0; i < 30; i++) {
        const r = await post('/player-auth/login', { username: i % 2 ? 'LIMITFIXTURE0' : 'limitfixture0', password: 'BadPassword7' }, '198.51.100.' + (i + 1))
        assert.notEqual(r.code, 'RATE_LIMITED')
    }
    const before = db.prepare('SELECT count(*) n FROM accounts').get().n
    assert.equal((await post('/player-auth/bind', { username: 'LimitFixture0', password: 'FixturePass7', proof: 'unused' }, '203.0.113.10')).code, 'RATE_LIMITED')
    assert.notEqual((await post('/player-auth/register', { username: 'LimitFixture0', password: 'FixturePass7' }, '203.0.113.10')).code, 'RATE_LIMITED')
    assert.equal(db.prepare('SELECT count(*) n FROM accounts').get().n, before)
    assert.equal((await post('/player-auth/login', { username: 'LimitFixture1', password: 'FixturePass7' })).ok, true)
})
test('rotating usernames and forged forwarding headers still meet the shared source ceiling', async t => {
    const post = await appFixture(t)
    for (let i = 0; i < 300; i++) assert.notEqual((await post('/player-auth/login', { username: 'UnknownUser' + i, password: 'BadPassword7' }, '127.0.0.1', { 'x-forwarded-for': '198.51.100.' + i })).code, 'RATE_LIMITED')
    assert.equal((await post('/player-auth/login', { username: 'LimitFixture2', password: 'FixturePass7' }, '127.0.0.1', { 'x-forwarded-for': '203.0.113.9' })).code, 'RATE_LIMITED')
    assert.equal((await post('/player-auth/login', { username: 'LimitFixture2', password: 'FixturePass7' }, '203.0.113.9')).ok, true)
})
test('valid sessions have separate account budgets on one shared source', async t => {
    const post = await appFixture(t)
    const sessions = fixtures.map((_, i) => auth.loginPlayer('LimitFixture' + i, 'FixturePass7', true))
    for (let i = 0; i < 160; i++) assert.equal((await post('/player-auth/resume', { token: sessions[i % 40].token })).ok, true)
    for (let i = 0; i < 116; i++) assert.equal((await post('/player-auth/resume', { token: sessions[0].token }, '198.51.100.5')).ok, true)
    assert.equal((await post('/player-auth/logout', { token: sessions[0].token }, '198.51.100.6')).code, 'RATE_LIMITED')
    assert.ok(auth.readPlayerLoginSession(sessions[0].token), 'limited logout must not revoke the session')
    assert.equal((await post('/player-auth/resume', { token: sessions[1].token })).ok, true)
})
test('invalid session rotation retains its original source limit without spending valid-account budgets', async t => {
    const post = await appFixture(t)
    for (let i = 0; i < 120; i++) assert.equal((await post('/player-auth/resume', { token: i.toString(16).padStart(64, '0') })).code, 'SESSION_INVALID')
    assert.equal((await post('/player-auth/resume', { token: 'f'.repeat(64) }, '127.0.0.1', { 'x-forwarded-for': '203.0.113.8' })).code, 'RATE_LIMITED')
    const session = auth.loginPlayer('LimitFixture3', 'FixturePass7', true)
    assert.equal((await post('/player-auth/resume', { token: session.token })).ok, true)
})
test('all valid session accounts still share an upper source bound', async t => {
    const post = await appFixture(t)
    const sessions = fixtures.map((_, i) => auth.loginPlayer('LimitFixture' + i, 'FixturePass7', true))
    for (let i = 0; i < 1200; i++) assert.equal((await post('/player-auth/resume', { token: sessions[i % 40].token })).ok, true)
    assert.equal((await post('/player-auth/resume', { token: sessions[1].token })).code, 'RATE_LIMITED')
})
test('malformed requests keep the thirty-request source budget', async t => {
    const post = await appFixture(t)
    for (let i = 0; i < 30; i++) assert.notEqual((await post('/player-auth/login', { username: '!', password: 'BadPassword7' })).code, 'RATE_LIMITED')
    assert.equal((await post('/player-auth/bind', { proof: null })).code, 'RATE_LIMITED')
    assert.equal((await post('/player-auth/login', { username: 'LimitFixture4', password: 'FixturePass7' })).ok, true)
})
test('ignored body identities cannot rotate malformed-request buckets or bypass a proof limit', async t => {
    const post = await appFixture(t)
    for (let i = 0; i < 30; i++) assert.notEqual((await post('/player-auth/login', { username: '!', code: 'unused' + i, proof: 'unused' + i })).code, 'RATE_LIMITED')
    assert.equal((await post('/player-auth/login', { username: '!', code: 'different' })).code, 'RATE_LIMITED')
    for (let i = 0; i < 30; i++) assert.notEqual((await post('/player-auth/bind', { username: 'NewName' + i, password: 'FixturePass7', proof: 'a'.repeat(64) }, '198.51.100.7')).code, 'RATE_LIMITED')
    assert.equal((await post('/player-auth/bind', { username: 'FinalNewName', password: 'FixturePass7', proof: 'a'.repeat(64) }, '198.51.100.8')).code, 'RATE_LIMITED')
})
test('expired budgets and full bounded storage recover after one minute', () => {
    const { createPlayerLoginRateLimiter } = require(path.join(repo, 'src/lib/player-login-rate-limit'))
    let now = 1000000
    const limited = createPlayerLoginRateLimiter(() => now)
    for (let i = 0; i < 30; i++) assert.equal(limited('127.0.0.1', '/player-auth/login', { username: 'BudgetUser' }, null), false)
    assert.equal(limited('127.0.0.1', '/player-auth/login', { username: 'BudgetUser' }, null), true)
    now += 60000
    assert.equal(limited('127.0.0.1', '/player-auth/login', { username: 'BudgetUser' }, null), false)
    let blocked = false
    for (let i = 0; i < 5000; i++) blocked ||= limited('fixture-' + i, '/player-auth/login', { username: 'Rotating' + i }, null)
    assert.ok(blocked, 'storage pressure must fail closed')
    now += 60000
    assert.equal(limited('fresh-fixture', '/player-auth/login', { username: 'FreshUser' }, null), false)
})
test('authentication-equivalent code variants share one budget across addresses and code routes', async t => {
    const post = await appFixture(t)
    for (let i = 0; i < 30; i++) {
        const code = i % 2 ? 'ab-cd ef12' + ' '.repeat(i) : 'ABCDEF12' + '-'.repeat(i)
        const url = i % 2 ? '/player-auth/claim-preview' : '/player-auth/reset-password'
        assert.notEqual((await post(url, { code, password: 'FixturePass7' }, '198.51.100.' + (i + 1))).code, 'RATE_LIMITED')
    }
    assert.equal((await post('/player-auth/reset-password', { code: 'A B-C D-E F-1 2', password: 'FixturePass7' }, '203.0.113.1')).code, 'RATE_LIMITED')
})
test('local claim preview ignores attached code when counting the target viewer', async t => {
    const post = await appFixture(t)
    for (let i = 0; i < 30; i++) assert.notEqual((await post('/player-auth/local-claim-preview', { viewer_id: '123456', code: 'ignored' + i }, '198.51.100.' + (i + 1))).code, 'RATE_LIMITED')
    assert.equal((await post('/player-auth/local-claim-preview', { viewer_id: 123456, code: 'different' }, '203.0.113.1')).code, 'RATE_LIMITED')
})
