const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { setImmediate: nextTurn } = require('node:timers/promises')

// All storage and seeds belong to this synthetic fixture, including nested writes.
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'box-gacha-1001-'))
process.env.DATA_DIR = directory
process.env.GACHA_SEED_DIR = path.join(directory, 'seeds')
process.env.CN_WRITER_THREAD = '0'
process.env.MULTI_BATTLE_RELAY_PROCESS = '0'
const load = name => require(path.resolve(__dirname, '../out', name))
const db = load('data/db').getDb()
const accounts = load('data/domains/account'), players = load('data/domains/player')
const boxes = load('data/domains/boxGacha'), items = load('data/domains/item')
const selection = load('data/activeAccount'), assets = load('lib/assets')
const coordinator = load('lib/persistence-coordinator')
const { persistenceAdmission } = load('lib/persistence-admission')
const { persistenceWriteGate } = load('lib/persistence-write-gate')
const GACHA = 1001, CURRENCY = 70017
const START = Date.parse('2023-09-29T05:00:00+08:00')
const END = Date.parse('2023-10-15T11:59:59+08:00')
const LEGAL = Date.parse('2023-10-08T12:00:00+08:00')
const EXPIRED = Date.parse('2026-10-11T12:00:00+08:00')
const DAY = 24 * 60 * 60 * 1000
const content = assets.getBoxGachaSync(GACHA)
let sequence = 0

after(async () => {
    await coordinator.drainPersistence()
    assert.equal(persistenceAdmission.stats().total, 0)
    db.close()
    fs.rmSync(directory, { recursive: true, force: true })
})

function clock(t, initial = LEGAL) {
    let now = initial
    t.mock.method(Date, 'now', () => now)
    return value => { now = value }
}
async function subject() {
    const account = accounts.insertAccountSync({ appId: 'wf_cn', idpAlias: '',
        idpCode: 'box-1001-fixture', idpId: String(++sequence), status: 'normal' })
    const p = players.insertDefaultPlayerSync(account.id)
    selection.saveAccountDefaultPlayer(account.id, p.id)
    const viewerId = 88220000 + ++sequence
    db.prepare('INSERT INTO sessions(token,account_id,expires,type) VALUES (?,?,?,2)')
        .run(String(viewerId), account.id, '2099-01-01T00:00:00.000Z')
    items.setPlayerItemSync(p.id, CURRENCY, 10000)
    await coordinator.runPersistenceTransaction({ domain: 'player', playerId: p.id,
        operation: 'box_1001_fixture' }, () => {})
    return { playerId: p.id, viewerId }
}
async function appFor(t) {
    const app = require('fastify')({ logger: false })
    app.addHook('onSend', (_request, reply, payload, done) => done(null,
        String(reply.getHeader('content-type') || '').startsWith('application/x-msgpack') && typeof payload === 'object'
            ? JSON.stringify(payload) : payload))
    await load('routes/api/boxGacha').default(app)
    await app.ready()
    t.after(() => app.close())
    return app
}
const row = (p, boxId = 1) => boxes.getPlayerBoxGachaSync(p.playerId, GACHA, boxId)
const facts = (p, boxId = 1) => boxes.getPlayerBoxGachaDrawnRewardsSync(p.playerId, GACHA, boxId)
const amount = (p, id = CURRENCY) => items.getPlayerItemSync(p.playerId, id) ?? 0
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
function boxState(p, boxId = 1, changes = {}) {
    const state = { boxId, remainingNumber: content.availableCounts[boxId],
        isClosed: false, resetTimes: 0, ...changes }
    if (row(p, boxId)) boxes.updatePlayerBoxGachaSync(p.playerId, GACHA, state)
    else boxes.insertPlayerBoxGachaSync(p.playerId, GACHA, state)
}
function rewardToLeave(boxId = 1) {
    const entry = Object.entries(content.boxes[boxId]).find(([, r]) => r.type === 0 && r.id !== CURRENCY && r.available > 0)
    assert.ok(entry, 'the actual master must contain an item reward for this box')
    return { key: Number(entry[0]), ...entry[1] }
}
// Fill each real reward independently. A stale aggregate cached count cannot substitute for this history.
function history(p, boxId = 1, leaveOne = false) {
    const chosen = rewardToLeave(boxId)
    db.prepare('DELETE FROM players_box_gacha_drawn_rewards WHERE player_id=? AND gacha_id=? AND box_id=?')
        .run(p.playerId, GACHA, boxId)
    for (const [key, reward] of Object.entries(content.boxes[boxId])) {
        const number = reward.available - (leaveOne && Number(key) === chosen.key ? 1 : 0)
        if (number > 0) boxes.insertPlayerBoxGachaDrawnRewardSync(p.playerId, GACHA, boxId,
            { id: Number(key), number })
    }
    return chosen
}
function lastDraw(p, boxId = 1, changes = {}) {
    boxState(p, boxId, { remainingNumber: 999, ...changes })
    return history(p, boxId, true)
}
const post = (app, p, route, extra = {}) => app.inject({ method: 'POST', url: '/' + route,
    payload: { viewer_id: p.viewerId, box_gacha_id: GACHA, box_id: 1,
        api_count: 1, number: 1, stop_on_featured_rewards: false, ...extra } })
