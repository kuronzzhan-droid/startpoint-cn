'use strict'
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { unpack } = require('msgpackr')

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'five-boss-pending-load-'))
Object.assign(process.env, { DATA_DIR: directory, GACHA_SEED_DIR: path.join(directory, 'seeds'),
    CN_WRITER_THREAD: '0', MULTI_REALTIME_PROCESS: '0', GAME_ROUTINE_LOGS: 'off' })
const output = process.env.LENS_BUILD_OUT || path.resolve(__dirname, '../out')
const load = name => require(path.join(output, name))
const timers = [], interval = global.setInterval
global.setInterval = (...args) => { const timer = interval(...args); timers.push(timer); return timer }
let db, players, active, ledger, runtime, solo, items, mode, rooms, battle, coordinator, memory, routes
try {
    db = load('data/db').getDb()
    players = load('data/domains/player'); active = load('data/domains/quest_active')
    ledger = load('data/domains/fiveBossGauntletRun'); runtime = load('multi/five-boss/battle-runtime')
    solo = load('multi/five-boss/solo-runtime'); items = load('data/domains/item')
    mode = load('multi/five-boss/contract').FIVE_BOSS_GAUNTLET
    rooms = load('multi/room/manager'); battle = load('multi/state/battle-contract')
    coordinator = load('multi/coordinator/default-runtime')
    memory = load('routes/api/singleBattleQuest').activeQuests
    routes = load('routes/cn/load').default
} finally { global.setInterval = interval }
let app, sequence = 0

async function player() {
    const id = ++sequence
    const account = load('data/domains/account').insertAccountSync({ appId: 'wf_cn', idpAlias: '',
        idpCode: 'pending-load', idpId: `pending-load-${id}`, status: 'normal' })
    const p = players.insertDefaultPlayerSync(account.id)
    load('data/activeAccount').saveAccountDefaultPlayer(account.id, p.id)
    const viewerId = 787000000 + id
    await load('data/domains/session').insertSessionWithToken({ token: String(viewerId), accountId: account.id,
        expires: new Date('2099-01-01'), type: 2 })
    players.updatePlayerSync({ id: p.id, stamina: 200, staminaHealTime: new Date() })
    items.setPlayerItemSync(p.id, mode.ticketItemId, 6)
    load('lib/character').givePlayerCharacterSync(p.id, 111001)
    return { ...p, viewerId, playId: `pending-load-play-${id}` }
}

function room(members) {
    const host = members[0], value = rooms.createRoom(host.viewerId, host.id, 1, mode.category, mode.visibleQuestId, 0, 111001)
    value.raising_state = 4
    value.lifecycle.phase = 'BATTLE'
    value.lifecycle.battleSessionId = `pending-load-session-${++sequence}`
    value.lifecycle.sceneEpoch = 0
    value.mates = members.map(p => ({ viewer_id: p.viewerId, player_id: p.id, com_id: 0 }))
    value.member_viewer_ids = members.map(p => p.viewerId)
    value.expected_real_viewer_ids = members.map(p => p.viewerId)
    value.member_player_ids = Object.fromEntries(members.map(p => [p.viewerId, p.id]))
    value.five_boss_runtime = { runId: `pending-load-run-${++sequence}`, expectedRealPlayerIds: members.map(p => p.id),
        autoplayModeByPlayerId: Object.fromEntries(members.map(p => [p.id, false])),
        partyCharacterIdsByPlayerId: Object.fromEntries(members.map(p => [p.id, [111001]])), battleIdentityByViewerId: {} }
    return value
}
const identity = (p, r) => ({ playerId: p.id, clientPlayId: p.playId, requestRoomNumber: r.room_number,
    requestCategory: mode.category, requestQuestId: mode.visibleQuestId })
function start(p, r) {
    const result = runtime.startFiveBossBattle({ ...identity(p, r), room: r, useBoostPoint: false, useBossBoostPoint: false })
    assert.equal(battle.bindBattlePlay(r, p.viewerId, p.id, p.playId), true)
    battle.markBattleMemberPhase(r, p.viewerId, 'ACTIVE')
    memory[p.id] = result.activeQuest
}
function proof(p, r, finalized = true) {
    for (const signal of finalized ? ['scene_ready', 'level_next', 'finalize'] : ['scene_ready']) {
        ledger.recordMemberBattleSignalSync({ runId: r.five_boss_runtime.runId, playerId: p.id, roomNumber: r.room_number, signal })
    }
    if (finalized) battle.markBattleMemberPhase(r, p.viewerId, 'FINALIZED')
}
const member = (p, r) => db.prepare('SELECT * FROM five_boss_gauntlet_members WHERE run_id=? AND player_id=?')
    .get(r.five_boss_runtime.runId, p.id)
