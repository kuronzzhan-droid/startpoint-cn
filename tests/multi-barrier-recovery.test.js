const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { SessionManager } = require('../out/multi/state/SessionManager')
const { embeddedMultiCoordinator: coordinator } = require('../out/multi/coordinator/embedded')
const originalInterval = global.setInterval
global.setInterval = (...args) => { const timer = originalInterval(...args); timer.unref(); return timer }
const rooms = require('../out/multi/room/manager')
const { handleHandshake } = require('../out/multi/tcp/handshake')
const { sessionManager: singleton } = require('../out/multi/state/SessionManager')
global.setInterval = originalInterval

class Socket extends EventEmitter {
    destroyed = false; writable = true; readable = true; frames = []
    write(frame) { this.frames.push(JSON.parse(frame.replace(/\0$/, ''))); return true }
    destroy() { this.destroyed = true; this.writable = false }
    end() { this.destroy() }
}

function setup(t, count = 2, initialCount = count) {
    const timers = []
    t.mock.method(global, 'setTimeout', (fn, ms) => {
        const timer = { fn, ms, cancelled: false, unref() {} }; timers.push(timer); return timer
    })
    t.mock.method(global, 'clearTimeout', timer => { if (timer) timer.cancelled = true })
    const room = { lifecycle: { instanceId: 'instance-a', battleSessionId: 'battle-a', phase: 'BATTLE' } }
    t.mock.method(rooms, 'getRoom', () => room)
    const manager = new SessionManager(), roomNumber = '701001'
    const make = (id, cid = `cid-${id}`) => {
        const client = manager.createClient(new Socket(), id, roomNumber, cid, id)
        client.isBattle = true; client.roomGeneration = 1
        return client
    }
    const clients = Array.from({ length: count }, (_, i) => make(i + 1))
    manager.setBattleExpectedCount(roomNumber, initialCount,
        Array.from({ length: initialCount }, (_, i) => ({ viewerId: i + 1, connectionId: `cid-${i + 1}` })))
    for (const client of clients) assert.equal(manager.addBattleClient(client.connectionId, client), true)
    const fire = async timer => {
        assert.ok(timer, 'timer must exist'); timer.fn()
        await new Promise(resolve => setImmediate(resolve))
        await coordinator.enqueueRoomCommand(roomNumber, () => {})
    }
    const ready = c => manager.markSceneReady(c.connectionId, roomNumber)
    const grace = () => manager.battleBarrierCycles.get(roomNumber)?.timers.get('viewer:2')
    const drop = c => { c.socket.destroy(); manager.removeClient(c) }
    return { manager, clients, make, ready, fire, grace, drop, roomNumber, room, timers }
}

test('five-boss diagnostics identify loading timeout and seat expiry without an active heartbeat', async t => {
    const x = setup(t), [a,b] = x.clients
    const trace = require('../out/multi/five-boss/connection-diagnostic').fiveBossConnectionDiagnostics
    Object.assign(x.room, { room_number: x.roomNumber, lobby_generation: 1, five_boss_runtime: {
        runId: 'diagnostic-timeouts', expectedRealPlayerIds: [1, 2], battleIdentityByViewerId: {
            1: { playerId: 1, connectionId: a.connectionId }, 2: { playerId: 2, connectionId: b.connectionId },
        },
    } })
    trace.bind(x.room, a); trace.bind(x.room, b)
    const loading = x.manager.battleHeartbeatTimers.get(b.connectionId)
    await x.fire(loading)
    assert.equal(b.socket.destroyed, true)
    x.manager.removeClient(b)
    await x.fire(x.grace())
    const missing = trace.snapshot('diagnostic-timeouts', 2)
    assert.equal(missing.counts.loading_timeout.count, 1)
    assert.equal(missing.counts.removed.count, 1)
    assert.equal(missing.counts.seat_expired.count, 1)
    assert.equal(trace.snapshot('diagnostic-timeouts', 1).counts.seat_expired, undefined)
    x.ready(a)
    assert.equal(x.manager.battleHeartbeatTimers.get(a.connectionId), undefined)
    assert.equal(a.socket.destroyed, false)
    assert.equal(trace.snapshot('diagnostic-timeouts', 1).counts.heartbeat_timeout, undefined)
})

