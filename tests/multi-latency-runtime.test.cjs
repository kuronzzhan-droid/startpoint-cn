// Formal session server/bridge/child, fresh test identities and a random
// loopback port. Does not launch cn-server or touch the local game database.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const net = require('node:net')
const { EventEmitter } = require('node:events')
const { runProbe } = require('../tools/multiplayer-latency-probe.cjs')
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'starpoint-latency-runtime-'))
process.env.DATA_DIR = dataDir
process.env.CLIENT_ADMISSION_CONFIG = path.join(dataDir, 'admission.json')
process.env.CLIENT_ADMISSION_KEYS = path.join(dataDir, 'keys.json')
process.env.SESSION_HOST = '127.0.0.1'
process.env.SESSION_PORT = '0'
fs.writeFileSync(process.env.CLIENT_ADMISSION_CONFIG, JSON.stringify({ enforce: false, updateMessage: 'isolated latency test', builds: [] }))
fs.writeFileSync(process.env.CLIENT_ADMISSION_KEYS, '{}')
const out = process.env.STARPOINT_TEST_OUT_DIR || path.resolve(__dirname, '../out')
const load = file => require(path.join(out, file))
const realInterval = global.setInterval
global.setInterval = (...args) => { const timer = realInterval(...args); timer.unref(); return timer }
const manager = load('multi/state/SessionManager').sessionManager
const rooms = load('multi/room/manager')
const coordinator = load('multi/coordinator/embedded').embeddedMultiCoordinator
const telemetry = load('multi/battle-telemetry').battleTelemetry
const bridge = load('multi/tcp/battle-relay/bridge').battleRelayBridge
const tcp = load('multi/tcp/server')
global.setInterval = realInterval

function lobbySocket() {
    const socket = new EventEmitter()
    return Object.assign(socket, { remoteAddress: '127.0.0.1', readable: true, writable: true, destroyed: false,
        write: () => true, end: () => {}, destroy() { socket.destroyed = true } })
}

for (const route of ['parent', 'allchild', 'mixed']) test(`formal TCP ${route}: RTT echo and exact business fanout measured separately`, async () => {
    process.env.MULTI_BATTLE_RELAY_PROCESS = route === 'allchild' ? '1' : '0'
    const ids = [0, 1, 2].map(seat => `latency-${route}-${seat}`)
    const viewers = [836001000, 836001001, 836001002]
    const room = rooms.createRoom(viewers[0], 1, 1, 2, 1033003, 0, 111001)
    room.mates = viewers.map(viewer => ({ viewer_id: viewer, player_id: null, com_id: 0 }))
    room.member_viewer_ids = viewers
    room.member_player_ids = {} // The dedicated protocol seats intentionally have no saved players.
    assert.equal(coordinator.commitBattleStart(room).ok, true)
    const lobbyClients = viewers.map((viewer, seat) => {
        const client = manager.createClient(lobbySocket(), viewer, room.room_number, ids[seat], null)
        client.roomGeneration = room.lobby_generation
        manager.addClientToRoom(client)
        return client
    })
    telemetry.begin(room)
    manager.setBattleExpectedCount(room.room_number, 3, viewers.map((viewer, seat) => ({ viewerId: viewer, connectionId: ids[seat] })))
    let server, ownership
    const originalCreateServer = net.createServer
    net.createServer = (...args) => { server = originalCreateServer(...args); return server }
    try {
        await tcp.startSessionServer()
    } finally { net.createServer = originalCreateServer }
    try {
        const result = await runProbe({ acknowledgeTestIdentities: true, host: '127.0.0.1', port: server.address().port,
            room: room.room_number, connectionIds: ids, route, phase: 'formal-isolated-battle',
            sceneReady: true, samples: 8, intervalMs: 40, timeoutMs: 2000 }, {
            beforeConnect: route === 'mixed' ? async seat => { if (seat === 1) { process.env.MULTI_BATTLE_RELAY_PROCESS = '1'; await bridge.start() } } : undefined,
            afterHandshake: () => {
                ownership = { proxyCount: bridge.activeSockets, ready: bridge.isReady }
                assert.equal(ownership.proxyCount, route === 'allchild' ? 3 : route === 'mixed' ? 2 : 0)
            },
        })
        assert.equal(result.complete, true)
        assert.match(result.routeEvidence, /not independently verified/)
        assert.equal(result.measurements.reduce((n, m) => n + m.success, 0), 24)
        assert.equal(result.businessDeliveries.reduce((n, d) => n + d.success, 0), 48)
        for (const measurement of result.measurements) { assert.equal(measurement.genericIgnored, 16); assert.equal(measurement.pending, 0); assert.equal(measurement.timeout, 0) }
        for (const delivery of result.businessDeliveries) { assert.equal(delivery.deliveryWaitMs.count, 8); assert.equal(delivery.rttMs, undefined); assert.equal(delivery.duplicate, 0) }
        assert.deepEqual(result.counters, { outOfOrder: 0, sequenceGapObservations: 0, unexpectedData: 0, invalidData: 0, socketErrors: 0, unexpectedCloses: 0 })
        if (route !== 'parent') {
            const deadline = performance.now() + 3000
            while (!bridge.diagnostics().child?.routes && performance.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20))
            const observedRoutes = bridge.diagnostics().child?.routes
            assert.ok(observedRoutes, 'formal child published route diagnostics')
            if (route === 'allchild') { assert.equal(observedRoutes.local, 24); assert.equal(observedRoutes.mixed, 0) }
            else {
                assert.equal(observedRoutes.local, 0)
                assert.ok(observedRoutes.mixed > 0, 'native member forced business traffic to parent')
                assert.equal(observedRoutes.mixed + observedRoutes.controlGated + observedRoutes.snapshotGated, 16,
                    'all child-origin business frames classified; pending room control can gate the other source')
            }
            // local/mixed counters count only Broadcast/Send. parent also counts
            // control chunks, so it must not be used as a business-frame count.
        }
    } finally {
        await tcp.stopSessionServer()
        for (const client of lobbyClients) manager.removeClient(client)
        rooms.disbandRoom(room.room_number)
        telemetry.end(room.room_number, 'latency-test-cleanup')
    }
    assert.equal(bridge.activeSockets, 0)
})

test.after(async () => {
    await tcp.stopSessionServer()
    await load('lib/persistence-coordinator').drainPersistence()
    await load('multi/npc/player-party-pool').stopQuestNpcPartyPoolWorker()
    const db = load('data/db').getDb()
    if (db.open) db.close()
    const resolved = fs.realpathSync(dataDir)
    if (path.dirname(resolved) !== fs.realpathSync(os.tmpdir()) || !path.basename(resolved).startsWith('starpoint-latency-runtime-')) throw Error('Unexpected temporary test directory')
    fs.rmSync(resolved, { recursive: true, maxRetries: 5, retryDelay: 100 })
})