const marker = (p, r) => member(p, r).result_pending_at ?? null
const finish = (p, r) => runtime.finishFiveBossBattle({ ...identity(p, r), accomplished: true, elapsedTimeMs: 30000, randomFloat: () => 0.1 })

async function login(p, status = 200) {
    const response = await app.inject({ method: 'POST', url: '/cn/load', payload: { viewer_id: p.viewerId }, headers: { device: 'android' } })
    assert.equal(response.statusCode, status, response.body)
    if (status !== 200) return response
    const decoded = unpack(Buffer.from(response.body, 'base64'))
    assert.equal(decoded.data_headers.result_code, 1)
    return decoded.data
}
function hidden(data) {
    assert.deepEqual(data.unfinished_quest_list, [])
    assert.deepEqual(data.unfinished_multi_quest_list, [])
}
function ledgerState() {
    return Object.fromEntries(['five_boss_gauntlet_runs', 'five_boss_gauntlet_members', 'five_boss_gauntlet_receipts']
        .map(table => [table, db.prepare(`SELECT * FROM ${table} ORDER BY 1,2`).all()]))
}

before(async () => {
    app = require('fastify')({ logger: false })
    const { CnResponseWorkerPool } = load('lib/cn-response-worker-pool')
    load('lib/cn-response-hook').installCnResponseEncoding(app, {
        pool: new CnResponseWorkerPool({ size: 0 }), compression: { mode: 'off' },
    })
    await app.register(routes, { prefix: '/cn' })
    await app.register(load('routes/api/singleBattleQuest').default, { prefix: '/single' })
    await app.register(async instance => load('multi/http/battle').registerBattleRoutes(instance), { prefix: '/multi' }); await app.ready()
    // Initialize the actual local owner and capture any timers created lazily.
    global.setInterval = (...args) => { const timer = interval(...args); timers.push(timer); return timer }
    try { coordinator.getRoomCommandGateway() } finally { global.setInterval = interval }
})

test('/cn/load hides finalized BATTLE restore and releases only occupancy with a pending result marker', async () => {
    const p = await player(), r = room([p]); start(p, r); proof(p, r)
    const before = member(p, r), reward = items.getPlayerItemSync(p.id, 10000145)
    hidden(await login(p))
    assert.equal(r.lifecycle.phase, 'BATTLE')
    assert.equal(active.getPlayerActiveQuestSync(p.id), null)
    assert.equal(memory[p.id], undefined)
    assert.ok(marker(p, r))
    const after = member(p, r)
    for (const key of ['client_play_id', 'battle_entered_at', 'level_next_at', 'finalized_at', 'aborted_at']) assert.equal(after[key], before[key], key)
    assert.equal(items.getPlayerItemSync(p.id, 10000145), reward)
    const detached = ledgerState(); hidden(await login(p)); assert.deepEqual(ledgerState(), detached)
})

test('/cn/load after old room expiry preserves exact late finish eligibility and pays once', async () => {
    const p = await player(), r = room([p]); start(p, r); proof(p, r)
    assert.equal(rooms.disbandRoom(r.room_number, 'fixture_old_room_expired'), true)
    hidden(await login(p)); assert.equal(active.getPlayerActiveQuestSync(p.id), null); assert.ok(marker(p, r))
    const first = finish(p, r), second = finish(p, r)
    assert.equal(first.receiptStatus, 'settled'); assert.equal(second.receiptStatus, 'already_settled')
    assert.deepEqual(second.reward, first.reward)
})

test('/cn/load waits for accepted Finalize persistence even after the old room is gone', async () => {
    const p = await player(), r = room([p]); start(p, r); proof(p, r, false)
    ledger.recordMemberBattleSignalSync({ runId: r.five_boss_runtime.runId, playerId: p.id, roomNumber: r.room_number, signal: 'level_next' })
    rooms.disbandRoom(r.room_number, 'fixture_finalize_write_pending')
    const gateway = coordinator.getRoomCommandGateway(), execute = gateway.execute
    let waited = false
    gateway.execute = async function(kind, ...args) {
        if (kind === 'fiveBoss.proof.barrier') {
            waited = true; await new Promise(resolve => setImmediate(resolve))
            ledger.recordMemberBattleSignalSync({ runId: r.five_boss_runtime.runId, playerId: p.id, roomNumber: r.room_number, signal: 'finalize' })
        }
        return execute.call(this, kind, ...args)
    }
    try { hidden(await login(p)) } finally { gateway.execute = execute }
    assert.equal(waited, true); assert.ok(marker(p, r))
    assert.equal(member(p, r).aborted_at, null)
    assert.equal(finish(p, r).receiptStatus, 'settled')
})

