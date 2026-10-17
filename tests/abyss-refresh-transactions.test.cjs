'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Sqlite = require('better-sqlite3')

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'abyss-refresh-transactions-'))
process.env.DATA_DIR = temporary
process.env.GACHA_SEED_DIR = path.join(temporary, 'seeds')
const version = require('../out/lib/version')
const originalManifest = version.getPatchManifest
const NORMAL = 700099, EX = 700100, OTHER = 700098
const A = 'a'.repeat(64), B = 'b'.repeat(64), OLD = 'c'.repeat(64)
const edge = (revision = A, exRevision = B) => ({
    id: 'refresh-fixture', version: '999.0.0', enabled: true, type: 'patch',
    quest_time_revisions: { 'rush:700099': revision, 'rush:700100': exRevision },
    rush_tower_resets: { 'rush:700099': revision, 'rush:700100': exRevision },
})
let patches = [edge()]
version.getPatchManifest = () => ({ patches })
const progress = require('../out/data/domains/abyss-tower-progress')
const rush = require('../out/data/domains/rushEvent')
const revisions = require('../out/lib/abyss-time-revision')
const { getDb } = require('../out/data/db')
const { insertAccountSync } = require('../out/data/domains/account')
const { insertDefaultPlayerSync } = require('../out/data/domains/player')
const { insertPlayerActiveQuestSync } = require('../out/data/domains/quest_active')
const { insertPlayerOperationReceiptSync } = require('../out/data/domains/player-operation-receipt')
const { givePlayerItemSync } = require('../out/data/domains/item')
const { runPersistenceTransaction } = require('../out/lib/persistence-coordinator')
const db = getDb()
assert.equal(path.dirname(fs.realpathSync(db.name)), fs.realpathSync(temporary))

test.after(() => {
    version.getPatchManifest = originalManifest
    if (db.open) db.close()
    const resolved = fs.realpathSync(temporary)
    assert.equal(path.dirname(resolved), fs.realpathSync(os.tmpdir()))
    assert.ok(path.basename(resolved).startsWith('abyss-refresh-transactions-'))
    fs.rmSync(resolved, { recursive: true })
})

function player(normal = A, ex = B) {
    patches = [edge()]
    const account = insertAccountSync({ appId: 'wf_cn', idpAlias: '', idpCode: 'test', idpId: '', status: 'normal' })
    const id = insertDefaultPlayerSync(account.id).id
    for (const [event, revision] of [[NORMAL, normal], [EX, ex], [OTHER, OLD]]) {
        rush.insertPlayerRushEventSync(id, rush.getDefaultPlayerRushEventSync(event))
        db.prepare(`UPDATE players_rush_events SET tower_revision=?, active_rush_battle_folder_id=2,
            endless_battle_max_round=9, endless_battle_max_round_time=12345 WHERE player_id=? AND event_id=?`)
            .run(revision, id, event)
        db.prepare(`INSERT INTO players_rush_events_played_parties(player_id,event_id,round,battle_type)
            VALUES(?,?,?,0),(?,?,9,1)`).run(id, event, event * 1000 + 1, id, event)
    }
    return id
}

const quote = value => `"${value.replaceAll('"', '""')}"`
function snapshot(id) {
    const result = {}
    for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()) {
        const columns = db.prepare(`PRAGMA table_info(${quote(name)})`).all().map(column => column.name)
        const owner = name === 'players' ? 'id' : columns.includes('player_id') ? 'player_id'
            : columns.includes('source_player_id') ? 'source_player_id' : null
        if (owner === null && !(name === 'leaderboard_run_rounds' && columns.includes('run_id'))) continue
        const where = owner === null ? 'run_id IN (SELECT id FROM leaderboard_runs WHERE player_id=?)' : `${quote(owner)}=?`
        result[name] = db.prepare(`SELECT * FROM ${quote(name)} WHERE ${where}`).all(id)
            .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
    }
    return result
}

