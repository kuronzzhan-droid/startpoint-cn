'use strict'

// A play settles at most once; repeated distinct plays without /start still settle.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { EventEmitter } = require('node:events')
const Fastify = require('fastify')
const { pack, unpack } = require('msgpackr')

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'finish-idempotency-'))
process.env.DATA_DIR = directory
process.env.GAME_ROUTINE_LOGS = 'off'
process.env.MULTI_SETTLEMENT_BARRIER_MS = '20'
delete process.env.CN_WRITER_THREAD
delete process.env.QUEST_FINISH_STRICT

const originalInterval = global.setInterval
const intervals = []
global.setInterval = (...args) => {
    const timer = originalInterval(...args)
    intervals.push(timer)
    return timer
}
let db, accounts, players, sessions, parties, rooms, manager, battle, singleRoutes, single, cache, sessionValidator
try {
    db = require('../out/data/db').getDb()
    require('../out/data').initializeDatabase()
    accounts = require('../out/data/domains/account')
    players = require('../out/data/domains/player')
    sessions = require('../out/data/domains/session')
    parties = require('../out/data/domains/party')
    rooms = require('../out/multi/room/manager')
    manager = require('../out/multi/state/SessionManager').sessionManager
    battle = require('../out/multi/http/battle')
    single = require('../out/routes/api/singleBattleQuest')
    singleRoutes = single.default
    cache = require('../out/lib/finish-response-cache')
    sessionValidator = require('../out/lib/quest/finish/session-validator')
} finally {
    global.setInterval = originalInterval
}

const CATEGORY = 2
const QUEST_ID = 1001001
let sequence = 0

class Socket extends EventEmitter {
    destroyed = false; readable = true; writable = true; frames = []
    write(frame) { this.frames.push(JSON.parse(frame.replace(/\0$/, ''))); return true }
    end() { this.writable = false }
    destroy() { this.destroyed = true; this.emit('close') }
}

function makePlayer() {
    const n = ++sequence
    const account = accounts.insertAccountSync({
        appId: 'wf_cn', idpAlias: '', idpCode: 'test', idpId: `finish-idempotency-${n}`, status: 'normal',
    })
    const player = players.insertDefaultPlayerSync(account.id)
    require('../out/data/activeAccount').saveAccountDefaultPlayer(account.id, player.id)
    const viewerId = 881000000 + n
    sessions.insertSessionWithTokenSync({
        token: String(viewerId), accountId: account.id, type: 2,
        expires: new Date(Date.now() + 86400000),
    })
    return { id: player.id, viewerId }
}

// Rank point and pooled EXP are granted only by the settlement itself; mission
// rewards can add Mana or stones depending on the calendar, so they are not compared.
function totals(playerId) {
    const row = players.getPlayerSync(playerId)
    return { rankPoint: row.rankPoint, expPool: row.expPool }
}

function statistics() {
    return {
        clear_phase: 1, max_combo_count: 0,
        party: {
            characters: [{ id: 1 }, null, null],
            unison_characters: [null, null, null],
            equipments: [null, null, null], ability_soul_ids: [null, null, null],
        },
    }
}

let singleApp
test.before(async () => {
    singleApp = Fastify()
    singleApp.addHook('onSend', (_request, reply, payload, done) => {
        done(null, reply.getHeader('content-type') === 'application/x-msgpack'
            ? pack(payload).toString('base64') : payload)
    })
    await singleApp.register(singleRoutes, { prefix: '/single' })
    await singleApp.ready()
})

function decode(response) {
    assert.equal(response.statusCode, 200, response.body)
    return unpack(Buffer.from(response.body, 'base64'))
}

function singleStart(p, playId) {
    return singleApp.inject({
        method: 'POST', url: '/single/start', payload: {
            viewer_id: p.viewerId, quest_id: QUEST_ID, category: CATEGORY, party_id: 1,
            play_id: playId, use_boss_boost_point: false, use_boost_point: false,
            is_auto_start_mode: false, api_count: 1,
        },
    })
}

