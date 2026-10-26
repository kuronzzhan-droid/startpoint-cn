const { test } = require('node:test'), assert = require('node:assert/strict')
const path = require('node:path'), fs = require('node:fs'), Module = require('node:module')
const out = process.env.STARPOINT_TEST_OUT_DIR || path.resolve(__dirname, '../out')
const sourceMode = !process.env.STARPOINT_TEST_OUT_DIR && !fs.existsSync(path.join(out, 'multi/coordinator/five-boss-command-handlers.js'))
const root = sourceMode ? path.resolve(__dirname, '../src') : out
const ext = sourceMode ? '.ts' : '.js'
const originalExtension = Module._extensions['.ts']
if (sourceMode) {
  const ts = require('typescript')
  Module._extensions['.ts'] = (module, filename) => {
    const result = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, reportDiagnostics: true })
    assert.equal(result.diagnostics?.length ?? 0, 0)
    module._compile(result.outputText, filename)
  }
}
let now = 0, activeRooms = new Map(), clients = [], facts, business
const pause = () => new Promise(resolve => setImmediate(resolve))
const deferred = () => { let resolve, reject; const promise = new Promise((ok, fail) => { resolve = ok; reject = fail }); return { promise, resolve, reject } }
const roomManager = { getRoom: n => activeRooms.get(n), getRoomMemberPlayerId: (r, v) => r.member_player_ids[v] ?? null }
const sessionManager = { getClientsInRoom: () => clients, isBattleSeatRetired: () => false,
  isRescueGuest: () => false, isRescueFragmentEligibleGuest: () => false,
  clearBattleExpectedCount() {}, commitRoomDisband() {}, beginSettlementReturnGrace() {} }
const diagnostics = { begin() {}, memberEvent() {}, socketEvent() {} }
const queues = new Map()
const embedded = { enqueueRoomCommand: (key, fn) => {
  const previous = queues.get(key) || Promise.resolve(), result = previous.then(fn)
  queues.set(key, result.catch(() => {})); return result
}, identity: r => ({ instanceId: r.lifecycle.instanceId }), applyRoomCommand: () => ({ ok: true }) }
const load = name => require(path.join(root, name + ext))
const originalLoad = Module._load
Module._load = function(request, parent, main) {
  if (request === 'perf_hooks') return { performance: { now: () => now } }
  if (request.endsWith('/room/manager')) return roomManager
  if (request.endsWith('/state/SessionManager')) return { sessionManager }
  if (request.endsWith('/coordinator/embedded') || request === './embedded') return { embeddedMultiCoordinator: embedded }
  if (request.endsWith('/coordinator/business-rpc')) return { invokeRealtimeBusiness: (...args) => business(...args), retainRealtimeBusinessTail: tail => tail }
  if (request.endsWith('/coordinator/runtime-role')) return { isRealtimeOwnerChild: () => true }
  if (request.endsWith('/coordinator/business-facts')) return { getPlayerBusinessFacts: () => facts }
  if (request.endsWith('/connection-diagnostic')) return { fiveBossConnectionDiagnostics: diagnostics }
  if (request.endsWith('/coalesced-diagnostics')) return { fiveBossDiagnostics: { report() {} } }
  if (request.endsWith('/room/rematch-roster')) return { ensureRematchReturnReservations() {}, markMemberSettlementCommitted() {}, markRematchReturnWindowOpened() {} }
  if (request.includes('/data/')) throw new Error('Realtime module attempted a database import')
  return originalLoad.apply(this, arguments)
}
const runtime = load('multi/five-boss/lobby-runtime')
const handlers = load('multi/coordinator/five-boss-command-handlers')
const pins = load('multi/coordinator/room-start-claims')
const battleContract = load('multi/state/battle-contract')
const { RoomCommandExecutor } = load('multi/coordinator/command-executor')
const { RoomCommandGateway } = load('multi/coordinator/command-gateway')
const { createRoomCommandId } = load('multi/coordinator/command-protocol')
const mode = load('multi/five-boss/contract').FIVE_BOSS_GAUNTLET
Module._load = originalLoad
if (sourceMode) { if (originalExtension) Module._extensions['.ts'] = originalExtension; else delete Module._extensions['.ts'] }
let sequence = 0
function fixture() {
  now = 0
  const n = String(++sequence), r = { room_number: n, category: mode.category, quest_id: mode.visibleQuestId,
    lobby_generation: 1, host_viewer_id: 1, host_player_id: 11, member_viewer_ids: [1],
    member_player_ids: { 1: 11 }, expected_real_viewer_ids: [1], raising_state: 4, mates: [],
    lifecycle: { instanceId: 'instance-' + n, battleSessionId: 'battle-' + n, phase: 'BATTLE', sceneEpoch: 0, version: 1 },
    five_boss_runtime: { runId: 'frozen-' + n, expectedRealPlayerIds: [11], autoplayModeByPlayerId: { 11: false },
      partyCharacterIdsByPlayerId: { 11: [101] }, battleIdentityByViewerId: { 1: { playerId: 11, connectionId: 'cid', remoteAddress: 'fixture' } } } }
  activeRooms.set(n, r)
  const executor = new RoomCommandExecutor(); handlers.registerFiveBossCommandHandlers(executor)
  const gateway = new RoomCommandGateway(executor)
  const payload = { body: { room_number: n, category: mode.category, quest_id: mode.visibleQuestId, viewer_id: 1, play_id: 'play-' + n }, playerId: 11 }
  return { r, gateway, payload }
}

