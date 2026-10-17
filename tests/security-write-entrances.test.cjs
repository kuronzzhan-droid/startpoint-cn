const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const Fastify = require('fastify')
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'security-entrances-'))
process.env.DATA_DIR = dir
process.env.CN_WRITER_THREAD = '0'
const db = require('../out/data/db').getDb()
const coordinator = require('../out/lib/persistence-coordinator')
const { persistenceAdmission } = require('../out/lib/persistence-admission')
const { insertAccountSync } = require('../out/data/domains/account')
const { insertDefaultPlayerSync } = require('../out/data/domains/player')
const sessions = require('../out/data/domains/session')
require('../out/lib/player-login').initializePlayerLogin(() => {})
function player() {
    const account = insertAccountSync({ appId: 'wf_cn', idpAlias: '', idpCode: 'leiting', idpId: '', status: 'normal' })
    const saved = insertDefaultPlayerSync(account.id), viewer = 720000000 + saved.id
    sessions.insertSessionWithTokenSync({ accountId: account.id, token: String(viewer), type: 2, expires: new Date(Date.now() + 60000) })
    return { account: account.id, id: saved.id, viewer }
}
async function appFor(t, plugin, prefix) {
    const app = Fastify({ logger: false, trustProxy: false })
    app.addHook('onSend', (_req, reply, payload, done) => done(null,
        reply.getHeader('content-type') === 'application/x-msgpack' && typeof payload === 'object' ? JSON.stringify(payload) : payload))
    require('../out/lib/persistence-http-errors').installPersistenceHttpErrors(app)
    app.register(plugin, { prefix }); await app.ready(); t.after(() => app.close()); return app
}
after(async () => {
    await coordinator.drainPersistence(); db.close()
    assert.equal(path.dirname(fs.realpathSync(dir)), fs.realpathSync(os.tmpdir()))
    fs.rmSync(dir, { recursive: true })
})

test('returning legacy signup is bounded separately from creation and does not change DB state on rejection', async t => {
    const app = await appFor(t, require('../out/routes/cn/tool').default, '/api/index.php/tool')
    const signup = device_id => app.inject({ method: 'POST', url: '/api/index.php/tool/signup', payload: { device_id }, headers: { udid: 'fixture-device' } })
    const created = (await signup(987654)).json()
    assert.equal(created.data.newAccount, 1)
    const budget = require('../out/lib/account-creation-budget').accountCreationBudget(app)
    const creations = budget.inspect().successes
    for (let n = 0; n < 120; n++) {
        const response = await signup(987654)
        assert.equal(response.json().data_headers.result_code, 1)
        assert.equal(response.json().data_headers.viewer_id, created.data_headers.viewer_id)
    }
    const before = db.prepare('SELECT total_changes() n').get().n
    const refused = await signup(987654)
    assert.equal(refused.statusCode, 200)
    assert.equal(refused.json().data_headers.result_code, 516)
    assert.equal(refused.headers['retry-after'], '60')
    assert.equal(db.prepare('SELECT total_changes() n').get().n, before)
    assert.equal(budget.inspect().successes, creations)
    assert.equal((await signup(987655)).json().data.newAccount, 1)
    assert.equal((await signup(987655)).json().data_headers.result_code, 1, 'another account behind the same source still logs in')
})

test('follow bulk bounds run before target lookups; normal edits and queue rejection retain their contracts', async t => {
    const own = player(), target = player()
    const app = await appFor(t, require('../out/routes/api/follow').default, '/api/index.php/follow')
    const inject = body => app.inject({ method: 'POST', url: '/api/index.php/follow/bulk_edit', payload: { viewer_id: own.viewer, ...body } })
    const original = db.prepare
    db.prepare = () => assert.fail('oversized or malformed follow input reached the database')
    try {
        for (const ids of [Array(51).fill(target.viewer), 'invalid', [1.1], [null], [-1]]) {
            assert.equal((await inject({ add_follow_id_list: ids })).statusCode, 400)
            assert.equal((await inject({ delete_follow_id_list: ids })).statusCode, 400)
        }
    } finally { db.prepare = original }
    const releases = Array.from({ length: 8 }, () => persistenceAdmission.acquire(own.id))
    try {
        const refused = await inject({ add_follow_id_list: [target.viewer] })
        assert.equal(refused.json().data_headers.result_code, 516)
        assert.equal(db.prepare('SELECT count(*) n FROM players_follows WHERE follower_player_id=?').get(own.id).n, 0)
    } finally { releases.forEach(release => release()) }
    assert.equal((await inject({ add_follow_id_list: [target.viewer] })).json().data_headers.result_code, 1)
    assert.equal(db.prepare('SELECT count(*) n FROM players_follows WHERE follower_player_id=?').get(own.id).n, 1)
    assert.equal((await inject({ delete_follow_id_list: [target.viewer] })).json().data_headers.result_code, 1)
    assert.equal(db.prepare('SELECT count(*) n FROM players_follows WHERE follower_player_id=?').get(own.id).n, 0)
})

