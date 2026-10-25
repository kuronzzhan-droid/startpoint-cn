'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const Fastify = require('fastify')

const root = path.resolve(process.env.STARPOINT_TEST_TMP_ROOT || os.tmpdir())
fs.mkdirSync(root, { recursive: true })
const directory = fs.mkdtempSync(path.join(root, 'mvp-regular-mission-'))
Object.assign(process.env, {
    DATA_DIR: directory, TEMP: directory, TMP: directory, SQLITE_TMPDIR: directory,
    GACHA_SEED_DIR: path.join(directory, 'seeds'), CN_WRITER_THREAD: '0',
    GAME_VERBOSE_LOGS: 'false', GAME_ROUTINE_LOGS: 'off',
})
fs.mkdirSync(process.env.GACHA_SEED_DIR)
const load = name => require(path.join(__dirname, '..', 'out', name))
const counterQuery = { dimension: 'battle.multi_mvp', scopeType: 'lifetime', scopeKey: 'all', qualifier: {} }
const scope = [{ category: 1, missionIds: [29] }]
let app, db, players, missions, counters, settlement

test.before(async () => {
    load('data').initializeDatabase()
    db = load('data/db').getDb()
    assert.equal(path.dirname(fs.realpathSync(db.name)), fs.realpathSync(directory))
    players = load('data/domains/player')
    missions = load('data/domains/mission')
    counters = load('lib/mission/counters')
    settlement = load('lib/mission/settlement')
    app = Fastify({ logger: false })
    app.addHook('onSend', (_request, reply, payload, done) => done(null,
        String(reply.getHeader('content-type')).startsWith('application/x-msgpack') && typeof payload === 'object'
            ? JSON.stringify(payload) : payload))
    await app.register(load('routes/api/mission').default, { prefix: '/mission' })
    await app.ready()
})

test.after(async () => {
    try {
        if (app) await app.close()
    } finally {
        try {
            await load('lib/seed-validator').default.close()
        } finally {
            try {
                if (db?.open) db.close()
            } finally {
                assert.equal(path.dirname(fs.realpathSync(directory)), fs.realpathSync(root))
                assert.equal(fs.lstatSync(directory).isSymbolicLink(), false)
                fs.rmSync(directory, { recursive: true })
            }
        }
    }
})

const state = p => missions.getPlayerCategoryMissionsSync(p.id, 1)['29']
const vmoney = p => players.getPlayerSync(p.id).freeVmoney
const count = p => counters.getMissionCounterValueSync(p.id, counterQuery)
const rewardIds = data => data.mission_info.filter(row => row.mission_category_id === 1 && row.mission_id === 29)
    .map(row => row.mission_reward_id).sort((a, b) => a - b)
const progressRow = data => data.mission_progress_list.find(row => row.mission_category === 1 && row.mission_id === 29)
const post = (p, endpoint, extra = {}) => app.inject({ method: 'POST', url: `/mission/${endpoint}`,
    payload: { viewer_id: p.viewer, api_count: 1, ...extra } })
async function data(response) {
    const result = await response
    assert.equal(result.statusCode, 200, result.body)
    assert.match(result.headers['content-type'], /^application\/x-msgpack/)
    return result.json().data
}
const read = p => data(post(p, 'get_mission_progress', { category_list: [{ category: 1 }] }))
async function fixture() {
    const account = load('data/domains/account').insertAccountSync({ appId: 'wf_cn', idpAlias: '',
        idpCode: 'mvp-regular-test', idpId: randomUUID(), status: 'normal' })
    const player = players.insertDefaultPlayerSync(account.id)
    load('data/activeAccount').saveAccountDefaultPlayer(account.id, player.id)
    const p = { id: player.id, viewer: 871000000 + player.id }
    load('data/domains/session').insertSessionWithTokenSync({ token: String(p.viewer), accountId: account.id,
        type: 2, expires: new Date('2099-01-01T00:00:00Z') })
    // Settle unrelated default-player regular rewards before measuring MVP grants.
    assert.deepEqual(rewardIds(await read(p)), [])
    const warmed = vmoney(p)
    assert.deepEqual(rewardIds(await read(p)), [])
    assert.equal(vmoney(p), warmed, 'unrelated regular mission rewards are stable before the target mutation')
    return p
}
function seedProgress(p, progress, received) {
    missions.updatePlayerCategoryMissionSync(p.id, 1, 29, progress)
    for (const stage of received) missions.updatePlayerCategoryMissionStageSync(p.id, 1, stage, 29, true)
}
const seedCount = (p, value) => counters.addMissionCounterSync(p.id, counterQuery, value)

