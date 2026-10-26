'use strict'
const compiled = process.env.STARPOINT_TEST_COMPILED === '1'
if (!compiled) require('ts-node/register/transpile-only')
const load = name => require(`../${compiled ? 'out' : 'src'}/${name}`)
const { test, before, after } = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), { randomUUID, createHash } = require('node:crypto')
const { spawnSync } = require('node:child_process')
const root = path.resolve(process.env.STARPOINT_TEST_TMP_ROOT || os.tmpdir())
fs.mkdirSync(root, { recursive: true })
const directory = fs.mkdtempSync(path.join(root, 'history-crazy-gacha-'))
Object.assign(process.env, { DATA_DIR: directory, TEMP: directory, TMP: directory, SQLITE_TMPDIR: directory,
    GACHA_SEED_DIR: path.join(directory, 'seeds'), CN_WRITER_THREAD: '0', GAME_VERBOSE_LOGS: 'false', GAME_ROUTINE_LOGS: 'off' })
fs.mkdirSync(process.env.GACHA_SEED_DIR)
const players = load('data/domains/player'), inventory = load('data/domains/item'), gachas = load('data/domains/gacha')
const crazy = load('data/domains/crazy_gacha'), assets = load('lib/assets'), operations = load('lib/content-operations')
const coordinator = load('lib/persistence-coordinator'), originalTransaction = coordinator.runPersistenceTransaction
const saves = load('data/snapshots/player-snapshot'), storage = load('lib/storage-layout')
const rules = load('lib/crazy-gacha'), personal = load('lib/gacha-rules')
const identities = load('lib/gameplay-request-identity')
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const clone = value => JSON.parse(JSON.stringify(value))
let db, app
function login(p) {
    p.nonce = db.transaction(() => identities.issueGameplayLoginTokenSync(db, {
        accountId: p.accountId, viewerId: p.viewer, udid: 'crazy-test-' + p.viewer, expiresAt: Date.now() + 86400000,
    }))()
    p.apiCount = 0
    return p
}
function fixture(tickets = 0) {
    const account = load('data/domains/account').insertAccountSync({ appId: 'wf_cn', idpAlias: '', idpCode: 'crazy-http', idpId: randomUUID(), status: 'normal' })
    const player = players.insertDefaultPlayerSync(account.id), viewer = 880000000 + player.id
    load('data/activeAccount').saveAccountDefaultPlayer(account.id, player.id)
    db.prepare('INSERT INTO sessions(token,account_id,expires,type) VALUES(?,?,?,2)').run(String(viewer), account.id, '2099-01-01T00:00:00Z')
    players.updatePlayerSync({ id: player.id, freeVmoney: 10000, vmoney: 5000 })
    if (tickets) inventory.givePlayerItemSync(player.id, 999012, tickets)
    return login({ id: player.id, viewer, accountId: account.id })
}
function control(enter = true, claim = true) {
    const store = operations.contentOperations(), review = { readiness: 'verified', evidence: 'Native crazy ticket protocol and synthetic HTTP regression', endsAtMs: null }
    store.update('gacha:100', { expectedRevision: store.revision(), catalogDigest: store.digest, reason: 'Synthetic crazy gacha regression',
        actionOverrides: { visible: { ...review, enabled: true }, enter: { ...review, enabled: enter }, claim: { ...review, enabled: claim } } }, Date.now())
}
const post = (p, route, body = {}, nonce = p.nonce) => app.inject({ method: 'POST', url: '/gacha/' + route,
    headers: nonce ? { login_token: nonce } : {}, payload: { viewer_id: p.viewer, api_count: ++p.apiCount, ...body } })
