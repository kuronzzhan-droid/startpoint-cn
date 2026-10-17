const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { setImmediate: nextTurn } = require('node:timers/promises')
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mission-client-limit-'))
process.env.DATA_DIR = directory
process.env.GACHA_SEED_DIR = path.join(directory, 'seeds')
process.env.CN_WRITER_THREAD = '0'
process.env.MULTI_BATTLE_RELAY_PROCESS = '0'
const output = process.env.LENS_BUILD_OUT || path.resolve(__dirname, '../out')
const load = name => require(path.join(output, name))
const db = load('data/db').getDb()
const accounts = load('data/domains/account'), players = load('data/domains/player')
const missions = load('data/domains/mission'), selection = load('data/activeAccount')
const coordinator = load('lib/persistence-coordinator'), client = load('lib/mission/client-progress')
const index = load('lib/mission/index')
const { persistenceAdmission } = load('lib/persistence-admission')
const { persistenceWriteGate } = load('lib/persistence-write-gate')
const DOT = 'character_detail_play_dot_sp_motion_count', TAP = 'home_tap_town_character_count'
let sequence = 0
after(async () => {
    await coordinator.drainPersistence()
    assert.equal(persistenceAdmission.stats().total, 0)
    db.close()
    fs.rmSync(directory, { recursive: true })
})
const param = (pattern, progress) => ({ mission_pattern: pattern, progress_value: progress })
async function subject() {
    const account = accounts.insertAccountSync({ appId: 'wf_cn', idpAlias: '', idpCode: 'mission-limit', idpId: String(++sequence), status: 'normal' })
    const player = players.insertDefaultPlayerSync(account.id)
    selection.saveAccountDefaultPlayer(account.id, player.id)
    players.updatePlayerSync({ id: player.id, vmoney: 0, freeVmoney: 0 })
    await coordinator.runPersistenceTransaction({ domain: 'mission', playerId: player.id, operation: 'mission_fixture' }, () => {})
    const viewerId = 88200000 + sequence
    db.prepare('INSERT INTO sessions(token,account_id,expires,type) VALUES(?,?,?,2)')
        .run(String(viewerId), account.id, '2099-01-01T00:00:00.000Z')
    return { accountId: account.id, playerId: player.id, viewerId }
}
async function appFor(t) {
    const app = require('fastify')({ logger: false })
    app.addHook('onSend', (_request, reply, payload, done) => done(null,
        String(reply.getHeader('content-type') || '').startsWith('application/x-msgpack') && typeof payload === 'object'
            ? JSON.stringify(payload) : payload))
    await load('routes/api/mission').default(app)
    await app.ready()
    t.after(() => app.close())
    return app
}
const update = (app, p, params) => app.inject({ method: 'POST', url: '/update_mission_progress', payload: {
    viewer_id: p.viewerId, api_count: 1, mission_param_list: params,
} })
function data(response) {
    assert.equal(response.statusCode, 200, response.body)
    assert.match(response.headers['content-type'], /application\/x-msgpack/)
    return response.json().data
}
const progress = (p, id, category = 5) => missions.getPlayerCategoryMissionsSync(p.playerId, category)[String(id)]?.progress ?? 0
const digest = p => {
    const playerId = p.playerId
    assert.ok(Number.isSafeInteger(playerId) && playerId > 0)
    const quote = name => '"' + name.replaceAll('"', '""') + '"'
    const metadata = db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
        .map(({ name }) => ({ name, columns: db.prepare('PRAGMA table_info(' + quote(name) + ')').all(),
            keys: db.prepare('PRAGMA foreign_key_list(' + quote(name) + ')').all() }))
    const selectors = new Map([['players', 'id=' + playerId]])
    for (const table of metadata) {
        if (table.name === 'players') continue
        const terms = table.columns.some(c => c.name === 'player_id') ? ['player_id=' + playerId] : []
        for (const key of table.keys) if (key.table === 'players') terms.push(quote(key.from) + '=' + playerId)
        if (terms.length) selectors.set(table.name, terms.join(' OR '))
    }
    for (let remaining = metadata.length; remaining > 0; remaining--) {
        let changed = false
        for (const table of metadata) {
            if (selectors.has(table.name)) continue
            const terms = table.keys.filter(k => selectors.has(k.table) && k.to).map(k =>
                quote(k.from) + ' IN (SELECT ' + quote(k.to) + ' FROM ' + quote(k.table) + ' WHERE ' + selectors.get(k.table) + ')')
            if (terms.length) { selectors.set(table.name, terms.join(' OR ')); changed = true }
        }
        if (!changed) break
    }
    const hash = require('node:crypto').createHash('sha256')
    for (const { name } of metadata) {
        const selector = selectors.get(name)
        if (!selector) continue
        const rows = db.prepare('SELECT * FROM ' + quote(name) + ' WHERE ' + selector).all().map(row => JSON.stringify(row)).sort()
        hash.update(JSON.stringify([name, rows]))
    }
    return hash.digest('hex')
}
async function until(condition) {
    const end = performance.now() + 5000
    while (!condition()) { assert.ok(performance.now() < end, 'fixture queue timed out'); await nextTurn() }
}

