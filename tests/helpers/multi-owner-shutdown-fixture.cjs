'use strict'
// Synthetic shutdown fixture only: random loopback port, no production accounts or DB.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const net = require('node:net')
const { performance } = require('node:perf_hooks')
const out = process.env.STARPOINT_TEST_OUT_DIR || path.resolve(__dirname, '../../out')
const load = name => require(path.join(out, name))
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

async function register(executor, lifecycle) {
    const { invokeRealtimeBusiness } = load('multi/coordinator/business-rpc')
    let calls = 0, quiesced = false
    let pinned, lobbyState
    executor.register('shutdown.read', () => ({ calls, quiesced, pid: process.pid }))
    executor.register('shutdown.delay', async payload => {
        calls++
        if (payload.marker) fs.writeFileSync(payload.marker, 'accepted', { flag: 'wx' })
        await sleep(payload.delayMs)
        return { calls, pid: process.pid }
    })
    executor.register('shutdown.business', async payload => {
        calls++
        if (payload.marker) fs.writeFileSync(payload.marker, 'accepted', { flag: 'wx' })
        await sleep(payload.delayMs || 0)
        const result = await invokeRealtimeBusiness('shutdown.fixture.persist', { calls, value: payload.value })
        return { calls, result, pid: process.pid }
    })
    executor.register('shutdown.invalidBusiness', async payload => {
        const { runWithRealtimeBusinessAdmission, getRealtimeBusinessAdmission } = load('multi/coordinator/business-rpc')
        if (payload.marker) fs.writeFileSync(payload.marker, 'accepted', { flag: 'wx' })
        await sleep(payload.delayMs)
        const original = getRealtimeBusinessAdmission()
        const proof = payload.mode === 'none' ? undefined : payload.mode === 'token'
            ? { ...original, admissionToken: 'f'.repeat(64) } : { ...original, ownerEpoch: 'previous-owner' }
        try {
            await runWithRealtimeBusinessAdmission(proof, () => invokeRealtimeBusiness('shutdown.fixture.persist', { value: 99 }))
            return { rejected: false }
        } catch (error) { return { rejected: true, code: error.code || error.message } }
    })
    executor.register('shutdown.pin', payload => {
        const { EventEmitter } = require('node:events')
        const rooms = load('multi/room/manager'), manager = load('multi/state/SessionManager').sessionManager
        const coordinator = load('multi/coordinator/embedded').embeddedMultiCoordinator
        const pins = load('multi/coordinator/room-start-claims'), battle = load('multi/tcp/battle')
        const business = load('multi/coordinator/business-rpc')
        const room = rooms.createRoom(889900001, 0, 1, 1, 9001001, 0, 111001)
        assert.equal(coordinator.commitBattleStart(room).ok, true)
        let frames = 0
        const socket = Object.assign(new EventEmitter(), { writable: true, readable: true, destroyed: false,
            remoteAddress: '127.0.0.1', writableLength: 0, write() { frames++; return true },
            destroy() { if (!this.destroyed) { this.destroyed = true; this.emit('close') }; return this } })
        const client = manager.createClient(socket, 889900001, room.room_number, 'shutdown-pin-client', 0)
        client.isBattle = true; client.roomGeneration = room.lobby_generation
        manager.setBattleExpectedCount(room.room_number, 1, [{ viewerId: client.viewerId, connectionId: client.connectionId }])
        assert.equal(manager.addBattleClient(client.connectionId, client), true)
        const token = 'synthetic-pending-durable-start'
        pins.pinRoomStart(room, token)
        const work = business.runWithTcpBusinessAdmission(() => battle.handleBattleMessage(socket, [0, [2]]))
        void work.catch(() => {})
        pinned = { room, client, socket, token, pins, battle, manager, rooms, work, frames: () => frames }
        assert.equal(client.finalizeSent, false)
        fs.writeFileSync(payload.marker, 'control-pinned', { flag: 'wx' })
        return { pinned: true, roomNumber: room.room_number }
    })
    executor.register('shutdown.lobbyParty', payload => {
        const { EventEmitter } = require('node:events')
        const rooms = load('multi/room/manager'), manager = load('multi/state/SessionManager').sessionManager
        const lobby = load('multi/tcp/lobby'), business = load('multi/coordinator/business-rpc')
        const room = rooms.createRoom(889900002, 42, 1, 1, 9001001, 0, 111001)
        const frames = []
        const socket = Object.assign(new EventEmitter(), { writable: true, readable: true, destroyed: false,
            remoteAddress: '127.0.0.1', writableLength: 0,
            write(value) { for (const raw of String(value).split('\0').filter(Boolean)) frames.push(JSON.parse(raw)); return true },
            destroy() { if (!this.destroyed) { this.destroyed = true; this.emit('close') }; return this } })
        const client = manager.createClient(socket, 889900002, room.room_number, 'shutdown-lobby-client', 42)
        client.enterData = {}; client.yourself = { viewerId: client.viewerId, currentPartyId: 1,
            party: { characterIds: [111001, null, null] }, state: [0], autoStart: false }
        client.mates = [client.yourself]
        assert.equal(manager.addClientToRoom(client).ok, true)
        assert.equal(load('multi/coordinator/business-facts').applyPlayerBusinessFacts({
            parentEpoch: 'shutdown-fixture-parent', revision: 1, playerId: 42, viewerId: client.viewerId,
            expiresAt: Date.now() + 120000, category: 1, questId: 9001001, partyId: 1,
            player: { name: 'fixture', rank: 1, degreeId: 0, leaderCharacterId: 111001, role: 0, tutorialStep: 1, partySlot: 1 },
            party: client.yourself.party, ownedCharacterIds: [111001], restrictedEquipment: false,
            guestEligibility: { allowed: true }, questNpcPartySnapshot: null,
            questPolicy: { isMode15: false, equipmentAllowed: true, hostAllowed: true, exclusiveItemIds: [] },
        }), true)
        const work = business.runWithTcpBusinessAdmission(() => lobby.handleMessage(socket,
            [0, [2, { ...client.yourself, currentPartyId: 2 }, false, 2]]))
        void work.catch(() => {})
        lobbyState = { rooms, manager, room, client, socket, lobby, business, work, frames }
        fs.writeFileSync(payload.marker, 'party-frame-accepted', { flag: 'wx' })
        return { accepted: true }
    })
    executor.register('shutdown.lobbyHeartbeat', async () => {
        const state = lobbyState
        assert.ok(state)
        await state.business.runWithTcpBusinessAdmission(() => state.lobby.handleMessage(state.socket, [0, [4]]))
        return { heartbeatAcks: state.frames.filter(frame => frame[0] === 1 && frame[1]?.[0] === 11).length,
            partySlot: state.client.yourself.currentPartyId }
    })
    const sockets = new Set()
    const listener = net.createServer(socket => {
        sockets.add(socket); socket.once('close', () => sockets.delete(socket)); socket.on('error', () => {})
        socket.end('fixture\n')
    })
    await new Promise((resolve, reject) => { listener.once('error', reject); listener.listen(0, '127.0.0.1', resolve) })
    const port = listener.address().port
    const quiesce = () => {
        quiesced = true
        pinned?.battle.discardPinnedBattleControlsForShutdown()
        for (const socket of sockets) socket.destroy()
        return new Promise(resolve => listener.listening ? listener.close(resolve) : resolve())
    }
    // New lifecycle supplies an explicit ingress cutoff; the fixture never grants cleanup admission.
    if (lifecycle.onQuiesce) lifecycle.onQuiesce(quiesce)
    if (lifecycle.onDrain) lifecycle.onDrain(async () => {
        if (lobbyState) await lobbyState.work
        if (!pinned) return
        await pinned.work
        // Replay happens after the held TCP grant was released. A discarded
        // callback must remain inert even when the old durable claim resolves.
        pinned.pins.unpinRoomStart(pinned.room, pinned.token)
        assert.equal(pinned.client.finalizeSent, false, 'late unpin must not apply discarded Finalize')
        assert.equal(pinned.frames(), 0, 'late unpin must not send a battle ACK')
    })
    lifecycle.onShutdown(() => {
        if (lobbyState) {
            lobbyState.socket.destroy(); lobbyState.manager.removeClient(lobbyState.client)
            lobbyState.rooms.disbandRoom(lobbyState.room.room_number)
        }
        if (!pinned) return
        pinned.pins.unpinRoomStart(pinned.room, pinned.token)
        pinned.socket.destroy(); pinned.manager.removeBattleClient(pinned.client.connectionId)
        pinned.rooms.disbandRoom(pinned.room.room_number)
    })
    lifecycle.onShutdown(quiesce)
    return { port, ownerPid: process.pid }
}