async function httpSolo(p, playId) {
    return app.inject({ method: 'POST', url: '/single/start', payload: { viewer_id: p.viewerId,
        play_id: playId, quest_id: mode.visibleQuestId, category: mode.category, party_id: 1,
        use_boost_point: false, use_boss_boost_point: false, is_auto_start_mode: false } })
}

async function httpMulti(p, r, playId) {
    return app.inject({ method: 'POST', url: '/multi/start', payload: { viewer_id: p.viewerId,
        play_id: playId, room_number: r.room_number, quest_id: mode.visibleQuestId, category: mode.category,
        party_id: 1, use_boost_point: false, use_boss_boost_point: false, is_auto_start_mode: false,
        mate_player_ids: [], mate_party_ids: [], combat_power: 1 } })
}

test('real multi HTTP start preserves the old finalized result and another member still fighting', async () => {
    const p = await player(), mate = await player(), oldRoom = room([p, mate])
    start(p, oldRoom); start(mate, oldRoom); proof(p, oldRoom); proof(mate, oldRoom, false)
    const mateActive = active.getPlayerActiveQuestSync(mate.id), nextRoom = room([p]), playId = `new-http-multi-${p.id}`
    const response = await httpMulti(p, nextRoom, playId)
    assert.equal(response.statusCode, 200, response.body)
    assert.equal(unpack(Buffer.from(response.body, 'base64')).data_headers.result_code, 1)
    assert.ok(marker(p, oldRoom)); assert.equal(member(p, oldRoom).aborted_at, null)
    assert.equal(active.getPlayerActiveQuestSync(p.id).playId, playId)
    assert.deepEqual(active.getPlayerActiveQuestSync(mate.id), mateActive)
    assert.equal(member(mate, oldRoom).aborted_at, null)
    assert.equal(oldRoom.lifecycle.phase, 'BATTLE')
    assert.equal(finish(p, oldRoom).receiptStatus, 'settled')
    assert.equal(active.getPlayerActiveQuestSync(p.id).playId, playId)
})

test('real guest-first HTTP admission detaches its finalized host and charges the new shared run once', async () => {
    const host = await player(), guest = await player(), oldRoom = room([host]); start(host, oldRoom); proof(host, oldRoom)
    const nextRoom = room([host, guest]), hostTickets = items.getPlayerItemSync(host.id, mode.ticketItemId)
    const guestPlay = `guest-first-http-${guest.id}`, hostPlay = `host-later-http-${host.id}`
    let response = await httpMulti(guest, nextRoom, guestPlay)
    assert.equal(response.statusCode, 200, response.body)
    assert.ok(marker(host, oldRoom)); assert.equal(active.getPlayerActiveQuestSync(host.id), null)
    assert.equal(memory[host.id], undefined)
    assert.equal(items.getPlayerItemSync(host.id, mode.ticketItemId), hostTickets - 1)
    response = await httpMulti(host, nextRoom, hostPlay)
    assert.equal(response.statusCode, 200, response.body)
    assert.equal(active.getPlayerActiveQuestSync(host.id).playId, hostPlay)
    assert.equal(items.getPlayerItemSync(host.id, mode.ticketItemId), hostTickets - 1)
    assert.equal(finish(host, oldRoom).receiptStatus, 'settled')
    assert.equal(active.getPlayerActiveQuestSync(host.id).playId, hostPlay)
})

test('real solo HTTP start waits for old Finalize persistence before its new payment transaction', async () => {
    const p = await player(), r = room([p]); start(p, r); proof(p, r, false)
    ledger.recordMemberBattleSignalSync({ runId: r.five_boss_runtime.runId, playerId: p.id, roomNumber: r.room_number, signal: 'level_next' })
    battle.markBattleMemberPhase(r, p.viewerId, 'FINALIZED')
    const gateway = coordinator.getRoomCommandGateway(), execute = gateway.execute
    let waited = false
    gateway.execute = async function(kind, ...args) {
        if (kind === 'fiveBoss.proof.barrier') {
            waited = true; await new Promise(resolve => setImmediate(resolve))
            ledger.recordMemberBattleSignalSync({ runId: r.five_boss_runtime.runId, playerId: p.id, roomNumber: r.room_number, signal: 'finalize' })
        }
        return execute.call(this, kind, ...args)
    }
    const playId = `http-solo-${p.id}`
    let response
    try { response = await httpSolo(p, playId) } finally { gateway.execute = execute }
    assert.equal(response.statusCode, 200, response.body)
    assert.equal(waited, true); assert.ok(marker(p, r))
    assert.equal(active.getPlayerActiveQuestSync(p.id).playId, playId)
    assert.equal(finish(p, r).receiptStatus, 'settled')
    assert.equal(active.getPlayerActiveQuestSync(p.id).playId, playId)
})