const draw = (p, extra = {}, nonce = p.nonce) => post(p, 'exec', { gacha_id: 100, payment_type: 3, type: 14, number_of_exec: 1, ...extra }, nonce)
const save = (p, index, extra = {}, nonce = p.nonce) => post(p, 'crazy_gacha_save', { index, ...extra }, nonce)
const select = (p, index, extra = {}, nonce = p.nonce) => post(p, 'crazy_gacha_select', { gacha_id: 100, index, ...extra }, nonce)
function response(result) { assert.equal(result.statusCode, 200, result.body); return result.json().data }
const tickets = p => inventory.getPlayerItemSync(p.id, 999012) ?? 0
const current = p => crazy.getLatestCrazyGachaStateSync(p.id)
function awards(p) {
    return {
        characters: db.prepare('SELECT * FROM players_characters WHERE player_id=? ORDER BY id').all(p.id),
        inventory: db.prepare('SELECT * FROM players_items WHERE player_id=? AND id<>999012 ORDER BY id').all(p.id),
        history: db.prepare('SELECT * FROM players_receive_history WHERE player_id=? ORDER BY id').all(p.id),
        counter: db.prepare('SELECT * FROM players_active_mission_counters WHERE player_id=?').all(p.id),
        info: db.prepare('SELECT * FROM players_gacha_info WHERE player_id=?').all(p.id),
    }
}
function counter(p) { return db.prepare('SELECT total_gacha_character_count n FROM players_active_mission_counters WHERE player_id=?').get(p.id)?.n ?? 0 }
function wire(value) {
    assert.equal(value.draw.length, 10); assert.equal(value.character_list.length, 0)
    for (const record of value.draw) {
        assert.ok(Number.isSafeInteger(record.character_id)); assert.ok(Number.isSafeInteger(record.seed))
        assert.equal(typeof record.movie_id, 'string'); assert.equal(record.entry_count, 1); assert.equal(record.ex_boost_item, null)
    }
    assert.deepEqual(value.crazy_gacha_result_list['0'], value.draw.map(row => row.character_id))
}
function fingerprint(archive) {
    const schema = saves.PLAYER_SNAPSHOT_V2_TABLES.filter(table => archive.data.tables[table]).map(table => {
        const info = storage.getStorageSnapshotTableInfo(db, table) || db.prepare(`PRAGMA table_info("${table}")`).all()
        return { table, columns: archive.data.tables[table].columns.map(name => {
            const col = info.find(column => column.name === name)
            return { name: col.name, type: col.type, notnull: col.notnull, defaultValue: col.dflt_value, pk: col.pk }
        }) }
    })
    return createHash('sha256').update(JSON.stringify(schema)).digest('hex')
}
function updateArchive(archive) {
    archive.summary.includedTableCount = Object.keys(archive.data.tables).length
    archive.summary.rowCount = Object.values(archive.data.tables).reduce((total, table) => total + table.rows.length, 0)
    archive.schemaFingerprint = fingerprint(archive)
    return archive
}
before(async () => {
    load('data').initializeDatabase(); db = load('data/db').getDb()
    identities.initializeGameplayRequestIdentitySchemaSync(db)
    assert.equal(path.dirname(fs.realpathSync(db.name)), fs.realpathSync(directory))
    app = require('fastify')({ logger: false })
    app.addHook('onSend', (_request, reply, body, done) => done(null,
        String(reply.getHeader('content-type')).startsWith('application/x-msgpack') && typeof body === 'object' ? JSON.stringify(body) : body))
    await app.register(load('routes/api/gacha').default, { prefix: '/gacha' })
    await app.register(load('routes/cn/load').default, { prefix: '/cn' })
    await app.ready()
})
after(async () => {
    coordinator.runPersistenceTransaction = originalTransaction
    if (app) await app.close()
    await load('lib/seed-validator').default.close()
    if (db?.open) db.close()
    assert.equal(path.dirname(directory), root); fs.rmSync(directory, { recursive: true })
})

test('only exact native crazy request and the real ticket admit a session; invalid/unauthenticated calls do not write', async () => {
    control()
    const p = fixture(), initial = awards(p)
    assert.equal((await draw(p)).statusCode, 400)
    inventory.givePlayerItemSync(p.id, 999008, 20)
    assert.equal((await draw(p)).statusCode, 400, 'wildcard/other tickets cannot qualify')
    assert.equal(current(p), null)
    inventory.givePlayerItemSync(p.id, 999012, 1)
    const before = digest({ awards: awards(p), tickets: tickets(p) })
    for (const wrong of [{ type: 4 }, { payment_type: 1 }, { number_of_exec: 2 }, { type: '14' }, { payment_type: 4 }]) assert.equal((await draw(p, wrong)).statusCode, 400)
    for (const index of [-1, 0, 3, '1', null]) assert.equal((await save(p, index)).statusCode, 400)
    for (const index of [-1, 3, '0', null]) assert.equal((await select(p, index)).statusCode, 400)
    assert.equal((await post(p, 'crazy_gacha_select', { gacha_id: 101, index: 0 })).statusCode, 400)
    assert.equal((await select(p, 1)).statusCode, 400)
    assert.equal((await draw({ ...p, viewer: 12345 })).statusCode, 400)
    assert.equal(digest({ awards: awards(p), tickets: tickets(p) }), before)
    assert.equal(current(p), null)
    assert.equal(rules.isCrazyGachaExecRequest(100, 3, 14, 1), true)
    assert.equal(rules.isCrazyGachaExecRequest(100, 3, 4, 1), false)
    assert.equal(initial.characters.length, awards(p).characters.length)
})

