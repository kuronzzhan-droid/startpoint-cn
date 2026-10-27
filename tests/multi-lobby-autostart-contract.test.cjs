const test = require('node:test')
const { after } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const Module = require('node:module')
const { EventEmitter } = require('node:events')

const build = process.env.LENS_BUILD_OUT || path.resolve(__dirname, '../out')
const compiled = name => path.resolve(build, name)
const previousRole = [process.env.MULTI_REALTIME_PROCESS, process.env.MULTI_REALTIME_OWNER_CHILD]
process.env.MULTI_REALTIME_PROCESS = '0'
process.env.MULTI_REALTIME_OWNER_CHILD = '0'

// Keep room queues, connection identity, readiness, equipment enforcement and
// rematch reservations real. Replace only ordinary-quest data readers; fail
// closed if a new production dependency tries to open a database.
const frozenRivens = new Map()
const stubs = new Map([
    [compiled('lib/assets.js'), { getQuestFromCategorySync: () => undefined }],
    [compiled('lib/online-presence.js'), { markPlayerOnlineFromTcp() {} }],
    [compiled('multi/coordinator/business-handlers.js'), {
        handleRealtimeBusiness: async (kind, input) => {
            if (kind === 'presence.touch') return null
            // This test isolates readiness and lifecycle. Authority/ACK use a
            // real DB and sockets in weapon-riven-p2-{tcp,owner,snapshot-db}.
            if (kind === 'riven.freeze') {
                const snapshot = { identity: input.identity, snapshotId: input.identity.preparationId,
                    members: input.members.map(member => member.mate), mode: 0, reason: '',
                    canonical: 'autostart-fixture', ackConnectionIds: [], conversionLoadouts: [] }
                frozenRivens.set(input.identity.preparationId, snapshot)
                return snapshot
            }
            if (kind === 'riven.validate') return { ok: true }
            if (kind === 'riven.commit') return frozenRivens.get(input.identity.preparationId)
            if (kind === 'riven.cancel' || kind === 'riven.release') return frozenRivens.delete(input.identity.preparationId)
            throw new Error(`unexpected database business operation: ${kind}`)
        },
    }],
    [compiled('data/domains/player.js'), { getPlayerSync: () => ({ partySlot: 1 }) }],
    [compiled('lib/weapon-riven/battle.js'), { getSoloWeaponRivenStartLoadoutSync: () => ({ partyId: 1, abilitySoulIds: [null, null, null], equipmentIds: [null, null, null] }) }],
    [compiled('multi/npc/quest-party-snapshot.js'), { captureQuestNpcPartySnapshot: () => null }],
    [compiled('lib/mode15-optional.js'), {
        isMode15Quest: () => false,
        isMode15EquipmentAllowedQuest: () => false,
        getMode15ExclusiveItemIds: () => [],
        getMode15ExclusiveGlobalPartyItemsSync: () => [],
    }],
])
const originalLoad = Module._load
Module._load = function (request, parent, isMain) {
    const resolved = Module._resolveFilename(request, parent)
    if (resolved === compiled('data/db.js')) throw new Error('lobby contract fixture must not open a database')
    if (stubs.has(resolved)) return stubs.get(resolved)
    return originalLoad.call(this, request, parent, isMain)
}
const intervals = []
const originalInterval = global.setInterval
global.setInterval = (...args) => {
    const timer = originalInterval(...args)
    timer.unref()
    intervals.push(timer)
    return timer
}
let rooms, manager, lobby, coordinator, returns
try {
    rooms = require(compiled('multi/room/manager'))
    manager = require(compiled('multi/state/SessionManager')).sessionManager
    coordinator = require(compiled('multi/coordinator/embedded')).embeddedMultiCoordinator
    lobby = require(compiled('multi/tcp/lobby'))
    returns = require(compiled('multi/room/rematch-roster'))
} finally {
    global.setInterval = originalInterval
}
after(() => {
    Module._load = originalLoad
    for (const timer of intervals) clearInterval(timer)
    for (const [index, name] of ['MULTI_REALTIME_PROCESS', 'MULTI_REALTIME_OWNER_CHILD'].entries()) {
        if (previousRole[index] === undefined) delete process.env[name]
        else process.env[name] = previousRole[index]
    }
})

