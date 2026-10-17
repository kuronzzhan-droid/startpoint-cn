const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { performance } = require('node:perf_hooks')
const path = require('node:path')
const output = process.env.LENS_BUILD_OUT || path.resolve(__dirname, '../out')
const load = name => require(path.join(output, name))
const roster = load('multi/room/rematch-roster')
const rooms = load('multi/room/manager')
const { sessionManager } = load('multi/state/SessionManager')
const { embeddedMultiCoordinator: coordinator } = load('multi/coordinator/embedded')
const lobby = load('multi/tcp/lobby')

function fixture(viewers = [101, 102, 103]) {
    return {
        host_viewer_id: 101, expected_real_viewer_ids: viewers,
        lobby_generation: 1, lifecycle: { instanceId: 'first', phase: 'LOBBY' },
    }
}

test('three-player slow results retain individual seats after another member returns', () => {
    const room = fixture()
    roster.ensureRematchReturnReservations(room, 0)
    roster.markMemberSettlementCommitted(room, 102, 10_000)
    roster.markMemberReturned(room, 102)
    assert.deepEqual(roster.getReservedReturnViewerIds(room), [103])
    assert.deepEqual(roster.getExpiredReturnViewerIds(room, 179_999), [])
    assert.deepEqual(roster.getExpiredReturnViewerIds(room, 180_000), [103])
    assert.deepEqual(roster.getFrozenRematchViewerIds(room), [101, 102, 103])
})

test('two-player late result starts its own return lease, replay cannot extend it', () => {
    const room = fixture([101, 102])
    roster.ensureRematchReturnReservations(room, 0)
    roster.markMemberSettlementCommitted(room, 102, 170_000)
    roster.markMemberSettlementCommitted(room, 102, 200_000)
    assert.deepEqual(roster.getExpiredReturnViewerIds(room, 229_999), [])
    assert.deepEqual(roster.getExpiredReturnViewerIds(room, 230_000), [102])
    roster.markMemberReturned(room, 102)
    roster.markMemberSettlementCommitted(room, 102, 240_000)
    assert.deepEqual(roster.getReservedReturnViewerIds(room), [])
})

test('first actual return opening grants early committed peers a full lease once', () => {
    const room = fixture()
    room.lifecycle.phase = 'BATTLE'
    roster.markMemberSettlementCommitted(room, 102, 0)
    roster.ensureRematchReturnReservations(room, 80_000)
    room.lifecycle.phase = 'RETURNING'
    roster.markRematchReturnWindowOpened(room, 90_000)
    room.lifecycle.phase = 'LOBBY'
    roster.ensureRematchReturnReservations(room, 100_000)
    roster.markRematchReturnWindowOpened(room, 120_000)
    roster.markMemberSettlementCommitted(room, 103, 140_000)
    assert.deepEqual(roster.getExpiredReturnViewerIds(room, 149_999), [])
    assert.deepEqual(roster.getExpiredReturnViewerIds(room, 150_000), [102])
    assert.deepEqual(roster.getExpiredReturnViewerIds(room, 200_000), [102, 103])
})

test('successful lobby return marks the captured old run, not the current run', t => {
    const { room, peers } = lobbyFixture(t, 1)
    const contract = load('multi/state/battle-contract')
    roster.clearRematchReturnReservations(room)
    room.lifecycle.battleSessionId = 'original-run'
    const original = contract.ensureBattleSessionContract(room)
    roster.markMemberSettlementCommitted(room, peers[0], 0)
    room.lifecycle.battleSessionId = null
    roster.markMemberReturned(room, peers[0])
    assert.equal(original.members.get(peers[0]).phase, 'RETURNED')
    room.lifecycle.battleSessionId = 'new-run'
    const newer = contract.ensureBattleSessionContract(room)
    roster.markMemberReturned(room, peers[0])
    assert.equal(newer.members.get(peers[0]).phase, 'LOADING')
    assert.equal(original.members.get(peers[0]).phase, 'RETURNED')
})

