'use strict'

const test = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const Fastify = require('fastify')
const root = path.resolve(process.env.STARPOINT_TEST_TMP_ROOT || os.tmpdir())
fs.mkdirSync(root, { recursive: true })
const directory = fs.mkdtempSync(path.join(root, 'battle-mana-response-'))
Object.assign(process.env, { DATA_DIR: directory, GACHA_SEED_DIR: path.join(directory, 'seeds'),
    CN_WRITER_THREAD: '0', GAME_ROUTINE_LOGS: 'off', GAME_VERBOSE_LOGS: 'false', MULTI_SETTLEMENT_BARRIER_MS: '1' })
const load = name => require(path.join(__dirname, '..', 'out', name))
const timers = [], originalInterval = global.setInterval
let db, players, active, single, writer, assets
try {
    global.setInterval = (...args) => { const timer = originalInterval(...args); timers.push(timer); return timer }
    load('data').initializeDatabase()
    db = load('data/db').getDb(); players = load('data/domains/player'); active = load('data/domains/quest_active')
    single = load('routes/api/singleBattleQuest'); writer = load('lib/persistence/writer-client'); assets = load('lib/assets')
} finally { global.setInterval = originalInterval }
assert.equal(path.dirname(fs.realpathSync(db.name)), fs.realpathSync(directory))
const MAX = 2147483647
let app, sequence = 0
const party = () => ({ characters: [{ id: 1 }, null, null], unison_characters: [null, null, null],
    equipments: [null, null, null], ability_soul_ids: [null, null, null] })
const quote = name => `"${name.replaceAll('"', '""')}"`
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all().map(({ name }) => ({ name, columns: db.prepare(`PRAGMA table_info(${quote(name)})`).all().map(c => c.name) }))
    .filter(t => t.name === 'players' || t.columns.includes('player_id') || t.columns.includes('source_player_id'))
function snapshot(p) {
    return Object.fromEntries(tables.map(({ name, columns }) => [name,
        db.prepare(`SELECT * FROM ${quote(name)} WHERE ${quote(name === 'players' ? 'id'
            : columns.includes('player_id') ? 'player_id' : 'source_player_id')}=?`).all(p.id)
            .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))]))
}