test('first candidate costs one ticket, rerolls/save cost zero, two immutable slots grant exactly one selected group', async () => {
    control()
    const p = fixture(1), unchanged = awards(p), countBefore = counter(p)
    const first = response(await draw(p)); wire(first)
    assert.equal(tickets(p), 0); assert.equal(first.gacha_info_list[0].crazy_draw_count, 1)
    assert.equal(current(p).state.maxDrawCount, 999, 'adopted config999 is preserved separately from original text50')
    assert.equal(current(p).state.latest.metadata[9].isGuarantee, true)
    assert.ok(assets.getCharacterDataSync(first.draw[9].character_id).rarity >= 4)
    assert.deepEqual(awards(p), unchanged)
    response(await save(p, 1))
    const saved = digest(current(p))
    assert.equal((await save(p, 1)).statusCode, 400)
    assert.equal(digest(current(p)), saved)
    assert.equal((await select(p, 2)).statusCode, 400, 'future/empty backup cannot be selected')
    const second = response(await draw(p)); wire(second)
    response(await save(p, 2))
    const third = response(await draw(p)); wire(third)
    assert.equal(third.gacha_info_list[0].crazy_draw_count, 3)
    assert.deepEqual(third.crazy_gacha_result_list['1'], first.draw.map(row => row.character_id))
    assert.deepEqual(third.crazy_gacha_result_list['2'], second.draw.map(row => row.character_id))
    assert.deepEqual(awards(p), unchanged); assert.equal(tickets(p), 0)
    const granted = response(await select(p, 1))
    assert.deepEqual(granted.crazy_gacha_result_list, { '0': [], '1': [], '2': [] })
    assert.deepEqual(granted.last_crazy_gacha_draw_result, [])
    assert.equal(current(p).state.status, 'finalized')
    assert.equal(gachas.getPlayerGachaInfoSync(p.id, 100).gachaExchangePoint, 10)
    assert.equal(counter(p) - countBefore, 10)
    const history = db.prepare('SELECT type_id FROM players_receive_history WHERE player_id=? AND type=5').all(p.id).map(row => row.type_id).sort((a, b) => a - b)
    assert.deepEqual(history, first.draw.map(row => row.character_id).sort((a, b) => a - b))
    const after = digest(awards(p))
    response(await select(p, 1)); assert.equal((await select(p, 0)).statusCode, 400)
    assert.equal(digest(awards(p)), after)
    const paid = current(p), forbidden = clone(paid.state)
    forbidden.status = 'pending'; delete forbidden.selectedIndex
    assert.throws(() => crazy.writeCrazyGachaStateSync(p.id, paid.sessionNumber, forbidden), /immutable/)
    assert.deepEqual(current(p), paid)
    assert.equal((await draw(p)).statusCode, 400, 'a finalized flow does not grant another admission')
    inventory.givePlayerItemSync(p.id, 999012, 1)
    response(await draw(p))
    assert.equal(current(p).sessionNumber, 2); assert.equal(current(p).state.drawCount, 1)
    assert.equal(db.prepare('SELECT count(*) n FROM players_crazy_gacha WHERE player_id=?').get(p.id).n, 2)
    assert.equal(JSON.parse(db.prepare('SELECT state_json FROM players_crazy_gacha WHERE player_id=? AND session_number=1').get(p.id).state_json).status, 'finalized')
    assert.equal(digest(awards(p)), after)
})