test('lease expiry rechecks socket I/O before disconnecting a live client', async t => {
    const x = setup(t), [a,b] = x.clients

    const loading = x.manager.battleHeartbeatTimers.get(a.connectionId)
    loading.fn()
    assert.equal(x.ready(a), false)
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(a.socket.destroyed, false, 'SceneReady waiting behind the timer must replace the loading lease')

    assert.equal(x.ready(b), true)
    const heartbeat = x.manager.battleHeartbeatTimers.get(a.connectionId)
    const future = Date.now() + 120000
    t.mock.method(Date, 'now', () => future)
    heartbeat.fn()
    x.manager.noteBattleActivity(a.connectionId)
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(a.socket.destroyed, false, 'activity waiting behind the timer must renew the heartbeat lease')
})

test('two-player loading: grace then BattleStart before AI Leave; late peer denied', async t => {
    const x = setup(t), [a,b] = x.clients
    assert.equal(x.ready(a), false); x.drop(b)
    assert.deepEqual(a.socket.frames, [])
    assert.equal(x.manager.battleExpectedCount.get(x.roomNumber), 2)
    await x.fire(x.grace())
    assert.deepEqual(a.socket.frames, [[1,[1]], [1,[0,b.connectionId]]])
    assert.equal(x.manager.addBattleClient(b.connectionId, x.make(2)), false)
    assert.equal(x.manager.addBattleClient(b.connectionId, x.make(0, b.connectionId)), false,
        'a missing lobby identity cannot bypass an expired connection seat')
    assert.equal(x.manager.battleExpectedCount.get(x.roomNumber), 0)
})

test('five-boss survivor records battle entry when a missing peer becomes AI', async t => {
    const x = setup(t), [a,b] = x.clients
    const calls = []
    const runtime = require('../out/multi/five-boss/lobby-runtime')
    t.mock.method(runtime, 'recordFiveBossSignal', (_room, client, signal) => {
        calls.push({ viewerId: client.viewerId, signal })
        client.fiveBossBattleEntered = true
        return true
    })
    Object.assign(x.room, {
        room_number: x.roomNumber,
        lobby_generation: 1,
        five_boss_runtime: {
            runId: 'survivor-run',
            expectedRealPlayerIds: [1, 2],
            autoplayModeByPlayerId: { 1: false, 2: false },
            partyCharacterIdsByPlayerId: { 1: [1], 2: [1] },
            battleIdentityByViewerId: {},
        },
    })
    x.ready(a); x.drop(b)
    await x.fire(x.grace())
    assert.deepEqual(calls, [{ viewerId: a.viewerId, signal: 'scene_ready' }])
    assert.equal(a.fiveBossBattleEntered, true)
})

test('reconnect within grace cancels retirement and deferred Leave', async t => {
    const x = setup(t), [a,b] = x.clients
    x.ready(a); x.drop(b); const oldTimer = x.grace()
    const replacement = x.make(2)
    assert.equal(x.manager.addBattleClient(replacement.connectionId, replacement), true)
    await x.fire(oldTimer)
    assert.equal(x.manager.battleExpectedCount.get(x.roomNumber), 2)
    assert.equal(x.ready(replacement), true)
    assert.deepEqual(a.socket.frames, [[1,[1]]])
})

test('entered five-boss peer that drops mid-battle publishes Leave so teammates do not stall', async t => {
    const x = setup(t), [a,b] = x.clients
    x.ready(a); x.ready(b); a.socket.frames = []
    a.fiveBossBattleEntered = true
    b.fiveBossBattleEntered = true
    x.drop(b)
    assert.deepEqual(a.socket.frames, [[1,[0,b.connectionId]]])
})

test('entered five-boss peer closing after its own Finalize does not publish Leave', async t => {
    const x = setup(t), [a,b] = x.clients
    x.ready(a); x.ready(b); a.socket.frames = []
    b.fiveBossBattleEntered = true
    b.finalizeSent = true
    x.drop(b)
    assert.deepEqual(a.socket.frames, [])
})

test('five-boss replacement remains current after the old socket closes', async t => {
    const x = setup(t), [a,b] = x.clients
    x.ready(a); x.ready(b); a.socket.frames = []
    b.fiveBossBattleEntered = true
    x.drop(b)
    const replacement = x.make(2)
    assert.equal(x.manager.addBattleClient(replacement.connectionId, replacement), true)
    x.manager.removeClient(b)
    assert.deepEqual(a.socket.frames, [[1,[0,b.connectionId]]], 'one Leave for the drop, none for the stale close')
    assert.equal(x.manager.getBattleClient(replacement.connectionId), replacement)
})

