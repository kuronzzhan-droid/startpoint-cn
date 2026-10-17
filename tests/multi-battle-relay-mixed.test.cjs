// Exercises the actual session server, admission handshake, bridge and roster.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const childProcess = require('node:child_process')
const { once } = require('node:events')
const { startFiveBossBattle, SimClient, load, manager } = require('./helpers/battle-relay-room.cjs')
const { battleRelayBridge: bridge, BattleRelayBridge, isRelayProxySocket, battleRelayProcessEnabled } = load('multi/tcp/battle-relay/bridge')
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const relays = (sim, marker) => sim.frames.filter(f => (f.data[0] === 2 || f.data[0] === 3) && JSON.stringify(f.data).includes(marker))
const acks = sim => sim.frames.filter(f => f.data[0] === 1 && f.data[1]?.[0] === 3).length

async function bounded(promise, timeoutMs, message) {
    let timer
    try {
        return await Promise.race([promise, new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(message)), timeoutMs)
        })])
    } finally { clearTimeout(timer) }
}

const connectionCount = server => new Promise((resolve, reject) => server.getConnections((error, count) => error ? reject(error) : resolve(count)))

test('failed spawn with error/close but no exit resolves pending start and stop', { timeout: 10000 }, async () => {
    const originalFork = childProcess.fork
    const failed = new BattleRelayBridge()
    let spawned
    let exits = 0
    childProcess.fork = (file, args, options) => {
        spawned = originalFork(file, args, { ...options, execPath: path.join(os.tmpdir(), 'missing-relay-node-executable.exe') })
        spawned.on('exit', () => exits++)
        return spawned
    }
    try {
        const starting = failed.start()
        assert.equal(spawned.pid, undefined)
        const stopping = failed.stop()
        await bounded(Promise.all([starting, stopping]), 3000, 'failed-spawn waiters hung')
        await failed.stop()
        assert.equal(exits, 0, 'this injects a real spawn failure, not a child script exit')
        assert.equal(failed.isReady, false)
        assert.equal(failed.child, null)
        assert.equal(failed.readyWaiters.length, 0)
        assert.equal(failed.activeSockets, 0)
    } finally { childProcess.fork = originalFork; await failed.stop() }
})

test('synchronous handle-send failure closes child-owned sockets, retains native and does not delay server stop', { timeout: 15000 }, async () => {
    const { room, members, sims, port, cleanup } = await startFiveBossBattle({ mixed: true })
    const server = load('multi/tcp/server').getSessionServer()
    const child = bridge.child
    const originalSend = child.send
    let incoming
    let failedClient
    const previousRestarts = bridge.restarts
    const beforeConnections = await connectionCount(server)
    server.once('connection', socket => { incoming = socket })
    child.send = function(message, ...args) {
        if (message.body?.t === 'adopt') throw new Error('injected synchronous handle-send failure')
        return originalSend.call(this, message, ...args)
    }
    try {
        failedClient = new SimClient(port, members[1], room)
        await once(failedClient.socket, 'connect')
        failedClient.send({ socklet: 'cooperation_battle', room_number: room.room_number, connection_id: members[1].connectionId })
        await failedClient.until(() => failedClient.closed && incoming?.destroyed && bridge.activeSockets === 0, 3000)
        assert.equal(sims[0].closed, false, 'native connection survives the failed child IPC channel')
        assert.equal(bridge.diagnostics().lastFault, 'ipc_send_failed')
        assert.equal(await connectionCount(server), beforeConnections, 'the failed original socket releases its server connection count')
        child.send = originalSend
        await bounded(cleanup(), 3000, 'session server stop hung after handle-send failure')
        assert.equal(await connectionCount(server), 0)
        assert.equal(bridge.activeSockets, 0)
    } finally {
        child.send = originalSend
        failedClient?.socket.destroy()
        await cleanup()
        // Keep this injected fault from spending a later fixture's process-wide
        // restart budget; production stop/start intentionally retains the budget.
        bridge.restarts = previousRestarts
    }
})

