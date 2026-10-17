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

async function startFiveBossBattle() {
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
        sims.push(...members.map(m => new SimClient(port, m, room)))
        await Promise.all(sims.map(sim => sim.open()))
        for (const sim of sims) sim.sceneReady()
        await Promise.all(sims.map(sim => sim.until(() => sim.battleStarts() === 1)))
        return { members, room, sims, lines, originalWarn, cleanup }
    } catch (error) {
        await cleanup()
        throw error
    }
}

for (const relayEnabled of [false, true]) test(`five-boss: all five scenes and final proof over real TCP (relay=${relayEnabled})`, {timeout:30000}, async () => {
    const previous = process.env.MULTI_BATTLE_RELAY_PROCESS
    process.env.MULTI_BATTLE_RELAY_PROCESS=relayEnabled?'1':'0'
    let x
    try {
        x=await startFiveBossBattle()
        const state=load('multi/state/battle-contract')
        const run=state.getBattleSessionContract(x.room)
        for (const member of x.members) assert.equal(state.bindBattlePlay(x.room,member.viewerId,member.id,member.playId),true)
        for (let scene=0;scene<5;scene++) {
            assert.equal(x.room.lifecycle.sceneEpoch,scene)
            assert.equal(x.room.lifecycle.battleSessionId,run.battleSessionId)
            for (let source=0;source<3;source++) {
                const payload=[1,`five-scene-${scene}-${source}`,source]
                x.sims[source].send([1,payload])
                for (let target=0;target<3;target++) if(target!==source) {
                    await x.sims[target].until(()=>x.sims[target].frames.some(f=>f.data[0]===2&&JSON.stringify(f.data[2])===JSON.stringify(payload)))
                    assert.equal(x.sims[target].frames.filter(f=>f.data[0]===2&&JSON.stringify(f.data[2])===JSON.stringify(payload)).length,1)
                }
            }
            if(scene===4) break
            x.sims[0].levelNext()
            await x.sims[0].until(()=>x.room.lifecycle.sceneEpoch===scene+1)
            // A late old-scene readiness must not release the new barrier.
            x.sims[1].sceneReady()
            x.sims[0].sceneReady()
            await new Promise(resolve=>setTimeout(resolve,15))
            assert.ok(x.sims.every(sim=>sim.battleStarts()===scene+1))
            x.sims[1].levelNext(); x.sims[2].levelNext()
            x.sims[1].sceneReady(); x.sims[2].sceneReady()
            await Promise.all(x.sims.map(sim=>sim.until(()=>sim.battleStarts()===scene+2)))
            assert.ok(x.sims.every(sim=>!sim.closed&&sim.leaves().length===0))
        }
        for(const sim of x.sims) sim.send([0,[2]])
        await Promise.all(x.sims.map(sim=>sim.until(()=>sim.frames.some(f=>JSON.stringify(f.data)==='[1,[2]]'))))
        await load('multi/five-boss/lobby-runtime').waitForFiveBossSignalPersistence(x.room.five_boss_runtime.runId)
        for(const member of x.members) {
            const result=runtime.finishFiveBossBattle({playerId:member.id,clientPlayId:member.playId,
                requestRoomNumber:x.room.room_number,requestCategory:mode.category,requestQuestId:mode.visibleQuestId,
                accomplished:true,elapsedTimeMs:30000,randomFloat:()=>0.1})
            assert.equal(result.kind,'success')
        }
        assert.ok(x.sims.every(sim=>sim.battleStarts()===5&&!sim.closed))
    } finally {
        if(x) await x.cleanup()
        if(previous===undefined) delete process.env.MULTI_BATTLE_RELAY_PROCESS
        else process.env.MULTI_BATTLE_RELAY_PROCESS=previous
    }
})

test('five-boss: relay latency, then a silent teammate cannot stall the next scene', { timeout: 60000 }, async () => {
    const { members, room, sims, lines, cleanup } = await startFiveBossBattle()
    let ticker, stallTimer
    try {

        // ~30 frames/s per player for 1.5 s; one 300 ms main-thread stall in the middle.
        const sent = new Map()
        let seq = 0
        ticker = originalInterval(() => {
            for (const sim of sims) {
                const id = ++seq
                sent.set(id, performance.now())
                sim.send([1, [[0, id]]])
            }
        }, 33)
        // End before the one-second histogram reset so its next poll can
        // observe the stall before the sampler clears the measurement.
        stallTimer = setTimeout(() => { const until = performance.now() + 300; while (performance.now() < until); }, 500)
        await new Promise(resolve => setTimeout(resolve, 1500))
        clearInterval(ticker)
        assert.ok(sent.size > 0, 'the simulated battle must send real broadcasts')
        await Promise.all(sims.map(sim => {
            const expected = sims.filter(other => other !== sim)
                .reduce((count, other) => count + other.broadcastsSent, 0)
            return sim.until(() => sim.frames.filter(frame => frame.data[0] === 2).length === expected)
        }))
        const latencies = []
        for (const sim of sims) {
            for (const frame of sim.frames) {
                if (frame.data[0] !== 2) continue
                const id = frame.data[2]?.[0]?.[1]
                if (sent.has(id)) latencies.push(frame.at - sent.get(id))
            }
        }
        assert.equal(latencies.length, sent.size * 2, 'every broadcast reaches both other clients')
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
        for (const sim of sims) {
            const member = summary.members.find(entry => entry.viewer === sim.member.viewerId)
            const expectedRelays = sims.filter(other => other !== sim)
                .reduce((count, other) => count + other.broadcastsSent, 0)
            assert.equal(member.broadcasts, sim.broadcastsSent, 'telemetry counts actual client broadcasts')
            assert.equal(member.relayedOut, expectedRelays, 'telemetry counts both recipients of every broadcast')
        }
        assert.ok(summary.loopLagMaxMs >= 200, `loop lag ${summary.loopLagMaxMs}`)
        assert.ok(summary.barriers.some(barrier => barrier.kind === 'next_scene' && barrier.waitMs >= 10000))
        assert.equal(summary.seatsExpired, 1)
    } finally {
        clearInterval(ticker)
        clearTimeout(stallTimer)
        await cleanup()
    }
})

test('five-boss: a teammate dropping mid-battle reaches the others as Leave at once', { timeout: 30000 }, async () => {
    const { members, room, sims, lines, cleanup } = await startFiveBossBattle()
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
