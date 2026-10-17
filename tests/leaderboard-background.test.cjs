const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { Worker } = require('node:worker_threads')
const { performance } = require('node:perf_hooks')
const { setImmediate: nextTurn } = require('node:timers/promises')
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'leaderboard-background-'))
process.env.GACHA_SEED_DIR = path.join(process.env.DATA_DIR, 'seeds')
process.env.CN_WRITER_THREAD = '0'
const db = require('../out/data/db').getDb()
const coordinator = require('../out/lib/persistence-coordinator')
const background = require('../out/lib/leaderboard/background-worker')
const settlement = require('../out/lib/leaderboard/settlement')
const availability = require('../out/lib/leaderboard/availability')
const competitions = require('../out/lib/leaderboard/competition')
const { persistenceWriteGate } = require('../out/lib/persistence-write-gate')
const { persistenceAdmission, PersistenceMaintenanceBusyError } = require('../out/lib/persistence-admission')
const key = 'rush:700099:1', extraKey = 'rush:700100:1'
const accountApi = require('../out/data/domains/account')
const players = require('../out/data/domains/player')
const account = accountApi.insertAccountSync({ appId: 'wf_cn', idpAlias: '', idpCode: 'human', idpId: '', status: 'normal' })
const owner = players.insertDefaultPlayerSync(account.id).id
const columns = db.prepare('PRAGMA table_info(players)').all().filter(row => row.name !== 'id').map(row => '"' + row.name + '"').join(',')
const clone = db.prepare(`INSERT INTO players(${columns}) SELECT ${columns} FROM players WHERE id=?`)
const ids = db.transaction(() => Array.from({ length: 20_000 }, () => Number(clone.run(owner).lastInsertRowid)))()
const insertRun = db.prepare(`INSERT INTO leaderboard_runs(competition_key,player_id,season,status,started_at_ms,finished_at_ms,
    client_battle_ms,rounds_cleared,total_rounds,tracked_from_round) VALUES(?,?,1,'completed',1,2,?,1,1,1)`)
const insertRound = db.prepare(`INSERT INTO leaderboard_run_rounds(run_id,round_number,quest_id,client_battle_ms,server_elapsed_ms,started_at_ms,finished_at_ms)
    VALUES(?,1,1,100,100,1,2)`)
