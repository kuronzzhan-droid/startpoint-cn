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
// All deterministic fixture rewards are in questData, which is cloned to the
// real writer. Failures are injected with persistent SQL triggers below.
assets.getQuestFromCategorySync = (category, questId) => {
    const quest = originalQuest(category, questId)
    return Number(category) === CATEGORY && Number(questId) === QUEST_ID && quest ? {
        ...quest, rankPointReward: 14, manaReward: 135, poolExpReward: 26, characterExpReward: 26,
        clearReward: { type: 0, id: ITEM_ID, count: 2 }, sPlusReward: { type: 0, id: ITEM_ID, count: 3 },
        scoreRewardGroupId: undefined, scoreRewardGroup: undefined,
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
function singleStart(x) {
    return app.inject({ method: 'POST', url: '/single/start', payload: {
        viewer_id: x.host.viewerId, quest_id: QUEST_ID, category: CATEGORY, party_id: 1,
        play_id: x.playId, use_boss_boost_point: false, use_boost_point: false,
        is_auto_start_mode: false, api_count: 1,
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
async function setup(t) {
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
    const playId = `multi-play-${host.id}`
    const started = await app.inject({ method: 'POST', url: '/multi/start', payload: {
        viewer_id: host.viewerId, category: CATEGORY, quest_id: QUEST_ID, party_id: 1,
        room_number: room.room_number, play_id: playId, use_boost_point: false,
        use_boss_boost_point: false, is_auto_start_mode: false, mate_player_ids: [], mate_party_ids: [],
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
async function freshReplay(x) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [__filename], { cwd: repository, windowsHide: true,
            env: { ...process.env, MULTI_FINISH_TEST_REPO: repository,
                MULTI_FINISH_REPLAY: JSON.stringify({ directory, host: x.host, roomNumber: x.room.room_number, playId: x.playId }) },
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
        app = await makeApp()
        try { console.log(`MULTI_REPLAY_RESULT:${JSON.stringify(decode(await finish(replay.host, replay.roomNumber, replay.playId, { api_count: 99 })))}`) }
        finally { await app.close(); timers.forEach(clearInterval); db.close() }
    })().catch(error => { console.error(error); process.exitCode = 1 })
} else {
    test.before(async () => { app = await makeApp() })
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
            await run('concurrent', 'different api_count concurrent finishes pay a complete chain once', async t => {
                const x = await setup(t), before = balances(x.host.id), guestBefore = snapshot(x.guest.id)
                const [a, b] = await Promise.all([x.finish(), x.finish({ api_count: 3, category: `${CATEGORY}.0` })])
                assert.deepEqual(decode(b), decode(a)); assertPaid(before, balances(x.host.id))
                assert.equal(receipts(x.host.id).length, 1)
                assert.deepEqual(snapshot(x.guest.id), guestBefore, 'one member finish does not pay another member')
                const settled = snapshot(x.host.id)
                decode(await x.finish({ api_count: 8 }))
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
                const started = await singleStart(x)
                assert.equal(started.statusCode, 200, started.body)
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
                for (const [corrupt, status] of [['null', 400], ['{}', 400], ['{', 500]]) {
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
