const { test } = require('node:test'), assert = require('node:assert/strict')
const path = require('node:path'), fs = require('node:fs'), Module = require('node:module')
const out = process.env.STARPOINT_TEST_OUT_DIR || path.resolve(__dirname, '../out')
const sourceMode = !process.env.STARPOINT_TEST_OUT_DIR && !fs.existsSync(path.join(out, 'multi/coordinator/five-boss-command-handlers.js'))
const root = sourceMode ? path.resolve(__dirname, '../src') : out
const ext = sourceMode ? '.ts' : '.js'
function loadHttp(state) {
  const oldLoad = Module._load, oldExtension = Module._extensions['.ts']
  if (sourceMode) {
    const ts = require('typescript')
    Module._extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText, filename)
  }
  const contract = require(path.join(root, 'multi/five-boss/contract' + ext))
  class RuntimeError extends Error { constructor(code, message) { super(message); this.code = code } }
  Module._load = function(request, parent, main) {
    if (request.endsWith('/coordinator/durable-owner-event')) return { publishDurableOwnerDecision: async (kind, payload) => {
      state.commands.push({ kind, payload }); return { applied: true }
    } }
    if (request.endsWith('/coordinator/default-runtime')) return {
      getRoomCommandGateway: () => ({ execute: async (kind, payload, options) => {
        state.commands.push({ kind, payload, options })
        if (kind === 'fiveBoss.start.prepare') return { status: 'ready', token: options.commandId, ownerEpoch: 'owner',
          remainingMs: 10000, room: { mates: [], host_player_id: state.hostId }, frozenRunId: 'run', oldPlayRecovery: state.oldPlayRecovery }
        if (kind === 'fiveBoss.recovery') {
          if (state.ownerRecoveryError) throw state.ownerRecoveryError
          return state.hostAuthorization
        }
        if (kind === 'fiveBoss.proof.barrier') return { ok: state.proofOk }
        return { applied: true }
      } }), assertRealtimeOwnerEpoch() {},
    }
    if (request.endsWith('/domains/quest_active')) return {
      getPlayerActiveQuestSync: id => id === 11 ? state.stale : state.hostActive, deletePlayerActiveQuestIfPlayIdSync: () => true,
    }
    if (request.endsWith('/domains/battle-settlement-ledger')) return {
      assertBattleCanStartSync: () => {
        assert.ok(state.transactionDepth > 0, 'terminal guard must run inside the actual start transaction')
        state.startGuards++
        if (state.startGuardError) throw state.startGuardError
      },
      getBattleReplaySync: () => {
        assert.ok(state.transactionDepth > 0, 'special finish must recheck generic terminal identity inside its transaction')
        state.replayGuards++
        return state.replay
      },
    }
    if (request.endsWith('/domains/fiveBossGauntletRun')) return {
      FiveBossGauntletRunError: RuntimeError, getFiveBossRunByClientSync: () => state.boundRun,
      backfillMissingFinalizeSync: () => ({ backfilled: false }),
      detachFinalizedFiveBossActiveSync: (playerId, playId) => {
        state.detaches.push({ playerId, playId })
        if (!state.canDetach) return false
        state.stale = null; return true
      },
    }
    if (request.endsWith('/domains/item')) return { getPlayerItemSync: () => 3 }
    if (request.endsWith('/domains/player')) return { getPlayerSync: () => ({ id: 11, stamina: 5, staminaHealTime: 0 }), updatePlayerSync() {} }
    if (request.endsWith('/domains/party')) return { isValidNormalPartySlotSync: () => false }
    if (request.endsWith('/domains/equipment') || request.endsWith('/lib/equipment')) return {}
    if (request.endsWith('/utils')) return { generateDataHeaders: () => ({}), realToVirtual: x => x, getServerTime: x => x }
    if (request.endsWith('/api/singleBattleQuest')) return { activeQuests: state.memory }
    if (request.endsWith('/five-boss/battle-runtime')) return {
      FiveBossBattleRuntimeError: RuntimeError,
      startFiveBossBattle: input => { state.starts++; state.startInputs.push(input); return { runId: 'run', activeQuest: { playId: 'play' }, startStatus: 'started' } },
      finishFiveBossBattle: () => { state.payments++; throw Error('Unexpected payout') },
      abortFiveBossBattle: () => { state.aborts++; throw Error('Unexpected abort') },
    }
    if (request.endsWith('/five-boss/rewards')) return {}
    if (request.endsWith('/five-boss/solo-runtime')) return { abandonFiveBossSoloForMultiSync: () => {
      state.abandons++; delete state.memory[11]; return true
    } }
    if (request.endsWith('/data/db')) return { getDb: () => ({ inTransaction: state.inTransaction,
      prepare: sql => ({ get: () => {
        if (state.readFails) throw Error('read unavailable')
        return sql.includes('started_at') ? state.member : undefined
      } }),
    }) }
    if (request.endsWith('/lib/persistence-coordinator')) return { runPersistenceTransaction: async (_, fn) => {
      state.transactions++; state.transactionDepth++
      try { return state.transaction(fn) } finally { state.transactionDepth-- }
    } }
    if (request.endsWith('/lib/settlement-performance')) return { measureSettlementPhaseAsync: (_, __, fn) => fn() }
    if (request.endsWith('/connection-diagnostic')) return { fiveBossConnectionDiagnostics: { memberEvent() {} } }
    if (request.endsWith('/coalesced-diagnostics')) return { fiveBossDiagnostics: { report() {} } }
    if (request.endsWith('/room/manager') || request.endsWith('/state/SessionManager')) throw Error('HTTP imported realtime authority')
    return oldLoad.apply(this, arguments)
  }
  const filename = path.join(root, 'multi/http/five-boss-battle' + ext)
  delete require.cache[filename]
  try { return { http: require(filename), mode: contract.FIVE_BOSS_GAUNTLET } }
  finally {
    Module._load = oldLoad
    if (oldExtension) Module._extensions['.ts'] = oldExtension; else delete Module._extensions['.ts']
  }
}
function fixture() {
  const state = { commands: [], memory: {}, proofOk: false, transactions: 0, payments: 0, aborts: 0,
    hostId: 11, hostActive: null, hostAuthorization: null, ownerRecoveryError: null,
    oldPlayRecovery: null, canDetach: false, detaches: [], startInputs: [],
    starts: 0, abandons: 0, startGuards: 0, replayGuards: 0, transactionDepth: 0,
    startGuardError: null, replay: { kind: 'missing' },
    transaction: fn => fn(), boundRun: null, stale: null, member: null, inTransaction: false, readFails: false }
  const { http, mode } = loadHttp(state)
  const body = { category: mode.category, quest_id: mode.visibleQuestId, room_number: 'room', viewer_id: 1, play_id: 'play', party_id: 1 }
  const reply = { header() { return this }, status() { return this }, send(value) { this.value = value; return this } }
  return { state, http, mode, body, reply }
}

