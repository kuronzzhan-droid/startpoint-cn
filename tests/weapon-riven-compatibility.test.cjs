const assert = require('node:assert/strict')
const { test, after } = require('node:test')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto')
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'riven-compatibility-'))
process.env.DATA_DIR = path.join(directory, 'data')
process.env.GACHA_SEED_DIR = path.join(directory, 'seeds')
process.env.CLIENT_ADMISSION_CONFIG = path.join(directory, 'policy.json')
process.env.CLIENT_ADMISSION_KEYS = path.join(directory, 'keys.json')
const key = crypto.randomBytes(32).toString('hex')
fs.writeFileSync(process.env.CLIENT_ADMISSION_CONFIG, JSON.stringify({ enforce: false, updateMessage: 'update',
    builds: [{ id: 'riven', name: 'riven', enabled: true, allowUntil: null, capabilities: ['weapon-riven-v1'] }] }))
fs.writeFileSync(process.env.CLIENT_ADMISSION_KEYS, JSON.stringify({ riven: key }))
require('ts-node/register/transpile-only')
const Fastify = require('fastify'), { unpack } = require('msgpackr')
const { getDb } = require('../src/data/db')
const { insertAccountSync } = require('../src/data/domains/account')
const { insertDefaultPlayerSync } = require('../src/data/domains/player')
const { insertSessionWithTokenSync } = require('../src/data/domains/session')
const { updatePlayerPartySync, getPlayerPartyGroupListSync } = require('../src/data/domains/party')
const { insertWeaponRivenSync } = require('../src/data/domains/weaponRiven')
const { runPersistenceTransactionSync } = require('../src/lib/persistence-coordinator')
const { clientAdmission, proofMessage } = require('../src/lib/client-admission')
const { CnResponseWorkerPool } = require('../src/lib/cn-response-worker-pool')
const { installCnResponseEncoding } = require('../src/lib/cn-response-hook')
const account = insertAccountSync({ appId: 'riven-test', idpAlias: 'test', idpCode: 'riven-test', idpId: 'compat', status: 'active' })
const player = insertDefaultPlayerSync(account.id)
const viewerId = 710009401
insertSessionWithTokenSync({ token: String(viewerId), accountId: account.id, expires: new Date(Date.now() + 600000), type: 2 })
const gate = clientAdmission()
const challenge = gate.challenge({ build: 'riven', protocol: 1 }, 'local').data
const token = gate.prove({ challenge: challenge.challenge, proof: crypto.createHmac('sha256', Buffer.from(key, 'hex'))
    .update(proofMessage('riven', challenge.challenge, challenge.nonce)).digest('hex') }, 'local').data.token
gate.bind(token, 'riven-session')
const modernHeaders = { 'x-sp-admission': token, 'x-sp-session': 'riven-session' }
const instance = runPersistenceTransactionSync({ domain: 'player', playerId: player.id, operation: 'riven_fixture' }, () =>
    insertWeaponRivenSync(player.id, 100001, [[15990001, 50]], 'compatibility', () => 0))
assert.equal(instance, 16000001)
getDb().prepare('INSERT INTO players_items(player_id,id,amount) VALUES (?,?,?)').run(player.id, 16000000, 3)
const baseParty = { name: 'riven', characterIds: [1, null, null], unisonCharacterIds: [null, null, null],
    equipmentIds: [null, null, null], abilitySoulIds: [instance, 16000000, null], edited: true,
    options: { allowOtherPlayersToHealMe: true }, category: 1 }
updatePlayerPartySync(player.id, 1, baseParty, 1)
const pool = new CnResponseWorkerPool({ size: 1, minimumObjectBytes: 0,
    workerPath: path.resolve(__dirname, '../out/workers/cn-response-worker.js') })
const app = Fastify()
installCnResponseEncoding(app, { pool, compression: { mode: 'off', minimumBytes: 0, log: false } })
app.register(require('../src/routes/cn/load').default, { prefix: '/api/index.php' })
app.register(require('../src/routes/api/party').default, { prefix: '/party' })
app.register(require('../src/routes/api/quest').default, { prefix: '/quest' })
app.register(require('../src/routes/api/rushEvent').default, { prefix: '/rush' })
const post = async (url, payload, headers = {}) => {
    const response = await app.inject({ method: 'POST', url, payload, headers })
    assert.equal(response.statusCode, 200, response.body)
    return unpack(Buffer.from(response.body, 'base64'))
}
const edit = (souls, category = 1) => ({ viewer_id: viewerId, main_party_id: 1, party_info_list: [{
    party_id: 1, party_category: category, party_name: 'riven edit', party_edited: true,
    character_ids: [1, null, null], unison_character_ids: [null, null, null], equipment_ids: [null, null, null],
    ability_soul_ids: souls, options: { allow_other_players_to_heal_me: true },
}] })
after(async () => { await app.close(); gate.close(); getDb().close(); fs.rmSync(directory, { recursive: true, force: true }) })