class Socket extends EventEmitter {
    destroyed = false; readable = true; writable = true; frames = []
    write(frame) { this.frames.push(JSON.parse(frame.replace(/\0$/, ''))); return true }
    destroy() { this.destroyed = true; this.readable = this.writable = false }
    end() { this.destroy() }
}
let sequence = 0
function fixture(t, count = 3) {
    const base = 920000 + (++sequence) * 10
    const room = rooms.createRoom(base, base, 1, 2, 1001002, 1, 1)
    const clients = []
    function connect(viewerId, connectionId = `${viewerId}-current`) {
        const client = manager.createClient(new Socket(), viewerId, room.room_number, connectionId, viewerId)
        client.roomGeneration = room.lobby_generation
        client.enterData = []
        client.yourself = {
            viewerId, playerId: viewerId, connectionId, comId: 0,
            currentPartyId: 1, state: [0], autoStart: false,
            party: { characters: [], equipments: [], abilitySoulIds: [] },
        }
        assert.equal(manager.addClientToRoom(client).ok, true)
        if (viewerId !== room.host_viewer_id) rooms.addRoomMember(room.room_number, viewerId, viewerId)
        clients.push(client)
        return client
    }
    for (let index = 0; index < count; index++) connect(base + index)
    const mates = clients.map(client => client.yourself)
    for (const client of clients) client.mates = mates
    room.mates = mates.map(mate => ({ viewer_id: mate.viewerId, player_id: mate.playerId, com_id: 0 }))
    function ready(index, value = true) {
        clients[index].isReady = value
        clients[index].yourself.state = [value ? 1 : 0]
    }
    function clearFrames() { for (const client of clients) client.socket.frames.length = 0 }
    async function notify(index, data, socket = clients[index].socket) {
        await lobby.handleMessage(socket, [0, data])
        await new Promise(resolve => setImmediate(resolve))
        await coordinator.enqueueRoomCommand(room.room_number, () => {})
    }
    t.after(() => {
        rooms.disbandRoom(room.room_number, 'autostart_contract_cleanup')
        for (const client of clients) { manager.removeClient(client); client.socket.destroy() }
    })
    return { room, clients, connect, ready, clearFrames, notify, host: clients[0] }
}
const frames = (x, tag) => x.host.socket.frames.filter(frame => frame[0] === 1 && frame[1][0] === tag)

test('two ready humans auto-ready the host and manually start without a countdown', async t => {
    const x = fixture(t, 2)
    await x.notify(0, [8, true])
    await x.notify(1, [3, [1]])
    assert.equal(x.host.isReady, true)
    assert.deepEqual(x.host.yourself.state, [1])
    assert.equal(x.room.readyCountdownPending, false)
    assert.deepEqual(frames(x, 10), [])
    await x.notify(0, [6])
    assert.equal(x.room.lifecycle.phase, 'BATTLE')
    assert.equal(x.room.lobby_generation, 1)
    assert.equal(x.room.npc_count, 0)
    assert.deepEqual(x.room.expected_real_viewer_ids, x.clients.map(client => client.viewerId))
    for (const client of x.clients) {
        const starts = client.socket.frames.filter(frame => frame[1][0] === 5)
        assert.equal(starts.length, 1)
        assert.equal(starts[0][1][1].length, 2)
    }
})

for (const initiallyReady of [true, false]) {
    test(`two humans and one server COM ${initiallyReady ? 'count down when Ready' : 'wait for COM Ready'} and start as 2R1COM`, async t => {
        const x = fixture(t, 2)
        // COM occupies a canonical roster seat without a third live client.
        const com = {
            viewerId: 900000001, comId: 1, connectionId: 'server-com-1',
            state: [initiallyReady ? 1 : 0], currentPartyId: 1,
            party: { characters: [], equipments: [], abilitySoulIds: [] },
        }
        const mates = [...x.host.mates, com]
        for (const client of x.clients) client.mates = mates
        x.room.is_npc_mode = true
        x.room.npc_count = 1
        x.room.mates = mates.map(mate => ({
            viewer_id: mate.viewerId, player_id: mate.playerId, com_id: mate.comId || 0,
        }))
        assert.equal(manager.getClientsInRoom(x.room.room_number).length, 2)
        await x.notify(0, [8, true])
        await x.notify(1, [3, [1]])
        if (!initiallyReady) {
            assert.notEqual(x.room.readyCountdownPending, true)
            assert.equal(x.host.isReady, false)
            assert.deepEqual(frames(x, 10), [])
            await x.notify(0, [6])
            assert.equal(x.room.lifecycle.phase, 'LOBBY', 'manual Start also waits for COM Ready')
            assert.deepEqual(frames(x, 5), [])
            com.state = [1]
            lobby.checkHostAutoReady(x.room.room_number)
        }
        assert.equal(x.host.isReady, true)
        assert.equal(x.room.readyCountdownPending, true)
        assert.deepEqual(frames(x, 10), [[1, [10, 2]]])
        assert.equal(x.room.lifecycle.phase, 'LOBBY', 'announcing the countdown leaves the battle awaiting Start')
        await x.notify(0, [6])
        assert.equal(x.room.lifecycle.phase, 'BATTLE')
        assert.equal(x.room.npc_count, 1)
        assert.equal(x.room.rematch_ai_count, 1)
        assert.deepEqual(x.room.expected_real_viewer_ids, x.clients.map(client => client.viewerId))
        assert.equal(manager.battleExpectedCount.get(x.room.room_number), 2)
        for (const client of x.clients) {
            const starts = client.socket.frames.filter(frame => frame[1][0] === 5)
            assert.equal(starts.length, 1)
            const roster = starts[0][1][1]
            assert.equal(roster.length, 3)
            assert.equal(roster.filter(mate => !mate.comId).length, 2)
            assert.deepEqual(roster.filter(mate => mate.comId).map(mate => mate.connectionId), ['server-com-1'])
        }
    })
}