test('mission HTTP reads the persisted MVP fact, grants stage one and never grants it twice', async () => {
    const p = await fixture(), before = vmoney(p)
    seedCount(p, 1)
    const first = await read(p)
    assert.deepEqual(progressRow(first), { mission_category: 1, mission_id: 29, progress_value: 1, stage: 2 })
    assert.deepEqual(rewardIds(first), [29001])
    assert.equal(vmoney(p) - before, 150)
    assert.equal(first.user_info.free_vmoney, vmoney(p))
    assert.deepEqual(state(p), { progress: 1, stages: { '1': true } })
    const saved = structuredClone(state(p)), paid = vmoney(p)
    assert.deepEqual(rewardIds(await read(p)), [])
    assert.deepEqual(state(p), saved)
    assert.equal(vmoney(p), paid)
    assert.equal(count(p), 1, 'reading the task does not increment its source fact')
})

test('partial or absent lifetime facts preserve historical regular progress and received stages', async () => {
    for (const sourceCount of [undefined, 7]) {
        const p = await fixture()
        seedProgress(p, 30, [1, 2, 3, 4])
        if (sourceCount !== undefined) seedCount(p, sourceCount)
        const saved = structuredClone(state(p)), before = vmoney(p)
        const response = await read(p)
        assert.equal(progressRow(response).progress_value, 30)
        assert.equal(progressRow(response).stage, 5)
        assert.deepEqual(rewardIds(response), [])
        assert.deepEqual(state(p), saved)
        assert.equal(vmoney(p), before)
        assert.equal(count(p), sourceCount ?? 0)
        if (sourceCount === undefined) assert.equal(db.prepare('SELECT COUNT(*) n FROM players_mission_counters WHERE player_id=? AND counter_key=?')
            .get(p.id, counters.makeMissionCounterKey(counterQuery)).n, 0, 'a read must not create a missing lifetime fact')
    }
    const p = await fixture()
    seedProgress(p, 150, [1, 2, 3, 4, 5])
    const saved = structuredClone(state(p)), before = vmoney(p)
    assert.equal(progressRow(await read(p)).progress_value, 150)
    assert.deepEqual(state(p), saved, 'the final target must not truncate old excess progress')
    assert.equal(vmoney(p), before)
})

test('all five original stages grant 270 once and already received stages grant only the remainder', async () => {
    for (const received of [[], [1, 2, 4]]) {
        const p = await fixture()
        if (received.length) seedProgress(p, 30, received)
        seedCount(p, 100)
        const before = vmoney(p), response = await read(p)
        const expected = [1, 2, 3, 4, 5].filter(stage => !received.includes(stage))
        assert.deepEqual(rewardIds(response), expected.map(stage => 29000 + stage))
        assert.equal(vmoney(p) - before, expected.reduce((sum, stage) => sum + (stage === 1 ? 150 : 30), 0))
        assert.deepEqual(state(p), { progress: 100, stages: { '1': true, '2': true, '3': true, '4': true, '5': true } })
        const paid = vmoney(p)
        assert.deepEqual(rewardIds(await read(p)), [])
        assert.equal(vmoney(p), paid)
        seedCount(p, 50)
        assert.equal(progressRow(await read(p)).progress_value, 100, 'new excess facts stay capped at the final task target')
        assert.equal(count(p), 150)
        assert.equal(vmoney(p), paid)
    }
})

test('scoped settlement, full-category settlement and HTTP evaluate the same MVP task', async () => {
    const scoped = await fixture(), full = await fixture(), http = await fixture()
    const before = new Map([scoped, full, http].map(p => [p.id, vmoney(p)]))
    for (const p of [scoped, full, http]) seedCount(p, 10)
    const at = load('utils').getServerDate()
    const scopedResult = settlement.settleMissionCategoriesWithProgress(scoped.id, scope, at)
    const fullResult = settlement.settleMissionCategoriesWithProgress(full.id, [1], at)
    const httpResult = await read(http)
    for (const result of [scopedResult, fullResult]) {
        assert.deepEqual(result.evaluatedProgress.find(row => row.category === 1 && row.missionId === 29),
            { category: 1, missionId: 29, progress: 10 })
        assert.deepEqual(result.settlement.missionInfo.filter(row => row.mission_category_id === 1 && row.mission_id === 29)
            .map(row => row.mission_reward_id), [29001, 29002, 29003])
    }
    assert.deepEqual(rewardIds(httpResult), [29001, 29002, 29003])
    assert.deepEqual(state(scoped), state(full))
    assert.deepEqual(state(scoped), state(http))
    for (const p of [scoped, full, http]) assert.equal(vmoney(p) - before.get(p.id), 210)
})

test('client-reported get_mvp cannot manufacture a server-owned lifetime fact or task reward', async () => {
    const p = await fixture(), saved = structuredClone(state(p)), before = vmoney(p)
    const response = await data(post(p, 'update_mission_progress', {
        mission_param_list: [{ mission_pattern: 'get_mvp', progress_value: 100 }],
    }))
    assert.deepEqual(rewardIds(response), [])
    assert.deepEqual(state(p), saved)
    assert.equal(count(p), 0)
    assert.equal(vmoney(p), before)
    const reread = await read(p)
    assert.equal(progressRow(reread).progress_value, 0)
    assert.deepEqual(rewardIds(reread), [])
    assert.equal(vmoney(p), before)
})
