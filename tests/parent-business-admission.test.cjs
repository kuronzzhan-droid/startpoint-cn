const { test } = require('node:test')
const assert = require('node:assert/strict')
const { setImmediate: turn } = require('node:timers/promises')
const admission = require('../out/multi/coordinator/parent-business-admission')
const shutdown = require('../out/lib/shutdown-state')

test('proof is bound to its exact parent epoch/command and revoked synchronously', async () => {
    const scope = admission.createAcceptedRealtimeBusinessScope({ ownerEpoch: 'owner-a', commandId: 'command-a' })
    let calls = 0
    const operation = async () => ++calls
    assert.equal(await admission.dispatchAcceptedRealtimeBusiness({ ...scope.proof }, operation), 1)
    for (const proof of [null, [], { ...scope.proof, ownerEpoch: 'owner-b' },
        { ...scope.proof, commandId: 'command-b' }, { ...scope.proof, extra: true },
        { ...scope.proof, admissionToken: '0'.repeat(64) }]) {
        await assert.rejects(admission.dispatchAcceptedRealtimeBusiness(proof, operation), { code: 'REALTIME_BUSINESS_ADMISSION_INVALID' })
    }
    scope.release(); scope.release()
    await assert.rejects(scope.run(operation), { code: 'REALTIME_BUSINESS_ADMISSION_INVALID' })
    await assert.rejects(admission.dispatchAcceptedRealtimeBusiness(scope.proof, operation), { code: 'REALTIME_BUSINESS_ADMISSION_INVALID' })
    assert.equal(calls, 1)
    await shutdown.drainServerWork()
})

test('held acceptance capacity is bounded and release frees a slot', async () => {
    const scopes = Array.from({ length: 256 }, (_, n) => admission.createAcceptedRealtimeBusinessScope({ ownerEpoch: 'owner', commandId: `command-${n}` }))
    try {
        assert.throws(() => admission.createAcceptedRealtimeBusinessScope({ ownerEpoch: 'owner', commandId: 'overflow' }), { code: 'REALTIME_BUSINESS_ADMISSION_BUDGET' })
        assert.equal(new Set(scopes.map(scope => scope.proof.admissionToken)).size, 256)
        scopes.pop().release()
        scopes.push(admission.createAcceptedRealtimeBusinessScope({ ownerEpoch: 'owner', commandId: 'replacement' }))
    } finally { scopes.forEach(scope => scope.release()) }
    await shutdown.drainServerWork()
})

test('independent callback restores accepted context after close; drain includes held scope and accepted child writes', async () => {
    const scope = admission.createAcceptedRealtimeBusinessScope({ ownerEpoch: 'owner', commandId: 'accepted' })
    // Leave the creation stack/context before simulating the independent IPC callback.
    await turn()
    shutdown.beginServerShutdown()
    assert.throws(() => admission.createAcceptedRealtimeBusinessScope({ ownerEpoch: 'owner', commandId: 'new' }), { code: 'SERVER_CLOSING' })
    assert.throws(() => shutdown.withServerWorkAdmission(() => {}), { code: 'SERVER_CLOSING' })
    let drained = false, releaseChild
    const drain = shutdown.drainServerWork().then(() => { drained = true })
    const gate = new Promise(resolve => { releaseChild = resolve })
    const child = admission.dispatchAcceptedRealtimeBusiness(scope.proof, async () => {
        await gate
        return shutdown.withServerWorkAdmission(async () => 'late accepted write')
    })
    await turn(); assert.equal(drained, false, 'held acceptance participates in drain')
    scope.release()
    await assert.rejects(admission.dispatchAcceptedRealtimeBusiness(scope.proof, async () => 'new callback'), { code: 'REALTIME_BUSINESS_ADMISSION_INVALID' })
    await turn(); assert.equal(drained, false, 'release must not abandon already accepted child work')
    releaseChild()
    assert.equal(await child, 'late accepted write')
    await drain
    assert.equal(drained, true)
})
