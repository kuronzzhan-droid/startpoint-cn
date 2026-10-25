'use strict'
const test = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { spawn } = require('node:child_process')
const Fastify = require('fastify')
const replay = process.env.RUSH_ROSTER_REPLAY ? JSON.parse(process.env.RUSH_ROSTER_REPLAY) : null
const root = os.tmpdir()
const directory = replay?.directory ?? fs.mkdtempSync(path.join(root, 'rush-battle-roster-'))
Object.assign(process.env, { DATA_DIR: directory, GACHA_SEED_DIR: path.join(directory, 'seeds'),
    CN_WRITER_THREAD: '0', GAME_ROUTINE_LOGS: 'off', GAME_VERBOSE_LOGS: 'false' })
const load = name => require(path.join(__dirname, '..', 'out', name))
load('data').initializeDatabase()
const db = load('data/db').getDb(), players = load('data/domains/player'), rush = load('data/domains/rushEvent')
const parties = load('data/domains/party'), characters = load('data/domains/character')
const single = load('routes/api/singleBattleQuest'), writer = load('lib/persistence/writer-client')
const { QuestCategory } = load('lib/types'), CATEGORY = QuestCategory.RUSH_EVENT
const alternate = 243001, sub = Number(Object.keys(require('../assets/character.json')).find(id => !['1', String(alternate)].includes(id)))
const partyCategory = eventId => load('lib/rush-party-categories').partyCategoryForRushEvent(eventId)
const quest = eventId => eventId * 1000 + 1
let app, sequence = 0

async function makeApp() {
    const value = Fastify({ logger: false })
    value.addHook('onSend', (_request, reply, payload, done) => done(null,
        String(reply.getHeader('content-type')).startsWith('application/x-msgpack') && typeof payload === 'object'
            ? JSON.stringify(payload) : payload))
    await value.register(load('routes/api/rushEvent').default, { prefix: '/rush' })
    await value.register(single.default, { prefix: '/single' })
    await value.ready()
    return value
}
function saveParty(p, category, leader = 1, withSub = true) {
    parties.updatePlayerPartySync(p.id, 1, { category, name: 'Rush roster', characterIds: [leader, null, null],
        unisonCharacterIds: [withSub ? sub : null, null, null], equipmentIds: [300101, null, null],
        abilitySoulIds: [300101, null, null], edited: true, options: { allowOtherPlayersToHealMe: true } }, 1)
}
function open(eventId) {
    const operations = load('lib/content-operations'), store = operations.contentOperations()
    const key = operations.contentCatalog.questMap[`${CATEGORY}:${quest(eventId)}`]
    assert.ok(key)
    store.update(key, { expectedRevision: store.revision(), catalogDigest: store.digest,
        reason: 'Synthetic dedicated Rush start roster regression', readiness: 'verified',
        evidence: 'Bounded synthetic battle roster fixture', endsAtMs: null,
        flags: { visible: true, enter: true, claim: true } }, Date.now())
}
function fixture(eventId = 700001) {
    const account = load('data/domains/account').insertAccountSync({ appId: 'wf_cn', idpAlias: '', idpCode: 'rush-roster',
        idpId: `rush-roster-${++sequence}`, status: 'normal' })
    const p = { id: players.insertDefaultPlayerSync(account.id).id, eventId, viewer: 867000000 + sequence }
    load('data/activeAccount').saveAccountDefaultPlayer(account.id, p.id)
    load('data/domains/session').insertSessionWithTokenSync({ token: String(p.viewer), accountId: account.id,
        type: 2, expires: new Date('2099-01-01T00:00:00Z') })
    for (const id of [sub, alternate]) assert.ok(load('lib/character').givePlayerCharacterSync(p.id, id))
    for (const id of [1, sub, alternate]) characters.updatePlayerCharacterSync(p.id, id, { exp: 0 })
    players.updatePlayerSync({ id: p.id, rankPoint: 1_000_000_000, partySlot: 1 })
    saveParty(p, 1, alternate, false)
    saveParty(p, partyCategory(eventId))
    if (!rush.getPlayerRushEventSync(p.id, eventId)) rush.insertPlayerRushEventSync(p.id, rush.getDefaultPlayerRushEventSync(eventId))
    if (eventId === 700100) rush.insertPlayerRushEventClearedFolderSync(p.id, 700099, 1)
    open(eventId)
    return p
}
const stats = (leader = alternate) => ({ clear_phase: 1, party: { characters: [{ id: leader }, null, null],
    unison_characters: [null, null, null], equipments: [{ id: 300102 }, null, null], ability_soul_ids: [300102, null, null] } })