function data(response) {
    assert.equal(response.statusCode, 200, response.body)
    assert.match(response.headers['content-type'], /application\/x-msgpack/)
    return response.json().data
}
async function rejectedUnchanged(app, p, route, extra = {}) {
    const before = digest(p), balance = amount(p)
    const response = await post(app, p, route, extra)
    assert.equal(response.statusCode, 400, response.body)
    assert.equal(digest(p), before, 'rejection must preserve all portable player state')
    assert.equal(amount(p), balance, 'rejection must not charge rainbow stones')
    return response
}
async function until(condition) {
    const end = performance.now() + 5000
    while (!condition()) { assert.ok(performance.now() < end, 'fixture queue timed out'); await nextTurn() }
}

test('1001 real master uses 70017/10 and nine reward inventories totaling 4000', () => {
    assert.equal(content.redeemItemId, CURRENCY)
    assert.equal(content.redeemItemCount, 10)
    assert.deepEqual(Object.keys(content.boxes).map(Number), [1, 2, 3, 4, 5, 6, 7, 8, 9])
    let total = 0
    for (const [boxId, rewards] of Object.entries(content.boxes)) {
        const available = Object.values(rewards).reduce((n, r) => n + r.available, 0)
        assert.equal(available, Number(boxId) === 9 ? 800 : 400)
        assert.equal(available, content.availableCounts[boxId])
        total += available
    }
    assert.equal(total, 4000)
})

test('current 2026 time rejects draw, new empty close and empty reset without writes or charges', async t => {
    clock(t, EXPIRED)
    const app = await appFor(t)
    for (const route of ['exec', 'close', 'reset']) {
        const p = await subject()
        if (route === 'exec') lastDraw(p)
        else { boxState(p, 1, { remainingNumber: 999 }); history(p) }
        await rejectedUnchanged(app, p, route)
    }
})

test('UTC+8 first opening includes its start second and rejects the preceding second', async t => {
    const setNow = clock(t, START - 1), app = await appFor(t), p = await subject()
    lastDraw(p)
    await rejectedUnchanged(app, p, 'exec')
    setNow(START)
    data(await post(app, p, 'exec'))
    assert.equal(amount(p), 9990)
})

test('draw period includes the entire final second, lasts beyond task expiry and rejects the next second', async t => {
    const setNow = clock(t, END + 999), app = await appFor(t), p = await subject()
    lastDraw(p)
    data(await post(app, p, 'exec'))
    assert.equal(amount(p), 9990)
    const late = await subject()
    lastDraw(late)
    setNow(END + 1000)
    await rejectedUnchanged(app, late, 'exec')
})