test('transport loss owns one member deadline without renewing other missing members', () => {
    const room = fixture()
    roster.ensureRematchReturnReservations(room, 0)
    roster.markMemberReturned(room, 102)
    roster.markMemberReturnDisconnected(room, 102, 100_000)
    roster.markMemberReturnDisconnected(room, 102, 150_000)
    assert.deepEqual(roster.getExpiredReturnViewerIds(room, 160_000), [102])
    assert.deepEqual(roster.getExpiredReturnViewerIds(room, 179_999), [102])
    assert.deepEqual(roster.getExpiredReturnViewerIds(room, 180_000), [102, 103])
})

test('host never owns a removable return reservation; frozen evidence survives release', () => {
    const room = fixture()
    roster.ensureRematchReturnReservations(room, 0)
    roster.forgetReturnReservation(room, 102)
    assert.deepEqual(roster.getExpiredReturnViewerIds(room, 500_000), [103])
    assert.deepEqual(roster.getFrozenRematchViewerIds(room), [101, 102, 103])
    roster.ensureRematchReturnReservations(room, 500_000)
    assert.equal(roster.markMemberSettlementCommitted(room, 102, 500_000), false)
})

test('room instance and generation fence personal commit and reservations', () => {
    const room = fixture([101, 102])
    roster.ensureRematchReturnReservations(room, 0)
    room.lobby_generation = 2
    assert.equal(roster.markMemberSettlementCommitted(room, 102, 10, 1), false)
    assert.deepEqual(roster.getReservedReturnViewerIds(room), [])
    roster.ensureRematchReturnReservations(room, 10)
    room.lifecycle.instanceId = 'replacement'
    assert.deepEqual(roster.getReservedReturnViewerIds(room), [])
    const reused = fixture([101, 104])
    roster.ensureRematchReturnReservations(reused, 20)
    assert.deepEqual(roster.getReservedReturnViewerIds(reused), [104])
})

class Socket extends EventEmitter {
    destroyed = false; readable = true; writable = true; frames = []
    write(frame) { this.frames.push(JSON.parse(frame.replace(/\0$/, ''))); return true }
    destroy() { this.destroyed = true; this.readable = this.writable = false }
    end() { this.destroy() }
}
function lobbyFixture(t, peerCount = 2) {
    const room = rooms.createRoom(80101, 1, 1, 2, 1033004, 1, 1, true)
    room.lobby_generation = 1
    const peers = Array.from({ length: peerCount }, (_, i) => 80102 + i)
    room.expected_real_viewer_ids = [room.host_viewer_id, ...peers]
    room.member_viewer_ids = [...room.expected_real_viewer_ids]
    for (const viewer of peers) room.member_player_ids[viewer] = viewer
    const host = sessionManager.createClient(new Socket(), room.host_viewer_id, room.room_number, 'rematch-host', 1)
    host.roomGeneration = 1; host.enterData = []
    host.yourself = { viewerId: host.viewerId, playerId: 1, connectionId: host.connectionId, state: [0], party: [] }
    host.mates = [host.yourself]
    sessionManager.addClientToRoom(host)
    t.after(() => rooms.disbandRoom(room.room_number, 'rematch_test_cleanup'))
    return { room, host, peers }
}

test('legacy Notify10 preserves slow three-player results and cannot fill their seats', async t => {
    const { room, host, peers } = lobbyFixture(t)
    lobby.handleMessage(host.socket, [0, [10, [{ name: 'COM1' }, { name: 'COM2' }]]])
    await coordinator.enqueueRoomCommand(room.room_number, () => {})
    assert.deepEqual(room.member_viewer_ids, [host.viewerId, ...peers])
    assert.deepEqual(room.expected_real_viewer_ids, [host.viewerId, ...peers])
    assert.equal(host.mates.filter(mate => mate.comId).length, 0)
    assert.ok(peers.every(viewer => rooms.isRoomMember(room, viewer)))
    assert.equal(lobby.getLobbyRoomStateForTests(room.room_number).rematchTimer, true)
})