test('superseded and repeated socket close cannot remove a replacement or subtract twice', async t => {
    const x = setup(t), [a,b] = x.clients
    x.ready(a)
    const replacement = x.make(2)
    x.manager.addBattleClient(replacement.connectionId, replacement)
    x.manager.removeClient(b); x.manager.removeClient(b)
    assert.equal(x.grace(), undefined)
    assert.equal(x.manager.getBattleClient(b.connectionId), replacement)
    x.drop(replacement); const timer = x.grace(); x.manager.removeClient(replacement)
    assert.equal(x.grace(), timer); await x.fire(timer); await x.fire(timer)
    assert.deepEqual(a.socket.frames, [[1,[1]], [1,[0,b.connectionId]]])
})

test('next-scene loading lease starts only on each peer LevelNext; duplicates do not reset it', t => {
    const x = setup(t), [a,b] = x.clients
    x.ready(a); x.ready(b)
    x.manager.beginBattleLevelNext(a.connectionId, x.roomNumber)
    assert.equal(x.manager.battleConnectionPhase.get(a.connectionId), 'loading')
    assert.equal(x.manager.battleConnectionPhase.get(b.connectionId), 'active')
    const timer = x.manager.battleHeartbeatTimers.get(a.connectionId)
    x.manager.beginBattleLevelNext(a.connectionId, x.roomNumber)
    assert.equal(x.manager.battleHeartbeatTimers.get(a.connectionId), timer)
    x.ready(a)
    x.manager.beginBattleLevelNext(a.connectionId, x.roomNumber)
    assert.equal(x.manager.battleConnectionPhase.get(a.connectionId), 'ready')
    x.manager.beginBattleLevelNext(b.connectionId, x.roomNumber)
    assert.equal(x.ready(b), true)
})

test('five-boss active scene may stay silent beyond the ordinary heartbeat lease', async t => {
    const x = setup(t), [a,b] = x.clients
    Object.assign(x.room, { room_number: x.roomNumber, category: 2, quest_id: 1099001,
        lobby_generation: 1, five_boss_runtime: {
            runId: 'silent-five-boss', expectedRealPlayerIds: [1, 2],
            autoplayModeByPlayerId: { 1: false, 2: false },
            partyCharacterIdsByPlayerId: { 1: [1], 2: [1] },
            battleIdentityByViewerId: {},
        } })
    const runtime = require('../out/multi/five-boss/lobby-runtime')
    t.mock.method(runtime, 'recordFiveBossSignal', (_room, client, signal) => {
        if (signal === 'scene_ready') client.fiveBossBattleEntered = true
        return true
    })
    x.ready(a); x.ready(b)
    assert.equal(x.manager.battleHeartbeatTimers.get(a.connectionId), undefined)
    assert.equal(x.manager.battleHeartbeatTimers.get(b.connectionId), undefined)
    const future = Date.now() + 120000
    t.mock.method(Date, 'now', () => future)
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(a.socket.destroyed, false)
    assert.equal(b.socket.destroyed, false)
    x.manager.beginBattleLevelNext(a.connectionId, x.roomNumber)
    assert.equal(x.manager.battleConnectionPhase.get(a.connectionId), 'loading')
    assert.ok(x.manager.battleHeartbeatTimers.get(a.connectionId))
    x.ready(a)
    assert.equal(x.manager.battleHeartbeatTimers.get(a.connectionId), undefined)
    assert.equal(a.socket.destroyed, false)
})

test('next-scene disconnected peer does not strand the remaining ready player', async t => {
    const x = setup(t), [a,b] = x.clients
    x.ready(a); x.ready(b); a.socket.frames = []
    a.fiveBossBattleEntered = true
    b.fiveBossBattleEntered = true
    x.manager.beginBattleLevelNext(a.connectionId, x.roomNumber)
    x.drop(b); x.ready(a); await x.fire(x.grace())
    assert.deepEqual(a.socket.frames, [[1,[1]], [1,[0,b.connectionId]]])
})

