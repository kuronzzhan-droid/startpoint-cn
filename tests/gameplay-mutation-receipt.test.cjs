'use strict'
const compiled = process.env.STARPOINT_TEST_COMPILED === '1'
if (!compiled) require('ts-node/register/transpile-only')
const load = name => require(`../${compiled ? 'out' : 'src'}/${name}`)
const { test, before, after } = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { randomUUID } = require('node:crypto'), { spawnSync } = require('node:child_process')
const root = path.resolve(os.tmpdir()), directory = fs.mkdtempSync(path.join(root, 'mutation-receipts-'))
Object.assign(process.env, { DATA_DIR: directory, GACHA_SEED_DIR: path.join(directory, 'seeds'),
    CN_WRITER_THREAD: '0', GAME_VERBOSE_LOGS: 'false', GAME_ROUTINE_LOGS: 'off' })
fs.mkdirSync(process.env.GACHA_SEED_DIR)
const players = load('data/domains/player'), items = load('data/domains/item')
const identities = load('lib/gameplay-request-identity'), receipts = load('lib/gameplay-mutation-receipt')
const saves = load('data/snapshots/player-snapshot'), coordinator = load('lib/persistence-coordinator')
let db
function login(p) {
    p.token = db.transaction(() => identities.issueGameplayLoginTokenSync(db, {
        accountId: p.accountId, viewerId: p.viewer, udid: `receipt-${p.viewer}`, expiresAt: Date.now() + 86400000,
    }))()
    return p
}
function fixture() {
    const account = load('data/domains/account').insertAccountSync({ appId: 'wf_cn', idpAlias: '', idpCode: 'receipt-test', idpId: randomUUID(), status: 'normal' })
    const player = players.insertDefaultPlayerSync(account.id), viewer = 870000000 + player.id
    db.prepare('INSERT INTO sessions(token,account_id,expires,type) VALUES(?,?,?,2)').run(String(viewer), account.id, '2099-01-01T00:00:00Z')
    return login({ id: player.id, accountId: account.id, viewer })
}
const context = (p, count = 1) => ({ headerToken: p.token, body: { viewer_id: p.viewer, api_count: count }, accountId: p.accountId })
const read = (p, count = 1, operation = 'fixture.grant', payload = { amount: 1, itemId: 999012 }) =>
    receipts.readGameplayMutationRequestSync(p.id, context(p, count), operation, payload)
async function grant(p, count = 1) {
    return coordinator.runPersistenceTransaction({ domain: 'player', playerId: p.id, operation: 'receipt_fixture' }, () => {
        const request = read(p, count)
        if (!request) return null
        if (request.response) return request.response
        items.givePlayerItemSync(p.id, 999012, 1)
        const response = { item_list: { '999012': items.getPlayerItemSync(p.id, 999012) }, result: [1, 'complete'] }
        receipts.recordGameplayMutationResponseSync(p.id, request, response)
        return response
    })
}
const amount = p => items.getPlayerItemSync(p.id, 999012) ?? 0
const rows = p => db.prepare("SELECT * FROM player_operation_receipts WHERE player_id=? AND operation='gameplay_mutation.v1' ORDER BY request_key").all(p.id)
before(() => {
    load('data').initializeDatabase(); db = load('data/db').getDb()
    identities.initializeGameplayRequestIdentitySchemaSync(db)
    assert.equal(path.dirname(fs.realpathSync(db.name)), fs.realpathSync(directory))
})
after(async () => {
    await load('lib/seed-validator').default.close()
    if (db?.open) db.close()
    assert.equal(path.dirname(directory), root)
    fs.rmSync(directory, { recursive: true })
})

test('overlapping copies commit once, replay exact response, and a new count executes normally', async () => {
    const p = fixture()
    const responses = await Promise.all([grant(p), grant(p), grant(p)])
    assert.deepEqual(responses[0], responses[1]); assert.deepEqual(responses[1], responses[2])
    assert.equal(amount(p), 1); assert.equal(rows(p).length, 1)
    assert.deepEqual(await grant(p, 2), { item_list: { '999012': 2 }, result: [1, 'complete'] })
    assert.equal(amount(p), 2); assert.equal(rows(p).length, 2)
})

test('same identity cannot change route or payload; JSON key order is immaterial', async () => {
    const p = fixture(), expected = await grant(p)
    db.transaction(() => {
        assert.equal(read(p, 1, 'fixture.other'), null)
        assert.equal(read(p, 1, 'fixture.grant', { itemId: 999012, amount: 2 }), null)
        assert.deepEqual(read(p, 1, 'fixture.grant', { itemId: 999012, amount: 1 }).response, expected)
        const other = fixture()
        assert.equal(receipts.readGameplayMutationRequestSync(other.id, context(p), 'fixture.grant', {}), null)
    })()
    assert.equal(amount(p), 1)
})

test('new signup may restart count; superseded login only replays already committed requests', async () => {
    const p = fixture(), first = { ...p }, expected = await grant(p)
    login(p)
    assert.deepEqual(await grant(first), expected)
    assert.equal(await grant(first, 2), null)
    assert.ok(await grant(p)); assert.equal(amount(p), 2)
    assert.equal(rows(p).length, 2)
    for (const token of [undefined, '', 'a'.repeat(64)]) db.transaction(() => {
        assert.equal(receipts.readGameplayMutationRequestSync(p.id, { ...context(p), headerToken: token }, 'fixture.grant', {}), null)
    })()
})

