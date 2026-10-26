'use strict'
const compiled = process.env.STARPOINT_TEST_COMPILED === '1'
if (!compiled) require('ts-node/register/transpile-only')
const load = name => require(`../${compiled ? 'out' : 'src'}/${name}`)
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const { randomUUID } = require('node:crypto')
const root = path.resolve(process.env.STARPOINT_TEST_TMP_ROOT || os.tmpdir())
fs.mkdirSync(root, { recursive: true })
const directory = fs.mkdtempSync(path.join(root, 'economy-retry-'))
Object.assign(process.env, { DATA_DIR: directory, TEMP: directory, TMP: directory, SQLITE_TMPDIR: directory,
    GACHA_SEED_DIR: path.join(directory, 'seeds'), CN_WRITER_THREAD: '0', GAME_VERBOSE_LOGS: 'false', GAME_ROUTINE_LOGS: 'off' })
fs.mkdirSync(process.env.GACHA_SEED_DIR)
const players = load('data/domains/player'), items = load('data/domains/item'), characters = load('data/domains/character')
const gachas = load('data/domains/gacha'), assets = load('lib/assets'), operations = load('lib/content-operations')
const identities = load('lib/gameplay-request-identity'), receipts = load('lib/gameplay-mutation-receipt')
const originalRecord = receipts.recordGameplayMutationResponseSync
const gachaLogic = load('lib/gacha'), seed = load('lib/seed-validator').default
let db, app
function login(p) {
    p.token = db.transaction(() => identities.issueGameplayLoginTokenSync(db, {
        accountId: p.accountId, viewerId: p.viewer, udid: 'economy-retry-' + p.viewer, expiresAt: Date.now() + 86400000,
    }))()
    p.count = 0
    return p
}
function fixture() {
    const account = load('data/domains/account').insertAccountSync({ appId: 'wf_cn', idpAlias: '', idpCode: 'economy-retry', idpId: randomUUID(), status: 'normal' })
    const player = players.insertDefaultPlayerSync(account.id), viewer = 870000000 + player.id
    load('data/activeAccount').saveAccountDefaultPlayer(account.id, player.id)
    db.prepare('INSERT INTO sessions(token,account_id,expires,type) VALUES(?,?,?,2)').run(String(viewer), account.id, '2099-01-01T00:00:00Z')
    players.updatePlayerSync({ id: player.id, freeVmoney: 10000, vmoney: 10000, expPool: 0, stamina: 0, staminaHealTime: new Date() })
    return login({ id: player.id, viewer, accountId: account.id })
}
const post = (p, route, body, count, token = p.token) => app.inject({ method: 'POST', url: route,
    headers: token ? { login_token: token } : {}, payload: { viewer_id: p.viewer, api_count: count ?? ++p.count, ...body } })
