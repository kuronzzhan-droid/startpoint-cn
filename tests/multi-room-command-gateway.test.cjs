const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const Module = require('node:module')
const base = process.env.STARPOINT_TEST_OUT_DIR
  ? path.join(process.env.STARPOINT_TEST_OUT_DIR, 'multi/coordinator')
  : path.resolve(__dirname, '../src/multi/coordinator')
const extension = process.env.STARPOINT_TEST_OUT_DIR ? '.js' : '.ts'
const originalTs = Module._extensions['.ts']
if (!process.env.STARPOINT_TEST_OUT_DIR) {
  const ts = require('typescript')
  Module._extensions['.ts'] = (module, filename) => {
    assert.ok(filename.startsWith(base + path.sep), 'Only gateway source modules are transpiled')
    const result = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, reportDiagnostics: true,
    })
    assert.equal(result.diagnostics?.length ?? 0, 0)
    module._compile(result.outputText, filename)
  }
}
const { RoomCommandGateway } = require(path.join(base, 'command-gateway' + extension))
const { RoomCommandExecutor } = require(path.join(base, 'command-executor' + extension))
const { createRoomCommandId, cloneCommandJson } = require(path.join(base, 'command-protocol' + extension))
if (originalTs) Module._extensions['.ts'] = originalTs
else delete Module._extensions['.ts']
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
const envelope = (kind, payload = {}, extra = {}) => ({ protocol: 1, commandId: createRoomCommandId(), kind, payload, timeoutMs: 1000, ...extra })
const rejectsCode = (promise, code, unknown) => assert.rejects(promise, error => error.code === code && (unknown === undefined || error.outcomeUnknown === unknown))

test('wire rejects closures, getters, sparse arrays and cycles instead of silently losing data', () => {
  for (const value of [{ fn() {} }, { value: undefined }, new Map(), new Date(), NaN, [, 1]]) assert.throws(() => cloneCommandJson(value))
  let invoked = false
  const getter = { get value() { invoked = true; return 1 } }
  assert.throws(() => cloneCommandJson(getter)); assert.equal(invoked, false)
  const cyclic = {}; cyclic.self = cyclic
  assert.throws(() => cloneCommandJson(cyclic))
})

test('payload and query results are deep copies, never mutable owner references', async () => {
  const executor = new RoomCommandExecutor(), gateway = new RoomCommandGateway(executor)
  const live = { members: [{ id: 2 }] }, input = { nested: { n: 1 } }
  executor.register('query', payload => { payload.nested.n = 7; return live })
  const id = createRoomCommandId(), value = await gateway.execute('query', input, { commandId: id })
  assert.equal(input.nested.n, 1)
  value.members[0].id = 99
  const retained = await gateway.queryResult(id)
  assert.equal(retained.value.members[0].id, 2); assert.equal(live.members[0].id, 2)
  retained.value.members[0].id = 3
  assert.equal((await gateway.queryResult(id)).value.members[0].id, 2)
})

test('same ID deduplicates pending and completed commands; different business identity collides', async () => {
  const executor = new RoomCommandExecutor(), gate = deferred(); let applied = 0
  executor.register('write', async payload => { await gate.promise; applied++; return payload })
  const id = createRoomCommandId()
  const first = executor.submit(envelope('write', { a: 1, b: 2 }, { commandId: id }))
  const duplicate = executor.submit(envelope('write', { b: 2, a: 1 }, { commandId: id, timeoutMs: 400 }))
  assert.equal((await executor.submit(envelope('write', { a: 9 }, { commandId: id }))).code, 'COMMAND_ID_COLLISION')
  await pause(0); gate.resolve()
  assert.deepEqual(await first, await duplicate); assert.equal(applied, 1)
  await executor.submit(envelope('write', { a: 1, b: 2 }, { commandId: id }))
  assert.equal(applied, 1)
})