test('Finalize pending admission detaches the old play without invoking shared-run abort', async () => {
  const x = fixture()
  x.state.stale = { playId: 'old-finalized', isMulti: true, roomNumber: 'old-room', category: x.mode.category, questId: x.mode.visibleQuestId }
  x.state.memory[11] = x.state.stale
  x.state.oldPlayRecovery = { playId: 'old-finalized', recoverable: false, reason: 'result_pending', retained: true }
  x.state.hostAuthorization = x.state.oldPlayRecovery; x.state.canDetach = true
  await x.http.handleFiveBossStart(x.body, 11, x.reply)
  assert.deepEqual(x.state.detaches, [{ playerId: 11, playId: 'old-finalized' }])
  assert.equal(x.state.aborts, 0)
  assert.equal(x.state.memory[11].playId, 'play')
})

test('an unknown host recovery decision cancels only this claim before SQL or payment', async () => {
  const x = fixture(), failure = Object.assign(Error('owner unavailable'), { outcomeUnknown: true })
  x.state.hostId = 22
  x.state.hostActive = { playId: 'host-old', isMulti: true, roomNumber: 'old-room' }
  x.state.ownerRecoveryError = failure
  await assert.rejects(x.http.handleFiveBossStart(x.body, 11, x.reply), error => error === failure)
  assert.equal(x.state.transactions, 0); assert.equal(x.state.starts, 0)
  const cancel = x.state.commands.find(c => c.kind === 'fiveBoss.start.cancel')
  assert.equal(cancel.payload.token, x.state.commands.find(c => c.kind === 'fiveBoss.start.prepare').options.commandId)
})

