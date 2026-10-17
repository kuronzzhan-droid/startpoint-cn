const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { setImmediate: nextTurn } = require('node:timers/promises')
const { unpack } = require('msgpackr')

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-load-persistence-'))
process.env.DATA_DIR = directory
process.env.GACHA_SEED_DIR = path.join(directory, 'seeds')
process.env.CN_WRITER_THREAD = '0'
const db = require('../out/data/db').getDb()
const players = require('../out/data/domains/player')
const characters = require('../out/data/domains/character')
const equipment = require('../out/data/domains/equipment')
const coordinator = require('../out/lib/persistence-coordinator')
const { persistenceAdmission } = require('../out/lib/persistence-admission')
const { QuestCategory } = require('../out/lib/types')
const { PartyCategory } = require('../out/data/types')
const validators = require('../out/lib/validate')
const playerData = require('../out/data/utils/player-data')
const mana = require('../out/lib/assets')
const mode15 = require('../out/lib/mode15')
const { CnResponseWorkerPool } = require('../out/lib/cn-response-worker-pool')
const { installCnResponseEncoding } = require('../out/lib/cn-response-hook')
const { installPersistenceHttpErrors } = require('../out/lib/persistence-http-errors')

// The route imports room-maintenance timers. This fixture owns and closes them;
// it does not start a listener, writer thread, or relay process.
const timers = [], originalInterval = global.setInterval
let loadRoutes
try {
    global.setInterval = (...args) => {
        const timer = originalInterval(...args); timers.push(timer); return timer
    }
    loadRoutes = require('../out/routes/cn/load').default
} finally { global.setInterval = originalInterval }
after(() => {
    for (const timer of timers) clearInterval(timer)
    if (db.open) db.close()
})

const bucket = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10)
require('../out/lib/daily-vmoney-mail').updateDailyVmoneyMailConfigSync({ enabled: true }, Date.now(), db)
db.prepare(`INSERT INTO daily_vmoney_mail_runs
    (bucket, scheduled_at_ms, executed_at_ms, source, amount, subject, description, sent_count)
    VALUES (?, ?, ?, 'manual', 150000, 'load fixture', '', 0)`).run(bucket, Date.now(), Date.now())

function seedQuest(playerId, category, questId, host = 0) {
    db.prepare(`INSERT OR REPLACE INTO players_quest_progress
        (player_id, section, quest_id, finished, host_finished, unlocked, clear_rank)
        VALUES (?, ?, ?, 1, ?, 1, 5)`).run(playerId, Number(category), questId, host)
}

function subject() {
    const account = require('../out/data/domains/account').insertAccountSync({
        appId: 'wf_cn', idpAlias: '', idpCode: 'load-persistence', idpId: '', status: 'normal',
    })
    const player = players.insertDefaultPlayerSync(account.id)
    require('../out/data/activeAccount').saveAccountDefaultPlayer(account.id, player.id)
    const viewerId = 85000000 + player.id
    db.prepare('INSERT INTO sessions (token,account_id,expires,type) VALUES (?,?,?,2)')
        .run(String(viewerId), account.id, '2099-01-01T00:00:00Z')
    players.updatePlayerSync({ id: player.id, partySlot: 999, stamina: 0,
        staminaHealTime: new Date(Date.now() - 86400_000), lastLoginTime: new Date(Date.now() - 86400_000),
        expPooledTime: new Date(Date.now() - 3600_000), expPool: 123, freeVmoney: 9876 })
    equipment.insertPlayerEquipmentSync(player.id, 5020043, {
        level: 99, enhancementLevel: 0, protection: true, stack: 7,
    })
    db.prepare('DELETE FROM players_quest_progress WHERE player_id=? AND section=1 AND quest_id=1006001').run(player.id)
    seedQuest(player.id, 1, 1006002, 1)
    for (let stage = 1; stage <= 15; stage++) seedQuest(player.id, QuestCategory.RUSH_EVENT, 700098000 + stage)
    seedQuest(player.id, QuestCategory.ADVENT_EVENT_MULTI, 300098001)
    characters.insertDefaultPlayerCharacterSync(player.id, 341005)
    characters.insertPlayerCharacterManaNodesSync(player.id, 341005,
        Object.keys(mana.getCharacterManaNodesSync(341005, 1)).map(Number))
    return { ...player, accountId: account.id, viewerId }
}

