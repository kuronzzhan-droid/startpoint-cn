const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { setImmediate: nextTurn } = require('node:timers/promises')
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'box-gacha-security-'))
process.env.DATA_DIR = directory
process.env.GACHA_SEED_DIR = path.join(directory, 'seeds')
process.env.CN_WRITER_THREAD = '0'
const load = name => require(path.resolve(__dirname, '../out', name))
const db = load('data/db').getDb()
const accounts = load('data/domains/account'), players = load('data/domains/player')
const boxes = load('data/domains/boxGacha'), items = load('data/domains/item')
const selection = load('data/activeAccount'), assets = load('lib/assets')
const coordinator = load('lib/persistence-coordinator')
const { persistenceAdmission } = load('lib/persistence-admission')
const { persistenceWriteGate } = load('lib/persistence-write-gate')
const snapshots = load('data/snapshots/player-snapshot')
const GACHA = 990001, CURRENCY = 30101, REWARD = 10000145, REWARD_KEY = 100
let sequence = 0

after(async () => {
    await coordinator.drainPersistence()
    assert.equal(persistenceAdmission.stats().total, 0)
    db.close()
    fs.rmSync(directory, { recursive: true, force: true })
})
async function subject() {
    const account = accounts.insertAccountSync({ appId: 'wf_cn', idpAlias: '', idpCode: 'box-fixture', idpId: String(++sequence), status: 'normal' })
    const p = players.insertDefaultPlayerSync(account.id)
    selection.saveAccountDefaultPlayer(account.id, p.id)
    const viewerId = 88210000 + ++sequence
    db.prepare('INSERT INTO sessions(token,account_id,expires,type) VALUES (?,?,?,2)')
        .run(String(viewerId), account.id, '2099-01-01T00:00:00.000Z')
    items.setPlayerItemSync(p.id, CURRENCY, 10000)
    items.setPlayerItemSync(p.id, REWARD, 0)
    await coordinator.runPersistenceTransaction({ domain: 'player', playerId: p.id, operation: 'box_fixture' }, () => {})
    return { playerId: p.id, accountId: account.id, viewerId }
}
function master(stock = 3, featured = false) {
    return { redeemItemId: CURRENCY, redeemItemCount: 10,
        boxes: { 1: { [REWARD_KEY]: { type: featured ? 2 : 0, id: REWARD, count: 1,
            available: stock, tier: featured ? 2 : 0 } } }, availableCounts: { 1: stock } }
}
async function appFor(t, content = master()) {
    const originalGet = assets.getBoxGachaSync
    t.mock.method(assets, 'getBoxGachaSync', id => Number(id) === GACHA ? content : originalGet(id))
    const app = require('fastify')({ logger: false })
    app.addHook('onSend', (_request, reply, payload, done) => done(null,
        String(reply.getHeader('content-type') || '').startsWith('application/x-msgpack') && typeof payload === 'object'
            ? JSON.stringify(payload) : payload))
    await load('routes/api/boxGacha').default(app)
    await app.ready()
    t.after(() => app.close())
    return app
}
function seedBox(p, { remaining = 3, closed = false, resets = 0, drawn = 0, boxId = 1, gachaId = GACHA } = {}) {
    boxes.insertPlayerBoxGachaSync(p.playerId, gachaId, { boxId, remainingNumber: remaining, isClosed: closed, resetTimes: resets })
    if (drawn) boxes.insertPlayerBoxGachaDrawnRewardSync(p.playerId, gachaId, boxId, { id: REWARD_KEY, number: drawn })
}
const row = p => boxes.getPlayerBoxGachaSync(p.playerId, GACHA, 1)
const facts = p => boxes.getPlayerBoxGachaDrawnRewardsSync(p.playerId, GACHA, 1)
const amount = (p, id) => items.getPlayerItemSync(p.playerId, id) ?? 0
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
const payload = (p, extra = {}) => ({ viewer_id: p.viewerId, box_gacha_id: GACHA, box_id: 1,
    api_count: 1, number: 1, stop_on_featured_rewards: false, ...extra })
