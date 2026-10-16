// Real-TCP simulation of a three-player five-boss battle against the session
// server: SceneReady barrier, battle frame relay, a LevelNext where one teammate
// keeps its socket open but never starts the next scene, and a mid-battle drop.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const net = require('node:net')
const { EventEmitter, once } = require('node:events')

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'startpoint-battle-sim-'))
process.env.DATA_DIR = dataDir
process.env.CLIENT_ADMISSION_CONFIG = path.join(dataDir, 'client-admission.json')
process.env.CLIENT_ADMISSION_KEYS = path.join(dataDir, 'client-admission.keys.json')
fs.writeFileSync(process.env.CLIENT_ADMISSION_CONFIG, JSON.stringify({ enforce: false, updateMessage: 'sim', builds: [] }))
fs.writeFileSync(process.env.CLIENT_ADMISSION_KEYS, '{}')
process.env.BATTLE_LEVEL_NEXT_DEADLINE_MS = '10000'
process.env.BATTLE_BARRIER_RECONNECT_GRACE_MS = '1000'
process.env.SESSION_PORT = '0'
process.env.SESSION_HOST = '127.0.0.1'

const out = path.resolve(__dirname, '../out')
const load = name => require(path.join(out, name))
const originalInterval = global.setInterval
global.setInterval = (...args) => { const timer = originalInterval(...args); timer.unref(); return timer }
const accounts = load('data/domains/account')
const players = load('data/domains/player')
const items = load('data/domains/item')
const runtime = load('multi/five-boss/battle-runtime')
const { FIVE_BOSS_GAUNTLET: mode } = load('multi/five-boss/contract')
const rooms = load('multi/room/manager')
const manager = load('multi/state/SessionManager').sessionManager
const coordinator = load('multi/coordinator/embedded').embeddedMultiCoordinator
const { battleTelemetry } = load('multi/battle-telemetry')
global.setInterval = originalInterval

let sequence = 0
function player() {
    const id = ++sequence
    const account = accounts.insertAccountSync({ appId: 'wf_cn', idpAlias: '', idpCode: 'test', idpId: `sim-${id}`, status: 'normal' })
    const p = players.insertDefaultPlayerSync(account.id)
    load('data/activeAccount').saveAccountDefaultPlayer(account.id, p.id)
    players.updatePlayerSync({ id: p.id, stamina: 100, staminaHealTime: new Date() })
    items.setPlayerItemSync(p.id, mode.ticketItemId, 2)
    load('lib/character').givePlayerCharacterSync(p.id, 111001)
    return { ...p, viewerId: 782000000 + id, playId: `sim-play-${id}`, connectionId: `sim-cid-${id}` }
}

function fakeLobbySocket() {
    const socket = new EventEmitter()
    return Object.assign(socket, { remoteAddress: '127.0.0.1', readable: true, writable: true, destroyed: false,
        write: () => true, end: () => {}, destroy() { socket.destroyed = true } })
}

class SimClient {
    constructor(port, member, room) {
        this.member = member; this.room = room; this.frames = []; this.buffer = ''; this.closed = false
        this.socket = net.createConnection({ host: '127.0.0.1', port })
        this.socket.setEncoding('utf8')
        this.socket.on('data', chunk => {
            this.buffer += chunk
            let index
            while ((index = this.buffer.indexOf('\0')) >= 0) {
                const raw = this.buffer.slice(0, index); this.buffer = this.buffer.slice(index + 1)
                if (raw) this.frames.push({ at: performance.now(), data: JSON.parse(raw) })
            }
        })
        this.socket.on('close', () => { this.closed = true })
        this.socket.on('error', () => {})
    }
    async open() {
        await once(this.socket, 'connect')
        this.send({ socklet: 'cooperation_battle', room_number: this.room.room_number, connection_id: this.member.connectionId })
        await this.until(() => this.frames.some(frame => frame.data[0] === 0))
    }
    send(data) { this.socket.write(JSON.stringify(data) + '\0') }
    sceneReady() { this.send([0, [0]]) }
    levelNext() { this.send([0, [1]]) }
    battleStarts() { return this.frames.filter(frame => JSON.stringify(frame.data) === '[1,[1]]').length }
    leaves() { return this.frames.filter(frame => frame.data[0] === 1 && frame.data[1]?.[0] === 0).map(frame => frame.data[1][1]) }
    async until(condition, timeoutMs = 5000) {
        const deadline = Date.now() + timeoutMs
        while (!condition()) {
            if (Date.now() > deadline) throw new Error(`condition not met within ${timeoutMs}ms`)
            await new Promise(resolve => setTimeout(resolve, 5))
        }
    }
}

function percentile(values, p) {
    const sorted = [...values].sort((a, b) => a - b)
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]
}

