'use strict'
require('ts-node/register/transpile-only')
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { randomUUID } = require('node:crypto'), { spawnSync } = require('node:child_process')
const root = path.resolve(process.env.STARPOINT_TEST_TMP_ROOT || os.tmpdir())
fs.mkdirSync(root, { recursive: true })
const directory = fs.mkdtempSync(path.join(root, 'tutorial-town-'))
Object.assign(process.env, { DATA_DIR: directory, TMP: directory, TEMP: directory, SQLITE_TMPDIR: directory,
    GACHA_SEED_DIR: path.join(directory, 'seeds'), CN_WRITER_THREAD: '0', MULTI_REALTIME_PROCESS: '0',
    MULTI_REALTIME_OWNER_CHILD: '0', MULTI_BATTLE_RELAY_PROCESS: '0', GAME_VERBOSE_LOGS: 'false', GAME_ROUTINE_LOGS: 'off' })
fs.mkdirSync(process.env.GACHA_SEED_DIR)
const load = file => require('../src/' + file)
const players = load('data/domains/player'), characters = load('data/domains/character')
const items = load('data/domains/item'), quests = load('data/domains/quest')
const identities = load('lib/gameplay-request-identity'), saves = load('data/snapshots/player-snapshot')
const giftCharacter = 243001, ticket = 999012, gachaId = 1
let app, db
function fixture(step = 15, skip = false) {
    const account = load('data/domains/account').insertAccountSync({ appId: 'wf_cn', idpAlias: '',
        idpCode: 'tutorial-town-test', idpId: randomUUID(), status: 'normal' })
    const player = players.insertDefaultPlayerSync(account.id), viewer = 890000000 + player.id
    load('data/activeAccount').saveAccountDefaultPlayer(account.id, player.id)
    players.updatePlayerSync({ id: player.id, tutorialStep: step, tutorialSkipFlag: skip, freeVmoney: 10000 })
    db.prepare('INSERT INTO sessions(token,account_id,expires,type) VALUES(?,?,?,2)')
        .run(String(viewer), account.id, '2099-01-01T00:00:00Z')
    const nonce = db.transaction(() => identities.issueGameplayLoginTokenSync(db, { accountId: account.id,
        viewerId: viewer, udid: 'tutorial-town-' + viewer, expiresAt: Date.now() + 86400000 }))()
    return { id: player.id, accountId: account.id, viewer, nonce, count: 0 }
}
const post = (p, url, payload, count = ++p.count) => app.inject({ method: 'POST', url,
    headers: { login_token: p.nonce }, payload: { viewer_id: p.viewer, api_count: count, ...payload } })
const present = (p, skip = false, count) => post(p, '/tutorial/update_step', { step: skip ? 4 : 15, skip }, count)
const draw = (p, skip = false, count) => post(p, '/tutorial/update_step', { step: skip ? 3 : 14, skip, gacha_id: gachaId }, count)
const town = (p, id = 512001, count) => post(p, '/character/add_character_from_town', { character_id: id }, count)
function ok(response) { assert.equal(response.statusCode, 200, response.body); return response.json().data }
function cleared(p, questId) {
    quests.insertPlayerQuestProgressSync(p.id, 1, { questId, finished: true, clearRank: 5 })
}
function counts(p) {
    return { player: players.getPlayerSync(p.id),
        characters: db.prepare('SELECT * FROM players_characters WHERE player_id=? ORDER BY id').all(p.id),
        items: items.getPlayerItemsSync(p.id),
        history: db.prepare('SELECT * FROM players_receive_history WHERE player_id=? ORDER BY id').all(p.id),
        receipts: db.prepare('SELECT * FROM player_operation_receipts WHERE player_id=? ORDER BY operation,request_key').all(p.id),
        mails: db.prepare('SELECT * FROM players_mails WHERE player_id=? ORDER BY id').all(p.id) }
}
before(async () => {
    load('data').initializeDatabase()
    db = load('data/db').getDb()
    assert.equal(path.dirname(fs.realpathSync(db.name)), fs.realpathSync(directory))
    identities.initializeGameplayRequestIdentitySchemaSync(db)
    app = require('fastify')({ logger: false })
    app.addHook('onSend', (_request, reply, payload, done) => done(null,
        String(reply.getHeader('content-type')).startsWith('application/x-msgpack') && typeof payload === 'object'
            ? JSON.stringify(payload) : payload))
    await app.register(load('routes/api/tutorial').default, { prefix: '/tutorial' })
    await app.register(load('routes/api/character').default, { prefix: '/character' })
    await app.register(load('routes/api/gacha').default, { prefix: '/gacha' })
    await app.ready()
})
after(async () => {
    await app?.close()
    await require.cache[require.resolve('../src/lib/seed-validator')]?.exports.default?.close()
    if (db?.open) db.close()
    assert.equal(path.dirname(directory), root)
    if (process.env.STARPOINT_KEEP_TEST_DATA !== '1') fs.rmSync(directory, { recursive: true })
    else console.log('Synthetic tutorial/town database retained at ' + directory)
})