const post = (app, p, route, extra = {}) => app.inject({ method: 'POST', url: '/' + route, payload: payload(p, extra) })
function data(response) {
    assert.equal(response.statusCode, 200, response.body)
    assert.match(response.headers['content-type'], /application\/x-msgpack/)
    return response.json().data
}
async function rejectedUnchanged(app, p, route, extra = {}) {
    const before = digest(p), response = await post(app, p, route, extra)
    assert.equal(response.statusCode, 400, response.body)
    assert.equal(digest(p), before, 'rejected request must preserve all owned state')
    return response
}
async function until(condition) {
    const end = performance.now() + 5000
    while (!condition()) { assert.ok(performance.now() < end, 'fixture queue timed out'); await nextTurn() }
}

test('exec rejects nonpositive or unsafe integer identifiers/counts and nonboolean stop without writes', async t => {
    const p = await subject(), app = await appFor(t)
    seedBox(p)
    for (const field of ['viewer_id', 'box_gacha_id', 'box_id', 'number']) {
        for (const value of [0, -1, 0.5, Number.MAX_SAFE_INTEGER + 1, '1', null]) {
            await rejectedUnchanged(app, p, 'exec', { [field]: value })
        }
    }
    for (const value of [0, 1, 'false', null]) await rejectedUnchanged(app, p, 'exec', { stop_on_featured_rewards: value })
    await rejectedUnchanged(app, p, 'exec', { box_id: 99 })
    await rejectedUnchanged(app, p, 'exec', { box_gacha_id: 990999 })
    assert.equal(amount(p, REWARD), 0)
})

test('close, reset and get_box_list reject invalid identifier types without changing owned state', async t => {
    const p = await subject(), app = await appFor(t)
    seedBox(p)
    for (const route of ['close', 'reset', 'get_box_list']) {
        const fields = route === 'get_box_list' ? ['viewer_id', 'box_gacha_id'] : ['viewer_id', 'box_gacha_id', 'box_id']
        for (const field of fields) {
            for (const value of [0, -1, 0.5, Number.MAX_SAFE_INTEGER + 1, '1', null]) {
                await rejectedUnchanged(app, p, route, { [field]: value })
            }
        }
    }
})

test('unsupported pass-card points preserve currency, rewards and box state', async t => {
    const content = master(1)
    content.boxes[1][REWARD_KEY] = { type: 5, count: 10, available: 1, tier: 0 }
    const app = await appFor(t, content)
    for (const existing of [false, true]) {
        const p = await subject()
        if (existing) seedBox(p, { remaining: 1 })
        const before = digest(p)
        const response = await post(app, p, 'exec')
        assert.equal(response.statusCode, 500, response.body)
        assert.equal(db.inTransaction, false)
        assert.equal(digest(p), before)
        assert.equal(amount(p, CURRENCY), 10000)
        assert.equal(facts(p).length, 0)
    }
})

test('draw count above actual per-reward inventory is rejected instead of partially executed', async t => {
    const p = await subject(), app = await appFor(t, master(3))
    seedBox(p, { remaining: 999, drawn: 1 })
    await rejectedUnchanged(app, p, 'exec', { number: 3 })
    const result = data(await post(app, p, 'exec', { number: 2 }))
    assert.deepEqual(result.drawn_reward_list, [{ reward_id: REWARD_KEY, number: 2 }])
    assert.equal(amount(p, CURRENCY), 9980)
    assert.equal(amount(p, REWARD), 2)
    assert.equal(row(p).remainingNumber, 0)
    assert.equal(row(p).isClosed, true)
})

