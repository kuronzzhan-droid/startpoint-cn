'use strict'
const compiled = process.env.STARPOINT_TEST_COMPILED === '1'
if (!compiled) require('ts-node/register/transpile-only')
const load = name => require(`../${compiled ? 'out' : 'src'}/${name}`)
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { randomUUID } = require('node:crypto')
const root = path.resolve(process.env.STARPOINT_TEST_TMP_ROOT || os.tmpdir())
fs.mkdirSync(root, { recursive: true })
const directory = fs.mkdtempSync(path.join(root, 'history-action-facts-'))
Object.assign(process.env, { DATA_DIR: directory, TEMP: directory, TMP: directory, SQLITE_TMPDIR: directory,
    GACHA_SEED_DIR: path.join(directory, 'seeds'), CN_WRITER_THREAD: '0', GAME_VERBOSE_LOGS: 'false', GAME_ROUTINE_LOGS: 'off' })
fs.mkdirSync(process.env.GACHA_SEED_DIR)
const players = load('data/domains/player'), missions = load('data/domains/mission')
const master = load('lib/mission/master-data'), operations = load('lib/content-operations')
const { recordContentActionFactsSync: record } = load('lib/mission/content-action-facts')
const identity = load('lib/gameplay-request-identity')
let db, app
function fixture() {
    const account = load('data/domains/account').insertAccountSync({ appId: 'wf_cn', idpAlias: '', idpCode: 'history-actions', idpId: randomUUID(), status: 'normal' })
    const player = players.insertDefaultPlayerSync(account.id), viewer = 890000000 + player.id
    load('data/activeAccount').saveAccountDefaultPlayer(account.id, player.id)
    db.prepare('INSERT INTO sessions(token,account_id,expires,type) VALUES(?,?,?,2)').run(String(viewer), account.id, '2099-01-01T00:00:00Z')
    const token = db.transaction(() => identity.issueGameplayLoginTokenSync(db, {
        accountId: account.id, viewerId: viewer, udid: `action-${viewer}`, expiresAt: Date.now() + 86400000,
    }))()
    return { id: player.id, viewer, token, count: 0 }
}
function control(type, eventId, definitions, enabled = true) {
    const store = operations.contentOperations(), review = { readiness: 'verified', evidence: 'Synthetic exact action regression; not all-content acceptance', endsAtMs: null }
    const missionKeys = definitions.map(row => `${row.category}:${row.missionId}`)
    store.update(`${type}:${eventId}`, { expectedRevision: store.revision(), catalogDigest: store.digest, reason: 'Synthetic history action facts',
        actionOverrides: { visible: { ...review, enabled: true }, enter: { ...review, enabled, missionKeys }, claim: { ...review, enabled: true, missionKeys } } }, Date.now())
}
const value = (p, category, id) => missions.getPlayerCategoryMissionsSync(p.id, category)[id]?.progress ?? 0
const post = (p, url, body = {}) => app.inject({ method: 'POST', url, headers: { login_token: p.token },
    payload: { viewer_id: p.viewer, api_count: ++p.count, ...body } })
