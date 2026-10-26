'use strict'
const compiled = process.env.STARPOINT_TEST_COMPILED === '1'
if (!compiled) require('ts-node/register/transpile-only')
const load = name => require(`../${compiled ? 'out' : 'src'}/${name}`)
const { test, before, after } = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const { randomUUID } = require('node:crypto'), { spawnSync } = require('node:child_process')
const root = path.resolve(process.env.STARPOINT_TEST_TMP_ROOT || os.tmpdir())
fs.mkdirSync(root, { recursive: true })
const childLoad = process.argv.includes('--load-child')
const directory = childLoad ? process.env.DATA_DIR : fs.mkdtempSync(path.join(root, 'economy-recovery-'))
Object.assign(process.env, { DATA_DIR: directory, TEMP: directory, TMP: directory, SQLITE_TMPDIR: directory,
    GACHA_SEED_DIR: path.join(directory, 'seeds'), CN_WRITER_THREAD: '0', GAME_VERBOSE_LOGS: 'false', GAME_ROUTINE_LOGS: 'off' })
fs.mkdirSync(process.env.GACHA_SEED_DIR, { recursive: true })
const players = load('data/domains/player'), characters = load('data/domains/character'), items = load('data/domains/item')
const pending = load('data/domains/ex-boost-pending'), mails = load('data/domains/mail'), assets = load('lib/assets')
const identities = load('lib/gameplay-request-identity'), receipts = load('lib/gameplay-mutation-receipt')
const originalRecord = receipts.recordGameplayMutationResponseSync
const timers = [], originalInterval = global.setInterval
let loadRoutes, db, app
try {
    global.setInterval = (...args) => { const timer = originalInterval(...args); timers.push(timer); return timer }
    loadRoutes = load('routes/cn/load').default
} finally { global.setInterval = originalInterval }
async function start() {
    load('data').initializeDatabase(); db = load('data/db').getDb()
    identities.initializeGameplayRequestIdentitySchemaSync(db)
    assert.equal(path.dirname(fs.realpathSync(db.name)), fs.realpathSync(directory))
    app = require('fastify')({ logger: false })
    app.addHook('onSend', (_request, reply, body, done) => done(null,
        String(reply.getHeader('content-type')).startsWith('application/x-msgpack') && typeof body === 'object' ? JSON.stringify(body) : body))
    await app.register(loadRoutes, { prefix: '/cn' })
    for (const name of ['exBoost', 'mail']) await app.register(load('routes/api/' + name).default, { prefix: '/' + name })
    await app.ready()
}
async function close() {
    receipts.recordGameplayMutationResponseSync = originalRecord
    await app?.close(); await load('lib/seed-validator').default.close()
    for (const timer of timers) clearInterval(timer)
    if (db?.open) db.close()
}
function login(p) {
    p.token = db.transaction(() => identities.issueGameplayLoginTokenSync(db, {
        accountId: p.accountId, viewerId: p.viewer, udid: 'economy-recovery-' + p.viewer, expiresAt: Date.now() + 86400000,
    }))()
    p.count = 0
    return p
}
function own(p, id = 111015) {
    if (!characters.getPlayerCharacterSync(p.id, id)) load('lib/character').givePlayerCharacterSync(p.id, id)
    characters.updatePlayerCharacterSync(p.id, id, {
        overLimitStep: load('lib/character-overlimit').getCharacterMaxOverLimit(id, assets.getCharacterDataSync(id).rarity),
    })
    return id
}
function fixture(material = 20) {
    const account = load('data/domains/account').insertAccountSync({ appId: 'wf_cn', idpAlias: '', idpCode: 'economy-recovery', idpId: randomUUID(), status: 'normal' })
    const player = players.insertDefaultPlayerSync(account.id), viewer = 880000000 + player.id
    load('data/activeAccount').saveAccountDefaultPlayer(account.id, player.id)
    db.prepare('INSERT INTO sessions(token,account_id,expires,type) VALUES(?,?,?,2)').run(String(viewer), account.id, '2099-01-01T00:00:00Z')
    const p = login({ id: player.id, viewer, accountId: account.id })
    own(p); items.setPlayerItemSync(p.id, 10001, material)
    return p
}
const post = (p, route, body = {}, count = ++p.count, token = p.token) => app.inject({ method: 'POST', url: route,
    headers: token ? { login_token: token } : {}, payload: { viewer_id: p.viewer, api_count: count, ...body } })
