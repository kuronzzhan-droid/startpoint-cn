'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const { fork } = require('node:child_process')
const { performance } = require('node:perf_hooks')
const out = process.env.STARPOINT_TEST_OUT_DIR || path.resolve(__dirname, '../out')
const helper = path.resolve(__dirname, 'helpers/multi-owner-shutdown-fixture.cjs')
const load = name => require(path.join(out, name))
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
async function until(predicate, label, timeoutMs = 5000) {
    const end = performance.now() + timeoutMs
    while (!predicate()) { assert.ok(performance.now() < end, `timed out: ${label}`); await sleep(5) }
}
function envelope(kind, payload = {}, timeoutMs = 5000) {
    return { protocol: 1, commandId: load('multi/coordinator/command-protocol').createRoomCommandId(), kind, payload, timeoutMs }
}
async function fixture(t, options = {}) {
    const { CommandProcessTransport } = load('multi/coordinator/command-process')
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'multi-owner-shutdown-'))
    const transport = new CommandProcessTransport({ registerModule: helper,
        childPath: path.join(out, 'multi/coordinator/command-process-child.js'), ...options })
    t.after(async () => {
        // A failed shutdown regression must not leave its synthetic owner alive.
        const fallback = setTimeout(() => { void transport.abort() }, 2000)
        try { await transport.stop() } finally { clearTimeout(fallback) }
        assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep))
        fs.rmSync(directory, { recursive: true, force: true })
    })
    await transport.start()
    return { transport, directory }
}
async function assertPortClosed(port) {
    const net = require('node:net')
    await new Promise((resolve, reject) => {
        const socket = net.createConnection({ host: '127.0.0.1', port })
        socket.once('error', resolve)
        socket.once('connect', () => { socket.destroy(); reject(Error('quiesced fixture still accepts TCP')) })
    })
}

function isolatedCase(mode, t) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'multi-owner-shutdown-'))
    const child = fork(helper, [mode], { execArgv: [], env: { ...process.env, STARPOINT_TEST_OUT_DIR: out, DATA_DIR: directory }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
    let output = '', result
    child.stdout.on('data', bytes => { output = (output + bytes).slice(-16000) })
    child.stderr.on('data', bytes => { output = (output + bytes).slice(-16000) })
    child.on('message', message => { result = message })
    t.after(() => {
        if (child.exitCode === null) child.kill()
        assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep))
        fs.rmSync(directory, { recursive: true, force: true })
    })
    return new Promise((resolve, reject) => {
        child.once('error', reject)
        child.once('close', code => {
            if (code !== 0 || result?.ok !== true) return reject(Error(`${result?.error || 'No success report'}\n${output}`))
            resolve(result.report)
        })
    })
}

test('real runtime stop is sticky across a late same-ID publisher timer; explicit lifecycle restart changes epoch', { timeout: 20000 }, async t => {
    const report = await isolatedCase('--runtime-sticky', t)
    assert.notEqual(report.original.pid, process.pid)
    assert.ok(report.original.endpoint.port > 0)
    assert.equal(report.stopped.ready, false)
    assert.notEqual(report.restarted.ownerEpoch, report.original.ownerEpoch)
    t.diagnostic(JSON.stringify(report))
})

