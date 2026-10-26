'use strict'
const compiled = process.env.STARPOINT_TEST_COMPILED === '1'
if (!compiled) require('ts-node/register/transpile-only')
const load = name => require(`../${compiled ? 'out' : 'src'}/${name}`)
const { test, before, after } = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const { createHash, randomUUID } = require('node:crypto')
const root = path.resolve(process.env.STARPOINT_TEST_TMP_ROOT || os.tmpdir())
fs.mkdirSync(root, { recursive: true })
const directory = fs.mkdtempSync(path.join(root, 'ex-import-continuity-'))
Object.assign(process.env, { DATA_DIR: directory, TEMP: directory, TMP: directory, SQLITE_TMPDIR: directory,
    GACHA_SEED_DIR: path.join(directory, 'seeds'), CN_WRITER_THREAD: '0', MULTI_REALTIME_PROCESS: '0',
    MULTI_REALTIME_OWNER_CHILD: '0', MULTI_BATTLE_RELAY_PROCESS: '0', GAME_VERBOSE_LOGS: 'false', GAME_ROUTINE_LOGS: 'off',
    ADMIN_PANEL_PASSWORD: 'isolated-ex-import-fixture' })
fs.mkdirSync(process.env.GACHA_SEED_DIR)
const players = load('data/domains/player'), characters = load('data/domains/character'), items = load('data/domains/item')
const pending = load('data/domains/ex-boost-pending'), assets = load('lib/assets'), saves = load('data/snapshots/player-snapshot')
const identities = load('lib/gameplay-request-identity')
const abilities = load('lib/ex-boost-abilities').ALL_ABILITIES
const timers = [], originalInterval = global.setInterval
let loadRoutes, adminRoutes, exRoutes, db, app, origin, cookie
try {
    global.setInterval = (...args) => { const timer = originalInterval(...args); timers.push(timer); return timer }
    loadRoutes = load('routes/cn/load').default
    adminRoutes = load('routes/web_api').default
    exRoutes = load('routes/api/exBoost').default
} finally { global.setInterval = originalInterval }
const A = 111015, B = 111009, MATERIAL = 10001
const cost = () => assets.getExBoostItemSync(MATERIAL).count
const ok = response => { assert.equal(response.statusCode, 200, response.body); return response.json().data }
const candidate = p => pending.getPendingExBoostDrawSync(p.id)
const projected = draw => ({ character_id: draw.characterId, draw_result: { status_id: draw.statusId, ability_id_list: draw.abilityIdList } })
const post = (p, route, body = {}, count = ++p.count) => app.inject({ method: 'POST', url: '/exBoost/' + route,
    headers: { login_token: p.token }, payload: { viewer_id: p.viewer, api_count: count, ...body } })