// Observe the real better-sqlite3 transaction controller as well as coordinator
// exec calls. Only this connection is counted; a second connection can simulate
// a writer committing between the read-only precheck and BEGIN IMMEDIATE.
function trace(beforeBegin) {
    const counts = { begins: 0, commits: 0, savepoints: 0, rollbacks: 0, writes: 0 }
    const prototype = Object.getPrototypeOf(db.prepare('SELECT 1'))
    const originalRun = prototype.run, originalExec = db.exec
    let hook = beforeBegin
    const observe = sql => {
        const text = String(sql).trim().toUpperCase()
        if (/^BEGIN\b/.test(text)) {
            if (hook) { const once = hook; hook = null; once() }
            counts.begins++
        } else if (/^COMMIT\b/.test(text)) counts.commits++
        else if (/^SAVEPOINT\b/.test(text)) counts.savepoints++
        else if (/^ROLLBACK\b/.test(text)) counts.rollbacks++
        else if (/^(INSERT|UPDATE|DELETE|REPLACE)\b/.test(text)) counts.writes++
    }
    prototype.run = function (...args) {
        if (this.database === db) observe(this.source)
        return originalRun.apply(this, args)
    }
    db.exec = function (sql) { observe(sql); return originalExec.call(this, sql) }
    return { counts, restore() { prototype.run = originalRun; db.exec = originalExec } }
}
function measured(operation, beforeBegin) {
    const probe = trace(beforeBegin)
    try { return { result: operation(), counts: probe.counts } }
    finally { probe.restore() }
}
async function measuredAsync(operation) {
    const probe = trace()
    try { await operation(); return probe.counts }
    finally { probe.restore() }
}
const noWork = { begins: 0, commits: 0, savepoints: 0, rollbacks: 0, writes: 0 }
const partyRows = id => db.prepare('SELECT * FROM players_rush_events_played_parties WHERE player_id=? ORDER BY event_id,battle_type,round').all(id)
const revisionRows = id => db.prepare('SELECT event_id,tower_revision,active_rush_battle_folder_id FROM players_rush_events WHERE player_id=? ORDER BY event_id').all(id)

test('current single and batch refresh are read-only with no transaction or savepoint', () => {
    const id = player(), before = snapshot(id)
    const single = measured(() => progress.refreshPlayerAbyssTowerSync(id, NORMAL))
    assert.equal(single.result, false)
    assert.deepEqual(single.counts, noWork)
    assert.deepEqual(measured(() => progress.refreshPlayerAbyssTowersSync(id)).counts, noWork)
    assert.deepEqual(snapshot(id), before)
})

test('missing reset markers and art-only publication cannot open a transaction or reset a run', () => {
    const id = player(OLD, OLD), before = snapshot(id)
    patches = [{ ...edge(), rush_tower_resets: undefined }, { id: 'art', type: 'patch', version: '999.0.1', enabled: true }]
    assert.equal(progress.getAbyssTowerResetRevision(NORMAL), null)
    assert.deepEqual(measured(() => progress.refreshPlayerAbyssTowerSync(id, NORMAL)).counts, noWork)
    assert.deepEqual(measured(() => progress.refreshPlayerAbyssTowersSync(id)).counts, noWork)
    assert.deepEqual(snapshot(id), before)
})

test('missing tower rows are not created and cause no write transaction', () => {
    const id = player()
    db.prepare('DELETE FROM players_rush_events WHERE player_id=? AND event_id IN (?,?)').run(id, NORMAL, EX)
    const before = snapshot(id)
    assert.deepEqual(measured(() => progress.refreshPlayerAbyssTowerSync(id, NORMAL)).counts, noWork)
    assert.deepEqual(measured(() => progress.refreshPlayerAbyssTowersSync(id)).counts, noWork)
    assert.deepEqual(snapshot(id), before)
})

test('invalid and conflicting reset markers fail closed before a single-tower write', () => {
    const id = player(OLD, OLD), before = snapshot(id)
    for (const invalid of [
        [{ ...edge(), rush_tower_resets: { 'rush:700099': 'bad', 'rush:700100': B } }],
        [edge(), { ...edge(OLD, B), id: 'same-version-conflict' }],
    ]) {
        patches = invalid
        const checked = measured(() => assert.throws(() => progress.refreshPlayerAbyssTowerSync(id, NORMAL), /Invalid|Conflicting/))
        assert.deepEqual(checked.counts, noWork)
        assert.deepEqual(snapshot(id), before)
    }
})