before(async () => {
    load('data').initializeDatabase(); db = load('data/db').getDb()
    identity.initializeGameplayRequestIdentitySchemaSync(db)
    assert.equal(path.dirname(fs.realpathSync(db.name)), fs.realpathSync(directory))
    app = require('fastify')({ logger: false })
    app.addHook('onSend', (_request, reply, body, done) => done(null,
        String(reply.getHeader('content-type')).startsWith('application/x-msgpack') && typeof body === 'object' ? JSON.stringify(body) : body))
    await app.register(load('routes/api/profile').default, { prefix: '/profile' })
    await app.register(load('routes/api/singleBattleQuest').default, { prefix: '/single' })
    await app.register(load('routes/api/character').default, { prefix: '/character' })
    await app.ready()
})
after(async () => {
    if (app) await app.close()
    await load('lib/seed-validator').default.close()
    if (db?.open) db.close()
    assert.equal(path.dirname(directory), root)
    fs.rmSync(directory, { recursive: true })
})
test('nine nonbattle conditions use successful scoped deltas, preserve old progress and reject replay', () => {
    const p = fixture(), definitions = master.getMissionMasterDefinitions(4)
    const kinds = { login: 0, mana_node_release: 7, over_limit: 9, character_story_finish: 21,
        equipment_awaken: 34, ability_soul_equip: 35, stamina_spend: 39, mana_spend: 46, profile_view: 88 }
    const selected = Object.entries(kinds).map(([kind, condition]) => [kind,
        definitions.find(row => condition === 46 ? row.missionId === 1761 : Number(row.row[4]) === condition)])
    const events = new Set(selected.map(([, row]) => row.eventId))
    for (const event of events) control('collect_item_event', event, selected.map(([, row]) => row).filter(row => row.eventId === event))
    for (const [kind, row] of selected) {
        missions.updatePlayerCategoryMissionSync(p.id, 4, row.missionId, 7)
        const amount = kind === 'login' ? 1 : 3
        record(p.id, { kind, amount, dedupeKey: `successful-${kind}` })
        assert.equal(value(p, 4, row.missionId), 7 + amount, `${kind} native condition`)
        record(p.id, { kind, amount, dedupeKey: `successful-${kind}` })
        assert.equal(value(p, 4, row.missionId), 7 + amount)
    }
    const [, mana] = selected.find(([kind]) => kind === 'mana_spend')
    control('collect_item_event', mana.eventId, selected.map(([, row]) => row).filter(row => row.eventId === mana.eventId), false)
    record(p.id, { kind: 'mana_spend', amount: 99, dedupeKey: 'closed-successful-action' })
    assert.equal(value(p, 4, mana.missionId), 10)
    control('collect_item_event', mana.eventId, selected.map(([, row]) => row).filter(row => row.eventId === mana.eventId))
    record(p.id, { kind: 'mana_spend', amount: 99, dedupeKey: 'closed-successful-action' })
    assert.equal(value(p, 4, mana.missionId), 10)
    assert.throws(() => record(p.id, { kind: 'mana_spend', amount: -1 }), /Invalid/)
})
test('controlled pass login uses CN 05:00 dedupe and stamina uses fresh mission credit only', () => {
    const p = fixture(), eventLogin = master.getMissionMasterDefinitions(8).find(row => row.patternType === 0)
    const spending = [6, 7].flatMap(category => master.getMissionMasterDefinitions(category))
        .filter(row => row.eventId === eventLogin.eventId && row.patternType === 39)
    assert.ok(spending.length > 0)
    const selected = [eventLogin, ...spending]
    control('pass_card_event', eventLogin.eventId, selected)
    players.updatePlayerSync({ id: p.id, totalStaminaUsed: 999999, totalLoginDays: 999999 })
    const beforeReset = Date.parse('2026-10-21T20:59:00Z'), afterReset = Date.parse('2026-10-21T21:00:00Z')
    record(p.id, { kind: 'login', nowMs: beforeReset })
    record(p.id, { kind: 'login', nowMs: beforeReset + 1000 })
    assert.equal(value(p, 8, eventLogin.missionId), 1)
    record(p.id, { kind: 'login', nowMs: afterReset })
    assert.equal(value(p, 8, eventLogin.missionId), 2)
    record(p.id, { kind: 'stamina_spend', amount: 12 })
    for (const row of spending) assert.equal(value(p, row.category, row.missionId), 12)
    control('pass_card_event', eventLogin.eventId, selected, false)
    record(p.id, { kind: 'stamina_spend', amount: 500 })
    for (const row of spending) assert.equal(value(p, row.category, row.missionId), 12)
})
test('action counters and their receipts roll back with the successful mutation transaction', () => {
    const p = fixture(), row = master.getMissionMasterDefinitions(4).find(row => Number(row.row[4]) === 46)
    control('collect_item_event', row.eventId, [row])
    assert.throws(() => db.transaction(() => {
        record(p.id, { kind: 'mana_spend', amount: 300, dedupeKey: 'rollback-action' })
        throw Error('injected later write failure')
    })(), /injected/)
    assert.equal(value(p, 4, row.missionId), 0)
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM player_operation_receipts WHERE player_id=? AND operation='content_action_fact'").get(p.id).n, 0)
})
test('real self-profile and over-limit endpoints count successful actions and reject invalid attempts', async () => {
    const p = fixture(), definitions = master.getMissionMasterDefinitions(4)
    const view = definitions.find(row => Number(row.row[4]) === 88), over = definitions.find(row => Number(row.row[4]) === 9)
    control('collect_item_event', view.eventId, [view]); control('collect_item_event', over.eventId, [over])
    const profile = await post(p, '/profile/get_my_profile')
    assert.equal(profile.statusCode, 200, profile.body)
    assert.equal(value(p, 4, view.missionId), 1)
    const character = load('data/domains/character')
    character.updatePlayerCharacterSync(p.id, 1, { stack: 2, overLimitStep: 0 })
    const result = await post(p, '/character/over_limit', { character_id: 1, over_limit_count: 1, use_stack: true, item_id: 0 })
    assert.equal(result.statusCode, 200, result.body)
    assert.equal(value(p, 4, over.missionId), 1)
    const failed = await post(p, '/character/over_limit', { character_id: 1, over_limit_count: -1, item_id: 0 })
    assert.equal(failed.statusCode, 400)
    assert.equal(value(p, 4, over.missionId), 1)
})
test('real free entry credits only the existing nominal stamina mission amount and start replay does not add it', async () => {
    const p = fixture(), row = master.getMissionMasterDefinitions(4).find(row => Number(row.row[4]) === 39)
    control('collect_item_event', row.eventId, [row])
    const quest = 1001002, cost = load('lib/stamina-cost').getStaminaCost(`1_${quest}`).cost
    assert.ok(cost > 0)
    const before = players.getPlayerSync(p.id).stamina, play = randomUUID()
    const body = { category: 1, quest_id: quest, party_id: 1, play_id: play, use_boost_point: false, use_boss_boost_point: false, is_auto_start_mode: false }
    const first = await post(p, '/single/start', body)
    assert.equal(first.statusCode, 200, first.body)
    assert.equal(value(p, 4, row.missionId), cost)
    assert.equal(players.getPlayerSync(p.id).stamina, before)
    const replay = await post(p, '/single/start', body)
    assert.equal(replay.statusCode, 200, replay.body)
    assert.equal(value(p, 4, row.missionId), cost)
})
