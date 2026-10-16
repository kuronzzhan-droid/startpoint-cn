// Bounded lounge/lobby/room bookkeeping and TCP send paths.
process.env.MULTI_SEND_QUEUE_MAX_MESSAGES = '4'
process.env.LOUNGE_DISBAND_SOCKET_GRACE_MS = '0'
process.env.SESSION_HOST = '127.0.0.1'
process.env.SESSION_PORT = '0'

const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')

const originalInterval = global.setInterval
global.setInterval = (...args) => { const timer = originalInterval(...args); timer.unref(); return timer }
const lounge = require('../out/lounge/state')
const { handleLoungeMessage } = require('../out/lounge/tcp')
const rooms = require('../out/multi/room/manager')
const lobby = require('../out/multi/tcp/lobby')
const { disbandIdleHostedLobbyRooms } = require('../out/multi/http/lobby')
const { sessionManager } = require('../out/multi/state/SessionManager')
const { embeddedMultiCoordinator } = require('../out/multi/coordinator/embedded')
const persistence = require('../out/lib/persistence-coordinator')
const { fiveBossDiagnostics } = require('../out/lib/coalesced-diagnostics')
const fiveBossRuntime = require('../out/multi/five-boss/lobby-runtime')
const tcpServer = require('../out/multi/tcp/server')
global.setInterval = originalInterval

class FakeSocket extends EventEmitter {
    constructor({ writableResult = true } = {}) {
        super()
        this.destroyed = false
        this.writable = true
        this.readable = true
        this.writableResult = writableResult
        this.frames = []
        this.remoteAddress = '127.0.0.1'
    }
    write(frame) {
        this.frames.push(JSON.parse(String(frame).replace(/\0$/, '')))
        return this.writableResult
    }
    destroy() {
        if (this.destroyed) return
        this.destroyed = true
        this.writable = false
        this.emit('close', false)
    }
    end() { this.writable = false }
}

function hostProfile() {
    return { name: 'host', characterId: 1, characterEvolutionLevel: 0 }
}

function makeLounge(hostViewerId, useCase = 1) {
    const room = lounge.createLounge({
        advice: `advice-${hostViewerId}-${useCase}`,
        useCase,
        campaignId: 1,
        hostViewerId,
        hostPlayerId: hostViewerId + 1000,
        hostProfile: hostProfile(),
    })
    lounge.prepareLounge(room)
    return room
}

function joinLounge(room, viewerId, socket = new FakeSocket()) {
    lounge.attachLoungeSocket(room, viewerId, socket)
    assert.ok(lounge.enterLounge(socket, { name: `member-${viewerId}` }))
    return socket
}

const tick = () => new Promise(resolve => setImmediate(resolve))

test('lounge ready state accepts the client enum shape and ignores oversized states', () => {
    lounge.resetLoungesForTests()
    const room = makeLounge(1001)
    const host = joinLounge(room, 1001)
    const guest = joinLounge(room, 1002)
    host.frames.length = 0
    guest.frames.length = 0

    handleLoungeMessage(guest, [0, [3, [1]]])
    assert.deepEqual(host.frames.at(-1), [1, [0, 1002, [1]]])
    assert.deepEqual(room.members.get(1002).readyState, [1])

    const before = host.frames.length
    handleLoungeMessage(guest, [0, [3, ['x'.repeat(lounge.LOUNGE_MAX_READY_STATE_BYTES)]]])
    handleLoungeMessage(guest, [0, [3, new Array(lounge.LOUNGE_MAX_READY_STATE_ITEMS + 1).fill(0)]])
    assert.equal(host.frames.length, before, 'oversized ready state is not rebroadcast')
    assert.deepEqual(room.members.get(1002).readyState, [1], 'oversized ready state is not stored')
    lounge.resetLoungesForTests()
})

test('lounge sends use the bounded send queue and drop a peer that stops reading', () => {
    lounge.resetLoungesForTests()
    const room = makeLounge(2001)
    const stalled = joinLounge(room, 2001, new FakeSocket({ writableResult: false }))
    const reader = joinLounge(room, 2002)
    for (let index = 0; index < 10; index++) handleLoungeMessage(reader, [0, [3, [index % 2]]])
    assert.equal(stalled.destroyed, true, 'stalled consumer is disconnected at the queue limit')
    assert.equal(reader.destroyed, false)
    assert.equal(lounge.sendLoungeFrame(stalled, [1, [7, 2001]]), false)
    lounge.resetLoungesForTests()
})