test('TCP proof writes reserve before any outer wait, deduplicate frames, and recover after capacity denial', async t => {
    const ledger = require('../out/data/domains/fiveBossGauntletRun')
    const lobby = require('../out/multi/five-boss/lobby-runtime')
    const recorded = []
    t.mock.method(ledger, 'recordMemberBattleSignalSync', input => { recorded.push(input.signal) })
    const client = { socket: {}, playerId: 999999, viewerId: 123, connectionId: 'fixture', superseded: false }
    const roomCoordinator = require('../out/multi/coordinator/embedded').embeddedMultiCoordinator
    const room = { room_number: '123456', category: 2, quest_id: 1099001, mates: [], lobby_generation: 0,
        lifecycle: roomCoordinator.createLifecycle(), member_viewer_ids: [123], member_player_ids: { 123: client.playerId },
        expected_real_viewer_ids: [123], five_boss_runtime: { runId: 'security-signals', battleIdentityByViewerId: {
        123: { playerId: client.playerId, connectionId: client.connectionId },
    } } }
    assert.equal(roomCoordinator.commitBattleStart(room).ok, true)
    t.after(async () => {
        await lobby.waitForFiveBossSignalPersistence('security-signals', client.playerId)
        await lobby.waitForFiveBossSignalPersistence('security-signals-retry', client.playerId)
        require('../out/multi/battle-telemetry').battleTelemetry.end(room.room_number, 'fixture_complete')
    })
    for (const signal of ['scene_ready', 'level_next', 'finalize']) assert.equal(lobby.recordFiveBossSignal(room, client, signal), true)
    assert.equal(persistenceAdmission.stats().total, 3, 'all three proof writes already have slots before a microtask runs')
    for (let n = 0; n < 100; n++) lobby.recordFiveBossSignal(room, client, 'finalize')
    assert.equal(persistenceAdmission.stats().total, 3)
    await lobby.waitForFiveBossSignalPersistence('security-signals', client.playerId)
    assert.deepEqual(recorded, ['scene_ready', 'level_next', 'finalize'])
    assert.equal(persistenceAdmission.stats().total, 0)
    room.five_boss_runtime = { ...room.five_boss_runtime, runId: 'security-signals-retry' }
    client.fiveBossBattleEntered = false
    const releases = Array.from({ length: 8 }, () => persistenceAdmission.acquire(client.playerId))
    try {
        lobby.recordFiveBossSignal(room, client, 'scene_ready')
        await lobby.waitForFiveBossSignalPersistence('security-signals-retry', client.playerId)
        assert.equal(client.fiveBossBattleEntered, false)
        assert.equal(recorded.length, 3)
    } finally { releases.forEach(release => release()) }
    lobby.recordFiveBossSignal(room, client, 'scene_ready')
    await lobby.waitForFiveBossSignalPersistence('security-signals-retry', client.playerId)
    assert.equal(recorded.length, 4)
})

test('a later rejected TCP proof cannot make HTTP settlement stop waiting for an earlier accepted proof', async t => {
    const ledger = require('../out/data/domains/fiveBossGauntletRun')
    const lobby = require('../out/multi/five-boss/lobby-runtime'), recorded = []
    t.mock.method(ledger, 'recordMemberBattleSignalSync', input => recorded.push(input.signal))
    const client = { socket: {}, playerId: 999998, viewerId: 456, connectionId: 'pending-fixture', superseded: false }
    const runtime = { runId: 'pending-security-proof', battleIdentityByViewerId: { 456: { playerId: client.playerId, connectionId: client.connectionId } } }
    const roomCoordinator = require('../out/multi/coordinator/embedded').embeddedMultiCoordinator
    const room = { room_number: '654321', category: 2, quest_id: 1099001, mates: [], lobby_generation: 0,
        lifecycle: roomCoordinator.createLifecycle(), member_viewer_ids: [456], member_player_ids: { 456: client.playerId },
        expected_real_viewer_ids: [456], five_boss_runtime: runtime }
    assert.equal(roomCoordinator.commitBattleStart(room).ok, true)
    let unblock
    const gate = new Promise(resolve => { unblock = resolve })
    coordinator.configurePersistenceSqlExecutor(async () => gate)
    const blocker = coordinator.runPersistenceSqlCommand({ domain: 'player', playerId: client.playerId, operation: 'hold' }, [], () => {})
    const releases = Array.from({ length: 6 }, () => persistenceAdmission.acquire(client.playerId))
    try {
        for (const signal of ['scene_ready', 'level_next', 'finalize']) lobby.recordFiveBossSignal(room, client, signal)
        let drained = false
        const pending = lobby.waitForFiveBossSignalPersistence(runtime.runId, client.playerId).then(() => { drained = true })
        await new Promise(resolve => setImmediate(resolve))
        assert.equal(drained, false)
        assert.equal(client.fiveBossBattleEntered, true)
        for (let n = 0; n < 50; n++) lobby.recordFiveBossSignal(room, client, 'finalize')
        unblock(); await blocker; await pending
        assert.deepEqual(recorded, ['scene_ready'])
        releases.forEach(release => release())
        lobby.recordFiveBossSignal(room, client, 'finalize')
        await lobby.waitForFiveBossSignalPersistence(runtime.runId, client.playerId)
        assert.deepEqual(recorded, ['scene_ready', 'finalize'])
    } finally {
        unblock(); releases.forEach(release => release())
        try { await blocker; await lobby.waitForFiveBossSignalPersistence(runtime.runId, client.playerId) }
        finally {
            coordinator.configurePersistenceSqlExecutor(null)
            require('../out/multi/battle-telemetry').battleTelemetry.end(room.room_number, 'fixture_complete')
        }
    }
})
