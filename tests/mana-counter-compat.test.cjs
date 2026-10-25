'use strict'
const { test, before, after } = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
const { randomUUID } = require('node:crypto')
const compiled = process.env.STARPOINT_TEST_COMPILED === '1'
if (!compiled) require('ts-node/register/transpile-only')
const load = name => require(`../${compiled ? 'out' : 'src'}/${name}`)
const root = path.resolve(process.env.STARPOINT_TEST_TMP_ROOT || os.tmpdir())
fs.mkdirSync(root, { recursive: true })
const directory = fs.mkdtempSync(path.join(root, 'mana-counter-compat-'))
Object.assign(process.env, { DATA_DIR: directory, TEMP: directory, TMP: directory, SQLITE_TMPDIR: directory,
    GACHA_SEED_DIR: path.join(directory, 'seeds'), CN_WRITER_THREAD: '0', MULTI_REALTIME_PROCESS: '0',
    GAME_VERBOSE_LOGS: 'false', GAME_ROUTINE_LOGS: 'off', MULTI_SETTLEMENT_BARRIER_MS: '1' })
const timers = [], interval = global.setInterval
global.setInterval = (...args) => { const timer = interval(...args); timers.push(timer); return timer }
let db, players, counter, snapshots, app, single, writer, sequence = 0
const MAX = Number.MAX_SAFE_INTEGER, LEGACY_INTEGER = '9007199254740993'
function raw(p) {
    const value = db.prepare('SELECT typeof(total_mana_obtained) AS kind,total_mana_obtained AS value FROM players WHERE id=?')
        .safeIntegers().get(p.id)
    return { kind: value.kind, value: String(value.value),
        ...(typeof value.value === 'number' ? { bits: Buffer.from(new Float64Array([value.value]).buffer).toString('hex') } : {}) }
}
function seed(p, value) {
    if (typeof value === 'string') db.prepare('UPDATE players SET total_mana_obtained=CAST(? AS INTEGER) WHERE id=?').run(value, p.id)
    else db.prepare('UPDATE players SET total_mana_obtained=? WHERE id=?').run(value, p.id)
}
function fixture() {
    const account = load('data/domains/account').insertAccountSync({ appId: 'wf_cn', idpAlias: '', idpCode: 'mana-counter-compat',
        idpId: randomUUID(), status: 'normal' })
    const p = { id: players.insertDefaultPlayerSync(account.id).id, accountId: account.id, viewer: 867100000 + ++sequence }
    load('data/activeAccount').saveAccountDefaultPlayer(account.id, p.id)
    load('data/domains/session').insertSessionWithTokenSync({ token: String(p.viewer), accountId: account.id,
        expires: new Date('2099-01-01'), type: 2 })
    p.token = db.transaction(() => load('lib/gameplay-request-identity').issueGameplayLoginTokenSync(db, {
        accountId: account.id, viewerId: p.viewer, udid: `mana-counter-${p.id}`, expiresAt: Date.now() + 86400000 }))()
    players.updatePlayerSync({ id: p.id, freeMana: 100, paidMana: 0 })
    seed(p, 0)
    return p
}
const tx = callback => load('lib/persistence-coordinator').runPersistenceTransactionSync({ domain: 'player', operation: 'mana_counter_fixture' }, callback)
const clone = value => JSON.parse(JSON.stringify(value))
function archiveValue(archive) {
    const row = archive.data.tables.players
    return row.rows[0][row.columns.indexOf('total_mana_obtained')]
}
const quote = name => `"${name.replaceAll('"', '""')}"`
function state(p) {
    return Object.fromEntries(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
        .map(({ name }) => ({ name, columns: db.prepare(`PRAGMA table_info(${quote(name)})`).all().map(c => c.name) }))
        .filter(t => t.name === 'players' || t.columns.includes('player_id') || t.columns.includes('source_player_id'))
        .map(({ name, columns }) => [name, db.prepare(`SELECT * FROM ${quote(name)} WHERE ${quote(name === 'players' ? 'id'
            : columns.includes('player_id') ? 'player_id' : 'source_player_id')}=?`).all(p.id)
            .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))]))
}
before(async () => {
    load('data').initializeDatabase(); db = load('data/db').getDb()
    assert.equal(path.dirname(fs.realpathSync(db.name)), fs.realpathSync(directory))
    players = load('data/domains/player'); counter = load('data/domains/mana-counter')
    snapshots = load('data/snapshots/player-snapshot'); single = load('routes/api/singleBattleQuest')
    writer = load('lib/persistence/writer-client')
    load('lib/gameplay-request-identity').initializeGameplayRequestIdentitySchemaSync(db)
    app = require('fastify')({ logger: false })
    app.addHook('onSend', (_request, reply, payload, done) => done(null,
        String(reply.getHeader('content-type')).startsWith('application/x-msgpack') && typeof payload === 'object'
            ? JSON.stringify(payload) : payload))
    await app.register(load('routes/api/mail').default, { prefix: '/mail' })
    await app.register(single.default, { prefix: '/single' })
    await app.register(async value => load('multi/http/battle').registerBattleRoutes(value), { prefix: '/multi' })
    await app.ready()
})
after(async () => {
    await writer?.stopSqliteWriter(); await app?.close(); await load('lib/seed-validator').default.close()
    global.setInterval = interval; timers.forEach(clearInterval)
    if (db?.open) db.close()
    assert.equal(path.dirname(path.resolve(directory)), root)
    fs.rmSync(directory, { recursive: true })
})

