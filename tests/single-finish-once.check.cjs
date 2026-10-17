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

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'single-finish-once-'))
process.env.DATA_DIR = directory
process.env.GAME_ROUTINE_LOGS = 'off'
delete process.env.CN_WRITER_THREAD
delete process.env.QUEST_FINISH_STRICT
require('../out/data/db').getDb()
require('../out/data').initializeDatabase()
const accounts = require('../out/data/domains/account')
const players = require('../out/data/domains/player')
const sessions = require('../out/data/domains/session')
const single = require('../out/routes/api/singleBattleQuest')
const CATEGORY = 2
const QUEST_ID = 1001001
let sequence = 0
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
    await singleApp.register(single.default, { prefix: '/single' })
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

test('registered play: finish pays once, immediate replay pays nothing', async () => {
    const p = makePlayer()
    assert.equal((await singleStart(p, 'once-a')).statusCode, 200)
    const t0 = totals(p.id)
    decode(await singleFinish(p, { play_id: 'once-a', api_count: 2 }))
    const t1 = totals(p.id)
    assert.ok(t1.rankPoint > t0.rankPoint, 'first finish paid')
    const replay = await singleFinish(p, { play_id: 'once-a', api_count: 2 })
    assert.ok([200, 400].includes(replay.statusCode), replay.body)
    assert.deepEqual(totals(p.id), t1, 'replay must not pay again')
    console.log('# registered paid', JSON.stringify(t0), '->', JSON.stringify(t1))
})
test('no-start play pays once; a second distinct play still pays', async () => {
    const p = makePlayer()
    const t0 = totals(p.id)
    decode(await singleFinish(p, { play_id: 'nostart-1', api_count: 2 }))
    const t1 = totals(p.id)
    assert.ok(t1.rankPoint > t0.rankPoint)
    await singleFinish(p, { play_id: 'nostart-1', api_count: 2 })
    assert.deepEqual(totals(p.id), t1)
    decode(await singleFinish(p, { play_id: 'nostart-2', api_count: 2 }))
    assert.ok(totals(p.id).rankPoint > t1.rankPoint)
})
test.after(() => singleApp.close())