test('a finalized frozen member is result-pending even while the old room remains in BATTLE', async () => {
  const old = fixture(), next = fixture(), playId = old.payload.body.play_id
  battleContract.bindBattlePlay(old.r, 1, 11, playId, old.r.lifecycle.battleSessionId)
  battleContract.markBattleMemberPhase(old.r, 1, 'FINALIZED')
  const staleQuest = { playId, category: mode.category, questId: mode.visibleQuestId,
    isMulti: true, roomNumber: old.r.room_number }
  const claim = await next.gateway.execute('fiveBoss.start.prepare', { ...next.payload, staleQuest,
    staleFrozenRunId: old.r.five_boss_runtime.runId })
  assert.equal(claim.oldPlayRecovery.recoverable, false)
  assert.equal(claim.oldPlayRecovery.reason, 'result_pending')
  await next.gateway.execute('fiveBoss.start.cancel', { token: claim.token, playerId: 11, playId: next.payload.body.play_id })
  const decision = await old.gateway.execute('fiveBoss.recovery', { staleQuest, playerId: 11,
    staleFrozenRunId: old.r.five_boss_runtime.runId })
  assert.equal(decision.reason, 'result_pending')
  assert.equal(decision.roomPhase, 'BATTLE')
})

test('unresolved old start claims remain protected even after a Finalize observation', async () => {
  const old = fixture(), next = fixture(), claim = await old.gateway.execute('fiveBoss.start.prepare', old.payload)
  const playId = old.payload.body.play_id
  battleContract.bindBattlePlay(old.r, 1, 11, playId, old.r.lifecycle.battleSessionId)
  battleContract.markBattleMemberPhase(old.r, 1, 'FINALIZED')
  const pending = await next.gateway.execute('fiveBoss.start.prepare', { ...next.payload,
    staleQuest: { playId, category: mode.category, questId: mode.visibleQuestId, isMulti: true, roomNumber: old.r.room_number },
    staleFrozenRunId: old.r.five_boss_runtime.runId })
  assert.equal(pending.oldPlayRecovery.recoverable, true)
  await old.gateway.execute('fiveBoss.start.cancel', { token: claim.token, playerId: 11, playId })
  await next.gateway.execute('fiveBoss.start.cancel', { token: pending.token, playerId: 11, playId: next.payload.body.play_id })
})