test('counter delta stays exact normally and does not rewrite either wide SQL storage type', () => {
    const p = fixture()
    assert.equal(counter.prepareManaCounterIncrementSync(p.id, 0), null)
    for (const value of [-1, 0.5, NaN, Infinity, null, '1', true, MAX + 1]) {
        assert.throws(() => counter.prepareManaCounterIncrementSync(p.id, value), counter.isManaCounterError)
    }
    players.updatePlayerSync({ id: p.id, manaObtainedDelta: 17 })
    assert.equal(raw(p).value, '17')
    for (const value of [LEGACY_INTEGER, 1e30]) {
        seed(p, value); const before = raw(p)
        counter.assertManaCounterStorageSync(p.id)
        players.updatePlayerSync({ id: p.id, freeMana: 200, manaObtainedDelta: 300 })
        assert.deepEqual(raw(p), before)
        assert.equal(players.getPlayerSync(p.id).freeMana, 200)
        const projected = players.getPlayerSync(p.id).totalManaObtained
        players.updatePlayerSync({ id: p.id, name: 'projection preserved', totalManaObtained: projected })
        assert.deepEqual(raw(p), before, 'ordinary full-object numeric projection never overwrites exact SQL history')
        assert.throws(() => counter.allowManaCounterAbsoluteWriteSync(p.id, Infinity), counter.isManaCounterError)
    }
    seed(p, MAX - 1)
    players.updatePlayerSync({ id: p.id, manaObtainedDelta: 2 })
    assert.equal(raw(p).value, String(MAX - 1), 'the incompatible increment is preserved, not saturated')
    players.updatePlayerSync({ id: p.id, manaObtainedDelta: 1 })
    assert.equal(raw(p).value, String(MAX), 'a later exactly representable increment remains allowed')
})

test('bad stored counters and unsafe unrelated absolute writes are explicit errors', () => {
    const p = fixture()
    for (const value of [-1, 0.5, Infinity, 'bad-counter']) {
        db.prepare('UPDATE players SET total_mana_obtained=? WHERE id=?').run(value, p.id)
        assert.throws(() => counter.assertManaCounterStorageSync(p.id), counter.isManaCounterError)
    }
    seed(p, 10)
    assert.equal(counter.allowManaCounterAbsoluteWriteSync(p.id, 11), true)
    assert.throws(() => counter.allowManaCounterAbsoluteWriteSync(p.id, MAX + 1), counter.isManaCounterError)
    assert.equal(counter.isManaCounterError({ code: 'INVALID_MANA_COUNTER' }), true)
    assert.equal(counter.isManaCounterError({ code: 'SQLITE_ERROR' }), false)
})

