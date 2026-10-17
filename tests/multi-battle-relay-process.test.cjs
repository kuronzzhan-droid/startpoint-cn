// Battle relay child (MULTI_BATTLE_RELAY_PROCESS=1): three real-TCP clients in a
// separate process exchange ~30 frames/s while the server's main event loop is
// blocked for one second, as a long synchronous settlement would. In-process,
// every frame sent during the block waits for it; with the relay child, frames
// keep flowing within the lockstep jitter budget (~250 ms).
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const net = require('node:net')
const { EventEmitter, once } = require('node:events')
const { fork } = require('node:child_process')

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'startpoint-battle-relay-'))
process.env.DATA_DIR = dataDir
process.env.CLIENT_ADMISSION_CONFIG = path.join(dataDir, 'client-admission.json')
process.env.CLIENT_ADMISSION_KEYS = path.join(dataDir, 'client-admission.keys.json')
fs.writeFileSync(process.env.CLIENT_ADMISSION_CONFIG, JSON.stringify({ enforce: false, updateMessage: 'sim', builds: [] }))
fs.writeFileSync(process.env.CLIENT_ADMISSION_KEYS, '{}')
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
const { battleRelayBridge } = load('multi/tcp/battle-relay/bridge')
global.setInterval = originalInterval

const BLOCK_AT_MS = 500
const BLOCK_MS = 1000

let sequence = 0
function player() {
    const id = ++sequence
    const account = accounts.insertAccountSync({ appId: 'wf_cn', idpAlias: '', idpCode: 'test', idpId: `relay-${id}`, status: 'normal' })
    const p = players.insertDefaultPlayerSync(account.id)
    load('data/activeAccount').saveAccountDefaultPlayer(account.id, p.id)
    players.updatePlayerSync({ id: p.id, stamina: 100, staminaHealTime: new Date() })
    items.setPlayerItemSync(p.id, mode.ticketItemId, 2)
    load('lib/character').givePlayerCharacterSync(p.id, 111001)
    return { ...p, viewerId: 783000000 + id, playId: `relay-play-${id}`, connectionId: `relay-cid-${id}` }
}

function fakeLobbySocket() {
    const socket = new EventEmitter()
    return Object.assign(socket, { remoteAddress: '127.0.0.1', readable: true, writable: true, destroyed: false,
        write: () => true, end: () => {}, destroy() { socket.destroyed = true } })
}

function percentile(values, p) {
    const sorted = [...values].sort((a, b) => a - b)
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]
}

async function runBattle(relayProcess) {
    process.env.MULTI_BATTLE_RELAY_PROCESS = relayProcess ? '1' : '0'
    const members = [player(), player(), player()]
    const [host] = members
    const room = rooms.createRoom(host.viewerId, host.id, 1, mode.category, mode.visibleQuestId, 0, 111001)
    room.raising_state = 4
    room.mates = members.map(m => ({ viewer_id: m.viewerId, player_id: m.id, com_id: 0 }))
    room.member_viewer_ids = members.map(m => m.viewerId)
    room.member_player_ids = Object.fromEntries(members.map(m => [m.viewerId, m.id]))
    room.five_boss_runtime = { runId: `relay-run-${Date.now()}`, expectedRealPlayerIds: members.map(m => m.id),
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
    assert.equal(battleRelayBridge.isReady, relayProcess)

    const lines = []
    const originalWarn = console.warn
    console.warn = (...args) => { lines.push(args.join(' ')) }
    const clients = fork(path.join(__dirname, 'helpers/battle-sim-clients.cjs'), [JSON.stringify({
        port: rawServer.address().port, roomNumber: room.room_number,
        connectionIds: members.map(m => m.connectionId), durationMs: 2500, intervalMs: 33,
    })], { execArgv: [] })
    try {
        const [started] = await once(clients, 'message')
        assert.ok(started.started, started.error)
        assert.equal(battleRelayBridge.activeSockets, relayProcess ? 3 : 0)
        // A long synchronous settlement on the main thread.
        await new Promise(resolve => setTimeout(resolve, BLOCK_AT_MS))
        const until = performance.now() + BLOCK_MS
        while (performance.now() < until);
        const [result] = await once(clients, 'message')
        assert.ok(result.done, result.error)
        assert.ok(result.samples.length >= result.sent * 2 * 0.95, `relayed ${result.samples.length} of ${result.sent * 2}`)
        const during = result.samples
            .filter(sample => sample.sentAt >= BLOCK_AT_MS + 100 && sample.sentAt <= BLOCK_AT_MS + BLOCK_MS - 100)
            .map(sample => sample.latencyMs)
        assert.ok(during.length > 30, `samples during the block: ${during.length}`)

        coordinator.commitDisband(room, 'relay_test_end')
        const line = lines.find(value => value.startsWith('[MULTI-BATTLE]'))
        const summary = line && JSON.parse(line.slice('[MULTI-BATTLE] '.length))
        return {
            all: result.samples.map(sample => sample.latencyMs),
            during,
            summary,
        }
    } finally {
        console.warn = originalWarn
        clients.kill()
        await tcp.stopSessionServer()
        for (const client of lobbyClients) manager.removeClient(client)
        rooms.disbandRoom(room.room_number)
        battleTelemetry.end(room.room_number, 'cleanup')
    }
}

function describe(label, values) {
    return `${label} p50=${percentile(values, 0.5).toFixed(1)}ms p99=${percentile(values, 0.99).toFixed(1)}ms`
        + ` max=${Math.max(...values).toFixed(1)}ms`
}

test('a blocked main thread delays in-process battle relay', { timeout: 60000 }, async () => {
    const { all, during } = await runBattle(false)
    console.log(`[RELAY] in-process ${describe('all', all)}; ${describe('during block', during)}`)
    assert.ok(Math.max(...during) >= BLOCK_MS / 2, 'frames sent during the block waited for it')
})

test('the relay child keeps battle frames flowing while the main thread is blocked', { timeout: 60000 }, async () => {
    const { all, during, summary } = await runBattle(true)
    console.log(`[RELAY] relay-process ${describe('all', all)}; ${describe('during block', during)}`)
    assert.ok(percentile(during, 0.99) < 250, describe('during block', during))
    // Lease, presence and telemetry still see the relayed traffic.
    assert.ok(summary, 'battle summary emitted')
    const member = summary.members[0]
    assert.ok(member.broadcasts > 50, `broadcasts ${member.broadcasts}`)
    assert.ok(member.relayedOut > 100, `relayedOut ${member.relayedOut}`)
    assert.equal(member.sceneReady, 1)
    assert.ok(summary.loopLagMaxMs >= 500, `loop lag ${summary.loopLagMaxMs}`)
})

test.after(async () => {
    await load('lib/persistence-coordinator').drainPersistence()
    await load('multi/npc/player-party-pool').stopQuestNpcPartyPoolWorker()
    const db = load('data/db').getDb(); if (db.open) db.close()
    const resolved = fs.realpathSync(dataDir)
    assert.equal(path.dirname(resolved), fs.realpathSync(os.tmpdir()))
    assert.ok(path.basename(resolved).startsWith('startpoint-battle-relay-'))
    fs.rmSync(resolved, { recursive: true })
})
