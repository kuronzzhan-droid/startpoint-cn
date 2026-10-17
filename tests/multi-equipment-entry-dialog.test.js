const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

// Any incidental storage initialization must stay away from player saves.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'multi-entry-dialog-'))
const originalInterval = global.setInterval
global.setInterval = (...args) => { const timer = originalInterval(...args); timer.unref(); return timer }
const rooms = require('../out/multi/room/manager')
const { sessionManager: manager } = require('../out/multi/state/SessionManager')
const { embeddedMultiCoordinator: coordinator } = require('../out/multi/coordinator/embedded')
const mode15 = require('../out/lib/mode15-optional')
const players = require('../out/data/domains/player')
const { handleMessage, checkHostAutoReady } = require('../out/multi/tcp/lobby')
const equipment = require('../out/multi/room/equipment-ready')
global.setInterval = originalInterval

class Socket extends EventEmitter {
    destroyed = false; writable = true; readable = true
    frames = []; endCalls = 0; destroyCalls = 0
    write(frame) { this.frames.push(JSON.parse(frame.replace(/\0$/, ''))); return true }
    end() { this.endCalls++; this.writable = false }
    destroy() { this.destroyCalls++; this.destroyed = true; this.emit('close') }
}

function setup(t, rejected = [], fantasy = false, count = 3) {
    const room = rooms.createRoom(101, 201, 1, 2, 1001, 0, 1)
    const clients = Array.from({ length: count }, (_, i) => {
        const socket = new Socket()
        const client = manager.createClient(socket, 101 + i, room.room_number, `cid-${i}`, 201 + i)
        client.roomGeneration = 0
        client.enterData = {}
        client.isReady = true
        client.yourself = { viewerId: client.viewerId, playerId: client.playerId,
            connectionId: client.connectionId, currentPartyId: 1, state: [1], comId: 0 }
        const address = `${client.viewerId}@${room.room_number}`
        manager.clients.set(address, client)
        if (!manager.roomClients.has(room.room_number)) manager.roomClients.set(room.room_number, new Set())
        manager.roomClients.get(room.room_number).add(address)
        manager.socketClients.set(socket, client)
        rooms.addRoomMember(room.room_number, client.viewerId, client.playerId)
        return client
    })
    const roster = clients.map(c => c.yourself)
    for (const c of clients) c.mates = roster
    const lookups = []
    t.mock.method(players, 'getPlayerSync', () => ({ partySlot: 7 }))
    t.mock.method(mode15, 'isMode15Quest', () => fantasy)
    t.mock.method(mode15, 'isMode15EquipmentAllowedQuest', () => fantasy)
    t.mock.method(mode15, 'getMode15ExclusiveGlobalPartyItemsSync', (playerId, category, slot) => {
        lookups.push({ playerId, category, slot })
        return rejected.includes(playerId) ? [5900001] : []
    })
    t.after(() => {
        if (rooms.getRoom(room.room_number)) manager.commitRoomDisband(room.room_number, 'test_cleanup')
        for (const c of clients) c.socket.destroy()
    })
    const start = async (sender = 0) => {
        handleMessage(clients[sender].socket, [0, [6]])
        await coordinator.enqueueRoomCommand(room.room_number, () => {})
    }
    const notify = async (index, payload) => {
        handleMessage(clients[index].socket, [0, payload])
        await coordinator.enqueueRoomCommand(room.room_number, () => {})
    }
    return { room, clients, lookups, start, notify, rejected }
}

for (const [name, rejected, count, sender] of [
    ['host rejected in three-player room', [201], 3, 0],
    ['guest rejected in three-player room', [202], 3, 0],
    ['guest sends StartBattle before host', [202], 3, 1],
    ['multiple restricted players', [201, 203], 3, 0],
    ['two-player room', [202], 2, 0],
]) {
    test(`${name}: readiness is cancelled without disband, start, countdown or FIN`, async t => {
        const x = setup(t, rejected, false, count)
        await x.start(sender)
        assert.equal(rooms.getRoom(x.room.room_number), x.room)
        assert.equal(x.room.lifecycle.phase, 'LOBBY')
        assert.equal(manager.battleExpectedCount.has(x.room.room_number), false)
        assert.equal(manager.getClientsInRoom(x.room.room_number).length, count)
        assert.ok(x.lookups.length >= count)
        assert.ok(x.lookups.every(q => q.category === 1 && q.slot === 7), 'persisted selected party overrides stale lobby slot')
        for (const c of x.clients) {
            assert.ok(c.socket.frames.every(frame => frame[1][0] === 2))
            assert.equal(c.socket.endCalls, 0)
            assert.equal(c.socket.destroyCalls, 0)
            assert.equal(manager.isRetiredLobbySocket(c.socket), false)
        }
        const deadlines = x.clients.map(c => c.equipmentReadyBlock?.deadline)
        await x.start(sender)
        assert.deepEqual(x.clients.map(c => c.equipmentReadyBlock?.deadline), deadlines)
        assert.equal(!!x.clients[0].equipmentReadyBlock, rejected.includes(201),
            'only the host own restricted gear starts a room disband timer')
    })
}