test('three members need all Ready and host auto mode; host OFF clears pending and replays are idempotent', async t => {
    const x = fixture(t)
    await x.notify(1, [3, [1]])
    await x.notify(0, [8, true])
    assert.equal(x.room.readyCountdownPending, false, 'one unready guest prevents countdown')
    assert.deepEqual(frames(x, 10), [])
    await x.notify(2, [3, [1]])
    assert.equal(x.host.isReady, true)
    assert.equal(x.room.readyCountdownPending, true)
    assert.deepEqual(frames(x, 10), [[1, [10, 2]]])
    x.clearFrames()
    await x.notify(0, [8, true])
    assert.deepEqual(x.host.socket.frames, [], 'same host flag does not restart the countdown')
    await x.notify(0, [8, false])
    assert.equal(x.room.readyCountdownPending, false)
    assert.equal(x.host.isReady, true, 'auto mode OFF does not revoke legal manual readiness')
    assert.deepEqual(frames(x, 4), [[1, [4, x.host.connectionId, false]]])
    assert.deepEqual(frames(x, 10), [])
    x.clearFrames()
    await x.notify(0, [8, false])
    assert.deepEqual(x.host.socket.frames, [])
    await x.notify(0, [8, true])
    assert.equal(x.room.readyCountdownPending, true)
    assert.deepEqual(frames(x, 10), [[1, [10, 2]]], 'host OFF then ON announces a fresh countdown')
    await x.notify(0, [6])
    assert.equal(x.room.lifecycle.phase, 'BATTLE', 'three ready members also support manual Start')
})

test('guest auto mode updates canonical mates but cannot turn host auto mode ON or OFF', async t => {
    const x = fixture(t)
    x.ready(1); x.ready(2)
    // Old Welcome snapshots may still have separate arrays and mate objects.
    for (const client of x.clients) client.mates = x.clients.map(c => ({ ...c.yourself }))
    await x.notify(1, [8, true])
    assert.equal(x.host.yourself.autoStart, false)
    assert.notEqual(x.room.readyCountdownPending, true)
    assert.deepEqual(frames(x, 10), [])
    const canonicalGuest = x.host.mates.find(mate => mate.viewerId === x.clients[1].viewerId)
    assert.equal(canonicalGuest.autoStart, true)
    assert.equal(x.clients[1].yourself.autoStart, true)
    assert.ok(x.clients.every(client => client.mates === x.host.mates))
    await x.notify(1, [8, false])
    x.clearFrames()
    await x.notify(0, [8, true])
    assert.equal(x.room.readyCountdownPending, true)
    await x.notify(1, [8, true])
    await x.notify(1, [8, false])
    assert.equal(x.host.yourself.autoStart, true)
    assert.equal(x.room.readyCountdownPending, true, 'guest OFF cannot suppress the enabled host')
    assert.equal(x.host.isReady, true)
    assert.deepEqual(frames(x, 10), [[1, [10, 2]]], 'guest switches do not repeat a pending host countdown')
    assert.deepEqual(frames(x, 4), [
        [1, [4, x.host.connectionId, true]],
        [1, [4, x.clients[1].connectionId, true]],
        [1, [4, x.clients[1].connectionId, false]],
    ])
})