function data(response) { assert.equal(response.statusCode, 200, response.body); return response.json().data }
function owned(p, stack = 1, step = 0) {
    const id = 243001
    if (!characters.getPlayerCharacterSync(p.id, id)) characters.insertDefaultPlayerCharacterSync(p.id, id)
    characters.updatePlayerCharacterSync(p.id, id, { stack, overLimitStep: step, protection: false })
    return id
}
function bulkOwned(p, stack = 1) {
    const id = owned(p, stack), rarity = assets.getCharacterDataSync(id).rarity
    characters.updatePlayerCharacterSync(p.id, id, { overLimitStep: load('lib/character-overlimit').getCharacterMaxOverLimit(id, rarity) })
    return { id, exp: rarity === 5 ? 10000 : rarity === 4 ? 2000 : 500, grains: rarity === 5 ? 30 : rarity === 4 ? 10 : 2 }
}
function points(p, gid, amount) {
    if (gachas.getPlayerGachaInfoSync(p.id, gid)) gachas.updatePlayerGachaInfoSync(p.id, { gachaId: gid, gachaExchangePoint: amount })
    else gachas.insertPlayerGachaInfoSync(p.id, { gachaId: gid, isAccountFirst: false, isDailyFirst: false, gachaExchangePoint: amount })
}
function snapshot(p) {
    const result = { player: players.getPlayerSync(p.id) }
    for (const table of ['players_characters', 'players_items', 'players_equipment', 'players_receive_history',
        'players_gacha_info', 'players_active_mission_counters', 'player_operation_receipts']) {
        result[table] = db.prepare(`SELECT * FROM ${table} WHERE player_id=? ORDER BY rowid`).all(p.id)
    }
    return result
}
function control(gid, enabled = true) {
    const store = operations.contentOperations(), state = { enabled, readiness: 'verified', endsAtMs: null,
        evidence: 'Synthetic request replay regression in a disposable database' }
    store.update('gacha:' + gid, { expectedRevision: store.revision(), catalogDigest: store.digest,
        reason: 'Prepare existing pool for isolated economy retry checks',
        actionOverrides: { visible: state, enter: state, exchange: state } }, Date.now())
}
const cases = [
    { name: 'ordinary character gacha last currency', route: '/gacha/exec', setup(p) {
        const cost = assets.getGachaSync(1).singleCost
        players.updatePlayerSync({ id: p.id, freeVmoney: cost, vmoney: 0 })
        return { gacha_id: 1, payment_type: 1, type: 1, number_of_exec: 1 }
    } },
    { name: 'ordinary equipment gacha last currency', route: '/gacha/exec', setup(p) {
        players.updatePlayerSync({ id: p.id, freeVmoney: assets.getGachaSync(3).singleCost, vmoney: 0 })
        return { gacha_id: 3, payment_type: 1, type: 1, number_of_exec: 1 }
    } },
    { name: 'ordinary gacha last ticket', route: '/gacha/exec', setup(p) {
        items.setPlayerItemSync(p.id, assets.getGachaSync(990001).tenTicketItemId, 1)
        return { gacha_id: 990001, payment_type: 3, type: 4, number_of_exec: 1 }
    } },
    ...[[29, 'character'], [5000, 'equipment']].map(([gid, kind]) => ({ name: kind + ' exchange last points', route: '/gacha/exchange_' + kind,
        setup(p) {
            points(p, gid, 250)
            const entry = Object.values(assets.getGachaSync(gid).pool).flat().find(row => row.isExchangeable)
            assert.ok(entry)
            return { gacha_id: gid, [kind + '_id']: entry.id }
        } })),
    { name: 'over limit last duplicate', route: '/character/over_limit', setup(p) {
        return { character_id: owned(p), use_stack: true, over_limit_count: 1 }
    } },
    { name: 'over limit last material reaches maximum', route: '/character/over_limit', setup(p) {
        const id = owned(p), rarity = assets.getCharacterDataSync(id).rarity
        characters.updatePlayerCharacterSync(p.id, id, { overLimitStep: load('lib/character-overlimit').getRetailMaxOverLimit(rarity) - 1 })
        const item = rarity === 5 ? 10003 : rarity === 4 ? 10002 : 10001
        items.setPlayerItemSync(p.id, item, 1)
        return { character_id: id, use_stack: false, item_id: item, over_limit_count: 1 }
    } },
    { name: 'stamina last medicine', route: '/item/use_item', setup(p) {
        items.setPlayerItemSync(p.id, 101, 1)
        return { items: [{ id: 101, number: 1, selectIndex: 0 }] }
    } },
    { name: 'single stack conversion last duplicate', route: '/expod/stack_to_exp', setup(p) {
        return { character_id: owned(p), number: 1 }
    } },
]
before(async () => {
    load('data').initializeDatabase(); db = load('data/db').getDb()
    identities.initializeGameplayRequestIdentitySchemaSync(db)
    assert.equal(path.dirname(fs.realpathSync(db.name)), fs.realpathSync(directory))
    for (const gid of [1, 3, 990001, 29, 5000]) control(gid)
    app = require('fastify')({ logger: false })
    app.addHook('onSend', (_request, reply, body, done) => done(null,
        String(reply.getHeader('content-type')).startsWith('application/x-msgpack') && typeof body === 'object' ? JSON.stringify(body) : body))
    for (const route of ['gacha', 'character', 'item', 'expod']) await app.register(load('routes/api/' + route).default, { prefix: '/' + route })
    await app.ready()
})
after(async () => {
    receipts.recordGameplayMutationResponseSync = originalRecord
    if (app) await app.close()
    await seed.close()
    if (db?.open) db.close()
    assert.equal(path.dirname(directory), root)
    fs.rmSync(directory, { recursive: true })
})

for (const item of cases) {
    test(item.name + ': lost response and concurrent native retry replay exactly once', async () => {
        const p = fixture(), body = item.setup(p), count = ++p.count
        const competing = await Promise.all([post(p, item.route, body, count), post(p, item.route, body, count)])
        const first = data(competing[0]), committed = snapshot(p)
        assert.deepEqual(data(competing[1]), first, 'simultaneous first delivery shares one committed result')
        const replays = await Promise.all([post(p, item.route, body, count), post(p, item.route, { ...body, retry_count: 1 }, count)])
        for (const replay of replays) assert.deepEqual(data(replay), first)
        assert.deepEqual(snapshot(p), committed)
        assert.equal(first.movies, undefined, 'internal movie plan must not leak into the native response')
        const next = await post(p, item.route, body)
        assert.equal(next.statusCode, 400, 'a different operation cannot spend the exhausted resource or exceed the cap')
        assert.deepEqual(snapshot(p), committed)
    })
    test(item.name + ': receipt failure rolls reward and debit back, then same request may succeed', async () => {
        const p = fixture(), body = item.setup(p), count = ++p.count, beforeState = snapshot(p)
        let called = 0
        receipts.recordGameplayMutationResponseSync = (...args) => { originalRecord(...args); called++; throw new Error('injected after receipt insert') }
        try { assert.equal((await post(p, item.route, body, count)).statusCode, 500) }
        finally { receipts.recordGameplayMutationResponseSync = originalRecord }
        assert.equal(called, 1, 'must reach the post-reward receipt write')
        assert.deepEqual(snapshot(p), beforeState)
        data(await post(p, item.route, body, count))
    })
}