test('20 competing requests admit eight commands, award the final inventory once and reject twelve upstream', async t => {
    const p = await subject(), app = await appFor(t, master(1))
    seedBox(p, { remaining: 1 })
    const beforeRejected = persistenceAdmission.stats().rejected
    const responses = await Promise.all(Array.from({ length: 20 }, () => post(app, p, 'exec')))
    assert.equal(responses.filter(r => r.statusCode === 200).length, 1)
    assert.equal(responses.filter(r => r.statusCode === 400).length, 7)
    const busy = responses.filter(r => r.statusCode === 503)
    assert.equal(busy.length, 12)
    assert.ok(busy.every(r => r.json().code === 'PERSISTENCE_QUEUE_FULL'))
    assert.equal(persistenceAdmission.stats().rejected - beforeRejected, 12)
    assert.equal(persistenceAdmission.stats().total, 0)
    assert.equal(amount(p, CURRENCY), 9990)
    assert.equal(amount(p, REWARD), 1)
    assert.deepEqual(facts(p), [{ id: REWARD_KEY, number: 1 }])
    assert.deepEqual(row(p), { boxId: 1, remainingNumber: 0, isClosed: true, resetTimes: 0 })
    data(await post(app, p, 'reset'))
    data(await post(app, p, 'exec'))
    assert.equal(amount(p, REWARD), 2)
    assert.equal(amount(p, CURRENCY), 9980)
    assert.equal(persistenceAdmission.stats().total, 0)
})

test('draw rereads currency after waiting and rejects an exhausted balance with no reward', async t => {
    const p = await subject(), app = await appFor(t)
    seedBox(p)
    const release = await persistenceWriteGate.acquire(true)
    let pending, before
    try {
        pending = Promise.resolve(post(app, p, 'exec'))
        await until(() => persistenceAdmission.stats().total === 1)
        db.prepare('UPDATE players_items SET amount=0 WHERE player_id=? AND id=?').run(p.playerId, CURRENCY)
        before = digest(p)
    } finally { release() }
    const response = await pending
    assert.equal(response.statusCode, 400, response.body)
    assert.equal(digest(p), before)
    assert.equal(amount(p, REWARD), 0)
    assert.deepEqual(facts(p), [])
})

test('featured stop charges the actual draw count and returns the committed box state', async t => {
    const p = await subject(), app = await appFor(t, master(3, true))
    seedBox(p)
    const result = data(await post(app, p, 'exec', { number: 3, stop_on_featured_rewards: true }))
    assert.deepEqual(result.drawn_reward_list, [{ reward_id: REWARD_KEY, number: 1 }])
    assert.equal(amount(p, CURRENCY), 9990)
    assert.equal(result.item_list[CURRENCY], 9990)
    assert.equal(row(p).remainingNumber, 2)
    assert.equal(row(p).isClosed, false)
    assert.deepEqual(facts(p), [{ id: REWARD_KEY, number: 1 }])
    assert.equal(result.all_box_info.find(box => box.box_id === 1).is_closed, false)
})

test('a reward using the draw currency is added after the charge and returned with the committed balance', async t => {
    const p = await subject(), content = master(1)
    content.boxes[1][REWARD_KEY].id = CURRENCY
    const app = await appFor(t, content)
    seedBox(p, { remaining: 1 })
    const operations = [], original = coordinator.runPersistenceTransaction
    t.mock.method(coordinator, 'runPersistenceTransaction', (...args) => {
        operations.push(args[0].operation)
        return original(...args)
    })
    const result = data(await post(app, p, 'exec'))
    assert.equal(amount(p, CURRENCY), 9991)
    assert.equal(result.item_list[CURRENCY], 9991)
    assert.deepEqual(operations, ['box_exec'], 'a committed draw must not need a second response transaction')
    assert.deepEqual(facts(p), [{ id: REWARD_KEY, number: 1 }])
})