async function startFiveBossBattle(relayProcess) {
    process.env.MULTI_BATTLE_RELAY_PROCESS = relayProcess ? '1' : '0'
    const members = [player(), player(), player()]
    const [host] = members
    const room = rooms.createRoom(host.viewerId, host.id, 1, mode.category, mode.visibleQuestId, 0, 111001)
    room.raising_state = 4
    room.mates = members.map(m => ({ viewer_id: m.viewerId, player_id: m.id, com_id: 0 }))
    room.member_viewer_ids = members.map(m => m.viewerId)
    room.member_player_ids = Object.fromEntries(members.map(m => [m.viewerId, m.id]))
    room.five_boss_runtime = { runId: `sim-run-${Date.now()}`, expectedRealPlayerIds: members.map(m => m.id),
        autoplayModeByPlayerId: Object.fromEntries(members.map(m => [m.id, false])),
        partyCharacterIdsByPlayerId: Object.fromEntries(members.map(m => [m.id, [111001]])),
        battleIdentityByViewerId: Object.fromEntries(members.map(m => [String(m.viewerId),
            { playerId: m.id, remoteAddress: '127.0.0.1', connectionId: m.connectionId }])) }
    for (const m of members) {
        runtime.startFiveBossBattle({ playerId: m.id, clientPlayId: m.playId, requestRoomNumber: room.room_number,
            requestCategory: mode.category, requestQuestId: mode.visibleQuestId, room,
            useBoostPoint: false, useBossBoostPoint: false, httpIsAutoStartMode: true })
    }
    assert.equal(coordinator.commitBattleStart(room).ok, true)
    const lobbyClients = members.map(m => {
        const client = manager.createClient(fakeLobbySocket(), m.viewerId, room.room_number, m.connectionId, m.id)
        client.roomGeneration = room.lobby_generation
        manager.addClientToRoom(client)
        return client
    })
    manager.setBattleExpectedCount(room.room_number, 3,
        members.map(m => ({ viewerId: m.viewerId, connectionId: m.connectionId })))

    const originalCreateServer = net.createServer
    let rawServer
    net.createServer = (...args) => { rawServer = originalCreateServer(...args); return rawServer }
    const tcp = load('multi/tcp/server')
    await tcp.startSessionServer()
    net.createServer = originalCreateServer
    const port = rawServer.address().port
    const lines = []
    const originalWarn = console.warn
    console.warn = (...args) => { lines.push(args.join(' ')) }
    const sims = members.map(m => new SimClient(port, m, room))
    const cleanup = async () => {
        console.warn = originalWarn
        for (const sim of sims) sim.socket.destroy()
        await tcp.stopSessionServer()
        for (const client of lobbyClients) manager.removeClient(client)
        rooms.disbandRoom(room.room_number)
        battleTelemetry.end(room.room_number, 'cleanup')
    }
    await Promise.all(sims.map(sim => sim.open()))
    for (const sim of sims) sim.sceneReady()
    await Promise.all(sims.map(sim => sim.until(() => sim.battleStarts() === 1)))
    return { members, room, sims, lines, originalWarn, cleanup }
}

