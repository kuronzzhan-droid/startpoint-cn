const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const Module = require('node:module')
const { EventEmitter } = require('node:events')
const { setTimeout: sleep } = require('node:timers/promises')
const output = process.env.LENS_BUILD_OUT || path.resolve(__dirname, '../out')
const load = name => require(path.join(output, name))
process.env.MULTI_REALTIME_OWNER_CHILD = '1'
process.env.MULTI_REALTIME_PROCESS = '0'
process.env.MULTI_AI_FILL_TIMEOUT_MS = '20'
process.env.NPC_JOIN_DELAY_MS = '5'
process.env.NPC_READY_DELAY_MS = '5'

// Keep actual room queues, ALS admission, real Timer resources and NPC roster
// handling. Replace only content/data results; never open a player database.
const originalLoad = Module._load
Module._load = function (request, parent, main) {
    const resolved = Module._resolveFilename(request, parent)
    if (resolved === path.join(output, 'data/db.js')) throw Error('AI admission fixture must not open a database')
    if (resolved === path.join(output, 'lib/assets.js')) return { getQuestFromCategorySync: () => undefined }
    return originalLoad.call(this, request, parent, main)
}
const intervals = [], originalInterval = global.setInterval
global.setInterval = (...args) => { const timer = originalInterval(...args); timer.unref(); intervals.push(timer); return timer }
const rooms = load('multi/room/manager')
const session = load('multi/state/SessionManager').sessionManager
const lobby = load('multi/tcp/lobby')
const fallback = load('multi/ai-fill')
const rpc = load('multi/coordinator/business-rpc')
const admission = load('multi/coordinator/parent-business-admission')
const shutdown = load('lib/shutdown-state')
global.setInterval = originalInterval
const errors = [], scopes = new Map(), calls = []
const originalError = console.error
console.error = (...args) => errors.push(args.map(value => value?.code || value?.message || String(value)).join(' '))
let sequence = 0, revision = 0, requestSequence = 0
const party = { characters: [], equipments: [], abilitySoulIds: [] }
function business(kind, payload) {
    calls.push({ kind, playerId: payload.playerId, hasProof: rpc.getRealtimeBusinessAdmission() !== undefined })
    if (kind === 'player.facts') return {
        parentEpoch: 'ai-test-parent', revision: ++revision, playerId: payload.playerId,
        viewerId: payload.playerId, expiresAt: Date.now() + 60000,
        category: payload.category, questId: payload.questId, partyId: 1,
        player: { name: 'fixture', rank: 1, degreeId: 0, leaderCharacterId: 0, role: 0, tutorialStep: 0, partySlot: 1 },
        party, ownedCharacterIds: [], restrictedEquipment: false,
        guestEligibility: { allowed: true }, questNpcPartySnapshot: null,
        questPolicy: { isMode15: false, equipmentAllowed: false, hostAllowed: true, exclusiveItemIds: [] },
    }
    if (kind === 'npc.mates' || kind === 'npc.parties') return []
    if (kind === 'presence.touch') return null
    throw Error(`Unexpected fixture business: ${kind}`)
}
rpc.installRealtimeBusinessTransport(async (kind, payload) => {
    if (kind === '__tcp_work_begin__') {
        const scope = admission.createAcceptedRealtimeBusinessScope({ ownerEpoch: 'ai-test-owner', commandId: payload.workId })
        scopes.set(payload.workId, scope)
        return scope.proof
    }
    if (kind === '__tcp_work_end__') {
        const scope = scopes.get(payload.workId)
        assert.ok(scope); assert.deepEqual(payload.proof, scope.proof)
        scope.release(); scopes.delete(payload.workId)
        return null
    }
    const operation = async () => business(kind, payload)
    const proof = rpc.getRealtimeBusinessAdmission()
    if (proof !== undefined) return admission.dispatchAcceptedRealtimeBusiness(proof, operation)
    const fresh = admission.createAcceptedRealtimeBusinessScope({ ownerEpoch: 'ai-test-owner', commandId: `background.${++requestSequence}` })
    try { return await fresh.run(operation) } finally { fresh.release() }
})
class Socket extends EventEmitter {
    destroyed = false; readable = true; writable = true; frames = []
    write(value) { this.frames.push(JSON.parse(value.replace(/\0$/, ''))); return true }
    destroy() { this.destroyed = true; this.readable = this.writable = false }
    end() { this.destroy() }
}
function fixture(t, realCount = 1, npc = true) {
    const viewerId = 983000 + (++sequence) * 10
    const room = rooms.createRoom(viewerId, viewerId, 1, 2, 1001002, 1, 1)
    room.is_npc_mode = npc
    const clients = []
    for (let index = 0; index < realCount; index++) {
        const id = viewerId + index
        const client = session.createClient(new Socket(), id, room.room_number, `ai-fixture-${id}`, id)
        client.roomGeneration = room.lobby_generation
        client.enterData = []
        client.yourself = { viewerId: id, playerId: id, connectionId: client.connectionId, comId: 0,
            state: [0], autoStart: false, currentPartyId: 1, party }
        assert.equal(session.addClientToRoom(client).ok, true)
        if (index) rooms.addRoomMember(room.room_number, id, id)
        clients.push(client)
    }
    const mates = clients.map(client => client.yourself)
    clients.forEach(client => { client.mates = mates })
    room.mates = mates.map(mate => ({ viewer_id: mate.viewerId, player_id: mate.playerId, com_id: 0 }))
    t.after(() => {
        fallback.cancelAiFallback(room.room_number)
        rooms.disbandRoom(room.room_number, 'ai_admission_test_cleanup')
        clients.forEach(client => { session.removeClient(client); client.socket.destroy() })
    })
    return { room, clients, host: clients[0] }
}
const countAi = client => client.mates.filter(mate => mate.comId).length
async function until(predicate) {
    const deadline = Date.now() + 1200
    while (!predicate() && Date.now() < deadline) await sleep(5)
    assert.ok(predicate(), `AI condition not reached: ${errors.slice(-3).join('; ')}`)
}
test('released share command fills two AI seats through a fresh parent admission', async t => {
    const { room, host } = fixture(t, 1, false)
    const scope = admission.createAcceptedRealtimeBusinessScope({ ownerEpoch: 'ai-test-owner', commandId: 'share.room' })
    rpc.runWithRealtimeBusinessAdmission(scope.proof, () => fallback.scheduleAiFallback(room.room_number))
    scope.release()
    await until(() => countAi(host) === 2 && host.mates.filter(mate => mate.comId && mate.state[0] === 1).length === 2)
    assert.equal(fallback.hasAiFallback(room.room_number), false)
    assert.ok(calls.some(call => call.playerId === room.host_player_id && call.kind === 'player.facts' && !call.hasProof))
})
test('ended TCP frame does not prevent delayed NPC reconciliation', async t => {
    const { room, host } = fixture(t)
    await rpc.runWithTcpBusinessAdmission(() => lobby.scheduleNpcReconcile(room.room_number, 20))
    assert.equal(scopes.size, 0)
    await until(() => countAi(host) === 2)
})
test('delayed reconciliation keeps both real players and fills only one AI seat', async t => {
    const { room, host, clients } = fixture(t, 2)
    await rpc.runWithTcpBusinessAdmission(() => lobby.scheduleNpcReconcile(room.room_number, 20))
    await until(() => countAi(host) === 1)
    assert.deepEqual(host.mates.filter(mate => !mate.comId).map(mate => mate.viewerId).sort(), clients.map(client => client.viewerId).sort())
})
test('Enter restores AI after the original TCP frame has ended', async t => {
    // Leave Timer resources real, but hold the independent 100ms reconcile
    // long enough to witness Enter's own 500ms restoration path.
    const actualTimeout = global.setTimeout
    t.mock.method(global, 'setTimeout', (operation, delay, ...args) =>
        actualTimeout(operation, delay === 100 ? 1000 : delay, ...args))
    const { host } = fixture(t)
    const started = Date.now()
    await rpc.runWithTcpBusinessAdmission(() => lobby.handleMessage(host.socket, [0, [0, {}, 1]]))
    assert.equal(scopes.size, 0)
    await until(() => countAi(host) === 2)
    assert.ok(Date.now() - started >= 450, 'Enter timer, rather than earlier reconciliation, restored AI')
})
test('host readiness retry obtains fresh admission after the initiating TCP frame', async t => {
    const { room, host } = fixture(t)
    const yourself = host.yourself
    host.yourself = undefined
    await rpc.runWithTcpBusinessAdmission(() => lobby.recruitNpcMatesForRoom(room.room_number))
    assert.equal(scopes.size, 0)
    host.yourself = yourself
    await until(() => countAi(host) === 2)
})
test('fallback from a replaced room instance cannot recruit AI', async t => {
    const { room, host } = fixture(t, 1, false)
    const callCount = calls.length
    fallback.scheduleAiFallback(room.room_number)
    room.lifecycle.instanceId = 'replacement-instance'
    await sleep(60)
    assert.equal(countAi(host), 0)
    assert.equal(calls.length, callCount)
})
test('NPC reconciliation from an older lobby generation cannot recruit AI', async t => {
    const { room, host } = fixture(t)
    const callCount = calls.length
    lobby.scheduleNpcReconcile(room.room_number, 20)
    room.lobby_generation++
    await sleep(60)
    assert.equal(countAi(host), 0)
    assert.equal(calls.length, callCount)
})
test('ordinary detached TCP business still rejects the ended frame', async () => {
    let later
    await rpc.runWithTcpBusinessAdmission(() => {
        later = new Promise((resolve, reject) => setTimeout(() => rpc.invokeRealtimeBusiness('presence.touch', {}).then(resolve, reject), 20))
        later.catch(() => {})
    })
    await assert.rejects(later, /TCP_BUSINESS_WORK_ENDED/)
})
test('ordinary delayed command proof still rejects a released scope', async () => {
    const scope = admission.createAcceptedRealtimeBusinessScope({ ownerEpoch: 'ai-test-owner', commandId: 'released.proof' })
    const later = rpc.runWithRealtimeBusinessAdmission(scope.proof, () => new Promise((resolve, reject) =>
        setTimeout(() => rpc.invokeRealtimeBusiness('presence.touch', {}).then(resolve, reject), 20)))
    later.catch(() => {})
    scope.release()
    await assert.rejects(later, /REALTIME_BUSINESS_ADMISSION_INVALID/)
})
test('server shutdown denies fresh delayed AI work rather than extending old admission', async t => {
    const { room, host } = fixture(t, 1, false)
    const callCount = calls.length, errorCount = errors.length
    const scope = admission.createAcceptedRealtimeBusinessScope({ ownerEpoch: 'ai-test-owner', commandId: 'before.shutdown' })
    rpc.runWithRealtimeBusinessAdmission(scope.proof, () => fallback.scheduleAiFallback(room.room_number))
    scope.release()
    shutdown.beginServerShutdown()
    await sleep(60)
    assert.equal(countAi(host), 0)
    assert.equal(calls.length, callCount)
    assert.ok(errors.slice(errorCount).some(error => error.includes('SERVER_CLOSING')))
    await shutdown.drainServerWork()
    assert.equal(scopes.size, 0)
})
after(() => {
    for (const scope of scopes.values()) scope.release()
    intervals.forEach(clearInterval)
    console.error = originalError
    Module._load = originalLoad
})