for (const skip of [false, true]) {
    test(`${skip ? 'shortened' : 'full'} Present grants the displayed character and ticket once across request identities`, async () => {
        const p = fixture(skip ? 4 : 15, skip), originalBalance = players.getPlayerSync(p.id).freeVmoney
        const first = ok(await present(p, skip, 1))
        assert.equal(first.item_list[ticket], 1)
        assert.equal(first.user_info.free_vmoney, originalBalance)
        assert.equal(first.mail_arrived, false)
        assert.deepEqual(ok(await present(p, skip, 1)), first)
        assert.equal(ok(await present(p, skip, 2)).item_list[ticket], 1)
        assert.equal(items.getPlayerItemSync(p.id, ticket), 1)
        assert.equal(characters.getPlayerCharacterSync(p.id, giftCharacter).stack, 0)
        assert.equal(players.getPlayerSync(p.id).freeVmoney, originalBalance)
        assert.equal(players.getPlayerSync(p.id).tutorialStep, skip ? 5 : 16)
        assert.equal(db.prepare('SELECT count(*) n FROM players_mails WHERE player_id=?').get(p.id).n, 0)
        const end = ok(await post(p, '/tutorial/update_step', { step: skip ? 5 : 16, skip }, 3))
        assert.equal(end.step, 17)
        assert.deepEqual(ok(await present(p, skip, 1)), first, 'the original response survives tutorial completion')
        items.setPlayerItemSync(p.id, ticket, 0)
        players.updatePlayerSync({ id: p.id, freeVmoney: 1234 })
        const current = ok(await present(p, skip, 4))
        assert.equal(current.step, 17, 'a new identity never returns the older tutorial progress')
        assert.equal(current.item_list[ticket], 0, 'an already spent ticket is not displayed as returned')
        assert.equal(current.user_info.free_vmoney, 1234)
        assert.equal(players.getPlayerSync(p.id).tutorialStep, skip ? 6 : 17)
    })

    test(`${skip ? 'shortened' : 'full'} tutorial draw debits and chooses once, and a failed receipt rolls everything back`, async () => {
        const p = fixture(skip ? 3 : 14, skip), before = counts(p)
        db.exec(`CREATE TRIGGER fail_tutorial_receipt BEFORE INSERT ON player_operation_receipts
            WHEN NEW.player_id=${p.id} AND NEW.operation='gameplay_mutation.v1'
            BEGIN SELECT RAISE(ABORT,'synthetic tutorial receipt failure'); END`)
        try {
            assert.equal((await draw(p, skip, 1)).statusCode, 500)
            assert.deepEqual(counts(p), before)
        } finally { db.exec('DROP TRIGGER fail_tutorial_receipt') }
        const first = ok(await draw(p, skip, 1)), id = first.gacha.draw[0].character_id
        assert.equal(first.gacha.draw[0].movie_id, 'normal_guarantee')
        assert.equal(first.gacha.draw[0].seed, 10007656)
        assert.equal(players.getPlayerSync(p.id).tutorialGachaCharacterId, id)
        assert.deepEqual(ok(await draw(p, skip, 1)), first)
        assert.deepEqual(ok(await draw(p, skip, 2)).gacha, first.gacha)
        assert.equal(players.getPlayerSync(p.id).freeVmoney, 10000 - load('lib/assets').getGachaSync(gachaId).singleCost)
        assert.equal(characters.getPlayerCharacterSync(p.id, id).stack, 0)
    })
}

