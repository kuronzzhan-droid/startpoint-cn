const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http')
const { setImmediate: nextTurn, setTimeout: delay } = require('node:timers/promises')
const { Worker } = require('node:worker_threads')
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'password-login-queue-'))
process.env.GACHA_SEED_DIR = path.join(process.env.DATA_DIR, 'seeds')
process.env.CN_WRITER_THREAD = '0'
const db = require('../out/data/db').getDb()
const auth = require('../out/lib/player-login')
const coordinator = require('../out/lib/persistence-coordinator')
const { persistenceAdmission, PERSISTENCE_ADMISSION_DEFAULTS } = require('../out/lib/persistence-admission')
const { persistenceWriteGate } = require('../out/lib/persistence-write-gate')
const players = require('../out/data/domains/player')
const disconnected = []
let sequence = 0, failDisconnect = false, onDisconnect
auth.initializePlayerLogin(viewer => {
    disconnected.push({ viewer, inTransaction: db.inTransaction })
    onDisconnect?.()
    if (failDisconnect) throw Error('fixture transport error')
})
db.exec('CREATE TABLE login_queue_probe(value TEXT)')

after(async () => {
    await coordinator.drainPersistence()
    assert.equal(persistenceAdmission.stats().total, 0)
    assert.deepEqual(persistenceWriteGate.stats(), { activeWrites: 0, exclusive: false, waiting: 0 })
    db.close()
})
function subject() {
    const username = 'QueuedLogin' + ++sequence, password = 'FixturePass9'
    const session = auth.registerPlayerLogin(username, password, true)
    const accountId = auth.playerAccountByViewer(session.profile.viewer_id)
    const player = players.getPlayerFromAccountIdSync(accountId)
    players.updatePlayerSync({ id: player.id, name: 'Preserved save ' + sequence, freeVmoney: 76543, expPool: 987 })
    disconnected.length = 0
    return { username, password, accountId, playerId: player.id, session }
}
async function appFor(t, hook) {
    const app = require('fastify')({ logger: false })
    if (hook) app.addHook('onRequest', hook)
    await app.register(require('../out/routes/cn/playerLogin').default)
    await app.ready()
    t.after(() => app.close())
    return app
}
function login(app, user, extra = {}) {
    return app.inject({ method: 'POST', url: '/player-auth/login', payload: {
        username: user.username, password: user.password, ...extra,
    } })
}
function state() {
    return Object.fromEntries(['accounts', 'players', 'sessions', 'player_login_credentials', 'player_login_sessions',
        'player_login_audit', 'player_login_codes', 'player_login_claims'].map(table => [table,
        db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]))
}
async function until(condition) {
    const end = performance.now() + 5000
    while (!condition()) { assert.ok(performance.now() < end, 'fixture queue condition timed out'); await nextTurn() }
}

test('concurrent password logins wait without revoking the old session, then keep one committed session and the same save', async t => {
    const user = subject(), app = await appFor(t), before = state()
    const release = await persistenceWriteGate.acquire(true)
    let finished = 0, admitted
    try {
        admitted = Array.from({ length: 4 }, (_, i) => login(app, user, { username: i % 2 ? user.username.toUpperCase() : user.username, remember: i % 2 === 0 })
            .then(response => { finished++; return response }))
        await until(() => persistenceAdmission.stats().withoutPlayer === 4)
        assert.equal(finished, 0)
        assert.deepEqual(state(), before)
        assert.equal(disconnected.length, 0)
        const resumed = await app.inject({ method: 'POST', url: '/player-auth/resume', payload: { token: user.session.token } })
        assert.equal(resumed.json().ok, true)
    } finally { release() }
    const afterQueue = Date.now(), responses = await Promise.all(admitted)
    const results = responses.map(response => { assert.equal(response.statusCode, 200); assert.equal(response.json().ok, true); return response.json().data })
    assert.equal(new Set(results.map(result => result.token)).size, 4)
    for (const [i, result] of results.entries()) {
        assert.equal(result.profile.viewer_id, user.session.profile.viewer_id)
        assert.equal(result.profile.name, 'Preserved save ' + sequence)
        assert.ok(result.expires_at >= afterQueue + (i % 2 === 0 ? 30 : 0.5) * 86400000)
    }
    const valid = results.filter(result => auth.readPlayerLoginSession(result.token))
    assert.equal(valid.length, 1, 'the established last-login-wins policy stays intact')
    assert.equal(auth.readPlayerLoginSession(user.session.token), null)
    assert.equal(db.prepare('SELECT takeover_udid FROM accounts WHERE id=?').get(user.accountId).takeover_udid, valid[0].udid)
    assert.deepEqual(state().players, before.players)
    assert.deepEqual(state().sessions, before.sessions)
    assert.deepEqual(state().player_login_credentials, before.player_login_credentials)
    assert.equal(disconnected.length, 4)
    assert.ok(disconnected.every(event => event.viewer === user.session.profile.viewer_id && !event.inTransaction))
})

