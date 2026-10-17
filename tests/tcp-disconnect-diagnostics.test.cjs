const test = require('node:test')
const assert = require('node:assert/strict')

process.env.MEMORY_DIAGNOSTICS = 'true'
const diagnostics = require('../out/multi/tcp/disconnect-diagnostics')
const { collectMemoryDiagnostics } = require('../out/lib/memory-diagnostics')

test('TCP disconnect diagnostics retain the first cause and use bounded counters', () => {
    const heartbeat = {}
    diagnostics.markTcpDisconnectReason(heartbeat, 'heartbeat_timeout')
    diagnostics.markTcpDisconnectReason(heartbeat, 'socket_error')
    assert.equal(diagnostics.readTcpDisconnectReason(heartbeat, true), 'heartbeat_timeout')
    assert.equal(diagnostics.readTcpDisconnectReason(heartbeat, true), 'heartbeat_timeout', 'reads do not consume the first cause')
    assert.equal(diagnostics.finishTcpDisconnect(heartbeat, true), 'heartbeat_timeout')

    const peer = {}
    diagnostics.markTcpDisconnectReason(peer, 'peer_fin')
    assert.equal(diagnostics.finishTcpDisconnect(peer, false), 'peer_fin')

    const unknown = {}
    assert.equal(diagnostics.finishTcpDisconnect(unknown, false), 'unknown_close')

    const counters = collectMemoryDiagnostics().counters.tcpDisconnects
    assert.equal(counters.total, 3)
    assert.equal(counters.heartbeat_timeout, 1)
    assert.equal(counters.peer_fin, 1)
    assert.equal(counters.unknown_close, 1)
    assert.equal(counters.socket_error, 0)
    assert.equal(counters.relay_exit, 0)
    assert.equal(Object.keys(counters).length, 23)
})