test('the first-debit runtime receives only the owner decision bound to the host previous play', async () => {
  const x = fixture()
  x.state.hostId = 22
  x.state.hostActive = { playId: 'host-old', isMulti: true, roomNumber: 'old-room' }
  x.state.hostAuthorization = { playId: 'host-old', recoverable: false, reason: 'result_pending', retained: true }
  await x.http.handleFiveBossStart(x.body, 11, x.reply)
  const request = x.state.commands.find(c => c.kind === 'fiveBoss.recovery')
  assert.equal(request.payload.playerId, 22)
  assert.equal(request.payload.staleQuest.playId, 'host-old')
  assert.deepEqual(x.state.startInputs[0].hostAdmissionAuthorization, x.state.hostAuthorization)
})

test('definite parent persistence rollback cancels only its claim; unknown outcome remains pinned', async () => {
  const x = fixture(), failure = Error('known rollback')
  x.state.transaction = fn => { fn(); throw failure }
  await assert.rejects(x.http.handleFiveBossStart(x.body, 11, x.reply), error => error === failure)
  const prepare = x.state.commands.find(c => c.kind === 'fiveBoss.start.prepare')
  const cancel = x.state.commands.find(c => c.kind === 'fiveBoss.start.cancel')
  assert.equal(cancel.payload.token, prepare.options.commandId)
  const y = fixture(), unknown = Object.assign(Error('commit outcome unavailable'), { outcomeUnknown: true })
  y.state.transaction = fn => { fn(); throw unknown }
  await assert.rejects(y.http.handleFiveBossStart(y.body, 11, y.reply), error => error === unknown)
  assert.equal(y.state.commands.some(c => c.kind === 'fiveBoss.start.cancel'), false)
  assert.equal(y.state.commands.some(c => c.kind === 'fiveBoss.start.commit'), false)
})

test('failed attempt cannot erase a concurrent successful same-play memory assignment', async () => {
  const x = fixture(), concurrent = { playId: 'play', marker: 'other committed attempt' }
  x.state.stale = { playId: 'old', isMulti: false, category: x.mode.category, questId: x.mode.visibleQuestId }
  x.state.memory[11] = x.state.stale
  x.state.transaction = fn => { fn(); x.state.memory[11] = concurrent; throw Error('known rollback') }
  await assert.rejects(x.http.handleFiveBossStart(x.body, 11, x.reply))
  assert.equal(x.state.memory[11], concurrent)
})

test('verified durable original commit is reconciled after an observer throws, without cancellation or repayment', async () => {
  const x = fixture(), failure = Error('observer threw after commit')
  x.state.transaction = fn => {
    fn()
    x.state.boundRun = { runId: 'run', status: 'active', roomNumber: 'room' }
    x.state.stale = { playId: 'play', isMulti: true, roomNumber: 'room', category: x.mode.category, questId: x.mode.visibleQuestId }
    x.state.member = { started_at: '2026-10-11', aborted_at: null }
    throw failure
  }
  await assert.rejects(x.http.handleFiveBossStart(x.body, 11, x.reply), error => error === failure)
  assert.equal(x.state.commands.some(c => c.kind === 'fiveBoss.start.cancel'), false)
  assert.equal(x.state.commands.filter(c => c.kind === 'fiveBoss.start.commit').length, 1)
  assert.equal(x.state.memory[11].playId, 'play'); assert.equal(x.state.transactions, 1)
})