test('partial close is permitted and repeated close returns terminal success without enabling reset', async t => {
    const p = await subject(), app = await appFor(t, master(3))
    seedBox(p, { remaining: 999, drawn: 1 })
    const first = data(await post(app, p, 'close'))
    assert.equal(first.all_box_info.find(box => box.box_id === 1).is_closed, true)
    assert.equal(row(p).remainingNumber, 2)
    const before = digest(p)
    const repeated = data(await post(app, p, 'close'))
    assert.deepEqual(repeated.all_box_info, first.all_box_info)
    assert.equal(digest(p), before)
    assert.equal(data(await post(app, p, 'get_box_list')).all_box_info.find(box => box.box_id === 1).is_closed, true)
    assert.equal(digest(p), before)
    await rejectedUnchanged(app, p, 'reset')
    await rejectedUnchanged(app, p, 'exec')
})

test('closed or zero cached stock cannot reset a box whose actual reward inventory remains', async t => {
    const p = await subject(), app = await appFor(t, master(3))
    seedBox(p, { remaining: 0, closed: true, drawn: 1, resets: 7 })
    await rejectedUnchanged(app, p, 'reset')
    assert.equal(row(p).resetTimes, 7)
    assert.deepEqual(facts(p), [{ id: REWARD_KEY, number: 1 }])
    assert.equal(amount(p, REWARD), 0)
})

test('reset uses per-reward facts, not the sum of obsolete reward rows', async t => {
    const p = await subject(), app = await appFor(t, master(3))
    seedBox(p, { remaining: 0, closed: true })
    boxes.insertPlayerBoxGachaDrawnRewardSync(p.playerId, GACHA, 1, { id: 999, number: 3 })
    await rejectedUnchanged(app, p, 'reset')
    assert.equal(row(p).resetTimes, 0)
    assert.deepEqual(facts(p), [{ id: 999, number: 3 }])
})

test('actually empty boxes reset atomically even with stale positive cached stock; retry cannot reset twice', async t => {
    const p = await subject(), app = await appFor(t, master(3))
    seedBox(p, { remaining: 999, closed: false, drawn: 3, resets: 2 })
    const results = await Promise.all([post(app, p, 'reset'), post(app, p, 'reset')])
    assert.deepEqual(results.map(r => r.statusCode).sort(), [200, 400])
    assert.deepEqual(row(p), { boxId: 1, remainingNumber: 3, isClosed: false, resetTimes: 3 })
    assert.deepEqual(facts(p), [])
    await rejectedUnchanged(app, p, 'reset')
})

test('expanded empty boxes reopen only the new stock and historical partial closes stay closed', async t => {
    const p = await subject(), content = master(1), app = await appFor(t, content)
    seedBox(p, { remaining: 1 })
    data(await post(app, p, 'exec'))
    content.boxes[1][REWARD_KEY].available = 3
    content.availableCounts[1] = 3
    const reopened = data(await post(app, p, 'get_box_list'))
    assert.equal(reopened.all_box_info.find(box => box.box_id === 1).is_closed, false)
    assert.equal(row(p).remainingNumber, 2)
    assert.deepEqual(facts(p), [{ id: REWARD_KEY, number: 1 }])
    data(await post(app, p, 'close'))
    const before = digest(p)
    data(await post(app, p, 'get_box_list'))
    assert.equal(row(p).isClosed, true)
    assert.equal(row(p).remainingNumber, 2)
    assert.equal(digest(p), before)
    await rejectedUnchanged(app, p, 'reset')
})