test('expiry logs actual guest removal while preserving host and frozen participants', async t => {
    const { room, host, peers } = lobbyFixture(t, 1)
    const timers = []
    t.mock.method(global, 'setTimeout', (fn, ms) => { const timer = { fn, ms, unref() {} }; timers.push(timer); return timer })
    t.mock.method(global, 'clearTimeout', () => {})
    const warnings = []
    t.mock.method(console, 'warn', value => warnings.push(value))
    roster.markMemberSettlementCommitted(room, peers[0], performance.now() - 60_001)
    lobby.scheduleRematchDisconnectCleanup(room.room_number)
    const timer = timers.find(timer => timer.ms === 0)
    assert.ok(timer, 'expired personal lease schedules cleanup immediately')
    timer.fn()
    await coordinator.enqueueRoomCommand(room.room_number, () => {})
    assert.deepEqual(room.member_viewer_ids, [host.viewerId])
    assert.deepEqual(room.expected_real_viewer_ids, [host.viewerId])
    assert.deepEqual(roster.getFrozenRematchViewerIds(room), [host.viewerId, ...peers])
    assert.equal(rooms.removeRoomMember(room.room_number, host.viewerId), false)
    assert.equal(rooms.isRoomMember(room, peers[0]), false)
    assert.equal(warnings.filter(value => value.includes(`removed=${peers[0]}`)).length, 1)
    assert.equal(warnings.some(value => value.includes(`removed=${host.viewerId}`)), false)
})

test('old room-number timer cannot remove a member of the replacement instance', async t => {
    const { room, peers } = lobbyFixture(t, 1)
    const timers = []
    t.mock.method(global, 'setTimeout', (fn, ms) => { const timer = { fn, ms, unref() {} }; timers.push(timer); return timer })
    t.mock.method(global, 'clearTimeout', () => {})
    roster.markMemberSettlementCommitted(room, peers[0], performance.now() - 60_001)
    lobby.scheduleRematchDisconnectCleanup(room.room_number)
    const stale = timers.find(timer => timer.ms === 0)
    rooms.disbandRoom(room.room_number, 'replace_instance')
    t.mock.method(require('node:crypto'), 'randomInt', () => Number(room.room_number))
    const replacement = rooms.createRoom(80201, 3, 1, 2, 1033004, 1, 1)
    replacement.lobby_generation = 1
    rooms.addRoomMember(replacement.room_number, 80202, 4)
    replacement.expected_real_viewer_ids = [80201, 80202]
    stale.fn()
    await coordinator.enqueueRoomCommand(room.room_number, () => {})
    assert.deepEqual(replacement.member_viewer_ids, [80201, 80202])
    assert.notEqual(replacement.lifecycle.instanceId, room.lifecycle.instanceId)
})

test('old generation callback cannot release the next round of the same room', async t => {
    const { room, peers } = lobbyFixture(t, 1)
    const timers = []
    t.mock.method(global, 'setTimeout', (fn, ms) => { const timer = { fn, ms, unref() {} }; timers.push(timer); return timer })
    t.mock.method(global, 'clearTimeout', () => {})
    roster.markMemberSettlementCommitted(room, peers[0], performance.now() - 60_001)
    lobby.scheduleRematchDisconnectCleanup(room.room_number)
    const stale = timers.find(timer => timer.ms === 0)
    room.lobby_generation = 2
    stale.fn()
    await coordinator.enqueueRoomCommand(room.room_number, () => {})
    assert.equal(room.member_viewer_ids.includes(peers[0]), true)
    assert.equal(room.expected_real_viewer_ids.includes(peers[0]), true)
})

test('member release rejects battle and stale-generation callers; display/socket are not membership', t => {
    const { room, peers } = lobbyFixture(t, 1)
    room.lifecycle.phase = 'BATTLE'
    assert.equal(rooms.removeRoomMember(room.room_number, peers[0]), false)
    room.lifecycle.phase = 'LOBBY'
    assert.equal(rooms.removeRoomMember(room.room_number, peers[0], 0), false)
    room.mates.push({ viewer_id: 89999, com_id: 0 })
    assert.equal(rooms.isRoomMember(room, 89999), false)
})