test('owner prepares an independent frozen projection and pins until exact play commit', async () => {
  const x = fixture(), claim = await x.gateway.execute('fiveBoss.start.prepare', x.payload)
  assert.equal(claim.status, 'ready'); assert.ok(pins.hasRoomStartClaims(x.r))
  claim.room.five_boss_runtime.expectedRealPlayerIds.push(999)
  assert.deepEqual(x.r.five_boss_runtime.expectedRealPlayerIds, [11])
  const collision = await x.gateway.execute('fiveBoss.start.prepare', { ...x.payload, body: { ...x.payload.body, play_id: 'other' } })
  assert.equal(collision.status, 'unavailable')
  assert.equal((await x.gateway.execute('fiveBoss.start.commit', { token: claim.token, playerId: 11, playId: 'other', runId: claim.frozenRunId })).applied, false)
  assert.ok(pins.hasRoomStartClaims(x.r))
  assert.equal((await x.gateway.execute('fiveBoss.start.commit', { token: claim.token, playerId: 11, playId: x.payload.body.play_id, runId: claim.frozenRunId })).applied, true)
  assert.equal(pins.hasRoomStartClaims(x.r), false)
})

test('expired claim stays pinned; synchronous transaction validation rejects age and identity changes', async () => {
  const x = fixture(), claim = await x.gateway.execute('fiveBoss.start.prepare', x.payload)
  handlers.assertFiveBossStartClaim(claim.token)
  x.r.five_boss_runtime.runId += '-replaced'
  assert.throws(() => handlers.assertFiveBossStartClaim(claim.token))
  x.r.five_boss_runtime.runId = claim.frozenRunId
  now = 10001
  assert.throws(() => handlers.assertFiveBossStartClaim(claim.token)); assert.ok(pins.hasRoomStartClaims(x.r))
  const unresolved = await x.gateway.execute('fiveBoss.start.query', { token: claim.token, playerId: 11, playId: x.payload.body.play_id })
  assert.equal(unresolved.status, 'pending'); assert.equal(unresolved.remainingMs, 0); assert.equal(unresolved.current, true)
  assert.ok(handlers.inspectFiveBossStartClaims().expiredUnresolved >= 1)
  const result = await x.gateway.execute('fiveBoss.start.cancel', { token: claim.token, playerId: 11, playId: x.payload.body.play_id })
  assert.equal(result.applied, true); assert.equal(pins.hasRoomStartClaims(x.r), false)
  assert.equal((await x.gateway.execute('fiveBoss.start.commit', { token: claim.token, playerId: 11, playId: x.payload.body.play_id, runId: claim.frozenRunId })).applied, false)
})

test('concurrent same-play attempts own separate pins; cancelling one cannot release or expire the other', async () => {
  const x = fixture(), a = await x.gateway.execute('fiveBoss.start.prepare', x.payload)
  const b = await x.gateway.execute('fiveBoss.start.prepare', x.payload)
  assert.notEqual(a.token, b.token)
  await x.gateway.execute('fiveBoss.start.cancel', { token: a.token, playerId: 11, playId: x.payload.body.play_id })
  assert.ok(pins.hasRoomStartClaims(x.r)); handlers.assertFiveBossStartClaim(b.token)
  assert.equal((await x.gateway.execute('fiveBoss.start.commit', { token: b.token, playerId: 11, playId: x.payload.body.play_id, runId: b.frozenRunId })).applied, true)
  assert.equal(pins.hasRoomStartClaims(x.r), false)
})