for (const fault of ['facts', 'commit']) test(`draw ${fault} failure rolls back currency, awarded items, stock and facts`, async t => {
    const p = await subject(), app = await appFor(t, master(2))
    seedBox(p, { remaining: 2 })
    if (fault === 'commit') {
        db.exec(`CREATE TABLE box_fixture_parent(id INTEGER PRIMARY KEY);
            CREATE TABLE box_fixture_child(id INTEGER REFERENCES box_fixture_parent(id) DEFERRABLE INITIALLY DEFERRED);
            CREATE TRIGGER box_fixture_fault AFTER UPDATE OF amount ON players_items
                WHEN NEW.player_id=${p.playerId} AND NEW.id=${CURRENCY}
                BEGIN INSERT INTO box_fixture_child VALUES(1); END`)
    } else db.exec(`CREATE TRIGGER box_fixture_fault BEFORE INSERT ON players_box_gacha_drawn_rewards
        WHEN NEW.player_id=${p.playerId} BEGIN SELECT RAISE(ABORT,'fixture draw-facts failure'); END`)
    const before = digest(p)
    try {
        const failed = await post(app, p, 'exec')
        assert.equal(failed.statusCode, 500, failed.body)
        assert.equal(db.inTransaction, false)
        assert.equal(digest(p), before)
        assert.equal(amount(p, CURRENCY), 10000)
        assert.equal(amount(p, REWARD), 0)
        assert.deepEqual(facts(p), [])
        if (fault === 'commit') assert.equal(db.prepare('SELECT count(*) n FROM box_fixture_child').get().n, 0)
    } finally {
        db.exec('DROP TRIGGER box_fixture_fault')
        if (fault === 'commit') db.exec('DROP TABLE box_fixture_child; DROP TABLE box_fixture_parent')
    }
    data(await post(app, p, 'exec'))
    assert.equal(amount(p, CURRENCY), 9990)
    assert.equal(amount(p, REWARD), 1)
})

test('response collection failure after awarding the draw rolls the entire original transaction back', async t => {
    const p = await subject(), content = master(2)
    content.boxes[2] = { 200: { type: 2, count: 0, available: 1, tier: 0 } }
    content.availableCounts[2] = 1
    const app = await appFor(t, content)
    seedBox(p, { remaining: 2 })
    seedBox(p, { remaining: 1, boxId: 2 })
    const before = digest(p), original = boxes.getPlayerBoxGachaDrawnRewardsSync
    let reachedResponse = 0
    const fault = t.mock.method(boxes, 'getPlayerBoxGachaDrawnRewardsSync', (playerId, gachaId, boxId) => {
        if (playerId === p.playerId && gachaId === GACHA && Number(boxId) === 2) {
            reachedResponse++
            assert.equal(db.inTransaction, true, 'response facts must be collected before COMMIT')
            assert.equal(amount(p, CURRENCY), 9990)
            assert.equal(amount(p, REWARD), 1)
            assert.deepEqual(original(playerId, gachaId, 1), [{ id: REWARD_KEY, number: 1 }])
            throw new Error('fixture box response collection failure')
        }
        return original(playerId, gachaId, boxId)
    })
    try {
        const failed = await post(app, p, 'exec')
        assert.equal(failed.statusCode, 500, failed.body)
        assert.equal(reachedResponse, 1)
        assert.equal(db.inTransaction, false)
        assert.equal(digest(p), before)
        assert.equal(amount(p, CURRENCY), 10000)
        assert.equal(amount(p, REWARD), 0)
        assert.deepEqual(facts(p), [])
        assert.equal(row(p).remainingNumber, 2)
    } finally { fault.mock.restore() }
    data(await post(app, p, 'exec'))
    assert.equal(amount(p, CURRENCY), 9990)
    assert.equal(amount(p, REWARD), 1)
    assert.deepEqual(facts(p), [{ id: REWARD_KEY, number: 1 }])
})