test('real solo HTTP start cannot detach finalized SQL proof while an old owner claim is unresolved', async () => {
    const p = await player(), r = room([p]); start(p, r); proof(p, r)
    const gateway = coordinator.getRoomCommandGateway()
    const claim = await gateway.execute('fiveBoss.start.prepare', { playerId: p.id,
        body: { viewer_id: p.viewerId, play_id: p.playId, room_number: r.room_number, category: mode.category, quest_id: mode.visibleQuestId } })
    const before = active.getPlayerActiveQuestSync(p.id), tickets = items.getPlayerItemSync(p.id, mode.ticketItemId)
    try {
        const response = await httpSolo(p, `protected-solo-${p.id}`)
        assert.equal(response.statusCode, 400, response.body)
        assert.deepEqual(active.getPlayerActiveQuestSync(p.id), before)
        assert.equal(marker(p, r), null)
        assert.equal(items.getPlayerItemSync(p.id, mode.ticketItemId), tickets)
    } finally { await gateway.execute('fiveBoss.start.cancel', { token: claim.token, playerId: p.id, playId: p.playId }) }
})

test('solo proof wait cannot overwrite another start committed while its old owner observation was pending', async () => {
    const p = await player(), r = room([p]); start(p, r); proof(p, r)
    const gateway = coordinator.getRoomCommandGateway(), execute = gateway.execute
    const tickets = items.getPlayerItemSync(p.id, mode.ticketItemId), concurrentPlay = `concurrent-new-${p.id}`
    gateway.execute = async function(kind, ...args) {
        if (kind === 'fiveBoss.proof.barrier') {
            assert.equal(ledger.detachFinalizedFiveBossActiveSync(p.id, p.playId), true)
            active.insertPlayerActiveQuestSync(p.id, { playerId: p.id, playId: concurrentPlay,
                questId: 1001001, category: 2, useBoostPoint: false, useBossBoostPoint: false,
                isAutoStartMode: false, isMulti: false, isMultiHost: false, roomNumber: null,
                entryItemId: null, eventId: null, continueCount: 0, startedAtMs: Date.now() })
        }
        return execute.call(this, kind, ...args)
    }
    let response
    try { response = await httpSolo(p, `stale-observation-solo-${p.id}`) } finally { gateway.execute = execute }
    assert.equal(response.statusCode, 400, response.body)
    assert.equal(active.getPlayerActiveQuestSync(p.id).playId, concurrentPlay)
    assert.equal(items.getPlayerItemSync(p.id, mode.ticketItemId), tickets)
    assert.equal(finish(p, r).receiptStatus, 'settled')
    assert.equal(active.getPlayerActiveQuestSync(p.id).playId, concurrentPlay)
})

test('/cn/load advertises a still-playing member without Finalize and keeps occupancy', async () => {
    const p = await player(), r = room([p]); start(p, r); proof(p, r, false)
    const before = active.getPlayerActiveQuestSync(p.id), data = await login(p)
    assert.deepEqual(data.unfinished_multi_quest_list, [{ play_id: p.playId, continue_count: 0 }])
    assert.deepEqual(active.getPlayerActiveQuestSync(p.id), before)
    assert.equal(marker(p, r), null)
})

test('/cn/load protects an unresolved owner start claim despite a Finalize observation', async () => {
    const p = await player(), r = room([p]); start(p, r); proof(p, r)
    const gateway = coordinator.getRoomCommandGateway()
    const claim = await gateway.execute('fiveBoss.start.prepare', { playerId: p.id,
        body: { viewer_id: p.viewerId, play_id: p.playId, room_number: r.room_number, category: mode.category, quest_id: mode.visibleQuestId } })
    assert.equal(claim.status, 'ready')
    try {
        const before = active.getPlayerActiveQuestSync(p.id), data = await login(p)
        assert.deepEqual(data.unfinished_multi_quest_list, [{ play_id: p.playId, continue_count: 0 }])
        assert.deepEqual(active.getPlayerActiveQuestSync(p.id), before)
        assert.equal(marker(p, r), null)
    } finally { await gateway.execute('fiveBoss.start.cancel', { token: claim.token, playerId: p.id, playId: p.playId }) }
})