test('a host keeps one lounge: creating another disbands and notifies the previous one', async () => {
    lounge.resetLoungesForTests()
    const first = makeLounge(3001, 1)
    const hostSocket = joinLounge(first, 3001)
    const guestSocket = joinLounge(first, 3002)
    const other = makeLounge(3999, 1)

    const second = makeLounge(3001, 2)
    assert.equal(lounge.getLounge(first.id), undefined)
    assert.ok(lounge.getLounge(second.id))
    assert.ok(lounge.getLounge(other.id), 'other hosts are untouched')
    assert.equal(lounge.getLoungeCountForTests(), 2)
    assert.deepEqual(guestSocket.frames.at(-1), [1, [1, 'multibattle_room_dismissed']])
    assert.equal(hostSocket.frames.some(frame => frame[1]?.[0] === 1), false,
        'the host own old socket is retired without a dismissal frame')
    assert.equal(lounge.getLoungeSocketContext(guestSocket), null)

    await new Promise(resolve => setTimeout(resolve, 5))
    assert.equal(guestSocket.destroyed, true, 'dismissed member socket is retired after the grace period')
    assert.equal(hostSocket.destroyed, true)
    lounge.resetLoungesForTests()
})

test('session server keeps a permanent error listener after listen', async () => {
    await tcpServer.startSessionServer()
    try {
        const server = tcpServer.getSessionServer()
        assert.ok(server)
        assert.ok(server.listenerCount('error') >= 1)
        const error = Object.assign(new Error('simulated accept failure'), { code: 'EMFILE' })
        assert.doesNotThrow(() => server.emit('error', error))
        assert.ok(tcpServer.getSessionServer(), 'server stays published after a runtime error')
    } finally {
        await tcpServer.stopSessionServer()
    }
})

test('room removal clears lobby bookkeeping for a reused room number', () => {
    const roomNumber = '880001'
    lobby.seedLobbyRoomStateForTests(roomNumber, 3)
    let state = lobby.getLobbyRoomStateForTests(roomNumber)
    assert.equal(state.rematchCleanedGeneration, 3)
    assert.equal(state.npcReconcilePending, true)
    assert.equal(state.npcReconcileTimer, true)
    sessionManager.removeRoomState(roomNumber)
    state = lobby.getLobbyRoomStateForTests(roomNumber)
    assert.deepEqual(state, {
        rematchTimer: false,
        rematchCleanedGeneration: undefined,
        npcReconcileTimer: false,
        npcReconcilePending: false,
    })
})

test('lobby Send reaches only the current entered connection in the same room', async () => {
    const roomNumber = '880002'
    const make = (viewerId, room = roomNumber) => {
        const client = sessionManager.createClient(new FakeSocket(), viewerId, room, `cid-${viewerId}-${room}`, viewerId)
        client.enterData = {}
        sessionManager.addClientToRoom(client)
        return client
    }
    const sender = make(11)
    const target = make(12)
    const elsewhere = make(13, '880003')
    const flush = () => embeddedMultiCoordinator.enqueueRoomCommand(roomNumber, () => {})

    lobby.handleMessage(sender.socket, [2, 12, ['payload']])
    await flush()
    assert.deepEqual(target.socket.frames.at(-1), [2, 12, ['payload']])

    lobby.handleMessage(sender.socket, [2, 13, ['payload']])
    await flush()
    assert.equal(elsewhere.socket.frames.length, 0, 'a viewer in another room is not a target')

    const replacement = make(12)
    lobby.handleMessage(sender.socket, [2, 12, ['second']])
    await flush()
    assert.deepEqual(replacement.socket.frames.at(-1), [2, 12, ['second']])
    assert.equal(target.socket.frames.filter(frame => frame[2]?.[0] === 'second').length, 0,
        'a superseded connection is not a target')

    for (const client of [sender, replacement, elsewhere]) sessionManager.removeClient(client)
})

test('five-boss level transition signals are written once per member and failures stay contained', async t => {
    const runtime = {
        runId: 'hardening-run', expectedRealPlayerIds: [21], battleEnteredPlayerIds: [],
        autoplayModeByPlayerId: {}, partyCharacterIdsByPlayerId: {},
        battleIdentityByViewerId: { 21: { playerId: 21, remoteAddress: '127.0.0.1', connectionId: 'cid-21' } },
    }
    const room = { room_number: '880004', five_boss_runtime: runtime }
    const client = sessionManager.createClient(new FakeSocket(), 21, room.room_number, 'cid-21', 21)
    client.isBattle = true

    let writes = 0
    let failNext = false
    t.mock.method(persistence, 'runPersistenceTransaction', async () => {
        writes++
        if (failNext) {
            failNext = false
            throw Object.assign(new Error('simulated write failure'), { code: 'simulated' })
        }
    })
    const unhandled = []
    const onUnhandled = reason => unhandled.push(reason)
    process.on('unhandledRejection', onUnhandled)
    try {
        for (let index = 0; index < 20; index++) {
            assert.equal(fiveBossRuntime.recordFiveBossSignal(room, client, 'level_next'), true)
        }
        await fiveBossRuntime.waitForFiveBossSignalPersistence(runtime.runId, 21)
        assert.equal(writes, 1, 'repeated level_next frames share one write')

        // A failed write that also fails to report must not reject the chain,
        // and the signal can be retried afterwards.
        failNext = true
        const report = t.mock.method(fiveBossDiagnostics, 'report', () => { throw new Error('report failed') })
        assert.equal(fiveBossRuntime.recordFiveBossSignal(room, client, 'finalize'), true)
        assert.equal(fiveBossRuntime.recordFiveBossSignal(room, client, 'finalize'), true)
        await fiveBossRuntime.waitForFiveBossSignalPersistence(runtime.runId, 21)
        assert.equal(writes, 2)
        report.mock.restore()
        assert.equal(fiveBossRuntime.recordFiveBossSignal(room, client, 'finalize'), true)
        await fiveBossRuntime.waitForFiveBossSignalPersistence(runtime.runId, 21)
        assert.equal(writes, 3, 'a failed signal may be retried')
        assert.equal(fiveBossRuntime.recordFiveBossSignal(room, client, 'finalize'), true)
        await fiveBossRuntime.waitForFiveBossSignalPersistence(runtime.runId, 21)
        assert.equal(writes, 3)
        await tick()
        await tick()
        assert.deepEqual(unhandled, [])
    } finally {
        process.off('unhandledRejection', onUnhandled)
    }
})

