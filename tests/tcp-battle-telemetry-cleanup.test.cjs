const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const { EventEmitter } = require('node:events')

// Execute the compiled server handlers and real telemetry/first-cause logic.
// All networking, session ownership and business dependencies are modeled;
// this fixture does not listen on a port or open any database.
function loadCompiled(relative, stubs) {
    const filename = path.resolve(__dirname, '../out', relative)
    const isolated = new Module(filename, module)
    isolated.filename = filename
    isolated.paths = Module._nodeModulePaths(path.dirname(filename))
    const realRequire = Module.createRequire(filename)
    isolated.require = request => stubs.has(request) ? stubs.get(request) : realRequire(request)
    isolated._compile(fs.readFileSync(filename, 'utf8'), filename)
    return isolated.exports
}

async function fixture(t) {
    let now = 1_000, connectionHandler, queue = Promise.resolve()
    const indexed = new Map(), current = new Map()
    const memory = { registerMemoryCounters() {}, observeServerConnections() {} }
    const { BattleTelemetry } = loadCompiled('multi/battle-telemetry.js',
        new Map([['../lib/memory-diagnostics', memory]]))
    const telemetry = new BattleTelemetry(() => now, () => {}, 0)
    const diagnostics = loadCompiled('multi/tcp/disconnect-diagnostics.js',
        new Map([['../../lib/memory-diagnostics', memory]]))
    const roomNumber = 'cleanup-room'
    telemetry.begin({ room_number: roomNumber, category: 2, quest_id: 1099001,
        lifecycle: { battleSessionId: 'cleanup-battle' }, mates: [{ viewer_id: 11, com_id: 0 }] })
    const coordinator = {
        enqueueRoomCommand(_room, command) {
            const result = queue.then(command)
            queue = result.then(() => {}, () => {})
            return result
        },
    }
    const manager = {
        findClientBySocket: socket => indexed.get(socket),
        isCurrentBattleClient: client => current.get(client.connectionId) === client,
        removeClient(client) {
            if (indexed.get(client.socket) === client) indexed.delete(client.socket)
            if (current.get(client.connectionId) === client) current.delete(client.connectionId)
        },
    }
    const rawServer = new EventEmitter()
    rawServer.listen = (_port, _host, callback) => callback()
    rawServer.close = callback => callback?.()
    const server = loadCompiled('multi/tcp/server.js', new Map([
        ['net', { createServer: handler => { connectionHandler = handler; return rawServer } }],
        ['../../lib/memory-diagnostics', memory],
        ['../../lib/client-admission', { clientAdmission: () => ({ checkActivity: () => ({ ok: true }) }) }],
        ['./handshake', { handleHandshake() {} }],
        ['./battle', { handleBattleMessage() {}, discardPinnedBattleControlsForShutdown() {} }],
        ['../state/SessionManager', { sessionManager: manager }],
        ['../../lib/game-logging', { gameVerboseLog() {} }],
        ['./reliable-send', { clearReliableSendState() {} }],
        ['./disconnect-diagnostics', diagnostics],
        ['../coordinator/embedded', { embeddedMultiCoordinator: coordinator }],
        ['../battle-telemetry', { battleTelemetry: telemetry }],
        ['../five-boss/connection-diagnostic', { fiveBossConnectionDiagnostics: { socketEvent() {} } }],
        ['../../lounge/tcp', { detachLoungeSocket() {}, handleLoungeHandshake() {}, handleLoungeMessage() {} }],
    ]))
    await server.startSessionServer()
    t.after(async () => { await server.stopSessionServer(); telemetry.end(roomNumber, 'cleanup') })
    const connect = old => {
        if (old) { old.superseded = true; indexed.delete(old.socket); current.delete(old.connectionId) }
        const socket = new EventEmitter()
        Object.assign(socket, { remoteAddress: '127.0.0.1', remotePort: 1,
            setNoDelay() {}, setKeepAlive() {}, setEncoding() {},
            pause() { this.paused = true; return this },
            destroy() { socket.emit('close', false) } })
        connectionHandler(socket)
        const client = { socket, connectionId: 'same-battle-seat', roomNumber,
            viewerId: 11, isBattle: true, superseded: false }
        indexed.set(socket, client); current.set(client.connectionId, client)
        telemetry.connected(roomNumber, 11)
        return client
    }
    return { telemetry, diagnostics, indexed, current, roomNumber, connect,
        at(value) { now = value },
        flush: () => coordinator.enqueueRoomCommand(roomNumber, () => {}),
        end: () => telemetry.end(roomNumber, 'disbanded:test').members[0] }
}

test('error cleanup before close records its first cause and final silence exactly once', async t => {
    const x = await fixture(t), client = x.connect()
    x.at(1_100); x.telemetry.packet(x.roomNumber, 11, 1)
    x.at(91_100); client.socket.emit('error', new Error('modeled socket error'))
    await x.flush()
    assert.equal(x.indexed.has(client.socket), false, 'error cleanup has removed the socket before close')
    x.at(120_000); client.socket.emit('close', true)
    await x.flush()
    const member = x.end()
    assert.deepEqual(member.disconnects, { socket_error: 1 })
    assert.equal(member.maxInboundGapMs, 90_000, 'time after error cleanup is offline time')
})

test('early error cleanup keeps an already-recorded timeout cause until close', async t => {
    const x = await fixture(t), client = x.connect()
    x.diagnostics.markTcpDisconnectReason(client.socket, 'level_next_timeout')
    client.socket.emit('error', new Error('modeled consequence of timeout'))
    await x.flush()
    client.socket.emit('close', true)
    await x.flush()
    assert.deepEqual(x.end().disconnects, { level_next_timeout: 1 })
})

test('superseded error cleanup and late close cannot record a replacement as disconnected', async t => {
    const x = await fixture(t), old = x.connect()
    x.at(1_100); x.telemetry.packet(x.roomNumber, 11, 1)
    old.socket.emit('error', new Error('modeled old socket error'))
    x.at(1_200); const replacement = x.connect(old)
    await x.flush()
    x.at(5_000); old.socket.emit('close', true)
    await x.flush()
    assert.equal(x.indexed.get(replacement.socket), replacement)
    assert.equal(x.current.get(replacement.connectionId), replacement)
    const member = x.end()
    assert.deepEqual(member.disconnects, {})
    assert.equal(member.maxInboundGapMs, 3_800, 'late old close must not stop the replacement silence interval')
})