test('closing entry retains paid reroll/save/select rights; claim closure and queued closure recheck before writes', async () => {
    const p = fixture(2); control()
    response(await draw(p)); control(false, true)
    const outsider = fixture(1), untouched = digest({ awards: awards(outsider), ticket: tickets(outsider) })
    assert.equal((await draw(outsider)).statusCode, 400)
    assert.equal(digest({ awards: awards(outsider), ticket: tickets(outsider) }), untouched)
    response(await draw(p)); response(await save(p, 2)); assert.equal(tickets(p), 1)
    control(false, false)
    const frozen = digest(current(p))
    assert.equal((await draw(p)).statusCode, 400); assert.equal((await save(p, 1)).statusCode, 400); assert.equal((await select(p, 2)).statusCode, 400)
    assert.equal(digest(current(p)), frozen)
    control(false, true); response(await select(p, 2))
    assert.equal((await draw(p)).statusCode, 400)
    control()
    let queued = false
    coordinator.runPersistenceTransaction = (context, callback, options) => {
        if (!queued && context.operation === 'crazy_draw') { queued = true; control(false, true) }
        return originalTransaction(context, callback, options)
    }
    assert.equal((await draw(p)).statusCode, 400)
    coordinator.runPersistenceTransaction = originalTransaction
    assert.equal(queued, true); assert.equal(tickets(p), 1)
})

test('the persisted candidate bound survives closure/reopen and stops at the adopted max without another charge', async () => {
    control(); const p = fixture(1); response(await draw(p))
    const row = current(p); row.state.drawCount = row.state.maxDrawCount - 1
    crazy.writeCrazyGachaStateSync(p.id, row.sessionNumber, row.state)
    const last = response(await draw(p)); assert.equal(last.gacha_info_list[0].crazy_draw_count, 999)
    const frozen = digest(current(p)); control(false); control(true)
    assert.equal((await draw(p)).statusCode, 400)
    assert.equal(digest(current(p)), frozen); assert.equal(tickets(p), 0)
    response(await select(p, 0))
})

test('actual CN load and a fresh process recover the same pending draw/slots/count without recharging or redrawing', async () => {
    control(); const p = fixture(1), first = response(await draw(p)); response(await save(p, 1)); response(await draw(p)); control(false)
    const recovery = crazy.getCrazyGachaRecoverySync(p.id), saved = digest(current(p))
    const loaded = await app.inject({ method: 'POST', url: '/cn/load', payload: { viewer_id: p.viewer, api_count: 1 } })
    const data = response(loaded)
    assert.deepEqual(data.crazy_gacha_result_list, recovery.crazy_gacha_result_list)
    assert.deepEqual(data.last_crazy_gacha_draw_result, recovery.last_crazy_gacha_draw_result)
    assert.equal(data.gacha_info_list.find(row => row.gacha_id === 100).crazy_draw_count, 2)
    const script = `if(process.env.STARPOINT_TEST_COMPILED!=='1')require('ts-node/register/transpile-only');
        const load=n=>require('./'+(process.env.STARPOINT_TEST_COMPILED==='1'?'out':'src')+'/'+n);
        (async()=>{load('data').initializeDatabase();const app=require('fastify')({logger:false});
        app.addHook('onSend',(_q,r,b,d)=>d(null,String(r.getHeader('content-type')).startsWith('application/x-msgpack')&&typeof b==='object'?JSON.stringify(b):b));
        await app.register(load('routes/cn/load').default,{prefix:'/cn'});await app.ready();
        const r=await app.inject({method:'POST',url:'/cn/load',payload:{viewer_id:Number(process.argv[1]),api_count:1}});
        if(r.statusCode!==200)throw Error(r.body);const d=r.json().data;
        process.stdout.write('CRAZY_RECOVERY='+JSON.stringify({slots:d.crazy_gacha_result_list,draw:d.last_crazy_gacha_draw_result,info:d.gacha_info_list.find(x=>x.gacha_id===100)})+'\\n');
        await app.close();await load('lib/seed-validator').default.close();load('data/db').getDb().close()})().catch(e=>{process.stderr.write(e.stack);process.exitCode=1})`
    const child = spawnSync(process.execPath, ['-e', script, String(p.viewer)], { cwd: path.resolve(__dirname, '..'), env: process.env, encoding: 'utf8', timeout: 60000 })
    assert.equal(child.status, 0, child.stderr + child.stdout)
    const line = child.stdout.split(/\r?\n/).find(line => line.startsWith('CRAZY_RECOVERY='))
    assert.ok(line)
    const fresh = JSON.parse(line.slice('CRAZY_RECOVERY='.length))
    assert.deepEqual(fresh.slots, recovery.crazy_gacha_result_list); assert.deepEqual(fresh.draw, recovery.last_crazy_gacha_draw_result)
    assert.equal(fresh.info.crazy_draw_count, 2)
    assert.deepEqual(fresh.slots['1'], first.draw.map(row => row.character_id))
    assert.equal(digest(current(p)), saved); assert.equal(tickets(p), 0)
    response(await select(p, 1))
})