test('Present rollback includes step, ticket, character, history, and both durable receipts', async () => {
    const p = fixture(), before = counts(p)
    db.exec(`CREATE TRIGGER fail_present_receipt BEFORE INSERT ON player_operation_receipts
        WHEN NEW.player_id=${p.id} AND NEW.operation='gameplay_mutation.v1'
        BEGIN SELECT RAISE(ABORT,'synthetic Present receipt failure'); END`)
    try {
        assert.equal((await present(p, false, 1)).statusCode, 500)
        assert.deepEqual(counts(p), before)
    } finally { db.exec('DROP TRIGGER fail_present_receipt') }
    ok(await present(p, false, 1))
    assert.equal(items.getPlayerItemSync(p.id, ticket), 1)
})

test('the actual tutorial ticket pays for a saved crazy-gacha group once, including selection after a new login', async () => {
    const operations = load('lib/content-operations').contentOperations()
    const review = { readiness: 'verified', evidence: 'Synthetic tutorial-ticket consumption integration', endsAtMs: null }
    operations.update('gacha:100', { expectedRevision: operations.revision(), catalogDigest: operations.digest,
        reason: 'Synthetic tutorial-ticket integration', actionOverrides: {
            visible: { ...review, enabled: true }, enter: { ...review, enabled: true }, claim: { ...review, enabled: true },
        } }, Date.now())
    const p = fixture(), balance = players.getPlayerSync(p.id).freeVmoney
    ok(await present(p))
    ok(await post(p, '/tutorial/update_step', { step: 16, skip: false }))
    assert.equal(items.getPlayerItemSync(p.id, ticket), 1)
    const historyBefore = db.prepare('SELECT count(*) n FROM players_receive_history WHERE player_id=? AND type=5').get(p.id).n
    const candidate = ok(await post(p, '/gacha/exec', { gacha_id: 100, payment_type: 3, type: 14, number_of_exec: 1 }))
    assert.equal(candidate.draw.length, 10)
    assert.equal(items.getPlayerItemSync(p.id, ticket), 0)
    assert.equal(db.prepare('SELECT count(*) n FROM players_receive_history WHERE player_id=? AND type=5').get(p.id).n, historyBefore,
        'candidate display does not grant the ten characters')
    ok(await post(p, '/gacha/crazy_gacha_save', { index: 1 }))
    const selected = ok(await post(p, '/gacha/crazy_gacha_select', { gacha_id: 100, index: 1 }))
    assert.equal(load('data/domains/crazy_gacha').getLatestCrazyGachaStateSync(p.id).state.status, 'finalized')
    assert.deepEqual(selected.crazy_gacha_result_list, { '0': [], '1': [], '2': [] })
    const grantedHistory = db.prepare('SELECT type_id FROM players_receive_history WHERE player_id=? AND type=5 ORDER BY id')
        .all(p.id).slice(historyBefore).map(row => row.type_id).sort((a, b) => a - b)
    assert.deepEqual(grantedHistory, candidate.draw.map(row => row.character_id).sort((a, b) => a - b))
    for (const row of candidate.draw) assert.ok(characters.getPlayerCharacterSync(p.id, row.character_id))
    assert.equal(db.prepare('SELECT total_gacha_character_count n FROM players_active_mission_counters WHERE player_id=?').get(p.id).n, 10)
    const rewards = () => ({ characters: counts(p).characters, items: counts(p).items, history: counts(p).history,
        counter: db.prepare('SELECT * FROM players_active_mission_counters WHERE player_id=?').all(p.id),
        gachaInfo: load('data/domains/gacha').getPlayerGachaInfoSync(p.id, 100) })
    const awarded = rewards()
    ok(await post(p, '/gacha/crazy_gacha_select', { gacha_id: 100, index: 1 }, p.count))
    p.nonce = db.transaction(() => identities.issueGameplayLoginTokenSync(db, { accountId: p.accountId,
        viewerId: p.viewer, udid: 'tutorial-town-' + p.viewer, expiresAt: Date.now() + 86400000 }))()
    p.count = 0
    ok(await post(p, '/gacha/crazy_gacha_select', { gacha_id: 100, index: 1 }))
    ok(await post(p, '/gacha/crazy_gacha_select', { gacha_id: 100, index: 1 }))
    assert.deepEqual(rewards(), awarded, 'the same request and a new login do not re-grant the selected ten')
    assert.equal((await post(p, '/gacha/exec', { gacha_id: 100, payment_type: 3, type: 14, number_of_exec: 1 })).statusCode, 400)
    assert.equal(ok(await present(p)).item_list[ticket], 0)
    assert.equal(players.getPlayerSync(p.id).freeVmoney, balance)
    assert.equal(items.getPlayerItemSync(p.id, ticket), 0)
    assert.deepEqual(rewards(), awarded)
})