test('A through H open on consecutive UTC+8 05:00 days and I opens on H day', async t => {
    const setNow = clock(t), app = await appFor(t)
    for (let boxId = 2; boxId <= 9; boxId++) {
        const opening = START + Math.min(boxId - 1, 7) * DAY
        const p = await subject()
        boxState(p, boxId - 1, { isClosed: true })
        lastDraw(p, boxId)
        setNow(opening - 1)
        await rejectedUnchanged(app, p, 'exec', { box_id: boxId })
        setNow(opening)
        data(await post(app, p, 'exec', { box_id: boxId }))
        assert.equal(amount(p), 9990, `box ${boxId} must charge one draw at its opening`)
    }
})

test('missing or unfinished previous box locks the next box despite cached zero and obsolete facts', async t => {
    clock(t)
    const app = await appFor(t)
    const missing = await subject()
    lastDraw(missing, 2)
    db.prepare('DELETE FROM players_box_gacha WHERE player_id=? AND id=? AND box_id=1').run(missing.playerId, GACHA)
    await rejectedUnchanged(app, missing, 'exec', { box_id: 2 })
    const partial = await subject()
    boxState(partial, 1, { remainingNumber: 0 })
    // A large obsolete reward counter is not evidence that current rewards are exhausted.
    boxes.insertPlayerBoxGachaDrawnRewardSync(partial.playerId, GACHA, 1, { id: 999, number: 400 })
    lastDraw(partial, 2)
    await rejectedUnchanged(app, partial, 'exec', { box_id: 2 })
    await rejectedUnchanged(app, partial, 'close', { box_id: 2 })
})

test('per-reward exhaustion unlocks the next box despite stale positive cached remaining', async t => {
    clock(t)
    const app = await appFor(t), p = await subject()
    boxState(p, 1, { remainingNumber: 999 })
    history(p)
    lastDraw(p, 2)
    const previous = row(p), previousFacts = facts(p)
    data(await post(app, p, 'exec', { box_id: 2 }))
    assert.deepEqual(row(p), previous, 'unlock checks must not rewrite the previous box')
    assert.deepEqual(facts(p), previousFacts)
    assert.equal(amount(p), 9990)
})

test('historical partial closure unlocks the next box and preserves original progress', async t => {
    clock(t)
    const app = await appFor(t), p = await subject()
    boxState(p, 1, { remainingNumber: 17, isClosed: true, resetTimes: 7 })
    const reward = rewardToLeave()
    boxes.insertPlayerBoxGachaDrawnRewardSync(p.playerId, GACHA, 1, { id: reward.key, number: 1 })
    lastDraw(p, 2)
    const previous = row(p), previousFacts = facts(p)
    data(await post(app, p, 'exec', { box_id: 2 }))
    assert.deepEqual(row(p), previous)
    assert.deepEqual(facts(p), previousFacts)
})

test('queued draw rereads previous-box facts when they become exhausted or unfinished', async t => {
    clock(t)
    const app = await appFor(t)
    for (const exhaustedAtExecution of [true, false]) {
        const p = await subject()
        boxState(p)
        history(p, 1, exhaustedAtExecution)
        lastDraw(p, 2)
        const release = await persistenceWriteGate.acquire(true)
        let pending, before
        try {
            assert.equal(db.inTransaction, false, 'the clock/state gate must be outside a transaction')
            pending = Promise.resolve(post(app, p, 'exec', { box_id: 2 }))
            await until(() => persistenceAdmission.stats().total === 1)
            history(p, 1, !exhaustedAtExecution)
            before = digest(p)
        } finally { release() }
        const response = await pending
        if (exhaustedAtExecution) { data(response); assert.equal(amount(p), 9990) }
        else {
            assert.equal(response.statusCode, 400, response.body)
            assert.equal(digest(p), before)
            assert.equal(amount(p), 10000)
        }
    }
})

test('queued draw captures execution time after crossing the final second', async t => {
    const setNow = clock(t, END), app = await appFor(t), p = await subject()
    lastDraw(p)
    const release = await persistenceWriteGate.acquire(true)
    let pending, before
    try {
        assert.equal(db.inTransaction, false)
        pending = Promise.resolve(post(app, p, 'exec'))
        await until(() => persistenceAdmission.stats().total === 1)
        setNow(END + 1000)
        before = digest(p)
    } finally { release() }
    const response = await pending
    assert.equal(response.statusCode, 400, response.body)
    assert.equal(digest(p), before)
    assert.equal(amount(p), 10000)
})