const draw = (p, first = false, id = A, count) => post(p, first ? 'first_draw' : 'draw', { character_id: id, cost_item_id: MATERIAL }, count)
const reload = p => app.inject({ method: 'POST', url: '/cn/load', payload: { viewer_id: p.viewer }, headers: { device: 'android' } })
function login(p) {
    p.token = db.transaction(() => identities.issueGameplayLoginTokenSync(db, { accountId: p.accountId, viewerId: p.viewer,
        udid: 'ex-import-' + p.viewer, expiresAt: Date.now() + 86400000 }))()
    p.count = 0
    return p
}
function own(p, id) {
    if (!characters.getPlayerCharacterSync(p.id, id)) load('lib/character').givePlayerCharacterSync(p.id, id)
    characters.updatePlayerCharacterSync(p.id, id, {
        overLimitStep: load('lib/character-overlimit').getCharacterMaxOverLimit(id, assets.getCharacterDataSync(id).rarity),
    })
}
function fixture() {
    const account = load('data/domains/account').insertAccountSync({ appId: 'wf_cn', idpAlias: '', idpCode: 'ex-import', idpId: randomUUID(), status: 'normal' })
    const player = players.insertDefaultPlayerSync(account.id), viewer = 890000000 + player.id
    load('data/activeAccount').saveAccountDefaultPlayer(account.id, player.id)
    db.prepare('INSERT INTO sessions(token,account_id,expires,type) VALUES(?,?,?,2)').run(String(viewer), account.id, '2099-01-01T00:00:00Z')
    const p = login({ id: player.id, viewer, accountId: account.id })
    own(p, B); items.setPlayerItemSync(p.id, MATERIAL, 8 * cost())
    return p
}
function refreshSummary(snapshot) {
    snapshot.summary.includedTableCount = Object.keys(snapshot.data.tables).length
    snapshot.summary.rowCount = Object.values(snapshot.data.tables).reduce((sum, table) => sum + table.rows.length, 0)
    return snapshot
}
function oldV2(snapshot) {
    const copy = structuredClone(snapshot)
    const additions = new Set(['players_ex_boost_pending_draws', 'players_shop_campaign_lineups', 'players_bond_token_exchanges'])
    const tables = saves.PLAYER_SNAPSHOT_V2_TABLES.filter(table => !additions.has(table))
    copy.schemaFingerprint = createHash('sha256').update(JSON.stringify(tables.map(table => ({ table,
        columns: db.prepare(`PRAGMA table_info("${table}")`).all().map(column => ({ name: column.name, type: column.type,
            notnull: column.notnull, defaultValue: column.dflt_value, pk: column.pk })) })))).digest('hex')
    for (const table of additions) delete copy.data.tables[table]
    refreshSummary(copy)
    saves.validatePlayerSaveSnapshotV2Sync(copy)
    return copy
}
function mutateCharacter(snapshot, patch, id = A) {
    const table = snapshot.data.tables.players_characters
    const row = table.rows.find(row => row[table.columns.indexOf('id')] === id)
    assert.ok(row)
    for (const [column, value] of Object.entries(patch)) row[table.columns.indexOf(column)] = value
    return snapshot
}
function identityState() {
    return Object.fromEntries(['accounts', 'sessions', 'device_bindings', 'player_login_credentials', 'player_login_sessions', 'gameplay_login_sessions']
        .map(table => [table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]))
}
function state(p) {
    return { tables: saves.createPlayerSaveSnapshotV2Sync(p.id).data.tables,
        receipts: db.prepare('SELECT * FROM player_operation_receipts WHERE player_id=? ORDER BY rowid').all(p.id),
        identities: identityState(), selected: fs.readFileSync(path.join(directory, 'active_account.json'), 'utf8') }
}
async function upload(p, snapshot) {
    const form = new FormData()
    form.append('file', new Blob([JSON.stringify(snapshot)], { type: 'application/json' }), 'ex-import-v2.json')
    const response = await fetch(origin + '/api/player/save?id=' + p.id, {
        method: 'POST', headers: { cookie, accept: 'application/json' }, body: form,
    })
    return { status: response.status, body: await response.json() }
}
async function download(p) {
    const response = await fetch(origin + '/api/player/save?id=' + p.id, { headers: { cookie } })
    assert.equal(response.status, 200, await response.clone().text())
    assert.match(response.headers.get('content-disposition'), /attachment; filename="save_\d+\.json"/)
    return response.json()
}
function backup(result) {
    const name = path.basename(result.body.backup.replace(/\\/g, '/'))
    return JSON.parse(fs.readFileSync(path.join(directory, 'admin-backups', name, 'player-save.json'), 'utf8'))
}
async function rejectedWithoutMutation(p, snapshot) {
    const previous = state(p)
    const result = await upload(p, snapshot)
    assert.equal(result.status, 400, JSON.stringify(result.body))
    assert.match(result.body.error, /EX/)
    assert.match(result.body.error, /确认|放弃|处理/)
    assert.deepEqual(state(p), previous, 'failed import preserves portable progress, materials, candidate, receipts and identity')
    return result
}
async function paid(p) {
    own(p, A)
    ok(await draw(p, true)); ok(await draw(p))
    assert.ok(candidate(p))
    return saves.createPlayerSaveSnapshotV2Sync(p.id)
}

