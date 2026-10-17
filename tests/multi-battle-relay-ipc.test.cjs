// Source mode sparsely compiles to scratch; the isolated runner can use its out/.
const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const net = require('node:net')
const Module = require('node:module')
const { once } = require('node:events')
const ts = require('typescript')
const scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-source-ipc-'))
const scratch = path.join(scratchRoot, 'multi/tcp/battle-relay')
fs.mkdirSync(scratch, { recursive: true })
const source = process.env.STARPOINT_TEST_OUT_DIR
    ? path.join(process.env.STARPOINT_TEST_OUT_DIR, 'multi/tcp/battle-relay')
    : path.resolve(__dirname, '../src/multi/tcp/battle-relay')
const sourceExtension = process.env.STARPOINT_TEST_OUT_DIR ? '.js' : '.ts'
const latency = ts.transpileModule(fs.readFileSync(path.resolve(source, '../../latency-statistics' + sourceExtension), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, reportDiagnostics: true,
})
assert.equal(latency.diagnostics?.length ?? 0, 0)
fs.writeFileSync(path.resolve(scratch, '../../latency-statistics.js'), latency.outputText)
for (const name of ['ipc', 'protocol', 'bridge', 'child']) {
    const result = ts.transpileModule(fs.readFileSync(path.join(source, name + sourceExtension), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, reportDiagnostics: true,
    })
    assert.equal(result.diagnostics?.length ?? 0, 0, 'source syntax diagnostics')
    fs.writeFileSync(path.join(scratch, name + '.js'), result.outputText)
}
const { BoundedRelayIpc } = require(path.join(scratch, 'ipc.js'))
const { BattleRelayBridge } = require(path.join(scratch, 'bridge.js'))
const { relayFramesIdentityRejection } = require(path.join(scratch, 'protocol.js'))
const limits = { maxMessages: 8, maxBytes: 2048, maxAgeMs: 1000 }
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(condition, ms = 4000) {
    const end = Date.now() + ms
    while (!condition()) { if (Date.now() > end) throw new Error('condition timed out'); await pause(5) }
}
after(() => fs.rmSync(scratchRoot, { recursive: true }))

test('parent identity guard rejects old instance/run/scene while retaining ordered legacy LevelNext entrance', () => {
    const current = { instanceId: 'room-2', battleSessionId: 'run-2', sceneEpoch: 2 }
    const ready = '[0,[0]]\0', next = '[0,[1]]\0[0,[0]]\0'
    assert.equal(relayFramesIdentityRejection(current, current, current, ready), null)
    assert.equal(relayFramesIdentityRejection(current, current, { ...current, instanceId: 'room-1' }, ready), 'instance')
    assert.equal(relayFramesIdentityRejection(current, current, { ...current, battleSessionId: 'run-1' }, ready), 'run')
    assert.equal(relayFramesIdentityRejection(current, current, { ...current, sceneEpoch: 1 }, ready), 'scene')
    const behind = { ...current, sceneEpoch: 1 }
    assert.equal(relayFramesIdentityRejection(current, behind, undefined, ready), 'scene')
    assert.equal(relayFramesIdentityRejection(current, behind, behind, '[1,[]]\0'), 'scene')
    assert.equal(relayFramesIdentityRejection(current, behind, behind, next), null)
    assert.equal(relayFramesIdentityRejection(current, behind, current, next), null)
    assert.equal(relayFramesIdentityRejection(current, { ...current, sceneEpoch: 0 }, undefined, next), 'scene')
})

test('transport callback and false return never mean peer consumption; item stays bounded until application ack', async () => {
    const sent = []; const faults = []
    const q = new BoundedRelayIpc((message, handle, cb) => { sent.push({ message, cb }); return false }, reason => faults.push(reason), limits)
    try {
        assert.equal(q.enqueue({ t: 'work', data: 'payload' }), true)
        sent[0].cb(); await pause(0)
        assert.equal(q.diagnostics().pendingMessages, 1)
        assert.ok(q.diagnostics().pendingBytes > 0)
        q.receive({ t: 'relay-ipc-ack', seq: 1 }, undefined, () => assert.fail('ack is not application work'))
        assert.equal(q.diagnostics().pendingMessages, 0)
        assert.equal(q.diagnostics().transportBackpressure, 1)
        assert.deepEqual(faults, [])
    } finally { q.close() }
})