test('next-scene deadline releases teammates from a connected peer that never starts loading', async t => {
    const x = setup(t, 3), [a,b,c] = x.clients
    x.ready(a); x.ready(b); x.ready(c)
    for (const client of x.clients) client.fiveBossBattleEntered = true
    a.socket.frames = []
    x.manager.beginBattleLevelNext(a.connectionId, x.roomNumber)
    x.manager.beginBattleLevelNext(b.connectionId, x.roomNumber)
    x.ready(a)
    // c keeps an open socket but never sends LevelNext or SceneReady; with no
    // heartbeat lease on an entered five-boss connection nothing else ends it.
    const deadline = x.manager.battleBarrierCycles.get(x.roomNumber).timers.get('level_next_deadline')
    assert.equal(deadline.ms, 90000)
    await x.fire(deadline)
    assert.equal(a.socket.destroyed, false)
    assert.equal(b.socket.destroyed, false, 'a peer still loading keeps its own loading lease')
    assert.equal(c.socket.destroyed, true)
    assert.deepEqual(a.socket.frames, [])
    x.manager.removeClient(c)
    x.ready(b)
    await x.fire(x.manager.battleBarrierCycles.get(x.roomNumber).timers.get('viewer:3'))
    assert.deepEqual(a.socket.frames, [[1,[1]], [1,[0,c.connectionId]]])
})

test('next-scene deadline is inert once the barrier released or a new scene began', async t => {
    const x = setup(t), [a,b] = x.clients
    x.ready(a); x.ready(b)
    x.manager.beginBattleLevelNext(a.connectionId, x.roomNumber)
    const deadline = x.manager.battleBarrierCycles.get(x.roomNumber).timers.get('level_next_deadline')
    x.manager.beginBattleLevelNext(b.connectionId, x.roomNumber)
    x.ready(a); assert.equal(x.ready(b), true)
    assert.equal(deadline.cancelled, true)
    await x.fire(deadline)
    assert.equal(a.socket.destroyed, false)
    assert.equal(b.socket.destroyed, false)
})

test('a replacement connection can finish loading without replaying LevelNext', t => {
    const x = setup(t), [a,b] = x.clients
    x.ready(a); x.ready(b)
    x.manager.beginBattleLevelNext(a.connectionId, x.roomNumber)
    x.manager.beginBattleLevelNext(b.connectionId, x.roomNumber)
    x.ready(a); x.drop(b)
    const replacement = x.make(2)
    x.manager.addBattleClient(replacement.connectionId, replacement)
    assert.equal(x.ready(replacement), true)
    assert.deepEqual(replacement.socket.frames, [[1,[1]]])
})

test('frozen lobby member that never opens a battle socket expires once', async t => {
    const x = setup(t, 1, 2), [a] = x.clients
    const initial = x.manager.battleBarrierCycles.get(x.roomNumber).timers.get('initial_roster')
    x.ready(a); await x.fire(initial)
    assert.deepEqual(a.socket.frames, [[1,[1]], [1,[0,'cid-2']]])
    assert.equal(x.manager.addBattleClient('cid-2', x.make(2)), false)
})

test('initial roster timeout never removes a connected player who is still loading', async t => {
    const x = setup(t), [a,b] = x.clients
    const initial = x.manager.battleBarrierCycles.get(x.roomNumber).timers.get('initial_roster')
    x.ready(a); await x.fire(initial)
    assert.equal(x.manager.battleExpectedCount.get(x.roomNumber), 2)
    assert.deepEqual(a.socket.frames, [])
    assert.equal(x.ready(b), true)
})

test('initial roster deadline does not shorten a connected member reconnect grace', async t => {
    const x = setup(t), [a,b] = x.clients
    const initial = x.manager.battleBarrierCycles.get(x.roomNumber).timers.get('initial_roster')
    x.ready(a); x.drop(b); await x.fire(initial)
    assert.equal(x.manager.battleExpectedCount.get(x.roomNumber), 2)
    assert.deepEqual(a.socket.frames, [])
    await x.fire(x.grace())
    assert.deepEqual(a.socket.frames, [[1,[1]], [1,[0,b.connectionId]]])
})