test('ticket reservation, immutable-slot writes and all final awards roll back on real SQLite failures', async () => {
    control(); const p = fixture(1)
    const trigger = sql => db.exec(sql)
    trigger(`CREATE TRIGGER fail_crazy_admission BEFORE INSERT ON players_crazy_gacha BEGIN SELECT RAISE(ABORT,'synthetic admission failure'); END`)
    assert.equal((await draw(p)).statusCode, 500); assert.equal(tickets(p), 1); assert.equal(current(p), null)
    db.exec('DROP TRIGGER fail_crazy_admission')
    response(await draw(p)); const beforeSave = digest(current(p))
    trigger(`CREATE TRIGGER fail_crazy_save BEFORE UPDATE ON players_crazy_gacha BEGIN SELECT RAISE(ABORT,'synthetic save failure'); END`)
    assert.equal((await save(p, 1)).statusCode, 500); assert.equal(digest(current(p)), beforeSave)
    db.exec('DROP TRIGGER fail_crazy_save')
    response(await save(p, 1)); const beforeAward = digest({ awards: awards(p), state: current(p) })
    trigger(`CREATE TRIGGER fail_crazy_finish BEFORE UPDATE ON players_crazy_gacha WHEN json_extract(NEW.state_json,'$.status')='finalized' BEGIN SELECT RAISE(ABORT,'synthetic final failure'); END`)
    assert.equal((await select(p, 1)).statusCode, 500)
    assert.equal(digest({ awards: awards(p), state: current(p) }), beforeAward)
    db.exec('DROP TRIGGER fail_crazy_finish')
    await Promise.all([select(p, 1), select(p, 1)]).then(results => results.forEach(response))
    assert.equal(counter(p), 10); assert.equal(current(p).state.status, 'finalized')
    assert.equal(db.prepare('SELECT count(*) n FROM players_receive_history WHERE player_id=? AND type=5').get(p.id).n, 10)
})

test('old schema profiles including the business additions remain exact with no new entitlement, including original54', () => {
    const source = fixture(), target = fixture(), sourceArchive = saves.createPlayerSaveSnapshotV2Sync(source.id, db)
    assert.equal(sourceArchive.summary.includedTableCount, 61)
    for (const oldBusiness of [false, true]) for (const oldCrazy of [false, true]) for (const oldEconomy of [false, true]) for (const oldTower of [false, true]) {
        const archive = clone(sourceArchive)
        if (oldBusiness) for (const table of ['players_ex_boost_pending_draws', 'players_shop_campaign_lineups', 'players_bond_token_exchanges']) delete archive.data.tables[table]
        if (oldCrazy) delete archive.data.tables.players_crazy_gacha
        if (oldEconomy) for (const table of ['players_shop_quotas', 'players_exchange_campaign_receipts', 'players_special_exchange_campaigns']) delete archive.data.tables[table]
        if (oldTower) {
            const table = archive.data.tables.players_rush_events, index = table.columns.indexOf('tower_revision')
            table.columns.splice(index, 1); table.rows.forEach(row => row.splice(index, 1))
        }
        updateArchive(archive)
        assert.equal(archive.summary.includedTableCount, 61 - (oldBusiness ? 3 : 0) - (oldEconomy ? 3 : 0) - (oldCrazy ? 1 : 0))
        saves.validatePlayerSaveSnapshotV2Sync(archive, db)
        saves.restorePlayerSaveSnapshotV2Sync(archive, target.id, {}, db)
        assert.equal(current(target), null); assert.equal(tickets(target), 0)
        assert.equal(db.prepare('SELECT account_id FROM players WHERE id=?').get(target.id).account_id, target.accountId)
        const wrong = clone(archive); wrong.schemaFingerprint = '0'.repeat(64)
        assert.throws(() => saves.validatePlayerSaveSnapshotV2Sync(wrong, db), /结构/)
    }
})

