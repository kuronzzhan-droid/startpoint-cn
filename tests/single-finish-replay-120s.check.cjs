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
function decode(response) {
    assert.equal(response.statusCode, 200, response.body)
    assert.equal(response.statusCode, 200, response.body)
    return unpack(Buffer.from(response.body, 'base64'))
    return unpack(Buffer.from(response.body, 'base64'))
}
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
const WAIT_MS = Number(process.env.REPLAY_WAIT_MS || 125_000)
test('finish pays once; same play_id replayed after >120s pays nothing; new play_id pays', { timeout: WAIT_MS + 60_000 }, async () => {
    const reg = makePlayer(), nos = makePlayer()
    assert.equal((await singleStart(reg, 'r-1')).statusCode, 200)
    const r0 = totals(reg.id), n0 = totals(nos.id)
    decode(await singleFinish(reg, { play_id: 'r-1', api_count: 2 }))
    decode(await singleFinish(nos, { play_id: 'n-1', api_count: 2 }))
    const r1 = totals(reg.id), n1 = totals(nos.id)
    assert.ok(r1.rankPoint > r0.rankPoint && n1.rankPoint > n0.rankPoint, 'first finishes paid')
    console.log(`# paid registered ${JSON.stringify(r0)} -> ${JSON.stringify(r1)}; no-start ${JSON.stringify(n0)} -> ${JSON.stringify(n1)}; waiting ${WAIT_MS}ms`)
    await new Promise(resolve => setTimeout(resolve, WAIT_MS))
    const rr = await singleFinish(reg, { play_id: 'r-1', api_count: 2 })
    const nr = await singleFinish(nos, { play_id: 'n-1', api_count: 2 })
    console.log(`# replay status registered=${rr.statusCode} no-start=${nr.statusCode}`)
    assert.deepEqual(totals(reg.id), r1, 'registered replay after wait must not pay')
    assert.deepEqual(totals(nos.id), n1, 'no-start replay after wait must not pay')
    decode(await singleFinish(nos, { play_id: 'n-2', api_count: 2 }))
    assert.ok(totals(nos.id).rankPoint > n1.rankPoint, 'a new play_id still pays')
    console.log(`# new play paid ${JSON.stringify(n1)} -> ${JSON.stringify(totals(nos.id))}`)
})
test.after(() => singleApp.close())
