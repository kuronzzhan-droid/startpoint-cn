const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { performance } = require('node:perf_hooks')
const Fastify = require('fastify')
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leaderboard-sync-limit-'))
process.env.DATA_DIR = dir
process.env.CN_WRITER_THREAD = '0'
const db = require('../out/data/db').getDb()
const ranks = require('../out/data/domains/leaderboard')
const competitions = require('../out/lib/leaderboard/competition')
const availability = require('../out/lib/leaderboard/availability')
const settlement = require('../out/lib/leaderboard/settlement')
const { checkSynchronousSettlementSize: check, LeaderboardSyncLimitError, SYNCHRONOUS_SETTLEMENT_LIMITS: limits } = require('../out/lib/leaderboard/sync-budget')
const { persistenceAdmission } = require('../out/lib/persistence-admission')
const coordinator = require('../out/lib/persistence-coordinator')
const account = require('../out/data/domains/account').insertAccountSync({ appId: 'wf_cn', idpAlias: '', idpCode: 'leiting', idpId: '', status: 'normal' })
const first = require('../out/data/domains/player').insertDefaultPlayerSync(account.id).id
const columns = db.prepare('PRAGMA table_info(players)').all().filter(row => row.name !== 'id').map(row => '"' + row.name + '"').join(',')
const clone = db.prepare(`INSERT INTO players(${columns}) SELECT ${columns} FROM players WHERE id=?`)
const insertRun = db.prepare(`INSERT INTO leaderboard_runs(competition_key,player_id,season,status,started_at_ms,finished_at_ms,
    client_battle_ms,rounds_cleared,total_rounds,tracked_from_round) VALUES(?,?,1,'completed',1,2,100,?, ?,1)`)
const insertRound = db.prepare(`INSERT INTO leaderboard_run_rounds(run_id,round_number,quest_id,client_battle_ms,server_elapsed_ms,started_at_ms,finished_at_ms)
    VALUES(?,?,1,100,100,1,2)`)
const mainKey = 'rush:700099:1', extraKey = 'rush:700100:1'
const textConfig = { mailSubject: 'fixture', mailBody: 'fixture' }
const measurements = {}
for (const key of [mainKey, extraKey]) {
    competitions.getLeaderboardCompetitionSeasonSync(key)
    availability.getLeaderboardAvailabilitySync(key)
    settlement.getLeaderboardSettlementConfigSync(key)
}
after(async () => {
    await coordinator.drainPersistence(); db.close()
    if (process.env.SECURITY_BENCHMARK_RESULT) fs.writeFileSync(process.env.SECURITY_BENCHMARK_RESULT, JSON.stringify(measurements, null, 2) + '\n')
    assert.equal(path.dirname(fs.realpathSync(dir)), fs.realpathSync(os.tmpdir()))
    fs.rmSync(dir, { recursive: true })
})
function limitError(resource) {
    return error => error instanceof LeaderboardSyncLimitError && error.resource === resource
}

test('initialized leaderboard metadata reads acquire no write lock even when write capacity is full', () => {
    const before = db.prepare('SELECT total_changes() n').get().n
    const original = db.prepare
    const leases = Array.from({ length: 32 }, () => persistenceAdmission.acquire())
    db.prepare = function(sql) {
        assert.doesNotMatch(sql, /^\s*(INSERT|UPDATE|DELETE|BEGIN)/i, 'steady-state read requested a write')
        return original.call(this, sql)
    }
    try {
        for (let n = 0; n < 25; n++) for (const key of [mainKey, extraKey]) {
            assert.equal(competitions.getLeaderboardCompetitionSeasonSync(key), 1)
            availability.getLeaderboardAvailabilitySync(key)
            settlement.getLeaderboardSettlementConfigSync(key)
        }
    } finally { db.prepare = original; leases.forEach(release => release()) }
    assert.equal(db.prepare('SELECT total_changes() n').get().n, before)
})