test('mission gross mana records at a capped wallet and repeated persist is idempotent', () => {
    for (const capped of [false, true]) {
        const p = fixture(); seed(p, 100)
        if (capped) players.updatePlayerSync({ id: p.id, freeMana: load('lib/mana').getMaxManaSync() })
        tx(() => {
            const granter = new (load('lib/mission/grants').MissionRewardGranter)(p.id, players.getPlayerSync(p.id))
            granter.grant([{ kind: 3, amount: 9 }]); granter.persistPlayer(); granter.persistPlayer()
        })
        assert.equal(raw(p).value, '109')
    }
})

test('shared quest and item-sale producers keep old raw counter while giving normal wallet rewards', () => {
    const p = fixture(); seed(p, LEGACY_INTEGER); const before = raw(p)
    const { RewardType, ScoreRewardType } = load('lib/types'), quests = load('lib/quest')
    tx(() => quests.givePlayerRewardSync(p.id, { type: RewardType.MANA, count: 17 }))
    tx(() => quests.givePlayerScoreRewardsSync(p.id, 987654321,
        [{ type: ScoreRewardType.ITEM, reward_type: RewardType.MANA, count: 11 }], false))
    assert.equal(players.getPlayerSync(p.id).freeMana, 128)
    load('data/domains/item').setPlayerItemSync(p.id, 1, 2)
    const result = tx(() => load('lib/item-sell').sellItemSync(p.id, 1, 1))
    assert.equal(result.ok, true)
    assert.ok(result.freeMana > 128)
    assert.deepEqual(raw(p), before)
})

test('V2 normal archive stays numeric; wide INTEGER and legacy REAL round-trip without schema changes', () => {
    const normal = fixture(); seed(normal, 1234)
    const baseline = snapshots.createPlayerSaveSnapshotV2Sync(normal.id)
    assert.equal(archiveValue(baseline), 1234)
    for (const value of [LEGACY_INTEGER, 1.2345678901234568e30]) {
        const p = fixture(), destination = fixture(); seed(p, value); const before = raw(p)
        const archive = snapshots.createPlayerSaveSnapshotV2Sync(p.id)
        assert.equal(archive.schemaFingerprint, baseline.schemaFingerprint)
        assert.equal(typeof archiveValue(archive), 'string')
        if (typeof value === 'string') assert.equal(archiveValue(archive), LEGACY_INTEGER)
        else assert.match(archiveValue(archive), /^mana-counter-real-v1:/)
        snapshots.validatePlayerSaveSnapshotV2Sync(clone(archive))
        snapshots.restorePlayerSaveSnapshotV2Sync(clone(archive), destination.id)
        assert.deepEqual(raw(destination), before)
        assert.equal(archiveValue(snapshots.createPlayerSaveSnapshotV2Sync(destination.id)), archiveValue(archive))
    }
    const destination = fixture()
    snapshots.restorePlayerSaveSnapshotV2Sync(clone(baseline), destination.id)
    assert.equal(raw(destination).value, '1234')
})

test('V2 special representation cannot loosen other INTEGER columns or accept malformed counter tags', () => {
    const p = fixture(), archive = snapshots.createPlayerSaveSnapshotV2Sync(p.id)
    for (const value of ['9007199254740993.0', '9223372036854775808', '01',
        'mana-counter-real-v1:NaN', 'mana-counter-real-v1:1.0e+30', 'mana-counter-real-v1:1']) {
        const copy = clone(archive), table = copy.data.tables.players
        table.rows[0][table.columns.indexOf('total_mana_obtained')] = value
        assert.throws(() => snapshots.validatePlayerSaveSnapshotV2Sync(copy))
    }
    const copy = clone(archive), table = copy.data.tables.players
    table.rows[0][table.columns.indexOf('rank_point')] = LEGACY_INTEGER
    assert.throws(() => snapshots.validatePlayerSaveSnapshotV2Sync(copy), /INTEGER/)
})