test('creating a room replaces only the host lobby rooms that have no connection', async () => {
    const idle = rooms.createRoom(41, 41, 1, 1, 1, 0, 1)
    const connected = rooms.createRoom(41, 41, 1, 1, 1, 0, 1)
    const otherHost = rooms.createRoom(42, 42, 1, 1, 1, 0, 1)
    assert.equal(rooms.getRoomByToken(idle.access_token), idle)

    const client = sessionManager.createClient(new FakeSocket(), 41, connected.room_number, 'cid-41', 41)
    sessionManager.addClientToRoom(client)

    assert.equal(await disbandIdleHostedLobbyRooms(41), 1)
    assert.equal(rooms.getRoom(idle.room_number), undefined)
    assert.equal(rooms.getRoomByToken(idle.access_token), undefined, 'token index is cleared with the room')
    assert.equal(rooms.getRoom(connected.room_number), connected)
    assert.equal(rooms.getRoomByToken(connected.access_token), connected)
    assert.equal(rooms.getRoom(otherHost.room_number), otherHost)
    assert.equal(rooms.getRoomByToken(''), undefined)

    for (const roomNumber of [connected.room_number, otherHost.room_number]) {
        sessionManager.commitRoomDisband(roomNumber, 'test_cleanup')
    }
})

test('a StartBattle roster seat can open its battle socket after its lobby socket dropped', async t => {
    const { handleHandshake } = require('../out/multi/tcp/handshake')
    const roomNumber = '880005'
    const room = { room_number: roomNumber, lobby_generation: 1, category: 1, quest_id: 1,
        lifecycle: { instanceId: 'i', battleSessionId: 'b', phase: 'BATTLE' } }
    t.mock.method(rooms, 'getRoom', number => number === roomNumber ? room : undefined)
    const lobbyClient = sessionManager.createClient(new FakeSocket(), 51, roomNumber, 'lobby-cid-51', 510)
    lobbyClient.roomGeneration = 0
    sessionManager.addClientToRoom(lobbyClient)
    sessionManager.setBattleExpectedCount(roomNumber, 1, [{ viewerId: 51, connectionId: 'lobby-cid-51' }])
    lobbyClient.socket.destroy()
    sessionManager.removeClient(lobbyClient)
    assert.equal(sessionManager.getRoomClientByConnectionId(roomNumber, 'lobby-cid-51'), undefined)

    const socket = new FakeSocket()
    await handleHandshake(socket, { socklet: 'cooperation_battle', room_number: roomNumber, connection_id: 'lobby-cid-51' })
    assert.deepEqual(socket.frames, [[0, roomNumber, '']])
    const battle = sessionManager.getBattleClient('lobby-cid-51')
    assert.equal(battle.viewerId, 51)
    assert.equal(battle.playerId, 510)
    assert.equal(battle.roomGeneration, 0)

    const stranger = new FakeSocket()
    await handleHandshake(stranger, { socklet: 'cooperation_battle', room_number: roomNumber, connection_id: 'not-on-roster' })
    assert.deepEqual(stranger.frames, [[3, 'HANDSHAKE_DENIED']])

    sessionManager.clearBattleExpectedCount(roomNumber)
    assert.equal(sessionManager.resolveBattleHandshakeIdentity(roomNumber, 'lobby-cid-51')?.viewerId, 51,
        'the live battle connection still resolves itself')
    sessionManager.removeBattleClient('lobby-cid-51')
    assert.equal(sessionManager.resolveBattleHandshakeIdentity(roomNumber, 'lobby-cid-51'), null,
        'the roster is cleared with the expected count')
    sessionManager.removeRoomState(roomNumber)
})