test('real /load worker output contains owned instances only for authenticated capable builds', async () => {
    const modern = await post('/api/index.php/load', { viewer_id: viewerId }, modernHeaders)
    assert.equal(modern.data.item_list[instance], 1)
    assert.equal(modern.data.item_list[16000000], 3)
    assert.equal(modern.data.user_weapon_riven_list[instance].riven_id, 1)
    assert.deepEqual(modern.data.user_party_group_list[1].list[1].ability_soul_ids, [instance, 16000000, null])
    const legacy = await post('/api/index.php/load', { viewer_id: viewerId }, { 'x-sp-capabilities': 'weapon-riven-v1' })
    assert.equal('user_weapon_riven_list' in legacy.data, false)
    assert.equal(instance in legacy.data.item_list, false)
    assert.equal(legacy.data.item_list[16000000], 3)
    assert.deepEqual(legacy.data.user_party_group_list[1].list[1].ability_soul_ids, [null, 16000000, null])
    assert.equal(pool.snapshot().completedObjects, 2, 'both actual load responses used a worker')
    assert.equal(pool.snapshot().fallback, 0)
    assert.equal(getDb().prepare('SELECT COUNT(*) AS n FROM players_items WHERE player_id=? AND id=?').get(player.id, instance).n, 0)
})

test('real party saves preserve legacy hidden slots in normal and favorite groups and reject forged instances', async () => {
    for (const category of [1, 99]) {
        updatePlayerPartySync(player.id, 1, { ...baseParty, category }, 1)
        const legacy = await post('/party/edit', edit([null, 16000200, null], category))
        assert.equal(legacy.data_headers.result_code, 1)
        assert.deepEqual(getPlayerPartyGroupListSync(player.id, category)[1].list[1].abilitySoulIds, [instance, null, null])
        await post('/party/edit', edit([16000000, null, null], category))
        assert.deepEqual(getPlayerPartyGroupListSync(player.id, category)[1].list[1].abilitySoulIds, [16000000, null, null],
            'an explicit legacy soul replacement must override the hidden instance')
        const forged = await post('/party/edit', edit([instance, 16000200, 16000000], category), modernHeaders)
        assert.equal(forged.data_headers.result_code, 1)
        assert.deepEqual(getPlayerPartyGroupListSync(player.id, category)[1].list[1].abilitySoulIds, [instance, null, 16000000])
        await post('/party/edit', edit([null, null, null], category), modernHeaders)
        assert.deepEqual(getPlayerPartyGroupListSync(player.id, category)[1].list[1].abilitySoulIds, [null, null, null])
    }
    const stringInjection = await app.inject({ method: 'POST', url: '/party/edit',
        payload: edit(['16000200', null, null]), headers: modernHeaders })
    assert.equal(stringInjection.statusCode, 400, 'SQLite numeric affinity must not bypass instance ownership')
    assert.deepEqual(getPlayerPartyGroupListSync(player.id)[1].list[1].abilitySoulIds, [null, null, null])
})

test('legacy party saves do not restore a hidden instance that no longer exists', async () => {
    const removed = runPersistenceTransactionSync({ domain: 'player', playerId: player.id, operation: 'riven_fixture' }, () =>
        insertWeaponRivenSync(player.id, 100001, [[15990001, 50]], 'removed-compatibility', () => 0))
    for (const category of [1, 99]) updatePlayerPartySync(player.id, 1,
        { ...baseParty, category, abilitySoulIds: [removed, null, null] }, 1)
    getDb().prepare('DELETE FROM player_weapon_rivens WHERE player_id=? AND item_id=?').run(player.id, removed)
    for (const category of [1, 99]) {
        await post('/party/edit', edit([null, null, null], category))
        assert.deepEqual(getPlayerPartyGroupListSync(player.id, category)[1].list[1].abilitySoulIds, [null, null, null])
    }
})

