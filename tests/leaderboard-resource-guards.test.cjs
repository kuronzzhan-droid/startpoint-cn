const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const Fastify = require('fastify')
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leaderboard-resources-'))
process.env.DATA_DIR = dir
process.env.CN_WRITER_THREAD = '0'
const db = require('../out/data/db').getDb()
const ranks = require('../out/data/domains/leaderboard')
const competitions = require('../out/lib/leaderboard/competition')
const service = require('../out/lib/leaderboard/service')
const presentation = require('../out/lib/leaderboard/presentation')
const settlement = require('../out/lib/leaderboard/settlement')
const coordinator = require('../out/lib/persistence-coordinator')
const { createLeaderboardWorkControl, LeaderboardWorkBusyError } = require('../out/lib/leaderboard/work-control')
const competition = competitions.getLeaderboardCompetition('rush:700099:1')
const season = competitions.getLeaderboardCompetitionSeasonSync(competition.key)
const party = Object.fromEntries(['characterIds', 'unisonCharacterIds', 'equipmentIds', 'abilitySoulIds',
    'evolutionImgLevels', 'unisonEvolutionImgLevels'].map(key => [key, [null, null, null]]))
let clock = 1_000_000
const makePlayer = (name, idpCode = 'leiting') => {
    const account = require('../out/data/domains/account').insertAccountSync({ appId: 'wf_cn', idpAlias: '', idpCode, idpId: '', status: 'normal' })
    const player = require('../out/data/domains/player').insertDefaultPlayerSync(account.id)
    require('../out/data/domains/player').updatePlayerSync({ id: player.id, name })
    return player.id
}
const a = makePlayer('A'), b = makePlayer('B'), bot = makePlayer('Bot', 'rushbot')
function clear(playerId, ms) {
    for (let round = 1; round <= 2; round++) {
        const quest = { category: competition.category, eventId: competition.eventId, folderId: competition.folderId,
            round, questId: 700099000 + round, totalRounds: 2 }
        service.startLeaderboardQuestSync(playerId, quest, clock)
        clock += 10_000
        service.finishLeaderboardQuestSync({ playerId, quest, accomplished: true, clientBattleMs: ms, party, finishedAtMs: clock })
    }
}
clear(a, 1000); clear(a, 2000); clear(b, 500); clear(bot, 200)
after(async () => {
    coordinator.configurePersistenceSqlExecutor(null)
    await coordinator.drainPersistence()
    db.close()
    assert.equal(path.dirname(fs.realpathSync(dir)), fs.realpathSync(os.tmpdir()))
    fs.rmSync(dir, { recursive: true })
})
const input = (filter = {}) => ({ competitionKey: competition.key, season, filter })

test('combined page and own-rank query preserves ties, clear counts, filters and an out-of-page player', () => {
    for (const filter of [{}, { excludeBots: true }, { excludeDeleted: true, excludeBots: true }]) {
        for (const playerId of [null, a, b, bot, 99999]) for (const offset of [0, 1, 9]) {
            const combined = ranks.getLeaderboardRankPageAndPlayerSync({ ...input(filter), offset, limit: 1, playerId })
            assert.deepEqual(combined.rows, ranks.getLeaderboardRankPageSync({ ...input(filter), offset, limit: 1 }))
            assert.deepEqual(combined.mine, playerId === null ? null : ranks.getLeaderboardPlayerRankSync(competition.key, season, playerId, filter))
        }
        assert.equal(ranks.countLeaderboardRanksSync(competition.key, season, filter),
            ranks.getLeaderboardRankPageSync({ ...input(filter), offset: 0, limit: 100 }).length)
    }
})