test('verified durable same-play retry reconciles old expired claims with no unpinned control window', async () => {
  const x = fixture(), old = await x.gateway.execute('fiveBoss.start.prepare', x.payload)
  now = 11000; let released = false
  pins.deferPinnedRoomControl(x.r, () => { released = true })
  const wrongRun = await x.gateway.execute('fiveBoss.start.prepare', { ...x.payload, durableRunId: 'other-run' })
  assert.equal((await x.gateway.execute('fiveBoss.start.query', { token: old.token, playerId: 11, playId: x.payload.body.play_id })).status, 'pending')
  await x.gateway.execute('fiveBoss.start.cancel', { token: wrongRun.token, playerId: 11, playId: x.payload.body.play_id })
  const fresh = await x.gateway.execute('fiveBoss.start.prepare', { ...x.payload, durableRunId: old.frozenRunId })
  assert.equal((await x.gateway.execute('fiveBoss.start.query', { token: old.token, playerId: 11, playId: x.payload.body.play_id })).status, 'committed')
  assert.ok(pins.hasRoomStartClaims(x.r)); assert.equal(released, false)
  await x.gateway.execute('fiveBoss.start.commit', { token: fresh.token, playerId: 11, playId: x.payload.body.play_id, runId: fresh.frozenRunId })
  assert.equal(released, true); assert.equal(pins.hasRoomStartClaims(x.r), false)
})

test('a lost Prepare ACK can cancel its known attempt after the room queue drains', async () => {
  const x = fixture(), gate = deferred(), commandId = createRoomCommandId()
  queues.set(x.r.room_number, gate.promise)
  const preparing = x.gateway.execute('fiveBoss.start.prepare', x.payload, { commandId, timeoutMs: 5 })
  await assert.rejects(preparing, error => error.outcomeUnknown === true)
  const cancelling = x.gateway.execute('fiveBoss.start.cancel', {
    token: commandId, playerId: 11, playId: x.payload.body.play_id, roomNumber: x.r.room_number,
  })
  gate.resolve(); assert.equal((await cancelling).applied, true)
  assert.equal(pins.hasRoomStartClaims(x.r), false)
  assert.equal((await x.gateway.execute('fiveBoss.start.query', { token: commandId, playerId: 11, playId: x.payload.body.play_id })).status, 'cancelled')
})

test('a late durable commit can reconcile its pinned original token but not a replaced owner room', async () => {
  const x = fixture(), claim = await x.gateway.execute('fiveBoss.start.prepare', x.payload)
  now = 12000
  assert.equal((await x.gateway.execute('fiveBoss.start.commit', { token: claim.token, playerId: 11, playId: x.payload.body.play_id, runId: claim.frozenRunId })).applied, true)
  assert.equal((await x.gateway.execute('fiveBoss.start.commit', { token: claim.token, playerId: 11, playId: x.payload.body.play_id, runId: claim.frozenRunId })).applied, true)
  assert.equal((await x.gateway.execute('fiveBoss.start.query', { token: claim.token, playerId: 11, playId: x.payload.body.play_id })).status, 'committed')
  assert.equal((await x.gateway.execute('fiveBoss.start.cancel', { token: claim.token, playerId: 11, playId: x.payload.body.play_id })).reason, 'ALREADY_COMMITTED')
  const y = fixture(), stale = await y.gateway.execute('fiveBoss.start.prepare', y.payload)
  activeRooms.set(y.r.room_number, { ...y.r, lifecycle: { ...y.r.lifecycle, instanceId: 'replacement' } })
  assert.equal((await y.gateway.execute('fiveBoss.start.commit', { token: stale.token, playerId: 11, playId: y.payload.body.play_id, runId: stale.frozenRunId })).applied, false)
  await y.gateway.execute('fiveBoss.start.cancel', { token: stale.token, playerId: 11, playId: y.payload.body.play_id })
})