for (const fantasy of [false, true]) {
    test(`${fantasy ? 'fantasy quest with exclusive gear' : 'ordinary quest with legal gear'} still starts`, async t => {
        const x = setup(t, fantasy ? [201, 202, 203] : [], fantasy)
        await x.start()
        assert.equal(x.room.lifecycle.phase, 'BATTLE')
        assert.equal(manager.battleExpectedCount.get(x.room.room_number), 3)
        for (const c of x.clients) {
            assert.equal(c.socket.frames.length, 1)
            assert.equal(c.socket.frames[0][1][0], 5)
            assert.equal(c.socket.frames[0][1][1].length, 3)
            assert.equal(c.socket.endCalls, 0)
        }
        if (fantasy) assert.deepEqual(x.lookups, [])
    })
}

test('ordinary room disband keeps its original message', t => {
    const x = setup(t)
    assert.equal(manager.commitRoomDisband(x.room.room_number, 'normal_disband'), true)
    for (const c of x.clients) assert.deepEqual(c.socket.frames, [[1, [6, 'multibattle_room_dismissed']]])
})

test('entry records the selected SET without starting an equipment deadline', async t => {
    const x = setup(t, [202])
    for (const c of x.clients) {
        c.isReady = false
        c.yourself.state = [0]
    }
    await x.notify(1, [0, { party: { abilitySoulIds: [[0, 100013]] } }, 8])
    assert.equal(x.clients[1].equipmentSelectedPartyId, 8)
    assert.equal(x.clients[1].yourself.currentPartyId, 8)
    assert.equal(x.clients[1].equipmentReadyBlock, undefined)
    assert.equal(x.room.lifecycle.phase, 'LOBBY')
    assert.equal(x.clients[1].socket.frames.some(f => f[1][0] === 6), false)
    await x.notify(1, [3, [1]])
    assert.equal(x.clients[1].isReady, false)
    assert.ok(x.clients[1].equipmentReadyBlock)
})

test('manual and forced Ready are denied; heartbeat and retries do not extend 30 seconds', async t => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'] })
    const x = setup(t, [202])
    await x.notify(1, [3, [1]])
    const deadline = x.clients[1].equipmentReadyBlock.deadline
    assert.equal(deadline - Date.now(), 30000)
    assert.equal(x.clients[1].isReady, false)
    t.mock.timers.tick(29000)
    await x.notify(1, [4])
    await x.notify(1, [3, [1]])
    assert.equal(x.clients[1].equipmentReadyBlock.deadline, deadline)
    t.mock.timers.tick(1000)
    await coordinator.enqueueRoomCommand(x.room.room_number, () => {})
    assert.equal(manager.getClient(102, x.room.room_number), undefined)
    assert.equal(rooms.getRoom(x.room.room_number), x.room)
    assert.equal(x.room.member_viewer_ids.includes(102), false)
    assert.equal(x.room.expected_real_viewer_ids.includes(102), false)
    assert.equal(x.clients[1].socket.endCalls, 0, 'client consumes native leave before socket close')
    for (const i of [0, 2]) assert.equal(x.clients[i].socket.frames.some(f => f[1][0] === 6), false)
})

test('blocked host disbands at 30 seconds; automatic Ready and Start retries cannot postpone it', async t => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'] })
    const x = setup(t, [201])
    checkHostAutoReady(x.room.room_number)
    const deadline = x.clients[0].equipmentReadyBlock.deadline
    assert.equal(deadline - Date.now(), 30000)
    t.mock.timers.tick(29999)
    await x.notify(0, [4])
    await x.notify(0, [3, [1]])
    await x.start()
    assert.equal(x.clients[0].equipmentReadyBlock.deadline, deadline)
    assert.equal(manager.getClient(101, x.room.room_number), x.clients[0])
    assert.equal(x.room.lifecycle.phase, 'LOBBY')
    assert.ok(x.clients[0].socket.frames.every(f => [2, 11].includes(f[1][0])))
    t.mock.timers.tick(1)
    await coordinator.enqueueRoomCommand(x.room.room_number, () => {})
    assert.equal(rooms.getRoom(x.room.room_number), undefined)
    assert.equal(x.room.lifecycle.phase, 'DISBANDED')
    assert.equal(manager.battleExpectedCount.has(x.room.room_number), false)
    for (const c of x.clients) {
        assert.equal(c.equipmentReadyBlock, undefined)
        assert.equal(c.socket.frames.filter(f => f[1][0] === 6).length, 1)
        assert.equal(c.socket.frames.some(f => [5, 10].includes(f[1][0])), false)
        assert.equal(c.socket.endCalls, 0)
        assert.equal(c.socket.destroyCalls, 0)
    }
})

