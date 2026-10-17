const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const out = process.env.STARPOINT_TEST_OUT_DIR || path.resolve(__dirname, '../out')
const { DurableOwnerEventPublisher } = require(path.join(out, 'multi/coordinator/durable-owner-event'))
const { RoomCommandError } = require(path.join(out, 'multi/coordinator/command-protocol'))
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(predicate) { for (let i = 0; i < 100; i++) { if (predicate()) return; await sleep(5) } throw Error('reconciliation did not complete') }
function quiet(t) { t.mock.method(console, 'warn', () => {}); t.mock.method(console, 'error', () => {}) }
test('a lost application ACK is reconciled under its original ID without executing another durable start', async t => {
    quiet(t); let originalId, executes = 0, queries = 0, payments = 1, failures = 0
    const gateway = {
        execute: async (_kind, _payload, options) => { originalId = options.commandId; executes++; throw new RoomCommandError('OUTCOME_UNKNOWN', 'lost ACK', originalId, true) },
        queryResult: async id => { queries++; assert.equal(id, originalId); return { commandId: id, ownerEpoch: 'same-owner', status: 'completed', outcomeUnknown: false, value: { applied: true } } },
    }
    const publisher = new DurableOwnerEventPublisher(() => gateway, async () => failures++, 5, 300)
    assert.equal(await publisher.publish('battle.play.commit', { playId: 'paid-original' }), undefined)
    assert.equal(publisher.inspect().pending, 1)
    await until(() => publisher.inspect().pending === 0)
    assert.equal(executes, 1); assert.equal(queries, 1); assert.equal(payments, 1); assert.equal(failures, 0)
})
test('a definitively unaccepted queue request retries the same ID with the frozen payload', async t => {
    quiet(t); const ids = [], received = [], input = { playId: 'original', nested: { value: 7 } }; let applications = 0
    const gateway = {
        execute: async (_kind, payload, options) => {
            ids.push(options.commandId); received.push(payload)
            if (ids.length === 1) throw new RoomCommandError('PENDING_BUDGET', 'not accepted', options.commandId, false)
            applications++; return { applied: true }
        },
        queryResult: async id => ({ commandId: id, ownerEpoch: 'same-owner', status: 'unknown', outcomeUnknown: true }),
    }
    const publisher = new DurableOwnerEventPublisher(() => gateway, async () => assert.fail('recovered owner must remain open'), 5, 300)
    await publisher.publish('fiveBoss.start.commit', input); input.nested.value = 99
    await until(() => publisher.inspect().pending === 0)
    assert.equal(ids.length, 2); assert.equal(ids[0], ids[1]); assert.equal(applications, 1)
    assert.equal(received[1].nested.value, 7)
})
test('pending owner application retains its budget and is queried rather than resubmitted', async t => {
    quiet(t); let complete = false, executes = 0, queries = 0
    const gateway = {
        execute: async (_kind, _payload, options) => { executes++; throw new RoomCommandError('OUTCOME_UNKNOWN', 'pending', options.commandId, true) },
        queryResult: async id => { queries++; return complete
            ? { commandId: id, ownerEpoch: 'same-owner', status: 'completed', outcomeUnknown: false, value: { applied: true } }
            : { commandId: id, ownerEpoch: 'same-owner', status: 'pending', outcomeUnknown: true } },
    }
    const publisher = new DurableOwnerEventPublisher(() => gateway, async () => assert.fail('pending confirmation still has time'), 5, 500)
    await publisher.publish('battle.settlement.committed', { originalRun: 'run' })
    await until(() => queries >= 2)
    assert.equal(executes, 1); assert.equal(publisher.inspect().pending, 1); assert.ok(publisher.inspect().pendingBytes > 0)
    complete = true; await until(() => publisher.inspect().pending === 0)
    assert.equal(executes, 1)
})
test('unrecoverable confirmation seals the owner within a finite retry budget, without altering payment', async t => {
    quiet(t); const ids = new Set(); let failures = 0, durableBalance = 77
    const gateway = {
        execute: async (_kind, _payload, options) => { ids.add(options.commandId); throw Error('channel closed') },
        queryResult: async id => { ids.add(id); throw Error('channel closed') },
    }
    const publisher = new DurableOwnerEventPublisher(() => gateway, async () => failures++, 5, 35)
    await publisher.publish('battle.play.commit', { playId: 'already-paid' })
    await until(() => failures > 0)
    assert.equal(failures, 1); assert.equal(ids.size, 1); assert.equal(publisher.inspect().pending, 0)
    assert.equal(durableBalance, 77)
})
test('a definitively stale old settlement does not close or mutate the current room', async t => {
    const value = { applied: false, reason: 'STALE_IDENTITY' }; let failures = 0
    const publisher = new DurableOwnerEventPublisher(() => ({ execute: async () => value, queryResult: async () => assert.fail('known result') }), async () => failures++)
    assert.deepEqual(await publisher.publish('battle.settlement.committed', { originalInstance: 'old' }), value)
    assert.equal(failures, 0); assert.equal(publisher.inspect().pending, 0)
})
