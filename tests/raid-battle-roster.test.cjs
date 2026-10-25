'use strict'

const test = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { spawn } = require('node:child_process')
const Fastify = require('fastify')
const replay = process.env.RAID_ROSTER_REPLAY ? JSON.parse(process.env.RAID_ROSTER_REPLAY) : null
const repository = path.resolve(__dirname, '..'), root = path.resolve(process.env.STARPOINT_TEST_TMP_ROOT || os.tmpdir())
fs.mkdirSync(root, { recursive: true })
const directory = replay?.directory ?? fs.mkdtempSync(path.join(root, 'raid-battle-roster-'))
Object.assign(process.env, { DATA_DIR: directory, GACHA_SEED_DIR: path.join(directory, 'seeds'),
    CN_WRITER_THREAD: '0', GAME_ROUTINE_LOGS: 'off', GAME_VERBOSE_LOGS: 'false' })
const load = name => require(path.join(repository, 'out', name))
const timers = [], originalInterval = global.setInterval
let db, players, parties, characters, single, writer, assets
try {
    global.setInterval = (...args) => { const timer = originalInterval(...args); timers.push(timer); return timer }
    load('data').initializeDatabase()
    db = load('data/db').getDb(); players = load('data/domains/player'); parties = load('data/domains/party')
    characters = load('data/domains/character'); single = load('routes/api/singleBattleQuest')
    writer = load('lib/persistence/writer-client'); assets = load('lib/assets')
} finally { global.setInterval = originalInterval }
assert.equal(path.dirname(fs.realpathSync(db.name)), fs.realpathSync(directory))

const CATEGORY = 23, EVENT = 7, QUEST = 7001, RAID_PARTY_CATEGORY = 3
const MAIN = 1, UNISON = 111015, SUB1 = 243001, SUB1_UNISON = 131012, SUB2 = 141007, SUB2_UNISON = 151001
const ALTERNATE = 121002, UNOWNED = 141004, MEMBERS = [MAIN, UNISON, SUB1, SUB1_UNISON, SUB2, SUB2_UNISON, ALTERNATE]
let app, sequence = 0

async function makeApp() {
    const value = Fastify({ logger: false })
    value.addHook('onSend', (_request, reply, payload, done) => done(null,
        String(reply.getHeader('content-type')).startsWith('application/x-msgpack') && typeof payload === 'object'
            ? JSON.stringify(payload) : payload))
    await value.register(load('routes/api/raidEvent').default, { prefix: '/raid' })
    await value.register(single.default, { prefix: '/single' })
    await value.ready()
    return value
}
const savedParty = (leader, unison, equipment = 300101) => ({ category: RAID_PARTY_CATEGORY, name: `Raid ${leader}`,
    characterIds: [leader, null, null], unisonCharacterIds: [unison, null, null],
    equipmentIds: [equipment, null, null], abilitySoulIds: [equipment, null, null], edited: true,
    options: { allowOtherPlayersToHealMe: true } })
