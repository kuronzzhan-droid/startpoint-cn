'use strict'
const compiled = process.env.STARPOINT_TEST_COMPILED === '1'
if (!compiled) require('ts-node/register/transpile-only')
const load = name => require(`../${compiled ? 'out' : 'src'}/${name}`)
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { randomUUID } = require('node:crypto')
const root = path.resolve(process.env.STARPOINT_TEST_TMP_ROOT || os.tmpdir())
fs.mkdirSync(root, { recursive: true })
const directory = fs.mkdtempSync(path.join(root, 'history-raid-ranking-'))
Object.assign(process.env, { DATA_DIR: directory, TEMP: directory, TMP: directory, SQLITE_TMPDIR: directory,
    GACHA_SEED_DIR: path.join(directory, 'seeds'), CN_WRITER_THREAD: '0', GAME_VERBOSE_LOGS: 'false', GAME_ROUTINE_LOGS: 'off' })
fs.mkdirSync(process.env.GACHA_SEED_DIR)
const players = load('data/domains/player'), active = load('data/domains/quest_active')
const operations = load('lib/content-operations'), raid = load('lib/raid-event-config')
const inventory = load('data/domains/item'), degrees = load('data/domains/degree')
let db, app
function fixture() {
    const account = load('data/domains/account').insertAccountSync({ appId: 'wf_cn', idpAlias: '', idpCode: 'history-raid-ranking', idpId: randomUUID(), status: 'normal' })
    const player = players.insertDefaultPlayerSync(account.id), viewer = 890000000 + player.id
    load('data/activeAccount').saveAccountDefaultPlayer(account.id, player.id)
    db.prepare('INSERT INTO sessions(token,account_id,expires,type) VALUES(?,?,?,2)').run(String(viewer), account.id, '2099-01-01T00:00:00Z')
    return { id: player.id, viewer }
}
const post = (player, url, body = {}) => app.inject({ method: 'POST', url, payload: { viewer_id: player.viewer, api_count: 1, ...body } })
function response(result) { assert.equal(result.statusCode, 200, result.body); return result.json() }
function control(key, enabled, questKey) {
    const store = operations.contentOperations(), review = { readiness: 'verified', evidence: 'Original native definition and synthetic HTTP player', endsAtMs: null }
    store.update(key, { expectedRevision: store.revision(), catalogDigest: store.digest, reason: 'Synthetic original historical lifecycle',
        actionOverrides: { visible: { ...review, enabled: true }, enter: { ...review, enabled, questKeys: [questKey] },
            ...(key === 'raid_event:1' ? { exchange: { ...review, enabled } } : {}) } }, Date.now())
    // Raid1 entrance is jointly gated by its box. Publish the actual paired
    // lifecycle in this synthetic fixture, rather than weakening production.
    if (key === 'raid_event:1' && enabled) store.update('box_gacha:16', {
        expectedRevision: store.revision(), catalogDigest: store.digest, reason: 'Synthetic Raid1 paired box lifecycle',
        actionOverrides: { visible: { ...review, enabled: true }, enter: { ...review, enabled: true } },
    }, Date.now())
}
function state(player) {
    return { portable: load('data/snapshots/player-snapshot').createPlayerSaveSnapshotV2Sync(player.id, db).data.tables,
        active: active.getPlayerActiveQuestSync(player.id) }
}
const start = (player, category, quest, play) => post(player, '/single/start', { category, quest_id: quest, party_id: 1,
    play_id: play, use_boost_point: false, use_boss_boost_point: false, is_auto_start_mode: false })
const finish = (player, category, quest, play) => post(player, '/single/finish', { category, quest_id: quest, play_id: play,
    continue_count: 0, elapsed_time_ms: 1000, score: 12345, add_mana: 0, is_accomplished: true, is_restored: false,
    statistics: { clear_phase: 1, party: { characters: [{ id: 1 }, null, null], unison_characters: [null, null, null],
        equipments: [null, null, null], ability_soul_ids: [null, null, null] }, zones: [] } })
function global(eventId, count, weight = 0) {
    db.prepare('INSERT OR REPLACE INTO raid_event_global_state(event_id,total_kill_count,weighted_kill_count,calculation_version,updated_at) VALUES(?,?,?,?,?)')
        .run(eventId, count, weight, 5, Date.now())
}
before(async () => {
    load('data').initializeDatabase(); db = load('data/db').getDb()
    assert.equal(path.dirname(fs.realpathSync(db.name)), fs.realpathSync(directory))
    app = require('fastify')({ logger: false })
    app.addHook('onSend', (_request, reply, body, done) => done(null,
        String(reply.getHeader('content-type')).startsWith('application/x-msgpack') && typeof body === 'object' ? JSON.stringify(body) : body))
    for (const [module, prefix] of [['raidEvent', '/raid'], ['rankingEvent', '/ranking'], ['singleBattleQuest', '/single']]) {
        await app.register(load(`routes/api/${module}`).default, { prefix })
    }
    await app.ready()
})
after(async () => {
    if (app) await app.close()
    await load('lib/seed-validator').default.close()
    if (db?.open) db.close()
    assert.equal(path.dirname(directory), root)
    fs.rmSync(directory, { recursive: true })
})

