const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { test, after } = require('node:test')
const scratch = path.resolve(__dirname, '../tmp')
fs.mkdirSync(scratch, { recursive: true })
const dataDir = fs.mkdtempSync(path.join(scratch, 'account-creation-'))
process.env.DATA_DIR = dataDir
require('ts-node/register/transpile-only')
const { createAccountCreationBudget, accountCreationBudget } = require('../src/lib/account-creation-budget')
const Fastify = require('fastify')
const auth = require('../src/lib/player-login')
const db = require('../src/data/db').getDb()
const loginRoutes = require('../src/routes/cn/playerLogin')
const toolRoutes = require('../src/routes/cn/tool').default
auth.initializePlayerLogin(() => {})
after(() => { db.close(); fs.rmSync(dataDir, { recursive: true }) })

test('reservations bound source/global successes, survive rollover, and finalize exactly once', () => {
    let now = 0
    const budget = createAccountCreationBudget({ clock: () => now, sourceSuccessMax: 1, globalSuccessMax: 2 })
    const a = budget.reserve('peer-a'), b = budget.reserve('peer-b')
    assert.ok(a && b)
    assert.equal(budget.reserve('peer-a'), null)
    assert.equal(budget.reserve('peer-c'), null)
    now += 3_600_000
    assert.equal(budget.reserve('peer-c'), null, 'pending work survives hour rollover')
    a.release(); a.commit(); a.release()
    const c = budget.reserve('peer-c')
    assert.ok(c)
    b.commit(); b.commit(); b.release(); c.commit()
    assert.deepEqual(budget.inspect(), { sources: 3, pending: 0, successes: 2, attempts: 2 })
    assert.equal(budget.reserve('peer-d'), null)
    now += 3_600_000
    assert.ok(budget.reserve('peer-d'))
})

test('failed attempts release hourly capacity but preserve short-window attempts', () => {
    let now = 0
    const budget = createAccountCreationBudget({ clock: () => now, sourceAttemptMax: 2, globalAttemptMax: 3,
        sourceSuccessMax: 1, globalSuccessMax: 1 })
    budget.reserve('a').release()
    budget.reserve('a').release()
    assert.equal(budget.reserve('a'), null)
    assert.equal(budget.reserve('b'), null, 'global attempts include denied requests')
    now = 60_000
    const accepted = budget.reserve('a')
    assert.ok(accepted); accepted.commit()
    now = 120_000
    assert.equal(budget.reserve('a'), null, 'minute rollover does not replenish hourly successes')
    assert.equal(budget.reserve('b'), null)
})

test('bounded storage fails closed, expires idle sources, and roots never share state', () => {
    let now = 0
    const budget = createAccountCreationBudget({ clock: () => now, maxSources: 2 })
    budget.reserve('a').release(); budget.reserve('b').release()
    assert.equal(budget.reserve('c'), null)
    assert.equal(budget.inspect().sources, 2)
    now = 3_600_000
    budget.reserve('c').release()
    assert.equal(budget.inspect().sources, 1)
    assert.equal(createAccountCreationBudget({ enabled: false }).reserve('a'), null)
    assert.throws(() => createAccountCreationBudget({ sourceSuccessMax: 0 }))
    assert.equal(budget.reserve(''), null)
    const first = { server: {} }, second = { server: {} }
    assert.equal(accountCreationBudget(first), accountCreationBudget({ server: first.server }))
    assert.notEqual(accountCreationBudget(first), accountCreationBudget(second))
    assert.throws(() => accountCreationBudget(first, { enabled: false }))
})

test('registration outcome lookup uses the existing partial username index', () => {
    const plan = db.prepare("EXPLAIN QUERY PLAN SELECT id FROM accounts WHERE lower(username)=? AND username IS NOT NULL AND username<>''")
        .all('budget-index-fixture')
    assert.ok(plan.some(row => row.detail.includes('idx_player_login_username')), JSON.stringify(plan))
})

async function fixture(t, options = {}) {
    const app = Fastify({ logger: false, trustProxy: false })
    const budget = accountCreationBudget(app, options)
    // Observe game payloads without starting the full CN response-worker service.
    app.addHook('onSend', (_request, reply, payload, done) => {
        done(null, reply.getHeader('content-type') === 'application/x-msgpack' && typeof payload === 'object'
            ? JSON.stringify(payload) : payload)
    })
    loginRoutes.installPlayerLoginGuard(app)
    await app.register(loginRoutes.default)
    await app.register(toolRoutes, { prefix: '/api/index.php/tool' })
    await app.ready()
    t.after(() => app.close())
    const post = (url, payload, ip = '127.0.0.1', headers = {}) => app.inject({ method: 'POST', url,
        payload, remoteAddress: ip, headers }).then(r => {
        assert.equal(r.statusCode, 200, r.body)
        return r.json()
    })
    return { app, budget, post }
}
const register = (name) => ({ username: name, password: 'FixturePass7', remember: true })
const count = () => db.prepare('SELECT count(*) n FROM accounts').get().n