test('changed payload, different route, missing identity and another account cannot reuse a receipt', async () => {
    const p = fixture(), id = owned(p, 4), count = ++p.count
    const body = { character_id: id, number: 1 }
    data(await post(p, '/expod/stack_to_exp', body, count))
    const committed = snapshot(p)
    for (const [route, payload, token] of [
        ['/expod/stack_to_exp', { ...body, number: 2 }, p.token],
        ['/character/over_limit', { character_id: id, over_limit_count: 1, use_stack: true }, p.token],
        ['/expod/stack_to_exp', body, undefined],
        ['/expod/stack_to_exp', body, fixture().token],
    ]) {
        const result = token === undefined ? await app.inject({ method: 'POST', url: route, payload: { viewer_id: p.viewer, api_count: count, ...payload } })
            : await post(p, route, payload, count, token)
        assert.equal(result.statusCode, 400)
        assert.deepEqual(snapshot(p), committed)
    }
    data(await post(p, '/expod/stack_to_exp', body))
    assert.equal(characters.getPlayerCharacterSync(p.id, id).stack, 2)
})

test('new login may restart api_count while a completed old request only replays', async () => {
    const p = fixture(), id = owned(p, 4), body = { character_id: id, number: 1 }
    const oldToken = p.token, first = data(await post(p, '/expod/stack_to_exp', body)), oldCount = p.count
    login(p)
    data(await post(p, '/expod/stack_to_exp', body))
    assert.equal(p.count, oldCount)
    assert.equal(characters.getPlayerCharacterSync(p.id, id).stack, 2)
    const committed = snapshot(p)
    assert.deepEqual(data(await post(p, '/expod/stack_to_exp', body, oldCount, oldToken)), first)
    assert.equal((await post(p, '/expod/stack_to_exp', body, 900, oldToken)).statusCode, 400)
    assert.deepEqual(snapshot(p), committed)
})

test('independent overlapping stack conversions see the latest balance inside the transaction', async () => {
    const p = fixture(), id = owned(p, 1), body = { character_id: id, number: 1 }
    const result = await Promise.all([post(p, '/expod/stack_to_exp', body), post(p, '/expod/stack_to_exp', body)])
    assert.deepEqual(result.map(row => row.statusCode).sort(), [200, 400])
    assert.equal(characters.getPlayerCharacterSync(p.id, id).stack, 0)
    const rarity = assets.getCharacterDataSync(id).rarity
    assert.equal(players.getPlayerSync(p.id).expPool, rarity === 5 ? 10000 : rarity === 4 ? 2000 : 500)
})

test('independent overlapping bulk conversions award the latest inventory only once', async () => {
    const p = fixture(), reward = bulkOwned(p, 2)
    const results = await Promise.all([post(p, '/expod/bulk_stack_to_exp', {}), post(p, '/expod/bulk_stack_to_exp', {})])
    const responses = results.map(data)
    assert.deepEqual(responses.map(row => row.converted_exp_info.add_exp).sort((a, b) => a - b), [0, reward.exp * 2])
    assert.equal(characters.getPlayerCharacterSync(p.id, reward.id).stack, 0)
    assert.equal(players.getPlayerSync(p.id).expPool, reward.exp * 2)
    assert.equal(items.getPlayerItemsSync(p.id)[990008], reward.grains * 2)
})

test('bulk conversion native retry preserves later replacement stock and a new request may consume it', async () => {
    const p = fixture(), reward = bulkOwned(p), count = ++p.count
    const results = await Promise.all([post(p, '/expod/bulk_stack_to_exp', {}, count), post(p, '/expod/bulk_stack_to_exp', {}, count)])
    const first = data(results[0])
    assert.deepEqual(data(results[1]), first)
    assert.equal(players.getPlayerSync(p.id).expPool, reward.exp)
    characters.updatePlayerCharacterSync(p.id, reward.id, { stack: 2 })
    const replenished = snapshot(p)
    assert.deepEqual(data(await post(p, '/expod/bulk_stack_to_exp', { retry_count: 1 }, count)), first)
    assert.deepEqual(snapshot(p), replenished)
    assert.equal(data(await post(p, '/expod/bulk_stack_to_exp', {})).converted_exp_info.add_exp, reward.exp * 2)
    assert.equal(characters.getPlayerCharacterSync(p.id, reward.id).stack, 0)
    assert.equal(players.getPlayerSync(p.id).expPool, reward.exp * 3)
})