const ok = response => { assert.equal(response.statusCode, 200, response.body); return response.json().data }
const reload = p => app.inject({ method: 'POST', url: '/cn/load', payload: { viewer_id: p.viewer }, headers: { device: 'android' } })
const draw = (p, first = false, id = 111015, material = 10001) => post(p, '/exBoost/' + (first ? 'first_draw' : 'draw'), { character_id: id, cost_item_id: material })
const select = (p, confirm, count) => post(p, '/exBoost/select', { is_confirm: confirm }, count)
const candidate = p => pending.getPendingExBoostDrawSync(p.id)
const projected = draw => ({ character_id: draw.characterId, draw_result: { status_id: draw.statusId, ability_id_list: draw.abilityIdList } })
function mail(p, type = mails.MailType.ITEM, id = 101, number = 2) {
    return mails.insertMailSync(p.id, { reason_id: 1, subject: 'isolated fixture', description: '', type, type_id: id, number,
        receive_time: '0000-00-00 00:00:00', create_time: '2026-10-25 00:00:00', reward_period_limited: 0, reward_limit_time: null })
}
function snapshot(p) {
    const state = { player: players.getPlayerSync(p.id) }
    for (const table of ['players_characters', 'players_items', 'players_equipment', 'players_mails', 'players_receive_history',
        'players_degrees', 'players_ex_boost_pending_draws', 'player_operation_receipts']) {
        state[table] = db.prepare(`SELECT * FROM ${table} WHERE player_id=? ORDER BY rowid`).all(p.id)
    }
    return state
}