for (const competitionKey of [key, extraKey]) {
    competitions.getLeaderboardCompetitionSeasonSync(competitionKey)
    availability.getLeaderboardAvailabilitySync(competitionKey)
}
const configs = new Map([key, extraKey].map(k => [k, settlement.getLeaderboardSettlementConfigSync(k)]))
db.exec('CREATE TABLE background_write_probe(label TEXT); CREATE TABLE writer_test(id INTEGER PRIMARY KEY AUTOINCREMENT, value TEXT NOT NULL)')
const metrics = {}
after(async () => {
    await coordinator.drainPersistence()
    assert.deepEqual(persistenceWriteGate.stats(), { activeWrites: 0, exclusive: false, waiting: 0 })
    assert.equal(persistenceAdmission.stats().total, 0)
    db.close()
    console.log('BACKGROUND_BENCHMARK ' + JSON.stringify(metrics))
    if (process.env.SECURITY_BACKGROUND_BENCHMARK_RESULT) fs.writeFileSync(process.env.SECURITY_BACKGROUND_BENCHMARK_RESULT, JSON.stringify(metrics, null, 2) + '\n')
})
function reset() {
    assert.equal(persistenceWriteGate.stats().exclusive, false)
    db.transaction(() => {
        for (const table of ['leaderboard_settlement_results', 'leaderboard_settlements', 'leaderboard_run_rounds',
            'leaderboard_runs', 'players_mails', 'background_write_probe']) db.exec(`DELETE FROM ${table}`)
        for (const k of [key, extraKey]) {
            settlement.putLeaderboardSettlementConfigSync({ ...configs.get(k), autoEnabled: false, freezeEnabled: false, settleAtMs: null })
            availability.setLeaderboardAvailabilitySync(k, true)
        }
    })()
}
function addRun(playerId, competitionKey = key, time = 100) {
    insertRound.run(Number(insertRun.run(competitionKey, playerId, time).lastInsertRowid))
}
function seed(count) { db.transaction(() => ids.slice(0, count).forEach((id, i) => addRun(id, key, 100 + i % 10)))() }
function job(scheduled = false) { return { competitionKey: key, source: 'fixture', nowMs: Date.now(), scheduled } }
const count = table => db.prepare(`SELECT count(*) n FROM ${table}`).get().n
function assertEmptyAwards() {
    for (const table of ['leaderboard_settlements', 'leaderboard_settlement_results', 'players_mails']) assert.equal(count(table), 0, table)
}
function validateAwards(outcome, total, otherMails = 0) {
    assert.equal(outcome.ok, true)
    assert.equal(outcome.rankedPlayers, total)
    assert.equal(outcome.rewardedPlayers, total)
    const bounds = db.prepare(`SELECT count(*) n, count(DISTINCT player_id) players, min(rank_number) first, max(rank_number) last
        FROM leaderboard_settlement_results WHERE settlement_id=?`).get(outcome.settlementId)
    assert.deepEqual(bounds, { n: total, players: total, first: 1, last: total })
    const resolved = settlement.getLeaderboardSeasonRewardViewSync(key, 1).rewardTiers
    let expectedMails = 0
    for (const tier of resolved) {
        const last = tier.toRank ?? total, n = Math.max(0, Math.min(total, last) - tier.fromRank + 1)
        assert.equal(db.prepare(`SELECT count(*) n FROM leaderboard_settlement_results WHERE settlement_id=?
            AND rank_number BETWEEN ? AND ? AND item_id IS ? AND item_count=? AND degree_id IS ? AND skip_reason IS NULL`)
            .get(outcome.settlementId, tier.fromRank, last, tier.itemId, tier.itemCount, tier.degreeId).n, n)
        expectedMails += n * (Number(tier.itemId !== null) + Number(tier.degreeId !== null))
    }
    const mailLinks = db.prepare(`SELECT count(*) n, count(DISTINCT CAST(j.value AS INTEGER)) uniqueMails,
        sum(CASE WHEN m.id IS NULL OR m.player_id <> r.player_id THEN 1 ELSE 0 END) invalid
        FROM leaderboard_settlement_results r, json_each(r.mail_ids_json) j
        LEFT JOIN players_mails m ON m.id=CAST(j.value AS INTEGER) WHERE r.settlement_id=?`).get(outcome.settlementId)
    assert.deepEqual(mailLinks, { n: expectedMails, uniqueMails: expectedMails, invalid: 0 })
    assert.equal(count('players_mails'), expectedMails + otherMails, 'every issued mail is covered by exactly one committed receipt')
}