test('a durable member settlement reconciles its paid claim while another start remains pinned', async () => {
  const x = fixture()
  x.r.member_viewer_ids.push(2); x.r.expected_real_viewer_ids.push(2); x.r.member_player_ids[2] = 22
  x.r.five_boss_runtime.expectedRealPlayerIds.push(22)
  const a = await x.gateway.execute('fiveBoss.start.prepare', x.payload)
  const b = await x.gateway.execute('fiveBoss.start.prepare', { playerId: 22,
    body: { ...x.payload.body, viewer_id: 2, play_id: 'other-member' } })
  let downgraded
  pins.deferPinnedRoomControl(x.r, () => { downgraded = battleContract.markBattleMemberPhase(x.r, 1, 'FINALIZED') })
  assert.equal((await x.gateway.execute('fiveBoss.terminal', { roomNumber: x.r.room_number, runId: a.frozenRunId,
    runStatus: 'active', playerId: 11, viewerId: 1, playId: x.payload.body.play_id })).applied, true)
  assert.ok(pins.hasRoomStartClaims(x.r))
  assert.equal(battleContract.findBattlePlayBinding(x.r, 1, 11, x.payload.body.play_id).phase, 'SETTLED')
  assert.equal((await x.gateway.execute('fiveBoss.start.query', { token: a.token, playerId: 11, playId: x.payload.body.play_id })).status, 'committed')
  await x.gateway.execute('fiveBoss.start.cancel', { token: b.token, playerId: 22, playId: 'other-member' })
  assert.equal(downgraded, false)
  assert.equal(battleContract.findBattlePlayBinding(x.r, 1, 11, x.payload.body.play_id).phase, 'SETTLED')
})

test('durable terminal run retires controls before releasing unresolved claims; old run events cannot unlock a new run', async () => {
  const x = fixture(), claim = await x.gateway.execute('fiveBoss.start.prepare', x.payload)
  battleContract.ensureBattleSessionContract(x.r)
  assert.equal((await x.gateway.execute('fiveBoss.terminal', { roomNumber: x.r.room_number, runId: 'stale-run', runStatus: 'settled' })).applied, false)
  assert.ok(pins.hasRoomStartClaims(x.r))
  let playable
  pins.deferPinnedRoomControl(x.r, () => { playable = battleContract.battleMemberCanPlay(x.r, 1) })
  assert.equal((await x.gateway.execute('fiveBoss.terminal', { roomNumber: x.r.room_number, runId: claim.frozenRunId, runStatus: 'settled' })).applied, true)
  assert.equal(playable, false); assert.equal(pins.hasRoomStartClaims(x.r), false)
  assert.equal((await x.gateway.execute('fiveBoss.start.query', { token: claim.token, playerId: 11, playId: x.payload.body.play_id })).status, 'cancelled')
  assert.equal((await x.gateway.execute('fiveBoss.start.prepare', x.payload)).status, 'unavailable')
})

test('accepted TCP proof returns immediately while the owner finish barrier waits for business application ACK', async () => {
  const x = fixture(), gate = deferred(), sent = []
  business = (kind, payload) => { sent.push({ kind, payload }); return gate.promise }
  const client = { viewerId: 1, playerId: 11, connectionId: 'cid', superseded: false, socket: {} }
  assert.equal(runtime.recordFiveBossSignal(x.r, client, 'level_next'), true)
  assert.equal(sent.length, 1); assert.equal(sent[0].kind, 'fiveBoss.proof.persist')
  assert.equal(sent[0].payload.roomInstanceId, x.r.lifecycle.instanceId)
  let drained = false
  const barrier = x.gateway.execute('fiveBoss.proof.barrier', { runId: x.r.five_boss_runtime.runId, playerId: 11 }).then(result => { drained = true; return result })
  await pause(); assert.equal(drained, false)
  gate.resolve({ persisted: true }); assert.deepEqual(await barrier, { ok: true })
})

test('finish barrier follows already buffered proof controls during another unresolved start', async () => {
  const x = fixture(), claim = await x.gateway.execute('fiveBoss.start.prepare', x.payload), ack = deferred()
  business = () => ack.promise
  const client = { viewerId: 1, playerId: 11, connectionId: 'cid', superseded: false, socket: {} }
  pins.deferPinnedRoomControl(x.r, () => runtime.recordFiveBossSignal(x.r, client, 'finalize'))
  let finished = false
  const barrier = x.gateway.execute('fiveBoss.proof.barrier', { runId: claim.frozenRunId, playerId: 11, roomNumber: x.r.room_number })
    .then(result => { finished = true; return result })
  await pause(); assert.equal(finished, false)
  await x.gateway.execute('fiveBoss.start.commit', { token: claim.token, playerId: 11, playId: x.payload.body.play_id, runId: claim.frozenRunId })
  await pause(); assert.equal(finished, false)
  ack.resolve({ persisted: true }); assert.deepEqual(await barrier, { ok: true })
})

