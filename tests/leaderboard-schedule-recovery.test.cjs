const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { Worker } = require('node:worker_threads')

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'leaderboard-schedule-recovery-'))
process.env.GACHA_SEED_DIR = path.join(process.env.DATA_DIR, 'seeds')
process.env.CN_WRITER_THREAD = '0'
const db = require('../out/data/db').getDb()
const background = require('../out/lib/leaderboard/background-worker')
const settlement = require('../out/lib/leaderboard/settlement')
const competitions = require('../out/lib/leaderboard/competition')
const availability = require('../out/lib/leaderboard/availability')
const coordinator = require('../out/lib/persistence-coordinator')
const { persistenceWriteGate } = require('../out/lib/persistence-write-gate')
const { persistenceAdmission } = require('../out/lib/persistence-admission')
const key = 'rush:700099:1'
const account = require('../out/data/domains/account').insertAccountSync({
    appId: 'wf_cn', idpAlias: '', idpCode: 'human', idpId: '', status: 'normal',
})
const player = require('../out/data/domains/player').insertDefaultPlayerSync(account.id)
competitions.getLeaderboardCompetitionSeasonSync(key)
const initialConfig = settlement.getLeaderboardSettlementConfigSync(key)
availability.getLeaderboardAvailabilitySync(key)

after(async () => {
    await coordinator.drainPersistence()
    assert.deepEqual(persistenceWriteGate.stats(), { activeWrites: 0, exclusive: false, waiting: 0 })
    assert.equal(persistenceAdmission.stats().total, 0)
    db.close()
})

function reset() {
    db.transaction(() => {
        for (const table of ['leaderboard_settlement_results', 'leaderboard_settlements',
            'leaderboard_run_rounds', 'leaderboard_runs', 'players_mails']) db.exec(`DELETE FROM ${table}`)
        settlement.putLeaderboardSettlementConfigSync({ ...initialConfig,
            autoEnabled: false, freezeEnabled: false, settleAtMs: null })
        availability.setLeaderboardAvailabilitySync(key, true)
        const run = db.prepare(`INSERT INTO leaderboard_runs(competition_key,player_id,season,status,started_at_ms,
            finished_at_ms,client_battle_ms,rounds_cleared,total_rounds,tracked_from_round)
            VALUES(?,?,1,'completed',1,2,100,1,1,1)`).run(key, player.id)
        db.prepare(`INSERT INTO leaderboard_run_rounds(run_id,round_number,quest_id,client_battle_ms,
            server_elapsed_ms,started_at_ms,finished_at_ms) VALUES(?,1,1,100,100,1,2)`).run(Number(run.lastInsertRowid))
    })()
}

function awards() {
    return Object.fromEntries(['leaderboard_settlements', 'leaderboard_settlement_results', 'players_mails']
        .map(table => [table, db.prepare(`SELECT * FROM ${table} ORDER BY ${
            table === 'leaderboard_settlement_results' ? 'settlement_id,rank_number' : 'id'}`).all()]))
}
function config() { return db.prepare('SELECT * FROM leaderboard_settlement_configs WHERE competition_key=?').get(key) }
function duePlan(nowMs, repeatIntervalMs) {
    settlement.putLeaderboardSettlementConfigSync({ ...initialConfig, autoEnabled: true, freezeEnabled: true,
        settleAtMs: nowMs - 1, repeatIntervalMs, updatedAtMs: nowMs - 2 })
}
const job = (nowMs, scheduled) => ({ competitionKey: key, source: 'schedule-recovery-fixture', nowMs, scheduled })
const original = background.runLeaderboardSettlementInBackground
function dropReply(file, options) {
    return new Worker(`const {parentPort}=require('node:worker_threads');const send=parentPort.postMessage.bind(parentPort);
        parentPort.postMessage=message=>{if(message.type!=='result')send(message)};
        require(${JSON.stringify(file)});`, { ...options, eval: true })
}
function assertAdvanced(nowMs, repeatIntervalMs) {
    const current = config()
    assert.equal(current.updated_at_ms, nowMs)
    assert.equal(current.auto_enabled, Number(repeatIntervalMs !== null))
    assert.equal(current.freeze_enabled, Number(repeatIntervalMs !== null))
    assert.equal(current.settle_at_ms, repeatIntervalMs === null ? null : nowMs - 1 + repeatIntervalMs)
}
function failFinalScheduleUpdate() {
    db.exec(`CREATE TRIGGER fail_schedule_recovery BEFORE UPDATE ON leaderboard_settlement_configs
        WHEN NEW.competition_key='rush:700099:1'
        BEGIN SELECT RAISE(ABORT,'schedule final update failure'); END`)
}