test('20,000 eligible players settle completely off-thread while reads respond and admitted writes wait', async t => {
    reset(); seed(ids.length); addRun(ids[0], key, 90)
    const botAccount = accountApi.insertAccountSync({ appId: 'wf_cn', idpAlias: '', idpCode: 'rushbot', idpId: '', status: 'normal' })
    const bot = Number(clone.run(owner).lastInsertRowid)
    db.prepare('UPDATE players SET account_id=? WHERE id=?').run(botAccount.id, bot)
    addRun(bot, key, 1)
    const deleted = Number(clone.run(owner).lastInsertRowid); addRun(deleted, key, 1)
    db.prepare('DELETE FROM players WHERE id=?').run(deleted)
    let began
    const started = new Promise(resolve => { began = resolve })
    const original = background.runLeaderboardSettlementInBackground
    t.mock.method(background, 'runLeaderboardSettlementInBackground', input => original(input, {
        createWorker: (file, options) => {
            const worker = new Worker(file, options)
            worker.on('message', message => { if (message.type === 'started') began() })
            return worker
        },
    }))
    const app = require('fastify')({ logger: false })
    app.get('/fixture/read', () => ({ players: count('players'), results: count('leaderboard_settlement_results') }))
    await app.register(require('../out/routes/web_api/leaderboards').default, { prefix: '/api/leaderboards' })
    await app.ready(); t.after(() => app.close())
    const base = '/api/leaderboards/' + encodeURIComponent(key)
    let last = performance.now(), maxGap = 0, ticks = 0
    const timer = setInterval(() => { const now = performance.now(); maxGap = Math.max(maxGap, now - last); last = now; ticks++ }, 5)
    const beforeTimeout = db.pragma('busy_timeout', { simple: true }), start = performance.now()
    let queued
    try {
        const response = app.inject({ method: 'POST', url: base + '/settle' })
        await started
        assert.equal(persistenceWriteGate.stats().exclusive, true)
        assert.equal(db.pragma('busy_timeout', { simple: true }), 0)
        let wrote = false
        queued = coordinator.runPersistenceTransaction({ domain: 'player', playerId: owner, operation: 'fixture_during_settlement' }, () => {
            db.prepare('INSERT INTO background_write_probe VALUES(?)').run('after-settlement'); wrote = true
        })
        const refusedAt = performance.now()
        assert.throws(() => coordinator.runPersistenceTransactionSync({ domain: 'player', playerId: owner, operation: 'fixture_sync' },
            () => assert.fail('synchronous write must be refused before SQL')), PersistenceMaintenanceBusyError)
        assert.throws(() => db.prepare("INSERT INTO background_write_probe VALUES('legacy-raw')").run(), error => error.code === 'SQLITE_BUSY')
        metrics.rawWriteRefusalMs = performance.now() - refusedAt
        assert.ok(metrics.rawWriteRefusalMs < 250, `raw writer blocked for ${metrics.rawWriteRefusalMs} ms`)
        assert.equal((await app.inject('/fixture/read')).statusCode, 200)
        assert.equal((await app.inject({ method: 'POST', url: base + '/settle' })).statusCode, 429)
        assert.equal((await app.inject({ method: 'POST', url: base + '/rollover' })).statusCode, 429)
        assert.equal((await app.inject({ method: 'PATCH', url: base + '/config', payload: { mailSubject: 'must not change' } })).statusCode, 503)
        assert.equal(wrote, false)
        const result = await response
        metrics.worker20000PlayersMs = performance.now() - start
        clearInterval(timer)
        assert.equal(result.statusCode, 200, result.body)
        validateAwards(result.json(), ids.length)
        await queued
        assert.equal(wrote, true)
        assert.equal(count('background_write_probe'), 1)
    } finally { clearInterval(timer); if (queued) await queued }
    assert.equal(db.pragma('busy_timeout', { simple: true }), beforeTimeout)
    assert.ok(ticks > 10, `heartbeat count ${ticks}`)
    assert.ok(maxGap < 250, `main-thread heartbeat gap ${maxGap} ms`)
    Object.assign(metrics, { heartbeatTicks: ticks, mainThreadMaxGapMs: maxGap, players: ids.length })
    assert.equal(db.prepare('SELECT clear_count FROM leaderboard_settlement_results WHERE player_id=?').get(ids[0]).clear_count, 2)
    const before = count('players_mails')
    const repeat = await original(job())
    assert.equal(repeat.reason, 'already-settled')
    assert.equal(count('players_mails'), before)
})

test('a later batch SQL failure rolls back mails, receipts and manual freeze; retry sends every reward once', async () => {
    reset(); seed(300)
    const beforeAvailability = db.prepare('SELECT * FROM leaderboard_availability WHERE competition_key=?').get(key)
    db.exec("CREATE TRIGGER fail_background_batch BEFORE INSERT ON leaderboard_settlement_results WHEN NEW.rank_number=258 BEGIN SELECT RAISE(ABORT,'later worker batch failure'); END")
    try { await assert.rejects(background.runLeaderboardSettlementInBackground(job()), /later worker batch failure/) }
    finally { db.exec('DROP TRIGGER fail_background_batch') }
    assertEmptyAwards()
    assert.deepEqual(db.prepare('SELECT * FROM leaderboard_availability WHERE competition_key=?').get(key), beforeAvailability)
    const outcome = await background.runLeaderboardSettlementInBackground(job())
    validateAwards(outcome, 300)
    const before = count('players_mails')
    assert.equal((await background.runLeaderboardSettlementInBackground(job())).settlementId, outcome.settlementId)
    assert.equal(count('players_mails'), before)
})