test('register and guest signup share source successes; existing signup/login/resume remain usable', async t => {
    const { post, budget, app } = await fixture(t, { sourceSuccessMax: 2, globalSuccessMax: 8 })
    const before = count()
    const registered = await post('/player-auth/register?ignored=1', register('BudgetShared1'))
    assert.equal(registered.ok, true)
    const guest = await post('/api/index.php/tool/signup', { device_id: 850001 })
    assert.equal(guest.data.newAccount, 1)
    assert.equal((await post('/player-auth/register', register('DifferentName2'), '127.0.0.1',
        { 'x-forwarded-for': '203.0.113.1' })).code, 'RATE_LIMITED')
    const deniedGuest = await post('/api/index.php/tool/signup?device=rotated', { device_id: 850002 },
        '127.0.0.1', { 'x-forwarded-for': '203.0.113.2' })
    assert.equal(deniedGuest.data_headers.result_code, 516)
    assert.equal(count(), before + 2)
    assert.equal((await post('/api/index.php/tool/signup', { device_id: 850001 })).data.newAccount, 0)
    const login = await post('/player-auth/login', register('BudgetShared1'))
    assert.equal(login.ok, true)
    assert.equal((await post('/player-auth/resume', { token: login.data.token })).ok, true)
    assert.equal((await post('/api/index.php/tool/signup', { device_id: 850003 }, '127.0.0.1',
        { 'x-sp-session': login.data.token })).data.newAccount, 0)
    assert.equal(count(), before + 2)
    assert.equal(budget.inspect().successes, 2)
    for (const url of ['/player-auth/%72egister', '/api/index.php/tool/%73ignup']) {
        const r = await app.inject({ method: 'POST', url, payload: url.includes('player-auth')
            ? register('EncodedBudget3') : { device_id: 850004 } })
        assert.ok(r.statusCode === 404 || r.json().code === 'RATE_LIMITED' || r.json().data_headers?.result_code === 516)
    }
    assert.equal(count(), before + 2, 'encoded paths cannot bypass matched-route controls')
})

test('different sources and both routes share global hourly quota; independent roots are isolated', async t => {
    const { post } = await fixture(t, { sourceSuccessMax: 3, globalSuccessMax: 2 })
    const before = count()
    assert.equal((await post('/player-auth/register', register('BudgetGlobal1'), '198.51.100.1')).ok, true)
    assert.equal((await post('/api/index.php/tool/signup', { device_id: 850010 }, '198.51.100.2')).data.newAccount, 1)
    assert.equal((await post('/player-auth/register', register('BudgetGlobal3'), '198.51.100.3')).code, 'RATE_LIMITED')
    assert.equal((await post('/api/index.php/tool/signup', { device_id: 850011 }, '198.51.100.4')).data_headers.result_code, 516)
    assert.equal(count(), before + 2)
    const other = await fixture(t, { globalSuccessMax: 1 })
    assert.equal((await other.post('/player-auth/register', register('BudgetOtherRoot'))).ok, true)
})

test('initialization failures roll back account/save and release reservations without resetting attempts', async t => {
    let now = 0
    const { post, budget, app } = await fixture(t, { clock: () => now, sourceSuccessMax: 1,
        globalSuccessMax: 1, sourceAttemptMax: 2, globalAttemptMax: 2 })
    const before = count()
    const tables = ['players', 'players_characters', 'players_items', 'player_login_credentials',
        'player_login_sessions', 'device_bindings', 'sessions']
    const state = () => tables.map(table => db.prepare(`SELECT count(*) n FROM ${table}`).get().n)
    const beforeState = state()
    // Viewer-session insertion occurs after the complete default save exists.
    // Reject there to prove rollback of progress, not merely the account row.
    db.exec("CREATE TRIGGER reject_budget_save BEFORE INSERT ON sessions BEGIN SELECT RAISE(ABORT, 'isolated failure'); END")
    try {
        assert.equal((await post('/player-auth/register', register('BudgetFailReg'))).ok, false)
        const signup = await app.inject({ method: 'POST', url: '/api/index.php/tool/signup', payload: { device_id: 850020 } })
        assert.equal(signup.statusCode, 500)
    } finally { db.exec('DROP TRIGGER reject_budget_save') }
    assert.equal(count(), before); assert.deepEqual(state(), beforeState)
    assert.equal(db.prepare('SELECT 1 FROM device_bindings WHERE device_id=850020').get(), undefined)
    assert.equal(budget.inspect().pending, 0); assert.equal(budget.inspect().successes, 0)
    assert.equal((await post('/player-auth/register', register('BudgetAfterFail'))).code, 'RATE_LIMITED')
    assert.equal((await post('/player-auth/register', register('BudgetRotateFail'), '198.51.100.250')).code, 'RATE_LIMITED')
    now += 60_000
    assert.equal((await post('/player-auth/register', register('BudgetAfterFail'))).ok, true)
    assert.equal(budget.inspect().successes, 1)
})