before(async () => {
    load('data').initializeDatabase(); db = load('data/db').getDb()
    assert.equal(path.dirname(fs.realpathSync(db.name)), fs.realpathSync(directory))
    load('lib/player-login').initializePlayerLogin()
    identities.initializeGameplayRequestIdentitySchemaSync(db)
    app = require('fastify')({ logger: false })
    load('lib/management-auth').installManagementAuth(app)
    app.addHook('onSend', (_request, reply, body, done) => done(null,
        String(reply.getHeader('content-type')).startsWith('application/x-msgpack') && typeof body === 'object' ? JSON.stringify(body) : body))
    await app.register(adminRoutes, { prefix: '/api' })
    await app.register(loadRoutes, { prefix: '/cn' })
    await app.register(exRoutes, { prefix: '/exBoost' })
    origin = await app.listen({ host: '127.0.0.1', port: 0 })
    const response = await fetch(origin + '/admin-login', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password: process.env.ADMIN_PANEL_PASSWORD }) })
    assert.equal(response.status, 200)
    cookie = response.headers.get('set-cookie').split(';')[0]
})
after(async () => {
    await app?.close(); await load('lib/seed-validator').default.close()
    await load('multi/npc/player-party-pool').stopQuestNpcPartyPoolWorker()
    for (const timer of timers) clearInterval(timer)
    if (db?.open) db.close()
    assert.equal(path.dirname(directory), root)
    fs.rmSync(directory, { recursive: true })
})

for (const confirm of [true, false]) test(`old V2 HTTP character removal is rejected; ${confirm ? 'confirm' : 'discard'} and same-api retry unblock import and other-character EX`, async () => {
    const p = fixture()
    // Keep the old archive's balance equal to the post-payment balance so
    // import progress replacement cannot hide an accidental EX refund.
    items.setPlayerItemSync(p.id, MATERIAL, 6 * cost())
    const archive = oldV2(await download(p))
    items.setPlayerItemSync(p.id, MATERIAL, 8 * cost())
    await paid(p)
    const saved = candidate(p), previousEx = characters.getPlayerCharacterSync(p.id, A).exBoost
    await rejectedWithoutMutation(p, archive)
    login(p)
    const beforeLoadAmount = items.getPlayerItemSync(p.id, MATERIAL)
    assert.deepEqual(ok(await reload(p)).ex_boost_draw_result, projected(saved))
    assert.deepEqual(candidate(p), saved)
    assert.equal(items.getPlayerItemSync(p.id, MATERIAL), beforeLoadAmount)
    const count = ++p.count
    const selected = ok(await post(p, 'select', { is_confirm: confirm }, count))
    assert.deepEqual(ok(await post(p, 'select', { is_confirm: confirm }, count)), selected)
    assert.equal(candidate(p), null)
    assert.equal(items.getPlayerItemSync(p.id, MATERIAL), beforeLoadAmount)
    assert.deepEqual(characters.getPlayerCharacterSync(p.id, A).exBoost,
        confirm ? { statusId: saved.statusId, abilityIdList: saved.abilityIdList } : previousEx)
    const beforeImport = state(p), beforeBackup = saves.createPlayerSaveSnapshotV2Sync(p.id)
    const result = await upload(p, archive)
    assert.equal(result.status, 200, JSON.stringify(result.body))
    assert.equal(result.body.snapshotVersion, 2)
    assert.deepEqual(backup(result).data.tables, beforeBackup.data.tables, 'rollback backup is the exact pre-import destination')
    assert.deepEqual(identityState(), beforeImport.identities)
    assert.deepEqual(state(p).receipts, beforeImport.receipts)
    assert.equal(characters.getPlayerCharacterSync(p.id, A), null)
    assert.equal(ok(await reload(p)).ex_boost_draw_result, null)
    const beforeB = items.getPlayerItemSync(p.id, MATERIAL)
    ok(await draw(p, true, B)); const drawCount = ++p.count
    const first = ok(await draw(p, false, B, drawCount)), afterB = state(p)
    assert.deepEqual(ok(await draw(p, false, B, drawCount)), first)
    assert.deepEqual(state(p), afterB)
    assert.equal(items.getPlayerItemSync(p.id, MATERIAL), beforeB - 2 * cost())
    assert.equal(candidate(p).characterId, B)
})

