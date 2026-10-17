'use strict'

const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Fastify = require('fastify')
const { pack } = require('msgpackr')
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'starpoint-deadline-queue-'))
process.env.DATA_DIR = path.join(temporary, 'database')
process.env.GACHA_SEED_DIR = path.join(temporary, 'seeds')
process.env.CN_WRITER_THREAD = '0'
fs.mkdirSync(process.env.GACHA_SEED_DIR)

const { getDb } = require('../out/data/db')
const players = require('../out/data/domains/player')
const accounts = require('../out/data/domains/account')
const items = require('../out/data/domains/item')
const passState = require('../out/data/domains/pass-card')
const assets = require('../out/lib/assets')
const pass = require('../out/lib/pass-card')
const progress = require('../out/lib/mission/client-progress')
const coordinator = require('../out/lib/persistence-coordinator')
const seed = require('../out/lib/seed-validator').default
const clock = require('../out/utils')
const originalOffset = clock.getLegacyTimeOffset()
const legacyOffset = -421 * 86400_000
const app = Fastify({ logger: false })
const originalNow = Date.now
const originalTransaction = coordinator.runPersistenceTransaction
const originalGacha = assets.getGachaSync
const originalShop = assets.getShopItemSync
const originalPassEvent = pass.getPassCardEventDefinition
const originalPassReward = pass.getPassCardRewardDefinition
const originalTargets = progress.resolveClientProgressTargets
const start = Date.UTC(2030, 0, 1, 0, 0, 0)
const deadline = start + 60_000
let now = start - legacyOffset
let sequence = 0
let waiting = null
Date.now = () => now
clock.setServerTimeOffset(legacyOffset)

// Keep the production queue intact. The signal fires after enqueueing and before
// its actual setImmediate execution, so the fixture advances while it is queued.
coordinator.runPersistenceTransaction = (context, operation, options) => {
    const pending = originalTransaction(context, operation, options)
    if (waiting && context.operation === waiting.operation) {
        const signal = waiting
        waiting = null
        signal.resolve()
    }
    return pending
}
async function queuedRequest(operation, request, advance) {
    let resolve
    const queued = new Promise(done => { resolve = done })
    waiting = { operation, resolve }
    const pending = app.inject(request)
    await Promise.race([queued, pending.then(response => {
        throw new Error(`Request rejected before reaching ${operation} queue: ${response.statusCode} ${response.body}`)
    })])
    advance()
    return pending
}
async function player() {
    now = start - legacyOffset
    const account = accounts.insertAccountSync({ appId: 'wf_cn', idpAlias: '', idpCode: 'test', idpId: `deadline-${++sequence}`, status: 'normal' })
    const player = players.insertDefaultPlayerSync(account.id)
    players.updatePlayerSync({ id: player.id, vmoney: 10000, freeVmoney: 10000 })
    require('../out/data/activeAccount').saveAccountDefaultPlayer(account.id, player.id)
    const viewer = 795000000 + player.id
    await require('../out/data/domains/session').insertSessionWithToken({ token: String(viewer), accountId: account.id, expires: new Date('2099-01-01'), type: 2 })
    return { id: player.id, viewer }
}
function post(url, player, body) {
    return { method: 'POST', url, payload: { viewer_id: player.viewer, ...body } }
}
function rewardState(id) {
    const player = players.getPlayerSync(id)
    return {
        balances: [player.freeVmoney, player.vmoney, player.freeMana, player.paidMana],
        items: getDb().prepare('SELECT * FROM players_items WHERE player_id=? ORDER BY id').all(id),
        history: getDb().prepare('SELECT * FROM players_receive_history WHERE player_id=? ORDER BY id').all(id),
    }
}

before(async () => {
    app.addHook('onSend', (_request, reply, body, done) => done(null,
        String(reply.getHeader('content-type')).startsWith('application/x-msgpack') ? pack(body).toString('base64') : body))
    await app.register(require('../out/routes/api/gacha').default, { prefix: '/gacha' })
    await app.register(require('../out/routes/api/shop').default, { prefix: '/shop' })
    await app.register(require('../out/routes/api/passCard').default, { prefix: '/pass' })
    await app.register(require('../out/routes/api/mission').default, { prefix: '/mission' })
    await app.ready()
})
after(async () => {
    Date.now = originalNow
    clock.setServerTimeOffset(originalOffset)
    coordinator.runPersistenceTransaction = originalTransaction
    assets.getGachaSync = originalGacha
    assets.getShopItemSync = originalShop
    pass.getPassCardEventDefinition = originalPassEvent
    pass.getPassCardRewardDefinition = originalPassReward
    progress.resolveClientProgressTargets = originalTargets
    await app.close()
    await seed.close()
    getDb().close()
    fs.rmSync(temporary, { recursive: true })
})

