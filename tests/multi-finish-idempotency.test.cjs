'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { EventEmitter } = require('node:events')
const { spawn } = require('node:child_process')
const Fastify = require('fastify')

const repository = path.resolve(process.env.MULTI_FINISH_TEST_REPO || process.env.TEST_REPO || path.join(__dirname, '..'))
const replay = process.env.MULTI_FINISH_REPLAY ? JSON.parse(process.env.MULTI_FINISH_REPLAY) : null
const directory = replay ? replay.directory : fs.mkdtempSync(path.join(os.tmpdir(), 'multi-finish-idempotency-'))
process.env.DATA_DIR = directory
process.env.GAME_ROUTINE_LOGS = 'off'
process.env.MULTI_SETTLEMENT_BARRIER_MS = '20'
process.env.FINISH_RESPONSE_CACHE_MAX = '32'
delete process.env.CN_WRITER_THREAD
delete process.env.SQLITE_WRITER_EXTRA_COMMANDS
const load = name => require(path.join(repository, 'out', name))
const items = load('data/domains/item')
const timers = []
const originalInterval = global.setInterval
global.setInterval = (...args) => { const timer = originalInterval(...args); timers.push(timer); return timer }
let db, accounts, players, sessions, parties, rooms, manager, battle, single, assets, writer, playerContext
try {
    load('data').initializeDatabase()
    db = load('data/db').getDb()
    accounts = load('data/domains/account')
    players = load('data/domains/player')
    sessions = load('data/domains/session')
    parties = load('data/domains/party')
    rooms = load('multi/room/manager')
    manager = load('multi/state/SessionManager').sessionManager
    battle = load('multi/http/battle')
    single = load('routes/api/singleBattleQuest')
    assets = load('lib/assets')
    writer = load('lib/persistence/writer-client')
    playerContext = load('multi/player-context')
} finally { global.setInterval = originalInterval }
assert.equal(path.dirname(fs.realpathSync(db.name)), fs.realpathSync(directory))
load('utils').setServerTimeOffset(0)

const CATEGORY = 2, QUEST_ID = 1001001, ITEM_ID = 14040, DAILY_ID = 800392
const originalQuest = assets.getQuestFromCategorySync
let boostRewardFixture = false
// All deterministic fixture rewards are in questData, which is cloned to the
// real writer. Failures are injected with persistent SQL triggers below.
assets.getQuestFromCategorySync = (category, questId) => {
    const quest = originalQuest(category, questId)
    return Number(category) === CATEGORY && Number(questId) === QUEST_ID && quest ? {
        ...quest, rankPointReward: 14, manaReward: 135, poolExpReward: 26, characterExpReward: 26,
        clearReward: { type: 0, id: ITEM_ID, count: 2 }, sPlusReward: { type: 0, id: ITEM_ID, count: 3 },
        scoreRewardGroupId: boostRewardFixture ? 987654321 : undefined,
        scoreRewardGroup: boostRewardFixture ? [{ name: 'boost eligibility', type: 0,
            reward_type: 0, id: ITEM_ID, count: 7, field5: 1, ignore_drop_multiplier: true }] : undefined,
    } : quest
}

class Socket extends EventEmitter {
    destroyed = false; readable = true; writable = true; frames = []
    write(frame) { this.frames.push(JSON.parse(frame.replace(/\0$/, ''))); return true }
    end() { this.writable = false }
    destroy() { this.destroyed = true; this.writable = false; this.emit('close') }
}

let sequence = 0, app
function makePlayer() {
    const account = accounts.insertAccountSync({ appId: 'wf_cn', idpAlias: '', idpCode: 'test',
        idpId: `multi-atomic-${++sequence}`, status: 'normal' })
    const player = players.insertDefaultPlayerSync(account.id)
    load('data/activeAccount').saveAccountDefaultPlayer(account.id, player.id)
    const viewerId = 862000000 + player.id
    sessions.insertSessionWithTokenSync({ token: String(viewerId), accountId: account.id,
        type: 2, expires: new Date('2099-01-01T00:00:00Z') })
    return { id: player.id, viewerId }
}
const savedParty = () => ({ category: 1, name: 'atomic test', characterIds: [1, null, null],
    unisonCharacterIds: [null, null, null], equipmentIds: [null, null, null],
    abilitySoulIds: [null, null, null], edited: true, options: { allowOtherPlayersToHealMe: true } })
const statistics = () => ({ clear_phase: 1, max_combo_count: 17, party: {
    characters: [{ id: 1 }, null, null], unison_characters: [null, null, null],
    equipments: [null, null, null], ability_soul_ids: [null, null, null],
} })

async function makeApp() {
    const instance = Fastify()
    instance.addHook('onSend', (_req, reply, payload, done) => {
        done(null, reply.getHeader('content-type') === 'application/x-msgpack' ? JSON.stringify(payload) : payload)
    })
    await instance.register(async route => battle.registerBattleRoutes(route), { prefix: '/multi' })
    await instance.register(single.default, { prefix: '/single' })
    await instance.ready()
    return instance
}

function payload(p, roomNumber, playId, extra = {}) {
    return { viewer_id: p.viewerId, play_id: playId, category: CATEGORY, quest_id: QUEST_ID,
        room_number: roomNumber, is_accomplished: true, elapsed_time_ms: 30000, score: 100,
        add_mana: 0, continue_count: 0, api_count: 2, mate_player_result: [], statistics: statistics(), ...extra }
}
function finish(p, roomNumber, playId, extra = {}) {
    return app.inject({ method: 'POST', url: '/multi/finish', payload: payload(p, roomNumber, playId, extra) })
}
function singleFinish(x, extra = {}) {
    return app.inject({ method: 'POST', url: '/single/finish',
        payload: payload(x.host, x.room.room_number, x.playId, extra) })
}
function singleStart(x, extra = {}) {
    return app.inject({ method: 'POST', url: '/single/start', payload: {
        viewer_id: x.host.viewerId, quest_id: QUEST_ID, category: CATEGORY, party_id: 1,
        play_id: x.playId, use_boss_boost_point: false, use_boost_point: false,
        is_auto_start_mode: false, api_count: 1, ...extra,
    } })
}
function multiStart(x, extra = {}) {
    return app.inject({ method: 'POST', url: '/multi/start', payload: {
        viewer_id: x.host.viewerId, category: CATEGORY, quest_id: QUEST_ID, party_id: 1,
        room_number: x.room.room_number, play_id: x.playId, use_boost_point: false,
        use_boss_boost_point: false, is_auto_start_mode: false, mate_player_ids: [], mate_party_ids: [], ...extra,
    } })
}
function evictFinishCache(label) {
    const cache = load('lib/finish-response-cache')
    for (let i = 0; i < 40; i++) cache.cacheFinishResponse(`${label}:${i}`, {})
}
function decode(response) {
    assert.equal(response.statusCode, 200, response.body)
    assert.match(response.headers['content-type'], /^application\/x-msgpack/)
    return response.json()
}
async function setup(t, options = {}) {
    const host = makePlayer(), guest = makePlayer()
    const room = rooms.createRoom(host.viewerId, host.id, 1, CATEGORY, QUEST_ID, 0, 1)
    const clients = [host, guest].map(p => {
        const client = manager.createClient(new Socket(), p.viewerId, room.room_number, `atomic-${p.id}`, p.id)
        client.enterData = {}; client.isReady = true
        client.yourself = { viewerId: p.viewerId, playerId: p.id, connectionId: client.connectionId,
            comId: 0, currentPartyId: 1, state: [1], party: { equipments: [], abilitySoulIds: [] } }
        manager.addClientToRoom(client)
        rooms.addRoomMember(room.room_number, p.viewerId, p.id)
        parties.updatePlayerPartySync(p.id, 1, savedParty(), 1)
        players.updatePlayerSync({ id: p.id, partySlot: 1 })
        return client
    })
    clients.forEach(c => { c.mates = clients.map(m => m.yourself) })
    t.after(async () => {
        manager.commitRoomDisband(room.room_number, 'atomic_test_cleanup')
        clients.forEach(c => c.socket.destroy())
        await new Promise(resolve => setImmediate(resolve))
    })
    options.beforeStart?.({ host, guest, room, clients })
    const playId = `multi-play-${host.id}`
    const started = await app.inject({ method: 'POST', url: '/multi/start', payload: {
        viewer_id: host.viewerId, category: CATEGORY, quest_id: QUEST_ID, party_id: 1,
        room_number: room.room_number, play_id: playId, use_boost_point: false,
        use_boss_boost_point: false, is_auto_start_mode: false, mate_player_ids: [], mate_party_ids: [],
        ...options.startFlags,
    } })
    assert.equal(started.statusCode, 200, started.body)
    assert.equal(started.json().data.play_id, playId)
    return { host, guest, room, playId, finish: extra => finish(host, room.room_number, playId, extra) }
}

