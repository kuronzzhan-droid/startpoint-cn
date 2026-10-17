const test = require('node:test')
const assert = require('node:assert/strict')
const net = require('node:net')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn, spawnSync } = require('node:child_process')
const { runProbe, validateConfig } = require('../tools/multiplayer-latency-probe.cjs')

const config = port => ({ acknowledgeTestIdentities: true, host: '127.0.0.1', port,
    room: 'dedicated-probe-test', connectionIds: ['new-probe-a', 'new-probe-b'], route: 'parent',
    phase: 'test-stream', sceneReady: true, samples: 3, intervalMs: 30, timeoutMs: 150 })

async function protocolServer(t, options = {}) {
    const peers = new Map(), sockets = new Set(), timers = new Set()
    const send = (socket, data) => { if (!socket.destroyed) socket.write(JSON.stringify(data) + '\0') }
    const later = (ms, fn) => { const timer = setTimeout(() => { timers.delete(timer); fn() }, ms); timers.add(timer) }
    const server = net.createServer(socket => {
        sockets.add(socket); let buffer = '', identity
        socket.setEncoding('utf8'); socket.on('error', () => {})
        socket.on('close', () => sockets.delete(socket))
        socket.on('data', data => {
            buffer += data; let end
            while ((end = buffer.indexOf('\0')) >= 0) {
                const frame = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1)
                if (!Array.isArray(frame)) { identity = frame.connection_id; peers.set(identity, socket); socket.write('[0'); later(1, () => socket.write(']\0')); continue }
                if (frame[0] === 0) {
                    if (frame[1][0] === 0) { send(socket, [1, [1]]); continue }
                    if (frame[1][0] === 5) { send(socket, [1, [3, 0, 0, Date.now()]]); continue }
                    if (frame[1][0] === 3) {
                        const [id, echo] = frame[1][1]
                        const wire = JSON.stringify([1, [3, id, echo, Date.now()]]) + '\0'
                        if (options.late && id === 2) later(90, () => socket.write(wire))
                        else later(1, () => { if (!socket.destroyed) socket.write(wire) })
                        continue
                    }
                }
                if (frame[0] === 1 || frame[0] === 2) {
                    const b = frame[0] === 1 ? frame[1][0] : frame[2]
                    for (const [otherId, target] of peers) if (otherId !== identity) {
                        const out = [frame[0] === 1 ? 2 : 3, identity, frame[0] === 1 ? [b] : b]
                        send(target, out)
                        if (options.duplicate && b.seq === 0) send(target, out)
                    }
                    send(socket, [1, [3, 0, 0, Date.now()]])
                }
            }
        })
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    t.after(async () => { for (const timer of timers) clearTimeout(timer); for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)) })
    return server.address().port
}

test('probe fails closed without explicit dedicated identities/labels; CLI has no default target', () => {
    assert.throws(() => validateConfig({}), /TEST room/)
    assert.throws(() => validateConfig({ ...config(1), route: undefined }), /route/)
    assert.throws(() => validateConfig({ ...config(1), connectionIds: ['same', 'same'] }), /distinct/)
    assert.throws(() => validateConfig({ ...config(1), samples: 3601 }), /samples/)
    const noTarget = spawnSync(process.execPath, [path.resolve(__dirname, '../tools/multiplayer-latency-probe.cjs')], { encoding: 'utf8', windowsHide: true })
    assert.equal(noTarget.status, 1); assert.match(noTarget.stderr, /Require --config/)
})

test('real TCP fragmented/coalesced frames produce distinct RTT, exact delivery and generic counts', async t => {
    const port = await protocolServer(t)
    const result = await runProbe(config(port))
    assert.equal(result.complete, true)
    assert.match(result.actor, /not a game device/)
    assert.match(result.routeEvidence, /not independently verified/)
    for (const r of result.measurements) {
        assert.equal(r.success, 3); assert.equal(r.rttMs.count, 3); assert.equal(r.jitterMs.count, 2)
        assert.equal(r.genericIgnored, 6); assert.equal(r.unmatched, 0); assert.equal(r.pending, 0)
    }
    for (const d of result.businessDeliveries) {
        assert.equal(d.success, 3); assert.equal(d.deliveryWaitMs.count, 3)
        assert.equal(d.rttMs, undefined); assert.equal(d.receiveIntervalMs.count, 2)
        assert.equal(d.receiveIntervalVariationMs.count, 1)
    }
    assert.equal(result.counters.invalidData, 0); assert.equal(result.counters.unexpectedCloses, 0)
    assert.equal(JSON.stringify(result).includes('new-probe-a'), false, 'report excludes connection identities')
})

test('real TCP late replies retain timeouts and duplicated business delivery fails completeness', async t => {
    const port = await protocolServer(t, { late: true, duplicate: true })
    const result = await runProbe({ ...config(port), timeoutMs: 60 })
    assert.equal(result.complete, false)
    for (const m of result.measurements) { assert.equal(m.success, 2); assert.equal(m.timeout, 1); assert.equal(m.late, 1); assert.equal(m.rttMs.count, 2) }
    for (const d of result.businessDeliveries) { assert.equal(d.success, 3); assert.equal(d.duplicate, 1) }
})

test('CLI measures an explicit real TCP target and writes a report without identities or tokens', async t => {
    const port = await protocolServer(t)
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'starpoint-latency-cli-'))
    t.after(() => {
        const resolved = fs.realpathSync(directory)
        if (path.dirname(resolved) !== fs.realpathSync(os.tmpdir()) || !path.basename(resolved).startsWith('starpoint-latency-cli-')) throw Error('Unexpected private CLI test directory')
        fs.rmSync(resolved, { recursive: true })
    })
    const inputPath = path.join(directory, 'private config.json'), outputPath = path.join(directory, 'report.json')
    fs.writeFileSync(inputPath, JSON.stringify({ ...config(port), samples: 2, sessionTokens: ['synthetic-token-a', 'synthetic-token-b'] }))
    const child = spawn(process.execPath, [path.resolve(__dirname, '../tools/multiplayer-latency-probe.cjs'), '--config', inputPath, '--acknowledge-test-identities', '--output', outputPath], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = '', stderr = ''
    child.stdout.on('data', b => { stdout += b }); child.stderr.on('data', b => { stderr += b })
    const exit = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve) })
    assert.equal(exit, 0, stderr)
    assert.equal(stdout, '')
    assert.match(stderr, /existing player IDs can replace/)
    const text = fs.readFileSync(outputPath, 'utf8'), result = JSON.parse(text)
    assert.equal(result.complete, true); assert.equal(result.measurements[0].success, 2)
    assert.equal(text.includes('new-probe-a'), false); assert.equal(text.includes('synthetic-token'), false)
})