test('20 competing real final draws admit eight commands and award once without reset', async t => {
    clock(t)
    const app = await appFor(t), p = await subject(), chosen = lastDraw(p)
    const owned = amount(p, chosen.id), rejectedBefore = persistenceAdmission.stats().rejected
    const responses = await Promise.all(Array.from({ length: 20 }, () => post(app, p, 'exec')))
    assert.equal(responses.filter(r => r.statusCode === 200).length, 1)
    assert.equal(responses.filter(r => r.statusCode === 400).length, 7)
    const busy = responses.filter(r => r.statusCode === 503)
    assert.equal(busy.length, 12)
    assert.ok(busy.every(r => r.json().code === 'PERSISTENCE_QUEUE_FULL'))
    assert.equal(persistenceAdmission.stats().rejected - rejectedBefore, 12)
    assert.equal(persistenceAdmission.stats().total, 0, 'all eight admitted commands must release their budget')
    assert.equal(amount(p), 9990)
    assert.equal(amount(p, chosen.id), owned + chosen.count)
    assert.equal(facts(p).find(r => r.id === chosen.key).number, chosen.available)
    assert.deepEqual(row(p), { boxId: 1, remainingNumber: 0, isClosed: true, resetTimes: 0 })
    await rejectedUnchanged(app, p, 'reset')
})

test('deleting the previous status cascades its facts and leaves the next box locked without reseeding', async t => {
    clock(t)
    const app = await appFor(t), p = await subject()
    history(p)
    assert.ok(facts(p).length > 0)
    assert.equal(db.pragma('foreign_keys', { simple: true }), 1)
    // Draw facts have a composite ON DELETE CASCADE FK to the box status.
    // A missing parent with retained exhaustion facts is not a legal fixture.
    db.prepare('DELETE FROM players_box_gacha WHERE player_id=? AND id=? AND box_id=1').run(p.playerId, GACHA)
    assert.deepEqual(facts(p), [])
    assert.equal(row(p), null)
    lastDraw(p, 2)
    await rejectedUnchanged(app, p, 'exec', { box_id: 2 })
    assert.equal(row(p), null, 'a rejected draw must not reseed the missing previous box')
    assert.deepEqual(facts(p), [])
    assert.equal(amount(p), 10000)
})

test('queued draw crossing the first opening is allowed by execution time', async t => {
    const setNow = clock(t, START - 1000), app = await appFor(t), p = await subject()
    const chosen = lastDraw(p), owned = amount(p, chosen.id)
    const release = await persistenceWriteGate.acquire(true)
    let pending
    try {
        assert.equal(db.inTransaction, false)
        pending = Promise.resolve(post(app, p, 'exec'))
        await until(() => persistenceAdmission.stats().total === 1)
        setNow(START)
    } finally { release() }
    data(await pending)
    assert.equal(amount(p), 9990)
    assert.equal(amount(p, chosen.id), owned + chosen.count)
    assert.equal(row(p).isClosed, true)
    assert.equal(persistenceAdmission.stats().total, 0)
})

test('queued new empty close crossing expiry is rejected without closing or writing', async t => {
    const setNow = clock(t, END), app = await appFor(t), p = await subject()
    boxState(p, 1, { remainingNumber: 999, isClosed: false, resetTimes: 3 })
    history(p)
    const original = row(p), previousFacts = facts(p)
    const release = await persistenceWriteGate.acquire(true)
    let pending, before
    try {
        assert.equal(db.inTransaction, false)
        pending = Promise.resolve(post(app, p, 'close'))
        await until(() => persistenceAdmission.stats().total === 1)
        setNow(END + 1000)
        before = digest(p)
    } finally { release() }
    const response = await pending
    assert.equal(response.statusCode, 400, response.body)
    assert.equal(digest(p), before)
    assert.deepEqual(row(p), original)
    assert.deepEqual(facts(p), previousFacts)
    assert.equal(amount(p), 10000)
    assert.equal(persistenceAdmission.stats().total, 0)
})