test('IPC fixed histograms use the initiator clock and only actual application ACKs, including queue wait', async () => {
    let now = 100
    const sent = []
    const q = new BoundedRelayIpc((message, handle, cb) => { sent.push({ message, cb }); return false },
        () => assert.fail('fixture fault'), limits, () => now)
    try {
        q.enqueue({ t: 'first' })
        now = 110; q.enqueue({ t: 'second' })
        now = 140; sent[0].cb(); await pause(0)
        assert.equal(q.stats().applicationAckRttMs.count, 0, 'Node transport completion adds no ACK sample')
        assert.equal(q.stats().sendQueueWaitMs.maxMs, 30, 'second enqueue waited 30ms for the transport slot')
        now = 160; sent[1].cb()
        assert.equal(q.stats().applicationAckRttMs.count, 0)
        now = 410; q.receive({ t: 'relay-ipc-ack', seq: 2 }, undefined, () => {})
        now = 450; q.receive({ t: 'relay-ipc-ack', seq: 1 }, undefined, () => {})
        const stats = q.diagnostics().applicationAckRttMs
        assert.equal(stats.count, 2)
        assert.equal(stats.minMs, 300)
        assert.equal(stats.maxMs, 350)
        assert.equal(stats.meanMs, 325)
        assert.equal(stats.p50Ms, 300)
        assert.equal(stats.p99Ms, 350)
        assert.equal(stats.quantileMethod, 'fixed-bucket-upper-bound')
        assert.ok(stats.bucketCount < 2000, 'histogram storage is fixed')
        assert.match(q.stats().applicationAckRttDefinition, /not TCP RTT/)
    } finally { q.close() }
})

test('member sync timing accepts only the desired version and identity, records once on the parent clock', async () => {
    let now = 100
    const samples = [], messages = []
    const bridge = new BattleRelayBridge('not-started', (room, ms) => samples.push({ room, ms }), () => now)
    bridge.child = { connected: true }
    bridge.post = message => { messages.push(message); return true }
    const identity = { instanceId: 'fixture', battleSessionId: 'run', sceneEpoch: 0 }
    const members = [{ sid: 1, cid: 'c1', gen: 1 }]
    const publish = async () => { bridge.scheduleMembership('123456', () => members, identity); await pause(0); return messages.at(-1) }
    const confirm = message => bridge.handleChildMessage({ ...message, t: 'members-applied' })
    const first = await publish()
    now = 200; const second = await publish()
    now = 350; confirm(first)
    assert.deepEqual(samples, [], 'superseded version does not add a timing sample')
    now = 550; confirm(second); confirm(second)
    assert.deepEqual(samples, [{ room: '123456', ms: 350 }], 'matching version records once')
    now = 600; const third = await publish()
    now = 700; confirm({ ...third, instanceId: 'retired' })
    assert.equal(samples.length, 1, 'identity mismatch does not consume the current start time')
    now = 900; confirm(third)
    assert.deepEqual(samples[1], { room: '123456', ms: 300 })
    bridge.child = null
})

test('apply acknowledgement waits for asynchronous application and transport errors fail explicitly', async () => {
    let applied; const sent = []; const faults = []
    const q = new BoundedRelayIpc((message, handle, cb) => { sent.push(message); cb(); return true }, reason => faults.push(reason), limits)
    try {
        q.receive({ t: 'relay-ipc', seq: 1, body: { t: 'control' } }, undefined, () => new Promise(resolve => { applied = resolve }))
        assert.equal(sent.length, 0)
        applied(); await pause(0)
        assert.deepEqual(sent, [{ t: 'relay-ipc-ack', seq: 1 }])
    } finally { q.close() }
    const bad = new BoundedRelayIpc((message, handle, cb) => { cb(new Error('injected')); return true }, reason => faults.push(reason), limits)
    assert.equal(bad.enqueue({ t: 'valid-message' }), false)
    assert.equal(bad.diagnostics().fault, 'ipc_send_failed')
    assert.deepEqual(faults, ['ipc_send_failed'])
})