test('collector limits a request per allowed pattern without coercion or unsafe sums', () => {
    assert.equal(client.MAX_CLIENT_PROGRESS_DELTA, 100)
    assert.deepEqual([...client.collectClientProgressDeltas([param(DOT, 60), param(DOT, 60), param(TAP, 5)])], [[DOT, 100], [TAP, 5]])
    for (const value of [100, 101, Number.MAX_SAFE_INTEGER]) {
        assert.deepEqual([...client.collectClientProgressDeltas([param(DOT, value)])], [[DOT, 100]])
    }
    const bad = [null, [], 7, 'bad', param(DOT, '5'), param(DOT, true), param(DOT, [5]), param(DOT, {}),
        param(DOT, 1.5), param(DOT, 0), param(DOT, -1), param(DOT, NaN), param(DOT, Infinity),
        param(DOT, Number.MAX_SAFE_INTEGER + 1), param('battle_clear_count', 1), param('constructor', 1), param('__proto__', 1)]
    assert.deepEqual([...client.collectClientProgressDeltas(bad)], [])
    for (const input of [undefined, null, {}, 1, 'bad']) assert.deepEqual([...client.collectClientProgressDeltas(input)], [])
    assert.deepEqual([...client.collectClientProgressDeltas([param(DOT, 3), param(DOT, 7), param(TAP, 2)])], [[DOT, 10], [TAP, 2]])
})

for (const values of [[100], [101], [Number.MAX_SAFE_INTEGER], [60, 60], [40, 30, 50]]) test(`HTTP clamps ${values.join('+')} before real database writes`, async t => {
    // The real UI targets top out at 50 and would hide a missing 100 limit.
    // Raise only this fixture's route target; leave progress storage real.
    const stages = load('lib/mission/stages'), settlement = load('lib/mission/settlement')
    const originalTarget = stages.getMissionFinalTargetProgress, originalSettle = settlement.settleMissionCategories
    t.mock.method(stages, 'getMissionFinalTargetProgress', (category, id) => category === 5 && id === 48000 ? 1000 : originalTarget(category, id))
    t.mock.method(settlement, 'settleMissionCategories', (playerId, _scopes, time) => originalSettle(playerId, [], time))
    const app = await appFor(t)
    const p = await subject()
    data(await update(app, p, values.map(value => param(DOT, value))))
    assert.equal(progress(p, 48000), 100, JSON.stringify(values))
})

test('HTTP ignores malformed and server-owned statistics without player state writes', async t => {
    const p = await subject(), app = await appFor(t), before = digest(p)
    for (const params of [null, {}, 'bad', [null, [], 5, {}, param(DOT, '5'), param(DOT, true), param(DOT, 1.5),
        param(DOT, 0), param(DOT, -1), param(DOT, Number.MAX_SAFE_INTEGER + 1),
        param('battle_clear_count', 100), param('max_combo_count', 100), param('constructor', 100)]]) {
        data(await update(app, p, params))
        assert.equal(digest(p), before)
    }
})

