'use strict'

const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Fastify = require('fastify')
const { pack, unpack } = require('msgpackr')

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'single-finish-writer-'))
process.env.DATA_DIR = tempRoot
process.env.GAME_ROUTINE_LOGS = 'off'
delete process.env.CN_WRITER_THREAD
// Keep the body-timing aggregate deterministic regardless of the caller's shell.
delete process.env.ROUTE_PERF_SUMMARY

const { initializeDatabase } = require('../out/data')
const { getDb } = require('../out/data/db')
const { insertAccountSync } = require('../out/data/domains/account')
const { insertDefaultPlayerSync } = require('../out/data/domains/player')
const writerClient = require('../out/lib/persistence/writer-client')
const { drainSingleSettlementDiagnostics } = require('../out/lib/single-settlement-diagnostics')
const { getServerTime, setServerTimeOffset } = require('../out/utils')
const singleBattleRoutes = require('../out/routes/api/singleBattleQuest').default

let app
let sequence = 0

function decode(response) {
    assert.match(response.headers['content-type'], /^application\/x-msgpack/)
    return unpack(Buffer.from(response.body, 'base64'))
}

/**
 * The client decides "the date changed" from the response clock fields, so
 * both must come from the same virtual clock no matter which thread settled
 * the quest. `servertime` is the virtual clock; `exp_pooled_time` is stored in
 * virtual-clock coordinates and is serialized as-is.
 */
function assertVirtualClock(response) {
    const { servertime } = response.data_headers
    const { exp_pooled_time: expPooledTime } = response.data.user_info
    const virtualNow = getServerTime()
    assert.ok(Math.abs(servertime - virtualNow) <= 60,
        `servertime=${servertime} must follow the virtual clock ${virtualNow}`)
    assert.ok(Math.abs(servertime - expPooledTime) <= 3600,
        `servertime=${servertime} and exp_pooled_time=${expPooledTime} must share one clock`)
}

function createPlayer() {
    const account = insertAccountSync({
        appId: 'wf_cn', idpAlias: '', idpCode: 'test',
        idpId: `single-finish-writer-${++sequence}`, status: 'normal',
    })
    const player = insertDefaultPlayerSync(account.id)
    const viewerId = 815000000 + player.id
    getDb().prepare('INSERT INTO sessions (token, account_id, expires, type) VALUES (?, ?, ?, 2)')
        .run(String(viewerId), account.id, new Date('2099-01-01T00:00:00.000Z').toISOString())
    return { playerId: player.id, viewerId }
}

/** Practice quest 1/15 finishes through the same /finish transaction as any solo clear. */
async function finishPracticeQuest({ playerId, viewerId }) {
    const start = await app.inject({
        method: 'POST',
        url: '/single_battle_quest/start',
        payload: {
            viewer_id: viewerId, quest_id: 1, category: 15, party_id: 1,
            play_id: `single-finish-writer-${playerId}-play-1`,
            use_boss_boost_point: false, use_boost_point: false,
            is_auto_start_mode: false, api_count: 1,
        },
    })
    assert.equal(start.statusCode, 200, start.body)

    const finish = await app.inject({
        method: 'POST',
        url: '/single_battle_quest/finish',
        payload: {
            viewer_id: viewerId, quest_id: 1, category: 15, continue_count: 0,
            elapsed_time_ms: 60_000, score: 12_345, add_mana: 0,
            is_accomplished: true, is_restored: false, api_count: 2,
            statistics: {
                clear_phase: 1,
                party: {
                    characters: [{ id: 1 }, null, null],
                    unison_characters: [null, null, null],
                    equipments: [null, null, null],
                    ability_soul_ids: [null, null, null],
                },
                zones: [{
                    damage_deal_total: 321.5,
                    members: [{ origin_damage: 321.5 }, null, null],
                }],
            },
        },
    })
    assert.equal(finish.statusCode, 200, finish.body)
    const decoded = decode(finish)
    assertVirtualClock(decoded)
    const data = decoded.data
    assert.equal(data.category_id, 15)
    assert.equal(data.is_multi, 'single')

    const progress = getDb().prepare(
        'SELECT finished, clear_rank FROM players_quest_progress WHERE player_id = ? AND section = 15 AND quest_id = 1',
    ).get(playerId)
    assert.equal(progress.finished, 1, 'quest progress must be committed')
    const history = getDb().prepare(
        'SELECT COUNT(*) AS n FROM players_practice_battle_history WHERE player_id = ?',
    ).get(playerId)
    assert.equal(history.n, 1, 'practice battle history must be committed')
    return decoded
}

