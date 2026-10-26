'use strict'
const compiled = process.env.STARPOINT_TEST_COMPILED === '1'
if (!compiled) require('ts-node/register/transpile-only')
const load = name => require(`../${compiled ? 'out' : 'src'}/${name}`)
const { test, before, after } = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto')
const root = path.resolve(process.env.STARPOINT_TEST_TMP_ROOT || os.tmpdir())
fs.mkdirSync(root, { recursive: true })
const directory = fs.mkdtempSync(path.join(root, 'character-duplicate-'))
Object.assign(process.env, { DATA_DIR: directory, TEMP: directory, TMP: directory, SQLITE_TMPDIR: directory,
    GACHA_SEED_DIR: path.join(directory, 'seeds'), CN_WRITER_THREAD: '0', GAME_VERBOSE_LOGS: 'false', GAME_ROUTINE_LOGS: 'off' })
fs.mkdirSync(process.env.GACHA_SEED_DIR)
const players = load('data/domains/player'), characters = load('data/domains/character'), items = load('data/domains/item')
const rewards = load('lib/character'), assets = load('lib/assets'), gacha = load('lib/gacha')
const identities = load('lib/gameplay-request-identity'), receipts = load('lib/gameplay-mutation-receipt')
const characterMaster = require('../assets/character.json'), originalRandomInt = crypto.randomInt
let app, db
before(async () => {
    load('data').initializeDatabase(); db = load('data/db').getDb()
    identities.initializeGameplayRequestIdentitySchemaSync(db)
    assert.equal(path.dirname(fs.realpathSync(db.name)), fs.realpathSync(directory))
    const operations = load('lib/content-operations').contentOperations()
    const review = { enabled: true, readiness: 'verified', endsAtMs: null,
        evidence: 'Isolated five-star duplicate reward regression using the real original pool' }
    operations.update('gacha:1', { expectedRevision: operations.revision(), catalogDigest: operations.digest,
        reason: 'Enable existing pool only in this disposable test database', actionOverrides: { visible: review, enter: review } }, Date.now())
    app = require('fastify')({ logger: false })
    // Application-layer route test. Production wire encoding is covered separately.
    app.addHook('onSend', (_request, reply, body, done) => done(null,
        String(reply.getHeader('content-type')).startsWith('application/x-msgpack') && typeof body === 'object' ? JSON.stringify(body) : body))
    await app.register(load('routes/api/gacha').default, { prefix: '/gacha' }); await app.ready()
})
after(async () => {
    crypto.randomInt = originalRandomInt
    await app?.close(); await load('lib/seed-validator').default.close()
    if (db?.open) db.close()
    assert.equal(path.dirname(fs.realpathSync(directory)), fs.realpathSync(root))
    assert.ok(path.basename(directory).startsWith('character-duplicate-'))
    fs.rmSync(directory, { recursive: true })
})
function fixture() {
    const account = load('data/domains/account').insertAccountSync({ appId: 'wf_cn', idpAlias: '', idpCode: 'dupe-test', idpId: crypto.randomUUID(), status: 'normal' })
    const player = players.insertDefaultPlayerSync(account.id), p = { id: player.id, accountId: account.id, viewer: 890000000 + player.id }
    load('data/activeAccount').saveAccountDefaultPlayer(account.id, p.id)
    db.prepare('INSERT INTO sessions(token,account_id,expires,type) VALUES(?,?,?,2)').run(String(p.viewer), p.accountId, '2099-01-01T00:00:00Z')
    p.token = db.transaction(() => identities.issueGameplayLoginTokenSync(db, { accountId: p.accountId,
        viewerId: p.viewer, udid: 'dupe-test-' + p.viewer, expiresAt: Date.now() + 86400000 }))()
    items.setPlayerItemSync(p.id, 101, 7)
    return p
}
function state(p) {
    const result = { player: players.getPlayerSync(p.id) }
    for (const table of ['players_characters', 'players_items', 'players_receive_history', 'players_gacha_info',
        'players_active_mission_counters', 'player_operation_receipts'])
        result[table] = db.prepare(`SELECT * FROM ${table} WHERE player_id=? ORDER BY rowid`).all(p.id)
    return result
}
const request = p => ({ viewer_id: p.viewer, api_count: 1, gacha_id: 1, payment_type: 1, type: 1, number_of_exec: 1 })
const post = (p, payload) => app.inject({ method: 'POST', url: '/gacha/exec', headers: { login_token: p.token }, payload })
const data = response => { assert.equal(response.statusCode, 200, response.body); return response.json().data }

for (const rarity of [1, 2]) test(`rarity ${rarity} first and duplicate copies grant no EX item and preserve ordinary inventory`, () => {
    const p = fixture(), entry = Object.entries(characterMaster).find(([id, row]) => Number(id) > 100000 && row.rarity === rarity)
    assert.ok(entry); const id = Number(entry[0]); assert.equal(assets.getCharacterDataSync(id).rarity, rarity)
    const beforeItems = items.getPlayerItemsSync(p.id)
    assert.equal(rewards.givePlayerCharacterSync(p.id, id).item, undefined)
    assert.equal(characters.getPlayerCharacterSync(p.id, id).stack, 0)
    assert.equal(rewards.givePlayerCharacterSync(p.id, id).item, undefined)
    assert.equal(characters.getPlayerCharacterSync(p.id, id).stack, 1)
    assert.deepEqual(items.getPlayerItemsSync(p.id), beforeItems)
})