test('normal leaderboard displays rank once and totals avoid ranking sorts', () => {
    const original = db.prepare, queries = []
    db.prepare = function(sql) { queries.push(sql); return original.call(this, sql) }
    try {
        presentation.getOfficialLeaderboardPageSync({ competition, playerId: a, page: 0 })
        assert.equal(queries.filter(sql => /WITH eligible AS/.test(sql)).length, 1)
        const count = queries.find(sql => /COUNT\(DISTINCT r.player_id\)/.test(sql))
        assert.ok(count)
        const plan = original.call(db, 'EXPLAIN QUERY PLAN ' + count).all(competition.key, season)
        assert.ok(!plan.some(row => /CO-ROUTINE|ORDER BY/i.test(row.detail)), JSON.stringify(plan))
        queries.length = 0
        presentation.buildNativeLeaderboardPayload(competition, a)
        assert.equal(queries.filter(sql => /WITH eligible AS/.test(sql)).length, 1)
    } finally { db.prepare = original }
})

test('batched settlement still rolls back every mail and snapshot on a mid-batch failure, then retries once', () => {
    const mails = () => db.prepare('SELECT count(*) n FROM players_mails').get().n
    const before = mails()
    db.exec("CREATE TRIGGER fail_reward_fixture BEFORE INSERT ON leaderboard_settlement_results WHEN NEW.rank_number=2 BEGIN SELECT RAISE(ABORT,'fixture reward failure'); END")
    assert.throws(() => settlement.settleLeaderboardSeasonSync(competition.key, 'fixture-fail'), /fixture reward failure/)
    assert.equal(mails(), before)
    assert.equal(db.prepare('SELECT count(*) n FROM leaderboard_settlements').get().n, 0)
    assert.equal(db.prepare('SELECT count(*) n FROM leaderboard_settlement_results').get().n, 0)
    db.exec('DROP TRIGGER fail_reward_fixture')
    const outcome = settlement.settleLeaderboardSeasonSync(competition.key, 'fixture-success')
    assert.equal(outcome.ok, true)
    assert.equal(outcome.rankedPlayers, 2)
    const awarded = mails()
    assert.ok(awarded > before)
    assert.equal(settlement.settleLeaderboardSeasonSync(competition.key, 'fixture-repeat').reason, 'already-settled')
    assert.equal(mails(), awarded)
    assert.equal(ranks.countLeaderboardRanksSync(competition.key, season, { settled: true }), 2)
})

test('settled counts and pages retain the final snapshot after a player is deleted', () => {
    db.prepare('DELETE FROM players WHERE id=?').run(b)
    const filter = { settled: true }
    assert.equal(ranks.countLeaderboardRanksSync(competition.key, season, filter), 2)
    const combined = ranks.getLeaderboardRankPageAndPlayerSync({ ...input(filter), offset: 0, limit: 1, playerId: a })
    assert.equal(combined.rows[0].playerExists, false)
    assert.equal(combined.rows[0].displayName, 'B')
    assert.equal(combined.mine.playerId, a)
    assert.equal(combined.mine.clearCount, 2)
})

test('maintenance accepts one job before queueing, rate-limits repeated actions and releases ownership on failure', async () => {
    let now = 0, unlock
    const control = createLeaderboardWorkControl(() => now)
    const gate = new Promise(resolve => { unlock = resolve })
    coordinator.configurePersistenceSqlExecutor(() => gate)
    const blocker = coordinator.runPersistenceSqlCommand({ domain: 'maintenance', operation: 'hold' }, [], () => {})
    let calls = 0
    const first = control(competition.key, 'settle', () => ++calls)
    await assert.rejects(control(competition.key, 'settle', () => ++calls), LeaderboardWorkBusyError)
    await assert.rejects(control(competition.key, 'scheduler', () => ++calls), LeaderboardWorkBusyError)
    assert.equal(calls, 0)
    unlock(); await blocker; assert.equal(await first, 1)
    coordinator.configurePersistenceSqlExecutor(null)
    await assert.rejects(control(competition.key, 'settle', () => ++calls), LeaderboardWorkBusyError)
    assert.equal(await control(competition.key, 'rollover', () => ++calls), 2)
    now = 2000
    await assert.rejects(control(competition.key, 'settle', () => { throw new Error('fixture failure') }), /fixture failure/)
    assert.equal(await control(competition.key, 'scheduler', () => ++calls), 3)
})