async function appFor(t) {
    const app = require('fastify')({ logger: false })
    installPersistenceHttpErrors(app)
    installCnResponseEncoding(app, { pool: new CnResponseWorkerPool({ size: 0 }), compression: { mode: 'off' } })
    await app.register(loadRoutes, { prefix: '/api/index.php' })
    await app.ready()
    t.after(() => app.close())
    return app
}
const load = (app, player) => app.inject({ method: 'POST', url: '/api/index.php/load',
    payload: { viewer_id: player.viewerId }, headers: { device: 'android' } })
function decode(response, code = 1) {
    assert.equal(response.statusCode, 200, response.body)
    assert.match(response.headers['content-type'], /application\/x-msgpack/)
    const decoded = unpack(Buffer.from(response.body, 'base64'))
    assert.equal(decoded.data_headers.result_code, code)
    return decoded
}
function rows(table, playerId) {
    return db.prepare(`SELECT * FROM "${table}" WHERE player_id=?`).all(playerId)
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
}
function databaseState() {
    return Object.fromEntries(db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all()
        .map(({ name }) => [name, db.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}"`).all()
            .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))]))
}
function assertDatabaseState(before) {
    const after = databaseState()
    assert.deepEqual(Object.keys(after), Object.keys(before))
    for (const [table, state] of Object.entries(before)) assert.deepEqual(after[table], state, `rollback: ${table}`)
}
function assertRepaired(player, response, compareCurrent = true) {
    const { data, data_headers } = decode(response)
    assert.equal(data_headers.viewer_id, player.accountId)
    assert.equal(data.user_info.party_slot, 1)
    if (compareCurrent) assert.equal(data.user_info.stamina, players.getPlayerSync(player.id).stamina)
    assert.ok(data.user_info.stamina > 0)
    assert.equal(data.user_equipment_list['5020043'].level, mana.getEquipmentDissolveSync(5020043).max_level)
    assert.equal(equipment.getPlayerEquipmentSync(player.id, 5020043).level, data.user_equipment_list['5020043'].level)
    assert.equal(equipment.getPlayerEquipmentSync(player.id, 5020043).stack, 7)
    assert.ok(data.quest_progress['1'].some(q => q.quest_id === 1006001 && q.finished))
    assert.ok(data.quest_progress[QuestCategory.RUSH_EVENT].some(q => q.quest_id === 700098016 && q.finished))
    assert.equal(db.prepare('SELECT host_finished FROM players_quest_progress WHERE player_id=? AND section=1 AND quest_id=1006001').get(player.id).host_finished, 0)
    assert.equal(rows('players_repair_versions', player.id).length, 3)
    assert.equal(rows('daily_vmoney_mail_grants', player.id).length, 1)
    assert.equal(rows('players_mails', player.id).filter(row => row.subject === 'load fixture').length, 1)
    assert.equal(characters.getPlayerCharacterSync(player.id, 341005).evolutionLevel, 1)
    assert.equal(characters.getPlayerCharacterSync(player.id, 341005).bondTokenList.find(token => token.manaBoardIndex === 1).status, 1)
    assert.ok(data.user_rush_event_list['700098'])
    assert.equal(mode15.getExpectedMode15StageSync(player.id), 1)
    assert.equal(persistenceAdmission.stats().total, 0)
    return data
}

test('first load repairs a legacy save in one admitted transaction; repeats preserve identity, progress and rewards', async t => {
    const player = subject(), app = await appFor(t)
    const accountBefore = db.prepare('SELECT * FROM accounts WHERE id=?').get(player.accountId)
    const protectedTables = ['players_items', 'players_parties', 'players_party_groups', 'players_characters_mana_nodes']
    const preserved = Object.fromEntries(protectedTables.map(table => [table, rows(table, player.id)]))
    const seen = new Set()
    for (const [module, name] of [[validators, 'runPermanentValidators'], [playerData, 'prepareClientSerializedData'],
        [require('../out/lib/gauntlet-completion-classification'), 'repairAllGauntletCompletionClassificationsSync'],
        [require('../out/lib/mode15-optional'), 'cleanupLegacyMode15RescueProgressSync']]) {
        const original = module[name]
        t.mock.method(module, name, (...args) => {
            assert.equal(db.inTransaction, true, name)
            assert.equal(persistenceAdmission.stats().total, 1, name)
            seen.add(name)
            return original(...args)
        })
    }
    assertRepaired(player, await load(app, player))
    assert.equal(seen.size, 4)
    t.mock.restoreAll()
    const versions = rows('players_repair_versions', player.id)
    const progress = rows('players_quest_progress', player.id)
    const tokens = rows('players_characters_bond_tokens', player.id)
    const expPool = players.getPlayerSync(player.id).expPool
    for (const response of await Promise.all(Array.from({ length: 3 }, () => load(app, player)))) {
        // Each response owns its committed snapshot. Later requests may advance
        // clock-derived fields before an earlier response finishes encoding.
        assertRepaired(player, response, false)
    }
    assert.deepEqual(rows('players_repair_versions', player.id), versions)
    assert.deepEqual(rows('players_quest_progress', player.id), progress)
    assert.deepEqual(rows('players_characters_bond_tokens', player.id), tokens)
    assert.equal(players.getPlayerSync(player.id).expPool, expPool)
    assert.equal(players.getPlayerSync(player.id).freeVmoney, 9876)
    for (const table of protectedTables) assert.deepEqual(rows(table, player.id), preserved[table], table)
    assert.deepEqual(db.prepare('SELECT * FROM accounts WHERE id=?').get(player.accountId), accountBefore)
    assert.equal(require('../out/data/activeAccount').resolvePlayerIdSync(player.accountId), player.id)
})