test('all nine empty 1001 boxes reject reset during the valid draw period', async t => {
    clock(t)
    const app = await appFor(t), p = await subject()
    for (let boxId = 1; boxId <= 9; boxId++) {
        boxState(p, boxId, { remainingNumber: 0, isClosed: true, resetTimes: 4 })
        history(p, boxId)
        await rejectedUnchanged(app, p, 'reset', { box_id: boxId })
        assert.equal(row(p, boxId).resetTimes, 4)
    }
})

test('partial close is rejected even when cached remaining is zero', async t => {
    clock(t)
    const app = await appFor(t)
    for (const remainingNumber of [999, 0]) {
        const p = await subject()
        lastDraw(p, 1, { remainingNumber })
        await rejectedUnchanged(app, p, 'close')
        assert.equal(row(p).isClosed, false)
    }
})

test('a truly exhausted open box can close once without clearing its history or reset count', async t => {
    clock(t)
    const app = await appFor(t), p = await subject()
    boxState(p, 1, { remainingNumber: 999, resetTimes: 3 })
    history(p)
    const beforeFacts = facts(p)
    const result = data(await post(app, p, 'close'))
    assert.equal(result.all_box_info.find(b => b.box_id === 1).is_closed, true)
    assert.deepEqual(row(p), { boxId: 1, remainingNumber: 0, isClosed: true, resetTimes: 3 })
    assert.deepEqual(facts(p), beforeFacts)
    assert.equal(amount(p), 10000)
    const before = digest(p)
    data(await post(app, p, 'close'))
    assert.equal(digest(p), before)
    await rejectedUnchanged(app, p, 'reset')
})

test('expired repeated close returns the historical terminal state without normalizing or reopening it', async t => {
    clock(t, EXPIRED)
    const app = await appFor(t), p = await subject()
    boxState(p, 1, { remainingNumber: 0, isClosed: true, resetTimes: 7 })
    const chosen = rewardToLeave()
    boxes.insertPlayerBoxGachaDrawnRewardSync(p.playerId, GACHA, 1, { id: chosen.key, number: 1 })
    const before = digest(p), original = row(p)
    const result = data(await post(app, p, 'close'))
    assert.equal(result.all_box_info.find(b => b.box_id === 1).is_closed, true)
    assert.equal(digest(p), before)
    assert.deepEqual(row(p), original)
    assert.equal(amount(p), 10000)
})

test('get_box_list leaves legacy five rows, cached zero, closed states and absent boxes untouched', async t => {
    const setNow = clock(t), app = await appFor(t), p = await subject()
    db.prepare('DELETE FROM players_box_gacha WHERE player_id=? AND id=? AND box_id>5').run(p.playerId, GACHA)
    boxState(p, 1, { remainingNumber: 0, isClosed: true, resetTimes: 7 })
    boxState(p, 2, { remainingNumber: 0, isClosed: false })
    const chosen = rewardToLeave()
    boxes.insertPlayerBoxGachaDrawnRewardSync(p.playerId, GACHA, 1, { id: chosen.key, number: 1 })
    const before = digest(p), original = boxes.getPlayerBoxGachasSync(p.playerId)['1001']
    for (const now of [LEGAL, EXPIRED]) {
        setNow(now)
        const result = data(await post(app, p, 'get_box_list'))
        assert.equal(result.all_box_info.find(b => b.box_id === 1).is_closed, true)
        assert.equal(digest(p), before)
        assert.deepEqual(boxes.getPlayerBoxGachasSync(p.playerId)['1001'], original)
        assert.equal(boxes.getPlayerBoxGachasSync(p.playerId)['1001'].length, 5)
        assert.equal(row(p, 6), null)
    }
})

test('exec never reopens a historical closed cached-zero box with current rewards remaining', async t => {
    const setNow = clock(t), app = await appFor(t), p = await subject()
    lastDraw(p, 1, { remainingNumber: 0, isClosed: true, resetTimes: 2 })
    for (const now of [LEGAL, EXPIRED]) {
        setNow(now)
        await rejectedUnchanged(app, p, 'exec')
        assert.equal(row(p).isClosed, true)
        assert.equal(row(p).resetTimes, 2)
    }
})

