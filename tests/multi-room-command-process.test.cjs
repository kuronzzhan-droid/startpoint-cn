const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const { fork } = require('node:child_process')
const { performance } = require('node:perf_hooks')
const out = process.env.STARPOINT_TEST_OUT_DIR || path.resolve(__dirname, '../out')
const { CommandProcessTransport } = require(path.join(out, 'multi/coordinator/command-process'))
const { RoomCommandGateway } = require(path.join(out, 'multi/coordinator/command-gateway'))
const { createRoomCommandId } = require(path.join(out, 'multi/coordinator/command-protocol'))
const helperPath = path.resolve(__dirname, 'helpers/multi-command-observer.cjs')
const { request } = require(helperPath)
const active = new Set()
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'multi-command-process-'))
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
function envelope(kind, payload = {}, extra = {}) {
    return { protocol: 1, commandId: createRoomCommandId(), kind, payload, timeoutMs: 1000, ...extra }
}
async function fixture(options = {}) {
    const transport = new CommandProcessTransport({ registerModule: helperPath,
        childPath: path.join(out, 'multi/coordinator/command-process-child.js'), ...options })
    active.add(transport)
    await transport.start()
    return transport
}
function waitMessage(child, type) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => finish(Error(`observer ${type} timeout`)), 5000)
        const onError = error => finish(error)
        const onExit = () => finish(Error(`observer exited before ${type}`))
        const onMessage = message => {
            if (message?.t === 'observer-failed') finish(Error(message.reason))
            else if (message?.t === type) finish(null, message)
        }
        function finish(error, value) {
            clearTimeout(timeout); child.off('error', onError); child.off('exit', onExit); child.off('message', onMessage)
            if (error) reject(error); else resolve(value)
        }
        child.on('error', onError); child.on('exit', onExit); child.on('message', onMessage)
    })
}

test('the child alone owns fixture state and gateway results are independent JSON copies', { timeout: 10000 }, async () => {
    const transport = await fixture()
    try {
        const gateway = new RoomCommandGateway(transport)
        const payload = { value: 7 }
        const result = await gateway.execute('FIXTURE_SET', payload)
        payload.value = 99; result.counter = 100; result.nested.ownerPid = -1
        const read = await gateway.execute('FIXTURE_READ', {})
        assert.equal(read.counter, 7)
        assert.equal(read.version, 1)
        assert.equal(read.nested.ownerPid, transport.pid)
        assert.notEqual(read.nested.ownerPid, process.pid)
        const metadata = transport.bootstrapMetadata(); metadata.ownerPid = -1
        assert.equal(transport.bootstrapMetadata().ownerPid, transport.pid)
    } finally { await transport.stop() }
})

test('application results deduplicate one command ID and reject a different owner epoch', { timeout: 10000 }, async () => {
    const transport = await fixture()
    try {
        const command = envelope('FIXTURE_DELAY', { ms: 30 })
        const [a, b] = await Promise.all([transport.submit(command), transport.submit(command)])
        assert.equal(a.status, 'completed'); assert.deepEqual(a, b); assert.equal(a.value.counter, 1)
        const rejected = await transport.submit(envelope('FIXTURE_SET', { value: 22 }, { expectedOwnerEpoch: 'previous-owner' }))
        assert.equal(rejected.status, 'rejected'); assert.equal(rejected.code, 'OWNER_EPOCH_MISMATCH')
        assert.equal(rejected.outcomeUnknown, false)
        const queried = await transport.queryResult(command.commandId); queried.value.counter = -1
        assert.equal((await transport.queryResult(command.commandId)).value.counter, 1)
    } finally { await transport.stop() }
})

test('transport timeout remains unknown and retains its budget until the application result', { timeout: 10000 }, async () => {
    const transport = await fixture({ requestTimeoutMs: 50 })
    try {
        const command = envelope('FIXTURE_DELAY', { ms: 250 }, { timeoutMs: 10 })
        const result = await transport.submit(command)
        assert.equal(result.status, 'unknown'); assert.equal(result.outcomeUnknown, true)
        assert.equal(result.code, 'PROCESS_RESPONSE_TIMEOUT')
        assert.equal(transport.diagnostics().pendingMessages, 1, 'send callback and response timeout do not release accepted work')
        assert.equal((await transport.queryResult(command.commandId)).status, 'pending')
        await sleep(300)
        const settled = await transport.queryResult(command.commandId)
        assert.equal(settled.status, 'completed'); assert.equal(settled.value.counter, 1)
        assert.equal(transport.diagnostics().pendingMessages, 0)
        assert.equal((await transport.submit(command)).value.counter, 1, 'retry queries the same retained operation')
    } finally { await transport.stop() }
})

