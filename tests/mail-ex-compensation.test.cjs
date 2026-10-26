'use strict'
// Development copy: set STARPOINT_TEST_REPO until this file is placed in tests/.
const path = require('node:path'), fs = require('node:fs'), os = require('node:os')
const repo = path.resolve(process.env.STARPOINT_TEST_REPO || path.join(__dirname, '..'))
const compiled = process.env.STARPOINT_TEST_COMPILED === '1'
if (!compiled) require(require.resolve('ts-node/register/transpile-only', { paths: [repo] }))
const load = name => require(path.join(repo, compiled ? 'out' : 'src', name))
const { test, before, after } = require('node:test'), assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto'), { spawnSync } = require('node:child_process')
const root = path.resolve(process.env.STARPOINT_TEST_TMP_ROOT || os.tmpdir())
fs.mkdirSync(root, { recursive: true })
const childReplay = process.argv.includes('--mail-replay-child')
const directory = childReplay ? path.resolve(process.env.DATA_DIR) : fs.mkdtempSync(path.join(root, 'mail-ex-compensation-'))
Object.assign(process.env, { DATA_DIR: directory, TEMP: directory, TMP: directory, SQLITE_TMPDIR: directory,
    GACHA_SEED_DIR: path.join(directory, 'seeds'), CN_WRITER_THREAD: '0', GAME_VERBOSE_LOGS: 'false', GAME_ROUTINE_LOGS: 'off' })
fs.mkdirSync(process.env.GACHA_SEED_DIR, { recursive: true })
const players = load('data/domains/player'), characters = load('data/domains/character'), items = load('data/domains/item')
const mails = load('data/domains/mail'), characterRewards = load('lib/character')
const identities = load('lib/gameplay-request-identity'), receipts = load('lib/gameplay-mutation-receipt')
const originalRecord = receipts.recordGameplayMutationResponseSync
let db, app
async function start() {
    load('data').initializeDatabase(); db = load('data/db').getDb()
    identities.initializeGameplayRequestIdentitySchemaSync(db)
    assert.equal(path.dirname(fs.realpathSync(db.name)), fs.realpathSync(directory))
    app = require(require.resolve('fastify', { paths: [repo] }))({ logger: false })
    app.addHook('onSend', (_request, reply, body, done) => done(null,
        String(reply.getHeader('content-type')).startsWith('application/x-msgpack') && typeof body === 'object' ? JSON.stringify(body) : body))
    await app.register(load('routes/api/mail').default, { prefix: '/mail' })
    await app.ready()
}
async function close() {
    receipts.recordGameplayMutationResponseSync = originalRecord
    await app?.close(); await load('lib/seed-validator').default.close()
    if (db?.open) db.close()
}
function login(p) {
    p.token = db.transaction(() => identities.issueGameplayLoginTokenSync(db, {
        accountId: p.accountId, viewerId: p.viewer, udid: 'mail-ex-test-' + p.viewer, expiresAt: Date.now() + 86400000,
    }))()
    p.count = 0
    return p
}
function fixture() {
    const account = load('data/domains/account').insertAccountSync({ appId: 'wf_cn', idpAlias: '', idpCode: 'mail-ex-test', idpId: randomUUID(), status: 'normal' })
    const player = players.insertDefaultPlayerSync(account.id), viewer = 870000000 + player.id
    load('data/activeAccount').saveAccountDefaultPlayer(account.id, player.id)
    db.prepare('INSERT INTO sessions(token,account_id,expires,type) VALUES(?,?,?,2)').run(String(viewer), account.id, '2099-01-01T00:00:00Z')
    const p = login({ id: player.id, accountId: account.id, viewer })
    assert.equal(characterRewards.getCharacterDuplicateRewardItemId(111015), 14003)
    assert.equal(characterRewards.getCharacterDuplicateRewardItemId(121001), 14006)
    items.setPlayerItemSync(p.id, 14003, 7); items.setPlayerItemSync(p.id, 14006, 11)
    return p
}
function mail(p, type, id, number) {
    return mails.insertMailSync(p.id, { reason_id: 1, subject: 'isolated EX metadata fixture', description: '', type, type_id: id, number,
        receive_time: '0000-00-00 00:00:00', create_time: '2026-10-25 00:00:00', reward_period_limited: 0, reward_limit_time: null })
}
const characterMail = (p, id, count) => mail(p, mails.MailType.CHARACTER, id, count)
const post = (p, body, count = ++p.count) => app.inject({ method: 'POST', url: '/mail/receive_all',
    headers: { login_token: p.token }, payload: { viewer_id: p.viewer, api_count: count, ...body } })