test('registration attempts cannot exhaust existing username or source login quotas', async t => {
    const seed = auth.registerPlayerLogin('BudgetExisting', 'FixturePass7', true)
    const { post } = await fixture(t, { sourceAttemptMax: 2 })
    for (let i = 0; i < 32; i++) {
        const r = await post('/player-auth/register', register(i % 2 ? 'BudgetExisting' : 'RotateBudget' + i))
        if (i >= 2) assert.equal(r.code, 'RATE_LIMITED')
    }
    assert.equal((await post('/player-auth/login', register('BudgetExisting'))).ok, true)
    // A fresh session can still be resumed after admission exhaustion.
    const session = auth.loginPlayer('BudgetExisting', 'FixturePass7', true)
    assert.equal((await post('/player-auth/resume', { token: session.token })).ok, true)
    assert.ok(seed.profile.viewer_id)
})

test('a post-commit transport failure still consumes the durable creation quota', async t => {
    const { post, budget } = await fixture(t, { sourceSuccessMax: 1, globalSuccessMax: 1 })
    const before = count()
    auth.initializePlayerLogin(() => { throw new Error('isolated transport failure after commit') })
    try {
        assert.equal((await post('/player-auth/register', register('BudgetCommittedFailure'))).code, 'SERVER_ERROR')
        assert.equal(count(), before + 1)
        assert.equal(budget.inspect().pending, 0)
        assert.equal(budget.inspect().successes, 1)
        assert.equal((await post('/player-auth/register', register('BudgetBypassFailure'))).code, 'RATE_LIMITED')
    } finally { auth.initializePlayerLogin(() => {}) }
})

test('pausing new creation preserves existing device and signed-in signup/login/resume', async t => {
    auth.registerPlayerLogin('BudgetPauseExisting', 'FixturePass7', true)
    const { post, budget } = await fixture(t, { enabled: false })
    const before = count()
    assert.equal((await post('/player-auth/register', register('BudgetPauseNew'))).code, 'RATE_LIMITED')
    assert.equal((await post('/api/index.php/tool/signup', { device_id: 850030 })).data_headers.result_code, 516)
    assert.equal((await post('/api/index.php/tool/signup', { device_id: 850001 })).data.newAccount, 0)
    const login = await post('/player-auth/login', register('BudgetPauseExisting'))
    assert.equal(login.ok, true)
    assert.equal((await post('/player-auth/resume', { token: login.data.token })).ok, true)
    assert.equal((await post('/api/index.php/tool/signup', { device_id: 850031 }, '127.0.0.1',
        { 'x-sp-session': login.data.token })).data.newAccount, 0)
    assert.equal(count(), before)
    assert.equal(budget.inspect().attempts, 0)
})

test('a stale binding to a deleted account is new creation and remains intact on rejection', async t => {
    const previousForeignKeys = db.pragma('foreign_keys', { simple: true })
    try {
        db.pragma('foreign_keys = OFF')
        db.prepare('INSERT INTO device_bindings(device_id,account_id,last_seen) VALUES(?,?,?)')
            .run(850040, 900000001, new Date().toISOString())
    } finally { db.pragma(`foreign_keys = ${previousForeignKeys}`) }
    const { post } = await fixture(t, { sourceSuccessMax: 1, globalSuccessMax: 1 })
    assert.equal((await post('/api/index.php/tool/signup', { device_id: 850040 })).data.newAccount, 1)
    const before = count()
    try {
        db.pragma('foreign_keys = OFF')
        db.prepare('INSERT INTO device_bindings(device_id,account_id,last_seen) VALUES(?,?,?)')
            .run(850041, 900000002, new Date().toISOString())
    } finally { db.pragma(`foreign_keys = ${previousForeignKeys}`) }
    assert.equal((await post('/api/index.php/tool/signup', { device_id: 850041 })).data_headers.result_code, 516)
    assert.equal(db.prepare('SELECT account_id FROM device_bindings WHERE device_id=850041').get().account_id, 900000002)
    assert.equal(count(), before)
})