test('legacy advanced/completed/quest-completed saves never receive a guessed full gift without a new marker', async () => {
    for (const [step, skip, finishedMain] of [[16, false, false], [17, false, false], [5, true, false], [6, true, false], [0, false, true]]) {
        const p = fixture(step, skip)
        if (finishedMain) cleared(p, 1008004)
        const before = counts(p)
        assert.equal((await present(p, skip, 1)).statusCode, 400)
        assert.deepEqual(counts(p), before)
    }
    const p = fixture(14)
    players.updatePlayerSync({ id: p.id, tutorialGachaCharacterId: 251001 })
    assert.equal((await draw(p, false, 1)).statusCode, 400)
    assert.equal(players.getPlayerSync(p.id).freeVmoney, 10000)
    const reset = fixture(15)
    load('lib/character').givePlayerCharacterSync(reset.id, giftCharacter)
    const resetBefore = counts(reset)
    assert.equal((await present(reset, false, 1)).statusCode, 400,
        'an old awarded character with rewound tutorial fields is not proof a new ticket is due')
    assert.deepEqual(counts(reset), resetBefore)
})

test('invalid tutorial input or a reused identity with different content does not advance or grant', async () => {
    const p = fixture(14), before = counts(p)
    for (const payload of [{ step: 14, skip: false, gacha_id: 999999999 }, { step: 14, skip: false },
        { step: -1, skip: false }, { step: 1.5, skip: false }, { step: 15, skip: 'false' }]) {
        assert.equal((await post(p, '/tutorial/update_step', payload, 1)).statusCode, 400)
        assert.deepEqual(counts(p), before)
    }
    ok(await draw(p, false, 1))
    const committed = counts(p)
    assert.equal((await present(p, false, 1)).statusCode, 400)
    assert.deepEqual(counts(p), committed)
})

test('town joins require the real cleared quest, grant only missing characters, and allow quest-join legacy recovery', async () => {
    const p = fixture(17), before = counts(p)
    assert.equal((await town(p, 512001, 1)).statusCode, 400)
    assert.equal((await town(p, 111001, 1)).statusCode, 400)
    assert.deepEqual(counts(p), before)
    cleared(p, 1008004)
    const first = ok(await town(p, 512001, 1))
    assert.deepEqual(ok(await town(p, 512001, 1)), first)
    ok(await town(p, 512001, 2))
    assert.equal(characters.getPlayerCharacterSync(p.id, 512001).stack, 0)
    const q = fixture(17)
    cleared(q, 2009007)
    ok(await town(q, 10, 1))
    ok(await town(q, 10, 2))
    assert.equal(characters.getPlayerCharacterSync(q.id, 10).stack, 0, 'quest-type rows still permit missing old-save joins')
})

