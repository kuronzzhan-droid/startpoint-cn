const { test, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { EventEmitter } = require('node:events')
const { performance } = require('node:perf_hooks')
const { setTimeout: sleep } = require('node:timers/promises')
process.env.MULTI_REALTIME_OWNER_CHILD = '1'
const out = process.env.STARPOINT_TEST_OUT_DIR || path.resolve(__dirname, '../out')
const rpc = require(path.join(out, 'multi/coordinator/business-rpc'))
let respond
rpc.installRealtimeBusinessTransport((kind, payload) => respond(kind, payload))
const admission = require(path.join(out, 'multi/coordinator/socket-admission'))
const { readTcpDisconnectReason } = require(path.join(out, 'multi/tcp/disconnect-diagnostics'))
class Socket extends EventEmitter {
    destroyed = false
    destroy() { this.destroyed = true; this.emit('close') }
}
afterEach(() => admission.stopSocketAdmission())
function clock(t) {
    let now = 100; const deadlines = [], polls = []
    t.mock.method(performance, 'now', () => now)
    t.mock.method(global, 'setTimeout', (fn, ms) => { const timer = { fn, ms, unref() {} }; deadlines.push(timer); return timer })
    t.mock.method(global, 'setInterval', (fn, ms) => { const timer = { fn, ms, unref() {} }; polls.push(timer); return timer })
    t.mock.method(global, 'clearTimeout', () => {}); t.mock.method(global, 'clearInterval', () => {})
    return { advance: ms => now += ms, deadlines, polls }
}
test('business RPC queue/transit time cannot extend an admission capability', async t => {
    const c = clock(t), socket = new Socket()
    respond = async kind => { assert.equal(kind, 'admission.lease'); c.advance(5000); return { ok: true, remainingMs: 60000 } }
    assert.equal(await admission.authorizeSocketAdmission(socket, 'synthetic-token', 'synthetic-session'), true)
    assert.equal(c.deadlines.at(-1).ms, 55000)
    c.advance(55001)
    assert.equal(admission.checkSocketAdmission(socket, '', ''), false)
    c.deadlines.at(-1).fn(); assert.equal(socket.destroyed, true); assert.equal(readTcpDisconnectReason(socket), 'admission')
})
test('owner deadline closes an idle socket while parent refresh is pending, and its late ACK cannot resurrect it', async t => {
    const c = clock(t), socket = new Socket(); let complete
    respond = async (kind, payload) => kind === 'admission.lease' ? { ok: true, remainingMs: 10000 }
        : new Promise(resolve => complete = () => resolve(payload.items.map(item => ({ id: item.id, ok: true, remainingMs: 60000 }))))
    assert.equal(await admission.authorizeSocketAdmission(socket, null, null), true)
    assert.equal(admission.checkSocketAdmission(socket, null, null), true)
    c.polls[0].fn(); await Promise.resolve()
    assert.equal(typeof complete, 'function')
    c.advance(10001); c.deadlines.at(-1).fn()
    assert.equal(socket.destroyed, true); assert.equal(readTcpDisconnectReason(socket), 'admission')
    complete(); await new Promise(resolve => setImmediate(resolve))
    assert.equal(admission.checkSocketAdmission(socket, null, null), false)
    assert.equal(c.deadlines.length, 1, 'late ACK cannot create another lease after expiry')
})
test('a capability already exhausted during authorization is refused', async t => {
    const c = clock(t), socket = new Socket()
    respond = async () => { c.advance(5000); return { ok: true, remainingMs: 4000 } }
    assert.equal(await admission.authorizeSocketAdmission(socket, null, null), false)
    assert.equal(socket.destroyed, true); assert.equal(readTcpDisconnectReason(socket), 'admission')
})


// Speed only the polling interval. Callback execution still comes from a real
// Node timer created under the production ALS boundary, never a manual fn().
function realPollTimer(t) {
    const nativeInterval = global.setInterval
    t.mock.method(global, 'setInterval', (callback, milliseconds, ...args) => {
        assert.equal(milliseconds, 5000)
        return nativeInterval(callback, 10, ...args)
    })
}
async function until(predicate, label, timeoutMs = 1500) {
    const deadline = performance.now() + timeoutMs
    while (!predicate()) {
        assert.ok(performance.now() < deadline, `Timed out: ${label}`)
        await sleep(5)
    }
}
function realHandshakeTransport(handleAdmission) {
    const counts = { begin: 0, end: 0, lease: 0, refresh: 0 }
    respond = async (kind, payload) => {
        if (kind === '__tcp_work_begin__') {
            counts.begin++
            return { commandId: payload.workId, ownerEpoch: 'synthetic-owner', admissionToken: 'a'.repeat(64) }
        }
        if (kind === '__tcp_work_end__') { counts.end++; return null }
        if (kind === 'admission.lease') counts.lease++
        if (kind === 'admission.refresh') counts.refresh++
        return handleAdmission(kind, payload)
    }
    return counts
}
async function handshake(socket) {
    // Include an outer proof to catch clearing only one of the two ALS stores.
    return rpc.runWithRealtimeBusinessAdmission({ commandId: 'outer-handshake-proof' },
        () => rpc.runWithTcpBusinessAdmission(() =>
            admission.authorizeSocketAdmission(socket, 'do-not-log-token', 'do-not-log-session')))
}

test('a real maintenance timer refreshes after the handshake ended without inheriting its work or proof', async t => {
    realPollTimer(t)
    const socket = new Socket(), proofs = []
    let endedContext
    const counts = realHandshakeTransport((kind, payload) => {
        if (kind === 'admission.lease') return { ok: true, remainingMs: 1000 }
        assert.equal(kind, 'admission.refresh')
        proofs.push(rpc.getRealtimeBusinessAdmission())
        return payload.items.map(item => ({ id: item.id, ok: true, remainingMs: 1000 }))
    })
    assert.equal(await rpc.runWithRealtimeBusinessAdmission({ commandId: 'old-proof' },
        () => rpc.runWithTcpBusinessAdmission(async () => {
            const accepted = await admission.authorizeSocketAdmission(socket, 'do-not-log-token', 'do-not-log-session')
            endedContext = rpc.captureRealtimeBusinessContext()
            return accepted
        })), true)
    assert.equal(counts.end, 1, 'the originating handshake work has actually ended')
    await assert.rejects(endedContext(() => rpc.invokeRealtimeBusiness('must-not-run', {})), /TCP_BUSINESS_WORK_ENDED/)
    await sleep(1100)
    assert.ok(counts.refresh > 1, 'real scheduled renewals outlive the original capability')
    assert.ok(proofs.every(proof => proof === undefined), 'fresh housekeeping never reuses the released handshake proof')
    assert.equal(socket.destroyed, false)
    assert.equal(admission.checkSocketAdmission(socket, '', ''), true)
    assert.equal(counts.begin, 1, 'maintenance must not manufacture another owner/handshake grant')
    assert.equal(counts.lease, 1)
})

test('an unanswered real refresh retains the old deadline and a late acknowledgement cannot resurrect it', async t => {
    realPollTimer(t)
    const socket = new Socket()
    let complete
    const counts = realHandshakeTransport((kind, payload) => kind === 'admission.lease'
        ? { ok: true, remainingMs: 120 }
        : new Promise(resolve => { complete = () => resolve(payload.items.map(item => ({ id: item.id, ok: true, remainingMs: 1000 }))) }))
    assert.equal(await handshake(socket), true)
    await until(() => typeof complete === 'function', 'refresh reaches the parent transport')
    await until(() => socket.destroyed, 'original admission deadline')
    assert.equal(readTcpDisconnectReason(socket), 'admission')
    complete()
    await sleep(30)
    assert.equal(admission.checkSocketAdmission(socket, '', ''), false)
    assert.equal(counts.lease, 1)
    assert.equal(counts.begin, 1)
})

test('a real parent revocation closes with admission reason and does not create a replacement grant', async t => {
    realPollTimer(t)
    const socket = new Socket()
    const counts = realHandshakeTransport((kind, payload) => kind === 'admission.lease'
        ? { ok: true, remainingMs: 1000 }
        : payload.items.map(item => ({ id: item.id, ok: false, remainingMs: 0 })))
    assert.equal(await handshake(socket), true)
    await until(() => socket.destroyed, 'revoked admission')
    assert.equal(readTcpDisconnectReason(socket), 'admission')
    assert.equal(counts.begin, 1)
    assert.equal(counts.lease, 1)
})

test('failed real refreshes cannot extend the capability and log bounded reasons without credentials', async t => {
    realPollTimer(t)
    const warnings = []
    t.mock.method(console, 'warn', message => warnings.push(String(message)))
    const socket = new Socket()
    realHandshakeTransport(kind => {
        if (kind === 'admission.lease') return { ok: true, remainingMs: 120 }
        throw Object.assign(new Error('do-not-log-token do-not-log-session'), { code: 'BUSINESS_PENDING_BUDGET' })
    })
    assert.equal(await handshake(socket), true)
    await until(() => socket.destroyed, 'unextended capability after refresh failures')
    assert.equal(readTcpDisconnectReason(socket), 'admission')
    assert.equal(warnings.length, 1, 'the accelerated polling loop still emits at most one warning in the bounded window')
    assert.match(warnings[0], /reason=BUSINESS_PENDING_BUDGET/)
    assert.equal(warnings.some(message => /do-not-log-token|do-not-log-session/.test(message)), false)
})

test('stopping admission upkeep ignores its pending acknowledgement and starts no further refresh or grant', async t => {
    realPollTimer(t)
    const socket = new Socket()
    let complete
    const counts = realHandshakeTransport((kind, payload) => kind === 'admission.lease'
        ? { ok: true, remainingMs: 1000 }
        : new Promise(resolve => { complete = () => resolve(payload.items.map(item => ({ id: item.id, ok: true, remainingMs: 1000 }))) }))
    assert.equal(await handshake(socket), true)
    await until(() => typeof complete === 'function', 'in-flight refresh')
    admission.stopSocketAdmission()
    const refreshes = counts.refresh
    complete()
    await sleep(40)
    assert.equal(counts.refresh, refreshes)
    assert.equal(counts.begin, 1)
    assert.equal(counts.lease, 1)
    assert.equal(admission.checkSocketAdmission(socket, '', ''), false)
})