function barrierWorker(file, options, barrier, signal) {
    const connection = path.resolve(__dirname, '../out/lib/persistence/writer-connection.js')
    // Only this fixture registers the trigger function; the production worker
    // and its real settlement loop run unchanged below it.
    return new Worker(`const {workerData,parentPort}=require('node:worker_threads');
        const connection=require(${JSON.stringify(connection)}), open=connection.openWriterConnection;
        connection.openWriterConnection=options=>{const db=open(options);db.function('fixture_barrier',rank=>{
            if(rank===258){parentPort.postMessage({type:'fixture-partial'});Atomics.wait(new Int32Array(workerData.barrier),0,0);}
            return 0;});return db;};require(${JSON.stringify(file)});`,
    { ...options, eval: true, workerData: { ...options.workerData, barrier } }).on('message', message => {
        if (message.type === 'fixture-partial') signal()
    })
}

test('worker termination after 258 rank writes releases native locks and rolls back; restart can settle once', async () => {
    reset(); seed(300)
    const barrier = new SharedArrayBuffer(4)
    db.exec('CREATE TRIGGER pause_background_batch AFTER INSERT ON leaderboard_settlement_results BEGIN SELECT fixture_barrier(NEW.rank_number); END')
    let stopped
    const partial = new Promise(resolve => { stopped = resolve })
    let worker
    const pending = background.runLeaderboardSettlementInBackground(job(), { createWorker: (file, options) => (
        worker = barrierWorker(file, options, barrier, stopped)
    ) })
    const rejected = assert.rejects(pending, /exited without a result/)
    await partial
    assertEmptyAwards() // Uncommitted work is invisible on the main WAL reader.
    await worker.terminate(); await rejected
    db.exec('DROP TRIGGER pause_background_batch')
    assertEmptyAwards()
    assert.equal(persistenceWriteGate.stats().exclusive, false)
    validateAwards(await background.runLeaderboardSettlementInBackground(job()), 300)
})