const quote = name => `"${name.replaceAll('"', '""')}"`
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all().map(({ name }) => ({ name, columns: db.prepare(`PRAGMA table_info(${quote(name)})`).all().map(c => c.name) }))
    .filter(t => t.name === 'players' || t.columns.includes('player_id') || t.columns.includes('source_player_id'))
function snapshot(playerId) {
    return Object.fromEntries(tables.map(({ name, columns }) => {
        const column = name === 'players' ? 'id' : columns.includes('player_id') ? 'player_id' : 'source_player_id'
        const rows = db.prepare(`SELECT * FROM ${quote(name)} WHERE ${quote(column)} = ?`).all(playerId)
        rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
        return [name, rows]
    }))
}
function balances(playerId) {
    return { ...db.prepare('SELECT rank_point, free_mana, exp_pool, boost_point, boss_boost_point, total_mana_obtained FROM players WHERE id = ?').get(playerId),
        characterExp: db.prepare('SELECT exp FROM players_characters WHERE player_id = ? AND id = 1').get(playerId).exp,
        item: db.prepare('SELECT amount FROM players_items WHERE player_id = ? AND id = ?').get(playerId, ITEM_ID)?.amount ?? 0,
        daily: db.prepare('SELECT progress FROM players_category_missions WHERE player_id = ? AND category = 2 AND id = ?').get(playerId, DAILY_ID)?.progress ?? 0 }
}
function receipts(playerId) {
    return db.prepare("SELECT * FROM player_operation_receipts WHERE player_id = ? AND operation = 'quest_finish.multi' ORDER BY request_key").all(playerId)
}
const mvpCounter = { dimension: 'battle.multi_mvp', scopeType: 'lifetime', scopeKey: 'all', qualifier: {} }
const mvpMissions = [26000, 26010, 26020]
function seedMvp(playerId, count) {
    load('lib/mission/counters').addMissionCounterSync(playerId, mvpCounter, count)
    for (const missionId of mvpMissions) load('data/domains/mission').incrementPlayerCategoryMissionSync(playerId, 5, missionId, count)
}
function assertMvp(playerId, expected) {
    const missions = load('data/domains/mission').getPlayerCategoryMissionsSync(playerId, 5)
    assert.deepEqual({
        counter: load('lib/mission/counters').getMissionCounterValueSync(playerId, mvpCounter),
        missions: Object.fromEntries(mvpMissions.map(id => [id, missions[id]?.progress ?? 0])),
    }, { counter: expected, missions: Object.fromEntries(mvpMissions.map(id => [id, expected])) },
    'persisted MVP fact and all three actual title mission progress values')
}
function mvpPayload(x, player, flag, ownContribution, mateContribution) {
    const stats = statistics()
    if (flag !== undefined) stats.is_mvp = flag
    const mate = player.id === x.host.id ? x.guest : x.host
    return { statistics: stats, contribution_score: ownContribution,
        mate_player_result: [{ viewer_id: mate.viewerId, contribution_score: mateContribution, score: 100 }] }
}
function seedRegularMvp(playerId) {
    seedMvp(playerId, 4)
    const missions = load('data/domains/mission')
    missions.updatePlayerCategoryMissionSync(playerId, 1, 29, 4)
    missions.updatePlayerCategoryMissionStageSync(playerId, 1, 1, 29, true)
}
function regularMvp(playerId) {
    return load('data/domains/mission').getPlayerCategoryMissionsSync(playerId, 1)['29']
}
const regularMvpRewards = response => (response.data.mission_info ?? [])
    .filter(row => row.mission_category_id === 1 && row.mission_id === 29).map(row => row.mission_reward_id)