test('message, byte and age limits include sent-but-unapplied work and slow send callbacks', () => {
    for (const mode of ['messages', 'bytes', 'age', 'slow-transport', 'ack-age']) {
        let now = 0; const faults = []
        const q = new BoundedRelayIpc((message, handle, cb) => { if (mode !== 'ack-age' && mode !== 'slow-transport') cb(); return true }, reason => faults.push(reason),
            { maxMessages: mode === 'messages' ? 2 : 8, maxBytes: mode === 'bytes' ? 70 : 2048, maxAgeMs: 100 }, () => now)
        if (mode === 'ack-age') q.receive({ t: 'relay-ipc', seq: 1, body: {} }, undefined, () => {})
        else q.enqueue({ a: 'b' })
        if (mode === 'messages') { q.enqueue({ a: 2 }); q.enqueue({ a: 3 }) }
        if (mode === 'age' || mode === 'ack-age' || mode === 'slow-transport') { now = 101; q.checkAge() }
        assert.equal(faults.length, 1, mode)
        assert.equal(q.diagnostics().closed, true)
        assert.equal(q.enqueue({ t: 'later-valid' }), false)
        q.close()
    }
})

test('planned close reports accepted unsent work once and ignores late transport callbacks', () => {
    let callback; const result = []
    const q = new BoundedRelayIpc((message, handle, cb) => { callback = cb; return false }, () => assert.fail('planned close is not a fault'), limits)
    q.enqueue({ t: 'accepted' }, undefined, error => result.push(error?.message ?? 'success'))
    q.close('planned_shutdown'); callback()
    assert.deepEqual(result, ['planned_shutdown'])
    assert.equal(q.diagnostics().pendingMessages, 0)
})

test('unknown, duplicate and old application acknowledgements fail rather than release another message', () => {
    const faults = []
    const q = new BoundedRelayIpc((message, handle, cb) => { cb(); return true }, reason => faults.push(reason), limits)
    q.enqueue({ t: 'valid' }); q.receive({ t: 'relay-ipc-ack', seq: 2 }, undefined, () => {})
    assert.deepEqual(faults, ['ipc_unknown_ack'])
    assert.equal(q.diagnostics().pendingMessages, 0)
    const duplicate = new BoundedRelayIpc((message, handle, cb) => { cb(); return true }, reason => faults.push(reason), limits)
    duplicate.enqueue({ t: 'valid' })
    duplicate.receive({ t: 'relay-ipc-ack', seq: 1 }, undefined, () => {})
    duplicate.receive({ t: 'relay-ipc-ack', seq: 1 }, undefined, () => {})
    assert.equal(faults.length, 2)
    const old = new BoundedRelayIpc((message, handle, cb) => { cb(); return true }, reason => faults.push(reason), limits)
    old.receive({ t: 'relay-ipc', seq: 1, body: {} }, undefined, () => {})
    old.receive({ t: 'relay-ipc', seq: 1, body: {} }, undefined, () => assert.fail('old body must not reapply'))
    assert.equal(faults[2], 'ipc_receive_order')
})