test('CN load and password login wait for background commit while the existing session stays readable', async t => {
    reset(); seed(300)
    const auth = require('../out/lib/player-login')
    auth.initializePlayerLogin()
    const signedIn = auth.registerPlayerLogin('BackgroundLogin', 'FixturePass9', true)
    const loginAccountId = auth.playerAccountByViewer(signedIn.profile.viewer_id)
    const loginPlayer = players.getPlayerFromAccountIdSync(loginAccountId)
    const { CnResponseWorkerPool } = require('../out/lib/cn-response-worker-pool')
    const { installCnResponseEncoding } = require('../out/lib/cn-response-hook')
    const app = require('fastify')({ logger: false })
    require('../out/lib/persistence-http-errors').installPersistenceHttpErrors(app)
    installCnResponseEncoding(app, { pool: new CnResponseWorkerPool({ size: 0 }), compression: { mode: 'off' } })
    const timers = [], originalInterval = global.setInterval
    try {
        global.setInterval = (...args) => { const timer = originalInterval(...args); timers.push(timer); return timer }
        await app.register(require('../out/routes/cn/load').default, { prefix: '/api/index.php' })
    } finally { global.setInterval = originalInterval }
    await app.register(require('../out/routes/cn/playerLogin').default)
    await app.ready()
    t.after(async () => { await app.close(); for (const timer of timers) clearInterval(timer) })
    const sessionsBefore = db.prepare('SELECT * FROM player_login_sessions WHERE account_id=?').all(loginAccountId)
    const barrier = new SharedArrayBuffer(4)
    db.exec('CREATE TRIGGER pause_background_load AFTER INSERT ON leaderboard_settlement_results BEGIN SELECT fixture_barrier(NEW.rank_number); END')
    let signal, load, login, loaded = false, loggedIn = false
    const partial = new Promise(resolve => { signal = resolve })
    const work = background.runLeaderboardSettlementInBackground(job(), {
        createWorker: (file, options) => barrierWorker(file, options, barrier, signal),
    })
    try {
        await partial
        load = app.inject({ method: 'POST', url: '/api/index.php/load', headers: { device: 'android' },
            payload: { viewer_id: signedIn.profile.viewer_id } }).then(response => { loaded = true; return response })
        while (persistenceAdmission.stats().total < 2 && !loaded) await nextTurn()
        assert.equal(loaded, false, 'load must wait without being rejected or returning a stale snapshot')
        const resumed = (await app.inject({ method: 'POST', url: '/player-auth/resume', payload: { token: signedIn.token } })).json()
        assert.equal(resumed.ok, true)
        assert.equal(resumed.data.profile.viewer_id, signedIn.profile.viewer_id)
        login = app.inject({ method: 'POST', url: '/player-auth/login',
            payload: { username: 'BackgroundLogin', password: 'FixturePass9' } }).then(response => { loggedIn = true; return response.json() })
        while (persistenceAdmission.stats().total < 3 && !loggedIn) await nextTurn()
        assert.equal(loggedIn, false, 'password login waits for background ownership')
        assert.deepEqual(db.prepare('SELECT * FROM player_login_sessions WHERE account_id=?').all(loginAccountId), sessionsBefore)
    } finally {
        Atomics.store(new Int32Array(barrier), 0, 1); Atomics.notify(new Int32Array(barrier), 0)
        await work
        if (load) await load
        if (login) await login
        db.exec('DROP TRIGGER pause_background_load')
    }
    const response = await load
    assert.equal(response.statusCode, 200)
    const decoded = require('msgpackr').unpack(Buffer.from(response.body, 'base64'))
    assert.equal(decoded.data_headers.result_code, 1)
    assert.equal(auth.playerAccountByViewer(signedIn.profile.viewer_id), loginAccountId)
    assert.equal(players.getPlayerFromAccountIdSync(loginAccountId).id, loginPlayer.id)
    const signedInAgain = await login
    assert.equal(signedInAgain.ok, true)
    assert.equal(signedInAgain.data.profile.viewer_id, signedIn.profile.viewer_id)
    assert.equal(auth.readPlayerLoginSession(signedIn.token), null)
    assert.ok(auth.readPlayerLoginSession(signedInAgain.data.token))
})

test('lost worker response after COMMIT resolves from the durable season and never duplicates mail', async () => {
    reset(); seed(15)
    const outcome = await background.runLeaderboardSettlementInBackground(job(), { createWorker: (file, options) => (
        new Worker(`const {parentPort}=require('node:worker_threads');const send=parentPort.postMessage.bind(parentPort);
            parentPort.postMessage=message=>{if(message.type!=='result')send(message)};require(${JSON.stringify(file)});`, { ...options, eval: true })
    ) })
    assert.equal(outcome.reason, 'already-settled')
    validateAwards(outcome, 15)
    const before = count('players_mails')
    assert.equal((await background.runLeaderboardSettlementInBackground(job())).settlementId, outcome.settlementId)
    assert.equal(count('players_mails'), before)
})

test('startup failure and timeout never fall back to the main thread and restore write admission', async () => {
    reset(); seed(10)
    const timeoutBefore = db.pragma('busy_timeout', { simple: true })
    await assert.rejects(background.runLeaderboardSettlementInBackground(job(), { createWorker: () => { throw new Error('fixture startup failure') } }), /fixture startup failure/)
    assertEmptyAwards()
    await assert.rejects(background.runLeaderboardSettlementInBackground(job(), { timeoutMs: 50,
        createWorker: () => new Worker('setInterval(()=>{},1000)', { eval: true }),
    }), /timed out/)
    assertEmptyAwards()
    assert.equal(db.pragma('busy_timeout', { simple: true }), timeoutBefore)
    assert.equal(persistenceWriteGate.stats().exclusive, false)
    await coordinator.runPersistenceTransaction({ domain: 'player', playerId: owner, operation: 'after_failed_start' }, () => {
        db.prepare("INSERT INTO background_write_probe VALUES('after-failure')").run()
    })
    assert.equal(count('background_write_probe'), 1)
})

