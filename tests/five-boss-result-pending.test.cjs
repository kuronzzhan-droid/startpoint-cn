'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { spawn } = require('node:child_process')
const child = process.env.FIVE_BOSS_PENDING_CHILD ? JSON.parse(process.env.FIVE_BOSS_PENDING_CHILD) : null
const directory = child?.directory ?? fs.mkdtempSync(path.join(os.tmpdir(), 'five-boss-result-pending-'))
Object.assign(process.env, { DATA_DIR: directory, GACHA_SEED_DIR: path.join(directory, 'seeds'),
    GAME_ROUTINE_LOGS: 'off', CN_WRITER_THREAD: '0' })
const load = name => require(path.join(__dirname, '..', 'out', name))
const intervals = [], interval = global.setInterval
global.setInterval = (...args) => { const timer = interval(...args); intervals.push(timer); return timer }
let db, players, active, ledger, runtime, solo, items, mode, rooms
try {
    load('data').initializeDatabase(); db = load('data/db').getDb()
    players = load('data/domains/player'); active = load('data/domains/quest_active')
    ledger = load('data/domains/fiveBossGauntletRun'); runtime = load('multi/five-boss/battle-runtime')
    solo = load('multi/five-boss/solo-runtime'); items = load('data/domains/item')
    mode = load('multi/five-boss/contract').FIVE_BOSS_GAUNTLET; rooms = load('multi/room/manager')
} finally { global.setInterval = interval }
let sequence = 0
function player() {
    const account = load('data/domains/account').insertAccountSync({ appId: 'wf_cn', idpAlias: '', idpCode: 'pending-result',
        idpId: `pending-result-${++sequence}`, status: 'normal' })
    const p = { id: players.insertDefaultPlayerSync(account.id).id, viewerId: 783000000 + sequence,
        playId: `pending-result-play-${sequence}` }
    load('data/activeAccount').saveAccountDefaultPlayer(account.id, p.id)
    players.updatePlayerSync({ id: p.id, stamina: 200, staminaHealTime: new Date() })
    items.setPlayerItemSync(p.id, mode.ticketItemId, 5)
    return p
}
function room(members) {
    const host = members[0], value = rooms.createRoom(host.viewerId, host.id, 1, mode.category, mode.visibleQuestId, 0, 1)
    value.raising_state = 4
    value.mates = members.map(p => ({ viewer_id: p.viewerId, player_id: p.id, com_id: 0 }))
    value.member_viewer_ids = members.map(p => p.viewerId)
    value.member_player_ids = Object.fromEntries(members.map(p => [p.viewerId, p.id]))
    value.five_boss_runtime = { runId: `pending-result-run-${++sequence}`, expectedRealPlayerIds: members.map(p => p.id),
        autoplayModeByPlayerId: Object.fromEntries(members.map(p => [p.id, false])),
        partyCharacterIdsByPlayerId: Object.fromEntries(members.map(p => [p.id, [1]])), battleIdentityByViewerId: {} }
    return value
}
const identity = (p, r) => ({ playerId: p.id, clientPlayId: p.playId, requestRoomNumber: r.room_number,
    requestCategory: mode.category, requestQuestId: mode.visibleQuestId })
const start = (p, r) => runtime.startFiveBossBattle({ ...identity(p, r), room: r, useBoostPoint: false, useBossBoostPoint: false })
const finish = (p, r) => runtime.finishFiveBossBattle({ ...identity(p, r), accomplished: true, elapsedTimeMs: 30000, randomFloat: () => 0.1 })
function proof(p, r, signals = ['scene_ready', 'level_next', 'finalize']) {
    for (const signal of signals) ledger.recordMemberBattleSignalSync({ runId: r.five_boss_runtime.runId,
        playerId: p.id, roomNumber: r.room_number, signal })
}
const member = (p, r) => db.prepare('SELECT * FROM five_boss_gauntlet_members WHERE run_id=? AND player_id=?').get(r.five_boss_runtime.runId, p.id)
const pendingMarker = (p, r) => member(p, r).result_pending_at ?? null
const detach = p => typeof ledger.detachFinalizedFiveBossActiveSync === 'function'
    ? ledger.detachFinalizedFiveBossActiveSync(p.id, p.playId) : false
