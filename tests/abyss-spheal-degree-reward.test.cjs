'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'starpoint-spheal-'))
process.env.DATA_DIR = temporary
process.env.GACHA_SEED_DIR = path.join(temporary, 'seeds')
fs.mkdirSync(process.env.GACHA_SEED_DIR)
const { getDb } = require('../out/data/db')
const { insertAccountSync } = require('../out/data/domains/account')
const { insertDefaultPlayerSync } = require('../out/data/domains/player')
const { grantAbyssSphealDegreeSync, ABYSS_SPHEAL_DEGREE, SPHEAL_CHARACTER } = require('../out/lib/abyss-spheal-degree-reward')
const db = getDb()
const key = 'achievement:abyss-endurance:700099:1'
const config = { schema_version: 1, enabled: true, event_id: 700099, folder_id: 1,
    degree_id: ABYSS_SPHEAL_DEGREE, character_id: SPHEAL_CHARACTER,
    party_scope: 'final_clear_main_or_unison' }
const configPath = path.join(temporary, 'spheal.json')
fs.writeFileSync(configPath, JSON.stringify(config))
// Match the existing production FK-cleanup index; no schema/index migration is
// part of this optimization.
db.exec('CREATE INDEX IF NOT EXISTS idx_cleanup_fk_leaderboard_runs_0 ON leaderboard_runs(player_id)')

test.after(() => {
    if (db.open) db.close()
    const resolved = fs.realpathSync(temporary)
    assert.equal(path.dirname(resolved), fs.realpathSync(os.tmpdir()))
    assert.ok(path.basename(resolved).startsWith('starpoint-spheal-'))
    fs.rmSync(resolved, { recursive: true })
})

function player() {
    const account = insertAccountSync({ appId: 'wf_cn', idpAlias: '', idpCode: 'test', idpId: '', status: 'normal' })
    return insertDefaultPlayerSync(account.id).id
}
function historicalRun(playerId, options = {}) {
    const result = db.prepare(`INSERT INTO leaderboard_runs
        (competition_key,player_id,season,status,started_at_ms,client_battle_ms,rounds_cleared,total_rounds,tracked_from_round)
        VALUES(?,?,1,?,1,30000,?,?,?)`).run(options.key ?? key, playerId, options.status ?? 'completed',
            options.roundsCleared ?? 30, options.totalRounds ?? 30, options.trackedFromRound ?? 1)
    const runId = Number(result.lastInsertRowid)
    const put = db.prepare(`INSERT INTO leaderboard_run_rounds
        (run_id,round_number,quest_id,client_battle_ms,server_elapsed_ms,started_at_ms,finished_at_ms,
         character_id_1,character_id_2,character_id_3,unison_character_id_1,unison_character_id_2,unison_character_id_3)
        VALUES(?,?,700099001,1000,1000,1,2,?,?,?,?,?,?)`)
    for (let round = 1; round <= (options.rounds ?? 30); round++) {
        const slots = options.slots ? options.slots(round) : [111111, null, null, null, null, null]
        put.run(runId, options.roundNumber ? options.roundNumber(round) : round, ...slots)
    }
    return runId
}
function grant(id, options = {}) { return grantAbyssSphealDegreeSync(id, { configPath, ...options }) }
function owned(id) {
    return db.prepare('SELECT acquired_at FROM players_degrees WHERE player_id=? AND degree_id=?')
        .get(id, ABYSS_SPHEAL_DEGREE)
}
function queries(operation) {
    const original = db.prepare, calls = []
    db.prepare = function (sql, ...args) {
        const statement = original.call(this, sql, ...args)
        for (const method of ['get', 'all', 'run']) {
            const execute = statement[method]
            statement[method] = function (...params) {
                calls.push({ sql, method })
                return execute.apply(this, params)
            }
        }
        return statement
    }
    try { return { value: operation(), calls } }
    finally { db.prepare = original }
}
const eligible = () => [SPHEAL_CHARACTER, null, null, null, null, null]

test('history lookup remains one native query without materializing IDs or querying every nonqualifying run', () => {
    const id = player()
    db.transaction(() => { for (let i = 0; i < 100; i++) historicalRun(id) }).immediate()
    const observed = queries(() => grant(id))
    assert.deepEqual(observed.value, [])
    const history = observed.calls.filter(call => /\bFROM\s+leaderboard_runs\b/i.test(call.sql))
    assert.equal(history.length, 1)
    assert.equal(history[0].method, 'get')
    // The real coordinator also reads clock schema metadata with .all().
    // Only the historical run/round lookup must avoid materializing rows.
    assert.equal(observed.calls.some(call => call.method === 'all'
        && /\bleaderboard_(?:runs|run_rounds)\b/i.test(call.sql)), false)
    assert.equal(observed.calls.some(call => /SELECT\s+COUNT\(\*\)\s+AS\s+round_count/i.test(call.sql)), false)
    assert.equal(owned(id), undefined)
})