test('32 real password requests fill the bounded queue; overflow never creates an extra waiter or revokes a session', async t => {
    const users = [subject(), subject()], app = await appFor(t), before = state()
    const release = await persistenceWriteGate.acquire(true)
    let finished = 0, responses
    const pending = Array.from({ length: PERSISTENCE_ADMISSION_DEFAULTS.withoutPlayer }, (_, i) => login(app, users[i % 2])
        .then(response => { finished++; return response }))
    try {
        await until(() => persistenceAdmission.stats().withoutPlayer === 32)
        const overflow = await login(app, users[0])
        assert.equal(overflow.json().code, 'SERVER_BUSY')
        assert.equal(finished, 0)
        assert.equal(persistenceAdmission.stats().withoutPlayer, 32)
        assert.deepEqual(state(), before)
        assert.equal(disconnected.length, 0)
        assert.ok(users.every(user => auth.readPlayerLoginSession(user.session.token)))
    } finally { release(); responses = await Promise.all(pending) }
    assert.ok(responses.every(response => response.json().ok === true))
    assert.equal(persistenceAdmission.stats().total, 0)
    assert.deepEqual(state().players, before.players)
    assert.deepEqual(state().player_login_credentials, before.player_login_credentials)
    for (const user of users) assert.equal(db.prepare('SELECT count(*) n FROM player_login_sessions WHERE account_id=?').get(user.accountId).n, 1)
})

test('both account-queue and global-capacity exhaustion reject before session changes and recover after capacity returns', async t => {
    const user = subject(), app = await appFor(t), before = state()
    for (const mode of ['account', 'global']) {
        const releases = Array.from({ length: mode === 'account' ? PERSISTENCE_ADMISSION_DEFAULTS.withoutPlayer : PERSISTENCE_ADMISSION_DEFAULTS.total },
            (_, i) => persistenceAdmission.acquire(mode === 'account' ? undefined : 1000000 + i))
        try {
            const response = await login(app, user)
            assert.equal(response.statusCode, 200)
            assert.deepEqual(response.json(), { ok: false, code: 'SERVER_BUSY', message: '服务器写入繁忙，请稍后重试。' })
            assert.equal(response.headers['retry-after'], '1')
            assert.deepEqual(state(), before)
            assert.equal(disconnected.length, 0)
            assert.ok(auth.readPlayerLoginSession(user.session.token))
            const invalid = await login(app, user, { username: '!' })
            assert.equal(invalid.json().code, 'INVALID_INPUT', 'malformed inputs do not enter the write queue')
        } finally { releases.forEach(release => release()) }
    }
    assert.equal((await login(app, user)).json().ok, true)
    assert.equal(persistenceAdmission.stats().total, 0)
})

test('credentials and account status are reread after earlier queued changes, not trusted from request arrival', async t => {
    const app = await appFor(t)
    for (const field of ['password', 'status']) {
        const user = subject(), release = await persistenceWriteGate.acquire(true)
        const mutation = coordinator.runPersistenceTransaction({ domain: 'account', operation: 'prior_auth_change_fixture' }, () => {
            if (field === 'password') db.prepare('UPDATE player_login_credentials SET password=? WHERE account_id=?').run('ChangedPass8', user.accountId)
            else db.prepare("UPDATE accounts SET status='banned' WHERE id=?").run(user.accountId)
        })
        let pending
        try {
            pending = login(app, user).then(response => response)
            await until(() => persistenceAdmission.stats().withoutPlayer === 2)
            assert.ok(auth.readPlayerLoginSession(user.session.token))
        } finally { release() }
        await mutation
        const response = await pending
        assert.equal(response.json().ok, false)
        assert.equal(response.json().code, 'INVALID_INPUT')
        assert.equal(disconnected.length, 0)
        assert.equal(db.prepare('SELECT token FROM player_login_sessions WHERE account_id=?').get(user.accountId).token, user.session.token)
    }
})