test('validator SQL failure rolls back earlier repair versions, equipment, maintenance and mail; retry repairs once', async t => {
    const player = subject(), app = await appFor(t)
    db.exec(`CREATE TEMP TRIGGER reject_load_repair BEFORE INSERT ON players_repair_versions
        WHEN NEW.player_id=${player.id} AND NEW.repair_key='party-slot'
        BEGIN SELECT RAISE(ABORT, 'fixture repair failure'); END`)
    const before = databaseState()
    try {
        const response = await load(app, player)
        assert.equal(response.statusCode, 500)
        assert.match(response.json().message, /fixture repair failure/)
        assertDatabaseState(before)
        assert.equal(persistenceAdmission.stats().total, 0)
    } finally { db.exec('DROP TRIGGER reject_load_repair') }
    assertRepaired(player, await load(app, player))
})

test('failure after snapshot preparation rolls back all late repairs and earlier maintenance together', async t => {
    const player = subject(), app = await appFor(t), before = databaseState()
    const prepare = playerData.prepareClientSerializedData
    const injected = t.mock.method(playerData, 'prepareClientSerializedData', (...args) => {
        const prepared = prepare(...args)
        assert.ok(prepared)
        assert.equal(db.inTransaction, true)
        assert.equal(rows('players_repair_versions', player.id).length, 3)
        assert.equal(rows('daily_vmoney_mail_grants', player.id).length, 1)
        assert.ok(players.getPlayerSync(player.id).stamina > 0)
        assert.ok(prepared.data.questProgress[QuestCategory.RUSH_EVENT].some(q => q.questId === 700098016 && q.finished))
        throw new Error('fixture late assembly failure')
    })
    const response = await load(app, player)
    assert.equal(response.statusCode, 500)
    assert.match(response.json().message, /fixture late assembly failure/)
    assertDatabaseState(before)
    assert.equal(persistenceAdmission.stats().total, 0)
    injected.mock.restore()
    assertRepaired(player, await load(app, player))
})

test('a full player budget refuses load before writes and keeps other players and nested repairs usable', async t => {
    const player = subject(), other = subject(), app = await appFor(t)
    const releases = Array.from({ length: 8 }, () => persistenceAdmission.acquire(player.id))
    try {
        const before = databaseState(), changes = db.prepare('SELECT total_changes() n').get().n
        const response = await load(app, player)
        decode(response, 516)
        assert.equal(response.headers['retry-after'], '1')
        assert.equal(db.prepare('SELECT total_changes() n').get().n, changes)
        assertDatabaseState(before)
        decode(await load(app, other))
        assert.equal(persistenceAdmission.stats().total, 8)
        releases.pop()()
        decode(await load(app, player))
        assert.equal(persistenceAdmission.stats().total, 7, 'nested repairs reuse the eighth admitted slot')
    } finally { releases.forEach(release => release()) }
    assert.equal(persistenceAdmission.stats().total, 0)
})