test('actual room snapshot, cached party, and TCP JSON boundary all encode instance souls as None', () => {
    const { buildRealParty, setRealPartySnapshot, getRealPartySnapshot } = require('../src/multi/party-snapshot')
    const { SessionManager } = require('../src/multi/state/SessionManager')
    updatePlayerPartySync(player.id, 1, baseParty, 1)
    assert.deepEqual(buildRealParty(player.id, baseParty).abilitySoulIds, [[1], [0, 16000000], [1]])
    const party = { abilitySoulIds: [[0, instance], [0, 16000000], [0, 16000200]] }
    setRealPartySnapshot(player.id, party)
    assert.deepEqual(getRealPartySnapshot(player.id).abilitySoulIds, [[1], [0, 16000000], [1]])
    const manager = new SessionManager()
    let wire
    manager.sendFrame = (_socket, frame) => { wire = JSON.parse(frame.slice(0, -1)); return { accepted: true } }
    manager.sendJson({}, [1, [1, [{ party }]]])
    assert.deepEqual(wire[1][1][0].party.abilitySoulIds, [[1], [0, 16000000], [1]])
    assert.deepEqual(party.abilitySoulIds, [[0, instance], [0, 16000000], [0, 16000200]])
})

test('public sharing strips new writes and historical payloads without affecting the source party', () => {
    const { publishPartySync, getPublishedPartySync } = require('../src/data/domains/publishedParty')
    const party = { ability_soul_ids: [instance, 16000000, 16000200] }
    const code = publishPartySync(player.id, 'riven public', party)
    assert.deepEqual(getPublishedPartySync(code).battleParty.ability_soul_ids, [null, null, null])
    const row = getDb().prepare('SELECT battle_party_json FROM published_parties WHERE code=?').get(code)
    assert.deepEqual(JSON.parse(row.battle_party_json).ability_soul_ids, [null, null, null])
    getDb().prepare('UPDATE published_parties SET battle_party_json=? WHERE code=?').run(JSON.stringify(party), code)
    assert.deepEqual(getPublishedPartySync(code).battleParty.ability_soul_ids, [null, null, null])
    assert.deepEqual(party.ability_soul_ids, [instance, 16000000, 16000200])
})

test('leaderboard stores no instance slots and strips historical round rows when read', () => {
    const leaderboard = require('../src/data/domains/leaderboard')
    const season = leaderboard.getLeaderboardSeasonSync('riven-test', 1000)
    const run = leaderboard.insertLeaderboardRunSync({ competitionKey: 'riven-test', playerId: player.id,
        playerName: 'riven', season, startedAtMs: 1000, totalRounds: 1, trackedFromRound: 1, pendingRound: 1, pendingQuestId: 1 })
    const completed = leaderboard.finishLeaderboardRoundSync({ run, round: 1, questId: 1, clientBattleMs: 500,
        finishedAtMs: 2000, party: { ...baseParty, evolutionImgLevels: [0, null, null], unisonEvolutionImgLevels: [null, null, null] } })
    assert.equal(completed.status, 'completed')
    const row = getDb().prepare('SELECT ability_soul_id_1,ability_soul_id_2 FROM leaderboard_run_rounds WHERE run_id=?').get(run.id)
    assert.deepEqual(row, { ability_soul_id_1: null, ability_soul_id_2: null })
    getDb().prepare('UPDATE leaderboard_run_rounds SET ability_soul_id_1=? WHERE run_id=?').run(instance, run.id)
    assert.deepEqual(leaderboard.getLeaderboardRunRoundsSync(run.id)[0].abilitySoulIds, [null, null, null])
})

test('COM clear snapshot compares stripped room souls with the saved instance and freezes a clean party', () => {
    const { insertDefaultPlayerCharacterSync, playerOwnsCharacterSync } = require('../src/data/domains/character')
    const ids = Object.keys(require('../assets/character.json')).map(Number).slice(0, 3)
    for (const id of ids) if (!playerOwnsCharacterSync(player.id, id)) insertDefaultPlayerCharacterSync(player.id, id)
    const { buildRealParty } = require('../src/multi/party-snapshot')
    const { captureQuestNpcPartySnapshot } = require('../src/multi/npc/quest-party-snapshot')
    const party = { ...baseParty, characterIds: ids, currentBattlePower: 12000 }
    updatePlayerPartySync(player.id, 1, party, 1)
    const wire = buildRealParty(player.id, party)
    const snapshot = captureQuestNpcPartySnapshot(player.id, 2, 1001, 1, wire)
    assert.ok(snapshot)
    assert.deepEqual(snapshot.party.abilitySoulIds, [[1], [1], [1]])
    wire.abilitySoulIds[0] = [0, instance]
    assert.deepEqual(captureQuestNpcPartySnapshot(player.id, 2, 1001, 1, wire).party.abilitySoulIds,
        [[1], [1], [1]], 'client-provided instance is stripped before the saved-party comparison')
    assert.deepEqual(getPlayerPartyGroupListSync(player.id)[1].list[1].abilitySoulIds, [instance, 16000000, null])
})