test('run binding alone cannot authorize unresolved pin reconciliation without matching active quest and member start', async () => {
  const x = fixture()
  x.state.boundRun = { runId: 'run', status: 'active', roomNumber: 'room' }
  x.state.member = { started_at: '2026-10-11', aborted_at: null }
  await x.http.handleFiveBossStart(x.body, 11, x.reply)
  assert.equal(x.state.commands.find(c => c.kind === 'fiveBoss.start.prepare').payload.durableRunId, undefined)
  const y = fixture()
  y.state.boundRun = x.state.boundRun; y.state.stale = { playId: 'play', isMulti: true, roomNumber: 'room', category: y.mode.category, questId: y.mode.visibleQuestId }
  y.state.member = { started_at: null, aborted_at: null }
  await y.http.handleFiveBossStart(y.body, 11, y.reply)
  assert.equal(y.state.commands.find(c => c.kind === 'fiveBoss.start.prepare').payload.durableRunId, undefined)
  const valid = fixture()
  valid.state.boundRun = x.state.boundRun; valid.state.stale = { ...y.state.stale }; valid.state.member = x.state.member
  await valid.http.handleFiveBossStart(valid.body, 11, valid.reply)
  assert.equal(valid.state.commands.find(c => c.kind === 'fiveBoss.start.prepare').payload.durableRunId, 'run')
  const wrongRoom = fixture()
  wrongRoom.state.boundRun = x.state.boundRun; wrongRoom.state.stale = { ...y.state.stale, roomNumber: 'reused-room' }; wrongRoom.state.member = x.state.member
  await wrongRoom.http.handleFiveBossStart(wrongRoom.body, 11, wrongRoom.reply)
  assert.equal(wrongRoom.state.commands.find(c => c.kind === 'fiveBoss.start.prepare').payload.durableRunId, undefined)
})

test('a failed durable-state read or unresolved database transaction cannot authorize Cancel', async () => {
  for (const uncertainty of ['readFails', 'inTransaction']) {
    const x = fixture()
    x.state.transaction = fn => { fn(); x.state.boundRun = { runId: 'run', status: 'active', roomNumber: 'room' }
      x.state.stale = { playId: 'play', isMulti: true, roomNumber: 'room', category: x.mode.category, questId: x.mode.visibleQuestId }
      x.state[uncertainty] = true; throw Error('rollback result unavailable') }
    await assert.rejects(x.http.handleFiveBossStart(x.body, 11, x.reply))
    assert.equal(x.state.commands.some(c => c.kind === 'fiveBoss.start.cancel'), false)
    assert.equal(x.state.commands.some(c => c.kind === 'fiveBoss.start.commit'), false)
  }
})

test('proof persistence failure returns unavailable without payout or abort of the original play', async () => {
  const x = fixture()
  x.state.boundRun = { runId: 'run', status: 'active', roomNumber: 'room' }
  await assert.rejects(x.http.handleFiveBossFinish({ ...x.body, is_accomplished: true }, 11, x.reply, async () => []),
    error => error.code === 'PROOF_PERSISTENCE_UNAVAILABLE' && error.outcomeUnknown === true)
  assert.equal(x.state.transactions, 0); assert.equal(x.state.payments, 0); assert.equal(x.state.aborts, 0)
  assert.equal(x.state.commands.some(c => c.kind === 'fiveBoss.terminal'), false)
})

test('generic terminal identity rejects a five-boss start before stale cleanup, ticket payment or registration', async () => {
  const x = fixture(), stale = { playId: 'old-solo', isMulti: false, category: x.mode.category, questId: x.mode.visibleQuestId }
  x.state.stale = stale; x.state.memory[11] = stale
  const blocked = Object.assign(Error('This play has already settled.'), { code: 'BATTLE_ALREADY_SETTLED' })
  x.state.startGuardError = blocked
  await assert.rejects(x.http.handleFiveBossStart(x.body, 11, x.reply), error => error === blocked)
  assert.equal(x.state.startGuards, 1)
  assert.equal(x.state.abandons, 0, 'a rejected new identity must not abort the existing solo run')
  assert.equal(x.state.starts, 0, 'ticket payment and active registration belong to a later runtime call')
  assert.equal(x.state.memory[11], stale)
  assert.equal(x.state.commands.some(c => c.kind === 'fiveBoss.start.cancel'), true)
  assert.equal(x.state.commands.some(c => c.kind === 'fiveBoss.start.commit'), false)
})

