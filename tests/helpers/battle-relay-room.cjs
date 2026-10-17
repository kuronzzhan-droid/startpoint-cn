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
process.env.BATTLE_BARRIER_RECONNECT_GRACE_MS = '10000'
process.env.MULTI_BATTLE_RELAY_MAX_RESTARTS = '1'
process.env.SESSION_PORT = '0'
process.env.SESSION_HOST = '127.0.0.1'

const out = path.resolve(__dirname, '../../out')
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
const activeCleanups = new Set()
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
        this.broadcastsSent = 0
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
    send(data) {
        this.socket.write(JSON.stringify(data) + '\0')
        if (Array.isArray(data) && data[0] === 1) this.broadcastsSent++
    }
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

async function startFiveBossBattle(options = {}) {
    process.env.MULTI_BATTLE_RELAY_PROCESS = options.mixed ? '0' : '1'
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
    const tcp = load('multi/tcp/server')
    const lines = []
    const originalWarn = console.warn
    const sims = []
    let cleaned = false
    const cleanup = async () => {
        if (cleaned) return
        cleaned = true
        console.warn = originalWarn
        for (const sim of sims) sim.socket.destroy()
        await tcp.stopSessionServer()
        await coordinator.enqueueRoomCommand(room.room_number, () => {
            for (const client of lobbyClients) manager.removeClient(client)
            rooms.disbandRoom(room.room_number)
            battleTelemetry.end(room.room_number, 'cleanup')
        })
        activeCleanups.delete(cleanup)
    }
    activeCleanups.add(cleanup)
    try {
        net.createServer = (...args) => { rawServer = originalCreateServer(...args); return rawServer }
        try { await tcp.startSessionServer() }
        finally { net.createServer = originalCreateServer }
        const port = rawServer.address().port
        console.warn = (...args) => { lines.push(args.join(' ')) }
        if (options.mixed) {
            sims.push(new SimClient(port, members[0], room)); await sims[0].open()
            await load('multi/tcp/battle-relay/bridge').battleRelayBridge.start()
            for (const member of members.slice(1)) { const sim = new SimClient(port, member, room); sims.push(sim); await sim.open() }
        } else {
            sims.push(...members.map(m => new SimClient(port, m, room)))
            await Promise.all(sims.map(sim => sim.open()))
        }
        for (const sim of sims) sim.sceneReady()
        await Promise.all(sims.map(sim => sim.until(() => sim.battleStarts() === 1)))
        return { members, room, sims, lines, originalWarn, cleanup, port }
    } catch (error) {
        await cleanup()
        throw error
    }
}


module.exports = { startFiveBossBattle, SimClient, load, manager, rooms, coordinator, battleTelemetry }
test.after(async () => {
    try {
        for (const cleanup of [...activeCleanups]) await cleanup()
        await load('multi/tcp/server').stopSessionServer()
        await load('lib/persistence-coordinator').drainPersistence()
        await load('multi/npc/player-party-pool').stopQuestNpcPartyPoolWorker()
    } finally {
        const db = load('data/db').getDb()
        if (db.open) db.close()
        const resolved = fs.realpathSync(dataDir)
        if (path.dirname(resolved) !== fs.realpathSync(os.tmpdir())
            || !path.basename(resolved).startsWith('startpoint-battle-sim-')) {
            throw new Error(`Refusing to remove unexpected test directory: ${resolved}`)
        }
        fs.rmSync(resolved, { recursive: true, maxRetries: 5, retryDelay: 100 })
    }
})