test('all historical Raid targets/weights equal native values while adopted event7 stays unchanged', () => {
    const native = require('../assets/raid_event_rules.json')
    for (let id = 1; id <= 6; id++) {
        assert.equal(raid.isSupportedRaidEventId(id), true)
        assert.equal(raid.getRaidEventProgressRule(id).requiredKillCount, native.events[id].nativeRequiredKillCount)
        assert.deepEqual(raid.getRaidEventProgressRule(id).questWeights, native.events[id].questKillCountWeights)
        assert.equal(raid.getRaidEventQuestIds(id).length, 4)
    }
    assert.equal(raid.getRaidEventProgressRule(7).requiredKillCount, 30000)
    assert.equal(raid.getRaidEventQuestIds(7).length, 26)
    assert.equal(raid.RAID_EVENT_CALCULATION_VERSION, 5)
})

test('old Raid1 dedicated start, closed finish and earned summary reward use the original target and payout exactly once', async () => {
    const player = fixture(), other = fixture(), foreign = state(other), key = 'raid_event:1', quest = 1004
    control(key, true, `23:${quest}`)
    const summary = () => post(player, '/raid/summary', { event_id: 1 })
    assert.equal(response(await summary()).data.raid_boss.total_kill_count, 0)
    response(await post(player, '/raid/party'))
    // Native Raid forbids using the same character across its three teams.
    // Keep the primary fixture leader and leave the two unused side teams empty.
    db.prepare('UPDATE players_parties SET character_id_1=NULL WHERE player_id=? AND category=3 AND group_id=1 AND slot IN (2,3)').run(player.id)
    const rule = raid.getRaidEventProgressRule(1)
    // Synthetic pre-existing communal progress, not official historical totals.
    global(1, 0, rule.requiredKillCount - rule.questWeights[quest])
    const play = randomUUID()
    assert.equal(response(await post(player, '/raid/battle/start', { event_id: 1, quest_id: quest, party_group_id: 1,
        play_id: play, use_auto_start_point: false, is_auto_start_mode: false })).data_headers.result_code, 1)
    control(key, false, `23:${quest}`)
    const registered = state(player)
    assert.equal(response(await post(player, '/raid/battle/start', { event_id: 1, quest_id: quest, party_group_id: 1,
        play_id: randomUUID(), use_auto_start_point: false, is_auto_start_mode: false })).data_headers.result_code, 4050)
    assert.deepEqual(state(player), registered)
    assert.equal(response(await finish(player, 23, quest, play)).data_headers.result_code, 1)
    assert.equal(load('lib/raidEventGlobal').getRaidEventGlobalBossSync(1).totalKillCount, 1)
    const before = players.getPlayerSync(player.id), token = inventory.getPlayerItemSync(player.id, 49100) ?? 0
    const result = response(await summary()).data
    assert.equal(result.kill_count_reward_data.received_up_to, 1)
    assert.deepEqual(result.kill_count_reward_data.reward_list, [{ kind: 1, kind_id: 49100, number: 5 }, { kind: 3, kind_id: null, number: 500 }])
    assert.equal(players.getPlayerSync(player.id).freeVmoney, before.freeVmoney + 500)
    assert.equal(inventory.getPlayerItemSync(player.id, 49100), token + 5)
    const after = state(player)
    assert.deepEqual(response(await summary()).data.kill_count_reward_data.reward_list, [])
    assert.deepEqual(state(player), after)
    const store = operations.contentOperations(), instance = store.state(key).instanceId
    control(key, true, `23:${quest}`)
    assert.equal(store.state(key).instanceId, instance)
    assert.deepEqual(state(player), after)
    assert.deepEqual(state(other), foreign)
})

test('old Raid4 each-kill reward counts communal kills, has an independent cursor and survives closure', async () => {
    const player = fixture(), key = 'raid_event:4'
    control(key, false, '23:4001')
    global(4, 1003)
    db.prepare('INSERT INTO players_raid_event_overall_rewards(player_id,event_id,received_up_to,updated_at) VALUES(?,?,?,?)').run(player.id, 4, 1000, Date.now())
    const before = players.getPlayerSync(player.id), item = inventory.getPlayerItemSync(player.id, 100000) ?? 0
    response(await post(player, '/raid/summary', { event_id: 4 }))
    assert.equal(players.getPlayerSync(player.id).freeMana, before.freeMana + 1500)
    assert.equal(inventory.getPlayerItemSync(player.id, 100000), item + 75)
    const saved = state(player)
    response(await post(player, '/raid/summary', { event_id: 4 }))
    assert.deepEqual(state(player), saved)
    assert.equal(db.prepare('SELECT received_up_to FROM players_raid_event_overall_rewards WHERE player_id=? AND event_id=4').get(player.id).received_up_to, 1003)
})

