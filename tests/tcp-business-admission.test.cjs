const assert = require('node:assert/strict')
const net = require('node:net')
if (process.argv[2] === 'tcp-child') {
    process.env.MULTI_REALTIME_OWNER_CHILD = '1'
    process.env.SESSION_PORT = '0'
    process.env.SESSION_HOST = '127.0.0.1'
    const rpc = require('../out/multi/coordinator/business-rpc')
    rpc.attachChildBusinessRpc()
    const admission = require('../out/multi/coordinator/socket-admission')
    admission.authorizeSocketAdmission = async () => true
    admission.checkSocketAdmission = () => true
    admission.stopSocketAdmission = () => {}
    require('../out/multi/tcp/handshake').handleHandshake = async socket => socket.write('[0]\0')
    let resume
    const battle = require('../out/multi/tcp/battle')
    battle.handleBattleMessage = (socket, frame) => {
        if (frame[0] !== 0 || frame[1]?.[0] !== 0) { socket.write('[99]\0'); return }
        // Real parser admission with a controlled detached domain tail: no game
        // state/DB fixture is needed to witness cutoff versus post-await writes.
        const continueInContext = rpc.captureRealtimeBusinessContext()
        const gate = new Promise(resolve => { resume = resolve })
        rpc.retainRealtimeBusinessTail(gate.then(() => continueInContext(
            () => rpc.invokeRealtimeBusiness('fixture.accepted-write', { afterAwait: true }))))
        socket.write('[1,[0]]\0')
    }
    const sessions = require('../out/multi/tcp/server')
    process.on('message', message => {
        if (message.t === 'cutoff') { sessions.quiesceSessionServer(); process.send({ t: 'cutoff-ack' }) }
        else if (message.t === 'resume') resume()
        else if (message.t === 'drain') void rpc.drainChildRealtimeBusiness().then(() => process.send({ t: 'drained' }))
        else if (message.t === 'stop') void sessions.stopSessionServer().then(() => process.exit(0))
    })
    void sessions.startSessionServer().then(() => process.send({ t: 'listening', port: sessions.getSessionServer().address().port }))
} else {
    const { test } = require('node:test')
    const { fork } = require('node:child_process')
    const { setImmediate: turn } = require('node:timers/promises')
    const admission = require('../out/multi/coordinator/parent-business-admission')
    const shutdown = require('../out/lib/shutdown-state')
    test('real TCP business acceptance survives cutoff and await; local ACK stays independent and hot frames do not request grants', async t => {
        const ingress = admission.createAcceptedRealtimeBusinessScope({ ownerEpoch: 'fixture-owner', commandId: 'ingress' })
        const child = fork(__filename, ['tcp-child'], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
        let stderr = '', exited = false, cutoff = false, begins = 0, writes = 0, delayedBegin
        child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-8192) })
        child.stdout.resume()
        child.once('exit', () => { exited = true })
        const works = new Map(), events = [], waiters = new Set()
        const notify = message => { events.push(message); for (const wake of waiters) wake(); waiters.clear() }
        const reply = (message, ok, value, code) => child.send({ t: message.t === 'business-request' ? 'business-result' : 'tcp-work-result', requestId: message.requestId, ok, ...(ok ? { value } : { code }) })
        child.on('message', message => {
            void (async () => {
                if (message.t === 'tcp-work-begin') {
                    begins++
                    if (cutoff) { reply(message, false, undefined, 'SERVER_CLOSING'); return }
                    if (begins === 2) { delayedBegin = message; notify({ t: 'business-begin' }); return }
                    const scope = await ingress.run(async () => admission.createAcceptedRealtimeBusinessScope({ ownerEpoch: 'fixture-owner', commandId: message.workId }))
                    works.set(message.workId, scope); reply(message, true, scope.proof)
                } else if (message.t === 'tcp-work-end') {
                    const scope = works.get(message.workId)
                    assert.ok(scope)
                    assert.deepEqual(message.businessAdmission, scope.proof)
                    scope.release(); works.delete(message.workId); reply(message, true, null)
                    notify({ t: 'work-ended' })
                } else if (message.t === 'business-request') {
                    assert.equal(cutoff, true, 'fixture write is deliberately after cutoff')
                    const value = await admission.dispatchAcceptedRealtimeBusiness(message.businessAdmission, async () => {
                        shutdown.assertServerAcceptingWork()
                        writes++
                        return { committed: true }
                    })
                    reply(message, true, value)
                } else notify(message)
            })().catch(error => { notify({ t: 'fixture-error', error }); if (child.connected) reply(message, false, undefined, error.code || 'FIXTURE_ERROR') })
        })
        const next = async kind => {
            const deadline = Date.now() + 5000
            while (!events.some(message => message.t === kind)) {
                const error = events.find(message => message.t === 'fixture-error')
                if (error) throw error.error
                assert.equal(exited, false, stderr)
                assert.ok(Date.now() < deadline, `missing ${kind}: ${stderr}`)
                await Promise.race([new Promise(resolve => waiters.add(resolve)), new Promise(resolve => setTimeout(resolve, 25))])
            }
            return events.splice(events.findIndex(message => message.t === kind), 1)[0]
        }
        let socket
        t.after(() => { socket?.destroy(); ingress.release(); for (const scope of works.values()) scope.release(); if (!exited) child.kill() })
        const listening = await next('listening')
        socket = net.connect(listening.port, '127.0.0.1')
        const frames = [], frameWaiters = new Set(); let buffer = ''
        socket.on('data', chunk => {
            buffer += chunk
            let boundary
            while ((boundary = buffer.indexOf('\0')) >= 0) {
                frames.push(JSON.parse(buffer.slice(0, boundary))); buffer = buffer.slice(boundary + 1)
            }
            for (const wake of frameWaiters) wake(); frameWaiters.clear()
        })
        const frame = async predicate => {
            const deadline = Date.now() + 5000
            while (!frames.some(predicate)) {
                assert.ok(Date.now() < deadline, `missing TCP frame: ${stderr}`)
                await Promise.race([new Promise(resolve => frameWaiters.add(resolve)), new Promise(resolve => setTimeout(resolve, 25))])
            }
            return frames.splice(frames.findIndex(predicate), 1)[0]
        }
        await new Promise(resolve => socket.once('connect', resolve))
        socket.write('{"socklet":"cooperation_battle"}\0')
        await frame(value => value[0] === 0); await next('work-ended')
        for (const message of [[0, [5]], [0, [3, [1, 1]]], [1, ['input']]]) {
            socket.write(JSON.stringify(message) + '\0'); await frame(value => value[0] === 99)
        }
        assert.equal(begins, 1, 'heartbeat/Measurement/relay input do not add admission roundtrips')
        socket.write('[0,[0]]\0')
        await next('business-begin')
        await frame(value => value[0] === 1 && value[1]?.[0] === 0)
        assert.equal(writes, 0, 'local TCP ACK precedes even parent grant')
        shutdown.beginServerShutdown()
        // Begin was FIFO-issued before cutoff; derive its actual parent token
        // from the startup admission even though parent shutdown has begun.
        const scope = await ingress.run(async () => admission.createAcceptedRealtimeBusinessScope({ ownerEpoch: 'fixture-owner', commandId: delayedBegin.workId }))
        works.set(delayedBegin.workId, scope); reply(delayedBegin, true, scope.proof)
        child.send({ t: 'cutoff' }); await next('cutoff-ack'); cutoff = true; ingress.release()
        let drained = false
        const parentDrain = shutdown.drainServerWork().then(() => { drained = true })
        child.send({ t: 'drain' }); await turn(); assert.equal(drained, false)
        child.send({ t: 'resume' })
        await next('work-ended'); await next('drained'); await parentDrain
        assert.equal(writes, 1)
        assert.equal(works.size, 0)
        assert.equal(drained, true)
        child.send({ t: 'stop' })
        await new Promise(resolve => child.once('close', resolve))
        assert.equal(child.exitCode, 0, stderr)
    })
}