test('old V2 with the candidate character and previous EX preserves paid selection, identity and backup', async () => {
    const p = fixture(), current = await paid(p), saved = candidate(p)
    const previous = state(p), result = await upload(p, oldV2(current))
    assert.equal(result.status, 200, JSON.stringify(result.body))
    assert.deepEqual(backup(result).data.tables, current.data.tables)
    assert.deepEqual(candidate(p), saved)
    assert.deepEqual(identityState(), previous.identities)
    assert.deepEqual(state(p).receipts, previous.receipts)
    assert.deepEqual(ok(await reload(p)).ex_boost_draw_result, projected(saved))
    assert.equal(items.getPlayerItemSync(p.id, MATERIAL), 6 * cost())
})

for (const [label, patch] of [
    ['missing old EX', { ex_boost_status_id: null, ex_boost_ability_id_list: null }],
    ['missing old status', { ex_boost_status_id: null }],
    ['missing old abilities', { ex_boost_ability_id_list: null }],
    ['invalid old status', { ex_boost_status_id: 0 }],
    ['unknown old status', { ex_boost_status_id: 999999999 }],
    ['invalid old ability encoding', { ex_boost_ability_id_list: 'broken-ex-abilities' }],
    ['unknown old ability', { ex_boost_ability_id_list: '999999999' }],
    ['duplicate old ability', { ex_boost_ability_id_list: `${abilities[0].id},${abilities[0].id}` }],
    ['two old abilities in the same group', { ex_boost_ability_id_list: abilities.filter(ability => ability.group === abilities[0].group)
        .slice(0, 2).map(ability => ability.id).join(',') }],
]) test(`old V2 rejects ${label} while preserving destination paid state`, async () => {
    const p = fixture(), archive = oldV2(await paid(p)), saved = candidate(p)
    mutateCharacter(archive, patch)
    await rejectedWithoutMutation(p, archive)
    assert.deepEqual(ok(await reload(p)).ex_boost_draw_result, projected(saved))
})

for (const change of ['clear', 'replace']) test(`current V2 cannot ${change} an unresolved destination paid candidate`, async () => {
    const p = fixture(), archive = await paid(p)
    const incoming = archive.data.tables.players_ex_boost_pending_draws
    if (change === 'clear') incoming.rows = []
    else incoming.rows[0][incoming.columns.indexOf('draw_id')] = randomUUID()
    refreshSummary(archive)
    saves.validatePlayerSaveSnapshotV2Sync(archive)
    await rejectedWithoutMutation(p, archive)
})

test('current V2 may reload the exact same paid candidate without reroll, charge or lost recovery', async () => {
    const p = fixture(), archive = await paid(p), saved = candidate(p), receiptsBefore = state(p).receipts
    const result = await upload(p, archive)
    assert.equal(result.status, 200, JSON.stringify(result.body))
    assert.deepEqual(candidate(p), saved)
    assert.deepEqual(state(p).receipts, receiptsBefore)
    assert.deepEqual(ok(await reload(p)).ex_boost_draw_result, projected(saved))
    assert.equal(items.getPlayerItemSync(p.id, MATERIAL), 6 * cost())
})

test('an old EX with no abilities remains valid for paid comparison recovery', async () => {
    const p = fixture(), archive = oldV2(await paid(p)), saved = candidate(p)
    mutateCharacter(archive, { ex_boost_ability_id_list: '' })
    const result = await upload(p, archive)
    assert.equal(result.status, 200, JSON.stringify(result.body))
    // The existing shared reader maps the canonical empty encoding to [0].
    // This import guard preserves the canonical bytes without changing that
    // separate reader contract or inventing an ability in the archive.
    assert.equal(db.prepare('SELECT ex_boost_ability_id_list FROM players_characters WHERE player_id=? AND id=?').get(p.id, A)
        .ex_boost_ability_id_list, '')
    assert.deepEqual(ok(await reload(p)).ex_boost_draw_result, projected(saved))
})