for (const field of ['equipments', 'abilitySoulIds']) {
    test(`host wire ${field} triggers the same delayed room disband`, async t => {
        t.mock.timers.enable({ apis: ['Date', 'setTimeout'] })
        const x = setup(t)
        x.clients[0].yourself.party = field === 'equipments'
            ? { equipments: [[0, { equipmentId: 100013 }]] }
            : { abilitySoulIds: [[0, 100023]] }
        await x.notify(0, [3, [1]])
        assert.ok(x.clients[0].equipmentReadyBlock)
        assert.equal(x.room.lifecycle.phase, 'LOBBY')
        t.mock.timers.tick(30000)
        await coordinator.enqueueRoomCommand(x.room.room_number, () => {})
        assert.equal(rooms.getRoom(x.room.room_number), undefined)
    })
}

test('repairing host equipment before expiry cancels disband and allows a normal start', async t => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'] })
    const x = setup(t, [201])
    x.clients[0].yourself.autoStart = true
    await x.notify(0, [3, [1]])
    t.mock.timers.tick(29999)
    x.rejected.length = 0
    await x.notify(0, [2, { party: { equipments: [], abilitySoulIds: [] } }, false, 7])
    assert.equal(x.clients[0].equipmentReadyBlock, undefined)
    assert.equal(x.room.readyCountdownPending, true)
    await x.start()
    assert.equal(x.room.lifecycle.phase, 'BATTLE')
    t.mock.timers.tick(30001)
    await coordinator.enqueueRoomCommand(x.room.room_number, () => {})
    assert.equal(rooms.getRoom(x.room.room_number), x.room)
})

test('host effective current-SET edits renew idle, other SETs and automatic messages do not', async t => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'] })
    const x = setup(t, [201])
    await x.notify(0, [3, [1]])
    const firstDeadline = x.clients[0].equipmentReadyBlock.deadline
    t.mock.timers.tick(20000)
    await equipment.notifyEquipmentPartySaved(201, [8], false)
    assert.equal(x.clients[0].equipmentReadyBlock.deadline, firstDeadline)
    await equipment.notifyEquipmentPartySaved(201, [7], false)
    const renewed = x.clients[0].equipmentReadyBlock.deadline
    assert.equal(renewed - Date.now(), 30000)
    t.mock.timers.tick(10000)
    await x.notify(0, [2, { party: { equipments: [[0, { equipmentId: 100013 }]] } }, true, 7])
    assert.equal(x.clients[0].equipmentReadyBlock.deadline, renewed)
    assert.equal(rooms.getRoom(x.room.room_number), x.room)
    t.mock.timers.tick(20000)
    await coordinator.enqueueRoomCommand(x.room.room_number, () => {})
    assert.equal(rooms.getRoom(x.room.room_number), undefined)
})

test('host stale expiry cannot disband a new generation or replacement connection', async t => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'] })
    const x = setup(t, [201])
    await x.notify(0, [3, [1]])
    x.room.lobby_generation++
    t.mock.timers.tick(30000)
    await coordinator.enqueueRoomCommand(x.room.room_number, () => {})
    assert.equal(rooms.getRoom(x.room.room_number), x.room)
    const old = x.clients[0]
    old.roomGeneration = x.room.lobby_generation
    await x.notify(0, [3, [1]])
    assert.ok(old.equipmentReadyBlock)
    const replacement = manager.createClient(new Socket(), old.viewerId, old.roomNumber, 'new-host', old.playerId)
    replacement.roomGeneration = x.room.lobby_generation
    replacement.enterData = {}
    replacement.yourself = { ...old.yourself, connectionId: 'new-host' }
    manager.addClientToRoom(replacement)
    t.after(() => replacement.socket.destroy())
    assert.equal(old.equipmentReadyBlock, undefined)
    t.mock.timers.tick(30000)
    await coordinator.enqueueRoomCommand(x.room.room_number, () => {})
    assert.equal(rooms.getRoom(x.room.room_number), x.room)
    assert.equal(manager.getClient(101, x.room.room_number), replacement)
})

