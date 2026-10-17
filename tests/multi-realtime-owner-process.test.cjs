'use strict'
// Synthetic loopback TCP acceptance. Observer sockets share one monotonic clock;
// no cross-process clock subtraction and no claim of phone/public-network latency.
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), net = require('node:net')
const { fork } = require('node:child_process')
const { performance } = require('node:perf_hooks')
const out = process.env.STARPOINT_TEST_OUT_DIR || path.resolve(__dirname, '../out')
const load = name => require(path.join(out, name))
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(predicate, label, ms = 6000) {
    const end = performance.now() + ms
    while (!predicate()) { if (performance.now() >= end) throw Error(`timeout: ${label}`); await sleep(5) }
}
function message(child, kind, ms = 15000) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => done(Error(`observer timeout: ${kind}`)), ms)
        const receive = m => { if (m?.kind === 'error') done(Error(m.reason)); else if (m?.kind === kind) done(null, m) }
        const exit = () => done(Error(`observer exited before ${kind}`))
        function done(error, value) { clearTimeout(timer); child.off('message', receive); child.off('exit', exit); error ? reject(error) : resolve(value) }
        child.on('message', receive); child.on('exit', exit)
    })
}
class Wire {
    constructor(port) {
        this.frames = []; this.buffer = ''; this.closed = false
        this.socket = net.createConnection({ host: '127.0.0.1', port }); this.socket.setNoDelay(true); this.socket.setEncoding('utf8')
        this.socket.on('error', () => {}); this.socket.on('close', () => { this.closed = true; this.closedAt = performance.now() })
        this.socket.on('data', chunk => {
            this.buffer += chunk; assert.ok(this.buffer.length < 1024 * 1024)
            let at
            while ((at = this.buffer.indexOf('\0')) >= 0) {
                const raw = this.buffer.slice(0, at); this.buffer = this.buffer.slice(at + 1)
                if (raw) this.frames.push({ value: JSON.parse(raw), at: performance.now() })
            }
        })
    }
    send(value) { this.socket.write(JSON.stringify(value) + '\0') }
    async open(handshake) { await until(() => !this.socket.connecting, 'connect'); this.send(handshake); await until(() => this.frames.some(f => f.value[0] === 0), 'accept') }
    count(tag) { return this.frames.filter(f => f.value[0] === 1 && f.value[1]?.[0] === tag).length }
}
async function observe(c) {
    const lobby = [], battle = []
    let keepAlive
    try {
        for (const member of c.members) {
            const wire = new Wire(c.port); lobby.push(wire)
            await wire.open({ socklet: 'cooperation_room', viewerId: member.viewerId, room_number: c.room, connection_id: member.cid })
            wire.send([0, [0, {}, 1]])
            await until(() => wire.count(0) > 0, 'lobby Enter')
        }
        for (const wire of lobby) wire.send([0, [3, [1]]])
        await until(() => lobby.every(w => w.frames.some(f => f.value[1]?.[0] === 2 && f.value[1]?.[2]?.[0] === 1)), 'Ready')
        lobby[0].send([0, [6]])
        await until(() => lobby.every(w => w.count(5) > 0), 'TCP Start')
        process.send({ kind: 'lobby-started' })
        await new Promise(resolve => process.once('message', resolve))
        for (const member of c.members) {
            const wire = new Wire(c.port); battle.push(wire)
            await wire.open({ socklet: 'cooperation_battle', room_number: c.room, connection_id: member.cid })
        }
        battle.forEach(w => w.send([0, [0]]))
        await until(() => battle.every(w => w.count(1) === 1), 'initial SceneReady barrier')
        process.send({ kind: 'battle-ready' })
        await new Promise(resolve => process.once('message', resolve))
        const origin = performance.now(), rtt = [], delivery = []
        // Parent starts its busy loop before these packets are sent.
        await sleep(100)
        for (let seq = 1; seq <= 8; seq++) {
            const sent = performance.now()
            battle[0].send([0, [3, [seq, sent]]])
            battle[0].send([1, [{ sequence: seq }]])
            battle[0].send([0, [5]]); battle[1].send([0, [5]])
            await until(() => battle[0].frames.some(f => f.value[1]?.[0] === 3 && f.value[1]?.[1] === seq && f.value[1]?.[2] === sent)
                && battle[1].frames.some(f => f.value[0] === 2 && f.value[2]?.[0]?.sequence === seq), 'matched echo and relay', 1000)
            rtt.push(battle[0].frames.find(f => f.value[1]?.[0] === 3 && f.value[1]?.[1] === seq && f.value[1]?.[2] === sent).at - sent)
            delivery.push(battle[1].frames.find(f => f.value[0] === 2 && f.value[2]?.[0]?.sequence === seq).at - sent)
            await sleep(25)
        }
        battle.forEach(w => w.send([0, [1]]))
        await sleep(20)
        battle[0].send([0, [0]])
        await sleep(30)
        assert.equal(battle[0].count(1), 1, 'next-scene barrier must wait for the other real peer')
        battle[1].send([0, [0]])
        await until(() => battle.every(w => w.count(1) === 2), 'LevelNext SceneReady barrier', 1000)
        const barrierElapsedMs = performance.now() - origin
        keepAlive = setInterval(() => battle[0].send([0, [5]]), 50)
        const quietAt = performance.now()
        await until(() => battle[1].closed, 'independent owner heartbeat lease', 5800)
        const report = { observerPid: process.pid, echoSamples: rtt.length, relaySamples: delivery.length,
            maxEchoRttMs: Math.max(...rtt), maxDeliveryWaitMs: Math.max(...delivery), barrierElapsedMs,
            quietPeerClosedAfterMs: battle[1].closedAt - quietAt, elapsedMs: performance.now() - origin,
            hostStillOpen: !battle[0].closed, initialAndNextBarrierCount: battle[0].count(1),
            heartbeatAcks: battle[0].frames.filter(f => f.value[1]?.[0] === 3 && f.value[1]?.[1] === 0 && f.value[1]?.[2] === 0).length,
            definition: 'observer monotonic source enqueue to matching echo/target parsed receipt; synthetic loopback TCP' }
        fs.writeFileSync(c.marker, JSON.stringify(report))
        process.send({ kind: 'observed', report })
        await new Promise(resolve => process.once('message', resolve))
    } finally { clearInterval(keepAlive); [...lobby, ...battle].forEach(w => w.socket.destroy()) }
}
if (process.argv[2] === '--observer') {
    observe(JSON.parse(process.argv[3])).then(() => process.disconnect(), error => { process.send({ kind: 'error', reason: error.message }); process.disconnect() })
} else if (process.argv[2] === '--guard') {
    assert.throws(() => load('data/db').getDb(), /REALTIME_OWNER_CANNOT_OPEN_PLAYER_DATABASE/)
    process.send({ kind: 'guard-passed' }); process.disconnect()
} else {
    const test = require('node:test')
    test('real remote TCP owner retains barriers, relay and leases while HTTP parent is blocked; no embedded fallback', { timeout: 35000 }, async t => {
        const directory = fs.mkdtempSync(path.join(path.resolve(__dirname, '../tmp'), 'remote-owner-'))
        process.env.DATA_DIR = directory; process.env.MULTI_REALTIME_PROCESS = '1'; process.env.MULTI_BATTLE_RELAY_PROCESS = '0'
        process.env.SESSION_HOST = '127.0.0.1'; process.env.SESSION_PORT = '0'
        process.env.BATTLE_HEARTBEAT_LEASE_MS = '5000'; process.env.BATTLE_LOADING_LEASE_MS = '10000'
        process.env.CLIENT_ADMISSION_CONFIG = path.join(directory, 'admission.json'); process.env.CLIENT_ADMISSION_KEYS = path.join(directory, 'keys.json')
        fs.writeFileSync(process.env.CLIENT_ADMISSION_CONFIG, JSON.stringify({ enforce: false, updateMessage: 'isolated', builds: [] }))
        fs.writeFileSync(process.env.CLIENT_ADMISSION_KEYS, '{}')
        const accounts = load('data/domains/account'), players = load('data/domains/player'), sessions = load('data/domains/session')
        const members = [1, 2].map(index => {
            const account = accounts.insertAccountSync({ appId: 'wf_cn', idpAlias: '', idpCode: 'test', idpId: `owner-${index}`, status: 'normal' })
            const player = players.insertDefaultPlayerSync(account.id)
            load('data/activeAccount').saveAccountDefaultPlayer(account.id, player.id)
            players.updatePlayerSync({ id: player.id, stamina: 100, staminaHealTime: new Date() })
            load('lib/character').givePlayerCharacterSync(player.id, 111001)
            load('data/domains/party').updatePlayerPartySync(player.id, 1, { category: 1, name: 'owner-test', characterIds: [111001, null, null], unisonCharacterIds: [null, null, null], equipmentIds: [null, null, null], abilitySoulIds: [null, null, null], edited: true, options: {} }, 1)
            const viewerId = 886100000 + index
            sessions.insertSessionWithTokenSync({ token: String(viewerId), accountId: account.id, type: 2, expires: new Date(Date.now() + 86400000) })
            return { id: player.id, viewerId, cid: `isolated-owner-${index}` }
        })
        const runtime = load('multi/coordinator/default-runtime'), app = require('fastify')()
        app.addHook('onSend', (_request, reply, payload, done) => done(null, reply.getHeader('content-type') === 'application/x-msgpack' ? JSON.stringify(payload) : payload))
        await app.register(load('multi/http/register').multiBattleRoutes, { prefix: '/multi' })
        let observer
        t.after(async () => { observer?.kill(); await runtime.stopRealtimeSessionServer(); await app.close(); load('data/db').getDb().close(); fs.rmSync(directory, { recursive: true, force: true }) })
        const post = async (url, payload) => {
            const response = await app.inject({ method: 'POST', url: `/multi/${url}`, payload })
            assert.equal(response.statusCode, 200, response.body)
            const body = response.json(); assert.equal(body.data_headers.result_code, 1, response.body); return body.data
        }
        const guard = fork(__filename, ['--guard'], { env: { ...process.env, MULTI_REALTIME_OWNER_CHILD: '1' }, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] })
        await message(guard, 'guard-passed')
        await runtime.startRealtimeSessionServer()
        const status = runtime.realtimeOwnerStatus()
        assert.equal(status.mode, 'process'); assert.notEqual(status.pid, process.pid); assert.equal(status.ready, true)
        assert.ok(status.endpoint.port > 0); assert.equal(load('multi/tcp/server').getSessionServer(), null)
        const scope = { category: 1, quest_id: 9001001, party_id: 1 }
        const created = await post('create_room', { viewer_id: members[0].viewerId, ...scope })
        const room = created.room_number, marker = path.join(directory, 'observer-proof.json')
        const prepared = await post('prepare', { viewer_id: members[0].viewerId, category: scope.category, quest_id: scope.quest_id, room_number: room })
        assert.equal(prepared.room_number, room)
        assert.equal(prepared.raising_state, 1)
        await post('select_room', { viewer_id: members[1].viewerId, ...scope, room_number: room, access_token: created.access_token, accepted_type: 0 })
        observer = fork(__filename, ['--observer', JSON.stringify({ port: status.endpoint.port, room, members, marker })], { env: process.env, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] })
        await message(observer, 'lobby-started')
        for (const member of members) await post('start', { viewer_id: member.viewerId, ...scope, room_number: room, play_id: `owner-play-${member.id}`, use_boost_point: false, use_boss_boost_point: false, is_auto_start_mode: false, mate_player_ids: [], mate_party_ids: [] })
        const gateway = runtime.getRoomCommandGateway()
        const projection = await gateway.execute('room.query', { roomNumber: room })
        projection.quest_id = -1
        assert.equal((await gateway.execute('room.query', { roomNumber: room })).quest_id, scope.quest_id)
        observer.send({ kind: 'open-battle' }); await message(observer, 'battle-ready')
        const observed = message(observer, 'observed')
        observer.send({ kind: 'parent-will-block' })
        const busyStart = performance.now()
        while (performance.now() - busyStart < 6500) { /* deliberately block only the HTTP/business parent */ }
        const completedWhileBlocked = fs.existsSync(marker)
        const observedResult = await observed
        assert.ok(completedWhileBlocked, 'observer recorded TCP/barrier/lease proof before parent resumed')
        const report = JSON.parse(fs.readFileSync(marker, 'utf8'))
        assert.notEqual(report.observerPid, process.pid); assert.notEqual(report.observerPid, status.pid)
        assert.equal(report.echoSamples, 8); assert.equal(report.relaySamples, 8)
        assert.ok(report.maxEchoRttMs < 1000); assert.ok(report.maxDeliveryWaitMs < 1000)
        assert.equal(report.initialAndNextBarrierCount, 2); assert.ok(report.barrierElapsedMs < 1000)
        assert.ok(report.heartbeatAcks >= 8, 'generic heartbeat ACKs remain separate from Measurement RTT samples')
        assert.ok(report.quietPeerClosedAfterMs >= 4500 && report.quietPeerClosedAfterMs < 5800)
        assert.ok(report.elapsedMs < 6500); assert.equal(report.hostStillOpen, true)
        assert.deepEqual(observedResult.report, report)
        t.diagnostic(JSON.stringify({ ...report, parentBlockedMs: performance.now() - busyStart }))
        observer.send({ kind: 'done' })
        await runtime.failRealtimeOwner()
        await assert.rejects(() => gateway.execute('room.query', { roomNumber: room }), /closed|CLOSED|unavailable/i)
        assert.equal(runtime.realtimeOwnerStatus().mode, 'process'); assert.equal(runtime.realtimeOwnerStatus().ready, false)
        assert.equal(load('multi/tcp/server').getSessionServer(), null)
        const closedSocket = net.createConnection({ host: '127.0.0.1', port: status.endpoint.port })
        await new Promise((resolve, reject) => { closedSocket.once('error', resolve); closedSocket.once('connect', () => { closedSocket.destroy(); reject(Error('closed owner still accepts TCP')) }) })
        const unavailable = await app.inject({ method: 'POST', url: '/multi/restore_room', payload: { viewer_id: members[0].viewerId, room_number: room } })
        assert.equal(unavailable.statusCode, 200, 'HTTP acknowledges unavailable owner without recreating embedded authority')
        assert.equal(unavailable.json().data_headers.result_code, 4050)
        assert.deepEqual(unavailable.json().data, {})
        assert.equal(runtime.realtimeOwnerStatus().pid, status.pid)
        assert.equal(runtime.realtimeOwnerStatus().ready, false)
        assert.equal(load('multi/tcp/server').getSessionServer(), null)
    })
}