test('handshake coalesced with a partial UTF-8 frame keeps its decoder native and preserves payload/ack', { timeout: 15000 }, async () => {
    const { room, members, sims, port, cleanup } = await startFiveBossBattle({ mixed: true })
    let replacement
    try {
        replacement = new SimClient(port, members[1], room)
        await once(replacement.socket, 'connect')
        const handshake = Buffer.from(JSON.stringify({ socklet: 'cooperation_battle', room_number: room.room_number, connection_id: members[1].connectionId }) + '\0')
        const marker = 'split-utf8-中-payload'
        const frame = Buffer.from(JSON.stringify([1, [{ marker }]]) + '\0')
        const split = frame.indexOf(Buffer.from('中')) + 1
        assert.ok(split > 1, 'the split is after the first byte of a three-byte code point')
        replacement.socket.write(Buffer.concat([handshake, frame.subarray(0, split)]))
        await replacement.until(() => replacement.frames.some(f => f.data[0] === 0))
        assert.equal(isRelayProxySocket(manager.getBattleClient(members[1].connectionId).socket), false, 'partial decoder state prevents handoff before mutation')
        assert.equal(acks(replacement), 0, 'incomplete frame is not acknowledged')
        replacement.socket.write(frame.subarray(split))
        await replacement.until(() => acks(replacement) === 1)
        for (const sim of [sims[0], sims[2]]) await sim.until(() => relays(sim, marker).length === 1)
        await pause(100)
        assert.equal(acks(replacement), 1)
        for (const sim of [sims[0], sims[2]]) {
            const received = relays(sim, marker)
            assert.equal(received.length, 1)
            assert.deepEqual(received[0].data, [2, members[1].connectionId, [{ marker }]], 'native decoder preserves exact Unicode bytes when forwarding to native/proxy recipients')
        }
    } finally { replacement?.socket.destroy(); await cleanup() }
})

async function exchange(sims, sourceIndex, frame, marker, recipientIndexes) {
    const source = sims[sourceIndex]
    const before = acks(source)
    source.send(frame)
    await source.until(() => acks(source) > before)
    for (const i of recipientIndexes) await sims[i].until(() => relays(sims[i], marker).length > 0)
    await pause(100)
    assert.equal(acks(source) - before, 1, 'exactly one ack per logical input')
    for (let i = 0; i < sims.length; i++) {
        assert.equal(relays(sims[i], marker).length, recipientIndexes.includes(i) ? 1 : 0, `recipient ${i}: exactly the current generation once`)
    }
}

test('relay defaults off and startup failure/stop-before-ready finish without hanging', { timeout: 15000 }, async () => {
    assert.equal(battleRelayProcessEnabled({}), false)
    const failed = new BattleRelayBridge(path.join(os.tmpdir(), 'missing-battle-relay-child.cjs'))
    await Promise.race([failed.start(), pause(5000).then(() => { throw new Error('failed relay start hung') })])
    assert.equal(failed.isReady, false)
    assert.equal(failed.adopt({}), null, 'native fallback remains possible')
    await failed.stop()
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-not-ready-'))
    const childPath = path.join(scratch, 'child.cjs')
    fs.writeFileSync(childPath, 'setInterval(() => {}, 1000); process.on("message", m => { if (m.t === "shutdown") process.exit(0) });')
    const waiting = new BattleRelayBridge(childPath)
    try {
        const ready = waiting.start()
        await pause(100)
        await waiting.stop()
        await Promise.race([ready, pause(2000).then(() => { throw new Error('stopping before readiness hung') })])
        assert.equal(waiting.isReady, false)
    } finally {
        await waiting.stop()
        fs.rmSync(scratch, { recursive: true })
    }
})

test('same-generation mixed Broadcast/Send use one parent fan-out and ack in both directions', { timeout: 20000 }, async () => {
    const { room, sims, members, cleanup } = await startFiveBossBattle({ mixed: true })
    try {
        assert.equal(isRelayProxySocket(manager.getBattleClient(members[0].connectionId).socket), false)
        assert.equal(isRelayProxySocket(manager.getBattleClient(members[1].connectionId).socket), true)
        assert.equal(bridge.activeSockets, 2)
        let forwarded = 0
        const proxy = manager.getBattleClient(members[1].connectionId).socket
        proxy.on('data', chunk => { if (chunk.includes('mixed-proxy-')) forwarded++ })
        await exchange(sims, 0, [1, [{ marker: 'mixed-native-broadcast' }]], 'mixed-native-broadcast', [1, 2])
        await exchange(sims, 1, [1, [{ marker: 'mixed-proxy-broadcast' }]], 'mixed-proxy-broadcast', [0, 2])
        await exchange(sims, 0, [2, null, { marker: 'mixed-native-send' }], 'mixed-native-send', [1, 2])
        await exchange(sims, 1, [2, null, { marker: 'mixed-proxy-send' }], 'mixed-proxy-send', [0, 2])
        assert.equal(forwarded, 2, 'both proxy inputs were delegated to the real parent handler')
        assert.equal(manager.snapshotBattleRelayRecipients(manager.getBattleClient(members[1].connectionId)).length, 2)
    } finally { await cleanup() }
})