test('current V2 carrying pending without a previous EX is rejected before replacing an empty destination', async () => {
    const source = fixture(), archive = await paid(source), target = fixture()
    mutateCharacter(archive, { ex_boost_status_id: null, ex_boost_ability_id_list: null })
    await rejectedWithoutMutation(target, archive)
    assert.equal(candidate(target), null)
})

for (const confirm of [true, false]) test(`a current V2 paid candidate transfers to an empty destination and can ${confirm ? 'confirm' : 'discard'} without changing its source`, async () => {
    const source = fixture(), archive = await paid(source), target = fixture(), saved = candidate(source)
    const sourceBefore = state(source), targetBefore = state(target), oldEx = characters.getPlayerCharacterSync(source.id, A).exBoost
    const result = await upload(target, archive)
    assert.equal(result.status, 200, JSON.stringify(result.body))
    assert.deepEqual(backup(result).data.tables, targetBefore.tables)
    assert.deepEqual(identityState(), targetBefore.identities)
    assert.deepEqual(state(source), sourceBefore)
    assert.deepEqual(candidate(target), saved)
    assert.deepEqual(ok(await reload(target)).ex_boost_draw_result, projected(saved))
    const balance = items.getPlayerItemSync(target.id, MATERIAL), count = ++target.count
    const first = ok(await post(target, 'select', { is_confirm: confirm }, count))
    assert.deepEqual(ok(await post(target, 'select', { is_confirm: confirm }, count)), first)
    assert.equal(candidate(target), null)
    assert.equal(items.getPlayerItemSync(target.id, MATERIAL), balance)
    assert.deepEqual(characters.getPlayerCharacterSync(target.id, A).exBoost,
        confirm ? { statusId: saved.statusId, abilityIdList: saved.abilityIdList } : oldEx)
    assert.deepEqual(identityState(), targetBefore.identities)
    assert.deepEqual(state(source), sourceBefore, 'the destination completion receipt must not complete or mutate the source draw')
    assert.deepEqual(ok(await reload(source)).ex_boost_draw_result, projected(saved))
})

test('old V2 without pending remains importable when the destination has no pending', async () => {
    const source = fixture(), target = fixture(), archive = oldV2(await download(source)), identity = identityState()
    players.updatePlayerSync({ id: target.id, freeVmoney: 777 })
    const beforeImport = saves.createPlayerSaveSnapshotV2Sync(target.id)
    const result = await upload(target, archive)
    assert.equal(result.status, 200, JSON.stringify(result.body))
    assert.deepEqual(backup(result).data.tables, beforeImport.data.tables)
    assert.deepEqual(identityState(), identity)
    assert.equal(candidate(target), null)
    const exported = await download(target), row = exported.data.tables.players
    assert.equal(row.rows[0][row.columns.indexOf('account_id')], target.accountId)
    assert.equal(row.rows[0][row.columns.indexOf('id')], target.id)
})

test('completed candidate receipts permit a historical candidate archive; load clears it without reward', async () => {
    const p = fixture(), archive = await paid(p), saved = candidate(p)
    ok(await post(p, 'select', { is_confirm: false }))
    const receiptsBefore = state(p).receipts
    const result = await upload(p, archive)
    assert.equal(result.status, 200, JSON.stringify(result.body))
    assert.deepEqual(candidate(p), saved)
    const exBefore = characters.getPlayerCharacterSync(p.id, A).exBoost
    assert.equal(ok(await reload(p)).ex_boost_draw_result, null)
    assert.equal(candidate(p), null)
    assert.deepEqual(state(p).receipts, receiptsBefore)
    assert.deepEqual(characters.getPlayerCharacterSync(p.id, A).exBoost, exBefore)
    assert.equal(items.getPlayerItemSync(p.id, MATERIAL), 6 * cost())
})

