'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { createPersistenceWriteGate } = require('../out/lib/persistence-write-gate')
const { PersistenceMaintenanceBusyError } = require('../out/lib/persistence-admission')

function deferred() {
    let resolve
    const promise = new Promise(done => { resolve = done })
    return { promise, resolve }
}
function idle(gate) {
    assert.deepEqual(gate.stats(), { activeWrites: 0, exclusive: false, waiting: 0 })
}

test('a maintenance callback executes in the grant stack and releases before promise continuations', async () => {
    const gate = createPersistenceWriteGate(), events = []
    events.push('before')
    const pending = gate.runExclusiveSync(() => {
        assert.deepEqual(gate.stats(), { activeWrites: 0, exclusive: true, waiting: 0 })
        events.push('callback')
        return 37
    })
    events.push('after-call')
    gate.assertSynchronousWriteAllowed()
    assert.deepEqual(events, ['before', 'callback', 'after-call'])
    assert.equal(await pending.then(value => {
        events.push('resolved')
        gate.assertSynchronousWriteAllowed()
        idle(gate)
        return value
    }), 37)
    assert.deepEqual(events, ['before', 'callback', 'after-call', 'resolved'])
})

test('maintenance waits for actual active tasks, then runs before a later admitted write', async () => {
    const gate = createPersistenceWriteGate(), a = deferred(), b = deferred(), events = []
    const releaseA = await gate.acquire(false), releaseB = await gate.acquire(false)
    const taskA = (async () => {
        try { await a.promise; events.push('a-finished') }
        finally { releaseA() }
    })()
    const taskB = (async () => {
        try { await b.promise; events.push('b-finished') }
        finally { releaseB() }
    })()
    const maintenance = gate.runExclusiveSync(() => {
        assert.deepEqual(events, ['a-finished', 'b-finished'])
        assert.equal(gate.stats().activeWrites, 0)
        events.push('maintenance')
    })
    const later = gate.acquire(false).then(release => {
        try { events.push('later-write') }
        finally { release() }
    })
    assert.deepEqual(gate.stats(), { activeWrites: 2, exclusive: false, waiting: 2 })
    gate.assertSynchronousWriteAllowed()
    a.resolve()
    await taskA
    assert.deepEqual(events, ['a-finished'])
    assert.equal(gate.stats().activeWrites, 1)
    gate.assertSynchronousWriteAllowed()
    b.resolve()
    await Promise.all([taskB, maintenance, later])
    assert.deepEqual(events, ['a-finished', 'b-finished', 'maintenance', 'later-write'])
    idle(gate)
})

test('FIFO preserves an earlier queued ordinary writer ahead of the synchronous window', async () => {
    const gate = createPersistenceWriteGate(), events = []
    const hold = await gate.acquire(true)
    const first = gate.acquire(false)
    const maintenance = gate.runExclusiveSync(() => events.push('maintenance'))
    const last = gate.acquire(false)
    hold()
    const releaseFirst = await first
    events.push('first-write')
    assert.equal(gate.stats().exclusive, false)
    assert.deepEqual(events, ['first-write'])
    releaseFirst()
    const releaseLast = await last
    events.push('last-write')
    releaseLast()
    await maintenance
    assert.deepEqual(events, ['first-write', 'maintenance', 'last-write'])
    idle(gate)
})

test('promise jobs and microtasks queued around maintenance never see its exclusive flag', async () => {
    const gate = createPersistenceWriteGate(), observations = []
    const before = Promise.resolve().then(() => {
        gate.assertSynchronousWriteAllowed()
        observations.push('before-job')
    })
    let insideJob
    const maintenance = gate.runExclusiveSync(() => {
        insideJob = new Promise(resolve => queueMicrotask(() => {
            gate.assertSynchronousWriteAllowed()
            observations.push('inside-microtask')
            resolve()
        }))
        assert.equal(gate.stats().exclusive, true)
    })
    const after = Promise.resolve().then(() => {
        gate.assertSynchronousWriteAllowed()
        observations.push('after-job')
    })
    await Promise.all([before, maintenance, insideJob, after])
    assert.deepEqual(observations, ['before-job', 'inside-microtask', 'after-job'])
    idle(gate)
})

test('a throwing callback releases exclusivity, rejects its caller and lets queued work continue', async () => {
    const gate = createPersistenceWriteGate(), events = [], failure = new Error('maintenance failed')
    const hold = await gate.acquire(false)
    const maintenance = gate.runExclusiveSync(() => {
        events.push('maintenance-failed')
        throw failure
    })
    const rejected = assert.rejects(maintenance, error => {
        assert.equal(error, failure)
        gate.assertSynchronousWriteAllowed()
        return true
    })
    const later = gate.acquire(false).then(release => {
        try { events.push('later-write') }
        finally { release() }
    })
    hold()
    await Promise.all([rejected, later])
    assert.deepEqual(events, ['maintenance-failed', 'later-write'])
    idle(gate)
})

test('callback-enqueued work stays queued until the synchronous callback has returned', async () => {
    const gate = createPersistenceWriteGate(), events = []
    let laterWrite, laterMaintenance
    const outer = gate.runExclusiveSync(() => {
        events.push('outer-start')
        laterWrite = gate.acquire(false).then(release => {
            try { events.push('child-write') }
            finally { release() }
        })
        laterMaintenance = gate.runExclusiveSync(() => events.push('child-maintenance'))
        assert.deepEqual(events, ['outer-start'])
        events.push('outer-end')
        return 'done'
    })
    assert.deepEqual(events, ['outer-start', 'outer-end'])
    assert.equal(await outer, 'done')
    await Promise.all([laterWrite, laterMaintenance])
    assert.deepEqual(events, ['outer-start', 'outer-end', 'child-write', 'child-maintenance'])
    idle(gate)
})

test('the existing asynchronous exclusive acquire keeps its prior refusal and release contract', async () => {
    const gate = createPersistenceWriteGate(), events = []
    const release = await gate.acquire(true)
    assert.throws(() => gate.assertSynchronousWriteAllowed(), PersistenceMaintenanceBusyError)
    const maintenance = gate.runExclusiveSync(() => events.push('maintenance'))
    assert.deepEqual(events, [])
    release()
    release()
    await maintenance
    assert.deepEqual(events, ['maintenance'])
    gate.assertSynchronousWriteAllowed()
    idle(gate)
})