test('run and round probes use existing indexes and stop before any eligibility/ranking calculation', () => {
    db.transaction(() => { for (let n = 0; n <= limits.runs; n++) insertRun.run('over-runs', first, 1, 1) })()
    const bigRoundRun = Number(insertRun.run('over-rounds', first, limits.rounds + 1, limits.rounds + 1).lastInsertRowid)
    db.transaction(() => { for (let n = 1; n <= limits.rounds + 1; n++) insertRound.run(bigRoundRun, n) })()
    const original = db.prepare, plans = []
    db.prepare = function(sql) {
        assert.doesNotMatch(sql, /COUNT\(DISTINCT|WITH eligible|ROW_NUMBER|CREATE TEMP TABLE/i)
        const statement = original.call(this, sql)
        if (/SELECT count\(\*\) n FROM \(/.test(sql)) {
            const get = statement.get.bind(statement)
            statement.get = (...args) => { plans.push(original.call(this, 'EXPLAIN QUERY PLAN ' + sql).all(...args)); return get(...args) }
        }
        return statement
    }
    try {
        const start = performance.now()
        assert.throws(() => check('over-runs', 1, {}, textConfig), limitError('runs'))
        measurements.reject10001RunsMs = performance.now() - start
        assert.throws(() => check('over-rounds', 1, {}, textConfig), limitError('rounds'))
    } finally { db.prepare = original }
    const details = plans.flat().map(row => row.detail).join('\n')
    assert.match(details, /SEARCH.*idx_leaderboard_runs_rank/)
    assert.match(details, /SEARCH rr USING COVERING INDEX/)
    assert.doesNotMatch(details, /SCAN (?:leaderboard_runs|r |rr )|USE TEMP B-TREE/)
})

test('player and output amplification limits reject manual work before freeze, snapshots or mail', () => {
    db.transaction(() => {
        for (let n = 0; n <= limits.players; n++) {
            const player = Number(clone.run(first).lastInsertRowid)
            insertRound.run(Number(insertRun.run(mainKey, player, 1, 1).lastInsertRowid), 1)
        }
        for (let n = 0; n < 100; n++) insertRound.run(Number(insertRun.run('large-mail', Number(clone.run(first).lastInsertRowid), 1, 1).lastInsertRowid), 1)
    })()
    const before = db.prepare('SELECT total_changes() n').get().n
    const start = performance.now()
    assert.throws(() => settlement.settleLeaderboardSeasonSync(mainKey, 'fixture'), limitError('players'))
    measurements.reject2001PlayersMs = performance.now() - start
    assert.equal(db.prepare('SELECT total_changes() n').get().n, before)
    assert.equal(availability.isLeaderboardEnabledSync(mainKey), true)
    assert.equal(db.prepare('SELECT count(*) n FROM leaderboard_settlements').get().n, 0)
    assert.equal(db.prepare('SELECT count(*) n FROM players_mails').get().n, 0)
    assert.throws(() => check('large-mail', 1, {}, { ...textConfig, mailBody: '中'.repeat(20000) }), limitError('mailBytes'))
    assert.equal(check('large-mail', 1, {}, textConfig), 100)
})

test('management settles oversized work in the background; the schedule does not reaward or block another competition', async t => {
    const app = Fastify({ logger: false })
    app.register(require('../out/routes/web_api/leaderboards').default, { prefix: '/api/leaderboards' })
    await app.ready(); t.after(() => app.close())
    const response = await app.inject({ method: 'POST', url: '/api/leaderboards/' + encodeURIComponent(mainKey) + '/settle' })
    assert.equal(response.statusCode, 200, response.body)
    assert.equal(response.json().rankedPlayers, limits.players + 1)
    assert.equal(response.json().rewardedPlayers, limits.players + 1)
    assert.equal(response.headers['retry-after'], undefined)
    const awarded = db.prepare('SELECT count(*) n FROM players_mails').get().n
    assert.ok(awarded >= limits.players + 1)
    const now = Date.now()
    for (const key of [mainKey, extraKey]) settlement.putLeaderboardSettlementConfigSync({
        ...settlement.getLeaderboardSettlementConfigSync(key), autoEnabled: true, freezeEnabled: true, settleAtMs: now - 1,
    })
    const errors = []; t.mock.method(console, 'error', message => errors.push(String(message)))
    await settlement.runDueLeaderboardSettlements(now)
    assert.equal(availability.isLeaderboardEnabledSync(mainKey, now), false)
    assert.equal(settlement.getLeaderboardSettlementConfigSync(mainKey).autoEnabled, false)
    assert.equal(db.prepare('SELECT count(*) n FROM leaderboard_settlements WHERE competition_key=?').get(mainKey).n, 1)
    assert.equal(db.prepare('SELECT count(*) n FROM leaderboard_settlements WHERE competition_key=?').get(extraKey).n, 1)
    assert.equal(db.prepare('SELECT count(*) n FROM players_mails').get().n, awarded)
    assert.deepEqual(errors, [])
})

test('completed oversized settlement remains idempotent through the synchronous compatibility API', () => {
    const before = db.prepare('SELECT count(*) n FROM players_mails').get().n
    const result = settlement.settleLeaderboardSeasonSync(mainKey, 'repeat-background-result')
    assert.equal(result.reason, 'already-settled')
    assert.equal(result.rankedPlayers, limits.players + 1)
    assert.equal(db.prepare('SELECT count(*) n FROM players_mails').get().n, before)
})