function assertPaid(before, after) {
    assert.equal(after.rank_point - before.rank_point, 14)
    assert.equal(after.characterExp - before.characterExp, 26)
    assert.ok(after.free_mana - before.free_mana >= 135)
    assert.ok(after.exp_pool - before.exp_pool >= 26)
    assert.equal(after.item - before.item, 5, 'first-clear and SS inventory paid once')
    assert.equal(after.daily - before.daily, 1, 'daily mission fact written exactly once')
}
function timeout(promise, label) {
    let timer
    return Promise.race([promise.finally(() => clearTimeout(timer)),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out`)), 10000) })])
}
async function freshReplay(x, options = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [__filename], { cwd: repository, windowsHide: true,
            env: { ...process.env, MULTI_FINISH_TEST_REPO: repository,
                MULTI_FINISH_REPLAY: JSON.stringify({ directory, host: x.host, roomNumber: x.room.room_number, playId: x.playId, ...options }) },
            stdio: ['ignore', 'pipe', 'pipe'] })
        let output = '', errors = ''
        const deadline = setTimeout(() => { child.kill(); reject(new Error(`fresh replay timed out: ${errors}`)) }, 30000)
        child.stdout.on('data', chunk => { output += chunk }); child.stderr.on('data', chunk => { errors += chunk })
        child.once('error', error => { clearTimeout(deadline); reject(error) })
        child.once('exit', code => {
            clearTimeout(deadline)
            const line = output.split(/\r?\n/).find(s => s.startsWith('MULTI_REPLAY_RESULT:'))
            if (code !== 0 || !line) return reject(new Error(`fresh replay exited ${code}: ${errors}\n${output}`))
            resolve(JSON.parse(line.slice('MULTI_REPLAY_RESULT:'.length)))
        })
    })
}

if (replay) {
    void (async () => {
        const keepAlive = setInterval(() => {}, 1000)
        app = await makeApp()
        try {
            if (replay.writer) {
                process.env.CN_WRITER_THREAD = '1'
                assert.equal(writer.startSqliteWriter(db.name), true)
                assert.equal(await writer.waitForSqliteWriterReady(30000), true)
            }
            console.log(`MULTI_REPLAY_RESULT:${JSON.stringify(decode(await finish(replay.host, replay.roomNumber, replay.playId, { api_count: 99, ...replay.finishExtra })))}`)
        } finally { await writer.stopSqliteWriter(); await app.close(); timers.forEach(clearInterval); clearInterval(keepAlive); db.close() }
    })().catch(error => { console.error(error); process.exitCode = 1 })
} else {
    test.before(async () => { app = await makeApp() })
    test('MVP flag distinguishes an absent property from every supplied non-boolean value', () => {
        const flag = load('lib/quest/finish/multi-finish-identity').multiFinishMvpFlag
        assert.equal(flag({}), undefined)
        assert.equal(flag({ is_mvp: false }), false)
        assert.equal(flag({ is_mvp: true }), true)
        for (const invalid of [undefined, null, 0, 1, '', 'false', 'true', [], {}]) {
            assert.throws(() => flag({ is_mvp: invalid }), /is_mvp.*boolean/)
        }
    })
    test.after(async () => {
        await writer.stopSqliteWriter()
        await app.close(); timers.forEach(clearInterval); assets.getQuestFromCategorySync = originalQuest
        if (db.open) db.close()
        const actual = fs.realpathSync(directory)
        assert.equal(path.dirname(actual), fs.realpathSync(os.tmpdir()))
        fs.rmSync(actual, { recursive: true })
    })
    const selected = process.env.MULTI_FINISH_TEST_CASES?.split(',')
    for (const mode of ['in-process', 'writer']) {
        test(`multi atomic finish (${mode})`, async t => {
            if (mode === 'writer') {
                process.env.CN_WRITER_THREAD = '1'
                assert.equal(writer.startSqliteWriter(db.name), true)
                assert.equal(await writer.waitForSqliteWriterReady(30000), true)
            }
            const run = (key, title, callback) => !selected || selected.includes(key) ? t.test(title, callback) : Promise.resolve()
            await run('inputs', 'malformed boost flags cannot replace an already registered multiplayer battle', async t => {
                const x = await setup(t), before = snapshot(x.host.id)
                for (const value of ['true', 'false', 1, 0, null, [], {}]) {
                    for (const key of ['use_boost_point', 'use_boss_boost_point']) {
                        const response = await multiStart(x, { play_id: 'invalid-boost', [key]: value })
                        assert.equal(response.statusCode, 400, response.body)
                        assert.deepEqual(snapshot(x.host.id), before)
                    }
                }
            })

            await run('inputs', 'invalid field mana cannot mutate the pending multiplayer battle or either player', async t => {
                const x = await setup(t), before = snapshot(x.host.id), guestBefore = snapshot(x.guest.id)
                const memory = structuredClone(single.activeQuests[x.host.id])
                for (const value of [-1, 0.5, '100', true, null, {}, [], 0x80000000]) {
                    const response = await x.finish({ add_mana: value })
                    assert.equal(response.statusCode, 400, response.body)
                    assert.deepEqual(snapshot(x.host.id), before); assert.deepEqual(snapshot(x.guest.id), guestBefore)
                    assert.deepEqual(single.activeQuests[x.host.id], memory)
                }
                decode(await x.finish({ add_mana: 12 }))
            })

            await run('inputs', 'large or omitted field mana keeps the original reward and permanent replay semantics', async t => {
                for (const value of [0, 98765, 0x7fffffff, undefined]) {
                    const x = await setup(t), before = players.getPlayerSync(x.host.id), amount = value ?? 0
                    const result = decode(await x.finish({ add_mana: value }))
                    const after = players.getPlayerSync(x.host.id)
                    assert.equal(result.data.rewards.field_mana, amount)
                    assert.equal(result.data.rewards.reward_mana, 135)
                    assert.equal(after.totalManaObtained - before.totalManaObtained, 135 + amount)
                    const settled = snapshot(x.host.id)
                    assert.deepEqual(decode(await x.finish({ add_mana: -1, api_count: 9 })).data, result.data)
                    assert.deepEqual(snapshot(x.host.id), settled)
                }
            })

            await run('inputs', 'writer rejects raw mana tampering while precision-limited statistics do not block rewards', async t => {
                const x = await setup(t), before = snapshot(x.host.id), persistence = load('lib/persistence-coordinator')
                const dispatch = persistence.runWriterCommand, command = load('lib/persistence/command-names').MULTI_SETTLE_FINISH
                persistence.runWriterCommand = (name, args, options) => dispatch(name, name === command
                    ? { ...args, body: { ...args.body, add_mana: -1 } } : args, options)
                try { assert.equal((await x.finish()).statusCode, 400) }
                finally { persistence.runWriterCommand = dispatch }
                assert.deepEqual(snapshot(x.host.id), before)
                players.updatePlayerSync({ id: x.host.id, totalManaObtained: Number.MAX_SAFE_INTEGER - 100 })
                const limited = players.getPlayerSync(x.host.id)
                const result = decode(await x.finish({ add_mana: 8 }))
                const paid = players.getPlayerSync(x.host.id)
                assert.equal(paid.totalManaObtained, limited.totalManaObtained)
                assert.equal(paid.freeMana, Math.min(load('lib/mana').getMaxManaSync() - paid.paidMana, limited.freeMana + 143))
                assert.equal(result.data.rewards.field_mana, 8)
                const settled = snapshot(x.host.id)
                decode(await x.finish({ api_count: 9 }))
                assert.deepEqual(snapshot(x.host.id), settled)
            })
            await run('inputs', 'fresh exhausted boost balances settle normally without negative points or repeat charges', async t => {
                for (const useBoss of [false, true]) {
                    const x = await setup(t, { beforeStart: ({ host }) => players.updatePlayerSync({ id: host.id, boostPoint: 1, bossBoostPoint: 1 }),
                        startFlags: { use_boost_point: !useBoss, use_boss_boost_point: useBoss } })
                    players.updatePlayerSync({ id: x.host.id, boostPoint: 0, bossBoostPoint: 0 })
                    const result = decode(await x.finish())
                    assert.equal(result.data.user_info.boost_point, 0)
                    assert.equal(result.data.user_info.boss_boost_point, 0)
                    const settled = snapshot(x.host.id)
                    assert.deepEqual(decode(await x.finish({ api_count: 9 })).data, result.data)
                    assert.deepEqual(snapshot(x.host.id), settled)
                }
            })

            await run('inputs', 'score drops double only after the selected boost point was actually consumed', async t => {
                boostRewardFixture = true
                try {
                    for (const available of [0, 1]) {
                        const x = await setup(t, { beforeStart: ({ host }) => players.updatePlayerSync({ id: host.id, boostPoint: available, bossBoostPoint: 0 }),
                            startFlags: { use_boost_point: true, use_boss_boost_point: false } })
                        const before = items.getPlayerItemSync(x.host.id, ITEM_ID) ?? 0
                        decode(await x.finish())
                        assert.equal(items.getPlayerItemSync(x.host.id, ITEM_ID) - before, 5 + 7 * (available ? 2 : 1))
                        assert.equal(players.getPlayerSync(x.host.id).boostPoint, 0)
                    }
                } finally { boostRewardFixture = false }
            })

            await run('inputs', 'available boost and all rewards roll back on receipt fault then charge once', async t => {
                const x = await setup(t, { beforeStart: ({ host }) => players.updatePlayerSync({ id: host.id, boostPoint: 2, bossBoostPoint: 1 }),
                    startFlags: { use_boost_point: true, use_boss_boost_point: true } })
                const before = snapshot(x.host.id), memory = structuredClone(single.activeQuests[x.host.id])
                db.exec(`CREATE TRIGGER multi_boost_receipt_fault BEFORE INSERT ON player_operation_receipts
                    WHEN NEW.player_id=${x.host.id} AND NEW.operation='quest_finish.multi'
                    BEGIN SELECT RAISE(ABORT, 'multi boost receipt fault'); END`)
                try { assert.equal((await x.finish()).statusCode, 500) }
                finally { db.exec('DROP TRIGGER multi_boost_receipt_fault') }
                assert.deepEqual(snapshot(x.host.id), before)
                assert.deepEqual(single.activeQuests[x.host.id], memory)
                const result = decode(await x.finish())
                assert.equal(result.data.user_info.boost_point, 1)
                assert.equal(result.data.user_info.boss_boost_point, 0)
                const settled = snapshot(x.host.id)
                decode(await x.finish({ api_count: 9 })); assert.deepEqual(snapshot(x.host.id), settled)
            })
            for (const change of ['edit-selected-slot', 'switch-current-slot']) {
                await run('roster', `frozen battle party owns EXP and leader facts after ${change}`, async t => {
                    const x = await setup(t)
                    addRosterAlternative(x.host.id)
                    changeRosterParty(x.host.id, change)
                    const before = rosterFacts(x.host.id)
                    const first = decode(await x.finish({ statistics: rosterStatistics(ROSTER_ALTERNATIVE) }))
                    assertRosterPaid(before, rosterFacts(x.host.id))
                    assert.deepEqual(first.data.add_exp_list.map(row => row.character_id), [1])
                    const committed = snapshot(x.host.id)
                    assert.deepEqual(decode(await x.finish({ statistics: rosterStatistics(ROSTER_ALTERNATIVE), api_count: 99 })), first)
                    assert.deepEqual(snapshot(x.host.id), committed, 'same play does not repay or rewrite leader facts')
                })
            }
            await run('roster', 'the owner-captured wire party wins over a SET edited before HTTP start', async t => {
                const x = await setup(t, { beforeStart({ host, clients }) {
                    addRosterAlternative(host.id)
                    changeRosterParty(host.id, 'edit-selected-slot')
                    clients[0].yourself.party = rosterWireParty(1)
                    clients[1].yourself.party = rosterWireParty(1)
                } })
                const before = rosterFacts(x.host.id)
                decode(await x.finish({ statistics: rosterStatistics(ROSTER_ALTERNATIVE) }))
                assertRosterPaid(before, rosterFacts(x.host.id))
            })
            await run('roster', 'same-play start after editing a saved party preserves the original roster', async t => {
                const x = await setup(t)
                addRosterAlternative(x.host.id)
                changeRosterParty(x.host.id, 'edit-selected-slot')
                const beforeStart = snapshot(x.host.id)
                const frozen = structuredClone(load('multi/settlement-snapshot').getMultiSettlementSnapshot(x.host.id, x.playId))
                const restarted = await multiStart(x)
                assert.equal(restarted.statusCode, 200, restarted.body)
                assert.equal(restarted.json().data.play_id, x.playId)
                assert.deepEqual(snapshot(x.host.id), beforeStart)
                assert.deepEqual(load('multi/settlement-snapshot').getMultiSettlementSnapshot(x.host.id, x.playId), frozen)
                const before = rosterFacts(x.host.id)
                decode(await x.finish({ statistics: rosterStatistics(ROSTER_ALTERNATIVE) }))
                assertRosterPaid(before, rosterFacts(x.host.id))
            })
            const invalidRosters = [
                ['duplicate-main', stats => { stats.party.characters = [{ id: 1 }, { id: 1 }, null] }],
                ['duplicate-main-unison', stats => { stats.party.unison_characters = [{ id: 1 }, null, null] }],
                ['more-than-three-main-slots', stats => { stats.party.characters.push({ id: ROSTER_ALTERNATIVE }) }],
                ['string-character-id', stats => { stats.party.characters[0].id = '1' }],
                ['scalar-character-slot', stats => { stats.party.characters[0] = 1 }],
                ['negative-character-id', stats => { stats.party.characters[0].id = -1 }],
                ['object-soul-id', stats => { stats.party.ability_soul_ids[0] = { id: 1 } }],
            ]
            for (const [label, corrupt] of invalidRosters) {
                await run('roster', `invalid ${label} rejects without any persistent or memory reward change`, async t => {
                    const x = await setup(t)
                    addRosterAlternative(x.host.id)
                    const before = snapshot(x.host.id), guestBefore = snapshot(x.guest.id)
                    const memory = structuredClone(single.activeQuests[x.host.id])
                    const invalid = statistics(); corrupt(invalid)
                    const rejected = await x.finish({ statistics: invalid })
                    assert.equal(rejected.statusCode, 400, rejected.body)
                    assert.deepEqual(snapshot(x.host.id), before)
                    assert.deepEqual(snapshot(x.guest.id), guestBefore)
                    assert.deepEqual(single.activeQuests[x.host.id], memory)
                    const good = rosterFacts(x.host.id)
                    decode(await x.finish())
                    assertRosterPaid(good, rosterFacts(x.host.id))
                })
            }
            await run('roster', 'unlisted viewer and forged mate com_id cannot expand the frozen participant roster', async t => {
                const x = await setup(t), stranger = makePlayer()
                const strangerBefore = snapshot(stranger.id), guestBefore = snapshot(x.guest.id)
                const result = decode(await x.finish({ contribution_score: 10, mate_player_result: [
                    { viewer_id: stranger.viewerId, com_id: 1, contribution_score: 999999, score: 999999 },
                    { viewer_id: x.guest.viewerId, com_id: 2, contribution_score: 12, score: 22 },
                ] }))
                assert.deepEqual(result.data.mate_player_result.map(row => row.viewer_id), [x.guest.viewerId])
                assert.equal(result.data.mate_player_result[0].com_id, 0, 'real member identity comes from the captured room roster')
                assert.ok(result.data.follow_info.every(row => row.viewer_id !== stranger.viewerId))
                assert.deepEqual(snapshot(stranger.id), strangerBefore)
                assert.deepEqual(snapshot(x.guest.id), guestBefore)
            })
            await run('roster', 'a locally missing real teammate is synthesized from the frozen participant roster', async t => {
                const x = await setup(t), guestBefore = snapshot(x.guest.id)
                const result = decode(await x.finish({ mate_player_result: [] }))
                assert.deepEqual(result.data.mate_player_result.map(row => ({ viewer_id: row.viewer_id, com_id: row.com_id })),
                    [{ viewer_id: x.guest.viewerId, com_id: 0 }])
                assert.equal(result.data.mate_player_result[0].score, 0)
                assert.equal(result.data.mate_player_result[0].contribution_score, 0)
                assert.deepEqual(snapshot(x.guest.id), guestBefore)
            })
            await run('roster', 'expired in-memory snapshots recover the pending roster from the current play row', async t => {
                const x = await setup(t)
                addRosterAlternative(x.host.id)
                changeRosterParty(x.host.id, 'edit-selected-slot')
                delete single.activeQuests[x.host.id]
                const snapshots = load('multi/settlement-snapshot')
                snapshots.getMultiSettlementSnapshot(x.host.id, x.playId).expiresAt = 0
                assert.equal(snapshots.getMultiSettlementSnapshot(x.host.id, x.playId), undefined)
                const before = rosterFacts(x.host.id)
                decode(await x.finish({ statistics: rosterStatistics(ROSTER_ALTERNATIVE) }))
                assertRosterPaid(before, rosterFacts(x.host.id))
            })
            await run('roster', 'a fresh process without room memory settles the pending frozen party and participant identities', async t => {
                const x = await setup(t), stranger = makePlayer()
                addRosterAlternative(x.host.id)
                changeRosterParty(x.host.id, 'edit-selected-slot')
                const before = rosterFacts(x.host.id), guestBefore = snapshot(x.guest.id), strangerBefore = snapshot(stranger.id)
                const first = await freshReplay(x, { writer: mode === 'writer', finishExtra: {
                    statistics: rosterStatistics(ROSTER_ALTERNATIVE), mate_player_result: [
                        { viewer_id: stranger.viewerId, com_id: 2, contribution_score: 999999, score: 999999 },
                        { viewer_id: x.guest.viewerId, com_id: 2, contribution_score: 12, score: 22 },
                    ],
                } })
                assert.equal(first.data.host_finished, true, 'pending play retains the persisted host identity without a room')
                assert.equal(load('lib/mission/counters').getMissionCounterValueSync(x.host.id, {
                    dimension: 'battle.multi_role_clear', scopeType: 'lifetime', scopeKey: 'all', qualifier: { role: 'host' },
                }), 1)
                assertRosterPaid(before, rosterFacts(x.host.id))
                assert.deepEqual(first.data.mate_player_result.map(row => ({ viewer_id: row.viewer_id, com_id: row.com_id })),
                    [{ viewer_id: x.guest.viewerId, com_id: 0 }])
                assert.ok(first.data.follow_info.every(row => row.viewer_id !== stranger.viewerId))
                assert.deepEqual(snapshot(x.guest.id), guestBefore)
                assert.deepEqual(snapshot(stranger.id), strangerBefore)
                const committed = snapshot(x.host.id)
                assert.deepEqual(decode(await x.finish({ api_count: 101 })), first)
                assert.deepEqual(snapshot(x.host.id), committed)
            })
            await run('roster', 'late receipt SQL failure rolls back frozen-party EXP, leader counters and all player tables', async t => {
                const x = await setup(t)
                addRosterAlternative(x.host.id)
                changeRosterParty(x.host.id, 'edit-selected-slot')
                const before = snapshot(x.host.id), beforeFacts = rosterFacts(x.host.id), guestBefore = snapshot(x.guest.id)
                const memory = structuredClone(single.activeQuests[x.host.id])
                db.exec(`CREATE TRIGGER roster_receipt_fault BEFORE INSERT ON player_operation_receipts
                    WHEN NEW.player_id=${x.host.id} AND NEW.operation='quest_finish.multi'
                    BEGIN SELECT RAISE(ABORT, 'injected roster receipt fault'); END`)
                const writerBefore = writer.sqliteWriterStats()
                try {
                    const rejected = await x.finish({ statistics: rosterStatistics(ROSTER_ALTERNATIVE) })
                    assert.equal(rejected.statusCode, 500, rejected.body)
                    assert.match(rejected.body, /injected roster receipt fault/)
                    assert.deepEqual(snapshot(x.host.id), before)
                    assert.deepEqual(snapshot(x.guest.id), guestBefore)
                    assert.deepEqual(single.activeQuests[x.host.id], memory)
                    if (mode === 'writer') assert.ok(writer.sqliteWriterStats().failed > writerBefore.failed)
                } finally { db.exec('DROP TRIGGER roster_receipt_fault') }
                const first = decode(await x.finish({ statistics: rosterStatistics(ROSTER_ALTERNATIVE) }))
                assertRosterPaid(beforeFacts, rosterFacts(x.host.id))
                const committed = snapshot(x.host.id)
                assert.deepEqual(decode(await x.finish({ api_count: 99 })), first)
                assert.deepEqual(snapshot(x.host.id), committed)
            })
            await run('roster', 'fixed-party finish retains unowned-character zero-EXP and bond placeholder compatibility', async t => {
                const getQuest = assets.getQuestFromCategorySync
                const hook = t.mock.method(assets, 'getQuestFromCategorySync', (category, questId) => {
                    const quest = getQuest(category, questId)
                    return Number(category) === CATEGORY && Number(questId) === QUEST_ID && quest
                        ? { ...quest, fixedParty: 1 } : quest
                })
                try {
                    const x = await setup(t), characters = load('data/domains/character')
                    assert.equal(characters.getPlayerCharacterSync(x.host.id, ROSTER_ALTERNATIVE), null)
                    const before = rosterFacts(x.host.id)
                    const fixedStats = rosterStatistics(ROSTER_ALTERNATIVE)
                    fixedStats.party.unison_characters[0] = { id: ROSTER_ALTERNATIVE }
                    const result = decode(await x.finish({ statistics: fixedStats }))
                    assert.equal(rosterFacts(x.host.id).originalExp, before.originalExp)
                    assert.equal(characters.getPlayerCharacterSync(x.host.id, ROSTER_ALTERNATIVE), null)
                    assert.equal(result.data.add_exp_list.find(row => row.character_id === ROSTER_ALTERNATIVE)?.add_exp, 0)
                    assert.ok(Object.hasOwn(result.data.bond_token_status_list, ROSTER_ALTERNATIVE))
                } finally { hook.mock.restore() }
            })
            await run('regular-mvp', 'ordinary MVP mission preserves false and grants its next stage once for true', async t => {
                for (const flag of [false, true]) {
                    const x = await setup(t)
                    seedRegularMvp(x.host.id)
                    const first = decode(await x.finish(mvpPayload(x, x.host, flag, flag ? 1000 : 10000, flag ? 10000 : 1000)))
                    assertMvp(x.host.id, flag ? 5 : 4)
                    assert.deepEqual(regularMvp(x.host.id), { progress: flag ? 5 : 4,
                        stages: flag ? { '1': true, '2': true } : { '1': true } })
                    assert.deepEqual(regularMvpRewards(first), flag ? [29002] : [])
                    const committed = snapshot(x.host.id)
                    assert.deepEqual(decode(await x.finish({ ...mvpPayload(x, x.host, !flag, 10000, 1000), api_count: 99 })), first)
                    assert.deepEqual(snapshot(x.host.id), committed)
                }
            })
            await run('regular-mvp', 'ordinary MVP stage, currency and facts roll back together on a late receipt failure', async t => {
                const x = await setup(t)
                seedRegularMvp(x.host.id)
                const before = snapshot(x.host.id), memory = structuredClone(single.activeQuests[x.host.id])
                db.exec(`CREATE TRIGGER regular_mvp_receipt_fault BEFORE INSERT ON player_operation_receipts
                    WHEN NEW.player_id=${x.host.id} AND NEW.operation='quest_finish.multi'
                    BEGIN SELECT RAISE(ABORT, 'injected regular MVP receipt fault'); END`)
                const writerBefore = writer.sqliteWriterStats()
                try {
                    const rejected = await x.finish(mvpPayload(x, x.host, true, 1000, 10000))
                    assert.equal(rejected.statusCode, 500, rejected.body)
                    assert.match(rejected.body, /injected regular MVP receipt fault/)
                    assert.deepEqual(snapshot(x.host.id), before, 'includes free_vmoney, ordinary stages, counters and all other player tables')
                    assert.deepEqual(single.activeQuests[x.host.id], memory)
                    if (mode === 'writer') assert.ok(writer.sqliteWriterStats().failed > writerBefore.failed)
                } finally { db.exec('DROP TRIGGER regular_mvp_receipt_fault') }
                const first = decode(await x.finish(mvpPayload(x, x.host, true, 1000, 10000)))
                assertMvp(x.host.id, 5)
                assert.deepEqual(regularMvp(x.host.id), { progress: 5, stages: { '1': true, '2': true } })
                assert.deepEqual(regularMvpRewards(first), [29002])
                const committed = snapshot(x.host.id)
                assert.deepEqual(decode(await x.finish({ api_count: 99 })), first)
                assert.deepEqual(snapshot(x.host.id), committed)
            })
            await run('mvp', 'explicit false from the highest healing contributor preserves existing MVP title progress', async t => {
                const x = await setup(t)
                seedMvp(x.host.id, 99)
                // A: damage=1000/heal=0, B: damage=0/heal=10000. B has
                // higher contribution, but A wins the client's damage-based MVP.
                const first = decode(await x.finish(mvpPayload(x, x.host, false, 10000, 1000)))
                assertMvp(x.host.id, 99)
                const settled = snapshot(x.host.id)
                assert.deepEqual(decode(await x.finish({ ...mvpPayload(x, x.host, true, 10000, 1000), api_count: 99 })), first)
                assert.deepEqual(snapshot(x.host.id), settled, 'a changed flag on retry cannot change the committed result')
            })
            await run('mvp', 'explicit true survives a lower contribution and advances actual MVP title missions', async t => {
                const x = await setup(t)
                seedMvp(x.host.id, 99)
                const first = decode(await x.finish(mvpPayload(x, x.host, true, 1000, 10000)))
                assertMvp(x.host.id, 100)
                const settled = snapshot(x.host.id)
                decode(await x.finish({ ...mvpPayload(x, x.host, false, 1000, 10000), api_count: 99 }))
                assert.deepEqual(snapshot(x.host.id), settled)
                assert.deepEqual(decode(await x.finish(mvpPayload(x, x.host, 'old-retry-value', 1000, 10000))), first,
                    'durable successful replay precedes validation of an irrelevant retry payload')
                assert.deepEqual(snapshot(x.host.id), settled)
            })
            for (const [label, own, mate, expected] of [['higher', 10000, 1000, 1], ['lower', 1000, 10000, 0], ['tied', 1000, 1000, 1]]) {
                await run('mvp', `legacy missing MVP field retains ${label} contribution compatibility`, async t => {
                    const x = await setup(t)
                    decode(await x.finish(mvpPayload(x, x.host, undefined, own, mate)))
                    assertMvp(x.host.id, expected)
                })
            }
            await run('mvp', 'legacy quest_statistics preserves explicit false and does not override current statistics', async t => {
                const x = await setup(t), extra = mvpPayload(x, x.host, false, 10000, 1000)
                extra.quest_statistics = extra.statistics
                extra.statistics = undefined
                decode(await x.finish(extra))
                assertMvp(x.host.id, 0)
                const y = await setup(t)
                decode(await y.finish({ ...mvpPayload(y, y.host, false, 10000, 1000), quest_statistics: { ...statistics(), is_mvp: true } }))
                assertMvp(y.host.id, 0)
            })
            for (const order of ['host-first', 'guest-first']) {
                await run('mvp', `both real members keep their reported MVP facts (${order})`, async t => {
                    const x = await setup(t)
                    const started = await multiStart({ ...x, host: x.guest })
                    assert.equal(started.statusCode, 200, started.body)
                    assert.equal(started.json().data.play_id, x.playId)
                    const members = order === 'host-first' ? [x.host, x.guest] : [x.guest, x.host]
                    for (const member of members) {
                        const isMvp = member.id === x.host.id
                        const first = decode(await finish(member, x.room.room_number, x.playId,
                            mvpPayload(x, member, isMvp, isMvp ? 1000 : 10000, isMvp ? 10000 : 1000)))
                        assertMvp(member.id, isMvp ? 1 : 0)
                        const committed = snapshot(member.id)
                        assert.deepEqual(decode(await finish(member, x.room.room_number, x.playId, { api_count: 99 })), first)
                        assert.deepEqual(snapshot(member.id), committed)
                    }
                    assertMvp(x.host.id, 1)
                    assertMvp(x.guest.id, 0)
                })
            }
            await run('mvp', 'an unsuccessful battle cannot count MVP even with an explicit true or missing field', async t => {
                for (const flag of [true, false, undefined]) {
                    const x = await setup(t)
                    seedMvp(x.host.id, 7)
                    decode(await x.finish({ ...mvpPayload(x, x.host, flag, 10000, 1000), is_accomplished: false }))
                    assertMvp(x.host.id, 7)
                    const committed = snapshot(x.host.id)
                    decode(await x.finish({ ...mvpPayload(x, x.host, true, 10000, 1000), api_count: 99 }))
                    assert.deepEqual(snapshot(x.host.id), committed)
                }
            })
            await run('mvp', 'provided non-boolean MVP values are rejected without consuming the play', async t => {
                const x = await setup(t), before = snapshot(x.host.id), memory = structuredClone(single.activeQuests[x.host.id])
                for (const invalid of [null, 0, 1, '', 'false', 'true', [], {}]) {
                    const rejected = await x.finish(mvpPayload(x, x.host, invalid, 10000, 1000))
                    assert.equal(rejected.statusCode, 400, `${JSON.stringify(invalid)}: ${rejected.body}`)
                    assert.match(rejected.body, /is_mvp.*boolean/)
                    assert.deepEqual(snapshot(x.host.id), before)
                    assert.deepEqual(single.activeQuests[x.host.id], memory)
                }
                const legacyInvalid = mvpPayload(x, x.host, null, 10000, 1000)
                legacyInvalid.quest_statistics = legacyInvalid.statistics
                legacyInvalid.statistics = undefined
                assert.equal((await x.finish(legacyInvalid)).statusCode, 400)
                assert.deepEqual(snapshot(x.host.id), before)
                decode(await x.finish(mvpPayload(x, x.host, true, 1000, 10000)))
                assertMvp(x.host.id, 1)
            })
            await run('mvp', 'the transaction rejects an invalid MVP flag even when HTTP validation was bypassed', async t => {
                const x = await setup(t), before = snapshot(x.host.id), coordinator = load('lib/persistence-coordinator')
                const original = coordinator.runWriterCommand
                let injected = false
                const hook = t.mock.method(coordinator, 'runWriterCommand', (name, args, context) => {
                    if (name === 'multi.settle_finish' && args.playerId === x.host.id) {
                        injected = true
                        args = { ...args, body: { ...args.body, statistics: { ...args.body.statistics, is_mvp: null } } }
                    }
                    return original(name, args, context)
                })
                try {
                    const rejected = await x.finish(mvpPayload(x, x.host, true, 1000, 10000))
                    assert.equal(rejected.statusCode, 500, rejected.body)
                    assert.match(rejected.body, /is_mvp.*boolean/)
                    assert.equal(injected, true)
                    assert.deepEqual(snapshot(x.host.id), before)
                } finally { hook.mock.restore() }
                decode(await x.finish(mvpPayload(x, x.host, false, 10000, 1000)))
                assertMvp(x.host.id, 0)
            })
            await run('mvp', 'late receipt SQL failure rolls back MVP facts, title progress and every reward', async t => {
                const x = await setup(t)
                seedMvp(x.host.id, 99)
                const before = snapshot(x.host.id), guestBefore = snapshot(x.guest.id), memory = structuredClone(single.activeQuests[x.host.id])
                db.exec(`CREATE TRIGGER mvp_receipt_fault BEFORE INSERT ON player_operation_receipts
                    WHEN NEW.player_id=${x.host.id} AND NEW.operation='quest_finish.multi'
                    BEGIN SELECT RAISE(ABORT, 'injected MVP receipt fault'); END`)
                const writerBefore = writer.sqliteWriterStats()
                try {
                    const rejected = await x.finish(mvpPayload(x, x.host, true, 1000, 10000))
                    assert.equal(rejected.statusCode, 500, rejected.body)
                    assert.match(rejected.body, /injected MVP receipt fault/)
                    assert.deepEqual(snapshot(x.host.id), before)
                    assert.deepEqual(snapshot(x.guest.id), guestBefore)
                    assert.deepEqual(single.activeQuests[x.host.id], memory)
                    assertMvp(x.host.id, 99)
                    if (mode === 'writer') assert.ok(writer.sqliteWriterStats().failed > writerBefore.failed)
                } finally { db.exec('DROP TRIGGER mvp_receipt_fault') }
                decode(await x.finish(mvpPayload(x, x.host, true, 1000, 10000)))
                assertMvp(x.host.id, 100)
                const committed = snapshot(x.host.id)
                decode(await x.finish({ ...mvpPayload(x, x.host, false, 1000, 10000), api_count: 99 }))
                assert.deepEqual(snapshot(x.host.id), committed)
            })
            await run('concurrent', 'different api_count concurrent finishes pay a complete chain once', async t => {
                const x = await setup(t), before = balances(x.host.id), guestBefore = snapshot(x.guest.id)
                const [a, b] = await Promise.all([x.finish(), x.finish({ api_count: 3, category: `${CATEGORY}.0` })])
                assert.deepEqual(decode(b), decode(a)); assertPaid(before, balances(x.host.id))
                assert.equal(receipts(x.host.id).length, 1)
                assert.equal(db.prepare('SELECT COUNT(*) n FROM battle_settlement_ledger WHERE player_id=?').get(x.host.id).n, 1)
                assert.deepEqual(snapshot(x.guest.id), guestBefore, 'one member finish does not pay another member')
                const settled = snapshot(x.host.id)
                decode(await x.finish({ api_count: 8 }))
                assert.deepEqual(snapshot(x.host.id), settled)
            })

            await run('retention', 'pending start retries preserve the original clock and frozen snapshot', async t => {
                const x = await setup(t)
                db.prepare('UPDATE players_active_quests SET started_at_ms=started_at_ms-60000 WHERE player_id=?').run(x.host.id)
                single.activeQuests[x.host.id].startedAtMs -= 60000
                const snapshots = load('multi/settlement-snapshot')
                snapshots.getMultiSettlementSnapshot(x.host.id, x.playId).activeQuest.startedAtMs -= 60000
                const before = snapshot(x.host.id), memory = structuredClone(single.activeQuests[x.host.id])
                const frozen = structuredClone(snapshots.getMultiSettlementSnapshot(x.host.id, x.playId))
                const repeated = await multiStart(x)
                assert.equal(repeated.statusCode, 200, repeated.body)
                assert.deepEqual(snapshot(x.host.id), before)
                assert.deepEqual(single.activeQuests[x.host.id], memory)
                assert.deepEqual(snapshots.getMultiSettlementSnapshot(x.host.id, x.playId), frozen)
                const mismatch = await multiStart(x, { party_id: 2 })
                assert.equal(mismatch.statusCode, 200, mismatch.body)
                assert.equal(mismatch.json().data_headers.result_code, 4050, 'the realtime owner rejects changed retry identity before SQL')
                assert.deepEqual(snapshot(x.host.id), before)
            })

            await run('retention', 'expired or pruned payload cannot use a retained frozen snapshot, memory cache or another mode', async t => {
                const x = await setup(t), snapshots = load('multi/settlement-snapshot')
                const frozen = structuredClone(snapshots.getMultiSettlementSnapshot(x.host.id, x.playId))
                decode(await x.finish())
                const cache = load('lib/finish-response-cache')
                const key = cache.buildFinishResponseCacheKey('multi', x.host.viewerId, payload(x.host, x.room.room_number, x.playId))
                assert.ok(cache.getCachedFinishResponse(key), 'the old hot response is deliberately not evicted')
                const expiredAt = Date.now() - 86400000
                db.transaction(() => {
                    db.prepare("UPDATE player_operation_receipts SET created_at=? WHERE player_id=? AND operation='quest_finish.multi'").run(expiredAt, x.host.id)
                    db.prepare('UPDATE battle_settlement_ledger SET settled_at=? WHERE player_id=?').run(expiredAt, x.host.id)
                    db.prepare('UPDATE battle_receipt_payload_queue SET created_at=? WHERE player_id=?').run(expiredAt, x.host.id)
                })()
                snapshots.registerMultiSettlementSnapshot(frozen)
                for (const prune of [false, true]) {
                    if (prune) db.prepare("DELETE FROM player_operation_receipts WHERE player_id=? AND operation='quest_finish.multi'").run(x.host.id)
                    const settled = snapshot(x.host.id)
                    const rejected = await x.finish({ api_count: 77 })
                    assert.equal(rejected.statusCode, 400, rejected.body)
                    assert.equal((await singleFinish(x)).statusCode, 400)
                    assert.equal((await singleStart(x)).statusCode, 400)
                    // A room may itself be unavailable after settlement; either
                    // response must deny start, rather than recreate this play.
                    const restarted = await multiStart(x)
                    assert.ok(restarted.statusCode === 400 || restarted.json().data_headers.result_code === 4050, restarted.body)
                    assert.deepEqual(snapshot(x.host.id), settled)
                }
                assert.equal((await singleStart(x, { play_id: 'fresh-after-multi-expiry' })).statusCode, 200)
                const newer = snapshot(x.host.id), memory = structuredClone(single.activeQuests[x.host.id])
                assert.equal((await x.finish()).statusCode, 400)
                assert.equal((await singleStart(x)).statusCode, 400)
                assert.deepEqual(snapshot(x.host.id), newer)
                assert.deepEqual(single.activeQuests[x.host.id], memory)
            })

            await run('retention', 'queued real writer rejects a cross-mode terminal inserted after HTTP preparation', async t => {
                const x = await setup(t), coordinator = load('lib/persistence-coordinator')
                const original = coordinator.runWriterCommand
                let intercepted = false, terminalSnapshot
                const hook = t.mock.method(coordinator, 'runWriterCommand', async (name, args, context) => {
                    if (name === 'multi.settle_finish' && args.playerId === x.host.id && !intercepted) {
                        intercepted = true
                        db.transaction(() => {
                            const terminal = load('data/domains/battle-settlement-ledger').insertBattleSettlementSync(x.host.id, x.playId, 'single', Date.now() - 86400000)
                            load('data/domains/player-operation-receipt').insertPlayerOperationReceiptSync({
                                playerId: x.host.id, operation: 'quest_finish.single', requestKey: x.playId,
                                response: { data_headers: {}, data: { is_multi: 'single', user_info: {}, rewards: {} } },
                            }, terminal.settledAtMs)
                        })()
                        terminalSnapshot = snapshot(x.host.id)
                    }
                    return original(name, args, context)
                })
                try {
                    const rejected = await x.finish()
                    assert.equal(rejected.statusCode, 400, rejected.body)
                    assert.equal(intercepted, true)
                    assert.deepEqual(snapshot(x.host.id), terminalSnapshot)
                } finally { hook.mock.restore() }
            })

            await run('retention', 'ledger insert failure rolls back the complete multiplayer reward chain', async t => {
                const x = await setup(t), before = snapshot(x.host.id)
                db.exec(`CREATE TRIGGER multi_ledger_failure BEFORE INSERT ON battle_settlement_ledger
                    WHEN NEW.player_id=${x.host.id} BEGIN SELECT RAISE(ABORT, 'injected multi ledger failure'); END`)
                try {
                    const rejected = await x.finish()
                    assert.equal(rejected.statusCode, 500, rejected.body)
                    assert.match(rejected.body, /injected multi ledger failure/)
                    assert.deepEqual(snapshot(x.host.id), before)
                } finally { db.exec('DROP TRIGGER multi_ledger_failure') }
                decode(await x.finish())
                const settled = snapshot(x.host.id)
                decode(await x.finish())
                assert.deepEqual(snapshot(x.host.id), settled)
            })
            for (const fault of ['facts', 'receipt']) {
                await run(fault, `${fault} SQL fault rolls back all rewards and permits the original play retry`, async t => {
                    const x = await setup(t), before = snapshot(x.host.id), guestBefore = snapshot(x.guest.id)
                    const memory = structuredClone(single.activeQuests[x.host.id])
                    const stmt = fault === 'facts'
                        ? `BEFORE INSERT ON players_category_missions WHEN NEW.player_id = ${x.host.id} AND NEW.category = 2 AND NEW.id = ${DAILY_ID}`
                        : `BEFORE INSERT ON player_operation_receipts WHEN NEW.player_id = ${x.host.id} AND NEW.operation = 'quest_finish.multi'`
                    db.exec(`CREATE TRIGGER multi_finish_fault ${stmt} BEGIN SELECT RAISE(ABORT, 'injected multi ${fault} fault'); END`)
                    const writerBefore = writer.sqliteWriterStats()
                    try {
                        const failed = await timeout(x.finish(), 'fault request')
                        const failedState = snapshot(x.host.id)
                        const changedTables = Object.keys(before).filter(name => JSON.stringify(before[name]) !== JSON.stringify(failedState[name]))
                        console.log(JSON.stringify({ case: fault, mode, status: failed.statusCode,
                            changedTables, before: balancesFromSnapshot(before), after: balances(x.host.id) }))
                        assert.equal(failed.statusCode, 500, failed.body)
                        assert.match(failed.body, new RegExp(`injected multi ${fault} fault`))
                        assert.deepEqual(snapshot(x.host.id), before, 'base rewards, EXP, missions, inventory, receipts and active row must all roll back')
                        assert.deepEqual(snapshot(x.guest.id), guestBefore)
                        assert.deepEqual(single.activeQuests[x.host.id], memory)
                        if (mode === 'writer') assert.ok(writer.sqliteWriterStats().failed > writerBefore.failed, 'SQL fault occurred in the real writer connection')
                    } finally { db.exec('DROP TRIGGER multi_finish_fault') }
                    const first = decode(await timeout(x.finish({ api_count: 4 }), 'same play retry'))
                    assertPaid(balancesFromSnapshot(before), balances(x.host.id))
                    assert.equal(receipts(x.host.id).length, 1)
                    const settled = snapshot(x.host.id)
                    assert.deepEqual(decode(await x.finish({ api_count: 5 })).data, first.data)
                    assert.deepEqual(snapshot(x.host.id), settled)
                })
            }
            await run('restart', 'fresh process without a room or snapshot replays the complete durable response', async t => {
                const x = await setup(t)
                const first = decode(await x.finish()), settled = snapshot(x.host.id)
                const second = await freshReplay(x)
                assert.deepEqual(second.data, first.data)
                assert.deepEqual(snapshot(x.host.id), settled)
                assert.equal(receipts(x.host.id).length, 1)
            })
            await run('cross-endpoint', 'a multi registration cannot be paid or consumed through single finish', async t => {
                const x = await setup(t), before = snapshot(x.host.id), memory = structuredClone(single.activeQuests[x.host.id])
                const rejected = await singleFinish(x)
                assert.equal(rejected.statusCode, 400, rejected.body)
                assert.deepEqual(snapshot(x.host.id), before)
                assert.deepEqual(single.activeQuests[x.host.id], memory)
                decode(await x.finish()); assertPaid(balancesFromSnapshot(before), balances(x.host.id))
            })
            await run('cross-endpoint', 'a settled multi play cannot be paid again through rebuilt single finish', async t => {
                const x = await setup(t)
                decode(await x.finish())
                delete single.activeQuests[x.host.id]
                evictFinishCache(`multi-to-single:${mode}`)
                const before = snapshot(x.host.id)
                const rejected = await singleFinish(x, { api_count: 72 })
                assert.equal(rejected.statusCode, 400, rejected.body)
                assert.deepEqual(snapshot(x.host.id), before)
                assert.equal(db.prepare("SELECT count(*) n FROM player_operation_receipts WHERE player_id = ? AND operation = 'quest_finish.single'").get(x.host.id).n, 0)
            })
            await run('cross-endpoint', 'a paid single play cannot be paid again by its retained real multi snapshot', async t => {
                const x = await setup(t), snapshots = load('multi/settlement-snapshot')
                assert.ok(snapshots.getMultiSettlementSnapshot(x.host.id, x.playId), 'multi start created a real frozen snapshot')
                const pending = snapshot(x.host.id)
                const started = await singleStart(x)
                assert.equal(started.statusCode, 400, 'a new request cannot relabel the same pending play across modes')
                assert.deepEqual(snapshot(x.host.id), pending)
                // Simulate a pre-upgrade single registration while retaining a
                // genuine old multi snapshot. The guarded /start no longer
                // permits constructing this historical state through HTTP.
                const replaced = db.prepare(`UPDATE players_active_quests SET is_multi=0, is_multi_host=0
                    WHERE player_id=? AND play_id=? AND is_multi=1`).run(x.host.id, x.playId)
                assert.equal(replaced.changes, 1, 'fixture CAS must replace exactly the intended pending registration')
                delete single.activeQuests[x.host.id]
                decode(await singleFinish(x))
                assert.equal(db.prepare("SELECT count(*) n FROM player_operation_receipts WHERE player_id = ? AND operation = 'quest_finish.single'").get(x.host.id).n, 1)
                assert.ok(snapshots.getMultiSettlementSnapshot(x.host.id, x.playId), 'frozen multi snapshot survives single settlement')
                evictFinishCache(`single-to-multi:${mode}`)
                const before = snapshot(x.host.id)
                const rejected = await x.finish({ api_count: 73 })
                assert.equal(rejected.statusCode, 400, rejected.body)
                assert.deepEqual(snapshot(x.host.id), before)
                assert.equal(receipts(x.host.id).length, 0)
            })
            await run('identity', 'same-play wrong category or quest cannot consume the current frozen battle', async t => {
                const x = await setup(t), before = snapshot(x.host.id), memory = structuredClone(single.activeQuests[x.host.id])
                for (const wrong of [{ category: CATEGORY + 1 }, { quest_id: QUEST_ID + 1 }]) {
                    const rejected = await x.finish(wrong)
                    assert.equal(rejected.statusCode, 400, rejected.body)
                    assert.deepEqual(snapshot(x.host.id), before)
                    assert.deepEqual(single.activeQuests[x.host.id], memory)
                }
                decode(await x.finish()); assertPaid(balancesFromSnapshot(before), balances(x.host.id))
                assert.equal(receipts(x.host.id).length, 1)
            })
            await run('damaged-receipt', 'null, empty and malformed durable responses reject replay without paying again', async t => {
                const x = await setup(t)
                decode(await x.finish())
                delete single.activeQuests[x.host.id]
                for (const [corrupt, status] of [['null', 400], ['{}', 400], ['{', 400]]) {
                    db.prepare("UPDATE player_operation_receipts SET response_json = ? WHERE player_id = ? AND operation = 'quest_finish.multi' AND request_key = ?").run(corrupt, x.host.id, x.playId)
                    evictFinishCache(`damaged-multi:${mode}:${corrupt}`)
                    const damaged = snapshot(x.host.id)
                    const rejected = await x.finish({ api_count: 74 })
                    assert.equal(rejected.statusCode, status, rejected.body)
                    assert.deepEqual(snapshot(x.host.id), damaged)
                }
            })
            await run('fresh', 'balances changed after context read survive settlement', async t => {
                const x = await setup(t), before = balances(x.host.id)
                const original = playerContext.resolveMultiPlayerContext
                let injected = false
                t.mock.method(playerContext, 'resolveMultiPlayerContext', async (...args) => {
                    const ctx = await original(...args)
                    if (args[0] === x.host.viewerId && !injected) {
                        injected = true
                        db.prepare('UPDATE players SET rank_point = rank_point + 5, free_mana = free_mana + 7, boost_point = boost_point + 1, total_mana_obtained = total_mana_obtained + 11 WHERE id = ?').run(x.host.id)
                    }
                    return ctx
                })
                const data = decode(await x.finish()).data, after = balances(x.host.id)
                assert.equal(after.rank_point, before.rank_point + 19)
                assert.equal(data.before_rank_point, before.rank_point + 5)
                assert.equal(data.user_info.rank_point, after.rank_point)
                assert.ok(after.free_mana >= before.free_mana + 142)
                assert.equal(after.boost_point, before.boost_point + 1)
                assert.ok(after.total_mana_obtained >= before.total_mana_obtained + 146)
                assert.equal(injected, true)
            })
            await run('new-start', 'old frozen battle settles without consuming a new registration', async t => {
                const x = await setup(t), coordinator = load('lib/persistence-coordinator')
                const original = coordinator.runWriterCommand
                let signal, release
                const reached = new Promise(resolve => { signal = resolve }), gate = new Promise(resolve => { release = resolve })
                let paused = false
                const hook = t.mock.method(coordinator, 'runWriterCommand', async (name, args, context) => {
                    if (name === 'multi.settle_finish' && args.playerId === x.host.id && !paused) { paused = true; signal(); await gate }
                    return original(name, args, context)
                })
                const pending = x.finish()
                try {
                    await timeout(reached, 'captured old finish')
                    const started = await app.inject({ method: 'POST', url: '/single/start', payload: {
                        viewer_id: x.host.viewerId, quest_id: QUEST_ID, category: CATEGORY, party_id: 1,
                        play_id: 'new-single-play', use_boss_boost_point: false, use_boost_point: false,
                        is_auto_start_mode: false, api_count: 1,
                    } })
                    assert.equal(started.statusCode, 200, started.body)
                    const newRow = db.prepare('SELECT * FROM players_active_quests WHERE player_id = ?').get(x.host.id)
                    const newMemory = structuredClone(single.activeQuests[x.host.id])
                    release(); const old = decode(await timeout(pending, 'old settlement'))
                    assert.equal(old.data.is_multi, 'multi')
                    assert.deepEqual(db.prepare('SELECT * FROM players_active_quests WHERE player_id = ?').get(x.host.id), newRow)
                    assert.deepEqual(single.activeQuests[x.host.id], newMemory)
                    const settled = snapshot(x.host.id)
                    assert.deepEqual(decode(await x.finish({ api_count: 9 })).data, old.data)
                    assert.deepEqual(snapshot(x.host.id), settled)
                } finally { release(); hook.mock.restore() }
            })
            await run('stale', 'a missing old play is acknowledged without changing a newer registration', async t => {
                const x = await setup(t), before = snapshot(x.host.id), memory = structuredClone(single.activeQuests[x.host.id])
                const response = decode(await finish(x.host, x.room.room_number, 'unknown-old-play'))
                assert.equal(response.data_headers.result_code, 1)
                assert.deepEqual(snapshot(x.host.id), before)
                assert.deepEqual(single.activeQuests[x.host.id], memory)
            })
        })
    }
}

function balancesFromSnapshot(state) {
    const player = state.players[0]
    return { ...Object.fromEntries(['rank_point', 'free_mana', 'exp_pool', 'boost_point', 'boss_boost_point', 'total_mana_obtained'].map(key => [key, player[key]])),
        characterExp: state.players_characters.find(c => c.id === 1).exp,
        item: state.players_items.find(i => i.id === ITEM_ID)?.amount ?? 0,
        daily: state.players_category_missions.find(m => m.category === 2 && m.id === DAILY_ID)?.progress ?? 0 }
}

const ROSTER_ALTERNATIVE = 111015
function addRosterAlternative(playerId) {
    load('data/domains/character').insertDefaultPlayerCharacterSync(playerId, ROSTER_ALTERNATIVE)
}
function rosterStatistics(characterId) {
    const value = statistics()
    value.party.characters[0].id = characterId
    return value
}
function rosterWireParty(characterId) {
    return { characters: [[0, { id: characterId }], [1], [1]],
        unison_characters: [[1], [1], [1]], equipments: [[1], [1], [1]], abilitySoulIds: [[1], [1], [1]] }
}
function changeRosterParty(playerId, change) {
    const party = savedParty(); party.characterIds[0] = ROSTER_ALTERNATIVE
    const slot = change === 'switch-current-slot' ? 2 : 1
    parties.updatePlayerPartySync(playerId, slot, party, 1)
    players.updatePlayerSync({ id: playerId, partySlot: slot })
}
function rosterFacts(playerId) {
    const character = load('data/domains/character'), counters = load('lib/mission/counters')
    const leader = id => counters.getMissionCounterValueSync(playerId, {
        dimension: 'character.battle_clear', scopeType: 'character', scopeKey: String(id), qualifier: { position: 'leader' },
    })
    return { originalExp: character.getPlayerCharacterSync(playerId, 1)?.exp ?? null,
        alternativeExp: character.getPlayerCharacterSync(playerId, ROSTER_ALTERNATIVE)?.exp ?? null,
        originalLeader: leader(1), alternativeLeader: leader(ROSTER_ALTERNATIVE) }
}
function assertRosterPaid(before, after) {
    assert.equal(after.originalExp, before.originalExp + 26, 'the actual start character receives one reward')
    assert.equal(after.alternativeExp, before.alternativeExp, 'another owned character cannot steal battle EXP')
    assert.equal(after.originalLeader, before.originalLeader + 1, 'the frozen leader receives the battle fact')
    assert.equal(after.alternativeLeader, before.alternativeLeader, 'the reported replacement cannot steal the leader fact')
}