test('timeout is unknown; late commit is queryable and retrying the original ID never applies twice', async () => {
  const executor = new RoomCommandExecutor(), gateway = new RoomCommandGateway(executor), gate = deferred(); let applied = 0
  executor.register('write', async () => { await gate.promise; applied++; return { applied } })
  const id = createRoomCommandId()
  await rejectsCode(gateway.execute('write', {}, { commandId: id, timeoutMs: 5 }), 'OUTCOME_UNKNOWN', true)
  assert.equal(gateway.inspect().pending, 1)
  assert.equal((await gateway.queryResult(id)).status, 'pending')
  gate.resolve(); await pause(0)
  assert.equal((await gateway.queryResult(id)).value.applied, 1)
  assert.deepEqual(await gateway.execute('write', {}, { commandId: id }), { applied: 1 })
  assert.equal(applied, 1); assert.equal(gateway.inspect().pending, 0)
})

test('transport delivery alone cannot acknowledge application; timeout retains pending budget', async () => {
  const response = deferred(), transport = { ownerEpoch: 'owner', submit: () => response.promise, queryResult: () => response.promise }
  const gateway = new RoomCommandGateway(transport, { maxMessages: 1, maxAgeMs: 100, timeoutMs: 5 })
  const id = createRoomCommandId()
  await rejectsCode(gateway.execute('write', {}, { commandId: id }), 'OUTCOME_UNKNOWN', true)
  await rejectsCode(gateway.execute('write', {}), 'PENDING_BUDGET', false)
  response.resolve({ commandId: id, ownerEpoch: 'owner', status: 'completed', outcomeUnknown: false, value: 1 })
  await pause(0); assert.equal(gateway.inspect().pending, 0)
})

test('receiver-local monotonic deadline rejects queued mutation before application', async () => {
  let now = 0, applied = 0; const gate = deferred()
  const executor = new RoomCommandExecutor({ maxConcurrent: 1, now: () => now })
  executor.register('hold', () => gate.promise)
  executor.register('write', () => { applied++; return null })
  const first = executor.submit(envelope('hold')); await pause(0)
  const second = executor.submit(envelope('write', {}, { timeoutMs: 5 }))
  now = 6; gate.resolve(null)
  assert.equal((await second).code, 'EXPIRED_BEFORE_APPLY'); await first
  assert.equal(applied, 0)
})

test('pending duplicate ACK waiters are separately bounded and never trigger another handler', async () => {
  const gate = deferred(), executor = new RoomCommandExecutor({ maxMessages: 1 }); let applied = 0
  executor.register('write', async () => { await gate.promise; applied++; return null })
  const command = envelope('write'), first = executor.submit(command), duplicate = executor.submit(command)
  assert.equal((await executor.submit(command)).code, 'ACK_WAITER_BUDGET')
  assert.equal(executor.inspect().duplicateWaiters, 1)
  gate.resolve(); await Promise.all([first, duplicate])
  assert.equal(executor.inspect().duplicateWaiters, 0); assert.equal(applied, 1)
})

test('count, bytes, result retention and unresolved-age bounds reject before mutation', async () => {
  let now = 0; const gate = deferred(), executor = new RoomCommandExecutor({ maxMessages: 1, maxAgeMs: 10, now: () => now })
  executor.register('hold', () => gate.promise)
  const hold = executor.submit(envelope('hold')); await pause(0)
  assert.equal((await executor.submit(envelope('hold'))).code, 'PENDING_BUDGET')
  const bytes = new RoomCommandExecutor({ maxMessageBytes: 200 })
  assert.equal((await bytes.submit(envelope('write', { text: 'x'.repeat(200) }))).code, 'MESSAGE_BYTE_LIMIT')
  const retained = new RoomCommandExecutor({ maxRecords: 1 }); retained.register('write', () => null)
  await retained.submit(envelope('write'))
  assert.equal((await retained.submit(envelope('write'))).code, 'RESULT_BUDGET')
  const aged = new RoomCommandExecutor({ maxAgeMs: 10, now: () => now }); aged.register('hold', () => gate.promise)
  const pending = aged.submit(envelope('hold')); await pause(0); now = 11
  assert.equal((await aged.submit(envelope('hold'))).code, 'PENDING_AGE_LIMIT')
  gate.resolve(null); await Promise.all([hold, pending])
})