test('unknown business outcome keeps the original proof tail pending until its late application confirmation', async () => {
  const x = fixture(), confirmation = deferred(); let calls = 0
  business = () => { calls++; return Promise.reject(Object.assign(Error('business ACK deadline'), {
    code: 'BUSINESS_OUTCOME_UNKNOWN', confirmation: confirmation.promise,
  })) }
  const client = { viewerId: 1, playerId: 11, connectionId: 'cid', superseded: false, socket: {} }
  assert.equal(runtime.recordFiveBossSignal(x.r, client, 'finalize'), true)
  let drained = false
  const barrier = x.gateway.execute('fiveBoss.proof.barrier', { runId: x.r.five_boss_runtime.runId, playerId: 11 })
    .then(result => { drained = true; return result })
  await pause(); assert.equal(drained, false); assert.equal(calls, 1)
  confirmation.resolve({ persisted: true })
  assert.deepEqual(await barrier, { ok: true }); assert.equal(calls, 1)
})

test('a closed original confirmation makes the accepted proof unavailable instead of paying or replaying', async () => {
  const x = fixture(), confirmation = deferred(); let calls = 0
  business = () => { calls++; return Promise.reject(Object.assign(Error('business ACK deadline'), {
    code: 'BUSINESS_OUTCOME_UNKNOWN', confirmation: confirmation.promise,
  })) }
  const client = { viewerId: 1, playerId: 11, connectionId: 'cid', superseded: false, socket: {} }
  runtime.recordFiveBossSignal(x.r, client, 'level_next')
  await pause(); confirmation.reject(Error('business channel closed'))
  assert.deepEqual(await x.gateway.execute('fiveBoss.proof.barrier', { runId: x.r.five_boss_runtime.runId, playerId: 11 }), { ok: false })
  assert.equal(calls, 1)
})

test('proof failure stays visible to finish; retransmission may retry durable proof without duplicate in-flight writes', async () => {
  const x = fixture(), first = deferred(); let calls = 0
  business = () => { calls++; return first.promise }
  const client = { viewerId: 1, playerId: 11, connectionId: 'cid', superseded: false, socket: {} }
  assert.equal(runtime.recordFiveBossSignal(x.r, client, 'finalize'), true)
  assert.equal(runtime.recordFiveBossSignal(x.r, client, 'finalize'), true); assert.equal(calls, 1)
  first.reject(new Error('business busy')); await runtime.waitForFiveBossSignalPersistence(x.r.five_boss_runtime.runId, 11)
  assert.deepEqual(runtime.fiveBossProofBarrierStatus(x.r.five_boss_runtime.runId, 11), { ok: false })
  business = () => { calls++; return Promise.resolve({ persisted: true }) }
  assert.equal(runtime.recordFiveBossSignal(x.r, client, 'finalize'), true)
  await runtime.waitForFiveBossSignalPersistence(x.r.five_boss_runtime.runId, 11)
  assert.deepEqual(runtime.fiveBossProofBarrierStatus(x.r.five_boss_runtime.runId, 11), { ok: true }); assert.equal(calls, 2)
})

test('the child freezes only parent-authenticated owned characters and never reads a database', () => {
  const x = fixture(); delete x.r.five_boss_runtime
  const wire = { viewerId: 1, comId: 0, state: [1], autoplayMode: false,
    party: { characters: [[0, { id: 101 }]], unison_characters: [] } }
  clients = [{ viewerId: 1, playerId: 11, isBattle: false, superseded: false, yourself: wire,
    connectionId: 'cid', mates: [wire, { comId: 1, state: [1] }], socket: { remoteAddress: 'fixture' } }]
  facts = undefined; assert.equal(runtime.freezeFiveBossLobby(x.r), false)
  facts = { ownedCharacterIds: [101] }; assert.equal(runtime.freezeFiveBossLobby(x.r), true)
})
