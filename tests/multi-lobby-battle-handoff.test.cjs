const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const interval = global.setInterval
global.setInterval = (...args) => { const timer = interval(...args); timer.unref(); return timer }
const rooms = require('../out/multi/room/manager')
const { sessionManager: manager } = require('../out/multi/state/SessionManager')
const { embeddedMultiCoordinator: coordinator } = require('../out/multi/coordinator/embedded')
const lobby = require('../out/multi/tcp/lobby')
const { classifyMultiActiveQuestRecovery: recover } = require('../out/lib/multi-active-quest-recovery')
global.setInterval = interval

class Socket extends EventEmitter {
    destroyed = false; writable = true; readable = true; frames = []
    write(frame) { this.frames.push(JSON.parse(frame.replace(/\0$/, ''))); return true }
    destroy() { this.destroyed = true; this.writable = false }
    end() { this.destroy() }
}

function setup(t) {
    const room = rooms.createRoom(91001, 1, 1, 2, 1033004, 1, 1)
    const make = viewer => {
        const client = manager.createClient(new Socket(), viewer, room.room_number, `handoff-${viewer}`, viewer === 91001 ? 1 : 2)
        client.roomGeneration = room.lobby_generation
        client.enterData = []
        client.yourself = { viewerId: viewer, playerId: client.playerId, connectionId: client.connectionId, state: [1], party: [] }
        manager.addClientToRoom(client)
        rooms.addRoomMember(room.room_number, viewer, client.playerId)
        return client
    }
    const host = make(91001), peer = make(91002)
    host.mates = peer.mates = [host.yourself, peer.yourself]
    room.mates = [{ viewer_id: host.viewerId, player_id: 1 }, { viewer_id: peer.viewerId, player_id: 2 }]
    room.expected_real_viewer_ids = [host.viewerId, peer.viewerId]
    const bye = async client => {
        lobby.handleMessage(client.socket, [0, [1]])
        await coordinator.enqueueRoomCommand(room.room_number, () => {})
    }
    t.after(() => rooms.disbandRoom(room.room_number, 'test_cleanup'))
    return { room, host, peer, bye }
}

test('normal lobby-to-battle Bye preserves both frozen identities and roster for login recovery', async t => {
    const { room, host, peer, bye } = setup(t)
    assert.equal(coordinator.commitBattleStart(room).ok, true)
    const frozen = structuredClone({ members: room.member_viewer_ids, players: room.member_player_ids, expected: room.expected_real_viewer_ids, mates: room.mates })
    await bye(peer)
    assert.deepEqual({ members: room.member_viewer_ids, players: room.member_player_ids, expected: room.expected_real_viewer_ids, mates: room.mates }, frozen)
    assert.deepEqual(host.mates, [host.yourself, peer.yourself])
    assert.equal(recover({ isMulti: true, roomNumber: room.room_number, category: 2, questId: 1033004 }, room, peer.viewerId).recoverable, true)
    await bye(host)
    assert.deepEqual(room.expected_real_viewer_ids, frozen.expected)
})

test('intentional current lobby guest Bye releases all retained seat references', async t => {
    const { room, peer, bye } = setup(t)
    await bye(peer)
    assert.equal(room.member_viewer_ids.includes(peer.viewerId), false)
    assert.equal(room.expected_real_viewer_ids.includes(peer.viewerId), false)
    assert.equal(room.member_player_ids[peer.viewerId], undefined)
    assert.equal(room.mates.some(m => m.viewer_id === peer.viewerId), false)
})

test('old generation lobby Bye cannot change the current rematch roster', async t => {
    const { room, peer, bye } = setup(t)
    room.lobby_generation++
    const frozen = structuredClone({ members: room.member_viewer_ids, expected: room.expected_real_viewer_ids, mates: room.mates })
    await bye(peer)
    assert.deepEqual({ members: room.member_viewer_ids, expected: room.expected_real_viewer_ids, mates: room.mates }, frozen)
})

test('HTTP restore reports the active battle for either member after both lobby transports closed', async t => {
    const { room, host, peer, bye } = setup(t)
    const contexts = require('../out/multi/player-context')
    t.mock.method(contexts, 'resolveMultiPlayerContext', async () => ({ playerId: 1 }))
    const routes = new Map()
    require('../out/multi/http/room').registerRoomRoutes({ post: (url, handler) => routes.set(url, handler) })
    coordinator.commitBattleStart(room)
    await bye(peer); await bye(host)
    for (const viewer of [host.viewerId, peer.viewerId]) {
        let response
        const reply = { header() { return this }, status() { return this }, send(value) { response = value; return this } }
        await routes.get('/restore_room')({ body: { viewer_id: viewer, room_number: room.room_number } }, reply)
        assert.equal(response.data.raising_state, 4, 'active BATTLE must not be downgraded to an offline lobby')
        assert.equal(response.data.room_number, room.room_number)
        assert.equal(response.data.quest_id, room.quest_id)
    }
})