async function runtimeSticky(legacy = false) {
    process.env.MULTI_REALTIME_PROCESS = '1'
    process.env.MULTI_BATTLE_RELAY_PROCESS = '0'
    process.env.SESSION_HOST = '127.0.0.1'; process.env.SESSION_PORT = '0'
    process.env.CN_WRITER_THREAD = '0'; process.env.PROCESS_MEMORY_DIAGNOSTICS = 'false'
    process.env.CLIENT_ADMISSION_CONFIG = path.join(process.env.DATA_DIR, 'admission.json')
    process.env.CLIENT_ADMISSION_KEYS = path.join(process.env.DATA_DIR, 'keys.json')
    fs.writeFileSync(process.env.CLIENT_ADMISSION_CONFIG, JSON.stringify({ enforce: false, builds: [] }))
    fs.writeFileSync(process.env.CLIENT_ADMISSION_KEYS, '{}')
    const runtime = load('multi/coordinator/default-runtime')
    const { DurableOwnerEventPublisher } = load('multi/coordinator/durable-owner-event')
    const { RoomCommandError } = load('multi/coordinator/command-protocol')
    let first = true, seals = 0, publisher
    try {
        await runtime.startRealtimeSessionServer()
        const original = runtime.realtimeOwnerStatus()
        publisher = new DurableOwnerEventPublisher(() => ({
            async execute(kind, payload, options) {
                const value = await runtime.getRoomCommandGateway().execute(kind, payload, options)
                if (first) { first = false; throw new RoomCommandError('OUTCOME_UNKNOWN', 'Fixture loses caller ACK after application', options.commandId, true) }
                return value
            },
            queryResult: id => runtime.getRoomCommandGateway().queryResult(id),
        }), async () => { seals++ }, 10, 180)
        if (legacy) {
            // Explicit historical repro only; the new shutdown contract uses real admission below.
            await publisher.publish('room.query', { roomNumber: 'synthetic-shutdown-room' })
        } else {
            const { withServerWorkAdmission } = load('lib/shutdown-state')
            await withServerWorkAdmission(() => publisher.publish('room.query', { roomNumber: 'synthetic-shutdown-room' }))
        }
        assert.equal(publisher.inspect().pending, 1, 'lost caller ACK retains original notification')
        await runtime.stopRealtimeSessionServer()
        await sleep(300)
        const stopped = runtime.realtimeOwnerStatus()
        const report = { original, stopped, publisher: publisher.inspect(), seals }
        assert.equal(stopped.ready, false, JSON.stringify(report))
        assert.ok(stopped.pid === original.pid || stopped.pid === process.pid, 'retry must not create another child PID')
        await assert.rejects(() => runtime.getRoomCommandGateway().execute('room.query', { roomNumber: 'synthetic-shutdown-room' }), /closed|stopped|unavailable|quiesc|sealed/i)
        assert.equal(runtime.realtimeOwnerStatus().ready, false)
        await runtime.startRealtimeSessionServer()
        const restarted = runtime.realtimeOwnerStatus()
        assert.equal(restarted.ready, true, 'explicit lifecycle restart remains supported outside global close')
        assert.notEqual(restarted.ownerEpoch, original.ownerEpoch)
        return { ...report, restarted }
    } finally {
        await runtime.stopRealtimeSessionServer()
        // The bounded custom publisher may still have a timer; never leave a test owner alive.
        await sleep(220)
    }
}