test('receipt insert failure rolls reward back; retry after removing the failure can succeed', async () => {
    const p = fixture()
    db.exec("CREATE TRIGGER fail_mutation_receipt BEFORE INSERT ON player_operation_receipts WHEN NEW.operation='gameplay_mutation.v1' BEGIN SELECT RAISE(ABORT,'receipt failure'); END")
    try { await assert.rejects(grant(p), /receipt failure/) }
    finally { db.exec('DROP TRIGGER fail_mutation_receipt') }
    assert.equal(amount(p), 0); assert.equal(rows(p).length, 0)
    await grant(p); assert.equal(amount(p), 1)
})

test('receipt read requires a transaction and corrupt persisted responses fail without granting again', async () => {
    const p = fixture(); await grant(p)
    assert.throws(() => read(p), /transaction/)
    for (const corrupt of ['{}', 'null', 'false', '[]']) {
        db.prepare("UPDATE player_operation_receipts SET response_json=? WHERE player_id=?").run(corrupt, p.id)
        await assert.rejects(grant(p), /Invalid gameplay mutation receipt/)
        assert.equal(amount(p), 1)
    }
})

test('fresh process reads the durable response without another reward', async () => {
    const p = fixture(), expected = await grant(p)
    const script = `${compiled ? '' : "require('ts-node/register/transpile-only');"}
        const assert=require('node:assert/strict');
        const db=require('./${compiled ? 'out' : 'src'}/data/db').getDb();
        const result=db.transaction(()=>require('./${compiled ? 'out' : 'src'}/lib/gameplay-mutation-receipt')
            .readGameplayMutationRequestSync(${p.id},JSON.parse(process.env.TEST_RECEIPT_CONTEXT),'fixture.grant',{itemId:999012,amount:1}))();
        assert.deepEqual(result.response,JSON.parse(process.env.TEST_RECEIPT_RESPONSE));db.close();process.exit(0);`
    const child = spawnSync(process.execPath, ['-e', script], { cwd: path.resolve(__dirname, '..'),
        env: { ...process.env, TEST_RECEIPT_CONTEXT: JSON.stringify(context(p)), TEST_RECEIPT_RESPONSE: JSON.stringify(expected) }, encoding: 'utf8', timeout: 45000 })
    assert.equal(child.status, 0, child.stdout + child.stderr); assert.equal(amount(p), 1)
})

test('V1 and V2 imports preserve destination receipts without copying source authentication or receipts', async () => {
    const source = fixture(), target = fixture(), other = fixture()
    const expected = await grant(target); await grant(source); await grant(source, 2)
    const before = rows(target), otherBefore = players.getPlayerSync(other.id)
    const archive = saves.createPlayerSaveSnapshotV2Sync(source.id, db)
    assert.equal(archive.data.tables.player_operation_receipts, undefined)
    assert.equal(archive.data.tables.gameplay_login_sessions, undefined)
    saves.validatePlayerSaveSnapshotV2Sync(archive, db)
    saves.restorePlayerSaveSnapshotV2Sync(archive, target.id, {}, db)
    assert.deepEqual(rows(target), before); assert.equal(amount(target), 2)
    assert.equal(players.getAccountFromPlayerIdSync(target.id).id, target.accountId)
    assert.deepEqual(await grant(target), expected); assert.equal(amount(target), 2)
    const merged = load('data/utils/player-data').getMergedPlayerDataSync(target.id)
    players.replacePlayerDataSync(merged)
    assert.deepEqual(rows(target), before); assert.deepEqual(await grant(target), expected); assert.equal(amount(target), 2)
    assert.deepEqual(players.getPlayerSync(other.id), otherBefore)
    assert.deepEqual(db.pragma('foreign_key_check'), [])
    const invalid = structuredClone(archive); invalid.schemaFingerprint = '0'.repeat(64)
    assert.throws(() => saves.restorePlayerSaveSnapshotV2Sync(invalid, target.id, {}, db), /结构/)
    assert.equal(amount(target), 2); assert.deepEqual(rows(target), before)
})

test('failed V1 restore of preserved receipts rolls all target state back', async () => {
    const p = fixture(); await grant(p)
    const before = rows(p), playerBefore = players.getPlayerSync(p.id)
    db.exec("CREATE TRIGGER fail_preserve_mutation_receipt BEFORE INSERT ON player_operation_receipts WHEN NEW.operation='gameplay_mutation.v1' BEGIN SELECT RAISE(ABORT,'preserve receipt failure'); END")
    try {
        assert.throws(() => players.replacePlayerDataSync(load('data/utils/player-data').getMergedPlayerDataSync(p.id)), /preserve receipt failure/)
    } finally { db.exec('DROP TRIGGER fail_preserve_mutation_receipt') }
    assert.deepEqual(rows(p), before); assert.deepEqual(players.getPlayerSync(p.id), playerBefore)
    assert.equal(amount(p), 1); assert.deepEqual(db.pragma('foreign_key_check'), [])
})