test('simultaneous restricted host and guest deadlines disband the room only once', async t => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'] })
    const x = setup(t, [201, 202])
    await x.start()
    assert.ok(x.clients[0].equipmentReadyBlock)
    assert.ok(x.clients[1].equipmentReadyBlock)
    t.mock.timers.tick(30000)
    await coordinator.enqueueRoomCommand(x.room.room_number, () => {})
    assert.equal(rooms.getRoom(x.room.room_number), undefined)
    for (const c of x.clients) {
        assert.equal(c.equipmentReadyBlock, undefined)
        assert.equal(c.socket.frames.filter(f => f[1][0] === 6).length, 1)
    }
})

test('valid party repair clears the deadline and permits a fresh countdown and battle', async t => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'] })
    const rejected = [202]
    const x = setup(t, rejected)
    x.clients[0].yourself.autoStart = true
    await x.notify(1, [3, [1]])
    rejected.length = 0
    await x.notify(1, [2, { party: { equipments: [], abilitySoulIds: [] } }, false, 7])
    assert.equal(x.clients[1].equipmentReadyBlock, undefined)
    assert.equal(x.clients[1].yourself.state[0], 0)
    await x.notify(1, [3, [1]])
    assert.ok(x.clients[0].socket.frames.some(f => f[1][0] === 10))
    await x.start()
    assert.equal(x.room.lifecycle.phase, 'BATTLE')
    t.mock.timers.tick(30000)
    await coordinator.enqueueRoomCommand(x.room.room_number, () => {})
    assert.equal(manager.getClient(102, x.room.room_number), x.clients[1])
})

test('changing to another invalid party renews once; repeated payload does not renew', async t => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'] })
    const x = setup(t, [202])
    await x.notify(1, [3, [1]])
    t.mock.timers.tick(20000)
    const payload = [2, { party: { equipments: [[0, { equipmentId: 100013 }]] } }, false, 8]
    await x.notify(1, payload)
    const deadline = x.clients[1].equipmentReadyBlock.deadline
    assert.equal(deadline - Date.now(), 30000)
    t.mock.timers.tick(10000)
    await x.notify(1, payload)
    assert.equal(x.clients[1].equipmentReadyBlock.deadline, deadline)
})

test('automatic party changes do not extend the equipment deadline', async t => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'] })
    const x = setup(t, [202])
    await x.notify(1, [3, [1]])
    const deadline = x.clients[1].equipmentReadyBlock.deadline
    t.mock.timers.tick(20000)
    await x.notify(1, [2, { party: { equipments: [[0, { equipmentId: 100013 }]] } }, true, 8])
    assert.equal(x.clients[1].equipmentReadyBlock.deadline, deadline)
})

test('legal automatic rematch party changes retain readiness', async t => {
    const x = setup(t)
    x.clients[0].yourself.autoStart = true
    await x.notify(1, [2, { party: { equipments: [], abilitySoulIds: [] } }, true, 7])
    assert.equal(x.clients[1].isReady, true)
    assert.equal(x.clients[1].yourself.state[0], 1)
    assert.equal(x.clients[1].equipmentReadyBlock, undefined)
    assert.equal(x.room.readyCountdownPending, true)
})

test('an already announced countdown cannot start after an invalid party change', async t => {
    const x = setup(t)
    x.clients[0].yourself.autoStart = true
    checkHostAutoReady(x.room.room_number)
    assert.equal(x.room.readyCountdownPending, true)
    await x.notify(1, [2, { party: { abilitySoulIds: [[0, 100023]] } }, false, 7])
    assert.equal(x.room.readyCountdownPending, false)
    const counts = x.clients.map(c => c.socket.frames.filter(f => f[1][0] === 10).length)
    await x.start()
    await x.notify(1, [3, [1]])
    assert.deepEqual(x.clients.map(c => c.socket.frames.filter(f => f[1][0] === 10).length), counts)
    assert.equal(x.room.lifecycle.phase, 'LOBBY')
    await x.notify(1, [2, { party: { abilitySoulIds: [[1]] } }, false, 7])
    await x.notify(1, [3, [1]])
    assert.equal(x.room.readyCountdownPending, true)
    await x.start()
    assert.equal(x.room.lifecycle.phase, 'BATTLE')
})