for (const relayProcess of [false, true]) {
const label = relayProcess ? ' (relay process)' : ''

test(`five-boss: relay latency, then a silent teammate cannot stall the next scene${label}`, { timeout: 60000 }, async () => {
    const { members, room, sims, lines, cleanup } = await startFiveBossBattle(relayProcess)
    try {

        // Start just after a real telemetry sample. A stall ending on the
        // one-second reset boundary can be erased before the native histogram
        // records it; preserve the real sampler and control only test timing.
        const sampleLag = battleTelemetry.sampleLag
        let sampleTimeout
        try {
            await new Promise((resolve, reject) => {
                sampleTimeout = setTimeout(() => reject(new Error('telemetry sampler did not run')), 3000)
                battleTelemetry.sampleLag = function () { sampleLag.call(this); resolve() }
            })
        } finally {
            battleTelemetry.sampleLag = sampleLag
            clearTimeout(sampleTimeout)
        }
        // ~30 frames/s per player for 1.5 s; block after the 10 ms histogram
        // has resumed, well before its next one-second reset.
        const sent = new Map()
        let seq = 0
        const ticker = originalInterval(() => {
            for (const sim of sims) {
                const id = ++seq
                sent.set(id, performance.now())
                sim.send([1, [[0, id]]])
            }
        }, 33)
        setTimeout(() => { const until = performance.now() + 300; while (performance.now() < until); }, 50)
        await new Promise(resolve => setTimeout(resolve, 1500))
        clearInterval(ticker)
        await new Promise(resolve => setTimeout(resolve, 200))
        const latencies = []
        for (const sim of sims) {
            for (const frame of sim.frames) {
                if (frame.data[0] !== 2) continue
                const id = frame.data[2]?.[0]?.[1]
                if (sent.has(id)) latencies.push(frame.at - sent.get(id))
            }
        }
        assert.ok(latencies.length >= sent.size * 2 * 0.95, `relayed ${latencies.length} of ${sent.size * 2}`)
        console.log(`[SIM] relay frames=${latencies.length} p50=${percentile(latencies, 0.5).toFixed(1)}ms`
            + ` p99=${percentile(latencies, 0.99).toFixed(1)}ms max=${Math.max(...latencies).toFixed(1)}ms`)

        // Next scene: two players move on, the third stays connected but silent.
        const [a, b, c] = sims
        const startedAt = Date.now()
        a.levelNext(); b.levelNext()
        await new Promise(resolve => setTimeout(resolve, 100))
        a.sceneReady(); b.sceneReady()
        await new Promise(resolve => setTimeout(resolve, 3000))
        assert.equal(a.battleStarts(), 1, 'the next scene waits for the third member at first')
        await a.until(() => a.battleStarts() === 2, 15000)
        await b.until(() => b.battleStarts() === 2, 1000)
        const waitedMs = Date.now() - startedAt
        console.log(`[SIM] next scene released after ${waitedMs}ms without the silent member`)
        assert.ok(waitedMs >= 10000 && waitedMs < 14000, `released after ${waitedMs}ms`)
        await c.until(() => c.closed, 1000)
        assert.deepEqual(a.leaves(), [members[2].connectionId])
        assert.deepEqual(b.leaves(), [members[2].connectionId])

        // Battle end produces one summary line with populated members.
        coordinator.commitDisband(room, 'sim_end')
        const line = lines.find(value => value.startsWith('[MULTI-BATTLE]'))
        assert.ok(line, 'battle summary emitted')
        const summary = JSON.parse(line.slice('[MULTI-BATTLE] '.length))
        console.log(`[SIM] ${line}`)
        assert.equal(summary.fiveBoss, true)
        assert.equal(summary.members.length, 3)
        const silent = summary.members.find(m => m.viewer === members[2].viewerId)
        assert.deepEqual(silent.disconnects, { level_next_timeout: 1 })
        assert.equal(silent.levelNext, 0)
        const mover = summary.members.find(m => m.viewer === members[0].viewerId)
        assert.equal(mover.levelNext, 1)
        assert.equal(mover.sceneReady, 2)
        assert.ok(mover.broadcasts > 30)
        assert.ok(mover.relayedOut > 60)
        assert.ok(summary.loopLagMaxMs >= 200, `loop lag ${summary.loopLagMaxMs}`)
        assert.ok(summary.barriers.some(barrier => barrier.kind === 'next_scene' && barrier.waitMs >= 10000))
        assert.equal(summary.seatsExpired, 1)
    } finally {
        await cleanup()
    }
})

test(`five-boss: a teammate dropping mid-battle reaches the others as Leave at once${label}`, { timeout: 30000 }, async () => {
    const { members, room, sims, lines, cleanup } = await startFiveBossBattle(relayProcess)
    try {
        const [a, b, c] = sims
        const droppedAt = performance.now()
        c.socket.destroy()
        await a.until(() => a.leaves().length === 1, 2000)
        await b.until(() => b.leaves().length === 1, 2000)
        console.log(`[SIM] Leave delivered ${(performance.now() - droppedAt).toFixed(1)}ms after the drop`)
        assert.deepEqual(a.leaves(), [members[2].connectionId])
        assert.deepEqual(b.leaves(), [members[2].connectionId])
        // A finished member closing after Finalized is not a disconnect.
        b.send([0, [2]])
        await b.until(() => b.frames.some(frame => JSON.stringify(frame.data) === '[1,[2]]'))
        b.socket.destroy()
        await new Promise(resolve => setTimeout(resolve, 300))
        assert.deepEqual(a.leaves(), [members[2].connectionId])
        coordinator.commitDisband(room, 'sim_end')
        const summary = JSON.parse(lines.find(value => value.startsWith('[MULTI-BATTLE]')).slice(15))
        assert.equal(summary.members.find(m => m.viewer === members[1].viewerId).finalize, 1)
    } finally {
        await cleanup()
    }
})
}

test('five-boss: a crashed relay process closes its battle sockets and is restarted', { timeout: 30000 }, async () => {
    const { members, room, sims, lines, cleanup } = await startFiveBossBattle(true)
    const { battleRelayBridge } = load('multi/tcp/battle-relay/bridge')
    try {
        assert.equal(battleRelayBridge.activeSockets, 3)
        battleRelayBridge['child'].kill('SIGKILL')
        await Promise.all(sims.map(sim => sim.until(() => sim.closed, 3000)))
        await sims[0].until(() => battleRelayBridge.isReady, 5000)
        assert.equal(battleRelayBridge.activeSockets, 0)
        coordinator.commitDisband(room, 'sim_end')
        const summary = JSON.parse(lines.find(value => value.startsWith('[MULTI-BATTLE]')).slice(15))
        for (const member of members) {
            assert.deepEqual(summary.members.find(m => m.viewer === member.viewerId).disconnects, { relay_exit: 1 })
        }
    } finally {
        await cleanup()
    }
})

test.after(async () => {
    // The simulations start no SQLite workers; their relay children and TCP
    // sockets are stopped in each test's finally block. Drain queued proof
    // writes and close the one database before Windows removes its files.
    await load('lib/persistence-coordinator').drainPersistence()
    const db = load('data/db').getDb()
    if (db.open) db.close()
    const resolved = fs.realpathSync(dataDir)
    assert.equal(path.dirname(resolved), fs.realpathSync(os.tmpdir()))
    fs.rmSync(resolved, { recursive: true, force: true })
})