test('an unresolved lobby viewer still counts as arrived by its real connection ID', async t => {
    const x = setup(t, 0, 2), a = x.make(0, 'cid-1'), b = x.make(2)
    x.manager.addBattleClient(a.connectionId, a); x.manager.addBattleClient(b.connectionId, b)
    const cycle = x.manager.battleBarrierCycles.get(x.roomNumber)
    const initial = cycle.timers.get('initial_roster')
    x.ready(b); x.drop(a)
    await x.fire(initial)
    assert.equal(x.manager.battleExpectedCount.get(x.roomNumber), 2)
    await x.fire(cycle.timers.get('connection:cid-1'))
    assert.deepEqual(b.socket.frames, [[1,[1]], [1,[0,'cid-1']]])
})

test('unknown or cross-room SceneReady cannot release a barrier', t => {
    const x = setup(t)
    assert.equal(x.manager.markSceneReady('unknown', x.roomNumber), false)
    assert.equal(x.manager.markSceneReady('cid-1', 'another-room'), false)
    assert.equal(x.manager.sceneReadyClients.get(x.roomNumber).size, 0)
})

test('old grace callback queued before a new round cannot mutate that round', async t => {
    const x = setup(t), [a,b] = x.clients
    x.ready(a); x.drop(b); const old = x.grace()
    let release
    const blocked = coordinator.enqueueRoomCommand(x.roomNumber, () => new Promise(resolve => { release = resolve }))
    await Promise.resolve(); old.fn()
    x.manager.clearBattleExpectedCount(x.roomNumber)
    x.manager.setBattleExpectedCount(x.roomNumber, 3)
    release(); await blocked; await coordinator.enqueueRoomCommand(x.roomNumber, () => {})
    assert.equal(x.manager.battleExpectedCount.get(x.roomNumber), 3)
    assert.deepEqual(a.socket.frames, [])
})

test('room identity reuse and settlement invalidate pending grace', async t => {
    for (const mode of ['reused', 'settling']) {
        const x = setup(t), [a,b] = x.clients
        x.ready(a); x.drop(b); const old = x.grace()
        if (mode === 'reused') x.room.lifecycle.instanceId = 'instance-b'
        else x.room.lifecycle.phase = 'SETTLING'
        await x.fire(old)
        assert.equal(x.manager.battleExpectedCount.get(x.roomNumber), 2)
        assert.deepEqual(a.socket.frames, [])
    }
})

test('rematch lobby host grace does not expire before the guest reconnect window', t => {
    const timers = []
    t.mock.method(global, 'setTimeout', (fn, ms) => {
        const timer = { fn, ms, cancelled: false, unref() {} }
        timers.push(timer)
        return timer
    })
    t.mock.method(global, 'clearTimeout', timer => { if (timer) timer.cancelled = true })
    const room = {
        room_number: '701002',
        host_viewer_id: 1,
        lobby_generation: 1,
        expected_real_viewer_ids: [1, 2],
        lifecycle: { instanceId: 'instance-rematch', phase: 'LOBBY', version: 1 },
    }
    t.mock.method(rooms, 'getRoom', () => room)
    const manager = new SessionManager()
    manager.beginHostReconnectGrace(room.room_number)
    const reconnectTimer = timers.at(-1)
    assert.ok(reconnectTimer)
    assert.ok(reconnectTimer.ms >= 60_000)
})

test('five-boss settlement recognizes an already-entered host lobby connection', t => {
    const timers = []
    t.mock.method(global, 'setTimeout', (fn, ms) => {
        const timer = { fn, ms, cancelled: false, unref() {} }
        timers.push(timer)
        return timer
    })
    t.mock.method(global, 'clearTimeout', timer => { if (timer) timer.cancelled = true })
    const room = {
        room_number: '701003',
        category: 2,
        quest_id: 1099001,
        host_viewer_id: 1,
        lobby_generation: 1,
        settlement_return_pending: true,
        raising_state: 1,
        lifecycle: {
            instanceId: 'instance-five-boss-return',
            battleSessionId: 'battle-five-boss-return',
            phase: 'RETURNING',
            version: 3,
        },
    }
    t.mock.method(rooms, 'getRoom', () => room)
    const manager = new SessionManager()
    const host = manager.createClient(new Socket(), 1, room.room_number, 'host-lobby', 1)
    host.roomGeneration = 0
    host.enterData = {}
    manager.addClientToRoom(host)

    manager.beginSettlementReturnGrace(room.room_number)

    assert.equal(room.lifecycle.phase, 'LOBBY')
    assert.equal(room.settlement_return_pending, false)
    assert.equal(room.lifecycle.battleSessionId, null)
    assert.equal(host.roomGeneration, room.lobby_generation)
    assert.equal(manager.settlementReturnTimers.has(room.room_number), false)
})