const privateMetadata = { weapon_rivens: [[0, [16000001, 100001, 15990001, 80]], [1], [1]],
    weapon_riven_scope: 'multi-v1', weapon_riven_snapshot_id: 'injected', weapon_riven_mode: 1,
    weapon_riven_catalog: 'private-catalog', weapon_riven_reason: '',
    user_weapon_riven_list: { 16000001: { pending: { private: true } } } }
const assertNoSidecars = data => assert.equal(JSON.stringify(data).includes('weapon_riven'), false)

test('public share HTTP and historical domain responses strip unknown, reserved cards and P2 fields for capable and legacy callers', async () => {
    const dirty = { ...privateMetadata, characters: [{ id: 1, mana_node_ids: [], evolution_level: 1,
        exp: 0, over_limit_step: 0, illustration_settings: null, ex_boost: null }, null, null],
        unison_characters: [null, null, null], equipments: [null, null, null],
        ability_soul_ids: [16000000, 16000999, 16000900] }
    const before = structuredClone(dirty)
    const published = await post('/party/publish', { viewer_id: viewerId, party_name: 'P2 public', battle_party: dirty }, modernHeaders)
    const code = published.data.party_code
    assert.equal(typeof code, 'string')
    const { getPublishedPartySync, publishPartySync } = require('../src/data/domains/publishedParty')
    const domainCode = publishPartySync(player.id, 'domain bypass', dirty)
    assertNoSidecars(getPublishedPartySync(domainCode))
    assertNoSidecars(JSON.parse(getDb().prepare('SELECT battle_party_json FROM published_parties WHERE code=?').get(domainCode).battle_party_json))
    getDb().prepare('UPDATE published_parties SET battle_party_json=? WHERE code=?').run(JSON.stringify(dirty), code)
    for (const headers of [{}, modernHeaders]) {
        const data = (await post('/party/refer', { viewer_id: viewerId, party_code: code }, headers)).data
        assert.deepEqual(data.battle_party.ability_soul_ids, [null, null, 16000900])
        assertNoSidecars(data)
    }
    assert.deepEqual(dirty, before)
})

test('legacy Rush public wrapper and real HTTP hide private souls while own continuation retains them', async () => {
    const eventId = 799991, rush = require('../src/data/domains/rushEvent')
    rush.insertPlayerRushEventSync(player.id, { eventId, activeRushBattleFolderId: null,
        endlessBattleMaxRound: 1, endlessBattleMaxRoundTime: 500,
        endlessBattleMaxRoundCharacterIds: [1, 2, 3], endlessBattleMaxRoundCharacterEvolutionImgLvls: [0, 0, 0] })
    rush.insertPlayerRushEventPlayedPartySync(player.id, eventId, {
        characterIds: [1, 2, 3], unisonCharacterIds: [null, null, null], equipmentIds: [null, null, null],
        abilitySoulIds: [16000000, 16000999, 16000900], evolutionImgLevels: [0, 0, 0],
        unisonEvolutionImgLevels: [null, null, null], round: 1, battleType: 2 })
    const source = require('../src/lib/rush')
    assert.equal(source.getSerializedPlayerRushEventPlayedPartiesSync(player.id, eventId).endlessParties[1].ability_soul_id_1, 16000000)
    assert.equal(source.getSerializedPlayerRushEventPlayedPartiesSync(player.id, eventId).endlessParties[1].ability_soul_id_2, 16000999)
    const direct = source.getRushEventEndlessBattleRankPlayedPartyListSync(1, eventId)[1]
    assert.deepEqual([direct.ability_soul_id_1, direct.ability_soul_id_2, direct.ability_soul_id_3], [null, null, 16000900])
    for (const headers of [{}, modernHeaders]) {
        const data = (await post('/rush/ranking/played_party', { viewer_id: viewerId, event_id: eventId, rank_number: 1 }, headers)).data
        const party = data.rush_ranking_party[1]
        assert.deepEqual([party.ability_soul_id_1, party.ability_soul_id_2, party.ability_soul_id_3], [null, null, 16000900])
        assertNoSidecars(data)
    }
})