test('dirty single tower commits once and preserves history, unlocks, inventory, receipts and the old battle', () => {
    const id = player(OLD, OLD)
    rush.insertPlayerRushEventClearedFolderSync(id, NORMAL, 1)
    db.prepare(`INSERT INTO players_quest_progress(player_id,section,quest_id,finished,unlocked,s_plus_reward_received)
        VALUES(?,24,700099030,1,1,1)`).run(id)
    givePlayerItemSync(id, 14040, 17)
    insertPlayerOperationReceiptSync({ playerId: id, operation: 'quest_finish.single', requestKey: `old-${id}`, response: { paid: true } })
    insertPlayerActiveQuestSync(id, { playerId: id, playId: `old-battle-${id}`, category: 24,
        questId: 700099001, useBossBoostPoint: false, useBoostPoint: false, isAutoStartMode: false,
        isMulti: false, continueCount: 0, startedAtMs: Date.now() - 1000, questTimeRevision: OLD })
    const run = db.prepare(`INSERT INTO leaderboard_runs(competition_key,player_id,season,status,started_at_ms,
        total_rounds,tracked_from_round) VALUES(?,?,0,?,1000,30,1)`)
    for (const [key, status] of [['achievement:abyss-endurance:700099:1', 'active'],
        ['achievement:abyss-endurance:700099:1', 'completed'], ['unrelated:700098', 'active']]) run.run(key, id, status)
    const before = snapshot(id)
    const checked = measured(() => progress.refreshPlayerAbyssTowerSync(id, NORMAL))
    assert.equal(checked.result, true)
    assert.equal(checked.counts.begins, 1)
    assert.equal(checked.counts.commits, 1)
    assert.ok(checked.counts.writes > 0)
    const after = snapshot(id)
    const changed = new Set(['players_rush_events', 'players_rush_events_played_parties', 'leaderboard_runs'])
    for (const name of Object.keys(before)) if (!changed.has(name)) assert.deepEqual(after[name], before[name], name)
    assert.deepEqual(after.players_rush_events, before.players_rush_events.map(row => row.event_id === NORMAL
        ? { ...row, tower_revision: A, active_rush_battle_folder_id: 1 } : row))
    assert.deepEqual(after.players_rush_events_played_parties,
        before.players_rush_events_played_parties.filter(row => row.event_id !== NORMAL || row.battle_type !== 0))
    for (const row of before.leaderboard_runs) {
        const updated = after.leaderboard_runs.find(value => value.id === row.id)
        if (row.competition_key === 'achievement:abyss-endurance:700099:1' && row.status === 'active') {
            assert.equal(updated.status, 'abandoned')
            assert.ok(updated.finished_at_ms >= row.started_at_ms)
        } else assert.deepEqual(updated, row)
    }
    assert.equal(progress.hasAbyssExUnlockSync(id), true)
    assert.equal(revisions.isStaleAbyssBattle({ category: 24, questId: 700099001, questTimeRevision: OLD }), true)
    assert.deepEqual(measured(() => progress.refreshPlayerAbyssTowerSync(id, NORMAL)).counts, noWork)
    assert.deepEqual(snapshot(id), after)
})

test('second-tower SQL failure rolls back both towers and retry resets them in one transaction', () => {
    const id = player(OLD, OLD), before = snapshot(id)
    db.exec(`CREATE TRIGGER abyss_refresh_second_failure BEFORE UPDATE ON players_rush_events
        WHEN NEW.player_id=${id} AND NEW.event_id=${EX}
        BEGIN SELECT RAISE(ABORT, 'injected second tower refresh failure'); END`)
    try {
        const checked = measured(() => assert.throws(() => progress.refreshPlayerAbyssTowersSync(id), /injected second tower/))
        assert.equal(checked.counts.begins, 1)
        assert.equal(checked.counts.commits, 0)
        assert.equal(db.inTransaction, false)
        assert.deepEqual(snapshot(id), before)
    } finally { db.exec('DROP TRIGGER abyss_refresh_second_failure') }
    const retried = measured(() => progress.refreshPlayerAbyssTowersSync(id))
    assert.equal(retried.counts.begins, 1)
    assert.equal(retried.counts.commits, 1)
    assert.deepEqual(revisionRows(id).filter(row => row.event_id !== OTHER).map(row => row.tower_revision), [A, B])
    assert.ok(partyRows(id).every(row => row.event_id === OTHER || row.battle_type !== 0))
})

test('dirty first tower and invalid second marker fail closed with the whole batch rolled back', () => {
    const id = player(OLD, OLD), before = snapshot(id)
    patches = [{ ...edge(), rush_tower_resets: { 'rush:700099': A, 'rush:700100': 'bad' } }]
    const checked = measured(() => assert.throws(() => progress.refreshPlayerAbyssTowersSync(id), /Invalid tower reset marker/))
    assert.equal(checked.counts.begins, 1)
    assert.equal(checked.counts.commits, 0)
    assert.deepEqual(snapshot(id), before)
    assert.equal(db.inTransaction, false)
})