test('normal mixed patterns and small batches retain progress and settle rewards exactly once', async t => {
    const p = await subject(), app = await appFor(t)
    const first = data(await update(app, p, [param(DOT, 3), param(DOT, 7), param(TAP, 2),
        param('home_change_voice_count', 2), param('character_detail_zoom_illust_for_1min_count', 1), param('twitter_check', 1)]))
    assert.equal(progress(p, 48000), 10)
    assert.equal(progress(p, 49000), 2)
    assert.equal(progress(p, 50000), 2)
    assert.equal(progress(p, 47000), 1)
    // Twitter is allowlisted but need not be enabled in the current catalog.
    const twitterActive = client.resolveClientProgressTargets('twitter_check', new Date()).some(x => x.category === 1 && x.missionId === 107)
    assert.equal(progress(p, 107, 1), twitterActive ? 1 : 0)
    assert.ok(first.mission_info.length > 0)
    assert.equal(players.getPlayerSync(p.playerId).freeVmoney, twitterActive ? 300 : 0)
    data(await update(app, p, [param(DOT, 20), param(DOT, 20), param(TAP, 3), param('home_change_voice_count', 3)]))
    assert.equal(progress(p, 48000), 50)
    assert.equal(progress(p, 49000), 5)
    assert.equal(progress(p, 50000), 5)
    const rewardRows = db.prepare('SELECT * FROM players_degrees WHERE player_id=? ORDER BY degree_id').all(p.playerId)
    const stages = db.prepare('SELECT * FROM players_category_mission_stages WHERE player_id=? ORDER BY category,mission_id,id').all(p.playerId)
    const retry = data(await update(app, p, [param(DOT, 40), param(TAP, 5), param('twitter_check', 1)]))
    assert.deepEqual(retry.mission_info, [])
    assert.equal(players.getPlayerSync(p.playerId).freeVmoney, twitterActive ? 300 : 0)
    assert.deepEqual(db.prepare('SELECT * FROM players_degrees WHERE player_id=? ORDER BY degree_id').all(p.playerId), rewardRows)
    assert.deepEqual(db.prepare('SELECT * FROM players_category_mission_stages WHERE player_id=? ORDER BY category,mission_id,id').all(p.playerId), stages)
})

test('legacy progress above the final target and received stages never regress', async t => {
    const p = await subject(), app = await appFor(t)
    missions.updatePlayerCategoryMissionSync(p.playerId, 5, 48000, 75)
    missions.updatePlayerCategoryMissionStageSync(p.playerId, 5, 1, 48000, true)
    const stages = missions.getPlayerCategoryMissionsSync(p.playerId, 5)['48000'].stages
    data(await update(app, p, [param(DOT, 1)]))
    assert.equal(progress(p, 48000), 75)
    assert.deepEqual(missions.getPlayerCategoryMissionsSync(p.playerId, 5)['48000'].stages, stages)
})

for (const fault of ['later-write', 'commit']) test(`mission ${fault} failure rolls back all accepted deltas and permits retry`, async t => {
    const p = await subject(), app = await appFor(t), before = digest(p)
    if (fault === 'commit') {
        db.exec(`CREATE TABLE mission_fixture_parent(id INTEGER PRIMARY KEY);
            CREATE TABLE mission_fixture_child(id INTEGER REFERENCES mission_fixture_parent(id) DEFERRABLE INITIALLY DEFERRED);
            CREATE TRIGGER mission_fixture_fault AFTER INSERT ON players_category_missions
            WHEN NEW.player_id=${p.playerId} AND NEW.id=48000 BEGIN INSERT INTO mission_fixture_child VALUES(1); END`)
    } else db.exec(`CREATE TRIGGER mission_fixture_fault BEFORE INSERT ON players_category_missions
        WHEN NEW.player_id=${p.playerId} AND NEW.id=48000 BEGIN SELECT RAISE(ABORT,'fixture later mission failure'); END`)
    try {
        const failed = await update(app, p, [param(TAP, 2), param(DOT, 3)])
        assert.equal(failed.statusCode, 500, failed.body)
        assert.equal(db.inTransaction, false)
        assert.equal(digest(p), before)
        if (fault === 'commit') assert.equal(db.prepare('SELECT count(*) n FROM mission_fixture_child').get().n, 0)
    } finally {
        db.exec('DROP TRIGGER mission_fixture_fault')
        if (fault === 'commit') db.exec('DROP TABLE mission_fixture_child; DROP TABLE mission_fixture_parent')
    }
    data(await update(app, p, [param(TAP, 2), param(DOT, 3)]))
    assert.equal(progress(p, 49000), 2)
    assert.equal(progress(p, 48000), 3)
})