function singleFinish(p, extra = {}) {
    return singleApp.inject({
        method: 'POST', url: '/single/finish', payload: {
            viewer_id: p.viewerId, quest_id: QUEST_ID, category: CATEGORY, continue_count: 0,
            elapsed_time_ms: 60_000, score: 100, add_mana: 0,
            is_accomplished: true, is_restored: false, statistics: statistics(), ...extra,
        },
    })
}

function delta(before, after) {
    return { rankPoint: after.rankPoint - before.rankPoint, expPool: after.expPool - before.expPool }
}


const http = require('node:http')

/** Send a finish over a real socket and destroy the socket before any response. */
function sendAndAbandon(port, url, payload) {
    return new Promise(resolve => {
        const request = http.request({ host: '127.0.0.1', port, path: url, method: 'POST',
            headers: { 'content-type': 'application/json' } })
        request.on('error', () => resolve())
        request.end(JSON.stringify(payload))
        // Give the server time to parse the body and park on the finish queue.
        setTimeout(() => { request.destroy(); setTimeout(resolve, 100) }, 150)
    })
}

function withinTimeout(promise, ms, label) {
    let timer
    return Promise.race([
        promise.finally(() => clearTimeout(timer)),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} did not complete`)), ms) }),
    ])
}

test('single: concurrent identical finishes after /start settle once and share one response', async () => {
    // Control: one ordinary first clear.
    const control = makePlayer()
    assert.equal((await singleStart(control, 'play-a')).statusCode, 200)
    const controlBefore = totals(control.id)
    decode(await singleFinish(control, { play_id: 'play-a', api_count: 2 }))
    const expected = delta(controlBefore, totals(control.id))
    assert.equal(expected.rankPoint, 14)

    const p = makePlayer()
    assert.equal((await singleStart(p, 'play-a')).statusCode, 200)
    const before = totals(p.id)
    const [first, second] = await Promise.all([
        singleFinish(p, { play_id: 'play-a', api_count: 2 }),
        singleFinish(p, { play_id: 'play-a', api_count: 2 }),
    ])
    assert.deepEqual(decode(second), decode(first))
    assert.deepEqual(delta(before, totals(p.id)), expected, 'rewards, including first clear, are granted once')
})

test('single: a registered play whose row was already consumed writes nothing', async () => {
    const p = makePlayer()
    assert.equal((await singleStart(p, 'play-b')).statusCode, 200)
    const registered = { ...single.activeQuests[p.id] }
    decode(await singleFinish(p, { play_id: 'play-b', api_count: 2 }))
    const settled = totals(p.id)
    const changes = db.prepare('SELECT total_changes() AS n').get().n
    // A stale in-memory registration (as left by a lost response) must not
    // pay again for a request the response cache does not recognise.
    single.activeQuests[p.id] = registered
    const retry = await singleFinish(p, { api_count: 7 })
    assert.equal(retry.statusCode, 400, retry.body)
    assert.deepEqual(totals(p.id), settled)
    assert.equal(db.prepare('SELECT total_changes() AS n').get().n, changes)
    assert.equal(single.activeQuests[p.id], undefined)
})

test('single: finishes rebuilt without /start keep settling distinct plays and dedupe a repeated one', async () => {
    const p = makePlayer()
    const before = totals(p.id)
    decode(await singleFinish(p, { play_id: 'rebuilt-1', api_count: 2 }))
    decode(await singleFinish(p, { play_id: 'rebuilt-2', api_count: 3 }))
    const afterDistinct = totals(p.id)
    assert.equal(afterDistinct.rankPoint - before.rankPoint, 28, 'two distinct plays both settle')
    const [a, b] = await Promise.all([
        singleFinish(p, { play_id: 'rebuilt-3', api_count: 4 }),
        singleFinish(p, { play_id: 'rebuilt-3', api_count: 4 }),
    ])
    assert.deepEqual(decode(b), decode(a))
    assert.equal(totals(p.id).rankPoint - afterDistinct.rankPoint, 14, 'a repeated play settles once')
})

test('single: tokenless finishes are serialized per player and never lose an update', async () => {
    const p = makePlayer()
    const before = totals(p.id)
    const responses = await Promise.all([singleFinish(p), singleFinish(p), singleFinish(p)])
    for (const response of responses) decode(response)
    assert.equal(totals(p.id).rankPoint - before.rankPoint, 42)
})

test('single: a client that disconnects while queued does not block later finishes', async () => {
    const p = makePlayer()
    const port = await (async () => {
        const app = Fastify()
        await app.register(singleRoutes, { prefix: '/single' })
        await app.listen({ host: '127.0.0.1', port: 0 })
        test.after(() => app.close())
        return app.server.address().port
    })()
    const hold = await cache.acquireFinishExecution(`single:${p.id}`)
    await sendAndAbandon(port, '/single/finish', {
        viewer_id: p.viewerId, quest_id: QUEST_ID, category: CATEGORY, continue_count: 0,
        elapsed_time_ms: 60_000, score: 100, add_mana: 0, is_accomplished: true, is_restored: false,
        statistics: statistics(), play_id: 'abandoned', api_count: 2,
    })
    hold()
    const next = await withinTimeout(singleFinish(p, { play_id: 'after-abandon', api_count: 3 }), 5000, 'next finish')
    decode(next)
})

function evictFinishCache() {
    for (let index = 0; index < 600; index++) cache.cacheFinishResponse(`evict:${Date.now()}:${index}`, {})
}

for (const withStart of [true, false]) {
    test(`single: the same play_id after the response cache is gone pays nothing (${withStart ? 'with /start' : 'rebuilt'})`, async () => {
        const p = makePlayer()
        const playId = withStart ? 'durable-start' : 'durable-rebuilt'
        if (withStart) assert.equal((await singleStart(p, playId)).statusCode, 200)
        const before = totals(p.id)
        const first = decode(await singleFinish(p, { play_id: playId, api_count: 2 }))
        const settled = totals(p.id)
        assert.equal(settled.rankPoint - before.rankPoint, 14)
        assert.equal(single.activeQuests[p.id], undefined)
        evictFinishCache()
        const retry = decode(await singleFinish(p, { play_id: playId, api_count: 3 }))
        assert.deepEqual(retry.data, first.data)
        assert.deepEqual(totals(p.id), settled)
        // A different play id is a different battle and still settles.
        decode(await singleFinish(p, { play_id: `${playId}-next`, api_count: 4 }))
        assert.equal(totals(p.id).rankPoint - settled.rankPoint, 14)
    })
}

test('single: a receipt past its response retention still blocks a second payout', async () => {
    const p = makePlayer()
    decode(await singleFinish(p, { play_id: 'old-play', api_count: 2 }))
    const settled = totals(p.id)
    const receipts = require('../out/data/domains/finish-receipt')
    const old = Date.now() - receipts.finishReceiptResponseRetentionMs() - 60_000
    db.prepare(`UPDATE player_operation_receipts SET created_at = ? WHERE player_id = ?`).run(old, p.id)
    receipts.pruneFinishReceiptsSync(p.id)
    assert.deepEqual(receipts.getFinishReceiptSync(p.id, 'single', 'old-play'), { response: null })
    evictFinishCache()
    const retry = await singleFinish(p, { play_id: 'old-play', api_count: 3 })
    assert.equal(retry.statusCode, 400, retry.body)
    assert.deepEqual(totals(p.id), settled)
    db.prepare(`UPDATE player_operation_receipts SET created_at = ? WHERE player_id = ?`)
        .run(Date.now() - receipts.finishReceiptRetentionMs() - 60_000, p.id)
    receipts.pruneFinishReceiptsSync(p.id)
    assert.equal(receipts.getFinishReceiptSync(p.id, 'single', 'old-play'), null, 'keys are bounded too')
})

test('single: a write landing after the request read is preserved by the settlement', async t => {
    const control = makePlayer()
    const controlBefore = totals(control.id)
    decode(await singleFinish(control, { play_id: 'late-write', api_count: 2 }))
    const expected = delta(controlBefore, totals(control.id))
    const p = makePlayer()
    const original = sessionValidator.validateSessionAndPlayer
    t.mock.method(sessionValidator, 'validateSessionAndPlayer', async viewerId => {
        const result = await original(viewerId)
        // Another persisted change after this request has read the player row.
        db.prepare('UPDATE players SET rank_point = rank_point + 5 WHERE id = ?').run(p.id)
        return result
    })
    const before = totals(p.id)
    const data = decode(await singleFinish(p, { play_id: 'late-write', api_count: 2 })).data
    const after = totals(p.id)
    assert.equal(after.rankPoint - before.rankPoint, 5 + expected.rankPoint)
    assert.equal(data.user_info.rank_point, after.rankPoint)
    assert.equal(data.before_rank_point, before.rankPoint + 5)
})

test('response cache key normalizes numeric fields and keeps the established format', () => {
    const key = cache.buildFinishResponseCacheKey
    assert.equal(key('single', 9, { category: 2, quest_id: 1001001, play_id: 'p' }), 'single:9:2:1001001:p')
    assert.equal(key('single', 9, { category: '2', quest_id: ' 1001001', api_count: '5' }), 'single:9:2:1001001:api:5')
    assert.equal(key('single', 9, { category: 2, quest_id: 1001001, api_count: 5 }), 'single:9:2:1001001:api:5')
    // A non-numeric token keeps its previous form so stored receipts still match.
    assert.equal(key('single', 9, { category: 2, quest_id: 1001001, api_count: '' }), 'single:9:2:1001001:api:')
    assert.equal(key('single', 9, { category: 2, api_count: 'x' }), 'single:9:2::api:x')
    assert.equal(key('single', 9, { category: 2 }), null)
    assert.equal(key('multi', 9, { play_id: 'p', api_count: 1, category: 3, quest_id: 5 }, { playerId: 4 }),
        key('multi', 8, { play_id: 'p', api_count: 2, category: '3.0', quest_id: '5' }, { playerId: 4 }))
    assert.notEqual(key('multi', 9, { play_id: 'p', category: 3, quest_id: 5 }, { playerId: 4 }),
        key('multi', 9, { play_id: 'p', category: 3, quest_id: 6 }, { playerId: 4 }))
    assert.equal(cache.buildFinishExecutionKey('single', 4, {}), 'single:4')
    assert.equal(cache.buildFinishExecutionKey('multi', 4, {}), 'multi:4:')
})

function savedParty() {
    return {
        category: 1, name: 'test', characterIds: [1, null, null],
        unisonCharacterIds: [null, null, null], equipmentIds: [null, null, null],
        abilitySoulIds: [null, null, null], edited: true,
        options: { allowOtherPlayersToHealMe: true },
    }
}

async function multiSetup(t) {
    const host = makePlayer(), guest = makePlayer()
    const room = rooms.createRoom(host.viewerId, host.id, 1, CATEGORY, QUEST_ID, 0, 1)
    const clients = [host, guest].map(player => {
        const c = manager.createClient(new Socket(), player.viewerId, room.room_number, `cid-idem-${player.id}`, player.id)
        c.enterData = {}
        c.isReady = true
        c.yourself = {
            viewerId: player.viewerId, playerId: player.id, connectionId: c.connectionId,
            comId: 0, currentPartyId: 1, state: [1],
            party: { equipments: [], abilitySoulIds: [] },
        }
        manager.addClientToRoom(c)
        rooms.addRoomMember(room.room_number, player.viewerId, player.id)
        parties.updatePlayerPartySync(player.id, 1, savedParty(), 1)
        players.updatePlayerSync({ id: player.id, partySlot: 1 })
        return c
    })
    for (const client of clients) client.mates = clients.map(c => c.yourself)
    const app = Fastify()
    app.addHook('onSend', (_req, reply, payload, done) => {
        done(null, reply.getHeader('content-type') === 'application/x-msgpack'
            ? JSON.stringify(payload) : payload)
    })
    t.after(async () => {
        manager.commitRoomDisband(room.room_number, 'test_cleanup')
        for (const client of clients) client.socket.destroy()
        await app.close()
        await new Promise(resolve => setImmediate(resolve))
    })
    await app.register(async instance => battle.registerBattleRoutes(instance), { prefix: '/multi' })
    await app.ready()
    const start = () => app.inject({
        method: 'POST', url: '/multi/start', payload: {
            viewer_id: host.viewerId, category: CATEGORY, quest_id: QUEST_ID,
            party_id: 1, room_number: room.room_number, play_id: `mplay-${host.id}`,
            use_boost_point: false, use_boss_boost_point: false, is_auto_start_mode: false,
            mate_player_ids: [], mate_party_ids: [],
        },
    })
    const finishPayload = (extra = {}) => ({
        viewer_id: host.viewerId, play_id: `mplay-${host.id}`,
        category: CATEGORY, quest_id: QUEST_ID, room_number: room.room_number,
        is_accomplished: true, elapsed_time_ms: 30_000, score: 100,
        add_mana: 0, continue_count: 0, api_count: 2, mate_player_result: [],
        statistics: statistics(), ...extra,
    })
    const finish = (extra = {}) => app.inject({
        method: 'POST', url: '/multi/finish', payload: finishPayload(extra),
    })
    return { host, room, app, start, finish, finishPayload }
}

test('multi: concurrent finishes for one play with different request fields pay once', async t => {
    const control = await multiSetup(t)
    assert.equal((await control.start()).json().data.play_id, `mplay-${control.host.id}`)
    const controlBefore = totals(control.host.id)
    const single = await control.finish()
    assert.equal(single.statusCode, 200, single.body)
    const expected = delta(controlBefore, totals(control.host.id))
    assert.equal(expected.rankPoint, 14)

    const x = await multiSetup(t)
    assert.equal((await x.start()).json().data.play_id, `mplay-${x.host.id}`)
    const before = totals(x.host.id)
    const [a, b] = await Promise.all([
        x.finish({ api_count: 2 }),
        x.finish({ api_count: 3, category: `${CATEGORY}.0` }),
    ])
    assert.equal(a.statusCode, 200, a.body)
    assert.equal(b.statusCode, 200, b.body)
    assert.deepEqual(b.json(), a.json())
    assert.deepEqual(delta(before, totals(x.host.id)), expected)
})

test('multi: a retry after the response cache dropped the entry replays without paying again', async t => {
    const x = await multiSetup(t)
    assert.equal((await x.start()).json().data.play_id, `mplay-${x.host.id}`)
    const before = totals(x.host.id)
    const first = await x.finish()
    assert.equal(first.statusCode, 200, first.body)
    assert.equal(first.json().data_headers.result_code, 1, first.body)
    const settled = totals(x.host.id)
    assert.equal(settled.rankPoint - before.rankPoint, 14)
    // Push the settled entry out of the bounded response cache.
    for (let index = 0; index < 600; index++) cache.cacheFinishResponse(`filler:${index}`, {})
    // Model a still-valid registration for this play so only the latch can stop it.
    const snapshot = require('../out/multi/settlement-snapshot').getMultiSettlementSnapshot(x.host.id, `mplay-${x.host.id}`)
    assert.equal(snapshot.settled, true)
    single.activeQuests[x.host.id] = { ...snapshot.activeQuest }
    const retry = await x.finish({ api_count: 9 })
    assert.equal(retry.statusCode, 200, retry.body)
    assert.deepEqual(retry.json().data, first.json().data)
    assert.deepEqual(totals(x.host.id), settled)
    delete single.activeQuests[x.host.id]
})

test('multi: the same play_id after the cache and the settled snapshot are gone pays nothing', async t => {
    const x = await multiSetup(t)
    assert.equal((await x.start()).json().data.play_id, `mplay-${x.host.id}`)
    const before = totals(x.host.id)
    const first = await x.finish()
    assert.equal(first.statusCode, 200, first.body)
    const settled = totals(x.host.id)
    assert.equal(settled.rankPoint - before.rankPoint, 14)
    evictFinishCache()
    const snapshot = require('../out/multi/settlement-snapshot').getMultiSettlementSnapshot(x.host.id, `mplay-${x.host.id}`)
    // Model the snapshot expiring while a registration for the play is still around.
    snapshot.settled = false
    delete snapshot.settledResponse
    single.activeQuests[x.host.id] = { ...snapshot.activeQuest }
    const retry = await x.finish({ api_count: 9 })
    assert.equal(retry.statusCode, 200, retry.body)
    assert.deepEqual(retry.json().data, first.json().data)
    assert.deepEqual(totals(x.host.id), settled)
    delete single.activeQuests[x.host.id]
})

test('multi: a client that disconnects while queued does not block the retry', async t => {
    const x = await multiSetup(t)
    assert.equal((await x.start()).json().data.play_id, `mplay-${x.host.id}`)
    await x.app.listen({ host: '127.0.0.1', port: 0 })
    const port = x.app.server.address().port
    const before = totals(x.host.id)
    const hold = await cache.acquireFinishExecution(`multi:${x.host.id}:mplay-${x.host.id}`)
    await sendAndAbandon(port, '/multi/finish', x.finishPayload())
    hold()
    const retry = await withinTimeout(x.finish({ api_count: 5 }), 5000, 'retry finish')
    assert.equal(retry.statusCode, 200, retry.body)
    assert.equal(totals(x.host.id).rankPoint - before.rankPoint, 14, 'the play still settles exactly once')
})

// Runs last: the writer switch stays latched for the rest of the process.
test('single: the consumed-play check also holds when settlement runs in the writer thread', async () => {
    const writerClient = require('../out/lib/persistence/writer-client')
    process.env.CN_WRITER_THREAD = '1'
    try {
        assert.equal(writerClient.startSqliteWriter(db.name), true)
        assert.equal(await writerClient.waitForSqliteWriterReady(30_000), true)
        const p = makePlayer()
        assert.equal((await singleStart(p, 'writer-play')).statusCode, 200)
        const registered = { ...single.activeQuests[p.id] }
        const before = totals(p.id)
        const [first, second] = await Promise.all([
            singleFinish(p, { play_id: 'writer-play', api_count: 2 }),
            singleFinish(p, { play_id: 'writer-play', api_count: 2 }),
        ])
        assert.deepEqual(decode(second), decode(first))
        const settled = totals(p.id)
        assert.equal(settled.rankPoint - before.rankPoint, 14)
        single.activeQuests[p.id] = registered
        const retry = await singleFinish(p, { api_count: 8 })
        assert.equal(retry.statusCode, 400, retry.body)
        assert.deepEqual(totals(p.id), settled)
        assert.equal(writerClient.sqliteWriterStats().failed, 0)
    } finally {
        delete process.env.CN_WRITER_THREAD
        await writerClient.stopSqliteWriter()
    }
})

test.after(async () => {
    await singleApp.close()
    for (const timer of intervals) clearInterval(timer)
    if (db.open) db.close()
    fs.rmSync(directory, { recursive: true, force: true })
})