for (const repeatIntervalMs of [null, 60_000]) {
    const kind = repeatIntervalMs === null ? 'one-shot' : 'repeating'
    test(`old completed receipt cannot hide ${kind} final schedule UPDATE failure; retry advances without new awards`, async () => {
        reset()
        await original(job(Date.now() - 10, false))
        const beforeAwards = awards(), nowMs = Date.now()
        assert.ok(beforeAwards.players_mails.length > 0)
        duePlan(nowMs, repeatIntervalMs)
        const beforeConfig = config()
        failFinalScheduleUpdate()
        try {
            await assert.rejects(settlement.runDueLeaderboardSettlements(nowMs), /schedule final update failure/)
        } finally { db.exec('DROP TRIGGER fail_schedule_recovery') }
        assert.deepEqual(config(), beforeConfig, 'failed schedule keeps its due deadline and switches')
        assert.deepEqual(awards(), beforeAwards, 'existing mail and receipts are unchanged')
        await settlement.runDueLeaderboardSettlements(nowMs)
        assertAdvanced(nowMs, repeatIntervalMs)
        assert.deepEqual(awards(), beforeAwards, 'retry never pays the old season again')
    })

    test(`old completed receipt cannot hide ${kind} worker startup failure`, async t => {
        reset()
        await original(job(Date.now() - 10, false))
        const beforeAwards = awards(), nowMs = Date.now()
        duePlan(nowMs, repeatIntervalMs)
        const beforeConfig = config()
        const mock = t.mock.method(background, 'runLeaderboardSettlementInBackground', input => original(input, {
            createWorker: () => { throw new Error('schedule worker startup failure') },
        }))
        try {
            await assert.rejects(settlement.runDueLeaderboardSettlements(nowMs), /schedule worker startup failure/)
        } finally { mock.mock.restore() }
        assert.deepEqual(config(), beforeConfig)
        assert.deepEqual(awards(), beforeAwards)
        await settlement.runDueLeaderboardSettlements(nowMs)
        assertAdvanced(nowMs, repeatIntervalMs)
        assert.deepEqual(awards(), beforeAwards)
    })

    for (const existing of [false, true]) {
        test(`${kind} COMMIT with ${existing ? 'old' : 'new'} receipt survives lost result and never duplicates awards`, async () => {
            reset()
            if (existing) await original(job(Date.now() - 10, false))
            const beforeAwards = awards(), nowMs = Date.now()
            duePlan(nowMs, repeatIntervalMs)
            const outcome = await original(job(nowMs, true), { createWorker: dropReply })
            assert.equal(outcome.ok, true)
            assert.equal(outcome.reason, 'already-settled')
            assertAdvanced(nowMs, repeatIntervalMs)
            if (existing) assert.deepEqual(awards(), beforeAwards)
            else {
                assert.equal(awards().leaderboard_settlements.length, 1)
                assert.equal(awards().leaderboard_settlement_results.length, 1)
                assert.ok(awards().players_mails.length > 0)
            }
            const afterAwards = awards()
            await settlement.runDueLeaderboardSettlements(nowMs)
            assert.deepEqual(awards(), afterAwards)
        })
    }
}

test('old receipt cannot recover a rolled-back schedule when the failure reply is also lost', async () => {
    reset()
    await original(job(Date.now() - 10, false))
    const beforeAwards = awards(), nowMs = Date.now()
    duePlan(nowMs, null)
    const beforeConfig = config()
    failFinalScheduleUpdate()
    try {
        await assert.rejects(original(job(nowMs, true), { createWorker: dropReply }), /exited without a result/)
    } finally { db.exec('DROP TRIGGER fail_schedule_recovery') }
    assert.deepEqual(config(), beforeConfig)
    assert.deepEqual(awards(), beforeAwards)
})

test('old receipt cannot hide a worker error before settlement starts', async () => {
    reset()
    await original(job(Date.now() - 10, false))
    const beforeAwards = awards(), nowMs = Date.now()
    duePlan(nowMs, null)
    const beforeConfig = config()
    await assert.rejects(original(job(nowMs, true), {
        createWorker: () => new Worker("throw new Error('schedule native startup failure')", { eval: true }),
    }), /schedule native startup failure/)
    assert.deepEqual(config(), beforeConfig)
    assert.deepEqual(awards(), beforeAwards)
})

test('an explicit manual worker failure is reported even with a completed season receipt', async () => {
    reset()
    await original(job(Date.now() - 10, false))
    const beforeAwards = awards()
    db.exec(`CREATE TRIGGER fail_manual_recovery BEFORE UPDATE ON leaderboard_availability
        WHEN NEW.competition_key='rush:700099:1'
        BEGIN SELECT RAISE(ABORT,'manual worker update failure'); END`)
    try {
        await assert.rejects(original(job(Date.now(), false)), /manual worker update failure/)
    } finally { db.exec('DROP TRIGGER fail_manual_recovery') }
    assert.deepEqual(awards(), beforeAwards)
})

test('manual COMMIT still recovers from a lost result using the completed award receipt', async () => {
    reset()
    const outcome = await original(job(Date.now(), false), { createWorker: dropReply })
    assert.equal(outcome.ok, true)
    assert.equal(outcome.reason, 'already-settled')
    const beforeAwards = awards()
    assert.equal(beforeAwards.leaderboard_settlements.length, 1)
    assert.equal(beforeAwards.leaderboard_settlement_results.length, 1)
    assert.ok(beforeAwards.players_mails.length > 0)
    await original(job(Date.now(), false))
    assert.deepEqual(awards(), beforeAwards)
})