test('management-style export-backup then V2 restore keeps an extreme destination backup restorable', () => {
    const source = fixture(); seed(source, 1234)
    const normal = snapshots.createPlayerSaveSnapshotV2Sync(source.id)
    for (const value of [LEGACY_INTEGER, 1.2345678901234568e30]) {
        const destination = fixture(); seed(destination, value); const before = raw(destination)
        // Same exporter/restore sequence used by management, not a claim of management HTTP coverage.
        const backup = clone(snapshots.createPlayerSaveSnapshotV2Sync(destination.id))
        snapshots.restorePlayerSaveSnapshotV2Sync(clone(normal), destination.id)
        assert.equal(raw(destination).value, '1234')
        snapshots.validatePlayerSaveSnapshotV2Sync(backup)
        snapshots.restorePlayerSaveSnapshotV2Sync(backup, destination.id)
        assert.deepEqual(raw(destination), before)
    }
})

test('V1 replace preserves the extreme destination raw cell, while normal replacement retains its established behavior', () => {
    const source = fixture(); seed(source, 1234)
    for (const value of [LEGACY_INTEGER, 1.2345678901234568e30, 99]) {
        const destination = fixture(); seed(destination, value); const before = raw(destination)
        const merged = load('data/utils/player-data').getMergedPlayerDataSync(source.id)
        merged.player.id = destination.id
        players.replacePlayerDataSync(merged)
        if (value === 99) assert.equal(raw(destination).value, '1234')
        else assert.deepEqual(raw(destination), before)
    }
})