test('new snapshot round-trips paid candidates and finalized business markers, retaining target account and one final award', async () => {
    control(); const source = fixture(1), target = fixture(), other = fixture()
    response(await draw(source)); response(await save(source, 2)); response(await draw(source))
    const archive = saves.createPlayerSaveSnapshotV2Sync(source.id, db), sourceJson = JSON.stringify(archive)
    const otherBefore = digest(awards(other))
    saves.restorePlayerSaveSnapshotV2Sync(archive, target.id, {}, db)
    assert.deepEqual(current(target), current(source)); assert.equal(tickets(target), 0)
    assert.equal(db.prepare('SELECT account_id FROM players WHERE id=?').get(target.id).account_id, target.accountId)
    control(false); response(await select(target, 2)); const after = digest(awards(target))
    const finalArchive = saves.createPlayerSaveSnapshotV2Sync(target.id, db), restored = fixture()
    saves.restorePlayerSaveSnapshotV2Sync(finalArchive, restored.id, {}, db)
    assert.equal(current(restored).state.status, 'finalized')
    const frozen = digest(awards(restored)); response(await select(restored, 2)); assert.equal(digest(awards(restored)), frozen)
    assert.equal(digest(awards(target)), after); assert.equal(digest(awards(other)), otherBefore)
    assert.equal(JSON.stringify(archive), sourceJson)
    const forged = clone(archive), table = forged.data.tables.players_crazy_gacha
    table.rows[0][table.columns.indexOf('state_json')] = '{}'
    assert.throws(() => saves.validatePlayerSaveSnapshotV2Sync(forged, db), /crazy/)
})

test('all ten personal pools reject fabricated draws without spending, while original points remain exchangeable', async () => {
    const p = fixture(), ids = [700000,700001,700002,700003,700004,80000,80001,80002,80003,80004]
    for (const id of ids) {
        assert.equal(personal.isDeferredPersonalPeriodGacha(id), true)
        gachas.insertPlayerGachaInfoSync(p.id, { gachaId: id, isAccountFirst: true, isDailyFirst: true, gachaExchangePoint: 250 })
        const before = digest({ awards: awards(p), player: players.getPlayerSync(p.id) })
        const rejected = await post(p, 'exec', { gacha_id: id, payment_type: 1, type: 2, number_of_exec: 1 })
        assert.equal(rejected.statusCode, 400); assert.match(rejected.body, /Personal gacha period/)
        assert.equal(digest({ awards: awards(p), player: players.getPlayerSync(p.id) }), before)
    }
    for (const id of ids) {
        const store = operations.contentOperations(), review = { enabled: true, readiness: 'verified', evidence: 'Existing personal pool points only; no period entitlement', endsAtMs: null }
        store.update(`gacha:${id}`, { expectedRevision: store.revision(), catalogDigest: store.digest, reason: 'Synthetic old personal points', actionOverrides: { exchange: review } }, Date.now())
        const choice = Object.values(assets.getGachaSync(id).pool).flat().find(item => item.isExchangeable)
        assert.ok(choice)
        const result = response(await post(p, 'exchange_character', { gacha_id: id, character_id: choice.id, number_of_character: 1 }))
        assert.ok(result.character_list.length)
        assert.equal(gachas.getPlayerGachaInfoSync(p.id, id).gachaExchangePoint, 0)
        assert.equal((await post(p, 'exec', { gacha_id: id, payment_type: 1, type: 2, number_of_exec: 1 })).statusCode, 400)
    }
    for (const id of [100, 79999, 80005, 699999, 700005, 800000]) assert.equal(personal.isDeferredPersonalPeriodGacha(id), false)
})