test('a late SQL failure rolls back session replacement, account fields and audit; retry succeeds once', async t => {
    const user = subject(), app = await appFor(t), before = state()
    db.exec(`CREATE TRIGGER fail_password_login BEFORE INSERT ON player_login_audit
        WHEN NEW.account_id=${user.accountId} AND NEW.action='login'
        BEGIN SELECT RAISE(ABORT,'fixture late login failure'); END`)
    try {
        const response = await login(app, user)
        assert.equal(response.json().ok, false)
        assert.equal(response.json().code, 'SERVER_ERROR')
        assert.equal(response.headers['retry-after'], undefined)
        assert.doesNotMatch(response.body, /fixture late login failure|FixturePass9|INSERT|Sqlite/)
        assert.deepEqual(state(), before)
        assert.ok(auth.readPlayerLoginSession(user.session.token))
        assert.equal(disconnected.length, 0)
    } finally { db.exec('DROP TRIGGER fail_password_login') }
    const response = await login(app, user)
    assert.equal(response.json().ok, true)
    assert.ok(auth.readPlayerLoginSession(response.json().data.token))
    assert.equal(state().player_login_audit.length, before.player_login_audit.length + 1)
    assert.deepEqual(state().players, before.players)
})

test('profile preparation failure cannot revoke an existing login or change account metadata', async t => {
    const user = subject(), app = await appFor(t)
    db.prepare('DELETE FROM players WHERE id=?').run(user.playerId)
    const before = state()
    const response = await login(app, user)
    assert.equal(response.json().ok, false)
    assert.equal(response.json().code, 'INVALID_INPUT')
    assert.deepEqual(state(), before)
    assert.equal(disconnected.length, 0)
    assert.throws(() => auth.loginPlayer(user.username, user.password, false), auth.PlayerLoginError)
    assert.deepEqual(state(), before, 'the synchronous compatibility API has the same profile rollback boundary')
})

test('switching accounts disconnects only after commit, preserves the other saved login, and tolerates transport cleanup failure', async t => {
    const destination = subject(), previous = subject(), app = await appFor(t)
    const oldOtherSession = db.prepare('SELECT * FROM player_login_sessions WHERE account_id=?').get(previous.accountId)
    const errors = []
    t.mock.method(console, 'error', (...args) => errors.push(args))
    failDisconnect = true
    let response
    try { response = await login(app, destination, { previous_token: previous.session.token }) }
    finally { failDisconnect = false }
    assert.equal(response.json().ok, true, 'COMMIT success must not be reported as a failed retryable login')
    assert.ok(auth.readPlayerLoginSession(response.json().data.token))
    assert.equal(auth.readPlayerLoginSession(destination.session.token), null)
    assert.deepEqual(db.prepare('SELECT * FROM player_login_sessions WHERE account_id=?').get(previous.accountId), oldOtherSession)
    assert.deepEqual(disconnected.map(event => event.viewer).sort(), [destination.session.profile.viewer_id, previous.session.profile.viewer_id].sort())
    assert.ok(disconnected.every(event => !event.inTransaction))
    assert.deepEqual(errors, Array.from({ length: 2 }, () => ['[PLAYER-LOGIN] transport disconnect failed after committed login']))
})

test('a cancelled queued command keeps the old session and releases admission after it drains', async () => {
    const user = subject(), before = state(), release = await persistenceWriteGate.acquire(true)
    const cancellation = new AbortController()
    const pending = auth.loginPlayerAsync(user.username, user.password, false, { signal: cancellation.signal })
    const rejected = assert.rejects(pending, error => error instanceof auth.PlayerLoginError && error.code === 'REQUEST_CANCELLED')
    try {
        await until(() => persistenceAdmission.stats().withoutPlayer === 1)
        cancellation.abort()
        await rejected
        assert.equal(persistenceAdmission.stats().withoutPlayer, 1, 'cancelled closure still owns its admission')
        assert.deepEqual(state(), before)
    } finally { release() }
    await coordinator.drainPersistence()
    assert.deepEqual(state(), before)
    assert.equal(disconnected.length, 0)
    assert.equal(persistenceAdmission.stats().total, 0)
})