test('an outer transaction can catch a failed batch and commit without partial tower reset', async () => {
    const id = player(OLD, OLD), before = snapshot(id)
    db.exec(`CREATE TRIGGER abyss_refresh_caught_failure BEFORE UPDATE ON players_rush_events
        WHEN NEW.player_id=${id} AND NEW.event_id=${EX}
        BEGIN SELECT RAISE(ABORT, 'injected caught batch failure'); END`)
    try {
        const counts = await measuredAsync(() => runPersistenceTransaction({ domain: 'player', playerId: id, operation: 'load_maintenance' }, () => {
            assert.throws(() => progress.refreshPlayerAbyssTowersSync(id), /injected caught batch/)
            db.prepare('UPDATE players SET comment=? WHERE id=?').run('outer transaction survived', id)
        }))
        assert.equal(counts.begins, 1)
        assert.equal(counts.commits, 1)
        const after = snapshot(id)
        assert.deepEqual(after, { ...before, players: before.players.map(row => ({ ...row, comment: 'outer transaction survived' })) })
    } finally { db.exec('DROP TRIGGER abyss_refresh_caught_failure') }
})

for (const batch of [false, true]) {
    test(`locked recheck keeps progress committed by another connection after ${batch ? 'batch' : 'single'} precheck`, () => {
        const id = player(OLD, OLD), beforeParties = partyRows(id)
        const peer = new Sqlite(db.name)
        let hookCalls = 0
        try {
            const checked = measured(() => batch ? progress.refreshPlayerAbyssTowersSync(id)
                : progress.refreshPlayerAbyssTowerSync(id, NORMAL), () => {
                hookCalls++
                assert.equal(db.inTransaction, false)
                peer.transaction(() => {
                    peer.prepare('UPDATE players_rush_events SET tower_revision=? WHERE player_id=? AND event_id=?').run(A, id, NORMAL)
                    if (batch) peer.prepare('UPDATE players_rush_events SET tower_revision=? WHERE player_id=? AND event_id=?').run(B, id, EX)
                    peer.prepare(`INSERT INTO players_rush_events_played_parties(player_id,event_id,round,battle_type)
                        VALUES(?,?,?,0)`).run(id, NORMAL, 700099002)
                }).immediate()
            })
            assert.equal(hookCalls, 1)
            if (!batch) assert.equal(checked.result, false)
            assert.equal(checked.counts.begins, 1)
            assert.equal(checked.counts.commits, 1)
            assert.equal(checked.counts.writes, 0, 'the losing refresher must not reset a newly refreshed run')
            const after = partyRows(id)
            assert.equal(after.length, beforeParties.length + 1)
            assert.ok(after.some(row => row.event_id === NORMAL && row.round === 700099002))
            assert.ok(after.some(row => row.event_id === NORMAL && row.round === 700099001))
        } finally { peer.close() }
    })
}

test('clean refresh inside the load-style outer transaction adds no savepoints or COMMIT', async () => {
    const id = player(), before = partyRows(id)
    const counts = await measuredAsync(() => runPersistenceTransaction({ domain: 'player', playerId: id, operation: 'load_maintenance' }, () => {
        db.prepare('UPDATE players SET comment=? WHERE id=?').run('outer load write', id)
        progress.refreshPlayerAbyssTowerSync(id, NORMAL)
        progress.refreshPlayerAbyssTowersSync(id)
    }))
    assert.deepEqual(counts, { begins: 1, commits: 1, savepoints: 0, rollbacks: 0, writes: 1 })
    assert.deepEqual(partyRows(id), before)
})

test('dirty refresh stays in the outer load transaction and a later failure rolls everything back', async () => {
    const id = player(OLD, OLD), before = snapshot(id)
    const counts = await measuredAsync(() => assert.rejects(runPersistenceTransaction({ domain: 'player', playerId: id, operation: 'load_maintenance' }, () => {
        db.prepare('UPDATE players SET comment=? WHERE id=?').run('must roll back', id)
        progress.refreshPlayerAbyssTowersSync(id)
        assert.deepEqual(revisionRows(id).filter(row => row.event_id !== OTHER).map(row => row.tower_revision), [A, B])
        throw new Error('injected late load preparation failure')
    }), /injected late load/))
    assert.equal(counts.begins, 1)
    assert.equal(counts.commits, 0)
    assert.ok(counts.savepoints >= 3)
    assert.deepEqual(snapshot(id), before)
    assert.equal(db.inTransaction, false)
})