// Register a synthetic current-clock battle using the production active writer.
// This tests real finish HTTP/transactions; it does not claim the special start UI or entry gates ran.
function fixture(isMulti, mode15 = true) {
    const account = load('data/domains/account').insertAccountSync({ appId: 'wf_cn', idpAlias: '',
        idpCode: 'battle-mana-response', idpId: `mana-response-${++sequence}`, status: 'normal' })
    const p = { id: players.insertDefaultPlayerSync(account.id).id, viewer: 865000000 + sequence,
        playId: `mana-response-${sequence}`, isMulti, mode15 }
    load('data/activeAccount').saveAccountDefaultPlayer(account.id, p.id)
    load('data/domains/session').insertSessionWithTokenSync({ token: String(p.viewer), accountId: account.id,
        type: 2, expires: new Date('2099-01-01') })
    players.updatePlayerSync({ id: p.id, freeMana: 100, paidMana: 0, totalManaObtained: 0 })
    p.category = mode15 ? (isMulti ? 7 : 24) : 2
    p.questId = mode15 ? (isMulti ? 300098003 : 700098001) : 1001001
    p.questData = assets.getQuestFromCategorySync(p.category, p.questId)
    assert.ok(p.questData && Number.isSafeInteger(p.questData.manaReward) && p.questData.manaReward > 0,
        'fixture uses the actual positive quest mana reward')
    if (mode15) {
        const rush = load('data/domains/rushEvent')
        rush.insertPlayerRushEventSync(p.id, rush.getDefaultPlayerRushEventSync(700098))
        if (isMulti) for (let stage = 1; stage <= 14; stage++) rush.insertPlayerRushEventPlayedPartySync(p.id, 700098, {
            round: 700098000 + stage, battleType: 0, characterIds: [1, null, null], unisonCharacterIds: [null, null, null],
            equipmentIds: [null, null, null], abilitySoulIds: [null, null, null],
            evolutionImgLevels: [null, null, null], unisonEvolutionImgLevels: [null, null, null],
        })
    }
    single.insertActiveQuest(p.id, { category: p.category, questId: p.questId, playId: p.playId,
        useBoostPoint: false, useBossBoostPoint: false, isAutoStartMode: false, isMulti,
        isMultiHost: isMulti, continueCount: 0, partySlot: 1,
        ...(isMulti ? { roomNumber: `mana-room-${sequence}`, matePlayerIds: [], mateComIds: [] } : {}) })
    if (isMulti) load('multi/settlement-snapshot').registerMultiSettlementSnapshot({
        battleInstanceId: `mana-instance-${sequence}`, playerId: p.id, viewerId: p.viewer, playId: p.playId,
        roomNumber: `mana-room-${sequence}`, roomGeneration: 1, activeQuest: single.activeQuests[p.id],
        participants: [{ viewerId: p.viewer, comId: 0 }], expectedRealViewerIds: [p.viewer], isHost: true,
        isRescueGuest: false, isRescueFragmentEligible: false, isNewbieRescueGuest: false,
    })
    return p
}
function body(p, amount) {
    return { viewer_id: p.viewer, play_id: p.playId, category: p.category, quest_id: p.questId, api_count: 1,
        continue_count: 0, elapsed_time_ms: 1000, score: 100, add_mana: amount, is_accomplished: true, is_restored: false,
        statistics: { clear_phase: 1, max_combo_count: 1, party: party(), zones: [] },
        ...(p.isMulti ? { room_number: `mana-room-${p.viewer - 865000000}`, contribution_score: 1,
            mate_player_result: [], mate_player_ids: [] } : {}) }
}
const finish = (p, amount) => app.inject({ method: 'POST', url: p.isMulti ? '/multi/finish' : '/single/finish', payload: body(p, amount) })
function decode(response) { assert.equal(response.statusCode, 200, response.body); return response.json() }
function command(p, amount, reward = p.questData.manaReward, extraQuestData = {}) {
    const common = { playerId: p.id, viewerId: p.viewer, body: body(p, amount), questCategory: p.category,
        questId: p.questId, questData: { ...p.questData, manaReward: reward,
            // Ordinary boundary fixtures isolate the base/field award from real rare-pool currency drops.
            ...(!p.mode15 ? { clearReward: undefined, sPlusReward: undefined, scoreRewardGroupId: undefined,
                scoreRewardGroup: undefined } : {}), ...extraQuestData }, activeQuestData: { ...single.activeQuests[p.id] } }
    return load('lib/persistence-coordinator').runWriterCommand(p.isMulti ? 'multi.settle_finish' : 'single.settle_finish', p.isMulti ? {
        ...common, allowFrozenSnapshot: false, playId: p.playId, finishedAsHost: true, finishedAsRescueGuest: false,
        finishedAsRescueFragmentEligible: false, finishedAsNewbieRescueGuest: false, matePlayerResult: [], followInfo: [],
    } : { ...common, clearTime: 1000, clearRank: 5, questAccomplished: true, battleFactsAccomplished: true,
        fiveBossSoloQuest: false, registered: true, scoreAttackBorderTiers: [], manaObtained: 0,
        displayMode15ManaAsFieldDrop: load('lib/mode15-optional').isMode15Quest(p.category, p.questId),
        finishCacheKey: null, receiptPlayId: p.playId },
    { domain: p.isMulti ? 'multi-settlement' : 'single-quest', playerId: p.id, operation: 'finish' })
}