test('successive five-star duplicates add one character stack and three EX items each', () => {
    const p = fixture(), id = 111015, itemId = 14003
    assert.equal(assets.getCharacterDataSync(id).rarity, 5)
    items.setPlayerItemSync(p.id, itemId, 7)
    assert.equal(rewards.givePlayerCharacterSync(p.id, id).item, undefined)
    assert.equal(items.getPlayerItemSync(p.id, itemId), 7, 'first ownership grants no duplicate compensation')
    for (let copy = 1; copy <= 3; copy++) {
        const granted = rewards.givePlayerCharacterSync(p.id, id)
        assert.equal(characters.getPlayerCharacterSync(p.id, id).stack, copy)
        assert.deepEqual(granted.item, { id: itemId, count: 3, inventoryCount: 7 + copy * 3 })
        assert.equal(items.getPlayerItemSync(p.id, itemId), 7 + copy * 3)
        assert.equal(items.getPlayerItemSync(p.id, 101), 7)
    }
})

test('real gacha exec publishes a five-star delta of three and replays the last-currency request once', async () => {
    const p = fixture(), pool = assets.getGachaSync(1)
    // Control only randomness; use the actual pool, draw algorithm, grant and route.
    crypto.randomInt = (min, max) => max === undefined ? 0 : min
    try {
        const expectedDraw = gacha.drawGachaWithMetadataSync(pool, 1)[0]
        assert.equal(expectedDraw.rank, 5)
        const id = expectedDraw.id, itemId = rewards.getCharacterDuplicateRewardItemId(id)
        assert.equal(assets.getCharacterDataSync(id).rarity, 5)
        characters.insertDefaultPlayerCharacterSync(p.id, id)
        items.setPlayerItemSync(p.id, itemId, 7)
        players.updatePlayerSync({ id: p.id, freeVmoney: pool.singleCost, vmoney: 0 })
        const payload = request(p), first = data(await post(p, payload)), committed = state(p)
        assert.deepEqual(data(await post(p, { ...payload, retry_count: 1 })), first)
        assert.deepEqual(state(p), committed, 'same native request must not add another stack or material')
        assert.equal(first.draw.length, 1); assert.equal(first.draw[0].character_id, id)
        assert.equal(characters.getPlayerCharacterSync(p.id, id).stack, 1)
        assert.equal(players.getPlayerSync(p.id).freeVmoney, 0)
        assert.equal(committed.players_receive_history.length, 1)
        assert.equal(first.movies, undefined)
        assert.deepEqual(first.draw[0].ex_boost_item, { id: itemId, count: 3 })
        assert.equal(first.item_list[itemId], 10); assert.equal(items.getPlayerItemSync(p.id, itemId), 10)
    } finally { crypto.randomInt = originalRandomInt }
})

test('an explicit pre-change native gacha receipt with one EX item replays unchanged without a retroactive grant', async () => {
    const p = fixture(), id = 111015, itemId = 14003, payload = request(p)
    // Model a previously committed save/receipt directly. Do not invoke the new
    // grant function to manufacture a historical one-item reward.
    characters.insertDefaultPlayerCharacterSync(p.id, id)
    characters.updatePlayerCharacterSync(p.id, id, { stack: 1 })
    items.setPlayerItemSync(p.id, itemId, 8)
    players.updatePlayerSync({ id: p.id, freeVmoney: 0, vmoney: 0 })
    const historicalData = { user_info: { free_vmoney: 0, vmoney: 0 },
        draw: [{ character_id: id, movie_id: 'historical-receipt-fixture', seed: 111015000, entry_count: 1, ex_boost_item: { id: itemId, count: 1 } }],
        character_list: [{ character_id: id, stack: 1 }], item_list: { [itemId]: 8 },
        gacha_info_list: [{ gacha_id: 1, is_account_first: false, is_daily_first: false, gacha_exchange_point: 1 }],
        encyclopedia_info: [], mail_arrived: false }
    db.transaction(() => {
        const mutation = receipts.readGameplayMutationRequestSync(p.id,
            { headerToken: p.token, body: payload, accountId: p.accountId }, 'gacha_exec',
            { gachaId: 1, paymentType: 1, type: 1, numberOfExec: 1 })
        assert.ok(mutation)
        receipts.recordGameplayMutationResponseSync(p.id, mutation, { responseData: historicalData, movies: [] })
    })()
    const committed = state(p)
    assert.deepEqual(data(await post(p, { ...payload, retry_count: 1 })), historicalData)
    assert.deepEqual(state(p), committed, 'historical response and saved inventory remain untouched')
    assert.equal(items.getPlayerItemSync(p.id, itemId), 8)
    assert.equal(characters.getPlayerCharacterSync(p.id, id).stack, 1)
})