test('accepted delayed child RPC retains admission through quiesce and stop waits beyond the former one-second kill', { timeout: 12000 }, async t => {
    const { withServerWorkAdmission, hasServerWorkAdmission } = load('lib/shutdown-state')
    const business = deferred(), entered = deferred()
    t.after(() => business.resolve())
    let writes = 0, handlerAdmission = false
    const { transport, directory } = await fixture(t, { businessHandler: async (kind, payload) => {
        assert.equal(kind, 'shutdown.fixture.persist')
        handlerAdmission = hasServerWorkAdmission()
        entered.resolve(); await business.promise
        writes++
        return { persisted: true, value: payload.value }
    } })
    const command = envelope('shutdown.business', { delayMs: 150, value: 17, marker: path.join(directory, 'accepted') })
    const accepted = withServerWorkAdmission(() => transport.submit(command))
    await until(() => fs.existsSync(command.payload.marker), 'child accepted command')
    await transport.quiesce()
    await assertPortClosed(transport.bootstrapMetadata().port)
    const denied = await transport.submit(envelope('shutdown.read'))
    assert.equal(denied.status, 'rejected'); assert.equal(denied.outcomeUnknown, false)
    assert.match(denied.code, /CLOSING|QUIESC|CLOSED/)
    await entered.promise
    assert.equal(handlerAdmission, true, 'verified IPC admission restores parent scope after the child await')
    let stopped = false
    const stop = transport.stop().then(() => { stopped = true })
    await sleep(1150)
    assert.equal(stopped, false, 'graceful owner stop has no independent one-second kill')
    assert.equal(process.kill(transport.pid, 0), true, 'same accepted owner is still alive')
    assert.ok(transport.diagnostics().businessPending > 0)
    business.resolve()
    const result = await accepted
    assert.equal(result.status, 'completed'); assert.equal(result.value.result.persisted, true)
    await stop
    assert.equal(writes, 1)
    assert.equal(transport.diagnostics().pendingMessages, 0)
    assert.equal(transport.diagnostics().businessPending, 0)
})

test('a previously admitted parent scope may enqueue its continuation after await during quiesce', { timeout: 10000 }, async t => {
    const { withServerWorkAdmission, hasServerWorkAdmission } = load('lib/shutdown-state')
    const release = deferred(), ready = deferred()
    t.after(() => release.resolve())
    let writes = 0
    const { transport } = await fixture(t, { businessHandler: async () => {
        assert.equal(hasServerWorkAdmission(), true)
        writes++; return { persisted: true }
    } })
    const admitted = withServerWorkAdmission(async () => {
        assert.equal((await transport.submit(envelope('shutdown.read'))).status, 'completed')
        ready.resolve(); await release.promise
        return transport.submit(envelope('shutdown.business', { value: 22 }))
    })
    await ready.promise
    await transport.quiesce()
    assert.equal((await transport.submit(envelope('shutdown.read'))).status, 'rejected')
    release.resolve()
    assert.equal((await admitted).status, 'completed')
    await transport.drain()
    assert.equal(writes, 1)
    assert.equal(transport.diagnostics().pendingMessages, 0)
    assert.equal(transport.diagnostics().businessPending, 0)
})

test('unknown gateway result remains reconciliable while drain holds actual IPC and business budgets until ACK', { timeout: 12000 }, async t => {
    const { withServerWorkAdmission } = load('lib/shutdown-state')
    const business = deferred(), entered = deferred()
    t.after(() => business.resolve())
    let writes = 0
    const { transport } = await fixture(t, { requestTimeoutMs: 50, businessHandler: async () => {
        entered.resolve(); await business.promise; writes++; return { persisted: true }
    } })
    const { RoomCommandGateway } = load('multi/coordinator/command-gateway')
    const gateway = new RoomCommandGateway(transport, { timeoutMs: 30 })
    const id = load('multi/coordinator/command-protocol').createRoomCommandId()
    const waiter = withServerWorkAdmission(() => gateway.execute('shutdown.business', { value: 33 }, { commandId: id, timeoutMs: 30 }))
    const rejected = assert.rejects(waiter, error => error.outcomeUnknown === true && error.commandId === id)
    await entered.promise; await rejected; await sleep(90)
    assert.ok(transport.diagnostics().pendingMessages > 0, 'waiter timeout is not application completion')
    await transport.quiesce()
    assert.equal((await transport.queryResult(id)).status, 'pending')
    let drained = false
    const drain = transport.drain().then(() => { drained = true })
    await sleep(100)
    assert.equal(drained, false)
    business.resolve(); await drain
    const result = await transport.queryResult(id)
    assert.equal(result.status, 'completed'); assert.equal(result.value.calls, 1)
    assert.equal(result.value.result.persisted, true); assert.equal(writes, 1)
    assert.equal(transport.diagnostics().pendingMessages, 0)
    assert.equal(transport.diagnostics().businessPending, 0)
    assert.equal(gateway.inspect().pending, 0)
    gateway.close()
})