async function runtimeGlobalClosing() {
    process.env.MULTI_REALTIME_PROCESS = '1'; process.env.MULTI_BATTLE_RELAY_PROCESS = '0'
    process.env.SESSION_HOST = '127.0.0.1'; process.env.SESSION_PORT = '0'
    process.env.CN_WRITER_THREAD = '0'; process.env.PROCESS_MEMORY_DIAGNOSTICS = 'false'
    const runtime = load('multi/coordinator/default-runtime')
    const state = load('lib/shutdown-state')
    try {
        await runtime.startRealtimeSessionServer()
        const original = runtime.realtimeOwnerStatus()
        state.beginServerShutdown()
        await runtime.quiesceRealtimeSessionServer()
        await runtime.drainRealtimeWork()
        await runtime.stopRealtimeSessionServer()
        const rejectedClosing = error => /CLOSING|closed|stopped|sealed/i.test(`${error.code || ''} ${error.message || ''}`)
        await assert.rejects(() => runtime.startRealtimeSessionServer(), rejectedClosing)
        await assert.rejects(() => runtime.getRoomCommandGateway().execute('room.query', { roomNumber: 'synthetic-shutdown-room' }), rejectedClosing)
        assert.equal(runtime.realtimeOwnerStatus().ready, false)
        return { original, stopped: runtime.realtimeOwnerStatus(), fixturePid: process.pid }
    } finally { await runtime.stopRealtimeSessionServer() }
}

module.exports = { register }
if (require.main === module && ['--runtime-sticky', '--runtime-sticky-legacy', '--runtime-global-closing'].includes(process.argv[2])) {
    const run = process.argv[2] === '--runtime-global-closing' ? runtimeGlobalClosing() : runtimeSticky(process.argv[2] === '--runtime-sticky-legacy')
    run.then(report => { process.send?.({ ok: true, report }); process.disconnect?.() }, error => {
        process.send?.({ ok: false, error: error.stack || String(error) }); process.disconnect?.(); process.exitCode = 1
    })
}