test('/cn/load unknown owner RPC does not detach or manufacture a result marker', async () => {
    const p = await player(), r = room([p]); start(p, r); proof(p, r)
    const gateway = coordinator.getRoomCommandGateway(), execute = gateway.execute
    const before = active.getPlayerActiveQuestSync(p.id), oldMemory = memory[p.id], oldLedgers = ledgerState()
    gateway.execute = async function(kind, ...args) {
        if (kind === 'fiveBoss.recovery' || kind === 'battle.recovery') throw Object.assign(new Error('fixture owner outcome unknown'), { outcomeUnknown: true })
        return execute.call(this, kind, ...args)
    }
    try { await login(p, 500) } finally { gateway.execute = execute }
    assert.deepEqual(active.getPlayerActiveQuestSync(p.id), before)
    assert.deepEqual(memory[p.id], oldMemory)
    assert.deepEqual(ledgerState(), oldLedgers)
})

test('/cn/load detachment permits a new solo; original late finish never removes its active quest', async () => {
    const p = await player(), r = room([p]); start(p, r); proof(p, r); hidden(await login(p))
    const playId = `post-load-solo-${p.id}`
    solo.startFiveBossSoloSync(p.id, playId, () => active.insertPlayerActiveQuestSync(p.id, {
        playerId: p.id, playId, questId: mode.visibleQuestId, category: mode.category,
        useBoostPoint: false, useBossBoostPoint: false, isAutoStartMode: false, isMulti: false,
        isMultiHost: false, roomNumber: null, entryItemId: mode.ticketItemId, eventId: null,
        continueCount: 0, startedAtMs: Date.now(),
    }))
    const newer = active.getPlayerActiveQuestSync(p.id)
    assert.equal(finish(p, r).receiptStatus, 'settled')
    assert.deepEqual(active.getPlayerActiveQuestSync(p.id), newer)
    assert.equal(finish(p, r).receiptStatus, 'already_settled')
    assert.deepEqual(active.getPlayerActiveQuestSync(p.id), newer)
})

for (const version of [1, 2]) test(`V${version} import preserves target pending markers and shared members without moving source rights`, async () => {
    const source = await player(), sourceRoom = room([source]); start(source, sourceRoom); proof(source, sourceRoom)
    hidden(await login(source)); assert.ok(marker(source, sourceRoom))
    const saves = load('data/snapshots/player-snapshot')
    const archive = saves.createPlayerSaveSnapshotV2Sync(source.id)
    assert.equal(archive.data.tables.five_boss_gauntlet_members, undefined)
    assert.ok(archive.summary.excludedState.some(entry => entry.policy === 'preserve-target'
        && entry.tables.includes('five_boss_gauntlet_members')))
    for (const targetIsHost of [true, false]) {
        const target = await player(), mate = await player(), r = room(targetIsHost ? [target, mate] : [mate, target])
        start(target, r); start(mate, r); proof(target, r)
        hidden(await login(target)); assert.ok(marker(target, r))
        const before = ledgerState(), targetMarker = marker(target, r)
        if (version === 1) {
            const merged = load('data/utils/player-data').getMergedPlayerDataSync(source.id)
            merged.player.id = target.id
            players.replacePlayerDataSync(merged)
        } else saves.restorePlayerSaveSnapshotV2Sync(archive, target.id)
        assert.deepEqual(ledgerState(), before)
        assert.equal(marker(target, r), targetMarker)
        assert.equal(ledger.getFiveBossRunByClientSync({ playerId: target.id, clientPlayId: source.playId }), null)
        assert.equal(member(mate, r).aborted_at, null)
        assert.equal(member(mate, r).result_pending_at ?? null, null)
        assert.equal(finish(target, r).receiptStatus, 'settled')
        assert.equal(finish(target, r).receiptStatus, 'already_settled')
    }
})

after(async () => {
    if (app) await app.close()
    timers.forEach(clearInterval)
    try { await load('lib/seed-validator').default.close() } finally { if (db.open) db.close() }
    const resolved = fs.realpathSync(directory)
    assert.equal(path.dirname(resolved), fs.realpathSync(os.tmpdir()))
    assert.ok(path.basename(resolved).startsWith('five-boss-pending-load-'))
    fs.rmSync(resolved, { recursive: true })
})