for (const fault of ['delete', 'update']) test(`reset ${fault} failure rolls back cleared facts and reset count`, async t => {
    const p = await subject(), app = await appFor(t, master(2))
    seedBox(p, { remaining: 0, closed: true, drawn: 2, resets: 4 })
    if (fault === 'delete') db.exec(`CREATE TRIGGER box_fixture_fault BEFORE DELETE ON players_box_gacha_drawn_rewards
        WHEN OLD.player_id=${p.playerId} BEGIN SELECT RAISE(ABORT,'fixture reset-delete failure'); END`)
    else db.exec(`CREATE TRIGGER box_fixture_fault BEFORE UPDATE OF reset_times ON players_box_gacha
        WHEN NEW.player_id=${p.playerId} BEGIN SELECT RAISE(ABORT,'fixture reset-update failure'); END`)
    const before = digest(p)
    try {
        const failed = await post(app, p, 'reset')
        assert.equal(failed.statusCode, 500, failed.body)
        assert.equal(db.inTransaction, false)
        assert.equal(digest(p), before)
        assert.equal(row(p).resetTimes, 4)
        assert.deepEqual(facts(p), [{ id: REWARD_KEY, number: 2 }])
    } finally { db.exec('DROP TRIGGER box_fixture_fault') }
    data(await post(app, p, 'reset'))
    assert.equal(row(p).resetTimes, 5)
    assert.deepEqual(facts(p), [])
})

test('new players seed all nine master boxes without changing another player or imported historical progress', async t => {
    // These identity tables are created by the login subsystem, not the base DB schema.
    load('lib/player-login').initializePlayerLogin()
    const source = await subject(), target = await subject()
    const content = assets.getBoxGachaSync(1001)
    assert.deepEqual(Object.keys(content.availableCounts).map(Number), [1, 2, 3, 4, 5, 6, 7, 8, 9])
    const seeded = boxes.getPlayerBoxGachasSync(target.playerId)['1001']
    assert.equal(seeded.length, 9)
    for (const box of seeded) {
        assert.equal(box.remainingNumber, content.availableCounts[box.boxId])
        assert.equal(box.resetTimes, 0)
        assert.equal(box.isClosed, false)
    }
    // A legitimate historical archive only had the first five rows.
    db.prepare('DELETE FROM players_box_gacha WHERE player_id=? AND id=1001 AND box_id>5').run(source.playerId)
    boxes.updatePlayerBoxGachaSync(source.playerId, 1001, { boxId: 1, remainingNumber: 17, isClosed: true, resetTimes: 7 })
    const rewardId = Number(Object.keys(content.boxes[1])[0])
    boxes.insertPlayerBoxGachaDrawnRewardSync(source.playerId, 1001, 1, { id: rewardId, number: 1 })
    const archive = snapshots.createPlayerSaveSnapshotV2Sync(source.playerId)
    const identity = () => Object.fromEntries(['accounts', 'sessions', 'device_bindings', 'player_login_credentials', 'player_login_sessions']
        .map(table => [table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]))
    const identities = identity(), sourceBefore = digest(source)
    snapshots.restorePlayerSaveSnapshotV2Sync(archive, target.playerId)
    assert.equal(db.prepare('SELECT account_id FROM players WHERE id=?').get(target.playerId).account_id, target.accountId)
    assert.deepEqual(identity(), identities)
    assert.equal(digest(source), sourceBefore)
    assert.deepEqual(boxes.getPlayerBoxGachasSync(target.playerId)['1001'], boxes.getPlayerBoxGachasSync(source.playerId)['1001'])
    assert.deepEqual(boxes.getPlayerBoxGachaDrawnRewardsSync(target.playerId, 1001, 1), [{ id: rewardId, number: 1 }])
    const targetBefore = digest(target)
    await subject()
    assert.equal(digest(target), targetBefore, 'another new account must not reseed imported boxes')
    const app = await appFor(t)
    data(await post(app, target, 'get_box_list', { box_gacha_id: 1001 }))
    assert.equal(boxes.getPlayerBoxGachasSync(target.playerId)['1001'].length, 5)
    assert.equal(boxes.getPlayerBoxGachaSync(target.playerId, 1001, 1).remainingNumber, 17)
    assert.equal(boxes.getPlayerBoxGachaSync(target.playerId, 1001, 1).isClosed, true)
    assert.equal(boxes.getPlayerBoxGachaSync(target.playerId, 1001, 1).resetTimes, 7)
})