async function fixture({ automaticApplication = true } = {}) {
    const bridge = new BattleRelayBridge(path.join(scratch, 'child.js'))
    await bridge.start()
    const peers = []; const proxies = []; const forwarded = []; const completions = []
    const server = net.createServer(socket => {
        socket.setEncoding('utf8')
        const adopted = bridge.adopt(socket)
        assert.ok(adopted)
        const proxy = adopted.proxy; proxies.push(proxy)
        proxy.on('error', () => {})
        proxy.on('relay-frames', (data, done) => {
            forwarded.push({ sid: proxy.sid, data })
            // Actual parent fan-out used by the mixed/unconfirmed path.
            for (const raw of data.split('\0').filter(Boolean)) {
                const frame = JSON.parse(raw)
                if (frame[0] === 1) {
                    for (const target of proxies) if (target !== proxy && !target.destroyed) target.write(JSON.stringify([2, 'cid' + proxy.sid, frame[1]]) + '\0')
                    proxy.write(JSON.stringify([1, [3, 0, 0, 1]]) + '\0')
                }
            }
            if (automaticApplication) done(); else completions.push(done)
        })
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    for (let i = 0; i < 2; i++) {
        const socket = net.createConnection({ port: server.address().port, host: '127.0.0.1' })
        socket.setEncoding('utf8'); socket.on('error', () => {})
        const peer = { socket, frames: [], buffer: '' }
        socket.on('data', chunk => { peer.buffer += chunk; let end; while ((end = peer.buffer.indexOf('\0')) >= 0) {
            peer.frames.push(JSON.parse(peer.buffer.slice(0, end))); peer.buffer = peer.buffer.slice(end + 1)
        } })
        peers.push(peer); await once(socket, 'connect')
    }
    await until(() => proxies.length === 2)
    const identity = { instanceId: 'fixture-room-1', battleSessionId: 'fixture-run-1', sceneEpoch: 0 }
    const members = proxies.map(proxy => ({ sid: proxy.sid, cid: 'cid' + proxy.sid, gen: 1 }))
    async function membership(version, extra = {}) {
        let observed = false
        const original = bridge.handleChildMessage
        bridge.handleChildMessage = function(message) {
            if (message.t === 'members-applied' && message.version === version) { observed = true; return }
            return original.call(this, message)
        }
        bridge.post({ t: 'members', room: '123456', ...identity, version, members, ...extra })
        await until(() => observed)
        bridge.handleChildMessage = original
    }
    const activate = (version, extra = {}) => bridge.post({ t: 'activate', room: '123456', ...identity, version, ...extra })
    const send = (i, value) => peers[i].socket.write(JSON.stringify(value) + '\0')
    const cleanup = async () => {
        for (const done of completions.splice(0)) done()
        await bridge.stop()
        for (const peer of peers) peer.socket.destroy()
        await new Promise(resolve => server.close(resolve))
    }
    return { bridge, peers, proxies, forwarded, completions, membership, activate, send, cleanup, identity, members }
}

test('unconfirmed membership uses one parent fan-out; stale activation cannot enable a newer scene', { timeout: 15000 }, async () => {
    const f = await fixture()
    try {
        await f.membership(1)
        f.send(0, [1, ['before-confirmation']])
        await until(() => f.peers[1].frames.length === 1 && f.peers[0].frames.length === 1)
        assert.equal(f.forwarded.length, 1)
        f.activate(1); await pause(30)
        f.send(0, [1, ['confirmed']]); await until(() => f.peers[1].frames.length === 2)
        assert.equal(f.forwarded.length, 1, 'confirmed all-child local route')
        await f.membership(2, { sceneEpoch: 1 })
        f.activate(1); await pause(30)
        f.send(0, [1, ['new-scene-unconfirmed']]); await until(() => f.peers[1].frames.length === 3)
        assert.equal(f.forwarded.length, 2, 'old scene activation rejected')
        f.activate(2, { sceneEpoch: 1 }); await pause(30)
        f.send(0, [1, ['new-scene-confirmed']]); await until(() => f.peers[1].frames.length === 4)
        assert.equal(f.forwarded.length, 2)
        await f.membership(3, { sceneEpoch: 1, members: [{ ...f.members[0], gen: 2 }, f.members[1]] })
        f.activate(3, { sceneEpoch: 1 }); await pause(30)
        f.bridge.post({ t: 'members', room: '123456', ...f.identity, version: 2, members: f.members })
        await pause(30)
        f.send(0, [1, ['different-generation-no-delivery']])
        await until(() => f.peers[0].frames.length === 5)
        await pause(50)
        assert.equal(f.peers[0].frames.length, 5, 'exactly one ack per input')
        assert.equal(f.peers[1].frames.length, 4, 'no double parent/child fan-out')
    } finally { await f.cleanup() }
})

test('pending parent control gates other chunks and peers until application completion, then resumes', { timeout: 15000 }, async () => {
    const f = await fixture({ automaticApplication: false })
    try {
        await f.membership(1); f.activate(1); await pause(30)
        f.send(0, [0, [1]])
        await until(() => f.completions.length === 1)
        f.send(1, [1, ['other-peer-while-control-pending']])
        await until(() => f.forwarded.length === 2)
        assert.ok(f.forwarded[1].data.includes('other-peer-while-control-pending'))
        f.completions.splice(0).forEach(done => done()); await pause(40)
        f.send(1, [1, ['after-control-application']])
        await until(() => f.peers[0].frames.length === 2)
        assert.equal(f.forwarded.length, 2)
    } finally { await f.cleanup() }
})

test('callback failure explicitly closes adopted connections and retained native handles survive', { timeout: 15000 }, async () => {
    const f = await fixture()
    const nativeServer = net.createServer(socket => socket.on('data', data => socket.write(data)))
    await new Promise(resolve => nativeServer.listen(0, '127.0.0.1', resolve))
    const native = net.createConnection({ port: nativeServer.address().port, host: '127.0.0.1' })
    native.on('error', () => {}); await once(native, 'connect')
    try {
        const child = f.bridge.child; const original = child.send
        child.send = function(message, ...args) {
            if (message.body?.t === 'write') { args.at(-1)(new Error('injected callback failure')); return true }
            return original.call(this, message, ...args)
        }
        assert.equal(f.proxies[0].write('valid\0'), false)
        await until(() => f.proxies.every(proxy => proxy.destroyed))
        assert.equal(f.bridge.diagnostics().lastFault, 'ipc_send_failed')
        const echoed = once(native, 'data'); native.write('native-still-alive')
        assert.equal((await echoed)[0].toString(), 'native-still-alive')
        child.send = original
    } finally { native.destroy(); await new Promise(resolve => nativeServer.close(resolve)); await f.cleanup() }
})

test('real parent event-loop blocking beyond application budget closes sockets explicitly', { timeout: 15000 }, async () => {
    const previous = process.env.MULTI_BATTLE_RELAY_IPC_MAX_AGE_MS
    process.env.MULTI_BATTLE_RELAY_IPC_MAX_AGE_MS = '150'
    const f = await fixture({ automaticApplication: false })
    try {
        await f.membership(1); f.activate(1)
        await until(() => f.bridge.diagnostics().parentIpc.pendingMessages === 0)
        f.send(0, [0, [1]])
        // The child remains schedulable and observes an actually stalled parent.
        const end = performance.now() + 400
        while (performance.now() < end) {}
        await until(() => f.proxies.every(proxy => proxy.destroyed))
        assert.equal(f.bridge.activeSockets, 0)
    } finally {
        if (previous === undefined) delete process.env.MULTI_BATTLE_RELAY_IPC_MAX_AGE_MS
        else process.env.MULTI_BATTLE_RELAY_IPC_MAX_AGE_MS = previous
        await f.cleanup()
    }
})

test('server completion waits for async handshake and every forwarded frame across processing ticks', { timeout: 15000 }, async () => {
    const previousEnv = Object.fromEntries(['SESSION_PORT', 'SESSION_HOST', 'SESSION_MAX_FRAMES_PER_TICK', 'MULTI_BATTLE_RELAY_PROCESS'].map(k => [k, process.env[k]]))
    Object.assign(process.env, { SESSION_PORT: '0', SESSION_HOST: '127.0.0.1', SESSION_MAX_FRAMES_PER_TICK: '8', MULTI_BATTLE_RELAY_PROCESS: '1' })
    const bridge = new BattleRelayBridge(path.join(scratch, 'child.js'))
    const clients = new Map(); let handshakeStarted = false, handshakeComplete = false, handled = 0
    const lifecycle = { instanceId: 'source-room', battleSessionId: 'source-run', sceneEpoch: 0 }
    const completionCounts = []
    const originalPost = bridge.post
    bridge.post = function(message) { if (message.t === 'control-applied') completionCounts.push({ handled, handshakeComplete }); return originalPost.call(this, message) }
    const noOp = () => {}
    const manager = { findClientBySocket: socket => clients.get(socket), isCurrentBattleClient: () => true,
        removeClient: client => clients.delete(client.socket) }
    const mocks = {
        net,
        '../../lib/memory-diagnostics': { observeServerConnections: noOp },
        '../coordinator/socket-admission': {
            authorizeSocketAdmission: async () => true,
            checkSocketAdmission: () => true,
            stopSocketAdmission: noOp,
        },
        '../coordinator/business-rpc': { runWithTcpBusinessAdmission: async operation => operation() },
        './handshake': { handleHandshake: async socket => { handshakeStarted = true; await pause(80); clients.set(socket, { socket, roomNumber: '123456', isBattle: true,
            roomInstanceId: lifecycle.instanceId, battleSessionId: lifecycle.battleSessionId, sceneEpoch: 0 }); handshakeComplete = true } },
        './battle': { handleBattleMessage: (socket, data) => { assert.equal(handshakeComplete, true); handled++;
            if (data[0] === 0 && data[1]?.[0] === 1) clients.get(socket).sceneEpoch = lifecycle.sceneEpoch }, handleBattleRelayActivity: noOp,
            discardPinnedBattleControlsForShutdown: noOp },
        './battle-relay/bridge': { ...require(path.join(scratch, 'bridge.js')), battleRelayBridge: bridge },
        './battle-relay/protocol': require(path.join(scratch, 'protocol.js')),
        '../state/SessionManager': { sessionManager: manager },
        '../room/manager': { getRoom: () => ({ lifecycle }) },
        '../../lib/game-logging': { gameVerboseLog: noOp },
        './reliable-send': { clearReliableSendState: noOp },
        './disconnect-diagnostics': { finishTcpDisconnect: () => 'peer_fin', markTcpDisconnectReason: noOp, readTcpDisconnectReason: () => 'peer_fin' },
        '../coordinator/embedded': { embeddedMultiCoordinator: { enqueueRoomCommand: (room, command) => Promise.resolve().then(command) } },
        '../battle-telemetry': { battleTelemetry: { disconnected: noOp, controlDelay: noOp } },
        '../five-boss/connection-diagnostic': { fiveBossConnectionDiagnostics: { socketEvent: noOp } },
        '../../lounge/tcp': { detachLoungeSocket: noOp, handleLoungeHandshake: noOp, handleLoungeMessage: noOp },
    }
    const result = ts.transpileModule(fs.readFileSync(path.resolve(source, '../server' + sourceExtension), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, reportDiagnostics: true,
    })
    assert.equal(result.diagnostics?.length ?? 0, 0)
    const serverModule = new Module(path.join(scratch, 'source-server.js'))
    serverModule.filename = path.join(scratch, 'source-server.js')
    serverModule.require = name => mocks[name] ?? require(name)
    serverModule._compile(result.outputText, serverModule.filename)
    const tcp = serverModule.exports
    let peer
    try {
        await tcp.startSessionServer()
        peer = net.createConnection({ host: '127.0.0.1', port: tcp.getSessionServer().address().port })
        peer.on('error', noOp); await once(peer, 'connect')
        peer.write(JSON.stringify({ socklet: 'cooperation_battle', room_number: '123456' }) + '\0')
        await until(() => handshakeStarted)
        peer.write(Array.from({ length: 40 }, (_, i) => JSON.stringify([1, [{ marker: i }]]) + '\0').join(''))
        await pause(10)
        assert.equal(completionCounts.length, 0, 'IPC ingress is not completion during async handshake')
        await until(() => handled === 40 && completionCounts.length > 0)
        assert.ok(completionCounts.every(x => x.handled === 40 && x.handshakeComplete), 'no ack before multi-tick frame boundary')
        const proxy = [...bridge.proxies.values()][0]
        lifecycle.sceneEpoch = 1
        await bridge.handleChildMessage({ t: 'frames', sid: proxy.sid, controlId: 9001, data: '[0,[0]]\0',
            identity: { ...lifecycle, sceneEpoch: 0 } })
        assert.equal(handled, 40, 'old scene readiness cannot act on current scene')
        assert.equal(bridge.diagnostics().rejectedFrames.scene, 1)
        await bridge.handleChildMessage({ t: 'frames', sid: proxy.sid, controlId: 9002, data: '[0,[0]]\0' })
        assert.equal(handled, 40, 'missing snapshot cannot bypass bound old scene guard')
        await bridge.handleChildMessage({ t: 'frames', sid: proxy.sid, controlId: 9003, data: '[0,[1]]\0[0,[0]]\0',
            identity: { ...lifecycle, sceneEpoch: 0 } })
        assert.equal(handled, 42, 'legacy peer LevelNext and its ordered tail may advance')
        await bridge.handleChildMessage({ t: 'frames', sid: proxy.sid, controlId: 9004, data: '[0,[0]]\0',
            identity: { ...lifecycle, instanceId: 'retired-room' } })
        assert.equal(handled, 42)
        assert.equal(bridge.diagnostics().rejectedFrames.instance, 1)
        assert.ok(completionCounts.length >= 5, 'rejected batches still complete application acknowledgements')
    } finally {
        peer?.destroy(); await tcp.stopSessionServer()
        for (const [key, value] of Object.entries(previousEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value }
    }
})