test('embedded executor quiesce drains already accepted queued work and rejects fresh IDs without replay', async t => {
    const { RoomCommandExecutor } = load('multi/coordinator/command-executor')
    const executor = new RoomCommandExecutor({ maxConcurrent: 1 })
    const gate = deferred(), started = deferred()
    t.after(() => { gate.resolve(); executor.close() })
    const calls = []
    executor.register('shutdown.queue', async payload => {
        calls.push(payload.index)
        if (payload.index === 1) { started.resolve(); await gate.promise }
        return { index: payload.index }
    })
    const first = envelope('shutdown.queue', { index: 1 }), second = envelope('shutdown.queue', { index: 2 })
    const a = executor.submit(first), b = executor.submit(second)
    await started.promise
    assert.equal(executor.inspect().queued, 1)
    executor.quiesce()
    const rejected = await executor.submit(envelope('shutdown.queue', { index: 3 }))
    assert.equal(rejected.status, 'rejected'); assert.equal(rejected.outcomeUnknown, false)
    let drained = false
    const drain = executor.drain().then(() => { drained = true })
    await sleep(30)
    assert.equal(drained, false)
    gate.resolve()
    assert.equal((await a).status, 'completed'); assert.equal((await b).status, 'completed')
    await drain
    assert.deepEqual(calls, [1, 2])
    assert.equal((await executor.submit(second)).value.index, 2, 'same accepted ID remains a result lookup')
    assert.deepEqual(calls, [1, 2]); assert.equal(executor.inspect().pending, 0)
})

test('parent business continuation requires an exact live token, command and owner epoch', async () => {
    const { createAcceptedRealtimeBusinessScope, dispatchAcceptedRealtimeBusiness } = load('multi/coordinator/parent-business-admission')
    const { hasServerWorkAdmission } = load('lib/shutdown-state')
    const scope = createAcceptedRealtimeBusinessScope({ ownerEpoch: 'synthetic-owner', commandId: 'synthetic-accepted-command' })
    let writes = 0
    const operation = async () => { assert.equal(hasServerWorkAdmission(), true); writes++; return 'written' }
    try {
        for (const proof of [undefined, {}, { ...scope.proof, admissionToken: 'f'.repeat(64) },
            { ...scope.proof, ownerEpoch: 'old-owner' }, { ...scope.proof, commandId: 'different-command' },
            { ...scope.proof, cleanup: true }]) {
            await assert.rejects(() => dispatchAcceptedRealtimeBusiness(proof, operation), /ADMISSION_INVALID/)
        }
        assert.equal(writes, 0)
        assert.equal(await dispatchAcceptedRealtimeBusiness(scope.proof, operation), 'written')
        assert.equal(writes, 1)
    } finally { scope.release() }
    await assert.rejects(() => dispatchAcceptedRealtimeBusiness(scope.proof, operation), /ADMISSION_INVALID/)
    assert.equal(writes, 1, 'released proof cannot create another write')
})

test('global server closing prohibits even explicit owner lifecycle restart', { timeout: 15000 }, async t => {
    const report = await isolatedCase('--runtime-global-closing', t)
    assert.equal(report.original.ready, true)
    assert.equal(report.stopped.ready, false)
    assert.ok(report.stopped.pid === report.original.pid || report.stopped.pid === report.fixturePid)
    t.diagnostic(JSON.stringify(report))
})