test('real administrative routes validate page numbers and reject repeated settlement before new side effects', async t => {
    const app = Fastify({ logger: false })
    await app.register(require('../out/routes/web_api/leaderboards').default, { prefix: '/api/leaderboards' })
    t.after(() => app.close())
    const base = '/api/leaderboards/' + encodeURIComponent(competition.key)
    for (const page of ['Infinity', '-1', '1.2', '9007199254740992']) {
        assert.equal((await app.inject(base + '?page=' + page)).statusCode, 400)
    }
    const lastPage = await app.inject(base + '?page=9007199254740991')
    assert.equal(lastPage.statusCode, 200)
    assert.equal(lastPage.json().page, 0)
    const first = await app.inject({ method: 'POST', url: base + '/settle' })
    assert.equal(first.statusCode, 200)
    assert.equal(first.json().reason, 'already-settled')
    const before = db.prepare('SELECT count(*) n FROM players_mails').get().n
    const repeat = await app.inject({ method: 'POST', url: base + '/settle' })
    assert.equal(repeat.statusCode, 429)
    assert.equal(repeat.headers['retry-after'], '2')
    assert.equal(db.prepare('SELECT count(*) n FROM players_mails').get().n, before)
    assert.equal((await app.inject({ method: 'POST', url: base + '/rollover' })).statusCode, 200)
    assert.equal((await app.inject({ method: 'POST', url: base + '/rollover' })).statusCode, 429)
})

test('large settlement snapshots page across the bound and a later-page failure leaves no writes or temp table', () => {
    const columns = db.prepare('PRAGMA table_info(players)').all().filter(row => row.name !== 'id').map(row => '"' + row.name + '"').join(',')
    const clone = db.prepare(`INSERT INTO players(${columns}) SELECT ${columns} FROM players WHERE id=?`)
    const run = db.prepare(`INSERT INTO leaderboard_runs(competition_key,player_id,season,status,started_at_ms,finished_at_ms,
        client_battle_ms,rounds_cleared,total_rounds,tracked_from_round) VALUES('batch-fixture',?,1,'completed',1,2,100,1,1,1)`)
    const round = db.prepare(`INSERT INTO leaderboard_run_rounds(run_id,round_number,quest_id,client_battle_ms,server_elapsed_ms,started_at_ms,finished_at_ms)
        VALUES(?,1,1,100,100,1,2)`)
    db.transaction(() => {
        for (let i = 0; i < 260; i++) round.run(Number(run.run(Number(clone.run(a).lastInsertRowid)).lastInsertRowid))
    })()
    db.exec('CREATE TABLE batch_effects(rank INTEGER PRIMARY KEY)')
    const insert = db.prepare('INSERT INTO batch_effects VALUES(?)')
    const original = db.prepare, batches = []
    db.prepare = function(sql) {
        const statement = original.call(this, sql)
        if (/SELECT \* FROM temp.leaderboard_settlement_work_/.test(sql)) {
            const all = statement.all.bind(statement)
            statement.all = (...args) => { const rows = all(...args); batches.push(rows.length); return rows }
        }
        return statement
    }
    try {
        assert.throws(() => db.transaction(() => ranks.forEachLeaderboardRankBatchSync('batch-fixture', 1, {}, row => {
            insert.run(row.rankNumber)
            if (row.rankNumber === 258) throw new Error('later batch failure')
        }))(), /later batch failure/)
        assert.deepEqual(batches, [256, 4])
        assert.equal(db.prepare('SELECT count(*) n FROM batch_effects').get().n, 0)
        assert.equal(db.prepare("SELECT count(*) n FROM sqlite_temp_master WHERE name LIKE 'leaderboard_settlement_work_%'").get().n, 0)
        batches.length = 0
        db.transaction(() => ranks.forEachLeaderboardRankBatchSync('batch-fixture', 1, {}, row => insert.run(row.rankNumber)))()
        assert.deepEqual(batches, [256, 4, 0])
        assert.equal(db.prepare('SELECT count(*) n FROM batch_effects').get().n, 260)
    } finally { db.prepare = original }
})