test('actual SessionManager replacement/removal clear only the owned early host Enter', async t => {
    const { room, host } = lobbyFixture(t, 1)
    t.mock.method(load('multi/coordinator/business-facts'), 'notifyRealtimePresence', () => {})
    const contract = load('multi/state/battle-contract')
    room.quest_id = 1099001
    room.lifecycle.phase = 'BATTLE'
    room.lifecycle.battleSessionId = 'early-return-session-hooks'
    room.five_boss_runtime = { runId: 'early-return-hook-run' }
    host.enterData = null
    contract.ensureBattleSessionContract(room)
    assert.equal(contract.bindBattlePlay(room, host.viewerId, host.playerId, 'early-return-hook-play'), true)
    contract.markBattleMemberPhase(room, host.viewerId, 'SETTLED')
    await lobby.handleMessage(host.socket, [0, [0, { party: {}, autoStart: false }, 1]])
    assert.equal(host.socket.listenerCount('end'), 1)
    assert.equal(host.socket.listenerCount('close'), 1)
    const pendingCloseListener = host.socket.listeners('close')[0]

    const replacement = sessionManager.createClient(new Socket(), host.viewerId, room.room_number,
        host.connectionId, host.playerId)
    replacement.roomGeneration = room.lobby_generation
    replacement.yourself = { ...host.yourself }
    sessionManager.addClientToRoom(replacement)
    assert.equal(host.socket.listenerCount('end'), 0)
    assert.equal(host.socket.listeners('close').includes(pendingCloseListener), false)
    await lobby.handleMessage(replacement.socket, [0, [0, { party: {}, autoStart: false }, 1]])
    assert.equal(replacement.socket.listenerCount('end'), 1)

    sessionManager.removeClient(host)
    assert.equal(sessionManager.getClient(host.viewerId, room.room_number), replacement)
    assert.equal(replacement.socket.listenerCount('end'), 1)
    sessionManager.removeClient(replacement)
    assert.equal(replacement.socket.listenerCount('end'), 0)
    assert.equal(replacement.socket.listenerCount('close'), 0)
})

test('actual terminal replay completes SessionManager return without retaining host-return grace', async t => {
    const { room, host, peers } = lobbyFixture(t, 1)
    t.mock.method(load('multi/coordinator/business-facts'), 'notifyRealtimePresence', () => {})
    room.quest_id = 1099001
    room.is_npc_mode = false
    room.npc_count = 0
    room.lifecycle.phase = 'BATTLE'
    room.lifecycle.battleSessionId = 'actual-host-return-run'
    room.five_boss_runtime = { runId: 'actual-host-return-five-run' }
    host.enterData = null
    const contract = load('multi/state/battle-contract')
    contract.ensureBattleSessionContract(room)
    contract.bindBattlePlay(room, host.viewerId, host.playerId, 'actual-host-return-play')
    const executor = new (load('multi/coordinator/command-executor').RoomCommandExecutor)()
    load('multi/coordinator/five-boss-command-handlers').registerFiveBossCommandHandlers(executor)
    const gateway = new (load('multi/coordinator/command-gateway').RoomCommandGateway)(executor)
    await gateway.execute('fiveBoss.terminal', { roomNumber: room.room_number,
        runId: room.five_boss_runtime.runId, runStatus: 'active', viewerId: host.viewerId,
        playerId: host.playerId, playId: 'actual-host-return-play' })
    await lobby.handleMessage(host.socket, [0, [0, { autoStart: false }, 1]])
    assert.equal(host.enterData, null)
    const terminal = { roomNumber: room.room_number, runId: room.five_boss_runtime.runId, runStatus: 'settled' }
    assert.equal((await gateway.execute('fiveBoss.terminal', terminal)).applied, true)
    assert.equal(room.lifecycle.phase, 'LOBBY')
    assert.equal(room.settlement_return_pending, false)
    assert.equal(sessionManager.settlementReturnTimers.has(room.room_number), false)
    assert.notEqual(host.enterData, null)
    assert.deepEqual(roster.getReservedReturnViewerIds(room), peers)
    assert.equal(host.socket.frames.filter(frame => frame[0] === 1 && frame[1]?.[0] === 0).length, 1)
    assert.equal((await gateway.execute('fiveBoss.terminal', terminal)).applied, false)
    assert.equal(host.socket.frames.filter(frame => frame[0] === 1 && frame[1]?.[0] === 0).length, 1)
    assert.equal(sessionManager.settlementReturnTimers.has(room.room_number), false)
})