before(async () => {
    initializeDatabase()
    app = Fastify()
    app.addHook('onSend', (_request, reply, payload, done) => {
        if (reply.getHeader('content-type') === 'application/x-msgpack') {
            done(null, pack(payload).toString('base64'))
            return
        }
        done(null, payload)
    })
    await app.register(singleBattleRoutes, { prefix: '/single_battle_quest' })
    await app.ready()
})

after(async () => {
    await writerClient.stopSqliteWriter()
    await app.close()
    getDb().close()
    assert.equal(path.dirname(fs.realpathSync(tempRoot)), fs.realpathSync(os.tmpdir()))
    fs.rmSync(tempRoot, { recursive: true, force: true })
})

test('the solo finish transaction commits identically in-process and in the writer thread', async () => {
    drainSingleSettlementDiagnostics()

    // A non-null offset is what exposed the defect: the worker used to settle
    // with its own null offset, so the response clock jumped by ~421 days.
    setServerTimeOffset(-36374494027)

    // Rollback path: CN_WRITER_THREAD is unset, so the registered command runs
    // in-process through the same single registry entry.
    const mainPlayer = createPlayer()
    const mainResponse = await finishPracticeQuest(mainPlayer)
    assert.equal(writerClient.isSqliteWriterReady(), false)

    // Writer path: the same request now executes the identical command inside
    // the SQLite writer thread and returns the response across the boundary.
    process.env.CN_WRITER_THREAD = '1'
    assert.equal(writerClient.startSqliteWriter(getDb().name), true)
    assert.equal(await writerClient.waitForSqliteWriterReady(30_000), true)
    const statsBefore = writerClient.sqliteWriterStats()
    const workerPlayer = createPlayer()
    const workerResponse = await finishPracticeQuest(workerPlayer)
    const mainData = mainResponse.data
    const workerData = workerResponse.data

    for (const key of ['category_id', 'is_multi', 'clear_rank', 'before_rank_point', 'old_high_score', 'rewards']) {
        assert.deepEqual(workerData[key], mainData[key], `finish response field ${key} must match both paths`)
    }
    assert.deepEqual(Object.keys(workerData).sort(), Object.keys(mainData).sort())
    assert.ok(
        Math.abs(workerResponse.data_headers.servertime - mainResponse.data_headers.servertime) <= 60,
        'both paths must report the same virtual clock',
    )

    const stats = writerClient.sqliteWriterStats()
    assert.ok(
        stats.submitted - statsBefore.submitted >= 1,
        `expected a settle command containing progress refresh, saw ${stats.submitted - statsBefore.submitted}`,
    )
    assert.equal(stats.failed, 0)
    assert.equal(stats.completed, stats.submitted)
    assert.ok(stats.batches >= 1)
    assert.equal(stats.savepointRollbacks, 0)

    // The transaction body reports its phase timings from whichever thread
    // executed it; the main-thread aggregate must still see the settlement.
    const timings = drainSingleSettlementDiagnostics()['15']
    assert.equal(timings.n, 2, 'both settlements must report body timings')
    assert.equal(timings.bodyErrors, 0)
    assert.equal(timings.phases.response.n, 2)
})

console.log('single finish writer thread tests passed')