test('result window releases capacity but permanently rejects old IDs, including wall-clock rollback', async () => {
  let wall = 1000, applied = 0
  const executor = new RoomCommandExecutor({ resultRetentionMs: 100, maxRecords: 1, wallNow: () => wall })
  executor.register('write', () => ++applied)
  const old = envelope('write', {}, { commandId: createRoomCommandId(wall) })
  await executor.submit(old); wall = 1101
  assert.equal(executor.inspect().records, 0)
  assert.equal((await executor.submit(old)).code, 'COMMAND_ID_EXPIRED')
  await executor.submit(envelope('write', {}, { commandId: createRoomCommandId(wall) }))
  wall = 1000
  assert.equal((await executor.submit(old)).code, 'COMMAND_ID_EXPIRED'); assert.equal(applied, 2)
})

test('owner epoch fences retry across owner replacement and expected identity stays serializable', async () => {
  const executor = new RoomCommandExecutor({ ownerEpoch: 'new-owner' }); let applied = 0
  executor.register('write', (payload, context) => { applied++; return context.expectedIdentity })
  const command = envelope('write', {}, { expectedOwnerEpoch: 'old-owner' })
  assert.equal((await executor.submit(command)).code, 'OWNER_EPOCH_MISMATCH'); assert.equal(applied, 0)
  const identity = { roomNumber: '123', instanceId: 'a', battleSessionId: 'b', sceneEpoch: 2 }
  const gateway = new RoomCommandGateway(executor)
  assert.deepEqual(await gateway.execute('write', {}, { expectedIdentity: identity }), identity)
})

test('handler failure and invalid result remain explicit uncertain outcomes and are never rerun', async () => {
  let applied = 0; const executor = new RoomCommandExecutor({ maxResultBytes: 200 }), gateway = new RoomCommandGateway(executor)
  executor.register('throw', () => { applied++; throw new Error('private detail') })
  executor.register('large', () => { applied++; return 'x'.repeat(300) })
  const id = createRoomCommandId()
  await rejectsCode(gateway.execute('throw', {}, { commandId: id }), 'HANDLER_FAILED', true)
  const result = await gateway.queryResult(id)
  assert.equal(result.status, 'failed'); assert.ok(!JSON.stringify(result).includes('private detail'))
  await rejectsCode(gateway.execute('throw', {}, { commandId: id }), 'HANDLER_FAILED', true)
  await rejectsCode(gateway.execute('large', {}), 'RESULT_NOT_SERIALIZABLE_OR_TOO_LARGE', true)
  assert.equal(applied, 2)
})

test('close rejects queued work, preserves running result, and gateway never falls back', async () => {
  const gate = deferred(), executor = new RoomCommandExecutor({ maxConcurrent: 1 }); let queuedApplied = false
  executor.register('hold', () => gate.promise)
  executor.register('queued', () => { queuedApplied = true; return null })
  const id = createRoomCommandId(), running = executor.submit(envelope('hold', {}, { commandId: id })); await pause(0)
  const queued = executor.submit(envelope('queued')); executor.close()
  assert.equal((await queued).code, 'EXECUTOR_CLOSED'); assert.equal(queuedApplied, false)
  gate.resolve('late'); await running
  assert.equal((await executor.queryResult(id)).value, 'late')
  const response = deferred(), gateway = new RoomCommandGateway({ submit: () => response.promise, queryResult: () => response.promise })
  const waiting = gateway.execute('write', {}); gateway.close()
  await rejectsCode(waiting, 'OUTCOME_UNKNOWN', true)
  await rejectsCode(gateway.execute('write', {}), 'GATEWAY_CLOSED', false)
  response.resolve({ commandId: 'wrong', ownerEpoch: 'x', status: 'unknown', outcomeUnknown: true }); await pause(0)
  assert.equal(gateway.inspect().pending, 0)
})

test('a blocked initiator detects late ACK with its own monotonic clock even before timeout callback runs', async () => {
  let now = 0; const response = deferred(), id = createRoomCommandId()
  const gateway = new RoomCommandGateway({ ownerEpoch: 'owner', submit: () => response.promise, queryResult: () => response.promise }, { now: () => now })
  const pending = gateway.execute('write', {}, { commandId: id, timeoutMs: 1000 })
  now = 1001
  response.resolve({ commandId: id, ownerEpoch: 'owner', status: 'completed', outcomeUnknown: false, value: 1 })
  await rejectsCode(pending, 'OUTCOME_UNKNOWN', true)
})