test('party-save notification ignores other SETs and renews only a changed current SET', async t => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'] })
    const x = setup(t, [202])
    await x.notify(1, [3, [1]])
    const deadline = x.clients[1].equipmentReadyBlock.deadline
    t.mock.timers.tick(15000)
    await equipment.notifyEquipmentPartySaved(202, [8], false)
    await equipment.notifyEquipmentPartySaved(202, [], false)
    assert.equal(x.clients[1].equipmentReadyBlock.deadline, deadline)
    await equipment.notifyEquipmentPartySaved(202, [7], false)
    assert.equal(x.clients[1].equipmentReadyBlock.deadline - Date.now(), 30000)
    assert.equal(x.room.lifecycle.phase, 'LOBBY')
})

test('disband and generation changes invalidate pending equipment expiry', async t => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'] })
    const x = setup(t, [202])
    await x.notify(1, [3, [1]])
    x.room.lobby_generation++
    t.mock.timers.tick(30000)
    await coordinator.enqueueRoomCommand(x.room.room_number, () => {})
    assert.equal(manager.getClient(102, x.room.room_number), x.clients[1])
    x.clients[1].roomGeneration = x.room.lobby_generation
    await x.notify(1, [3, [1]])
    assert.ok(x.clients[1].equipmentReadyBlock)
    manager.commitRoomDisband(x.room.room_number, 'test_disband')
    assert.equal(x.clients[1].equipmentReadyBlock, undefined)
})

test('actual wire equipment and souls are checked even when stored party is legal', async t => {
    const x = setup(t)
    x.clients[1].yourself.party = { equipments: [[0, { equipmentId: 100013 }]] }
    x.clients[2].yourself.party = { abilitySoulIds: [[1], [0, 100023], [1]] }
    await x.start()
    assert.equal(x.room.lifecycle.phase, 'LOBBY')
    assert.equal(x.clients[1].isReady, false)
    assert.equal(x.clients[2].isReady, false)
    assert.deepEqual(equipment.exclusiveWirePartyItems({
        equipments: [{ equipment_id: 100013 }], ability_soul_ids: [100023],
    }), [100013, 100023])
})

test('server-owned AI equipment is normalized without changing real players or Fantasy', t => {
    const x = setup(t)
    const party = { equipments: [[0, { equipmentId: 100013 }], [0, { equipmentId: 999 }]],
        abilitySoulIds: [[0, 100023]], characters: [[0, { id: 1 }]] }
    const normalized = equipment.legalNpcParty(x.room, party)
    assert.deepEqual(normalized.equipments, [[1], [0, { equipmentId: 999 }]])
    assert.deepEqual(normalized.abilitySoulIds, [[1]])
    assert.equal(party.equipments[0][0], 0)
    assert.equal(normalized.characters, party.characters)
    t.mock.method(mode15, 'isMode15EquipmentAllowedQuest', () => true)
    assert.equal(equipment.legalNpcParty(x.room, party), party)
})

test('retired connection timer cannot eject a replacement connection', async t => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'] })
    const x = setup(t, [202])
    await x.notify(1, [3, [1]])
    const old = x.clients[1]
    const replacement = manager.createClient(new Socket(), old.viewerId, old.roomNumber, 'new-cid', old.playerId)
    replacement.enterData = {}
    replacement.yourself = { ...old.yourself, connectionId: 'new-cid' }
    manager.addClientToRoom(replacement)
    t.after(() => replacement.socket.destroy())
    assert.equal(old.equipmentReadyBlock, undefined)
    t.mock.timers.tick(30000)
    await coordinator.enqueueRoomCommand(x.room.room_number, () => {})
    assert.equal(manager.getClient(102, x.room.room_number), replacement)
})

test('battle selection freezes edits; return to lobby re-enables checking for the new round', async t => {
    const x = setup(t)
    x.room.readyCountdownPending = true
    await x.start()
    assert.equal(x.room.readyCountdownPending, false)
    const generation = x.room.lobby_generation
    await x.notify(1, [2, { party: { equipments: [[0, { equipmentId: 100013 }]] } }, false, 8])
    assert.equal(x.clients[1].yourself.party, undefined)
    assert.ok(x.room.equipmentPartyIds)
    coordinator.beginSettlementReturn(x.room, generation)
    x.room.readyCountdownPending = true
    coordinator.completeSettlementReturn(x.room)
    assert.equal(x.room.equipmentPartyIds, undefined)
    assert.equal(x.room.readyCountdownPending, false)
    for (const c of x.clients) c.roomGeneration = generation
    x.rejected.push(202)
    await x.notify(1, [3, [1]])
    assert.equal(x.clients[1].isReady, false)
    assert.equal(x.room.lifecycle.phase, 'LOBBY')
})

test.after(() => {
    const db = require('../out/data/db').getDb()
    if (db.open) db.close()
    fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true })
})