test('a gated gacha that expires while queued cannot charge or grant', async () => {
    const p = await player()
    const base = originalGacha(1)
    assets.getGachaSync = id => id === 1 ? { ...base, enforceAvailabilityWindow: true, startDate: '2030-01-01 08:00:00', endDate: '2030-01-01 08:01:00' } : originalGacha(id)
    const before = rewardState(p.id)
    const response = await queuedRequest('draw', post('/gacha/exec', p, { gacha_id: 1, payment_type: 1, type: 1, number_of_exec: 1 }), () => { now = deadline + 1000 - legacyOffset })
    assert.equal(response.statusCode, 400, response.body)
    assert.match(response.body, /Gacha is not available/)
    assert.deepEqual(rewardState(p.id), before)
    assert.equal(require('../out/data/domains/gacha').getPlayerGachaInfoSync(p.id, 1), null)
})

test('an event shop item that expires while queued leaves payment, stock and rewards intact', async () => {
    const p = await player()
    items.givePlayerItemSync(p.id, 2370001, 600)
    const base = originalShop(4, 700000)
    assets.getShopItemSync = (type, id) => type === 4 && id === 700000
        ? { ...base, availableFrom: '2030-01-01 00:00:00', availableUntil: '2030-01-01 00:01:00', compatibilityPeriods: [] }
        : originalShop(type, id)
    const before = rewardState(p.id)
    const response = await queuedRequest('purchase', post('/shop/buy', p, { shop_type: 4, shop_item_id: 700000, number: 1 }), () => { now = deadline + 1000 - legacyOffset })
    assert.equal(response.statusCode, 400, response.body)
    assert.match(response.body, /not currently available/)
    assert.deepEqual(rewardState(p.id), before)
    assert.equal(require('../out/data/domains/shopPurchase').getPlayerShopPurchaseCountSync(p.id, 700000), 0)
})

function passFixture(p) {
    pass.getPassCardEventDefinition = id => id === 99991 ? { eventId: id, thresholdPoint: 100, levelThreshold: 10, startTime: start, endTime: deadline, forceTime: deadline + 1000 } : originalPassEvent(id)
    pass.getPassCardRewardDefinition = id => id === 99992 ? { rewardId: id, eventId: 99991, level: 1, reward1: { kind: 1, itemId: 49100, amount: 1 }, reward2: { kind: 1, itemId: 49100, amount: 2 } } : originalPassReward(id)
    getDb().prepare('INSERT INTO players_pass_cards(player_id,event_id,point,is_buy) VALUES(?,?,?,?)').run(p.id, 99991, 100, 1)
}
test('a pass claim that expires while queued does not grant or mark claimed', async () => {
    const p = await player()
    passFixture(p)
    const before = rewardState(p.id)
    const response = await queuedRequest('receive_pass_card', post('/pass/receive_all', p, { pass_card_id: 99991, reward1_receive: [99992] }), () => { now = deadline + 1000 - legacyOffset })
    assert.equal(response.statusCode, 400, response.body)
    assert.deepEqual(rewardState(p.id), before)
    assert.deepEqual(passState.getPlayerPassCardRewardRecordsSync(p.id, 99991), [])
})

test('pass eligibility is reread after queueing, including premium entitlement and level', async () => {
    for (const field of ['is_buy', 'point']) {
        const p = await player()
        passFixture(p)
        const before = rewardState(p.id)
        const response = await queuedRequest('receive_pass_card', post('/pass/receive_all', p, { pass_card_id: 99991, reward2_receive: [99992] }), () => {
            getDb().prepare(`UPDATE players_pass_cards SET ${field}=0 WHERE player_id=? AND event_id=99991`).run(p.id)
        })
        assert.equal(response.statusCode, 400, response.body)
        assert.match(response.body, /Pass reward is not available/)
        assert.deepEqual(rewardState(p.id), before)
        assert.deepEqual(passState.getPlayerPassCardRewardRecordsSync(p.id, 99991), [])
    }
})

test('mission progress resolves enabled targets at execution time after queueing', async () => {
    const p = await player()
    let observed
    progress.resolveClientProgressTargets = (_pattern, evaluationTime) => { observed = evaluationTime.getTime(); return [] }
    const response = await queuedRequest('update_progress', post('/mission/update_mission_progress', p, { mission_param_list: [{ mission_pattern: 'home_tap_town_character_count', progress_value: 1 }] }), () => { now = deadline + 1000 - legacyOffset })
    assert.equal(response.statusCode, 200, response.body)
    assert.equal(observed, deadline + 1000)
})

test('legacy transaction context freezes both business time and effective offset across awaits', async () => {
    now = start - legacyOffset
    try {
        const value = await clock.withServerClock(start, async () => {
            assert.equal(clock.getTimeOffset(), legacyOffset)
            assert.equal(clock.getRealServerDate().getTime(), start - legacyOffset)
            now += 12_000
            clock.setServerTimeOffset(legacyOffset + 77_000)
            await Promise.resolve()
            assert.equal(clock.getServerDate().getTime(), start)
            assert.equal(clock.getTimeOffset(), legacyOffset)
            return clock.withCurrentServerClock(() => ({
                now: clock.getServerDate().getTime(), offset: clock.getTimeOffset(),
            }))
        }, legacyOffset)
        assert.deepEqual(value, { now: start, offset: legacyOffset })
        assert.equal(clock.getLegacyTimeOffset(), legacyOffset + 77_000)
    } finally { clock.setServerTimeOffset(legacyOffset) }
})