test('after child ingress cutoff an unproven, forged or old-epoch business RPC never enters the parent writer', { timeout: 10000 }, async t => {
    const { withServerWorkAdmission } = load('lib/shutdown-state')
    let writes = 0
    const { transport, directory } = await fixture(t, { businessHandler: async () => {
        writes++; return { persisted: true }
    } })
    const commands = ['none', 'token', 'epoch'].map(mode => envelope('shutdown.invalidBusiness', {
        mode, delayMs: 150, marker: path.join(directory, `accepted-${mode}`),
    }))
    const accepted = commands.map(command => withServerWorkAdmission(() => transport.submit(command)))
    await until(() => commands.every(command => fs.existsSync(command.payload.marker)), 'all validation fixtures accepted')
    await transport.quiesce()
    const results = await Promise.all(accepted)
    for (const result of results) {
        assert.equal(result.status, 'completed'); assert.equal(result.value.rejected, true)
        assert.match(result.value.code, /SERVER_CLOSING|ADMISSION_INVALID|OWNER_EPOCH_MISMATCH/)
    }
    assert.equal(writes, 0)
    await transport.drain()
    assert.equal(transport.diagnostics().businessPending, 0)
})

test('quiesce discards a genuinely pinned battle control, drains its grant and prevents late-unpin business work', { timeout: 12000 }, async t => {
    const { withServerWorkAdmission } = load('lib/shutdown-state')
    let writes = 0
    const { transport, directory } = await fixture(t, {
        childEnv: { MULTI_REALTIME_OWNER_CHILD: '1', MULTI_REALTIME_PROCESS: '0', MULTI_BATTLE_RELAY_PROCESS: '0' },
        businessHandler: async () => { writes++; return { persisted: true } },
    })
    const marker = path.join(directory, 'pinned-control')
    const command = await withServerWorkAdmission(() => transport.submit(envelope('shutdown.pin', { marker })))
    assert.equal(command.status, 'completed'); assert.equal(command.value.pinned, true)
    assert.equal(fs.readFileSync(marker, 'utf8'), 'control-pinned')
    await transport.quiesce()
    // Child onDrain resolves the old claim only after the actual TCP work has
    // drained, and asserts the production callback remains a tombstone.
    await transport.drain()
    assert.equal(writes, 0, 'discarded Finalize may not enqueue presence/proof business work')
    assert.equal(transport.diagnostics().pendingMessages, 0)
    assert.equal(transport.diagnostics().businessPending, 0)
})

test('slow parent party persistence retains shutdown admission without blocking the next real lobby heartbeat', { timeout: 12000 }, async t => {
    const { withServerWorkAdmission } = load('lib/shutdown-state')
    const gate = deferred(), entered = deferred()
    t.after(() => gate.resolve())
    let saves = 0, saved
    const { transport, directory } = await fixture(t, {
        childEnv: { MULTI_REALTIME_OWNER_CHILD: '1', MULTI_REALTIME_PROCESS: '0', MULTI_BATTLE_RELAY_PROCESS: '0' },
        businessHandler: async (kind, payload) => {
            if (kind !== 'player.party') return { touched: true }
            saved = payload; entered.resolve(); await gate.promise; saves++
            return { persisted: true }
        },
    })
    const party = await withServerWorkAdmission(() => transport.submit(envelope('shutdown.lobbyParty', {
        marker: path.join(directory, 'party-frame'),
    })))
    assert.equal(party.status, 'completed')
    await entered.promise
    assert.equal(saves, 0, 'parent save remains blocked')
    const heartbeat = await withServerWorkAdmission(() => transport.submit(envelope('shutdown.lobbyHeartbeat', {}, 500)))
    assert.equal(heartbeat.status, 'completed', 'heartbeat must not wait behind low-priority party persistence')
    assert.equal(heartbeat.value.heartbeatAcks, 1); assert.equal(heartbeat.value.partySlot, 2)
    assert.equal(saves, 0, 'heartbeat responded while the durable save was still blocked')
    assert.equal(saved.playerId, 42); assert.equal(saved.partyId, 2); assert.equal(saved.expectedSavedPartyId, 1)
    assert.deepEqual(saved.party, { characterIds: [111001, null, null] })
    await transport.quiesce()
    let drained = false
    const drain = transport.drain().then(() => { drained = true })
    await sleep(50); assert.equal(drained, false, 'non-blocking lobby save still retains actual shutdown work')
    gate.resolve(); await drain
    assert.equal(saves, 1); assert.equal(transport.diagnostics().businessPending, 0)
})