test('town late receipt failure rolls character and mission changes back before retry', async () => {
    const p = fixture(17)
    cleared(p, 1008004)
    const before = saves.createPlayerSaveSnapshotV2Sync(p.id)
    db.exec(`CREATE TRIGGER fail_town_receipt BEFORE INSERT ON player_operation_receipts
        WHEN NEW.player_id=${p.id} BEGIN SELECT RAISE(ABORT,'synthetic town receipt failure'); END`)
    try {
        assert.equal((await town(p, 512001, 1)).statusCode, 500)
        assert.deepEqual(saves.createPlayerSaveSnapshotV2Sync(p.id).data.tables, before.data.tables)
    } finally { db.exec('DROP TRIGGER fail_town_receipt') }
    ok(await town(p, 512001, 1))
    assert.equal(characters.getPlayerCharacterSync(p.id, 512001).stack, 0)
})

test('portable V2 progress and ownership still protect an imported save with history and source receipts omitted', async () => {
    const source = fixture()
    ok(await present(source, false, 1))
    cleared(source, 1008004)
    ok(await town(source, 512001, 2))
    const archive = saves.createPlayerSaveSnapshotV2Sync(source.id), target = fixture(0)
    saves.restorePlayerSaveSnapshotV2Sync(archive, target.id, { includeArchiveHistory: false })
    assert.equal(db.prepare('SELECT count(*) n FROM player_operation_receipts WHERE player_id=?').get(target.id).n, 0)
    assert.equal((await present(target, false, 1)).statusCode, 400)
    ok(await town(target, 512001, 2))
    assert.equal(items.getPlayerItemSync(target.id, ticket), 1)
    assert.equal(characters.getPlayerCharacterSync(target.id, 512001).stack, 0)
})

test('V1 replacement preserves destination business and protocol receipts alongside tutorial progress', async () => {
    const p = fixture(), first = ok(await present(p, false, 1))
    const merged = load('data/utils/player-data').getMergedPlayerDataSync(p.id)
    players.replacePlayerDataSync(merged)
    assert.deepEqual(ok(await present(p, false, 1)), first)
    assert.equal(ok(await present(p, false, 2)).item_list[ticket], 1)
    assert.equal(items.getPlayerItemSync(p.id, ticket), 1)
})

test('a new process replays a committed Present response without a second grant', async () => {
    const p = fixture(), first = ok(await present(p, false, 1))
    const child = spawnSync(process.execPath, ['-r', 'ts-node/register/transpile-only', '-e', `
        const assert=require('node:assert/strict');
        (async()=>{const app=require('fastify')({logger:false});
        app.addHook('onSend',(_q,r,p,d)=>d(null,typeof p==='object'?JSON.stringify(p):p));
        await app.register(require('./src/routes/api/tutorial').default,{prefix:'/tutorial'});
        const response=await app.inject({method:'POST',url:'/tutorial/update_step',headers:{login_token:process.env.REPLAY_NONCE},
            payload:JSON.parse(process.env.REPLAY_BODY)});
        assert.equal(response.statusCode,200,response.body);
        assert.deepEqual(response.json().data,JSON.parse(process.env.REPLAY_EXPECTED));
        assert.equal(require('./src/data/domains/item').getPlayerItemSync(${p.id},${ticket}),1);
        await app.close();require('./src/data/db').getDb().close();process.exit(0)
        })().catch(e=>{console.error(e);process.exit(1)});`],
        { cwd: path.resolve(__dirname, '..'), env: { ...process.env, REPLAY_NONCE: p.nonce,
            REPLAY_BODY: JSON.stringify({ viewer_id: p.viewer, api_count: 1, step: 15, skip: false }),
            REPLAY_EXPECTED: JSON.stringify(first) }, encoding: 'utf8', timeout: 45000 })
    assert.equal(child.status, 0, child.stderr || child.stdout)
    assert.equal(items.getPlayerItemSync(p.id, ticket), 1)
})