test('repeated cancellation retains all 32 slots until closures drain; new requests cannot build an unbounded tail', async () => {
    const user = subject(), before = state(), release = await persistenceWriteGate.acquire(true)
    const cancellations = Array.from({ length: 32 }, () => new AbortController())
    const outcomes = cancellations.map(cancellation => assert.rejects(
        auth.loginPlayerAsync(user.username, user.password, false, { signal: cancellation.signal }),
        error => error.code === 'REQUEST_CANCELLED'))
    try {
        await until(() => persistenceAdmission.stats().withoutPlayer === 32)
        for (const cancellation of cancellations) { cancellation.abort(); cancellation.abort() }
        await Promise.all(outcomes)
        assert.equal(persistenceAdmission.stats().withoutPlayer, 32)
        for (let attempt = 0; attempt < 64; attempt++) {
            await assert.rejects(auth.loginPlayerAsync(user.username, user.password, false),
                error => error.code === 'PERSISTENCE_QUEUE_FULL')
        }
        assert.equal(persistenceAdmission.stats().total, 32)
        assert.deepEqual(state(), before)
        assert.equal(disconnected.length, 0)
    } finally { release() }
    await coordinator.drainPersistence()
    assert.equal(persistenceAdmission.stats().total, 0)
    assert.deepEqual(state(), before)
    const preCancelled = new AbortController()
    preCancelled.abort()
    await assert.rejects(auth.loginPlayerAsync(user.username, user.password, false, { signal: preCancelled.signal }),
        error => error.code === 'REQUEST_CANCELLED')
    assert.equal(persistenceAdmission.stats().total, 0)
    assert.ok(auth.readPlayerLoginSession((await auth.loginPlayerAsync(user.username, user.password, false)).token))
})

test('a COMMIT failure rolls back the complete login and does not disconnect the existing session', async t => {
    const user = subject(), app = await appFor(t), before = state()
    db.exec(`CREATE TABLE login_commit_parent(id INTEGER PRIMARY KEY);
        CREATE TABLE login_commit_failure(id INTEGER REFERENCES login_commit_parent(id) DEFERRABLE INITIALLY DEFERRED);
        CREATE TRIGGER fail_login_commit AFTER INSERT ON player_login_audit
        WHEN NEW.account_id=${user.accountId} AND NEW.action='login'
        BEGIN INSERT INTO login_commit_failure VALUES(1); END`)
    try {
        const response = await login(app, user)
        assert.equal(response.json().code, 'SERVER_ERROR')
        assert.equal(response.headers['retry-after'], undefined)
        assert.deepEqual(state(), before)
        assert.equal(db.prepare('SELECT count(*) n FROM login_commit_failure').get().n, 0)
        assert.equal(disconnected.length, 0)
        assert.ok(auth.readPlayerLoginSession(user.session.token))
    } finally { db.exec('DROP TRIGGER fail_login_commit') }
    const response = await login(app, user)
    assert.equal(response.json().ok, true)
    assert.deepEqual(state().players, before.players)
})

test('cancellation from post-COMMIT transport cleanup cannot turn a committed login into failure', async () => {
    const user = subject(), cancellation = new AbortController()
    onDisconnect = () => cancellation.abort()
    let response
    try { response = await auth.loginPlayerAsync(user.username, user.password, false, { signal: cancellation.signal }) }
    finally { onDisconnect = undefined }
    assert.equal(cancellation.signal.aborted, true)
    assert.ok(auth.readPlayerLoginSession(response.token))
    assert.equal(auth.readPlayerLoginSession(user.session.token), null)
    assert.ok(disconnected.every(event => !event.inTransaction))
})