test('queued load reads the player after the preceding write, so repair cannot overwrite a new valid party', async t => {
    const player = subject(), app = await appFor(t)
    let unblock
    const gate = new Promise(resolve => { unblock = resolve })
    coordinator.configurePersistenceSqlExecutor(async () => {
        await gate
        db.prepare('UPDATE players SET party_slot=3 WHERE id=?').run(player.id)
    })
    const previous = coordinator.runPersistenceSqlCommand({ domain: 'player', playerId: player.id, operation: 'fixture_hold' }, [], () => {})
    const readPlayer = t.mock.method(players, 'getPlayerSync')
    let pending
    try {
        pending = load(app, player)
        const deadline = Date.now() + 5000
        while (persistenceAdmission.stats().total < 2 && Date.now() < deadline) await nextTurn()
        assert.equal(persistenceAdmission.stats().total, 2)
        assert.equal(readPlayer.mock.callCount(), 0, 'load must not retain a pre-queue player snapshot')
        unblock(); await previous
        const data = decode(await pending).data
        assert.equal(data.user_info.party_slot, 3)
        assert.equal(players.getPlayerSync(player.id).partySlot, 3)
    } finally {
        unblock(); await previous; if (pending) await pending
        coordinator.configurePersistenceSqlExecutor(null)
    }
    assert.equal(persistenceAdmission.stats().total, 0)
})

test('invalid sessions still return the game login result without reserving a write or changing a save', async t => {
    const app = await appFor(t), before = databaseState()
    decode(await load(app, { viewerId: 999999999 }), 516)
    assertDatabaseState(before)
    assert.equal(persistenceAdmission.stats().total, 0)
})

test('accepted load drains across owner recovery and conditional cleanup after close; newer play and new request are protected', async t => {
    const first = subject(), second = subject(), app = await appFor(t)
    const quests = require('../out/data/domains/quest_active')
    const shutdown = require('../out/lib/shutdown-state')
    const runtime = require('../out/multi/coordinator/default-runtime')
    const quest = (player, playId) => ({ playerId: player.id, playId, category: 1, questId: 1006001,
        isMulti: true, isMultiHost: true, roomNumber: 'missing-load-fixture', continueCount: 0,
        useBossBoostPoint: false, useBoostPoint: false, isAutoStartMode: false, startedAtMs: Date.now(), partySlot: 1 })
    quests.insertPlayerActiveQuestSync(first.id, quest(first, 'load-old-first'))
    quests.insertPlayerActiveQuestSync(second.id, quest(second, 'load-old-second'))
    const waiters = new Map()
    t.mock.method(runtime, 'getRoomCommandGateway', () => ({ execute: async (kind, payload) => {
        assert.equal(kind, 'battle.recovery')
        await new Promise(resolve => waiters.set(payload.playerId, resolve))
        return { retained: false, recoverable: false, reason: 'missing-room', roomPhase: null }
    } }))
    const pendingFirst = load(app, first), pendingSecond = load(app, second)
    const deadline = Date.now() + 5000
    while (waiters.size !== 2 && Date.now() < deadline) await nextTurn()
    assert.equal(waiters.size, 2, 'both loads have committed maintenance and reached the owner await')
    await coordinator.runPersistenceTransaction({ domain: 'player', playerId: second.id, operation: 'fixture_replace_play' }, () => {
        quests.insertPlayerActiveQuestSync(second.id, quest(second, 'load-new-second'))
    })
    let drained = false
    shutdown.beginServerShutdown()
    const drain = shutdown.drainServerWork().then(() => { drained = true })
    try {
        await nextTurn(); assert.equal(drained, false)
        const before = databaseState(), changes = db.prepare('SELECT total_changes() n').get().n
        const rejectedResponse = await load(app, first)
        const rejected = decode(rejectedResponse, 516)
        assert.equal(rejectedResponse.headers['retry-after'], '1')
        assert.deepEqual(rejected.data, {})
        assert.equal(db.prepare('SELECT total_changes() n').get().n, changes)
        assertDatabaseState(before)
        waiters.get(first.id)()
        const firstData = decode(await pendingFirst).data
        assert.deepEqual(firstData.unfinished_multi_quest_list, [])
        assert.equal(quests.getPlayerActiveQuestSync(first.id), null, 'accepted late cleanup still commits')
        assert.equal(drained, false, 'other accepted load still holds the drain')
        waiters.get(second.id)()
        const secondData = decode(await pendingSecond).data
        assert.deepEqual(secondData.unfinished_multi_quest_list, [{ play_id: 'load-new-second', continue_count: 0 }])
        assert.equal(quests.getPlayerActiveQuestSync(second.id).playId, 'load-new-second')
        await drain
        assert.equal(drained, true)
        assert.equal(persistenceAdmission.stats().total, 0)
        decode(await load(app, { viewerId: 999999999 }), 516)
    } finally {
        for (const resolve of waiters.values()) resolve()
        await Promise.allSettled([pendingFirst, pendingSecond, drain])
    }
})