test('automatic settlement commits schedules with rewards, retries failures without starving other competitions, and stops after its accepted job', async () => {
    reset(); seed(300)
    db.transaction(() => ids.slice(0, 3).forEach(id => addRun(id, extraKey)))()
    const now = Date.now()
    for (const k of [key, extraKey]) settlement.putLeaderboardSettlementConfigSync({ ...configs.get(k),
        autoEnabled: true, freezeEnabled: true, settleAtMs: now - 1, repeatIntervalMs: null })
    // Fail after all awards have been built, at the schedule's final update.
    db.exec(`CREATE TRIGGER fail_auto_batch BEFORE UPDATE ON leaderboard_settlement_configs
        WHEN NEW.competition_key='rush:700099:1' AND NEW.auto_enabled=0
        BEGIN SELECT RAISE(ABORT,'auto worker failure'); END`)
    try { await assert.rejects(settlement.runDueLeaderboardSettlements(now), /auto worker failure/) }
    finally { db.exec('DROP TRIGGER fail_auto_batch') }
    assert.equal(count('leaderboard_settlement_results'), 3)
    const otherMails = count('players_mails')
    assert.ok(otherMails > 0)
    assert.equal(db.prepare('SELECT sum(json_array_length(mail_ids_json)) n FROM leaderboard_settlement_results').get().n, otherMails)
    assert.equal(db.prepare('SELECT count(*) n FROM leaderboard_settlements WHERE competition_key=?').get(key).n, 0)
    assert.equal(db.prepare("SELECT count(*) n FROM leaderboard_settlements WHERE competition_key=? AND status='completed'").get(extraKey).n, 1)
    assert.equal(settlement.getLeaderboardSettlementConfigSync(extraKey).autoEnabled, false, 'another due competition is not starved')
    assert.equal(availability.isLeaderboardEnabledSync(key, now), false)
    assert.equal(settlement.getLeaderboardSettlementConfigSync(key).autoEnabled, true)
    assert.equal(settlement.getLeaderboardSettlementConfigSync(key).settleAtMs, now - 1)
    const scheduler = settlement.createLeaderboardSettlementScheduler()
    scheduler.start(); await scheduler.stop()
    assert.equal(count('leaderboard_settlements'), 2)
    assert.equal(settlement.getLeaderboardSettlementConfigSync(key).autoEnabled, false)
    assert.equal(settlement.getLeaderboardSettlementConfigSync(extraKey).autoEnabled, false)
    const receipt = db.prepare('SELECT id settlementId, ranked_players rankedPlayers, rewarded_players rewardedPlayers FROM leaderboard_settlements WHERE competition_key=?').get(key)
    validateAwards({ ok: true, ...receipt }, 300, otherMails)
    const mails = count('players_mails')
    await settlement.runDueLeaderboardSettlements(now + 1000)
    assert.equal(count('players_mails'), mails)
})