function insertSolo(p, playId = `new-solo-${p.id}`) {
    active.insertPlayerActiveQuestSync(p.id, { playerId: p.id, playId, questId: mode.visibleQuestId, category: mode.category,
        useBoostPoint: false, useBossBoostPoint: false, isAutoStartMode: false, isMulti: false, isMultiHost: false,
        roomNumber: null, entryItemId: mode.ticketItemId, eventId: null, continueCount: 0, startedAtMs: Date.now() })
}
const quote = value => `"${value.replaceAll('"', '""')}"`
function snapshot() {
    return JSON.stringify(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
        .map(({ name }) => [name, db.prepare(`SELECT * FROM ${quote(name)}`).all().map(row => JSON.stringify(row)).sort()]))
}
async function close() {
    intervals.forEach(clearInterval)
    try { await load('lib/seed-validator').default.close() } finally { if (db.open) db.close() }
}
async function finishChild(p, r) {
    return new Promise((resolve, reject) => {
        const proc = spawn(process.execPath, [__filename], { cwd: path.resolve(__dirname, '..'), windowsHide: true,
            env: { ...process.env, FIVE_BOSS_PENDING_CHILD: JSON.stringify({ directory, identity: identity(p, r) }) },
            stdio: ['ignore', 'pipe', 'pipe'] })
        let output = '', errors = ''
        const timer = setTimeout(() => { proc.kill(); reject(new Error(`pending finish child timeout: ${errors}`)) }, 30000)
        proc.stdout.on('data', value => { output += value }); proc.stderr.on('data', value => { errors += value })
        proc.once('error', error => { clearTimeout(timer); reject(error) })
        proc.once('exit', code => {
            clearTimeout(timer)
            if (code) return reject(new Error(`pending finish child exited ${code}: ${errors}\n${output}`))
            const line = output.split(/\r?\n/).find(value => value.startsWith('PENDING_RESULT:'))
            if (!line) return reject(new Error(`missing pending finish result: ${output}`))
            resolve(JSON.parse(line.slice('PENDING_RESULT:'.length)))
        })
    })
}
if (child) {
    void (async () => {
        try { console.log(`PENDING_RESULT:${JSON.stringify(runtime.finishFiveBossBattle({ ...child.identity,
            accomplished: true, elapsedTimeMs: 30000, randomFloat: () => 0.1 }))}`) }
        finally { await close() }
    })().catch(error => { console.error(error); process.exitCode = 1 })
} else {
    test.after(async () => { try { await close() } finally {
        assert.equal(path.dirname(fs.realpathSync(directory)), fs.realpathSync(os.tmpdir()))
        fs.rmSync(directory, { recursive: true })
    } })
    test('Finalize releases only current occupancy for a new solo while old success remains payable once', () => {
        const p = player(), r = room([p]); start(p, r); proof(p, r)
        const beforeReward = items.getPlayerItemSync(p.id, 10000145)
        solo.startFiveBossSoloSync(p.id, `new-solo-${p.id}`, () => insertSolo(p))
        const newer = active.getPlayerActiveQuestSync(p.id)
        assert.equal(newer.isMulti, false)
        assert.ok(pendingMarker(p, r))
        assert.equal(member(p, r).aborted_at, null)
        assert.equal(items.getPlayerItemSync(p.id, 10000145), beforeReward, 'Finalize never awards success by itself')
        const first = finish(p, r)
        assert.equal(first.receiptStatus, 'settled')
        assert.deepEqual(active.getPlayerActiveQuestSync(p.id), newer)
        const paid = snapshot(), second = finish(p, r)
        assert.equal(second.receiptStatus, 'already_settled'); assert.deepEqual(second.reward, first.reward)
        assert.equal(snapshot(), paid)
    })
    test('detachment requires the exact current play, actual entry, Finalize and an unaborted unreceipted member', () => {
        for (const signals of [[], ['scene_ready'], ['level_next', 'finalize']]) {
            const p = player(), r = room([p]); start(p, r); proof(p, r, signals)
            const before = snapshot()
            assert.equal(detach(p), false)
            assert.equal(snapshot(), before)
            assert.throws(() => solo.startFiveBossSoloSync(p.id, `blocked-${p.id}`, () => insertSolo(p)), /Finish or abort/)
            assert.equal(snapshot(), before)
        }
        const p = player(), r = room([p]); start(p, r); proof(p, r)
        const before = snapshot()
        assert.equal(typeof ledger.detachFinalizedFiveBossActiveSync, 'function')
        assert.equal(ledger.detachFinalizedFiveBossActiveSync(p.id, 'wrong-play'), false)
        assert.equal(snapshot(), before)
        assert.equal(detach(p), true)
        assert.equal(active.getPlayerActiveQuestSync(p.id), null)
        const detached = snapshot(); assert.equal(detach(p), false); assert.equal(snapshot(), detached)
    })
    test('a failed new solo or different-room start rolls back marker, occupancy and all fees', () => {
        const p = player(), r = room([p]); start(p, r); proof(p, r)
        const before = snapshot()
        assert.throws(() => solo.startFiveBossSoloSync(p.id, `bad-solo-${p.id}`, () => { throw new Error('new solo persist failure') }), /new solo persist failure/)
        assert.equal(snapshot(), before)
        const n = room([p]), next = { ...p, playId: `new-multi-${p.id}` }
        const withRoom = snapshot()
        db.exec(`CREATE TRIGGER pending_new_start_fault BEFORE INSERT ON players_active_quests WHEN NEW.play_id='${next.playId}'
            BEGIN SELECT RAISE(ABORT, 'new multi persist failure'); END`)
        try { assert.throws(() => db.transaction(() => { assert.equal(detach(p), true); start(next, n) })(), /new multi persist failure/) }
        finally { db.exec('DROP TRIGGER pending_new_start_fault') }
        assert.equal(snapshot(), withRoom)
        assert.equal(pendingMarker(p, r), null)
    })
    test('late receipt SQL failure preserves a newer active quest and the old pending entitlement', () => {
        const p = player(), r = room([p]); start(p, r); proof(p, r)
        assert.equal(detach(p), true); insertSolo(p)
        const before = snapshot()
        db.exec(`CREATE TRIGGER pending_receipt_fault BEFORE INSERT ON five_boss_gauntlet_receipts WHEN NEW.player_id=${p.id}
            BEGIN SELECT RAISE(ABORT, 'old pending receipt failure'); END`)
        try { assert.throws(() => finish(p, r), /old pending receipt failure/) }
        finally { db.exec('DROP TRIGGER pending_receipt_fault') }
        assert.equal(snapshot(), before)
        const newer = active.getPlayerActiveQuestSync(p.id)
        assert.equal(finish(p, r).receiptStatus, 'settled')
        assert.deepEqual(active.getPlayerActiveQuestSync(p.id), newer)
    })
    test('an explicit late failed finish retires only its old member while another real member keeps playing', () => {
        const host = player(), guest = player(), r = room([host, guest])
        start(host, r); start(guest, r); proof(host, r)
        const guestActive = active.getPlayerActiveQuestSync(guest.id)
        assert.equal(detach(host), true); insertSolo(host)
        const newer = active.getPlayerActiveQuestSync(host.id)
        const result = runtime.finishFiveBossBattle({ ...identity(host, r), accomplished: false })
        assert.equal(result.kind, 'failed'); assert.equal(result.runStatus, 'active')
        assert.deepEqual(active.getPlayerActiveQuestSync(host.id), newer)
        assert.deepEqual(active.getPlayerActiveQuestSync(guest.id), guestActive)
        assert.equal(items.getPlayerItemSync(host.id, 10000145), null)
        assert.equal(member(guest, r).aborted_at, null)
    })
    test('V2 import resetting active state never fabricates a pending-result authorization', () => {
        const p = player(), r = room([p]); start(p, r); proof(p, r)
        const saves = load('data/snapshots/player-snapshot'), archive = saves.createPlayerSaveSnapshotV2Sync(p.id)
        saves.restorePlayerSaveSnapshotV2Sync(archive, p.id)
        assert.equal(active.getPlayerActiveQuestSync(p.id), null)
        assert.equal(detach(p), false); assert.equal(pendingMarker(p, r), null)
        assert.throws(() => finish(p, r), /persistent active quest/)
    })
    test('two independent processes settle the detached original play once without touching the new active', async () => {
        const p = player(), r = room([p]); start(p, r); proof(p, r)
        assert.equal(detach(p), true); insertSolo(p)
        const newer = active.getPlayerActiveQuestSync(p.id)
        assert.equal(rooms.disbandRoom(r.room_number, 'room_timeout'), true)
        assert.equal(member(p, r).aborted_at, null, 'retiring an expired old room must not abort the detached result')
        assert.ok(pendingMarker(p, r))
        const results = await Promise.all([finishChild(p, r), finishChild(p, r)])
        assert.deepEqual(results.map(result => result.receiptStatus).sort(), ['already_settled', 'settled'])
        assert.deepEqual(results[0].reward, results[1].reward)
        assert.equal(db.prepare('SELECT COUNT(*) n FROM five_boss_gauntlet_receipts WHERE run_id=? AND player_id=?').get(r.five_boss_runtime.runId, p.id).n, 1)
        assert.deepEqual(active.getPlayerActiveQuestSync(p.id), newer)
    })
}