const start = (p, play, extra = {}) => app.inject({ method: 'POST', url: '/rush/battle/start', payload: {
    viewer_id: p.viewer, quest_id: quest(p.eventId), party_id: 1, play_id: play, is_auto_start_mode: false, ...extra } })
const finish = (p, play, extra = {}) => app.inject({ method: 'POST', url: '/single/finish', payload: {
    viewer_id: p.viewer, quest_id: quest(p.eventId), category: CATEGORY, play_id: play, continue_count: 0,
    elapsed_time_ms: 1000, score: 100, add_mana: 0, is_accomplished: true, is_restored: false,
    statistics: stats(), api_count: 2, ...extra } })
function decode(result) {
    assert.equal(result.statusCode, 200, result.body)
    const body = result.json()
    assert.equal(body.data_headers.result_code, 1, result.body)
    return body
}
const identifier = value => `"${value.replaceAll('"', '""')}"`
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()
    .map(({ name }) => ({ name, columns: db.prepare(`PRAGMA table_info(${identifier(name)})`).all().map(row => row.name) }))
    .filter(row => row.name === 'players' || row.columns.includes('player_id') || row.columns.includes('source_player_id'))
function snapshot(p) {
    return Object.fromEntries(tables.map(({ name, columns }) => {
        const owner = name === 'players' ? 'id' : columns.includes('player_id') ? 'player_id' : 'source_player_id'
        const rows = db.prepare(`SELECT * FROM ${identifier(name)} WHERE ${identifier(owner)}=?`).all(p.id)
        return [name, rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))]
    }))
}
const exp = (p, id) => characters.getPlayerCharacterSync(p.id, id).exp
function assertOriginalParty(p) {
    const amount = load('lib/assets').getQuestFromCategorySync(CATEGORY, quest(p.eventId)).characterExpReward
    assert.equal(exp(p, 1), amount)
    assert.equal(exp(p, sub), amount)
    assert.equal(exp(p, alternate), 0)
    const row = db.prepare('SELECT * FROM players_rush_events_played_parties WHERE player_id=? AND event_id=? AND round=?')
        .get(p.id, p.eventId, quest(p.eventId))
    assert.ok(row, 'the actual non-final round records its played party')
    assert.equal(row.character_id_1, 1)
    assert.equal(row.unison_character_id_1, sub)
    assert.equal(row.equipment_id_1, 300101)
    assert.equal(row.ability_soul_id_1, 300101)
    const facts = load('data/domains/character_clear')
    assert.equal(facts.getPlayerCharacterClearSync(p.id, 1).leader_clear_count, 1)
    assert.equal(facts.getPlayerCharacterClearSync(p.id, sub).clear_count, 1)
    assert.equal(facts.getPlayerCharacterClearSync(p.id, alternate).clear_count, 0)
}
async function freshFinish(p, play) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [__filename], { cwd: path.resolve(__dirname, '..'), windowsHide: true,
            env: { ...process.env, RUSH_ROSTER_REPLAY: JSON.stringify({ directory, player: p, play }) }, stdio: ['ignore', 'pipe', 'pipe'] })
        let output = '', errors = ''
        const timer = setTimeout(() => { child.kill(); reject(new Error(`Rush pending recovery timeout: ${errors}`)) }, 30000)
        child.stdout.on('data', chunk => { output += chunk }); child.stderr.on('data', chunk => { errors += chunk })
        child.once('error', error => { clearTimeout(timer); reject(error) })
        child.once('exit', code => {
            clearTimeout(timer)
            if (code !== 0) return reject(new Error(`Rush pending recovery exited ${code}: ${errors}\n${output}`))
            const line = output.split(/\r?\n/).find(value => value.startsWith('RUSH_ROSTER_RESULT:'))
            if (!line) return reject(new Error(`Missing Rush recovery proof: ${output}`))
            resolve(JSON.parse(line.slice('RUSH_ROSTER_RESULT:'.length)))
        })
    })
}
async function close() {
    try { await writer.stopSqliteWriter(); if (app) await app.close() }
    finally { try { await load('lib/seed-validator').default.close() } finally { if (db.open) db.close() } }
}
if (replay) {
    void (async () => {
        try { app = await makeApp(); console.log(`RUSH_ROSTER_RESULT:${JSON.stringify(decode(await finish(replay.player, replay.play)))}`) }
        finally { await close() }
    })().catch(error => { console.error(error); process.exitCode = 1 })
} else {
    test.before(async () => { app = await makeApp() })
    test.after(async () => {
        try { await close() } finally {
            assert.equal(path.dirname(fs.realpathSync(directory)), fs.realpathSync(root))
            fs.rmSync(directory, { recursive: true })
        }
    })
    for (const mode of ['in-process', 'writer']) test(`dedicated Rush roster (${mode})`, async t => {
        if (mode === 'writer') {
            process.env.CN_WRITER_THREAD = '1'
            assert.equal(writer.startSqliteWriter(db.name), true)
            assert.equal(await writer.waitForSqliteWriterReady(30000), true)
        }
        for (const eventId of [700001, 700099, 700100, 700098]) await t.test(`event ${eventId} freezes its own category instead of NORMAL and keeps all four slot groups`, async () => {
            const p = fixture(eventId), play = `rush-category-${p.id}`
            decode(await start(p, play))
            saveParty(p, partyCategory(eventId), alternate, false)
            decode(await finish(p, play))
            assertOriginalParty(p)
        })
        await t.test('same-play retries preserve clock, roster, leaderboard run and folder progress', async () => {
            const p = fixture(700099), play = `rush-repeat-${p.id}`
            decode(await start(p, play))
            const before = snapshot(p), memory = structuredClone(single.activeQuests[p.id])
            saveParty(p, partyCategory(p.eventId), alternate, false)
            const edited = snapshot(p)
            decode(await start(p, play))
            assert.deepEqual(snapshot(p), edited)
            assert.deepEqual(single.activeQuests[p.id], memory)
            for (const extra of [{ party_id: 2 }, { is_auto_start_mode: true }, { quest_id: quest(p.eventId) + 1 }]) {
                assert.equal((await start(p, play, extra)).statusCode, 400)
                assert.deepEqual(snapshot(p), edited)
            }
            assert.ok(before.players_active_quests.length)
        })
        await t.test('the next Rogue round keeps earlier played parties and continues the same leaderboard run', async () => {
            const p = fixture(700099), firstPlay = `rogue-first-${p.id}`, nextPlay = `rogue-next-${p.id}`
            decode(await start(p, firstPlay))
            decode(await finish(p, firstPlay))
            const earlier = db.prepare('SELECT * FROM players_rush_events_played_parties WHERE player_id=? AND event_id=? AND round=?')
                .get(p.id, p.eventId, quest(p.eventId))
            const run = db.prepare("SELECT * FROM leaderboard_runs WHERE player_id=? AND status='active'").get(p.id)
            assert.ok(run)
            decode(await start(p, nextPlay, { quest_id: quest(p.eventId) + 1 }))
            assert.equal(db.prepare("SELECT id FROM leaderboard_runs WHERE player_id=? AND status='active'").get(p.id).id, run.id)
            assert.deepEqual(db.prepare('SELECT * FROM players_rush_events_played_parties WHERE player_id=? AND event_id=? AND round=?')
                .get(p.id, p.eventId, quest(p.eventId)), earlier)
            decode(await finish(p, nextPlay, { quest_id: quest(p.eventId) + 1 }))
            assert.equal(db.prepare('SELECT COUNT(*) n FROM players_rush_events_played_parties WHERE player_id=? AND event_id=? AND battle_type=0')
                .get(p.id, p.eventId).n, 2)
        })
        await t.test('late receipt SQL failure rolls back roster rewards, event round and tasks then retries once', async () => {
            const p = fixture(), play = `rush-rollback-${p.id}`
            decode(await start(p, play)); saveParty(p, partyCategory(p.eventId), alternate, false)
            const before = snapshot(p), memory = structuredClone(single.activeQuests[p.id]), prior = writer.sqliteWriterStats()
            memory.battleRoster ??= null // The legacy resolver hydrates absence from the nullable persisted column.
            db.exec(`CREATE TRIGGER rush_roster_fault BEFORE INSERT ON player_operation_receipts WHEN NEW.player_id=${p.id}
                AND NEW.operation='quest_finish.single' BEGIN SELECT RAISE(ABORT, 'injected Rush roster fault'); END`)
            try {
                const failed = await finish(p, play)
                assert.equal(failed.statusCode, 500)
                assert.match(failed.body, /injected Rush roster fault/)
                assert.deepEqual(snapshot(p), before)
                assert.deepEqual(single.activeQuests[p.id], memory)
                if (mode === 'writer') assert.ok(writer.sqliteWriterStats().failed > prior.failed)
            } finally { db.exec('DROP TRIGGER rush_roster_fault') }
            const first = decode(await finish(p, play)); assertOriginalParty(p)
            const paid = snapshot(p)
            assert.deepEqual(decode(await finish(p, play, { api_count: 99 })), first)
            assert.deepEqual(snapshot(p), paid)
        })
        await t.test('an unsettled dedicated start survives a fresh process without its mutable SET', async () => {
            const p = fixture(), play = `rush-restart-${p.id}`
            decode(await start(p, play)); saveParty(p, partyCategory(p.eventId), alternate, false)
            delete single.activeQuests[p.id]
            await freshFinish(p, play)
            assertOriginalParty(p)
        })
        await t.test('legacy NULL and reserved recommended sources remain bounded reported-party compatibility paths', async () => {
            for (const reserved of [false, true]) {
                const p = fixture(), play = `rush-legacy-${p.id}`
                decode(await start(p, play, { party_id: reserved ? 1000 : 1 }))
                if (!reserved) db.prepare('UPDATE players_active_quests SET battle_roster_json=NULL WHERE player_id=?').run(p.id)
                delete single.activeQuests[p.id]
                saveParty(p, partyCategory(p.eventId), 1)
                decode(await finish(p, play))
                assert.equal(exp(p, 1), 0)
                assert.equal(exp(p, alternate), load('lib/assets').getQuestFromCategorySync(CATEGORY, quest(p.eventId)).characterExpReward)
            }
        })
        await t.test('a fixed-party dedicated start preserves its reference and zero-owned-EXP duplicate compatibility', async t => {
            const p = fixture(), play = `rush-fixed-${p.id}`, assets = load('lib/assets'), original = assets.getQuestFromCategorySync
            const hook = t.mock.method(assets, 'getQuestFromCategorySync', (category, questId) => {
                const value = original(category, questId)
                return category === CATEGORY && questId === quest(p.eventId) ? { ...value, fixedParty: 23 } : value
            })
            try {
                decode(await start(p, play))
                const fixedStats = stats(); fixedStats.party.unison_characters[0] = { id: alternate }
                const result = decode(await finish(p, play, { statistics: fixedStats }))
                assert.equal(exp(p, 1), 0); assert.equal(exp(p, sub), 0); assert.equal(exp(p, alternate), 0)
                assert.deepEqual(result.data.add_exp_list.map(row => [row.character_id, row.add_exp]), [[alternate, 0]])
            } finally { hook.mock.restore() }
        })
    })
}