test('new leaderboard historical presentation and HTTP use the same public policy', async () => {
    const leaderboard = require('../src/data/domains/leaderboard')
    const { getLeaderboardCompetition, getLeaderboardCompetitionSeasonSync } = require('../src/lib/leaderboard/competition')
    const competition = getLeaderboardCompetition('rush:700099:1'), now = Date.now()
    const season = getLeaderboardCompetitionSeasonSync(competition.key, now)
    const run = leaderboard.insertLeaderboardRunSync({ competitionKey: competition.key, playerId: player.id,
        playerName: 'public test', season, startedAtMs: now, totalRounds: 1, trackedFromRound: 1, pendingRound: 1, pendingQuestId: 1 })
    leaderboard.finishLeaderboardRoundSync({ run, round: 1, questId: 1, clientBattleMs: 500,
        finishedAtMs: now + 1000, party: { ...baseParty, abilitySoulIds: [16000000, 16000999, 16000900],
            evolutionImgLevels: [0, null, null], unisonEvolutionImgLevels: [null, null, null] } })
    getDb().prepare('UPDATE leaderboard_run_rounds SET ability_soul_id_1=?,ability_soul_id_2=? WHERE run_id=?').run(16000000, 16000999, run.id)
    for (const headers of [{}, modernHeaders]) {
        const data = (await post('/rush/ranking/played_party', { viewer_id: viewerId, event_id: competition.eventId, rank_number: 1 }, headers)).data
        const party = data.rush_ranking_party[1]
        assert.ok(party, 'historical completed run appears in the public ranking')
        assert.deepEqual([party.ability_soul_id_1, party.ability_soul_id_2, party.ability_soul_id_3], [null, null, 16000900])
        assertNoSidecars(data)
    }
})

test('recommendation identity check precedes public storage and dirty historical HTTP output is clean for both build types', async () => {
    const account2 = insertAccountSync({ appId: 'public-source', idpAlias: '', idpCode: 'test', idpId: 'public-source', status: 'active' })
    const source = insertDefaultPlayerSync(account2.id), ids = Object.keys(require('../assets/character.json')).map(Number).slice(0, 3)
    const characters = require('../src/data/domains/character')
    for (const id of ids) if (!characters.playerOwnsCharacterSync(source.id, id)) characters.insertDefaultPlayerCharacterSync(source.id, id)
    const saved = { ...baseParty, characterIds: ids, abilitySoulIds: [16000000, 16000999, 16000900], currentBattlePower: 12000 }
    updatePlayerPartySync(source.id, 1, saved, 1)
    const history = require('../src/lib/quest/recommended-party-history')
    const party = { ...privateMetadata, characters: ids.map(id => ({ id })), unison_characters: [null, null, null],
        equipments: [null, null, null], ability_soul_ids: saved.abilitySoulIds }
    const context = { playerId: source.id, questCategory: 1, questId: 1001001, questAccomplished: true,
        partySlot: 1, party, player: require('../src/data/domains/player').getPlayerSync(source.id) }
    assert.equal(history.recordQuestRecommendedPartySync({ ...context, party: { ...party, ability_soul_ids: [null, null, null] } }), false,
        'private identity is checked before stripping public slots')
    assert.equal(history.recordQuestRecommendedPartySync(context), true)
    const row = getDb().prepare('SELECT party_payload FROM quest_npc_party_pool WHERE source_player_id=?').get(source.id)
    const stored = JSON.parse(row.party_payload)
    assert.deepEqual([stored.ability_soul_id_1, stored.ability_soul_id_2, stored.ability_soul_id_3], [null, null, 16000900])
    assertNoSidecars(stored)
    getDb().prepare('UPDATE quest_npc_party_pool SET party_payload=? WHERE source_player_id=?').run(JSON.stringify({ ...stored,
        ...privateMetadata, ability_soul_id_1: 16000000, ability_soul_id_2: 16000999 }), source.id)
    for (const headers of [{}, modernHeaders]) {
        const data = (await post('/quest/get_recent_other_player_party', { viewer_id: viewerId, category: 1, quest_id: 1001001 }, headers)).data
        assert.equal(data.recent_other_player_party.length, 1)
        const party = data.recent_other_player_party[0]
        assert.deepEqual([party.ability_soul_id_1, party.ability_soul_id_2, party.ability_soul_id_3], [null, null, 16000900])
        assertNoSidecars(data)
    }
    assert.deepEqual(getPlayerPartyGroupListSync(source.id)[1].list[1].abilitySoulIds, saved.abilitySoulIds)
})