const ok = response => { assert.equal(response.statusCode, 200, response.body); return response.json().data }
const metadata = (mailId, itemId, count) => ({ mail_id: mailId, item_id: itemId, item_count: count })
function state(p) {
    const result = { player: players.getPlayerSync(p.id) }
    for (const table of ['players_characters', 'players_items', 'players_equipment', 'players_mails', 'players_receive_history',
        'players_degrees', 'player_operation_receipts']) {
        result[table] = db.prepare(`SELECT * FROM ${table} WHERE player_id=? ORDER BY rowid`).all(p.id)
    }
    return result
}
function claimReceipts(p) {
    return db.prepare("SELECT * FROM player_operation_receipts WHERE player_id=? AND operation='mail_claim' ORDER BY rowid").all(p.id)
}
function assertMetadata(data, expected) {
    assert.deepEqual(data.ex_boost_item_list, expected, 'batch metadata must report only the actual duplicate-character grant for each mail')
}

if (childReplay) {
    start().then(async () => {
        const input = JSON.parse(process.argv.at(-1)), response = await post(input.player, input.body, input.count)
        console.log('MAIL_REPLAY_RESULT ' + JSON.stringify({ status: response.statusCode, data: response.json().data }))
        await close()
    }).catch(async error => { console.error(error); await close(); process.exitCode = 1 })
} else {
before(start)
after(async () => {
    await close()
    assert.equal(path.dirname(directory), root)
    assert.equal(path.basename(directory).startsWith('mail-ex-compensation-'), true)
    fs.rmSync(directory, { recursive: true })
})

test('one new five-star character mail with three copies reports six EX compensation items', async () => {
    const p = fixture(), id = characterMail(p, 111015, 3)
    assert.equal(characters.getPlayerCharacterSync(p.id, 111015), null)
    const data = ok(await post(p, { mail_ids: [id] }))
    assert.equal(items.getPlayerItemSync(p.id, 14003), 13)
    assert.equal(data.item_list[14003], 13)
    assert.equal(characters.getPlayerCharacterSync(p.id, 111015).stack, 2)
    assert.deepEqual(data.mail_ids, [id])
    assertMetadata(data, [metadata(id, 14003, 6)])
})

test('two mails for the same new five-star character preserve per-mail compensation 6 plus 6', async () => {
    const p = fixture(), first = characterMail(p, 111015, 3), second = characterMail(p, 111015, 2)
    const data = ok(await post(p, { mail_ids: [first, second] }))
    assert.equal(items.getPlayerItemSync(p.id, 14003), 19)
    assert.equal(data.item_list[14003], 19)
    assert.equal(characters.getPlayerCharacterSync(p.id, 111015).stack, 4)
    assertMetadata(data, [metadata(first, 14003, 6), metadata(second, 14003, 6)])
})

test('two mails for an owned five-star character preserve per-mail compensation 6 plus 9', async () => {
    const p = fixture(); characterRewards.givePlayerCharacterSync(p.id, 111015)
    const first = characterMail(p, 111015, 2), second = characterMail(p, 111015, 3)
    const data = ok(await post(p, { mail_ids: [first, second] }))
    assert.equal(items.getPlayerItemSync(p.id, 14003), 22)
    assert.equal(characters.getPlayerCharacterSync(p.id, 111015).stack, 5)
    assertMetadata(data, [metadata(first, 14003, 6), metadata(second, 14003, 9)])
})

test('two character mappings and an ordinary EX-item mail keep compensation metadata separate', async () => {
    const p = fixture(), first = characterMail(p, 111015, 3)
    const ordinary = mail(p, mails.MailType.ITEM, 14003, 5), second = characterMail(p, 121001, 2)
    const data = ok(await post(p, { mail_ids: [first, ordinary, second] }))
    assert.equal(items.getPlayerItemSync(p.id, 14003), 18)
    assert.equal(items.getPlayerItemSync(p.id, 14006), 14)
    assert.equal(data.item_list[14003], 18); assert.equal(data.item_list[14006], 14)
    assertMetadata(data, [metadata(first, 14003, 6), metadata(second, 14006, 3)])
})

test('native retries and a fresh-process receipt replay preserve metadata without granting twice', async () => {
    const p = fixture(), first = characterMail(p, 111015, 3), second = characterMail(p, 111015, 2)
    const body = { mail_ids: [first, second], request_id: randomUUID() }, count = ++p.count
    const initial = ok(await post(p, body, count)), committed = state(p)
    assert.equal(items.getPlayerItemSync(p.id, 14003), 19)
    assert.deepEqual(ok(await post(p, { ...body, retry_count: 1 }, count)), initial)
    assert.deepEqual(state(p), committed)
    const child = spawnSync(process.execPath, [__filename, '--mail-replay-child', JSON.stringify({ player: p, body: { ...body, retry_count: 1 }, count })], {
        cwd: repo, env: { ...process.env, STARPOINT_TEST_REPO: repo }, encoding: 'utf8', timeout: 45000, windowsHide: true,
    })
    assert.equal(child.status, 0, String(child.error ?? '') + child.stderr + child.stdout.slice(-4000))
    const line = child.stdout.split(/\r?\n/).find(row => row.startsWith('MAIL_REPLAY_RESULT '))
    assert.ok(line, child.stdout.slice(-4000))
    const replay = JSON.parse(line.slice('MAIL_REPLAY_RESULT '.length))
    assert.equal(replay.status, 200); assert.deepEqual(replay.data, initial)
    assert.deepEqual(state(p), committed)
    assert.equal(committed.players_receive_history.length, 2)
    assert.equal(committed.player_operation_receipts.filter(row => row.operation === 'gameplay_mutation.v1').length, 1)
    const claims = claimReceipts(p); assert.equal(claims.length, 1)
    const expected = [metadata(first, 14003, 6), metadata(second, 14003, 6)]
    assertMetadata(initial, expected)
    assert.deepEqual(JSON.parse(claims[0].response_json).exBoostItemList, expected, 'legacy claim receipt must persist per-mail compensation')
})

test('a new native identity acknowledges claimed mail with empty EX metadata and current balances', async () => {
    const p = fixture(), id = characterMail(p, 111015, 3)
    ok(await post(p, { mail_ids: [id] }))
    items.setPlayerItemSync(p.id, 14003, 1)
    const history = state(p).players_receive_history
    login(p)
    const current = ok(await post(p, { mail_ids: [id] }))
    assert.deepEqual(current.mail_ids, []); assert.equal(current.already_mail_count, 1)
    assert.equal(current.item_list[14003], 1); assert.equal(items.getPlayerItemSync(p.id, 14003), 1)
    assert.equal(characters.getPlayerCharacterSync(p.id, 111015).stack, 2)
    assert.deepEqual(state(p).players_receive_history, history)
    assertMetadata(current, [])
})

test('old mail_claim JSON without EX metadata remains readable and never regrants removed mail', async () => {
    const p = fixture(), id = characterMail(p, 111015, 3), requestId = randomUUID()
    await load('routes/api/mail').claimPlayerMailRewards(p.id, [id], requestId)
    const rows = claimReceipts(p); assert.equal(rows.length, 1)
    const legacy = JSON.parse(rows[0].response_json); delete legacy.exBoostItemList
    db.prepare('UPDATE player_operation_receipts SET response_json=? WHERE player_id=? AND operation=? AND request_key=?')
        .run(JSON.stringify(legacy), p.id, 'mail_claim', rows[0].request_key)
    items.setPlayerItemSync(p.id, 14003, 1)
    db.prepare('DELETE FROM players_mails WHERE player_id=? AND id=?').run(p.id, id)
    const beforeState = state(p), body = { mail_ids: [id], request_id: requestId }, count = ++p.count
    const current = ok(await post(p, body, count))
    assert.equal(items.getPlayerItemSync(p.id, 14003), 1); assert.equal(current.item_list[14003], 1)
    assert.equal(characters.getPlayerCharacterSync(p.id, 111015).stack, 2)
    assert.deepEqual(state(p).players_receive_history, beforeState.players_receive_history)
    assert.deepEqual(state(p).players_mails, beforeState.players_mails)
    assert.deepEqual(claimReceipts(p), rows.map(row => ({ ...row, response_json: JSON.stringify(legacy) })))
    assertMetadata(current, [])
    const committed = state(p)
    assert.deepEqual(ok(await post(p, { ...body, retry_count: 1 }, count)), current)
    assert.deepEqual(state(p), committed)
})

test('failure after native response receipt rolls marks, EX grants, history and both receipt forms back', async () => {
    const p = fixture(), id = characterMail(p, 111015, 3)
    const body = { mail_ids: [id], request_id: randomUUID() }, count = ++p.count, beforeState = state(p)
    let injected = false, inside
    receipts.recordGameplayMutationResponseSync = (...args) => {
        originalRecord(...args); injected = true; inside = state(p)
        throw Error('injected after mail EX response receipt')
    }
    try { assert.equal((await post(p, body, count)).statusCode, 500) }
    finally { receipts.recordGameplayMutationResponseSync = originalRecord }
    assert.equal(injected, true)
    assert.equal(inside.players_receive_history.length, 1)
    assert.equal(inside.player_operation_receipts.filter(row => row.operation === 'mail_claim').length, 1)
    assert.equal(inside.player_operation_receipts.filter(row => row.operation === 'gameplay_mutation.v1').length, 1)
    assert.deepEqual(state(p), beforeState)
    const retried = ok(await post(p, body, count))
    assert.equal(items.getPlayerItemSync(p.id, 14003), 13)
    assert.equal(state(p).players_receive_history.length, 1)
    assertMetadata(retried, [metadata(id, 14003, 6)])
})
}
