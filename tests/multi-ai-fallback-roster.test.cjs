const test = require('node:test')
const { after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const { EventEmitter } = require('node:events')

// Storage stays in an ignored temporary directory, away from player saves.
const root = path.resolve(__dirname, '..')
const temporaryRoot = path.join(root, 'tmp')
let ownedDataDirectory
if (!process.env.DATA_DIR) {
    fs.mkdirSync(temporaryRoot, { recursive: true })
    ownedDataDirectory = fs.mkdtempSync(path.join(temporaryRoot, 'multi-ai-fallback-roster-'))
    process.env.DATA_DIR = ownedDataDirectory
}
process.env.MULTI_AI_FILL_TIMEOUT_MS = '35'
process.env.NPC_JOIN_DELAY_MS = '150'
process.env.NPC_READY_DELAY_MS = '10000'

// Model only transport identity and legal party data. Room membership,
// command serialization, Enter/Welcome, recruitment and broadcasting remain
// the actual compiled server code; no native client or database is required.
const stubs = new Map([
    [path.join(root, 'out/lib/online-presence.js'), { markPlayerOnlineFromTcp() {} }],
    [path.join(root, 'out/data/domains/player.js'), {
        getPlayerSync: () => ({ partySlot: 1 }),
        updatePlayerPartySlotAsync: async () => {},
    }],
    [path.join(root, 'out/multi/npc/player-party-pool.js'), {
        getNpcPartySelectionOptions: () => ({}),
        getRandomPlayerNpcPartiesSync: (_playerId, count) => Array.from(
            { length: count }, () => ({ party: { characters: [], equipments: [] } }),
        ),
    }],
])
const originalLoad = Module._load
Module._load = function (request, parent, isMain) {
    const resolved = Module._resolveFilename(request, parent)
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
const rooms = require('../out/multi/room/manager')
const manager = require('../out/multi/state/SessionManager').sessionManager
const coordinator = require('../out/multi/coordinator/embedded').embeddedMultiCoordinator
const lobby = require('../out/multi/tcp/lobby')
const aiFill = require('../out/multi/ai-fill')
const recruitment = require('../out/multi/recruitment')
global.setInterval = originalInterval
after(() => {
    Module._load = originalLoad
    for (const timer of intervals) clearInterval(timer)
    if (ownedDataDirectory) {
        const resolvedRoot = fs.realpathSync(temporaryRoot)
        const resolvedDirectory = fs.realpathSync(ownedDataDirectory)
        const relative = path.relative(resolvedRoot, resolvedDirectory)
        assert.ok(relative && !path.isAbsolute(relative)
            && relative !== '..' && !relative.startsWith(`..${path.sep}`),
        'owned temporary data directory must resolve inside repository tmp before cleanup')
        fs.rmSync(resolvedDirectory, { recursive: true })
    }
})

class Socket extends EventEmitter {
    destroyed = false
    readable = true
    writable = true
    frames = []
    endCalls = 0
    destroyCalls = 0
    write(frame) {
        this.frames.push(JSON.parse(frame.replace(/\0$/, '')))
        return true
    }
    end() { this.endCalls++; this.writable = false }
    destroy() { this.destroyCalls++; this.destroyed = true; this.emit('close') }
}

function setup(t) {
    const timers = []
    const nativeClearTimeout = global.clearTimeout
    t.mock.method(global, 'setTimeout', (callback, delay, ...args) => {
        const timer = { callback: () => callback(...args), delay, cancelled: false,
            fired: false, unref() { return this }, ref() { return this } }
        timers.push(timer)
        return timer
    })
    t.mock.method(global, 'clearTimeout', timer => {
        if (timers.includes(timer)) timer.cancelled = true
        else nativeClearTimeout(timer)
    })
    const room = rooms.createRoom(101, 101, 1, 2, 1001, 0, 1)
    const clients = []
    function connect(viewerId) {
        const client = manager.createClient(new Socket(), viewerId, room.room_number,
            `${room.room_number}-connection-${clients.length}`, viewerId)
        client.roomGeneration = room.lobby_generation
        client.yourself = { viewerId, playerId: viewerId,
            connectionId: client.connectionId, comId: 0, state: [0], rank: 1,
            currentPartyId: 1, autoStart: false,
            party: { characters: [], equipments: [] } }
        manager.addClientToRoom(client)
        clients.push(client)
        return client
    }
    async function drain() {
        // A fallback command schedules a second recruitment command, so flush
        // the real coordinator queue through both levels of nested enqueue.
        for (let i = 0; i < 3; i++) await coordinator.enqueueRoomCommand(room.room_number, () => {})
    }
    async function enter(client) {
        lobby.handleMessage(client.socket, [0, [0, { party: client.yourself.party }, 1]])
        await drain()
        assert.ok(client.socket.frames.some(frame => frame[0] === 1 && frame[1]?.[0] === 0),
            'the connection must receive actual Welcome before checking later Mates')
    }
    function pending(delay) {
        const timer = timers.find(timer => timer.delay === delay && !timer.cancelled && !timer.fired)
        assert.ok(timer, `actual server must register a ${delay}ms timer`)
        return timer
    }
    async function fire(timer) {
        assert.equal(timer.cancelled, false)
        timer.fired = true
        timer.callback()
        await drain()
    }
    t.after(() => {
        aiFill.cancelAiFallback(room.room_number)
        manager.commitRoomDisband(room.room_number, 'test_cleanup')
        for (const client of clients) client.socket.destroy()
    })
    return { room, connect, enter, pending, fire }
}

function assertSafeRoster(client, expectedRealConnections) {
    const frames = client.socket.frames
    const welcomeIndex = frames.findIndex(frame => frame[0] === 1 && frame[1]?.[0] === 0)
    const updates = frames.slice(welcomeIndex + 1)
        .filter(frame => frame[0] === 1 && frame[1]?.[0] === 1)
    assert.ok(updates.length > 0)
    for (const update of updates) {
        assert.ok(update[1][1].some(mate => mate.connectionId === client.connectionId),
            `Mates after Welcome must retain receiving connection ${client.connectionId}`)
    }
    const finalRoster = updates.at(-1)[1][1]
    assert.deepEqual(finalRoster.filter(mate => !mate.comId).map(mate => mate.connectionId).sort(),
        [...expectedRealConnections].sort())
    assert.equal(finalRoster.filter(mate => mate.comId).length, 1)
    assert.equal(client.socket.destroyed, false)
    assert.equal(client.socket.endCalls, 0)
    assert.equal(client.socket.destroyCalls, 0)
}

for (const replacement of ['remove then reconnect', 'supersede directly']) {
    test(`delayed AI Mates uses current roster after host ${replacement}`, async t => {
        const x = setup(t)
        const oldHost = x.connect(101)
        await x.enter(oldHost)
        recruitment.publishRandomRecruitment(x.room.room_number)
        aiFill.scheduleAiFallback(x.room.room_number)
        await x.fire(x.pending(35))
        assert.equal(oldHost.mates.filter(mate => mate.comId).length, 2)
        const oldJoinTimer = x.pending(150)

        // Guest handshake retains the room while the old host disconnects.
        // Enter then removes the obsolete COM seat from the new host roster.
        const guest = x.connect(102)
        if (replacement === 'remove then reconnect') manager.removeClient(oldHost)
        const newHost = x.connect(101)
        await x.enter(newHost)
        await x.enter(guest)
        // Reconcile is registered 100ms after Enter, before the old delayed
        // join broadcast (150ms after fallback) in the reproduced sequence.
        await x.fire(x.pending(100))
        assert.equal(newHost.mates.filter(mate => mate.comId).length, 1)
        await x.fire(oldJoinTimer)

        const expected = [newHost.connectionId, guest.connectionId]
        assertSafeRoster(guest, expected)
        assertSafeRoster(newHost, expected)
        assert.deepEqual(x.room.member_viewer_ids, [101, 102])
        assert.equal(x.room.lifecycle.phase, 'LOBBY')
    })
}

test('guest Enter before fallback retains both real connections and fills one AI', async t => {
    const x = setup(t)
    const host = x.connect(101)
    await x.enter(host)
    recruitment.publishRandomRecruitment(x.room.room_number)
    aiFill.scheduleAiFallback(x.room.room_number)
    const guest = x.connect(102)
    await x.enter(guest)
    await x.fire(x.pending(35))
    await x.fire(x.pending(150))
    assertSafeRoster(host, [host.connectionId, guest.connectionId])
    assertSafeRoster(guest, [host.connectionId, guest.connectionId])
    assert.equal(x.room.npc_count, 1)
})

test('empty clear history publishes the host wire party and preserves it across a rematch', async t => {
    const pool = stubs.get(path.join(root, 'out/multi/npc/player-party-pool.js'))
    let selections = 0
    t.mock.method(pool, 'getRandomPlayerNpcPartiesSync', () => { selections++; return [] })
    const x = setup(t)
    const host = x.connect(101)
    host.yourself.party = {
        characters: [[0, { id: 131012 }], [0, { id: 141007 }], [0, { id: 151001 }]],
        unison_characters: [[1], [1], [1]],
        equipments: [[0, { equipmentId: 300101, level: 5 }], [1], [1]],
        abilitySoulIds: [[0, 300201], [1], [1]],
    }
    const firstParty = host.yourself.party
    await x.enter(host)
    recruitment.publishRandomRecruitment(x.room.room_number)
    aiFill.scheduleAiFallback(x.room.room_number)
    await x.fire(x.pending(35))
    await x.fire(x.pending(150))
    const firstRoster = host.socket.frames.filter(frame => frame[0] === 1 && frame[1]?.[0] === 1)
        .at(-1)[1][1]
    assert.equal(firstRoster.filter(mate => mate.comId).length, 2)
    assert.ok(firstRoster.filter(mate => mate.comId)
        .every(mate => JSON.stringify(mate.party) === JSON.stringify(firstParty)))
    const cached = { ...x.room.npc_party_by_com_id }
    assert.equal(selections, 1)

    x.room.lobby_generation++
    host.roomGeneration = x.room.lobby_generation
    host.yourself.party = {
        ...firstParty,
        equipments: [[0, { equipmentId: 300201, level: 5 }], [1], [1]],
    }
    await x.enter(host)
    await x.fire(x.pending(500))
    await x.fire(x.pending(150))
    assert.equal(selections, 1, 'a rematch must reuse its cached COM parties without a pool draw')
    assert.deepEqual(Object.keys(x.room.npc_party_by_com_id), Object.keys(cached))
    for (const [comId, party] of Object.entries(cached)) {
        assert.equal(x.room.npc_party_by_com_id[comId], party)
        assert.deepEqual(host.mates.find(mate => String(mate.comId) === comId).party, firstParty)
    }
})