test('old Raid title rewards honor the exact quest and original count band and retain prior acquired time', async () => {
    const player = fixture(), key = 'raid_event:2'
    control(key, false, '23:2001')
    const insert = db.prepare('INSERT INTO raid_event_global_kill_ledger(event_id,play_id,player_id,quest_id,created_at) VALUES(?,?,?,?,?)')
    for (let index = 0; index < 100; index++) insert.run(2, randomUUID(), player.id, 2001, index)
    degrees.grantPlayerDegreeSync(player.id, 63024, 17)
    const saved = state(player)
    assert.deepEqual(response(await post(player, '/raid/ranking_reward', { event_id: 2 })).data.degree_list, [])
    assert.deepEqual(state(player), saved)
    for (let index = 0; index < 10; index++) insert.run(2, randomUUID(), player.id, 2002, index)
    assert.deepEqual(response(await post(player, '/raid/ranking_reward', { event_id: 2 })).data.degree_list.map(row => row.degree_id), [63023])
    assert.equal(db.prepare('SELECT acquired_at FROM players_degrees WHERE player_id=? AND degree_id=63024').get(player.id).acquired_at, 17)
    assert.deepEqual(response(await post(player, '/raid/ranking_reward', { event_id: 2 })).data.degree_list, [])
})

test('all seven historical ranking parents run real start/finish and pay their original local-ranking band only once after closure', async () => {
    const definitions = require('../assets/ranking_event_ranking_reward.json').events
    for (const id of [1, 2, 3, 4, 5, 1000, 1001]) {
        const player = fixture(), quest = load('lib/activity-degree-rewards').rankingEventIdQuestMap[id], key = `ranking_event:${id}`
        control(key, true, `11:${quest}`)
        const empty = state(player)
        response(await post(player, '/ranking/receive_reward', { ranking_event_id: id }))
        assert.deepEqual(state(player), empty, 'no completed result means no payment or receipt')
        const play = randomUUID()
        assert.equal(response(await start(player, 11, quest, play)).data_headers.result_code, 1)
        control(key, false, `11:${quest}`)
        assert.equal(response(await finish(player, 11, quest, play)).data_headers.result_code, 1)
        const before = players.getPlayerSync(player.id)
        const placement = load('lib/activity-degree-rewards').getRankingPlacementSync(player.id, id)
        const band = definitions[id].filter(row => row.maxPercentile >= placement.percentile).sort((a, b) => a.maxPercentile - b.maxPercentile)[0]
        const money = kind => band.rewards.filter(row => row.kind === kind).reduce((sum, row) => sum + row.number, 0)
        const receipt = response(await post(player, '/ranking/receive_reward', { ranking_event_id: id })).data
        assert.equal(players.getPlayerSync(player.id).freeMana, before.freeMana + money(3))
        assert.equal(players.getPlayerSync(player.id).freeVmoney, before.freeVmoney + money(2))
        if (id >= 1000) assert.equal(money(3), 20000)
        const paid = state(player)
        assert.deepEqual(response(await post(player, '/ranking/receive_reward', { ranking_event_id: id })).data, { ...receipt, status: 2 })
        assert.deepEqual(state(player), paid)
        control(key, true, `11:${quest}`)
        response(await post(player, '/ranking/receive_reward', { ranking_event_id: id }))
        assert.deepEqual(state(player), paid)
    }
})

test('ranking material payout and receipt roll back together while an existing degree remains byte-identical', async () => {
    const player = fixture(), quest = 1001
    // Real existing private-server competitors, represented by synthetic persisted results.
    for (let index = 0; index < 35; index++) {
        const other = fixture()
        load('data/domains/quest').insertPlayerQuestProgressSync(other.id, 11, { questId: quest, finished: true, bestElapsedTimeMs: 100000 })
    }
    control('ranking_event:1', true, `11:${quest}`)
    const play = randomUUID()
    assert.equal(response(await start(player, 11, quest, play)).data_headers.result_code, 1)
    assert.equal(response(await finish(player, 11, quest, play)).data_headers.result_code, 1)
    degrees.grantPlayerDegreeSync(player.id, 54040, 17)
    const saved = state(player)
    db.exec(`CREATE TEMP TRIGGER historical_rank_claim_failure BEFORE INSERT ON main.player_operation_receipts
        WHEN NEW.operation='ranking_event_reward' AND NEW.player_id=${player.id}
        BEGIN SELECT RAISE(ABORT,'synthetic ranking receipt failure'); END`)
    try { assert.equal((await post(player, '/ranking/receive_reward', { ranking_event_id: 1 })).statusCode, 500); assert.deepEqual(state(player), saved) }
    finally { db.exec('DROP TRIGGER historical_rank_claim_failure') }
    response(await post(player, '/ranking/receive_reward', { ranking_event_id: 1 }))
    assert.equal(db.prepare('SELECT acquired_at FROM players_degrees WHERE player_id=? AND degree_id=54040').get(player.id).acquired_at, 17)
    assert.ok(db.prepare('SELECT 1 FROM player_operation_receipts WHERE player_id=? AND operation=? AND request_key=?').get(player.id, 'ranking_event_reward', '1'))
})