test('optional SQLite writer commands drain before background ownership and resume after it', async () => {
    reset(); seed(10)
    const writer = require('../out/lib/persistence/writer-client')
    const commands = path.resolve(__dirname, 'helpers/writer-test-commands.cjs')
    require(commands)
    const previousCommands = process.env.SQLITE_WRITER_EXTRA_COMMANDS
    process.env.SQLITE_WRITER_EXTRA_COMMANDS = commands
    assert.equal(writer.startSqliteWriter(db.name, { ...process.env, CN_WRITER_THREAD: '1', SQLITE_WRITER_EXTRA_COMMANDS: commands,
        SQLITE_WRITER_COMMAND_TIMEOUT_MS: '0', SQLITE_GROUP_COMMIT_WINDOW_MS: '0' }), true)
    assert.equal(await writer.waitForSqliteWriterReady(5000), true)
    try {
        let lastTick = performance.now(), maxGap = 0
        const timer = setInterval(() => { const now = performance.now(); maxGap = Math.max(maxGap, now - lastTick); lastTick = now }, 5)
        const first = coordinator.runWriterCommand('test.slow', { ms: 400 }, { domain: 'player', playerId: owner, operation: 'prior-writer' })
        const work = background.runLeaderboardSettlementInBackground(job())
        const last = coordinator.runWriterCommand('test.insert', { value: 'after-background' }, { domain: 'player', playerId: owner, operation: 'later-writer' })
        const results = await Promise.allSettled([first, work, last]).finally(() => clearInterval(timer))
        for (const result of results) assert.equal(result.status, 'fulfilled', result.reason?.stack)
        assert.equal(results[0].value.sleptMs, 400)
        validateAwards(results[1].value, 10)
        assert.ok(maxGap < 250, `preparation blocked on prior writer: ${maxGap} ms`)
        assert.equal(db.prepare("SELECT count(*) n FROM writer_test WHERE value='after-background'").get().n, 1)

        reset(); seed(10)
        settlement.putLeaderboardSettlementConfigSync({ ...configs.get(key), autoEnabled: true, freezeEnabled: true, settleAtMs: Date.now() - 1 })
        const prior = coordinator.runWriterCommand('test.slow', { ms: 400 }, { domain: 'player', playerId: owner, operation: 'prior-scheduler' })
        while (writer.sqliteWriterStats().inFlight === 0) await nextTurn()
        const scheduler = settlement.createLeaderboardSettlementScheduler()
        const tickStarted = performance.now()
        scheduler.start()
        assert.ok(performance.now() - tickStarted < 250, 'synchronous deadline catch-up must not wait on the prior writer')
        await Promise.all([prior, scheduler.stop()])
        assert.equal(count('leaderboard_settlements'), 1)
        assert.equal(settlement.getLeaderboardSettlementConfigSync(key).autoEnabled, false)
    } finally {
        await writer.stopSqliteWriter()
        if (previousCommands === undefined) delete process.env.SQLITE_WRITER_EXTRA_COMMANDS
        else process.env.SQLITE_WRITER_EXTRA_COMMANDS = previousCommands
    }
})

test('manual settlement captures its timestamp after queued writes finish', async () => {
    reset(); seed(1)
    const release = await persistenceWriteGate.acquire(false)
    const calledAt = Date.now()
    const pending = settlement.settleLeaderboardSeason(key, 'queued-clock-fixture')
    let releasedAt
    try {
        while (persistenceWriteGate.stats().waiting === 0 || Date.now() <= calledAt) await nextTurn()
        releasedAt = Date.now()
    } finally { release() }
    const outcome = await pending
    const row = db.prepare('SELECT settled_at_ms FROM leaderboard_settlements WHERE id=?').get(outcome.settlementId)
    assert.ok(row.settled_at_ms >= releasedAt, 'manual timestamp must include the queue delay')
    validateAwards(outcome, 1)
})

test('background ownership is not starved by new writes and refuses nested asynchronous ownership', async () => {
    const gate = require('../out/lib/persistence-write-gate').createPersistenceWriteGate()
    const releaseFirst = await gate.acquire(false), releaseSecond = await gate.acquire(false)
    let backgroundEntered = false, lateEntered = false
    const backgroundWait = gate.acquire(true).then(release => { backgroundEntered = true; return release })
    const lateWait = gate.acquire(false).then(release => { lateEntered = true; return release })
    releaseFirst(); await nextTurn()
    assert.equal(backgroundEntered, false)
    releaseSecond()
    const releaseBackground = await backgroundWait
    assert.equal(lateEntered, false)
    assert.throws(() => gate.assertSynchronousWriteAllowed(), PersistenceMaintenanceBusyError)
    releaseBackground(); (await lateWait)()
    assert.deepEqual(gate.stats(), { activeWrites: 0, exclusive: false, waiting: 0 })
    await assert.rejects(coordinator.runPersistenceTransaction({ domain: 'leaderboard', operation: 'bad_nested_fixture' }, () => (
        coordinator.runBackgroundPersistenceTask({ domain: 'leaderboard', operation: 'nested_background' }, async () => assert.fail('nested worker started'))
    )), /cannot start inside/)
    assert.equal(persistenceAdmission.stats().total, 0)
})