test('one remaining real reward charges exactly 10 stones and awards once with committed response', async t => {
    clock(t)
    const app = await appFor(t), p = await subject(), chosen = lastDraw(p)
    const owned = amount(p, chosen.id)
    await rejectedUnchanged(app, p, 'exec', { number: 2 })
    const result = data(await post(app, p, 'exec'))
    assert.deepEqual(result.drawn_reward_list, [{ reward_id: chosen.key, number: 1 }])
    assert.equal(amount(p), 9990)
    assert.equal(result.item_list[CURRENCY], 9990)
    assert.equal(amount(p, chosen.id), owned + chosen.count)
    assert.equal(result.item_list[chosen.id], owned + chosen.count)
    assert.equal(facts(p).find(r => r.id === chosen.key).number, chosen.available)
    assert.equal(row(p).remainingNumber, 0)
    assert.equal(row(p).isClosed, true)
    await rejectedUnchanged(app, p, 'exec')
})

for (const fault of ['facts', 'commit', 'response']) test(`1001 ${fault} failure rolls back charge, reward, progress and stock`, async t => {
    clock(t)
    const app = await appFor(t), p = await subject(), chosen = lastDraw(p)
    const owned = amount(p, chosen.id), before = digest(p), beforeFacts = facts(p), beforeBox = row(p)
    let responseReads = 0, mock
    if (fault === 'commit') {
        db.exec(`CREATE TABLE box_1001_fixture_parent(id INTEGER PRIMARY KEY);
            CREATE TABLE box_1001_fixture_child(id INTEGER REFERENCES box_1001_fixture_parent(id) DEFERRABLE INITIALLY DEFERRED);
            CREATE TRIGGER box_1001_fixture_fault AFTER UPDATE OF amount ON players_items
                WHEN NEW.player_id=${p.playerId} AND NEW.id=${CURRENCY}
                BEGIN INSERT INTO box_1001_fixture_child VALUES(1); END`)
    } else if (fault === 'facts') {
        db.exec(`CREATE TRIGGER box_1001_fixture_fault BEFORE INSERT ON players_box_gacha_drawn_rewards
            WHEN NEW.player_id=${p.playerId} BEGIN SELECT RAISE(ABORT,'fixture 1001 draw-facts failure'); END`)
    } else {
        const original = boxes.getPlayerBoxGachaDrawnRewardsSync
        mock = t.mock.method(boxes, 'getPlayerBoxGachaDrawnRewardsSync', (playerId, gachaId, boxId) => {
            if (playerId === p.playerId && gachaId === GACHA && Number(boxId) === 2) {
                responseReads++
                assert.equal(db.inTransaction, true, 'response facts must be gathered before COMMIT')
                assert.equal(amount(p), 9990)
                assert.equal(amount(p, chosen.id), owned + chosen.count)
                assert.equal(original(playerId, gachaId, 1).find(r => r.id === chosen.key).number, chosen.available)
                throw new Error('fixture 1001 response collection failure')
            }
            return original(playerId, gachaId, boxId)
        })
    }
    try {
        const failed = await post(app, p, 'exec')
        assert.equal(failed.statusCode, 500, failed.body)
        assert.equal(db.inTransaction, false)
        assert.equal(digest(p), before)
        assert.equal(amount(p), 10000)
        assert.equal(amount(p, chosen.id), owned)
        assert.deepEqual(facts(p), beforeFacts)
        assert.deepEqual(row(p), beforeBox)
        if (fault === 'commit') assert.equal(db.prepare('SELECT count(*) n FROM box_1001_fixture_child').get().n, 0)
        if (fault === 'response') assert.equal(responseReads, 1)
    } finally {
        if (mock) mock.mock.restore()
        else {
            db.exec('DROP TRIGGER box_1001_fixture_fault')
            if (fault === 'commit') db.exec('DROP TABLE box_1001_fixture_child; DROP TABLE box_1001_fixture_parent')
        }
    }
    data(await post(app, p, 'exec'))
    assert.equal(amount(p), 9990)
    assert.equal(amount(p, chosen.id), owned + chosen.count)
})