test('a completed target candidate does not block an old V2 without its character; load cleans it before recovery', async () => {
    const p = fixture(), oldArchive = oldV2(saves.createPlayerSaveSnapshotV2Sync(p.id)), archive = await paid(p)
    ok(await post(p, 'select', { is_confirm: false }))
    assert.equal((await upload(p, archive)).status, 200)
    assert.ok(candidate(p), 'completed historical row is restored until load reconciles it')
    const receiptsBefore = state(p).receipts, result = await upload(p, oldArchive)
    assert.equal(result.status, 200, JSON.stringify(result.body))
    assert.equal(characters.getPlayerCharacterSync(p.id, A), null)
    const balance = items.getPlayerItemSync(p.id, MATERIAL)
    assert.equal(ok(await reload(p)).ex_boost_draw_result, null)
    assert.equal(candidate(p), null)
    assert.equal(items.getPlayerItemSync(p.id, MATERIAL), balance)
    assert.deepEqual(state(p).receipts, receiptsBefore)
})

test('HTTP V1 is explicitly unsupported and preserves pending, identity and all existing state', async () => {
    const p = fixture(); await paid(p)
    const previous = state(p), response = await upload(p, { schema: 'starpoint-cn-save', version: 1,
        exportedAt: new Date().toISOString(), playerId: p.id, data: {} })
    assert.equal(response.status, 400, JSON.stringify(response.body))
    assert.match(response.body.error, /仅支持 V2 完整存档/)
    assert.deepEqual(state(p), previous)
})

for (const failure of ['sql', 'commit']) test(`HTTP import ${failure} failure rolls back progress, paid candidate, receipts and identity`, async () => {
    const p = fixture(), archive = await paid(p)
    players.updatePlayerSync({ id: p.id, freeVmoney: 765 })
    const previous = state(p), coordinator = load('lib/persistence-coordinator'), run = coordinator.runPersistenceTransaction
    let reached = false
    if (failure === 'sql') db.exec(`CREATE TRIGGER fail_ex_import_character BEFORE INSERT ON players_characters
        WHEN NEW.player_id=${p.id} BEGIN SELECT RAISE(ABORT,'injected import character SQL failure'); END`)
    else {
        // Reference an isolated parent rather than players, so snapshot's
        // unknown-player-table safety guard does not mask the COMMIT fault.
        db.exec('CREATE TABLE ex_import_commit_parent(id INTEGER PRIMARY KEY); CREATE TABLE ex_import_commit_guard(id INTEGER REFERENCES ex_import_commit_parent(id) DEFERRABLE INITIALLY DEFERRED)')
        coordinator.runPersistenceTransaction = (context, callback, options) => run(context, () => {
            const result = callback()
            if (context.operation === 'import_save') {
                reached = true
                const playerTable = archive.data.tables.players
                assert.equal(players.getPlayerSync(p.id).freeVmoney, playerTable.rows[0][playerTable.columns.indexOf('free_vmoney')],
                    'restore finished before the injected deferred COMMIT failure')
                db.prepare('INSERT INTO ex_import_commit_guard(id) VALUES(-98765)').run()
            }
            return result
        }, options)
    }
    try {
        const response = await upload(p, archive)
        assert.equal(response.status, 500, JSON.stringify(response.body))
        assert.match(response.body.error, failure === 'sql' ? /injected import character SQL failure/ : /FOREIGN KEY constraint failed/)
    } finally {
        coordinator.runPersistenceTransaction = run
        if (failure === 'sql') db.exec('DROP TRIGGER fail_ex_import_character')
        else db.exec('DROP TABLE ex_import_commit_guard; DROP TABLE ex_import_commit_parent')
    }
    if (failure === 'commit') assert.equal(reached, true)
    assert.deepEqual(state(p), previous)
    const retry = await upload(p, archive)
    assert.equal(retry.status, 200, JSON.stringify(retry.body))
    assert.deepEqual(candidate(p), pending.parseExBoostPendingRow(Object.fromEntries(archive.data.tables.players_ex_boost_pending_draws.columns
        .map((column, index) => [column, archive.data.tables.players_ex_boost_pending_draws.rows[0][index]]))))
})