test('process transport bounds pending messages and bytes before sending extra work', { timeout: 10000 }, async () => {
    const transport = await fixture({ maxPending: 1, maxPendingBytes: 512 })
    try {
        const command = envelope('FIXTURE_DELAY', { ms: 150 })
        const accepted = transport.submit(command)
        const rejected = await transport.submit(envelope('FIXTURE_SET', { value: 2 }))
        assert.equal(rejected.status, 'rejected'); assert.equal(rejected.code, 'PROCESS_QUEUE_LIMIT')
        assert.equal(rejected.outcomeUnknown, false)
        assert.equal((await accepted).value.counter, 1)
        const oversized = await transport.submit(envelope('FIXTURE_READ', { extra: 'x'.repeat(600) }))
        assert.equal(oversized.code, 'PROCESS_QUEUE_LIMIT')
        assert.equal(transport.diagnostics().pendingMessages, 0)
    } finally { await transport.stop() }
})

test('foundation only: independent observer gets command results before the blocked parent resumes', { timeout: 15000 }, async () => {
    const transport = await fixture()
    const observer = fork(helperPath, ['observer'], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'], execArgv: [] })
    try {
        await waitMessage(observer, 'observer-ready')
        const armed = waitMessage(observer, 'observer-armed'), complete = waitMessage(observer, 'observer-complete')
        const markerPath = path.join(scratch, 'completed-during-parent-block')
        observer.send({ endpoint: transport.bootstrapMetadata().observerEndpoint,
            ownerEpoch: transport.ownerEpoch, markerPath })
        await armed
        const started = performance.now(), until = started + 1000
        while (performance.now() < until) {}
        assert.equal(fs.readFileSync(markerPath, 'utf8'), 'observer-completed', 'witness exists while parent still cannot process IPC callbacks')
        const blockedMs = performance.now() - started
        const result = await complete
        observer.send({ t: 'observer-result-consumed' })
        assert.equal(result.samples.length, 10)
        assert.ok(blockedMs >= 1000)
        for (const sample of result.samples) {
            assert.equal(sample.result.status, 'completed')
            assert.equal(sample.result.value.counter, 0)
            assert.equal(sample.result.value.nested.ownerPid, transport.pid)
            assert.ok(sample.elapsedMs < 250, `fixture command roundtrip ${sample.elapsedMs}ms`)
        }
        console.log(`[COMMAND-FOUNDATION] parentBlockedMs=${blockedMs.toFixed(1)} observerSamples=10 maxObserverRttMs=${Math.max(...result.samples.map(x => x.elapsedMs)).toFixed(1)}; no TCP battle/barrier/lease ownership claim`)
    } finally { observer.kill(); await transport.stop() }
})

test('child death makes pending commands unknown and never falls back to embedded state', { timeout: 10000 }, async () => {
    const transport = await fixture()
    try {
        const command = envelope('FIXTURE_DELAY', { ms: 2000 })
        const pending = transport.submit(command)
        const endpoint = transport.bootstrapMetadata().observerEndpoint
        let status
        for (let attempt = 0; attempt < 100; attempt++) {
            status = (await request(endpoint, { op: 'query', commandId: command.commandId })).result.status
            if (status === 'pending') break
            await sleep(5)
        }
        assert.equal(status, 'pending', 'kill only after child accepted the actual application')
        process.kill(transport.pid)
        const result = await pending
        assert.equal(result.status, 'unknown'); assert.equal(result.outcomeUnknown, true)
        assert.equal((await transport.queryResult(command.commandId)).status, 'unknown')
        assert.equal((await transport.submit(envelope('FIXTURE_READ'))).code, 'PROCESS_UNAVAILABLE')
        assert.equal(transport.diagnostics().closed, true)
        assert.equal(transport.diagnostics().pendingMessages, 0)
        await assert.rejects(transport.start(), /cannot be started twice/)
    } finally { await transport.stop() }
})

test('explicit bootstrap failure rejects startup without enabling another owner', { timeout: 10000 }, async () => {
    const transport = new CommandProcessTransport({ registerModule: path.join(scratch, 'missing-bootstrap.cjs'),
        childPath: path.join(out, 'multi/coordinator/command-process-child.js') })
    active.add(transport)
    try {
        await assert.rejects(transport.start(), /PROCESS_BOOTSTRAP_FAILED/)
        assert.equal(transport.diagnostics().ready, false)
        assert.equal(transport.diagnostics().closed, true)
        assert.equal((await transport.submit(envelope('FIXTURE_READ'))).status, 'unknown')
    } finally { await transport.stop() }
})

after(async () => {
    for (const transport of active) await transport.stop()
    const resolved = path.resolve(scratch), temp = path.resolve(os.tmpdir()) + path.sep
    assert.ok(resolved.startsWith(temp) && path.basename(resolved).startsWith('multi-command-process-'))
    fs.rmSync(resolved, { recursive: true })
})
