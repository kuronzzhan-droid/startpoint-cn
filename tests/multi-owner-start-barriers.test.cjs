const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { EventEmitter } = require('node:events')
process.env.MULTI_REALTIME_PROCESS = '0'
process.env.MULTI_REALTIME_OWNER_CHILD = '0'
const interval = global.setInterval
global.setInterval = (...args) => { const timer = interval(...args); timer.unref(); return timer }
const out = process.env.STARPOINT_TEST_OUT_DIR || path.resolve(__dirname, '../out')
const load = name => require(path.join(out, name))
const rooms = load('multi/room/manager'), pins = load('multi/coordinator/room-start-claims')
const contracts = load('multi/state/battle-contract')
const { RoomCommandExecutor } = load('multi/coordinator/command-executor')
const { RoomCommandGateway } = load('multi/coordinator/command-gateway')
const { createRoomCommandId } = load('multi/coordinator/command-protocol')
const { registerBattleCommandHandlers } = load('multi/coordinator/battle-command-handlers')
const { SessionManager } = load('multi/state/SessionManager')
global.setInterval = interval
let serial = 0
function fixture(t) {
    const room = { room_number: `claim-${++serial}`, category: 1, quest_id: 9001001, lobby_generation: 1,
        host_viewer_id: 1, host_player_id: 101, member_viewer_ids: [1, 2], member_player_ids: { 1: 101, 2: 102 },
        expected_real_viewer_ids: [1, 2], mates: [], raising_state: 4, equipmentPartyIds: { 1: 1, 2: 1 },
        lifecycle: { instanceId: `instance-${serial}`, battleSessionId: `run-${serial}`, phase: 'BATTLE', version: 3, sceneEpoch: 0 } }
    t.mock.method(rooms, 'getRoom', () => room)
    t.mock.method(rooms, 'setRoomBattle', () => true)
    contracts.ensureBattleSessionContract(room)
    const executor = new RoomCommandExecutor(); registerBattleCommandHandlers(executor)
    const gateway = new RoomCommandGateway(executor)
    const body = { room_number: room.room_number, viewer_id: 2, play_id: `play-${serial}`, category: 1, quest_id: 9001001,
        party_id: 1, mate_party_ids: [], client_battle_party: {}, mate_player_ids: [] }
    const command = { roomNumber: room.room_number, roomInstanceId: room.lifecycle.instanceId,
        battleSessionId: room.lifecycle.battleSessionId, playerId: 102, viewerId: 2, playId: body.play_id }
    const tokens = []
    t.after(async () => { for (const token of tokens) await gateway.execute('battle.play.cancel', { ...command, claimToken: token }); gateway.close() })
    const prepare = async (extra = {}, commandId = createRoomCommandId()) => {
        const result = await gateway.execute('battle.start.prepare', { body, playerId: 102, fixedParty: false, ...extra }, { commandId })
        if (result.claimToken) tokens.push(result.claimToken)
        return result
    }
    return { room, gateway, body, command, prepare }
}
test('parallel ordinary durable-start claims keep controls frozen until their own final decision', async t => {
    const x = fixture(t), first = await x.prepare(), second = await x.prepare(), controls = []
    assert.equal(first.status, 'ready'); assert.equal(second.status, 'ready')
    assert.notEqual(first.claimToken, second.claimToken)
    pins.deferPinnedRoomControl(x.room, () => controls.push('LevelNext'))
    pins.deferPinnedRoomControl(x.room, () => controls.push('SceneReady'))
    assert.throws(() => contracts.beginBattleSceneEpoch(x.room), /START_CLAIM_PENDING/)
    assert.equal(x.room.lifecycle.sceneEpoch, 0)
    await x.gateway.execute('battle.play.cancel', { ...x.command, claimToken: first.claimToken })
    assert.deepEqual(controls, []); assert.equal(pins.hasRoomStartClaims(x.room), true)
    assert.equal((await x.gateway.execute('battle.play.commit', { ...x.command, claimToken: second.claimToken })).applied, true)
    assert.deepEqual(controls, ['LevelNext', 'SceneReady']); assert.equal(pins.hasRoomStartClaims(x.room), false)
})
test('cancelling a timed-out attempt before delayed prepare prevents a later orphan pin', async t => {
    const x = fixture(t), prepareId = createRoomCommandId()
    await x.gateway.execute('battle.start.cancelAttempt', { prepareId, roomNumber: x.room.room_number, playerId: 102, viewerId: 2, playId: x.body.play_id })
    assert.equal((await x.prepare({}, prepareId)).status, 'unavailable')
    assert.equal(pins.hasRoomStartClaims(x.room), false)
    assert.equal(contracts.findBattlePlayBinding(x.room, 2, 102, x.body.play_id), undefined)
})
test('only exact durable instance/run proof reconciles prior uncertain ordinary commits', async t => {
    const x = fixture(t), first = await x.prepare()
    const wrong = await x.prepare({ durableStart: { ...x.command, battleSessionId: 'another-run' } })
    await x.gateway.execute('battle.play.cancel', { ...x.command, claimToken: wrong.claimToken })
    assert.equal(pins.hasRoomStartClaims(x.room), true)
    const recovered = await x.prepare({ durableStart: { roomInstanceId: x.command.roomInstanceId,
        battleSessionId: x.command.battleSessionId, playId: x.command.playId, playerId: 102, viewerId: 2 } })
    assert.equal((await x.gateway.execute('battle.play.cancel', { ...x.command, claimToken: first.claimToken })).applied, false)
    assert.equal(pins.hasRoomStartClaims(x.room), true, 'replacement claim is pinned before prior durable claims resolve')
    await x.gateway.execute('battle.play.commit', { ...x.command, claimToken: recovered.claimToken })
    assert.equal(pins.hasRoomStartClaims(x.room), false)
    assert.equal(contracts.getBattleSessionContract(x.room).members.get(2).playCommitted, true)
})
test('scene controls have a finite queue and one failed control cannot discard later accepted controls', t => {
    const room = {}, seen = [], errors = []
    t.mock.method(console, 'error', (...args) => errors.push(args))
    pins.pinRoomStart(room, 'claim')
    pins.deferPinnedRoomControl(room, () => { throw Error('control failed') })
    for (let i = 1; i < 64; i++) pins.deferPinnedRoomControl(room, () => seen.push(i))
    assert.throws(() => pins.deferPinnedRoomControl(room, () => seen.push(64)), /START_CONTROL_QUEUE_LIMIT/)
    pins.unpinRoomStart(room, 'claim')
    assert.equal(errors.length, 1); assert.deepEqual(seen, Array.from({ length: 63 }, (_, i) => i + 1))
    assert.equal(pins.deferPinnedRoomControl(room, () => {}), false)
})
test('a missing-seat timer cannot retire the seat or release BattleStart before durable start resolves', async t => {
    const x = fixture(t), scheduled = []
    t.mock.method(global, 'setTimeout', (fn, ms) => { const timer = { fn, ms, unref() {} }; scheduled.push(timer); return timer })
    t.mock.method(global, 'clearTimeout', () => {})
    class Socket extends EventEmitter {
        destroyed = false; writable = true; frames = []
        write(frame) { this.frames.push(JSON.parse(frame.replace(/\0$/, ''))); return true }
        destroy() { this.destroyed = true }
    }
    const manager = new SessionManager(), client = manager.createClient(new Socket(), 1, x.room.room_number, 'host', 101)
    client.isBattle = true; client.roomGeneration = 1
    manager.setBattleExpectedCount(x.room.room_number, 2, [{ viewerId: 1, connectionId: 'host' }, { viewerId: 2, connectionId: 'missing' }])
    assert.equal(manager.addBattleClient('host', client), true)
    assert.equal(manager.markSceneReady('host', x.room.room_number), false)
    pins.pinRoomStart(x.room, 'pending')
    const cycle = manager.battleBarrierCycles.get(x.room.room_number)
    manager.expireMissingBattleSeat(x.room.room_number, cycle, { viewerId: 2, connectionId: 'missing' })
    assert.equal(manager.battleExpectedCount.get(x.room.room_number), 2)
    assert.equal(manager.isBattleSeatRetired(x.room.room_number, 2), false)
    assert.deepEqual(client.socket.frames, [])
    pins.unpinRoomStart(x.room, 'pending')
    assert.equal(manager.isBattleSeatRetired(x.room.room_number, 2), true)
    assert.deepEqual(client.socket.frames, [[1, [1]], [1, [0, 'missing']]])
    assert.equal(manager.battleExpectedCount.get(x.room.room_number), 0)
})
