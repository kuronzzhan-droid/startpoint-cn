'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path'), processes = require('node:child_process')
const out = process.env.STARPOINT_TEST_OUT_DIR
if (!out) throw Error('Use the current isolated build via STARPOINT_TEST_OUT_DIR')
const load = name => require(path.join(out, name))

async function promptly(promise, label) {
    let timeout
    try {
        return await Promise.race([promise, new Promise((_, reject) => {
            timeout = setTimeout(() => reject(Error(`${label}: held admission did not drain`)), 1000)
        })])
    } finally { clearTimeout(timeout) }
}

test('synchronous fork failure releases ingress without a child and seals lazy runtime against late callbacks', { timeout: 5000 }, async () => {
    const originalFork = processes.fork
    const savedEnv = { process: process.env.MULTI_REALTIME_PROCESS, child: process.env.MULTI_REALTIME_OWNER_CHILD }
    process.env.MULTI_REALTIME_PROCESS = '1'; delete process.env.MULTI_REALTIME_OWNER_CHILD
    const shutdown = load('lib/shutdown-state')
    const fault = Object.assign(Error('controlled synchronous fork failure'), { code: 'EAGAIN' })
    let forks = 0, heldDrain, transport, runtime
    // This stub never creates a process or opens a listener/database.
    processes.fork = () => {
        forks++
        // Capture the global drain while start() still owns its ingress scope.
        heldDrain = shutdown.drainServerWork()
        throw fault
    }
    try {
        const { CommandProcessTransport } = load('multi/coordinator/command-process')
        transport = new CommandProcessTransport({ registerModule: path.join(out, 'multi/coordinator/realtime-owner-bootstrap.js') })
        await assert.rejects(transport.start(), error => error === fault)
        assert.equal(transport.pid, undefined, 'synchronous fork failed before assigning any child')
        assert.equal(transport.isReady, false)
        assert.equal(transport.diagnostics().closed, true)
        assert.equal(transport.diagnostics().ingressClosed, true)
        await promptly(heldDrain, 'direct transport ingress')
        await promptly(shutdown.drainServerWork(), 'direct transport global work')
        await promptly(transport.quiesce(), 'no-child quiesce')
        await promptly(transport.drain(), 'no-child transport drain')
        assert.equal(forks, 1)

        runtime = load('multi/coordinator/default-runtime')
        const gateway = runtime.getRoomCommandGateway()
        const commandId = load('multi/coordinator/command-protocol').createRoomCommandId()
        await assert.rejects(gateway.execute('room.query', { roomNumber: 111111 }, { commandId }),
            error => error.outcomeUnknown === true)
        assert.equal(forks, 2)
        await promptly(heldDrain, 'lazy runtime ingress')
        await promptly(gateway.drain(), 'lazy gateway actual completion')
        await promptly(shutdown.drainServerWork(), 'lazy runtime global work')
        const status = runtime.realtimeOwnerStatus()
        assert.equal(status.mode, 'process'); assert.equal(status.phase, 'failed'); assert.equal(status.ready, false)
        assert.equal(status.endpoint, null); assert.equal(status.transport.closed, true)
        assert.equal(status.transport.pendingMessages, 0); assert.equal(status.transport.businessPending, 0)

        // Check sticky failure before global shutdown; SERVER_CLOSING must not
        // mask an otherwise accidental lazy restart or embedded fallback.
        assert.equal(shutdown.isServerShuttingDown(), false)
        assert.strictEqual(runtime.getRoomCommandGateway(), gateway)
        await assert.rejects(gateway.queryResult(commandId), { code: 'GATEWAY_CLOSED' })
        await assert.rejects(gateway.execute('room.query', { roomNumber: 111111 }, { commandId }), { code: 'GATEWAY_CLOSED' })
        assert.equal(forks, 2, 'late query/execute cannot create a replacement owner')
        shutdown.beginServerShutdown()
        await promptly(runtime.quiesceRealtimeSessionServer(), 'failed runtime quiesce')
        await promptly(shutdown.drainServerWork(), 'sealed runtime global drain')
        await promptly(runtime.stopRealtimeSessionServer(), 'failed runtime stop')
        assert.equal(forks, 2)
    } finally {
        processes.fork = originalFork
        if (transport) await transport.abort()
        if (runtime) await runtime.failRealtimeOwner()
        if (savedEnv.process === undefined) delete process.env.MULTI_REALTIME_PROCESS
        else process.env.MULTI_REALTIME_PROCESS = savedEnv.process
        if (savedEnv.child === undefined) delete process.env.MULTI_REALTIME_OWNER_CHILD
        else process.env.MULTI_REALTIME_OWNER_CHILD = savedEnv.child
    }
})