test('restoring an older pending archive cannot erase a paid UUID completion already recorded on the target', async () => {
    control(); const p = fixture(1)
    response(await draw(p)); response(await save(p, 2)); response(await draw(p))
    const pending = saves.createPlayerSaveSnapshotV2Sync(p.id, db), paidId = current(p).state.sessionId
    response(await select(p, 2))
    assert.equal(db.prepare("SELECT count(*) n FROM player_operation_receipts WHERE player_id=? AND operation='crazy_gacha_completion' AND request_key=?").get(p.id, paidId).n, 1)
    saves.restorePlayerSaveSnapshotV2Sync(pending, p.id, {}, db)
    assert.equal(current(p).state.status, 'pending')
    const frozen = digest(awards(p))
    const acknowledgement = response(await select(p, 2))
    assert.deepEqual(acknowledgement.crazy_gacha_result_list, { '0': [], '1': [], '2': [] })
    assert.equal(current(p).state.status, 'finalized'); assert.equal(digest(awards(p)), frozen)
    saves.restorePlayerSaveSnapshotV2Sync(pending, p.id, {}, db)
    const loaded = response(await app.inject({ method: 'POST', url: '/cn/load', payload: { viewer_id: p.viewer, api_count: 1 } }))
    assert.deepEqual(loaded.last_crazy_gacha_draw_result, [])
    assert.equal(current(p).state.status, 'finalized'); assert.equal(counter(p), 0)
    assert.equal((await draw(p)).statusCode, 400); assert.equal(tickets(p), 0)
})

test('crazy mutations require the exact authenticated native nonce and an integral API sequence', async () => {
    control(); const p = fixture(1), other = fixture(1)
    const frozen = digest({ state: current(p), tickets: tickets(p), awards: awards(p) })
    for (const nonce of ['', 'invalid', other.nonce]) assert.equal((await draw(p, {}, nonce)).statusCode, 400)
    for (const api_count of [0, -1, '1', null, 1.5]) assert.equal((await draw(p, { api_count })).statusCode, 400)
    assert.equal((await app.inject({ method: 'POST', url: '/gacha/exec', headers: { 'login-token': p.nonce },
        payload: { viewer_id: p.viewer, api_count: 1, gacha_id: 100, type: 14, payment_type: 3, number_of_exec: 1 } })).statusCode, 400)
    assert.equal((await draw({ ...p, viewer: other.viewer })).statusCode, 400)
    assert.equal(digest({ state: current(p), tickets: tickets(p), awards: awards(p) }), frozen)
    assert.equal(current(other), null)
})

test('frozen native retries never redraw, replace a backup, or clear a newer paid session after relogin', async () => {
    control(); const p = fixture(2), originalNonce = p.nonce
    const firstSequence = p.apiCount + 1, first = response(await draw(p))
    const unchanged = digest(current(p))
    assert.deepEqual(response(await draw(p, { api_count: firstSequence, retry_count: 9 })).draw, first.draw)
    assert.equal(digest(current(p)), unchanged); assert.equal(tickets(p), 1)
    const backupSequence = p.apiCount + 1; response(await save(p, 1))
    assert.equal((await save(p, 2, { api_count: backupSequence })).statusCode, 400, 'same identity cannot change its business body')
    assert.equal((await select(p, 0, { api_count: firstSequence })).statusCode, 400, 'same identity cannot change its mutation endpoint')
    const rerollSequence = p.apiCount + 1
    const both = await Promise.all([draw(p, { api_count: rerollSequence }), draw(p, { api_count: rerollSequence, retry_count: 1 })])
    const latest = response(both[0]); assert.deepEqual(response(both[1]).draw, latest.draw)
    assert.equal(current(p).state.drawCount, 2); assert.equal(tickets(p), 1)
    const latestState = digest(current(p))
    assert.equal((await draw(p, { api_count: firstSequence }, originalNonce)).statusCode, 400, 'old candidate cannot overwrite current candidate')
    assert.deepEqual(response(await save(p, 1, { api_count: backupSequence })).crazy_gacha_result_list['0'], latest.crazy_gacha_result_list['0'])
    assert.equal(digest(current(p)), latestState)
    login(p)
    assert.equal((await draw(p, { api_count: 900001 }, originalNonce)).statusCode, 400, 'unprocessed old-login request cannot mutate')
    assert.deepEqual(response(await draw(p, { api_count: rerollSequence }, originalNonce)).draw, latest.draw)
    const newNonce = p.nonce
    response(await draw(p)); assert.equal(current(p).state.drawCount, 3); assert.equal(tickets(p), 1)
    const selectedSequence = p.apiCount + 1, paidId = current(p).state.sessionId
    response(await select(p, 1)); const granted = digest(awards(p))
    login(p)
    response(await select(p, 1, { api_count: selectedSequence, retry_count: 2 }, newNonce))
    assert.equal(digest(awards(p)), granted)
    response(await draw(p)); assert.notEqual(current(p).state.sessionId, paidId); assert.equal(tickets(p), 0)
    const newSession = digest(current(p))
    assert.equal((await select(p, 1, { api_count: selectedSequence }, newNonce)).statusCode, 400)
    assert.equal((await save(p, 1, { api_count: backupSequence }, originalNonce)).statusCode, 400)
    assert.equal((await draw(p, { api_count: rerollSequence }, originalNonce)).statusCode, 400)
    assert.equal(digest(current(p)), newSession); assert.equal(digest(awards(p)), granted)
})