if (childLoad) {
    start().then(async () => {
        const response = await reload({ viewer: Number(process.argv.at(-1)) })
        console.log('LOAD_RESULT ' + JSON.stringify({ status: response.statusCode, data: {
            ex_boost_draw_result: response.json().data?.ex_boost_draw_result,
        } }))
        await close()
    }).catch(async error => { console.error(error); await close(); process.exitCode = 1 })
} else {
before(start)
after(async () => { await close(); assert.equal(path.dirname(directory), root); fs.rmSync(directory, { recursive: true }) })

test('EX load publishes the paid candidate when the last material is exhausted', async () => {
    const p = fixture(10)
    ok(await draw(p, true)); ok(await draw(p))
    assert.equal(items.getPlayerItemSync(p.id, 10001), 0)
    const saved = candidate(p)
    assert.deepEqual(ok(await reload(p)).ex_boost_draw_result, projected(saved))
    assert.deepEqual(candidate(p), saved)
    assert.equal(items.getPlayerItemSync(p.id, 10001), 0)
})

test('EX new draws cannot discard a paid unresolved candidate', async () => {
    const p = fixture(30)
    ok(await draw(p, true)); ok(await draw(p)); own(p, 111009)
    const beforeState = snapshot(p)
    for (const [first, id, material] of [[false, 111009, 10001], [true, 111009, 10001], [true, 111015, 10001], [false, 111015, 10002]]) {
        assert.equal((await draw(p, first, id, material)).statusCode, 400)
        assert.deepEqual(snapshot(p), beforeState)
    }
})

test('EX native confirm and discard after zero-material reload finish once and clear future recovery', async () => {
    for (const confirm of [true, false]) {
        const p = fixture(10)
        const original = ok(await draw(p, true)).character_list[0].ex_boost
        ok(await draw(p)); const saved = candidate(p)
        login(p)
        const recovery = ok(await reload(p)).ex_boost_draw_result
        assert.deepEqual(recovery, projected(saved))
        assert.equal(Number.isSafeInteger(recovery.character_id), true)
        assert.equal(Number.isSafeInteger(recovery.draw_result.status_id), true)
        assert.ok(recovery.draw_result.ability_id_list.every(Number.isSafeInteger))
        const count = ++p.count, first = ok(await select(p, confirm, count))
        ok(await select(p, confirm, count))
        assert.equal(candidate(p), null)
        assert.equal(items.getPlayerItemSync(p.id, 10001), 0)
        assert.equal(ok(await reload(p)).ex_boost_draw_result, null)
        const current = characters.getPlayerCharacterSync(p.id, 111015).exBoost
        assert.deepEqual(current, confirm ? { statusId: saved.statusId, abilityIdList: saved.abilityIdList }
            : { statusId: original.status_id, abilityIdList: original.ability_id_list })
        if (confirm) assert.deepEqual(first.character_list[0].ex_boost, projected(saved).draw_result)
    }
})

test('EX paid recovery survives a fresh process without rerolling or charging', async () => {
    const p = fixture(10)
    ok(await draw(p, true)); ok(await draw(p)); const saved = candidate(p)
    const child = spawnSync(process.execPath, [__filename, '--load-child', String(p.viewer)], {
        cwd: path.resolve(__dirname, '..'), env: process.env, encoding: 'utf8', timeout: 45000, windowsHide: true,
    })
    assert.equal(child.status, 0, String(child.error ?? '') + child.stderr + child.stdout.slice(-4000))
    const reply = JSON.parse(child.stdout.split(/\r?\n/).find(line => line.startsWith('LOAD_RESULT ')).slice(12))
    assert.equal(reply.status, 200)
    assert.deepEqual(reply.data.ex_boost_draw_result, projected(saved))
    assert.deepEqual(candidate(p), saved)
    assert.equal(items.getPlayerItemSync(p.id, 10001), 0)
})

test('EX absent pending and another player remain isolated; incomplete old state is retained with diagnostics', async () => {
    const p = fixture(10), other = fixture()
    assert.equal(ok(await reload(other)).ex_boost_draw_result, null)
    ok(await draw(p, true)); ok(await draw(p)); const saved = candidate(p)
    for (const missing of ['previous_ex_missing', 'character_missing']) {
        if (missing === 'previous_ex_missing') db.prepare('UPDATE players_characters SET ex_boost_status_id=NULL,ex_boost_ability_id_list=NULL WHERE player_id=? AND id=?').run(p.id, 111015)
        else db.prepare('DELETE FROM players_characters WHERE player_id=? AND id=?').run(p.id, 111015)
        const warnings = [], warn = console.warn
        console.warn = (...args) => warnings.push(args.join(' '))
        try { assert.equal(ok(await reload(p)).ex_boost_draw_result, null) }
        finally { console.warn = warn }
        assert.ok(warnings.some(line => line.includes(saved.drawId) && line.includes('player=' + p.id) && line.includes(missing)))
        assert.deepEqual(candidate(p), saved)
        assert.equal(items.getPlayerItemSync(p.id, 10001), 0)
    }
    assert.equal(candidate(other), null)
})

test('EX malformed pending and SQL errors fail load explicitly without changing the paid row', async () => {
    const p = fixture(10)
    ok(await draw(p, true)); ok(await draw(p)); const saved = candidate(p)
    db.prepare('UPDATE players_ex_boost_pending_draws SET ability_id_list=? WHERE player_id=?').run('{broken', p.id)
    const malformed = db.prepare('SELECT * FROM players_ex_boost_pending_draws WHERE player_id=?').get(p.id)
    assert.equal((await reload(p)).statusCode, 500)
    assert.deepEqual(db.prepare('SELECT * FROM players_ex_boost_pending_draws WHERE player_id=?').get(p.id), malformed)
    db.prepare('UPDATE players_ex_boost_pending_draws SET ability_id_list=? WHERE player_id=?').run(JSON.stringify(saved.abilityIdList), p.id)
    const read = pending.reconcilePendingExBoostDrawSync
    pending.reconcilePendingExBoostDrawSync = () => { throw Object.assign(Error('injected EX SQL failure'), { code: 'SQLITE_IOERR' }) }
    try { assert.equal((await reload(p)).statusCode, 500) }
    finally { pending.reconcilePendingExBoostDrawSync = read }
    assert.deepEqual(candidate(p), saved)
})

test('EX completed old-save candidates clear only when the whole load transaction commits', async () => {
    const p = fixture(10), saves = load('data/snapshots/player-snapshot')
    ok(await draw(p, true)); ok(await draw(p)); const saved = candidate(p)
    const archive = saves.createPlayerSaveSnapshotV2Sync(p.id)
    ok(await select(p, false))
    saves.restorePlayerSaveSnapshotV2Sync(archive, p.id)
    assert.deepEqual(candidate(p), saved)
    for (const failure of ['maintenance', 'commit']) {
        const coordinator = load('lib/persistence-coordinator'), run = coordinator.runPersistenceTransaction
        const beforeState = snapshot(p)
        if (failure === 'commit') db.exec('CREATE TABLE recovery_commit_guard(player_id INTEGER REFERENCES players(id) DEFERRABLE INITIALLY DEFERRED)')
        let reached = false
        coordinator.runPersistenceTransaction = (context, callback, options) => run(context, () => {
            const result = callback()
            if (context.operation === 'load_maintenance') {
                reached = true
                assert.equal(candidate(p), null, 'completed candidate cleanup ran in the same transaction')
                if (failure === 'maintenance') throw Error('injected after load maintenance')
                db.prepare('INSERT INTO recovery_commit_guard(player_id) VALUES(-98765)').run()
            }
            return result
        }, options)
        try { assert.equal((await reload(p)).statusCode, 500) }
        finally { coordinator.runPersistenceTransaction = run; if (failure === 'commit') db.exec('DROP TABLE recovery_commit_guard') }
        assert.equal(reached, true)
        assert.deepEqual(snapshot(p), beforeState)
    }
    assert.equal(ok(await reload(p)).ex_boost_draw_result, null)
    assert.equal(candidate(p), null)
    assert.equal(items.getPlayerItemSync(p.id, 10001), 0)
})

test('EX load reads the latest candidate after an earlier queued select completes', async () => {
    const p = fixture(10)
    ok(await draw(p, true)); ok(await draw(p))
    const selection = select(p, false)
    const response = reload(p)
    ok(await selection)
    assert.equal(ok(await response).ex_boost_draw_result, null)
})

for (const bulk of [false, true]) test(`mail ${bulk ? 'batch' : 'single'} native lost-response retry replays the entire result`, async () => {
    const p = fixture(), id = mail(p), route = '/mail/' + (bulk ? 'receive_all' : 'receive')
    const body = bulk ? { mail_ids: [id] } : { mail_id: id }, count = ++p.count
    const simultaneous = await Promise.all([post(p, route, body, count), post(p, route, body, count)])
    const first = ok(simultaneous[0]), committed = snapshot(p)
    assert.deepEqual(ok(simultaneous[1]), first)
    assert.deepEqual(ok(await post(p, route, { ...body, retry_count: 1 }, count)), first)
    assert.deepEqual(snapshot(p), committed)
})

test('mail new identities acknowledge current resources after spending instead of restoring old balances', async () => {
    const p = fixture(), equipment = load('data/domains/equipment')
    const ids = [mail(p), mail(p, mails.MailType.FREE_VMONEY, null, 50), mail(p, mails.MailType.CHARACTER, 111015, 2),
        mail(p, mails.MailType.EQUIPMENT, 5010005, 2)]
    const count = ++p.count, first = ok(await post(p, '/mail/receive_all', { mail_ids: ids }, count))
    items.setPlayerItemSync(p.id, 101, 0)
    const compensationId = load('lib/character').getCharacterDuplicateRewardItemId(111015)
    assert.ok(first.item_list[compensationId] > 0)
    items.setPlayerItemSync(p.id, compensationId, 0)
    players.updatePlayerSync({ id: p.id, freeVmoney: 7 })
    characters.updatePlayerCharacterSync(p.id, 111015, { stack: 0 })
    equipment.updatePlayerEquipmentSync(p.id, 5010005, { stack: 0 })
    const history = snapshot(p).players_receive_history
    login(p)
    const current = ok(await post(p, '/mail/receive_all', { mail_ids: ids }))
    assert.equal(current.already_mail_count, ids.length); assert.deepEqual(current.mail_ids, [])
    assert.equal(current.item_list[101], 0); assert.equal(current.user_info.free_vmoney, 7)
    assert.equal(current.item_list[compensationId], 0)
    assert.equal(current.character_list.find(row => row.character_id === 111015).stack, 0)
    assert.equal(current.equipment_list.find(row => row.equipment_id === 5010005).stack, 0)
    assert.deepEqual(snapshot(p).players_receive_history, history)
    assert.notDeepEqual(current, first)
    assert.equal(ok(await post(p, '/mail/receive', { mail_id: ids[0] })).item_list[101], 0)
    db.prepare('DELETE FROM players_items WHERE player_id=? AND id=?').run(p.id, compensationId)
    const missingRow = ok(await post(p, '/mail/receive', { mail_id: ids[2] }))
    assert.equal(Object.hasOwn(missingRow.item_list, compensationId), true)
    assert.equal(missingRow.item_list[compensationId], 0, 'partial-key protocol explicitly clears a missing compensation row')
})

test('mail legacy request_id receipts remain compatible and never regrant when original mail is removed', async () => {
    const p = fixture(), id = mail(p), requestId = randomUUID()
    await load('routes/api/mail').claimPlayerMailRewards(p.id, [id], requestId)
    items.setPlayerItemSync(p.id, 101, 1)
    db.prepare('DELETE FROM players_mails WHERE player_id=? AND id=?').run(p.id, id)
    const beforeState = snapshot(p), count = ++p.count
    const first = ok(await post(p, '/mail/receive', { mail_id: id, request_id: requestId }, count))
    assert.equal(first.item_list[101], 1)
    assert.equal(snapshot(p).player_operation_receipts.filter(row => row.operation === 'mail_claim').length, 1)
    assert.deepEqual(snapshot(p).players_receive_history, beforeState.players_receive_history)
    assert.deepEqual(ok(await post(p, '/mail/receive', { mail_id: id, request_id: requestId }, count)), first)
    assert.equal((await post(fixture(), '/mail/receive', { mail_id: id, request_id: requestId })).statusCode, 400)
})

test('mail identity and ownership conflicts cannot claim other payloads or other accounts', async () => {
    const p = fixture(), id = mail(p), later = mail(p), other = fixture(), theirs = mail(other), count = ++p.count
    ok(await post(p, '/mail/receive', { mail_id: id }, count)); const committed = snapshot(p)
    for (const [route, payload, token, identity] of [
        ['/mail/receive', { mail_id: later }, p.token, count],
        ['/mail/receive_all', { mail_ids: [id] }, p.token, count],
        ['/mail/receive', { mail_id: id }, other.token, count],
        ['/mail/receive', { mail_id: theirs }, p.token, ++p.count],
        ['/mail/receive', { mail_id: id }, '', ++p.count],
        ['/mail/receive_all', { mail_ids: [-1, id] }, p.token, ++p.count],
    ]) {
        assert.equal((await post(p, route, payload, identity, token)).statusCode, 400)
        assert.deepEqual(snapshot(p), committed)
    }
    const fresh = ok(await post(p, '/mail/receive', { mail_id: later }))
    assert.equal(fresh.item_list[101], 4)
})

test('mail empty and partly received batches preserve counts and frozen responses', async () => {
    const p = fixture(), count = ++p.count
    const empty = ok(await post(p, '/mail/receive_all', { mail_ids: [] }, count))
    const firstId = mail(p), later = mail(p)
    assert.deepEqual(ok(await post(p, '/mail/receive_all', { mail_ids: [] }, count)), empty)
    ok(await post(p, '/mail/receive', { mail_id: firstId }))
    const data = ok(await post(p, '/mail/receive_all', { mail_ids: [firstId, later, later] }))
    assert.equal(data.already_mail_count, 2)
    assert.deepEqual(data.mail_ids, [later]); assert.equal(data.item_list[101], 4)
    assert.equal(snapshot(p).players_receive_history.length, 2)
})

test('independent overlapping single and batch mail requests grant each owned attachment once', async () => {
    const p = fixture(), id = mail(p), other = fixture(), foreignId = mail(other)
    const foreignBefore = snapshot(other)
    const results = await Promise.all([
        post(p, '/mail/receive', { mail_id: id }),
        post(p, '/mail/receive_all', { mail_ids: [id, foreignId] }),
    ])
    for (const result of results) assert.equal(ok(result).item_list[101], 2)
    assert.equal(snapshot(p).players_receive_history.length, 1)
    assert.equal(items.getPlayerItemSync(p.id, 101), 2)
    assert.deepEqual(snapshot(other), foreignBefore)
})

for (const point of ['grant', 'awake', 'receipt', 'commit']) test(`mail ${point} failure rolls marks, rewards, history and both receipt forms back`, async () => {
    const p = fixture(), ids = [mail(p), mail(p, mails.MailType.CHARACTER, 111015, 2)], count = ++p.count
    const body = { mail_ids: ids, request_id: randomUUID() }, beforeState = snapshot(p)
    const coordinator = load('lib/persistence-coordinator'), run = coordinator.runPersistenceTransaction
    const mission = load('lib/mission/awake-unlock'), reconcile = mission.reconcileAwakeUnlocks
    if (point === 'grant') db.exec("CREATE TRIGGER fail_recovery_mail_grant BEFORE INSERT ON players_receive_history BEGIN SELECT RAISE(ABORT,'mail history failure'); END")
    if (point === 'awake') mission.reconcileAwakeUnlocks = () => { throw Error('injected awake publication failure') }
    if (point === 'receipt') receipts.recordGameplayMutationResponseSync = (...args) => { originalRecord(...args); throw Error('injected after complete response receipt') }
    if (point === 'commit') {
        db.exec('CREATE TABLE mail_commit_guard(player_id INTEGER REFERENCES players(id) DEFERRABLE INITIALLY DEFERRED)')
        coordinator.runPersistenceTransaction = (context, callback, options) => run(context, () => {
            const result = callback()
            if (context.domain === 'mail') db.prepare('INSERT INTO mail_commit_guard(player_id) VALUES(-98765)').run()
            return result
        }, options)
    }
    try { assert.equal((await post(p, '/mail/receive_all', body, count)).statusCode, 500) }
    finally {
        receipts.recordGameplayMutationResponseSync = originalRecord; mission.reconcileAwakeUnlocks = reconcile
        coordinator.runPersistenceTransaction = run
        if (point === 'grant') db.exec('DROP TRIGGER fail_recovery_mail_grant')
        if (point === 'commit') db.exec('DROP TABLE mail_commit_guard')
    }
    assert.deepEqual(snapshot(p), beforeState)
    assert.equal(ok(await post(p, '/mail/receive_all', body, count)).item_list[101], 2)
})
}
