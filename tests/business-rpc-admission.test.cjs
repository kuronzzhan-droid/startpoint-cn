const assert = require('node:assert/strict')
if (process.argv[2] === 'rpc-child') {
    process.env.MULTI_REALTIME_OWNER_CHILD = '1'
    const { mock } = require('node:test')
    mock.timers.enable({ apis: ['setTimeout'] })
    const rpc = require('../out/multi/coordinator/business-rpc')
    rpc.attachChildBusinessRpc()
    let budgetResume
    process.on('message', message => {
        if (message.t === 'invoke') {
            const call = rpc.runWithRealtimeBusinessAdmission(message.proof,
                () => rpc.invokeRealtimeBusiness('fixture.command', { sequence: message.sequence }))
            void call.then(value => { if (process.connected) process.send({ t: 'caller', value }) },
                error => { if (process.connected) process.send({ t: 'caller', code: error.code || error.message }) })
        } else if (message.t === 'drain') {
            void rpc.drainChildRealtimeBusiness().then(() => {
                if (process.connected) process.send({ t: 'drained' })
                else process.stdout.write('drained-after-disconnect\n')
            })
            process.send({ t: 'drain-started' })
        } else if (message.t === 'timeout') mock.timers.tick(10_000)
        else if (message.t === 'budget-work') {
            void rpc.runWithTcpBusinessAdmission(() => new Promise(resolve => { budgetResume = resolve }))
                .then(() => process.send({ t: 'budget-done' }), error => process.send({ t: 'budget-error', code: error.code || error.message }))
        } else if (message.t === 'budget-fill') {
            for (let n = 0; n < 64; n++) {
                void rpc.invokeRealtimeBusiness('fixture.capacity', { n }).catch(error => process.send({ t: 'caller', code: error.code || error.message }))
            }
        } else if (message.t === 'budget-resume') budgetResume()
        else if (message.t === 'exit') process.disconnect()
    })
    process.send({ t: 'ready' })
} else {
    const { test } = require('node:test')
    const { fork } = require('node:child_process')
    const { setImmediate: turn } = require('node:timers/promises')
    test('reverse RPC carries command proof and child drain waits for actual late ACK after caller timeout', async t => {
        const child = fork(__filename, ['rpc-child'], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
        let stderr = '', stdout = '', exited = false
        child.stdout.on('data', chunk => { stdout = (stdout + chunk).slice(-8192) })
        child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-8192) })
        child.once('exit', () => { exited = true })
        t.after(() => { if (!exited) child.kill() })
        const messages = [], waiters = new Set()
        child.on('message', message => { messages.push(message); for (const wake of waiters) wake(); waiters.clear() })
        const next = async kind => {
            const deadline = Date.now() + 5000
            while (!messages.some(message => message.t === kind)) {
                assert.equal(exited, false, stderr)
                assert.ok(Date.now() < deadline, `missing ${kind}: ${stderr}`)
                await Promise.race([new Promise(resolve => waiters.add(resolve)), new Promise(resolve => setTimeout(resolve, 50))])
            }
            return messages.splice(messages.findIndex(message => message.t === kind), 1)[0]
        }
        await next('ready')
        const proof = { ownerEpoch: 'fixture-owner', commandId: 'fixture-command', admissionToken: 'a'.repeat(64) }
        child.send({ t: 'invoke', proof, sequence: 1 })
        const request = await next('business-request')
        assert.deepEqual(request.businessAdmission, proof)
        assert.deepEqual(request.payload, { sequence: 1 })
        child.send({ t: 'drain' }); await next('drain-started')
        child.send({ t: 'timeout' })
        assert.equal((await next('caller')).code, 'BUSINESS_OUTCOME_UNKNOWN')
        await turn()
        assert.equal(messages.some(message => message.t === 'drained'), false, 'caller timeout cannot release actual-ACK drain')
        child.send({ t: 'business-result', requestId: request.requestId, ok: true, value: { committed: true } })
        await next('drained')
        child.send({ t: 'invoke', sequence: 2 })
        const independent = await next('business-request')
        assert.equal(Object.hasOwn(independent, 'businessAdmission'), false, 'unrelated TCP work does not inherit the old command proof')
        child.send({ t: 'business-result', requestId: independent.requestId, ok: true, value: 2 })
        assert.equal((await next('caller')).value, 2)

        child.send({ t: 'budget-work' })
        const begin = await next('tcp-work-begin')
        const budgetProof = { ...proof, commandId: begin.workId }
        child.send({ t: 'tcp-work-result', requestId: begin.requestId, ok: true, value: budgetProof })
        child.send({ t: 'budget-fill' })
        const requests = []
        for (let n = 0; n < 64; n++) requests.push(await next('business-request'))
        child.send({ t: 'budget-resume' }); child.send({ t: 'timeout' })
        for (let n = 0; n < 64; n++) assert.equal((await next('caller')).code, 'BUSINESS_OUTCOME_UNKNOWN')
        assert.equal(messages.some(message => message.t === 'tcp-work-end'), false, '64 uncertain requests still consume the real ACK budget')
        assert.equal(messages.some(message => message.t === 'budget-error'), false, 'end is retained instead of discarded at capacity')
        child.send({ t: 'business-result', requestId: requests[0].requestId, ok: true, value: null })
        const end = await next('tcp-work-end')
        assert.equal(end.workId, begin.workId)
        assert.deepEqual(end.businessAdmission, budgetProof)
        child.send({ t: 'tcp-work-result', requestId: end.requestId, ok: true, value: null })
        await next('budget-done')
        for (const request of requests.slice(1)) child.send({ t: 'business-result', requestId: request.requestId, ok: true, value: null })
        child.send({ t: 'drain' }); await next('drain-started'); await next('drained')

        child.send({ t: 'invoke', sequence: 3 })
        await next('business-request')
        child.send({ t: 'drain' }); await next('drain-started')
        child.send({ t: 'exit' })
        await new Promise(resolve => child.once('close', resolve))
        assert.equal(child.exitCode, 0, stderr)
        assert.match(stdout, /drained-after-disconnect/, 'channel closure terminates remaining actual-ACK obligations')
    })
}