test('a native background lock beyond 15 seconds expires login before delayed client-close propagation and restores capacity', { timeout: 30000 }, async t => {
    const user = subject(), before = state(), app = await appFor(t)
    await app.listen({ host: '127.0.0.1', port: 0 })
    let worker, locked
    const ready = new Promise(resolve => { locked = resolve })
    const background = coordinator.runBackgroundPersistenceTask({ domain: 'leaderboard', operation: 'login_timeout_lock_fixture' }, () => {
        worker = new Worker(`const {parentPort,workerData}=require('node:worker_threads');
            const Database=require(workerData.module);const connection=new Database(workerData.databasePath);
            connection.exec('BEGIN IMMEDIATE');parentPort.postMessage('locked');
            parentPort.once('message',()=>{connection.exec('ROLLBACK');connection.close();parentPort.close()});`,
            { eval: true, workerData: { module: require.resolve('better-sqlite3'), databasePath: db.name } })
        return new Promise((resolve, reject) => {
            worker.once('message', locked)
            worker.once('error', reject)
            worker.once('exit', code => code === 0 ? resolve() : reject(Error('fixture worker exited ' + code)))
        })
    })
    // Observe startup failure immediately while preserving it for the final await.
    void background.catch(() => locked())
    await ready
    const start = performance.now(), clientControllers = [new AbortController(), new AbortController()]
    const cancelled = clientControllers.map(cancellation => assert.rejects(
        auth.loginPlayerAsync(user.username, user.password, false, { signal: cancellation.signal }),
        error => error.code === 'REQUEST_CANCELLED'))
    let forwarded, serverReply, closeAt
    // An isolated proxy buffers the result and deliberately delays forwarding
    // the downstream close, reproducing the relevant deployment uncertainty.
    const upstreamReply = new Promise(resolve => { serverReply = resolve })
    const proxy = http.createServer((request, response) => {
        forwarded = http.request({ host: '127.0.0.1', port: app.server.address().port,
            method: request.method, path: request.url, headers: request.headers }, incoming => {
            let text = ''
            incoming.setEncoding('utf8'); incoming.on('data', chunk => { text += chunk })
            incoming.on('end', () => serverReply({ elapsed: performance.now() - start, result: JSON.parse(text), headers: incoming.headers }))
        })
        forwarded.on('error', () => {})
        request.pipe(forwarded)
        response.on('close', () => { closeAt = performance.now() - start })
    })
    await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve))
    const body = JSON.stringify({ username: user.username, password: user.password })
    const client = http.request({ host: '127.0.0.1', port: proxy.address().port, method: 'POST', path: '/player-auth/login',
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } })
    client.on('error', () => {})
    const clientTimeout = setTimeout(() => client.destroy(), 15000)
    client.end(body)
    try {
        await until(() => persistenceAdmission.stats().withoutPlayer === 4)
        for (const cancellation of clientControllers) { cancellation.abort(); cancellation.abort() }
        await Promise.all(cancelled)
        const refusal = await upstreamReply
        assert.equal(refusal.result.code, 'SERVER_BUSY')
        assert.equal(refusal.headers['retry-after'], '1')
        assert.ok(refusal.elapsed >= auth.PASSWORD_LOGIN_QUEUE_TIMEOUT_MS - 50 && refusal.elapsed < 15000,
            'server queue deadline precedes the client timeout: ' + refusal.elapsed)
        assert.equal(persistenceAdmission.stats().withoutPlayer, 4, 'all retained closures plus background still consume slots')
        assert.deepEqual(state(), before)
        assert.equal(disconnected.length, 0)
        assert.throws(() => db.prepare("INSERT INTO login_queue_probe VALUES('lock-check')").run(), error => error.code === 'SQLITE_BUSY')
        await delay(Math.max(0, 16000 - (performance.now() - start)))
        await until(() => closeAt !== undefined)
        assert.ok(closeAt >= 14900, 'the real client used a 15-second close window')
        assert.deepEqual(state(), before, 'proxy-delayed close cannot authorize a late session replacement')
        assert.ok(auth.readPlayerLoginSession(user.session.token))
        assert.equal(persistenceAdmission.stats().withoutPlayer, 4)
        t.diagnostic(JSON.stringify({ serverBusyAfterMs: refusal.elapsed, clientClosedAfterMs: closeAt,
            backgroundLockHeldMs: performance.now() - start, retainedSlots: 4 }))
    } finally {
        clearTimeout(clientTimeout); client.destroy(); forwarded?.destroy()
        await new Promise(resolve => proxy.close(resolve))
        worker?.postMessage('release')
        await background
        await coordinator.drainPersistence()
    }
    assert.deepEqual(state(), before)
    assert.equal(persistenceAdmission.stats().total, 0)
    assert.equal(disconnected.length, 0)
    const recovered = await login(app, user)
    assert.equal(recovered.json().ok, true)
    assert.deepEqual(state().players, before.players)
})

test('a real HTTP client leaving while queued does not replace its still-valid session later', async t => {
    const user = subject(), before = state()
    let closed
    const serverClosed = new Promise(resolve => { closed = resolve })
    const app = await appFor(t, (_request, reply, done) => { reply.raw.once('close', closed); done() })
    await app.listen({ host: '127.0.0.1', port: 0 })
    const release = await persistenceWriteGate.acquire(true)
    const body = JSON.stringify({ username: user.username, password: user.password })
    const request = http.request({ host: '127.0.0.1', port: app.server.address().port, method: 'POST', path: '/player-auth/login',
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } })
    request.on('error', () => {})
    request.end(body)
    try {
        await until(() => persistenceAdmission.stats().withoutPlayer === 1)
        request.destroy()
        await serverClosed
    } finally { request.destroy(); release() }
    await coordinator.drainPersistence()
    assert.deepEqual(state(), before)
    assert.equal(disconnected.length, 0)
    assert.ok(auth.readPlayerLoginSession(user.session.token))
})