test('legacy counters do not block mail or registered single/multi finish, replay or rollback', async t => {
    for (const executor of compiled ? ['in-process', 'writer'] : ['in-process']) {
        if (executor === 'writer') {
            process.env.CN_WRITER_THREAD = '1'
            assert.equal(writer.startSqliteWriter(db.name), true)
            assert.equal(await writer.waitForSqliteWriterReady(30000), true)
        }
        await t.test(executor, async sub => {
            await sub.test('real native mail credit and retry preserve the exact legacy counter', async () => {
                const p = fixture(); seed(p, LEGACY_INTEGER); const before = raw(p)
                const mails = load('data/domains/mail'), mailId = mails.insertMailSync(p.id, { reason_id: 1,
                    subject: 'synthetic compatibility', description: '', type: mails.MailType.FREE_MANA, type_id: 0, number: 7,
                    receive_time: '0000-00-00 00:00:00', create_time: '2026-10-25 00:00:00', reward_period_limited: 0, reward_limit_time: null })
                const request = () => app.inject({ method: 'POST', url: '/mail/receive', headers: { login_token: p.token },
                    payload: { viewer_id: p.viewer, api_count: 1, mail_id: mailId } })
                const first = await request(); assert.equal(first.statusCode, 200, first.body)
                assert.equal(players.getPlayerSync(p.id).freeMana, 107); assert.deepEqual(raw(p), before)
                const paid = state(p), retry = await request()
                assert.equal(retry.statusCode, 200, retry.body); assert.deepEqual(retry.json(), first.json())
                assert.deepEqual(state(p), paid); assert.deepEqual(raw(p), before)
            })
            await sub.test('MAX_SAFE mail after counter one cannot poison the same player subsequent single finish', async () => {
                const p = fixture(); seed(p, 1)
                const mails = load('data/domains/mail'), mailId = mails.insertMailSync(p.id, { reason_id: 1,
                    subject: 'synthetic original overflow chain', description: '', type: mails.MailType.FREE_MANA,
                    type_id: 0, number: MAX, receive_time: '0000-00-00 00:00:00', create_time: '2026-10-25 00:00:00',
                    reward_period_limited: 0, reward_limit_time: null })
                const mail = () => app.inject({ method: 'POST', url: '/mail/receive', headers: { login_token: p.token },
                    payload: { viewer_id: p.viewer, api_count: 1, mail_id: mailId } })
                const received = await mail(); assert.equal(received.statusCode, 200, received.body)
                assert.equal(raw(p).value, '1', 'MAX_SAFE+1 is not written or silently saturated')
                assert.equal(players.getPlayerSync(p.id).freeMana, load('lib/mana').getMaxManaSync())
                const play = `mail-then-single-${p.id}`
                single.insertActiveQuest(p.id, { playId: play, category: 2, questId: 1001001, isMulti: false,
                    useBoostPoint: false, useBossBoostPoint: false, isAutoStartMode: false, continueCount: 0, partySlot: 1 })
                const finish = () => app.inject({ method: 'POST', url: '/single/finish', payload: {
                    viewer_id: p.viewer, play_id: play, category: 2, quest_id: 1001001, is_accomplished: true,
                    is_restored: false, elapsed_time_ms: 1000, score: 100, continue_count: 0, add_mana: 3,
                    statistics: { clear_phase: 1, zones: [], party: { characters: [{ id: 1 }, null, null],
                        unison_characters: [null, null, null], equipments: [null, null, null], ability_soul_ids: [null, null, null] } },
                } })
                const first = await finish(); assert.equal(first.statusCode, 200, first.body)
                assert.equal(load('data/domains/quest_active').getPlayerActiveQuestSync(p.id), null)
                assert.ok(Number(raw(p).value) >= 139, 'the later exact base/field and any legitimate score Mana still count')
                assert.equal(Number.isSafeInteger(Number(raw(p).value)), true)
                const paid = state(p), retry = await finish()
                assert.equal(retry.statusCode, 200, retry.body); assert.deepEqual(retry.json(), first.json())
                assert.deepEqual(state(p), paid)
                assert.equal((await mail()).statusCode, 200)
                assert.deepEqual(state(p), paid, 'old mail replay after battle adds no money or statistics')
            })
            for (const isMulti of [false, true]) await sub.test(`${isMulti ? 'multi' : 'single'} actual finish preserves raw value and receipt failure rolls back`, async () => {
                const p = fixture(), play = `mana-compat-play-${p.id}`; seed(p, 1e30); const before = raw(p)
                const quest = { category: 2, questId: 1001001, playId: play, useBoostPoint: false, useBossBoostPoint: false,
                    isAutoStartMode: false, isMulti, isMultiHost: isMulti, continueCount: 0, partySlot: 1,
                    ...(isMulti ? { roomNumber: `compat-room-${p.id}`, matePlayerIds: [], mateComIds: [] } : {}) }
                single.insertActiveQuest(p.id, quest)
                if (isMulti) load('multi/settlement-snapshot').registerMultiSettlementSnapshot({
                    battleInstanceId: `compat-instance-${p.id}`, playerId: p.id, viewerId: p.viewer, playId: play,
                    roomNumber: quest.roomNumber, roomGeneration: 1, activeQuest: single.activeQuests[p.id],
                    participants: [{ viewerId: p.viewer, comId: 0 }], expectedRealViewerIds: [p.viewer], isHost: true,
                    isRescueGuest: false, isRescueFragmentEligible: false, isNewbieRescueGuest: false,
                })
                const payload = { viewer_id: p.viewer, api_count: 1, play_id: play, category: 2, quest_id: 1001001,
                    elapsed_time_ms: 1000, score: 100, continue_count: 0, add_mana: 3, is_accomplished: true, is_restored: false,
                    ...(isMulti ? { room_number: quest.roomNumber, mate_player_result: [] } : {}), statistics: {
                        clear_phase: 1, zones: [], party: { characters: [{ id: 1 }, null, null], unison_characters: [null, null, null],
                            equipments: [null, null, null], ability_soul_ids: [null, null, null] } } }
                const finish = () => app.inject({ method: 'POST', url: isMulti ? '/multi/finish' : '/single/finish', payload })
                const pending = state(p)
                db.exec(`CREATE TRIGGER mana_compat_receipt_fault BEFORE INSERT ON player_operation_receipts
                    WHEN NEW.player_id=${p.id} BEGIN SELECT RAISE(ABORT,'mana compat receipt fault'); END`)
                try { assert.equal((await finish()).statusCode, 500) }
                finally { db.exec('DROP TRIGGER mana_compat_receipt_fault') }
                assert.deepEqual(state(p), pending); assert.deepEqual(raw(p), before)
                const first = await finish(); assert.equal(first.statusCode, 200, first.body)
                assert.deepEqual(raw(p), before); assert.equal(load('data/domains/quest_active').getPlayerActiveQuestSync(p.id), null)
                assert.ok(players.getPlayerSync(p.id).freeMana >= 238)
                const paid = state(p), retry = await finish(); assert.equal(retry.statusCode, 200, retry.body)
                assert.deepEqual(retry.json(), first.json()); assert.deepEqual(state(p), paid); assert.deepEqual(raw(p), before)
            })
        })
    }
})