test('empty bulk success is receipted and later requests apply current protection and limit filters', async () => {
    const p = fixture(), count = ++p.count
    const empty = data(await post(p, '/expod/bulk_stack_to_exp', {}, count))
    assert.equal(empty.converted_exp_info.add_exp, 0)
    const reward = bulkOwned(p), replenished = snapshot(p)
    assert.deepEqual(data(await post(p, '/expod/bulk_stack_to_exp', {}, count)), empty)
    assert.deepEqual(snapshot(p), replenished)
    characters.updatePlayerCharacterSync(p.id, reward.id, { protection: true })
    assert.equal(data(await post(p, '/expod/bulk_stack_to_exp', {})).converted_exp_info.add_exp, 0)
    characters.updatePlayerCharacterSync(p.id, reward.id, { protection: false, overLimitStep: 0 })
    assert.equal(data(await post(p, '/expod/bulk_stack_to_exp', {})).converted_exp_info.add_exp, 0)
    bulkOwned(p)
    assert.equal(data(await post(p, '/expod/bulk_stack_to_exp', {})).converted_exp_info.add_exp, reward.exp)
})

test('bulk conversion receipt failure rolls inventory, rewards and receipt back together', async () => {
    const p = fixture(), reward = bulkOwned(p, 2), count = ++p.count, beforeState = snapshot(p)
    let called = 0
    receipts.recordGameplayMutationResponseSync = (...args) => { originalRecord(...args); called++; throw new Error('injected bulk receipt failure') }
    try { assert.equal((await post(p, '/expod/bulk_stack_to_exp', {}, count)).statusCode, 500) }
    finally { receipts.recordGameplayMutationResponseSync = originalRecord }
    assert.equal(called, 1)
    assert.deepEqual(snapshot(p), beforeState)
    assert.equal(data(await post(p, '/expod/bulk_stack_to_exp', {}, count)).converted_exp_info.add_exp, reward.exp * 2)
})

test('gacha retry recovers the recorded movie plan without rerolling, including after post-commit publication fails', async () => {
    const p = fixture(), body = { gacha_id: 1, payment_type: 1, type: 1, number_of_exec: 1 }, count = ++p.count
    const originalCommit = gachaLogic.commitPlannedCharacterGachaMovies, originalDraw = gachaLogic.drawGachaWithMetadataSync
    let recorded, restored
    gachaLogic.commitPlannedCharacterGachaMovies = plan => { recorded = structuredClone(plan); throw new Error('injected movie cache publication failure') }
    let first
    try { first = data(await post(p, '/gacha/exec', body, count)) }
    finally { gachaLogic.commitPlannedCharacterGachaMovies = originalCommit }
    const committed = snapshot(p)
    gachaLogic.drawGachaWithMetadataSync = () => { throw new Error('replay must not draw') }
    gachaLogic.commitPlannedCharacterGachaMovies = plan => { restored = structuredClone(plan); return originalCommit(plan) }
    try { assert.deepEqual(data(await post(p, '/gacha/exec', body, count)), first) }
    finally { gachaLogic.commitPlannedCharacterGachaMovies = originalCommit; gachaLogic.drawGachaWithMetadataSync = originalDraw }
    assert.deepEqual(restored, recorded); assert.equal(recorded.length, 1)
    assert.deepEqual(snapshot(p), committed)
    assert.equal(first.responseData, undefined); assert.equal(first.movies, undefined)
})

test('failed ordinary character and equipment draws publish no seed effects; completed replay survives content closure', async () => {
    const originalFlush = seed.flushAll, originalMark = seed.markSent
    for (const gid of [1, 3]) {
        const p = fixture(), body = { gacha_id: gid, payment_type: 1, type: 1, number_of_exec: 1 }, count = ++p.count
        let flushes = 0, marks = 0
        seed.flushAll = function (...args) { flushes++; return originalFlush.apply(this, args) }
        seed.markSent = function (...args) { marks++; return originalMark.apply(this, args) }
        receipts.recordGameplayMutationResponseSync = (...args) => { originalRecord(...args); throw new Error('rollback seed test') }
        try { assert.equal((await post(p, '/gacha/exec', body, count)).statusCode, 500) }
        finally { receipts.recordGameplayMutationResponseSync = originalRecord; seed.flushAll = originalFlush; seed.markSent = originalMark }
        assert.equal(flushes, 0); assert.equal(marks, 0)
        const first = data(await post(p, '/gacha/exec', body, count))
        control(gid, false)
        try {
            assert.deepEqual(data(await post(p, '/gacha/exec', body, count)), first)
            assert.equal((await post(p, '/gacha/exec', body)).statusCode, 400)
        } finally { control(gid) }
    }
})