test('a queued signup invalidates only new mutations, and request/completion receipt failures roll back atomically', async () => {
    control(); const p = fixture(1), firstNonce = p.nonce
    let rotated = false
    coordinator.runPersistenceTransaction = (context, callback, options) => {
        if (context.playerId === p.id && context.operation === 'crazy_draw' && !rotated) { rotated = true; login(p) }
        return originalTransaction(context, callback, options)
    }
    assert.equal((await draw(p, {}, firstNonce)).statusCode, 400)
    coordinator.runPersistenceTransaction = originalTransaction
    assert.equal(rotated, true); assert.equal(current(p), null); assert.equal(tickets(p), 1)
    const sequence = p.apiCount + 1
    db.exec("CREATE TRIGGER fail_crazy_request BEFORE INSERT ON player_operation_receipts WHEN NEW.operation='crazy_gacha_request' BEGIN SELECT RAISE(ABORT,'synthetic request receipt failure'); END")
    assert.equal((await draw(p)).statusCode, 500)
    assert.equal(current(p), null); assert.equal(tickets(p), 1)
    db.exec('DROP TRIGGER fail_crazy_request')
    response(await draw(p, { api_count: sequence })); assert.equal(current(p).state.drawCount, 1); assert.equal(tickets(p), 0)
    const before = digest({ awards: awards(p), state: current(p) }), selectionSequence = p.apiCount + 1
    db.exec("CREATE TRIGGER fail_crazy_completion BEFORE INSERT ON player_operation_receipts WHEN NEW.operation='crazy_gacha_completion' BEGIN SELECT RAISE(ABORT,'synthetic completion receipt failure'); END")
    assert.equal((await select(p, 0)).statusCode, 500)
    assert.equal(digest({ awards: awards(p), state: current(p) }), before)
    db.exec('DROP TRIGGER fail_crazy_completion')
    response(await select(p, 0, { api_count: selectionSequence })); assert.equal(counter(p), 10)
})

test('a lost final-selection response republishes current selected character stacks and duplicate-item inventories without new awards', async () => {
    control(); const p = fixture(1), candidate = response(await draw(p))
    for (const id of new Set(candidate.draw.map(row => row.character_id))) load('lib/character').givePlayerCharacterSync(p.id, id)
    const sequence = p.apiCount + 1, selected = response(await select(p, 0))
    const itemIds = Object.keys(selected.item_list).map(Number)
    assert.ok(itemIds.length, 'pre-owned selected characters produce real duplicate conversion items')
    const characterId = candidate.draw[0].character_id, characters = load('data/domains/character')
    const owned = characters.getPlayerCharacterSync(p.id, characterId)
    characters.updatePlayerCharacterSync(p.id, characterId, { stack: owned.stack + 7 })
    for (const id of itemIds) inventory.givePlayerItemSync(p.id, id, 13)
    const frozen = digest(awards(p)), acknowledgement = response(await select(p, 0, { api_count: sequence, retry_count: 1 }))
    assert.equal(acknowledgement.character_list.find(row => row.character_id === characterId).stack, owned.stack + 7)
    for (const id of itemIds) assert.equal(acknowledgement.item_list[id], inventory.getPlayerItemSync(p.id, id))
    assert.equal(digest(awards(p)), frozen); assert.equal(counter(p), 10)
})