test('eight-command admission preserves serialized progress and rejects work before writes', async t => {
    const p = await subject(), app = await appFor(t)
    const release = await persistenceWriteGate.acquire(true)
    let pending
    try {
        const rejectedBefore = persistenceAdmission.stats().rejected
        pending = Array.from({ length: 12 }, () => Promise.resolve(update(app, p, [param(DOT, 1)])))
        await until(() => persistenceAdmission.stats().total === 8 && persistenceAdmission.stats().rejected - rejectedBefore === 4)
        assert.equal(progress(p, 48000), 0)
    } finally { release() }
    const results = await Promise.all(pending)
    assert.equal(results.filter(r => r.statusCode === 200).length, 8)
    const rejected = results.filter(r => r.statusCode === 503)
    assert.equal(rejected.length, 4)
    assert.ok(rejected.every(r => r.json().code === 'PERSISTENCE_QUEUE_FULL'))
    assert.equal(progress(p, 48000), 8)
    assert.equal(persistenceAdmission.stats().total, 0)
})

test('queued client target resolution uses the execution clock and honors inactive definitions', async t => {
    const p = await subject(), app = await appFor(t)
    const beforeTime = Date.parse('2050-01-01T00:00:00Z'), afterTime = beforeTime + 60_000
    let now = beforeTime, evaluated
    t.mock.method(Date, 'now', () => now)
    t.mock.method(load('utils'), 'getServerDate', () => new Date(now))
    const original = client.resolveClientProgressTargets
    t.mock.method(client, 'resolveClientProgressTargets', (pattern, time) => { evaluated = time.getTime(); return original(pattern, time) })
    const release = await persistenceWriteGate.acquire(true)
    let pending
    try {
        pending = Promise.resolve(update(app, p, [param(DOT, 1)]))
        await until(() => persistenceAdmission.stats().total === 1)
        assert.equal(evaluated, undefined)
        now = afterTime
    } finally { release() }
    data(await pending)
    assert.equal(evaluated, afterTime)
    assert.equal(progress(p, 48000), 1)
    const definitions = [
        { category: 5, missionId: 1, pattern: 'degree_dot_image_looking_x', row: [], enableStart: '2050-01-01 08:01:00' },
        { category: 5, missionId: 2, pattern: 'degree_dot_image_looking_x', row: [], eventId: 7 },
    ]
    assert.deepEqual(client.resolveClientProgressTargetsFromDefinitions(DOT, new Date(beforeTime), definitions), [])
    assert.deepEqual(client.resolveClientProgressTargetsFromDefinitions(DOT, new Date(afterTime), definitions), [{ category: 5, missionId: 1 }])
})

test('V2 restore retains target identity and portable mission progress and received stages', async t => {
    const source = await subject(), target = await subject(), app = await appFor(t)
    missions.updatePlayerCategoryMissionSync(source.playerId, 5, 48000, 75)
    missions.updatePlayerCategoryMissionStageSync(source.playerId, 5, 1, 48000, true)
    missions.updatePlayerCategoryMissionSync(source.playerId, 5, 49000, 2)
    const portable = missions.getPlayerCategoryMissionsSync(source.playerId, 5)
    const sessions = db.prepare('SELECT * FROM sessions ORDER BY token').all()
    const snapshots = load('data/snapshots/player-snapshot')
    snapshots.restorePlayerSaveSnapshotV2Sync(snapshots.createPlayerSaveSnapshotV2Sync(source.playerId), target.playerId)
    assert.equal(db.prepare('SELECT account_id FROM players WHERE id=?').get(target.playerId).account_id, target.accountId)
    assert.equal(selection.resolvePlayerIdSync(target.accountId), target.playerId)
    assert.deepEqual(db.prepare('SELECT * FROM sessions ORDER BY token').all(), sessions)
    assert.deepEqual(missions.getPlayerCategoryMissionsSync(target.playerId, 5), portable)
    data(await update(app, target, [param(DOT, 1), param(TAP, 1)]))
    assert.equal(progress(target, 48000), 75)
    assert.equal(progress(target, 49000), 3)
    assert.deepEqual(missions.getPlayerCategoryMissionsSync(target.playerId, 5)['48000'].stages, portable['48000'].stages)
})