function saveGroup(p, group, pairs) {
    pairs.forEach(([leader, unison], index) => parties.updatePlayerPartySync(p.id, index + 1, savedParty(leader, unison), group))
}
function editGroup(p, group = 1) {
    for (let slot = 1; slot <= 3; slot++) parties.updatePlayerPartySync(p.id, slot, savedParty(ALTERNATE, null, 300102), group)
    players.updatePlayerSync({ id: p.id, partySlot: 11 })
}
function openRaid() {
    const operations = load('lib/content-operations'), store = operations.contentOperations()
    const key = operations.contentCatalog.questMap[`${CATEGORY}:${QUEST}`]
    assert.ok(key)
    const review = { readiness: 'verified', evidence: 'Native Raid three-party fixture in isolated storage', endsAtMs: null }
    store.update(key, { expectedRevision: store.revision(), catalogDigest: store.digest,
        reason: 'Synthetic native-valid Raid three-party roster regression',
        actionOverrides: { visible: { ...review, enabled: true },
            enter: { ...review, enabled: true, questKeys: [`${CATEGORY}:${QUEST}`] },
            exchange: { ...review, enabled: true } } }, Date.now())
    const box = load('lib/content-box-associations').getContentBoxAssociation(key)
    assert.ok(box?.boxKey, 'the native Raid reward-box association is part of its entrance contract')
    store.update(box.boxKey, { expectedRevision: store.revision(), catalogDigest: store.digest,
        reason: 'Synthetic paired native Raid reward-box entry',
        actionOverrides: { visible: { ...review, enabled: true }, enter: { ...review, enabled: true } } }, Date.now())
    assert.equal(operations.isContentQuestOpenAt(CATEGORY, QUEST), true)
}
function fixture() {
    const account = load('data/domains/account').insertAccountSync({ appId: 'wf_cn', idpAlias: '', idpCode: 'raid-roster',
        idpId: `raid-roster-${++sequence}`, status: 'normal' })
    const p = { id: players.insertDefaultPlayerSync(account.id).id, viewer: 868000000 + sequence }
    load('data/activeAccount').saveAccountDefaultPlayer(account.id, p.id)
    load('data/domains/session').insertSessionWithTokenSync({ token: String(p.viewer), accountId: account.id,
        type: 2, expires: new Date('2099-01-01T00:00:00Z') })
    for (const id of MEMBERS) {
        if (characters.getPlayerCharacterSync(p.id, id) === null) characters.insertDefaultPlayerCharacterSync(p.id, id)
        assert.ok(assets.getCharacterDataSync(id), `fixture uses actual character ${id}`)
        characters.updatePlayerCharacterSync(p.id, id, { exp: 0 })
    }
    players.updatePlayerSync({ id: p.id, rankPoint: 1_000_000_000, partySlot: 1 })
    parties.updatePlayerPartySync(p.id, 1, { ...savedParty(ALTERNATE, null), category: 1 }, 1)
    p.groups = { 1: [[MAIN, UNISON], [SUB1, SUB1_UNISON], [SUB2, SUB2_UNISON]],
        2: [[ALTERNATE, SUB2_UNISON], [SUB1, UNISON], [SUB2, SUB1_UNISON]] }
    for (const [group, pairs] of Object.entries(p.groups)) saveGroup(p, Number(group), pairs)
    openRaid()
    return p
}
function party(leader = ALTERNATE, unison = null, equipment = 300102) {
    return { characters: [leader === null ? null : { id: leader }, null, null],
        unison_characters: [unison === null ? null : { id: unison }, null, null],
        equipments: [{ id: equipment }, null, null], ability_soul_ids: [equipment, null, null] }
}
const statistics = (subId = 0, leader = ALTERNATE, unison = null) => ({ sub_id: subId, clear_phase: 1,
    max_combo_count: 17, zones: [], party: party(leader, unison) })
const post = (p, url, body = {}) => app.inject({ method: 'POST', url, payload: { viewer_id: p.viewer, api_count: 1, ...body } })
const start = (p, play, extra = {}) => post(p, '/raid/battle/start', { event_id: EVENT, quest_id: QUEST,
    party_group_id: 1, play_id: play, use_auto_start_point: false, is_auto_start_mode: false, ...extra })
const finish = (p, play, extra = {}) => post(p, '/single/finish', { category: CATEGORY, quest_id: QUEST,
    play_id: play, continue_count: 0, elapsed_time_ms: 1000, score: 100, add_mana: 0,
    is_accomplished: true, is_restored: false, statistics: statistics(),
    sub_statistics: [statistics(1), statistics(2)], api_count: 2, ...extra })