test('generic expired, corrupt or cross-mode identity cannot reach specialized finish payment', async () => {
  for (const kind of ['expired', 'corrupt', 'other-mode']) {
    const x = fixture()
    x.state.proofOk = true
    x.state.boundRun = { runId: 'run', status: 'active', roomNumber: 'room' }
    x.state.replay = { kind }
    await assert.rejects(x.http.handleFiveBossFinish({ ...x.body, is_accomplished: true }, 11, x.reply, async () => []),
      error => error.code === 'run_identity_mismatch')
    assert.equal(x.state.replayGuards, 1)
    assert.equal(x.state.payments, 0)
    assert.equal(x.state.aborts, 0)
  }
})

test('the real durable ledger rejects a queued start for a terminal run before payment or active-quest callback', () => {
  const SQLite = require('better-sqlite3'), db = new SQLite(':memory:')
  db.exec(`CREATE TABLE five_boss_gauntlet_runs (run_id TEXT PRIMARY KEY, host_player_id INTEGER,
    route_id TEXT, room_number TEXT, ticket_item_id INTEGER, expected_member_count INTEGER,
    status TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE five_boss_gauntlet_members (run_id TEXT, player_id INTEGER, client_play_id TEXT,
      is_auto_mode INTEGER, started_at TEXT, battle_entered_at TEXT, aborted_at TEXT,
      level_next_at TEXT, finalized_at TEXT)`)
  const oldLoad = Module._load, oldExtension = Module._extensions['.ts']
  let paymentReads = 0, callbacks = 0
  if (sourceMode) {
    const ts = require('typescript')
    Module._extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText, filename)
  }
  Module._load = function(request, parent, main) {
    if (parent?.filename.endsWith('fiveBossGauntletRun' + ext)) {
      if (request === '../db') return { getDb: () => db }
      if (request === './player') return { getPlayerSync: () => { paymentReads++; throw Error('Payment read must not happen') }, updatePlayerSync() {} }
      if (request.endsWith('/stamina')) return { computeRealTimeStamina: () => 0 }
      if (request.endsWith('/persistence-coordinator')) return { runPersistenceTransactionSync: (_, fn) => db.transaction(fn)() }
    }
    return oldLoad.apply(this, arguments)
  }
  try {
    const ledger = require(path.join(root, 'data/domains/fiveBossGauntletRun' + ext))
    for (const status of ['settled', 'aborted']) {
      db.prepare('INSERT INTO five_boss_gauntlet_runs VALUES (?,11,?,?,10000143,1,?,?,?)').run(status, 'route', 'room', status, 'fixture', 'fixture')
      db.prepare('INSERT INTO five_boss_gauntlet_members (run_id,player_id) VALUES (?,11)').run(status)
      assert.throws(() => ledger.startMemberSync({ runId: status, hostPlayerId: 11, playerId: 11,
        routeId: 'route', roomNumber: 'room', ticketItemId: 10000143, hostStaminaCost: 35,
        rosterPlayerIds: [11], clientPlayId: 'late-play', isAutoMode: false }, () => { callbacks++ }),
      error => error.code === 'run_not_active')
    }
    assert.equal(paymentReads, 0); assert.equal(callbacks, 0)
    assert.deepEqual(db.prepare('SELECT status FROM five_boss_gauntlet_runs ORDER BY status').all(), [{ status: 'aborted' }, { status: 'settled' }])
  } finally {
    db.close(); Module._load = oldLoad
    if (oldExtension) Module._extensions['.ts'] = oldExtension; else delete Module._extensions['.ts']
  }
})