test('native battle reward output bounds in both persistence executors', async t => {
    try {
        app = Fastify({ logger: false })
        app.addHook('onSend', (_request, reply, payload, done) => done(null,
            String(reply.getHeader('content-type')).startsWith('application/x-msgpack') && typeof payload === 'object'
                ? JSON.stringify(payload) : payload))
        await app.register(single.default, { prefix: '/single' })
        await app.register(async value => load('multi/http/battle').registerBattleRoutes(value), { prefix: '/multi' })
        await app.ready()
        for (const executor of ['in-process', 'writer']) {
            if (executor === 'writer') {
                process.env.CN_WRITER_THREAD = '1'
                assert.equal(writer.startSqliteWriter(db.name), true)
                assert.equal(await writer.waitForSqliteWriterReady(30000), true)
            }
            await t.test(executor, async run => {
                for (const isMulti of [false, true]) {
                    const mode = isMulti ? 'multi' : 'single'
                    await run.test(`${mode} Mode15 HTTP rejects merged field overflow without consuming the active or any reward`, async () => {
                        const p = fixture(isMulti), before = snapshot(p)
                        const response = await finish(p, MAX)
                        assert.equal(response.statusCode, 400, response.body)
                        assert.deepEqual(snapshot(p), before)
                        assert.equal(single.activeQuests[p.id].playId, p.playId)
                    })
                    await run.test(`${mode} Mode15 writer rejects merged field overflow and rolls back the full transaction`, async () => {
                        const p = fixture(isMulti), before = snapshot(p)
                        await assert.rejects(command(p, MAX), error => error.code === 'INVALID_FIELD_MANA')
                        assert.deepEqual(snapshot(p), before)
                    })
                    await run.test(`${mode} Mode15 exact int32 boundary and normal pickups keep the original amount`, async () => {
                        for (const boundary of [false, true]) {
                            const p = fixture(isMulti), amount = boundary ? MAX - p.questData.manaReward : 137
                            const response = decode(await finish(p, amount))
                            assert.deepEqual(response.data.rewards, { overflow_pool_exp: 0, converted_pool_exp: 0,
                                reward_pool_exp: p.questData.poolExpReward, reward_mana: 0,
                                field_mana: p.questData.manaReward + amount })
                            assert.equal(players.getPlayerSync(p.id).totalManaObtained, p.questData.manaReward + amount)
                            assert.equal(active.getPlayerActiveQuestSync(p.id), null)
                            const paid = snapshot(p)
                            assert.deepEqual(decode(await finish(p, MAX + 1)), response)
                            assert.deepEqual(snapshot(p), paid)
                        }
                    })
                    await run.test(`${mode} ordinary separate MAX reward and MAX field stay legal despite their wider combined total`, async () => {
                        const p = fixture(isMulti, false)
                        const before = players.getPlayerSync(p.id).totalManaObtained
                        // Boundary master-data clone: this is an internal command fixture, not an actual asset reward claim.
                        const result = await command(p, MAX, MAX)
                        assert.equal(result.response.data.rewards.reward_mana, MAX)
                        assert.equal(result.response.data.rewards.field_mana, MAX)
                        assert.equal(players.getPlayerSync(p.id).totalManaObtained - before, MAX * 2)
                        assert.equal(active.getPlayerActiveQuestSync(p.id), null)
                    })
                    await run.test(`${mode} later deterministic mana reward preserves a precision-limited counter and settles once`, async () => {
                        const p = fixture(isMulti, false)
                        players.updatePlayerSync({ id: p.id, totalManaObtained: Number.MAX_SAFE_INTEGER })
                        const before = players.getPlayerSync(p.id), { RewardType, ScoreRewardType } = load('lib/types')
                        const score = { scoreRewardGroupId: 987654321,
                            scoreRewardGroup: [{ name: 'late mana counter guard', type: ScoreRewardType.ITEM,
                                reward_type: RewardType.MANA, count: 1 }] }
                        const result = await command(p, 0, 0, score)
                        assert.ok(result.response)
                        const paid = players.getPlayerSync(p.id)
                        assert.equal(paid.totalManaObtained, Number.MAX_SAFE_INTEGER)
                        assert.equal(paid.freeMana, Math.min(load('lib/mana').getMaxManaSync() - paid.paidMana, before.freeMana + 1))
                        assert.equal(active.getPlayerActiveQuestSync(p.id), null)
                        const settled = snapshot(p)
                        const replay = await command(p, 0, 0, score)
                        assert.deepEqual(replay.response, result.response)
                        assert.deepEqual(snapshot(p), settled)
                    })
                }
            })
        }
    } finally {
        await writer.stopSqliteWriter()
        await app?.close()
        await load('lib/seed-validator').default.close()
        timers.forEach(clearInterval)
        if (db.open) db.close()
        assert.equal(path.dirname(directory), root)
        fs.rmSync(directory, { recursive: true })
    }
})