test('an eligible oldest run grants despite many newer failures and preserves original ownership time on replay', () => {
    const id = player()
    db.transaction(() => {
        historicalRun(id, { slots: eligible })
        for (let i = 0; i < 20; i++) historicalRun(id)
    }).immediate()
    assert.deepEqual(grant(id), [ABYSS_SPHEAL_DEGREE])
    const first = owned(id)
    assert.ok(Number.isSafeInteger(first.acquired_at))
    const repeated = queries(() => grant(id))
    assert.deepEqual(repeated.value, [])
    assert.deepEqual(owned(id), first)
    assert.equal(repeated.calls.some(call => /\bFROM\s+leaderboard_runs\b/i.test(call.sql)), false)
})

test('the newest eligible history can grant and another player cannot supply eligibility', () => {
    const id = player(), other = player()
    historicalRun(other, { slots: eligible })
    historicalRun(id)
    assert.deepEqual(grant(id), [])
    historicalRun(id, { slots: eligible })
    assert.deepEqual(grant(id), [ABYSS_SPHEAL_DEGREE])
})

test('exact thirty-row and nullable six-slot semantics match legacy title grants', () => {
    for (const [options, expected] of [
        [{ rounds: 29, slots: eligible }, []],
        [{ rounds: 31, slots: eligible }, []],
        [{ slots: () => [null, null, null, null, null, null] }, []],
        [{ slots: round => round === 7 ? [111111, null, null, null, null, null] : eligible() }, []],
        [{ slots: () => [null, null, null, null, null, SPHEAL_CHARACTER] }, [ABYSS_SPHEAL_DEGREE]],
        [{ slots: () => [String(SPHEAL_CHARACTER), null, null, null, null, null] }, [ABYSS_SPHEAL_DEGREE]],
        // Legacy eligibility counts thirty records without imposing a new
        // continuous-number requirement on already stored historical runs.
        [{ slots: eligible, roundNumber: round => round === 30 ? 31 : round }, [ABYSS_SPHEAL_DEGREE]],
    ]) {
        const id = player()
        historicalRun(id, options)
        assert.deepEqual(grant(id), expected)
    }
})

test('run status, identity and completion metadata retain their existing eligibility boundaries', () => {
    for (const options of [
        { status: 'abandoned' }, { status: 'active' }, { key: 'achievement:abyss-endurance:700100:1' },
        { trackedFromRound: 2 }, { roundsCleared: 29 }, { totalRounds: 31 },
    ]) {
        const id = player()
        historicalRun(id, { ...options, slots: eligible })
        assert.deepEqual(grant(id), [])
    }
})

test('missing history, invalid players and invalid or disabled configuration cannot grant', () => {
    assert.deepEqual(grant(player()), [])
    for (const id of [0, -1, 1.5, NaN, Number.MAX_SAFE_INTEGER + 1, 999999999]) assert.deepEqual(grant(id), [])
    const id = player()
    historicalRun(id, { slots: eligible })
    const variants = [
        ['disabled.json', JSON.stringify({ ...config, enabled: false })],
        ['scope.json', JSON.stringify({ ...config, party_scope: 'wrong' })],
        ['broken.json', '{broken'],
    ]
    for (const [name, value] of variants) {
        const file = path.join(temporary, name); fs.writeFileSync(file, value)
        assert.deepEqual(grant(id, { configPath: file }), [])
    }
    assert.deepEqual(grant(id, { configPath: path.join(temporary, 'absent.json') }), [])
    assert.equal(owned(id), undefined)
})

test('disabled public ranking still permits the historical title repair on an ordinary successful floor', () => {
    const { setLeaderboardAvailabilitySync } = require('../out/lib/leaderboard/availability')
    const { finishLeaderboardQuestSync } = require('../out/lib/leaderboard/service')
    const id = player()
    historicalRun(id, { slots: eligible })
    setLeaderboardAvailabilitySync('rush:700099:1', false)
    const empty = [null, null, null]
    const result = finishLeaderboardQuestSync({ playerId: id,
        quest: { category: 24, eventId: 700099, folderId: 1, round: 2, questId: 700099002, totalRounds: 30 },
        accomplished: true, clientBattleMs: 1000,
        party: { characterIds: empty, unisonCharacterIds: empty, equipmentIds: empty,
            abilitySoulIds: empty, evolutionImgLevels: empty, unisonEvolutionImgLevels: empty } })
    assert.deepEqual(result, [ABYSS_SPHEAL_DEGREE])
    assert.ok(owned(id))
})

test('real SQLite errors propagate and roll back a nested transaction instead of becoming a successful no-op', () => {
    const id = player()
    historicalRun(id, { slots: eligible })
    db.exec('BEGIN IMMEDIATE')
    try {
        db.exec('DROP TABLE leaderboard_run_rounds')
        assert.throws(() => grant(id), error => error.code === 'SQLITE_ERROR' && /leaderboard_run_rounds/.test(error.message))
        assert.equal(db.inTransaction, true, 'the caller still owns its outer transaction')
    } finally { db.exec('ROLLBACK') }
    assert.equal(owned(id), undefined)
    assert.deepEqual(grant(id), [ABYSS_SPHEAL_DEGREE])
    assert.equal(db.pragma('integrity_check', { simple: true }), 'ok')
})