test('Notify8 rejects non-boolean payloads and unrelated sockets without changing the roster', async t => {
    const x = fixture(t)
    const mates = x.host.mates
    const before = JSON.stringify(mates)
    const pendingBefore = x.room.readyCountdownPending
    for (const value of [undefined, null, 0, 1, 'true', [], {}]) await x.notify(0, [8, value])
    await x.notify(0, [8, true], new Socket())
    assert.equal(x.host.mates, mates)
    assert.equal(JSON.stringify(mates), before)
    assert.equal(x.room.readyCountdownPending, pendingBefore, 'invalid input preserves the pending state')
    assert.deepEqual(x.host.socket.frames, [])
})

for (const invalid of ['old generation', 'not entered', 'battle client', 'superseded', 'STARTING', 'BATTLE', 'RETURNING']) {
    test(`Notify8 cannot mutate ${invalid}`, async t => {
        const x = fixture(t)
        if (invalid === 'old generation') x.host.roomGeneration--
        else if (invalid === 'not entered') x.host.enterData = null
        else if (invalid === 'battle client') x.host.isBattle = true
        else if (invalid === 'superseded') x.host.superseded = true
        else x.room.lifecycle.phase = invalid
        await x.notify(0, [8, true])
        assert.equal(x.host.yourself.autoStart, false)
        assert.equal(x.host.mates[0].autoStart, false)
        assert.deepEqual(x.host.socket.frames, [])
    })
}

test('a replaced socket cannot change the current host or broadcast its old flag', async t => {
    const x = fixture(t)
    const previous = x.host
    const current = x.connect(previous.viewerId, `${previous.viewerId}-replacement`)
    current.mates = [current.yourself, ...x.clients.slice(1, 3).map(client => client.yourself)]
    for (const client of x.clients.slice(1, 3)) client.mates = current.mates
    await x.notify(0, [8, true], previous.socket)
    assert.equal(previous.superseded, true)
    assert.equal(current.yourself.autoStart, false)
    assert.equal(previous.yourself.autoStart, false)
    assert.deepEqual(current.socket.frames, [])
    await x.notify(3, [8, true])
    assert.equal(current.yourself.autoStart, true)
    assert.deepEqual(current.socket.frames, [[1, [4, current.connectionId, true]]])
})

test('auto mode and manual Start cannot bypass a real rematch return reservation', async t => {
    const x = fixture(t)
    x.room.lobby_generation = 1
    x.room.expected_real_viewer_ids = x.clients.map(client => client.viewerId)
    for (const client of x.clients) { client.roomGeneration = 1; client.isReady = true; client.yourself.state = [1] }
    returns.ensureRematchReturnReservations(x.room)
    returns.markMemberReturned(x.room, x.clients[1].viewerId)
    // A visible/current socket alone is not successful new-generation Enter.
    await x.notify(0, [8, true])
    await x.notify(0, [6])
    assert.equal(x.room.lifecycle.phase, 'LOBBY')
    assert.equal(x.room.readyCountdownPending, false)
    assert.deepEqual(frames(x, 10), [])
    assert.deepEqual(frames(x, 5), [])
    assert.deepEqual(returns.getReservedReturnViewerIds(x.room), [x.clients[2].viewerId])
    returns.markMemberReturned(x.room, x.clients[2].viewerId)
    lobby.checkHostAutoReady(x.room.room_number)
    assert.equal(x.room.readyCountdownPending, true)
    await x.notify(0, [6])
    assert.equal(x.room.lifecycle.phase, 'BATTLE')
    assert.equal(x.room.lobby_generation, 2)
    assert.deepEqual(x.room.expected_real_viewer_ids, x.clients.map(client => client.viewerId))
})

test('host auto mode cannot bypass equipment readiness; repairing the party allows countdown', async t => {
    const x = fixture(t)
    x.ready(1); x.ready(2)
    x.clients[2].yourself.party.equipments = [[0, { equipmentId: 100013 }]]
    await x.notify(0, [8, true])
    assert.equal(x.room.readyCountdownPending, false)
    assert.equal(x.clients[2].isReady, false)
    assert.ok(x.clients[2].equipmentReadyBlock)
    await x.notify(0, [6])
    assert.equal(x.room.lifecycle.phase, 'LOBBY')
    assert.deepEqual(frames(x, 5), [])
    assert.deepEqual(frames(x, 10), [])
    x.clients[2].yourself.party.equipments = []
    await x.notify(2, [3, [1]])
    assert.equal(x.clients[2].equipmentReadyBlock, undefined)
    assert.equal(x.room.readyCountdownPending, true)
    assert.deepEqual(frames(x, 10), [[1, [10, 2]]])
})