function decode(result) {
    assert.equal(result.statusCode, 200, result.body)
    const body = result.json(); assert.equal(body.data_headers.result_code, 1, result.body)
    return body
}
const active = p => load('data/domains/quest_active').getPlayerActiveQuestSync(p.id)
function expectedTriples(p, group = 1) {
    return p.groups[group].map(([leader, unison], subId) => ({ partyId: (group - 1) * 10 + subId + 1,
        subId, party: party(leader, unison, 300101) }))
}
function assertCaptured(p, group = 1) {
    const row = active(p), triples = expectedTriples(p, group)
    assert.ok(row?.battleRoster?.raid, 'dedicated Raid start persists its selected three-party snapshot')
    assert.equal(row.partySlot, triples[0].partyId)
    assert.deepEqual(row.battleRoster.raid, { partyGroupId: group, parties: triples })
    assert.deepEqual(row.battleRoster.party, triples[0].party)
    return structuredClone(row.battleRoster)
}
function characterState(p) {
    return Object.fromEntries(MEMBERS.map(id => [id, characters.getPlayerCharacterSync(p.id, id).exp]))
}
function assertMainOnly(p, group = 1) {
    const amount = assets.getQuestFromCategorySync(CATEGORY, QUEST).characterExpReward
    assert.ok(amount > 0, 'real Raid quest has nonzero EXP to distinguish the recipient')
    const [leader, unison] = p.groups[group][0]
    assert.deepEqual(characterState(p), Object.fromEntries(MEMBERS.map(id => [id, id === leader || id === unison ? amount : 0])),
        'only the frozen first party gets EXP; two sub parties and a reported replacement get none')
    const record = db.prepare('SELECT * FROM players_rush_events_played_parties WHERE player_id=? AND event_id=? AND round=?')
        .get(p.id, EVENT, QUEST)
    assert.ok(record, 'real Raid handler writes the existing played-party record')
    assert.equal(record.character_id_1, leader); assert.equal(record.unison_character_id_1, unison)
    assert.equal(record.equipment_id_1, 300101); assert.equal(record.ability_soul_id_1, 300101)
    const facts = load('data/domains/character_clear')
    assert.equal(facts.getPlayerCharacterClearSync(p.id, leader).leader_clear_count, 1)
    assert.equal(facts.getPlayerCharacterClearSync(p.id, unison).clear_count, 1)
    for (const id of MEMBERS.filter(id => id !== leader && id !== unison))
        assert.equal(facts.getPlayerCharacterClearSync(p.id, id).clear_count, 0)
}
const quote = value => `"${value.replaceAll('"', '""')}"`
function snapshot(p) {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()
        .map(({ name }) => ({ name, columns: db.prepare(`PRAGMA table_info(${quote(name)})`).all().map(row => row.name) }))
        .filter(row => row.name === 'players' || row.columns.includes('player_id') || row.columns.includes('source_player_id'))
    const state = Object.fromEntries(tables.map(({ name, columns }) => {
        const key = name === 'players' ? 'id' : columns.includes('player_id') ? 'player_id' : 'source_player_id'
        return [name, db.prepare(`SELECT * FROM ${quote(name)} WHERE ${quote(key)}=?`).all(p.id)
            .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))]
    }))
    state.raid_event_global_state = db.prepare('SELECT * FROM raid_event_global_state WHERE event_id=?').all(EVENT)
    return state
}
async function freshFinish(p, play, mode) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [__filename], { cwd: repository, windowsHide: true,
            env: { ...process.env, RAID_ROSTER_REPLAY: JSON.stringify({ directory, player: p, play, writer: mode === 'writer' }) },
            stdio: ['ignore', 'pipe', 'pipe'] })
        let output = '', errors = ''
        const timer = setTimeout(() => { child.kill(); reject(new Error(`Raid pending recovery timeout: ${errors}`)) }, 30000)
        child.stdout.on('data', chunk => { output += chunk }); child.stderr.on('data', chunk => { errors += chunk })
        child.once('error', error => { clearTimeout(timer); reject(error) })
        child.once('exit', code => {
            clearTimeout(timer)
            const line = output.split(/\r?\n/).find(value => value.startsWith('RAID_ROSTER_RESULT:'))
            if (code !== 0 || !line) return reject(new Error(`Raid recovery exited ${code}: ${errors}\n${output}`))
            resolve(JSON.parse(line.slice('RAID_ROSTER_RESULT:'.length)))
        })
    })
}
async function close() {
    try { await writer.stopSqliteWriter(); if (app) await app.close() }
    finally { try { await load('lib/seed-validator').default.close() } finally { timers.forEach(clearInterval); if (db.open) db.close() } }
}
if (replay) {
    void (async () => {
        const keepAlive = setInterval(() => {}, 1000)
        try {
            app = await makeApp()
            if (replay.writer) { process.env.CN_WRITER_THREAD = '1'; assert.equal(writer.startSqliteWriter(db.name), true);
                assert.equal(await writer.waitForSqliteWriterReady(30000), true) }
            console.log(`RAID_ROSTER_RESULT:${JSON.stringify(decode(await finish(replay.player, replay.play)))}`)
        } finally { await close(); clearInterval(keepAlive) }
    })().catch(error => { console.error(error); process.exitCode = 1 })
} else {
    test.before(async () => { app = await makeApp() })
    test.after(async () => {
        try { await close() } finally {
            assert.equal(path.dirname(fs.realpathSync(directory)), fs.realpathSync(root))
            fs.rmSync(directory, { recursive: true })
        }
    })
    for (const mode of ['in-process', 'writer']) test(`dedicated Raid roster (${mode})`, async t => {
        if (mode === 'writer') { process.env.CN_WRITER_THREAD = '1'; assert.equal(writer.startSqliteWriter(db.name), true);
            assert.equal(await writer.waitForSqliteWriterReady(30000), true) }

        await t.test('real /party response and start freeze the same native-valid first three slot groups', async () => {
            const p = fixture(), play = `raid-published-${p.id}`
            const groups = decode(await post(p, '/raid/party')).data.user_party_group_list
            assert.equal(groups.length, 1, 'this change preserves the currently published group count')
            assert.equal(groups[0].party_group_id, 1)
            assert.deepEqual(groups[0].party_list.map(row => ({ id: row.party_id, main: row.character_ids,
                unison: row.unison_character_ids, equipment: row.equipment_ids, souls: row.ability_soul_ids })),
            expectedTriples(p).map(row => ({ id: row.partyId, main: row.party.characters.map(entry => entry?.id ?? null),
                unison: row.party.unison_characters.map(entry => entry?.id ?? null),
                equipment: row.party.equipments.map(entry => entry?.id ?? null), souls: row.party.ability_soul_ids })))
            decode(await start(p, play)); assertCaptured(p)
        })
        await t.test('an existing second group freezes global party IDs 11/12/13 without leaking home or group one', async () => {
            const p = fixture(), play = `raid-group2-${p.id}`
            decode(await post(p, '/raid/party'))
            decode(await start(p, play, { party_group_id: 2 })); assertCaptured(p, 2)
            editGroup(p, 1); editGroup(p, 2)
            decode(await finish(p, play)); assertMainOnly(p, 2)
        })
        await t.test('sparse saved slots publish unique IDs and freeze the exact published fallback order', async t => {
            const p = fixture(), play = `raid-sparse-${p.id}`
            db.prepare('DELETE FROM players_parties WHERE player_id=? AND category=? AND group_id=1 AND slot<>2')
                .run(p.id, RAID_PARTY_CATEGORY)
            const original = players.getDefaultPlayerPartyGroupsSync
            // Explicit sparse defaults model an incomplete old party source;
            // ordinary defaults would auto-fill it before the route's fallback.
            const hook = t.mock.method(players, 'getDefaultPlayerPartyGroupsSync', (...args) =>
                args[0] === RAID_PARTY_CATEGORY ? {} : original(...args))
            try {
                const rows = decode(await post(p, '/raid/party')).data.user_party_group_list[0].party_list
                assert.equal(rows.length, 3)
                assert.equal(new Set(rows.map(row => row.party_id)).size, 3)
                const ids = rows.flatMap(row => [...row.character_ids, ...row.unison_character_ids]).filter(id => id !== null)
                assert.equal(new Set(ids).size, ids.length, 'fallback excludes existing main and unison members')
                decode(await start(p, play))
                const triples = rows.map((row, subId) => ({ partyId: row.party_id, subId, party: {
                    characters: row.character_ids.map(id => id === null ? null : { id }),
                    unison_characters: row.unison_character_ids.map(id => id === null ? null : { id }),
                    equipments: row.equipment_ids.map(id => id === null ? null : { id }), ability_soul_ids: row.ability_soul_ids,
                } }))
                assert.deepEqual(active(p).battleRoster.raid, { partyGroupId: 1, parties: triples })
                assert.deepEqual(active(p).battleRoster.party, triples[0].party)
                assert.equal(active(p).partySlot, rows[0].party_id)
            } finally { hook.mock.restore() }
        })
        await t.test('mutating Raid slots and the home pointer cannot redirect primary EXP, leader facts or played record', async () => {
            const p = fixture(), play = `raid-edited-${p.id}`
            decode(await start(p, play)); editGroup(p)
            const first = decode(await finish(p, play)); assertMainOnly(p)
            assert.deepEqual(first.data.add_exp_list.map(row => row.character_id), [MAIN, UNISON])
            const paid = snapshot(p)
            assert.deepEqual(decode(await finish(p, play, { api_count: 99, statistics: { party: 'irrelevant old retry' },
                sub_statistics: [statistics(999), statistics(999)] })), first)
            assert.deepEqual(snapshot(p), paid)
        })
        await t.test('reversed valid sub IDs bind by identity and never add two more parties to EXP', async () => {
            const p = fixture(), play = `raid-reversed-${p.id}`
            decode(await start(p, play)); editGroup(p)
            decode(await finish(p, play, { sub_statistics: [statistics(2, ALTERNATE), statistics(1, ALTERNATE)] }))
            assertMainOnly(p)
        })
        for (const missing of [undefined, []]) await t.test(`missing sub telemetry ${missing === undefined ? 'property' : 'array'} remains compatible`, async () => {
            const p = fixture(), play = `raid-missing-${p.id}`
            decode(await start(p, play))
            decode(await finish(p, play, { sub_statistics: missing })); assertMainOnly(p)
        })
        const invalid = [
            ['duplicate-sub-id', { sub_statistics: [statistics(1), statistics(1)] }],
            ['unknown-sub-id', { sub_statistics: [statistics(3)] }],
            ['too-many-sub-statistics', { sub_statistics: [statistics(1), statistics(2), statistics(1)] }],
            ['non-array-sub-statistics', { sub_statistics: {} }],
            ['main-sub-id-not-zero', { statistics: statistics(1) }],
            ['duplicate-role-within-sub-party', { sub_statistics: [{ ...statistics(1), party: party(ALTERNATE, ALTERNATE) }] }],
        ]
        for (const [label, extra] of invalid) await t.test(`${label} rejects before EXP, Raid record, counters or global kills change`, async () => {
            const p = fixture(), play = `raid-invalid-${p.id}`
            decode(await start(p, play))
            const before = snapshot(p), memory = structuredClone(single.activeQuests[p.id])
            const rejected = await finish(p, play, extra)
            assert.equal(rejected.statusCode, 400, rejected.body)
            assert.deepEqual(snapshot(p), before)
            assert.deepEqual(single.activeQuests[p.id], memory)
        })
        await t.test('same-play start keeps its frozen group and clock but rejects a changed group, quest or auto identity', async () => {
            const p = fixture(), play = `raid-start-retry-${p.id}`
            decode(await start(p, play)); const captured = assertCaptured(p)
            editGroup(p)
            const before = snapshot(p), memory = structuredClone(single.activeQuests[p.id])
            decode(await start(p, play))
            assert.deepEqual(snapshot(p), before); assert.deepEqual(single.activeQuests[p.id], memory)
            assert.deepEqual(active(p).battleRoster, captured)
            for (const extra of [{ party_group_id: 2 }, { quest_id: QUEST + 1 }, { is_auto_start_mode: true }]) {
                assert.equal((await start(p, play, extra)).statusCode, 400)
                assert.deepEqual(snapshot(p), before)
            }
        })
        await t.test('matching pending start ignores newly equipped Fantasy items while changed identity and new-play gates remain enforced', async () => {
            const p = fixture(), play = `raid-retry-equipment-${p.id}`
            decode(await start(p, play)); const captured = assertCaptured(p)
            const exclusive = load('lib/mode15').MODE15_EXCLUSIVE_EQUIPMENT_IDS[0]
            assert.equal(exclusive, 100013, 'actual exclusive item from the existing equipment-gate contract')
            parties.updatePlayerPartySync(p.id, 1, savedParty(MAIN, UNISON, exclusive), 1)
            const before = snapshot(p), memory = structuredClone(single.activeQuests[p.id])
            const raw = db.prepare('SELECT * FROM players_active_quests WHERE player_id=?').get(p.id)
            decode(await start(p, play))
            assert.deepEqual(snapshot(p), before)
            assert.deepEqual(single.activeQuests[p.id], memory)
            assert.deepEqual(db.prepare('SELECT * FROM players_active_quests WHERE player_id=?').get(p.id), raw)
            assert.deepEqual(active(p).battleRoster, captured)
            assert.equal((await start(p, play, { party_group_id: 2 })).statusCode, 400)
            const newPlay = await start(p, `${play}-new`)
            assert.equal(newPlay.statusCode, 200, newPlay.body)
            assert.equal(newPlay.json().data_headers.result_code, 4050)
            assert.deepEqual(snapshot(p), before)
        })
        await t.test('cross-party duplicate characters are denied by a new trusted native Raid start', async () => {
            const p = fixture(), play = `raid-cross-duplicate-${p.id}`
            parties.updatePlayerPartySync(p.id, 2, savedParty(MAIN, SUB1_UNISON), 1)
            const before = snapshot(p)
            assert.equal((await start(p, play)).statusCode, 400)
            assert.deepEqual(snapshot(p), before)
        })
        await t.test('an absent group cannot be reconstructed from the current home party', async () => {
            const p = fixture(), before = snapshot(p)
            assert.equal((await start(p, `raid-no-group-${p.id}`, { party_group_id: 13 })).statusCode, 400)
            assert.deepEqual(snapshot(p), before)
        })
        await t.test('late receipt SQL failure rolls back primary EXP, three-party snapshot, Raid facts and shared kill state', async () => {
            const p = fixture(), play = `raid-rollback-${p.id}`
            decode(await start(p, play)); editGroup(p)
            const before = snapshot(p), memory = structuredClone(single.activeQuests[p.id]), prior = writer.sqliteWriterStats()
            memory.battleRoster ??= null
            db.exec(`CREATE TRIGGER raid_roster_fault BEFORE INSERT ON player_operation_receipts
                WHEN NEW.player_id=${p.id} AND NEW.operation='quest_finish.single'
                BEGIN SELECT RAISE(ABORT, 'injected Raid roster fault'); END`)
            try {
                const failed = await finish(p, play)
                assert.equal(failed.statusCode, 500, failed.body); assert.match(failed.body, /injected Raid roster fault/)
                assert.deepEqual(snapshot(p), before); assert.deepEqual(single.activeQuests[p.id], memory)
                if (mode === 'writer') assert.ok(writer.sqliteWriterStats().failed > prior.failed)
            } finally { db.exec('DROP TRIGGER raid_roster_fault') }
            decode(await finish(p, play)); assertMainOnly(p)
        })
        await t.test('unsettled Raid start recovers all three identities in a new process and pays only sub zero', async () => {
            const p = fixture(), play = `raid-restart-${p.id}`
            decode(await start(p, play)); editGroup(p)
            delete single.activeQuests[p.id]
            await freshFinish(p, play, mode); assertMainOnly(p)
        })
        await t.test('legacy NULL snapshots keep bounded reported-party compatibility and never infer a present SET', async () => {
            const p = fixture(), play = `raid-legacy-${p.id}`
            decode(await start(p, play))
            db.prepare('UPDATE players_active_quests SET battle_roster_json=NULL WHERE player_id=?').run(p.id)
            delete single.activeQuests[p.id]
            const oldPending = snapshot(p)
            decode(await start(p, play))
            assert.deepEqual(snapshot(p), oldPending, 'same-play old NULL registration is not silently recaptured')
            assert.equal(active(p).battleRoster, null)
            decode(await finish(p, play, { sub_statistics: undefined }))
            const amount = assets.getQuestFromCategorySync(CATEGORY, QUEST).characterExpReward
            assert.equal(characters.getPlayerCharacterSync(p.id, ALTERNATE).exp, amount)
            assert.equal(characters.getPlayerCharacterSync(p.id, MAIN).exp, 0)
        })
        await t.test('legacy fixed-party data retains unowned zero-EXP and bond placeholders', async t => {
            const p = fixture(), play = `raid-fixed-legacy-${p.id}`
            decode(await start(p, play))
            db.prepare('UPDATE players_active_quests SET battle_roster_json=NULL WHERE player_id=?').run(p.id)
            delete single.activeQuests[p.id]
            assert.equal(characters.getPlayerCharacterSync(p.id, UNOWNED), null)
            const original = assets.getQuestFromCategorySync
            const hook = t.mock.method(assets, 'getQuestFromCategorySync', (category, questId) => {
                const quest = original(category, questId)
                return category === CATEGORY && questId === QUEST ? { ...quest, fixedParty: 1 } : quest
            })
            try {
                const response = decode(await finish(p, play, { statistics: statistics(0, UNOWNED), sub_statistics: undefined }))
                assert.ok(MEMBERS.every(id => characters.getPlayerCharacterSync(p.id, id).exp === 0))
                assert.equal(characters.getPlayerCharacterSync(p.id, UNOWNED), null)
                assert.equal(response.data.add_exp_list.find(row => row.character_id === UNOWNED)?.add_exp, 0)
                assert.ok(Object.hasOwn(response.data.bond_token_status_list, UNOWNED))
            } finally { hook.mock.restore() }
        })
    })
}