test('other-generation native members neither receive frames nor force same-generation child fallback', { timeout: 20000 }, async () => {
    const { room, sims, members, cleanup } = await startFiveBossBattle({ mixed: true })
    try {
        const native = manager.getBattleClient(members[0].connectionId)
        const source = manager.getBattleClient(members[1].connectionId)
        native.roomGeneration = source.roomGeneration + 1
        manager.battleRelayMembershipChanged(room.room_number)
        await pause(150)
        let forwarded = 0
        source.socket.on('data', chunk => { if (chunk.includes('child-generation-')) forwarded++ })
        await exchange(sims, 1, [1, [{ marker: 'child-generation-broadcast' }]], 'child-generation-broadcast', [2])
        await exchange(sims, 1, [2, null, { marker: 'child-generation-send' }], 'child-generation-send', [2])
        assert.equal(forwarded, 0, 'native in another generation does not disable local relay')
        await exchange(sims, 0, [1, [{ marker: 'native-other-generation' }]], 'native-other-generation', [])
    } finally { await cleanup() }
})

test('coalesced Finalize/Broadcast/Heartbeat preserve parent control-frame ordering', { timeout: 20000 }, async () => {
    const { sims, cleanup } = await startFiveBossBattle()
    try {
        const source = sims[0]
        const before = source.frames.length
        source.socket.write([[0, [2]], [1, [{ marker: 'after-finalize-control' }]], [0, [5]]].map(f => JSON.stringify(f) + '\0').join(''))
        await source.until(() => source.frames.slice(before).filter(f => f.data[0] === 1).length >= 3)
        const received = source.frames.slice(before).filter(f => f.data[0] === 1)
        assert.deepEqual(received.map(f => f.data[1][0]), [2, 3, 3], 'Finalize ack precedes the following broadcast/heartbeat acknowledgements')
        for (const sim of sims.slice(1)) await sim.until(() => relays(sim, 'after-finalize-control').length === 1)
        await pause(100)
        for (const sim of sims.slice(1)) assert.equal(relays(sim, 'after-finalize-control').length, 1)
    } finally { await cleanup() }
})

test('replaced battle socket cannot relay into the current room', { timeout: 20000 }, async () => {
    const { room, sims, members, port, cleanup } = await startFiveBossBattle({ mixed: true })
    let replacement
    try {
        const old = manager.getBattleClient(members[1].connectionId)
        replacement = new SimClient(port, members[1], room)
        await replacement.open()
        replacement.sceneReady()
        await replacement.until(() => manager.getBattleClient(members[1].connectionId) !== old)
        await pause(100)
        assert.equal(sims[1].closed, false, 'main keeps the superseded socket quarantined while its replacement is live')
        assert.equal(manager.isCurrentBattleClient(old), false)
        assert.deepEqual(manager.snapshotBattleRelayRecipients(old), [])
        sims[1].send([1, [{ marker: 'stale-socket-frame' }]])
        load('multi/tcp/battle').handleBattleMessage(old.socket, [1, [{ marker: 'stale-socket-frame' }]])
        await pause(100)
        assert.equal(relays(sims[0], 'stale-socket-frame').length, 0)
        assert.equal(relays(sims[2], 'stale-socket-frame').length, 0)
        sims[1] = replacement
        await exchange(sims, 1, [1, [{ marker: 'replacement-current' }]], 'replacement-current', [0, 2])
    } finally { replacement?.socket.destroy(); await cleanup() }
})

test('child exit closes owned sockets, sends Leave, restarts once and then falls back to native', { timeout: 20000 }, async () => {
    const { room, sims, members, port, cleanup } = await startFiveBossBattle({ mixed: true })
    const extra = []
    try {
        bridge.child.kill()
        await Promise.all(sims.slice(1).map(sim => sim.until(() => sim.closed)))
        await sims[0].until(() => members.slice(1).every(m => sims[0].leaves().includes(m.connectionId)))
        await sims[0].until(() => bridge.isReady)
        assert.equal(sims[0].closed, false, 'native survivor remains connected')
        for (let i = 1; i < 3; i++) {
            const sim = new SimClient(port, members[i], room); extra.push(sim); await sim.open(); sim.sceneReady(); sims[i] = sim
        }
        await exchange(sims, 1, [1, [{ marker: 'after-relay-restart' }]], 'after-relay-restart', [0, 2])
        bridge.child.kill()
        await Promise.all(sims.slice(1).map(sim => sim.until(() => sim.closed)))
        await sims[0].until(() => bridge.child === null && !bridge.isReady)
        for (let i = 1; i < 3; i++) {
            const sim = new SimClient(port, members[i], room); extra.push(sim); await sim.open(); sim.sceneReady(); sims[i] = sim
            assert.equal(isRelayProxySocket(manager.getBattleClient(members[i].connectionId).socket), false)
        }
        await exchange(sims, 1, [2, null, { marker: 'native-fallback-after-limit' }], 'native-fallback-after-limit', [0, 2])
    } finally { for (const sim of extra) sim.socket.destroy(); await cleanup() }
})