test('retirement resets only with a new round; empty rooms never broadcast BattleStart', async t => {
    const x = setup(t), [a,b] = x.clients
    x.drop(a); x.drop(b)
    const cycle = x.manager.battleBarrierCycles.get(x.roomNumber)
    await x.fire(cycle.timers.get('viewer:1')); await x.fire(cycle.timers.get('viewer:2'))
    assert.equal(x.manager.battleSceneStartedRooms.has(x.roomNumber), false)
    x.manager.setBattleExpectedCount(x.roomNumber, 2)
    assert.equal(x.manager.addBattleClient('cid-2', x.make(2)), true)
})

test('clearing settlement barriers does not reopen a retired battle seat', async t => {
    const x = setup(t), [a,b] = x.clients
    x.ready(a); x.drop(b); await x.fire(x.grace())
    x.manager.clearBattleExpectedCount(x.roomNumber)
    assert.equal(x.manager.addBattleClient('cid-2', x.make(2)), false)
    x.manager.setBattleExpectedCount(x.roomNumber, 2)
    assert.equal(x.manager.addBattleClient('cid-2', x.make(2)), true)
})

test('battle handshakes reject non-battle rooms and retired seats without a welcome', async t => {
    const x = setup(t)
    const add = t.mock.method(singleton, 'addBattleClient', () => false)
    t.mock.method(singleton, 'getRoomClientByConnectionId', () => ({ viewerId: 9, playerId: 9, roomGeneration: 1 }))
    for (const phase of ['SETTLING', 'RETURNING', 'DISBANDED', 'BATTLE']) {
        x.room.lifecycle.phase = phase
        const socket = new Socket()
        await handleHandshake(socket, { socklet: 'cooperation_battle', room_number: x.roomNumber, connection_id: 'late' })
        assert.deepEqual(socket.frames, [[3, 'HANDSHAKE_DENIED']])
        assert.equal(socket.destroyed, true)
    }
    assert.equal(add.mock.callCount(), 1, 'only a live BATTLE room may attempt seat admission')
})

test('battle handshake with a connection id no seat issued is denied before admission', async t => {
    const x = setup(t)
    const add = t.mock.method(singleton, 'addBattleClient', () => true)
    t.mock.method(singleton, 'getRoomClientByConnectionId', () => undefined)
    x.room.lifecycle.phase = 'BATTLE'
    const socket = new Socket()
    await handleHandshake(socket, { socklet: 'cooperation_battle', room_number: x.roomNumber, connection_id: 'not-issued' })
    assert.deepEqual(socket.frames, [[3, 'HANDSHAKE_DENIED']])
    assert.equal(socket.destroyed, true)
    assert.equal(add.mock.callCount(), 0)
})

test('battle identity falls back to a known seat when the lobby connection is gone', t => {
    const x = setup(t), [a, b] = x.clients
    t.mock.method(x.manager, 'getRoomClientByConnectionId', () => undefined)
    // Live battle connection with the same id.
    assert.deepEqual(x.manager.resolveBattleHandshakeIdentity(x.roomNumber, a.connectionId),
        { viewerId: 1, playerId: 1, roomGeneration: 1 })
    // Seat waiting for reconnect after its battle socket dropped.
    x.drop(b)
    const seat = x.manager.resolveBattleHandshakeIdentity(x.roomNumber, b.connectionId)
    assert.equal(seat.viewerId, 2)
    assert.equal(seat.roomGeneration, 1, 'a reconnecting seat joins the peers battle round')
    // Five-boss frozen identity.
    x.room.five_boss_runtime = { battleIdentityByViewerId: { 7: { playerId: 70, connectionId: 'frozen-cid' } } }
    assert.deepEqual(x.manager.resolveBattleHandshakeIdentity(x.roomNumber, 'frozen-cid'),
        { viewerId: 7, playerId: 70, roomGeneration: 1 })
    assert.equal(x.manager.resolveBattleHandshakeIdentity(x.roomNumber, 'unknown-cid'), null)
    assert.equal(x.manager.resolveBattleHandshakeIdentity('999999', a.connectionId), null)
})
