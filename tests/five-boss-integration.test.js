const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'startpoint-five-boss-test-'))
process.env.DATA_DIR = dataDir
// The source checkout intentionally does not carry the deployment-only
// admission key file.  Give this integration test an explicit transition
// policy so the TCP case exercises the room handshake instead of failing
// before the first frame because the local gate has no policy to load.
process.env.CLIENT_ADMISSION_CONFIG = path.join(dataDir, 'client-admission.json')
process.env.CLIENT_ADMISSION_KEYS = path.join(dataDir, 'client-admission.keys.json')
fs.writeFileSync(process.env.CLIENT_ADMISSION_CONFIG, JSON.stringify({
    enforce: false,
    updateMessage: 'test transition policy',
    builds: [],
}))
fs.writeFileSync(process.env.CLIENT_ADMISSION_KEYS, '{}')
const output = process.env.LENS_BUILD_OUT || path.resolve(__dirname, '../out')
const load = name => require(path.join(output, name))
const originalInterval = global.setInterval
global.setInterval = (...args) => { const timer = originalInterval(...args); timer.unref(); return timer }
const { getDb } = load('data/db')
const accounts = load('data/domains/account')
const players = load('data/domains/player')
const items = load('data/domains/item')
const active = load('data/domains/quest_active')
const characters = load('data/domains/character')
const ledger = load('data/domains/fiveBossGauntletRun')
const runtime = load('multi/five-boss/battle-runtime')
const solo = load('multi/five-boss/solo-runtime')
const rewards = load('multi/five-boss/rewards')
const { FIVE_BOSS_GAUNTLET: mode } = load('multi/five-boss/contract')
const { createRoom } = load('multi/room/manager')
global.setInterval = originalInterval
let sequence = 0

function businessDatabaseDigest(database) {
    const tables = database.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
    return JSON.stringify(tables.map(({ name }) => {
        const quote = identifier => '"' + identifier.replace(/"/g, '""') + '"'
        const statement = database.prepare(`SELECT * FROM ${quote(name)}`)
        const columns = statement.columns().map(column => column.name)
        const rows = statement.safeIntegers(true).raw().all().map(row => JSON.stringify(row.map(value =>
            Buffer.isBuffer(value) ? { blob: value.toString('hex') }
                : typeof value === 'bigint' ? { integer: value.toString() } : value))).sort()
        return { name, columns, rows }
    }))
}


function player(tickets = 2) {
    const id = ++sequence
    const account = accounts.insertAccountSync({ appId: 'wf_cn', idpAlias: '', idpCode: 'test', idpId: `five-${id}`, status: 'normal' })
    const p = players.insertDefaultPlayerSync(account.id)
    load('data/activeAccount').saveAccountDefaultPlayer(account.id, p.id)
    players.updatePlayerSync({ id: p.id, stamina: 100, staminaHealTime: new Date() })
    items.setPlayerItemSync(p.id, mode.ticketItemId, tickets)
    load('lib/character').givePlayerCharacterSync(p.id, 111001)
    return { ...p, accountId: account.id, viewerId: 781000000 + id, playId: `five-play-${id}` }
}

function run(members) {
    const host = members[0]
    const room = createRoom(host.viewerId, host.id, 1, mode.category, mode.visibleQuestId, 0, 111001)
    room.raising_state = 4
    room.mates = members.map(p => ({ viewer_id: p.viewerId, player_id: p.id, com_id: 0 }))
    room.member_viewer_ids = members.map(p => p.viewerId)
    room.member_player_ids = Object.fromEntries(members.map(p => [p.viewerId, p.id]))
    room.five_boss_runtime = { runId: `run-${++sequence}`, expectedRealPlayerIds: members.map(p => p.id),
        autoplayModeByPlayerId: Object.fromEntries(members.map((p, i) => [p.id, i > 0])),
        partyCharacterIdsByPlayerId: Object.fromEntries(members.map(p => [p.id, [111001]])), battleIdentityByViewerId: {} }
    return room
}
function identity(p, room) {
    return { playerId: p.id, clientPlayId: p.playId, requestRoomNumber: room.room_number,
        requestCategory: mode.category, requestQuestId: mode.visibleQuestId }
}
function start(p, room) {
    return runtime.startFiveBossBattle({ ...identity(p, room), room,
        useBoostPoint: false, useBossBoostPoint: false, httpIsAutoStartMode: true })
}
function proof(p, room) {
    for (const signal of ['level_next', 'finalize']) ledger.recordMemberBattleSignalSync({
        runId: room.five_boss_runtime.runId, playerId: p.id, roomNumber: room.room_number, signal })
}
function finish(p, room, engine = runtime) {
    return (engine.finishFiveBossBattle || engine.finish)({ ...identity(p, room), accomplished: true,
        elapsedTimeMs: 30000, randomFloat: () => 0.1 })
}

test('multiplayer charges only host once; pins Auto; retries do not grant items or EXP again', () => {
    const host = player(), guest = player(1), room = run([host, guest])
    start(guest, room)
    start(host, room)
    start(host, room)
    assert.equal(items.getPlayerItemSync(host.id, mode.ticketItemId), 1)
    assert.equal(items.getPlayerItemSync(guest.id, mode.ticketItemId), 1)
    assert.equal(players.getPlayerSync(host.id).stamina, 65)
    assert.equal(players.getPlayerSync(host.id).totalStaminaUsed, 35)
    assert.equal(players.getPlayerSync(guest.id).stamina, 100)
    assert.equal(active.getPlayerActiveQuestSync(host.id).isAutoStartMode, false)
    assert.throws(() => finish(host, room), /battle entry was not recorded/)
    ledger.recordMemberBattleSignalSync({ runId: room.five_boss_runtime.runId,
        playerId: host.id, roomNumber: room.room_number, signal: 'scene_ready' })
    ledger.recordMemberBattleSignalSync({ runId: room.five_boss_runtime.runId,
        playerId: guest.id, roomNumber: room.room_number, signal: 'scene_ready' })
    const h = finish(host, room)
    const exp = characters.getPlayerCharacterSync(host.id, 111001).exp
    assert.ok(exp > 0)
    assert.equal(h.reward.itemTotals['10000145'], 20)
    assert.equal(h.reward.itemTotals['10000144'], 1)
    const retry = finish(host, room)
    assert.equal(retry.receiptStatus, 'already_settled')
    assert.deepEqual(retry.reward, h.reward)
    assert.equal(characters.getPlayerCharacterSync(host.id, 111001).exp, exp)
    assert.throws(() => start(host, room), /settled member/)
    const g = finish(guest, room)
    assert.equal(g.reward.itemTotals['10000145'], 10)
    assert.equal(g.runStatus, 'settled')
    assert.equal(ledger.getFiveBossRunByClientSync({ playerId: host.id, clientPlayId: host.playId }).roomNumber, room.room_number)
})

test('start/settlement failures roll back ticket, rewards and persistent state', () => {
    const host = player(), room = run([host])
    assert.throws(() => ledger.startMemberSync({ runId: 'broken-start', hostPlayerId: host.id,
        routeId: mode.routeId, roomNumber: room.room_number, ticketItemId: mode.ticketItemId, hostStaminaCost: 35,
        rosterPlayerIds: [host.id], playerId: host.id, clientPlayId: host.playId, isAutoMode: false },
    () => { throw new Error('persist failure') }), /persist failure/)
    assert.equal(items.getPlayerItemSync(host.id, mode.ticketItemId), 2)
    assert.equal(players.getPlayerSync(host.id).stamina, 100)
    assert.equal(players.getPlayerSync(host.id).totalStaminaUsed, 0)
    start(host, room); proof(host, room)
    let grants = 0
    const broken = runtime.createFiveBossBattleRuntime({ givePlayerItemSync: (p, id, count) => {
        const total = items.givePlayerItemSync(p, id, count)
        if (++grants === 2) throw new Error('reward failure')
        return total
    } })
    assert.throws(() => finish(host, room, broken), /reward failure/)
    assert.equal(items.getPlayerItemSync(host.id, 10000144), null)
    assert.ok(active.getPlayerActiveQuestSync(host.id))
    assert.equal(finish(host, room).receiptStatus, 'settled')
})

test('guest abort does not strand a completed host run', () => {
    const host = player(), guest = player(), room = run([host, guest])
    start(host, room); start(guest, room); proof(host, room)
    finish(host, room)
    const ended = runtime.abortFiveBossBattle(identity(guest, room))
    assert.equal(ended.runStatus, 'settled')
    assert.equal(items.getPlayerItemSync(guest.id, 10000145), null)
})

test('solo start charges ticket + 35 stamina atomically and accepts retry without another debit', () => {
    const p = player()
    const persist = () => active.insertPlayerActiveQuestSync(p.id, { playerId: p.id, playId: p.playId,
        category: mode.category, questId: mode.visibleQuestId, useBoostPoint: false, useBossBoostPoint: false,
        isAutoStartMode: false, isMulti: false, isMultiHost: false, roomNumber: null,
        entryItemId: mode.ticketItemId, eventId: null, continueCount: 0, startedAtMs: Date.now() })
    assert.throws(() => solo.startFiveBossSoloSync(p.id, p.playId, () => { throw new Error('persist failure') }), /persist failure/)
    assert.equal(players.getPlayerSync(p.id).stamina, 100)
    assert.equal(items.getPlayerItemSync(p.id, mode.ticketItemId), 2)
    solo.startFiveBossSoloSync(p.id, p.playId, persist)
    solo.startFiveBossSoloSync(p.id, p.playId, () => assert.fail('replayed persistence'))
    assert.equal(players.getPlayerSync(p.id).stamina, 65)
    assert.equal(items.getPlayerItemSync(p.id, mode.ticketItemId), 1)
    getDb().transaction(() => solo.saveFiveBossSoloReceiptSync(p.id, p.playId, 'single-retry-key', { ok: 1 }))()
    assert.deepEqual(solo.getFiveBossSoloReceiptSync(p.id, 'single-retry-key'), { ok: 1 })
    assert.throws(() => solo.startFiveBossSoloSync(p.id, p.playId, persist), /ended/)
})

test('five-boss starts require 35 stamina and preserve tickets on failure; a zero-stamina guest is acknowledged', async () => {
    const p = player(1)
    const app = await httpApp(p, load('routes/api/singleBattleQuest').default)
    try {
        players.updatePlayerSync({ id: p.id, stamina: 34, staminaHealTime: new Date() })
        let response = await app.inject({ method: 'POST', url: '/start', payload: httpStart(p) })
        assert.equal(response.statusCode, 400, response.body)
        assert.match(response.body, /Insufficient stamina/)
        assert.equal(items.getPlayerItemSync(p.id, 10000143), 1)
        assert.equal(players.getPlayerSync(p.id).stamina, 34)
        players.updatePlayerSync({ id: p.id, stamina: 35, staminaHealTime: new Date() })
        items.setPlayerItemSync(p.id, 10000143, 0)
        response = await app.inject({ method: 'POST', url: '/start', payload: httpStart(p) })
        assert.equal(response.statusCode, 200, response.body)
        assert.equal(response.json().data_headers.result_code, 4050)
        assert.equal(players.getPlayerSync(p.id).stamina, 35)
        items.setPlayerItemSync(p.id, 10000143, 1)
        response = await app.inject({ method: 'POST', url: '/start', payload: httpStart(p) })
        assert.equal(response.statusCode, 200, response.body)
        assert.equal(response.json().data.user_info.stamina, 0)
        assert.equal(items.getPlayerItemSync(p.id, 10000143), 0)
        assert.equal((await app.inject({ method: 'POST', url: '/start', payload: httpStart(p) })).statusCode, 200)
        assert.equal(players.getPlayerSync(p.id).totalStaminaUsed, 35)
    } finally { await app.close() }

    const host = player(1), guest = player(0), room = run([host, guest])
    players.updatePlayerSync({ id: host.id, stamina: 34, staminaHealTime: new Date() })
    players.updatePlayerSync({ id: guest.id, stamina: 0, staminaHealTime: new Date() })
    const hostApp = await httpApp(host, load('multi/http/battle').registerBattleRoutes)
    const guestApp = await httpApp(guest, load('multi/http/battle').registerBattleRoutes)
    try {
        let response = await guestApp.inject({ method: 'POST', url: '/start', payload: httpStart(guest, room) })
        assert.equal(response.statusCode, 200, response.body)
        assert.equal(response.json().data_headers.result_code, 4050)
        assert.equal(items.getPlayerItemSync(host.id, 10000143), 1)
        assert.equal(players.getPlayerSync(host.id).stamina, 34)
        assert.equal(active.getPlayerActiveQuestSync(guest.id), null)
        players.updatePlayerSync({ id: host.id, stamina: 35, staminaHealTime: new Date() })
        items.setPlayerItemSync(host.id, 10000143, 0)
        response = await guestApp.inject({ method: 'POST', url: '/start', payload: httpStart(guest, room) })
        assert.equal(response.statusCode, 200, response.body)
        assert.equal(response.json().data_headers.result_code, 4050)
        assert.equal(active.getPlayerActiveQuestSync(guest.id), null)
        assert.equal(players.getPlayerSync(host.id).stamina, 35)
        items.setPlayerItemSync(host.id, 10000143, 1)
        response = await guestApp.inject({ method: 'POST', url: '/start', payload: httpStart(guest, room) })
        assert.equal(response.statusCode, 200, response.body)
        assert.equal(players.getPlayerSync(host.id).stamina, 0)
        assert.equal(players.getPlayerSync(guest.id).stamina, 0)
        assert.equal(items.getPlayerItemSync(host.id, 10000143), 0)
        response = await hostApp.inject({ method: 'POST', url: '/start', payload: httpStart(host, room) })
        assert.equal(response.statusCode, 200, response.body)
        assert.equal(response.json().data.user_info.stamina, 0)
        assert.equal(response.json().data.item_list['10000143'], 0)
        ledger.recordMemberBattleSignalSync({ runId: room.five_boss_runtime.runId, playerId: host.id,
            roomNumber: room.room_number, signal: 'level_next' })
        assert.equal((await hostApp.inject({ method: 'POST', url: '/start', payload: httpStart(host, room) })).statusCode, 200)
        assert.equal(players.getPlayerSync(host.id).totalStaminaUsed, 35)
        assert.equal(players.getPlayerSync(guest.id).totalStaminaUsed, 0)
    } finally { await hostApp.close(); await guestApp.close() }
})

test('five-boss new multiplayer rounds charge another 35, while a persisted pre-update run is not retrocharged', () => {
    const p = player(2), room = run([p])
    start(p, room); proof(p, room); finish(p, room)
    assert.equal(players.getPlayerSync(p.id).stamina, 65)
    p.playId += '-new-round'
    const next = run([p]); start(p, next)
    assert.equal(players.getPlayerSync(p.id).stamina, 30)
    assert.equal(players.getPlayerSync(p.id).totalStaminaUsed, 70)
    assert.equal(items.getPlayerItemSync(p.id, 10000143), 0)
    // A running battle has already recorded entry. Cost changes must never
    // retrocharge it, even if the player now lacks stamina for a new run.
    players.updatePlayerSync({ id: p.id, stamina: 0, totalStaminaUsed: 0 })
    start(p, next)
    assert.equal(players.getPlayerSync(p.id).stamina, 0)
    assert.equal(players.getPlayerSync(p.id).totalStaminaUsed, 0)
})

test('drop boundaries and weapon duplicate requirement match approved rules', () => {
    const hit = rewards.buildFiveBossGauntletRewardPlan({ firstClear: true, rewardMultiplier: 2, randomFloat: () => 0.249999 })
    assert.deepEqual(hit.items.map(i => [i.itemId, i.amount]), [[10000144, 1], [10000145, 20], [10000146, 1], [10000147, 4], [10000310, 11]])
    const miss = rewards.buildFiveBossGauntletRewardPlan({ firstClear: false, rewardMultiplier: 1, randomFloat: () => 0.5 })
    assert.deepEqual(miss.items.map(i => [i.itemId, i.amount]), [[10000144, 1], [10000145, 10], [10000147, 1], [10000310, 13]])
    assert.equal(rewards.canUseAwakeningSubstitutionItem(5900101), false)
    assert.equal(rewards.canUseAwakeningSubstitutionItem(5010070), true)
    assert.deepEqual(getDb().pragma('foreign_key_check'), [])
})

test('solo five-boss rewards use half quantities and lower probabilities without changing multiplayer rules', () => {
    const values = [0.14, 0.3, 0.99]
    const soloHit = rewards.buildFiveBossSoloGauntletRewardPlan({
        firstClear: true,
        rewardMultiplier: 1,
        randomFloat: () => values.shift(),
    })
    assert.deepEqual(soloHit.items.map(i => [i.itemId, i.amount]), [
        [10000144, 1], [10000145, 5], [10000146, 1], [10000147, 1], [10000310, 8],
    ])

    const misses = [0.3, 0.625, 0]
    const soloMiss = rewards.buildFiveBossSoloGauntletRewardPlan({
        firstClear: false,
        rewardMultiplier: 1,
        randomFloat: () => misses.shift(),
    })
    assert.deepEqual(soloMiss.items.map(i => [i.itemId, i.amount]), [
        [10000145, 5], [10000310, 5],
    ])

    const manualCoreHitValues = [0.3, 0.624999, 0.99]
    const manualCoreHit = rewards.buildFiveBossSoloGauntletRewardPlan({
        firstClear: false,
        rewardMultiplier: 2,
        randomFloat: () => manualCoreHitValues.shift(),
    })
    assert.deepEqual(manualCoreHit.items.map(i => [i.itemId, i.amount]), [
        [10000145, 10], [10000147, 1], [10000310, 8],
    ])

    const noSoloWeapon = rewards.buildFiveBossCursedWeaponDropPlan({
        rewardMultiplier: 1,
        dropRate: 0.025,
        availableEquipmentIds: [5910101],
        randomFloat: () => 0.03,
    })
    assert.deepEqual(noSoloWeapon.equipmentIds, [])
    const multiplayerWeapon = rewards.buildFiveBossCursedWeaponDropPlan({
        rewardMultiplier: 1,
        availableEquipmentIds: [5910101],
        randomFloat: () => 0.03,
    })
    assert.deepEqual(multiplayerWeapon.equipmentIds, [5910101])
})

test('solo cannot overwrite an active cooperative run; aborted solo cannot finish', async () => {
    const p = player(), room = run([p])
    start(p, room)
    assert.throws(() => solo.startFiveBossSoloSync(p.id, 'overlapping-solo', () => {}), /multiplayer run/)
    assert.equal(active.getPlayerActiveQuestSync(p.id).playId, p.playId)
    assert.equal(items.getPlayerItemSync(p.id, mode.ticketItemId), 1)
    const single = player()
    const app = await httpApp(single, load('routes/api/singleBattleQuest').default)
    try {
        assert.equal((await app.inject({ method: 'POST', url: '/start', payload: httpStart(single) })).statusCode, 200)
        const abort = await app.inject({ method: 'POST', url: '/abort', payload: httpFinish(single) })
        assert.equal(abort.statusCode, 200, abort.body)
        assert.equal(solo.isActiveFiveBossSoloSync(single.id, single.playId), false)
        const late = await app.inject({ method: 'POST', url: '/finish', payload: httpFinish(single) })
        assert.equal(late.statusCode, 400, late.body)
        assert.equal(items.getPlayerItemSync(single.id, 10000145), null)
    } finally { await app.close() }
})

test('multiplayer five-boss abort waits for the async persistence boundary', async () => {
    const p = player(), room = run([p])
    const app = await httpApp(p, load('multi/http/battle').registerBattleRoutes)
    try {
        const started = await app.inject({ method: 'POST', url: '/start', payload: httpStart(p, room) })
        assert.equal(started.statusCode, 200, started.body)
        const aborted = await app.inject({ method: 'POST', url: '/abort', payload: httpFinish(p) })
        assert.equal(aborted.statusCode, 200, aborted.body)
        assert.equal(active.getPlayerActiveQuestSync(p.id), null)
        assert.equal(ledger.getFiveBossRunByClientSync({ playerId: p.id, clientPlayId: p.playId }).status, 'aborted')
    } finally { await app.close() }
})

test('multiplayer abort recovers omitted route fields but rejects explicit forgery', async () => {
    const p = player(), room = run([p])
    const app = await httpApp(p, load('multi/http/battle').registerBattleRoutes)
    try {
        assert.equal((await app.inject({
            method: 'POST', url: '/start', payload: httpStart(p, room),
        })).statusCode, 200)
        const forged = await app.inject({
            method: 'POST', url: '/abort',
            payload: { viewer_id: p.viewerId, play_id: p.playId, category: 1,
                quest_id: 1000101, api_count: 2 },
        })
        assert.equal(forged.statusCode, 400, forged.body)
        assert.equal(active.getPlayerActiveQuestSync(p.id).playId, p.playId)
        const recovered = await app.inject({
            method: 'POST', url: '/abort',
            payload: { viewer_id: p.viewerId, play_id: p.playId, api_count: 3 },
        })
        assert.equal(recovered.statusCode, 200, recovered.body)
        assert.equal(recovered.json().data.category_id, mode.category)
        assert.equal(active.getPlayerActiveQuestSync(p.id), null)
        assert.equal(ledger.getFiveBossRunByClientSync({
            playerId: p.id, clientPlayId: p.playId,
        }).status, 'aborted')
    } finally { await app.close() }
})

test('lobby snapshot requires three ready slots, owned characters and the bound battle connection', () => {
    const host = player(), guest = player(), room = run([host, guest])
    delete room.five_boss_runtime
    room.raising_state = 2
    const npc = { comId: 1, state: [1], viewerId: 900000001 }
    const clients = [host, guest].map((p, index) => ({ viewerId: p.viewerId, playerId: p.id,
        roomNumber: room.room_number, connectionId: `bound-${p.id}`, isBattle: false, superseded: false,
        socket: { remoteAddress: `127.0.0.${index + 1}` }, yourself: { viewerId: p.viewerId, comId: 0,
            state: [1], autoplayMode: index > 0, party: { characters: [[0, { id: 111001 }]], unison_characters: [] } } }))
    clients[0].mates = [clients[0].yourself, clients[1].yourself, npc]
    const manager = load('multi/state/SessionManager').sessionManager
    const original = manager.getClientsInRoom
    manager.getClientsInRoom = () => clients
    try {
        const lobby = load('multi/five-boss/lobby-runtime')
        npc.state = [0]
        assert.equal(lobby.freezeFiveBossLobby(room), false)
        npc.state = [1]
        clients[1].yourself.party.characters[0][1].id = 99999999
        assert.equal(lobby.freezeFiveBossLobby(room), false)
        clients[1].yourself.party.characters[0][1].id = 111001
        assert.equal(lobby.freezeFiveBossLobby(room), true)
        clients[0].yourself.autoplayMode = true
        assert.equal(lobby.freezeFiveBossLobby(room), true)
        assert.equal(room.five_boss_runtime.autoplayModeByPlayerId[String(host.id)], false)
        assert.deepEqual(room.five_boss_runtime.expectedRealPlayerIds, [host.id, guest.id])
        assert.equal(lobby.isFrozenFiveBossBattleClient(room, { ...clients[0], isBattle: true }), true)
        assert.equal(lobby.isFrozenFiveBossBattleClient(room, { ...clients[0], connectionId: 'forged' }), false)
        assert.equal(lobby.isFrozenFiveBossBattleClient(room,
            { ...clients[0], socket: { remoteAddress: '127.0.0.99' } }), true)
        assert.equal(lobby.isFrozenFiveBossBattleClient(room,
            { ...clients[0], playerId: guest.id, socket: { remoteAddress: '127.0.0.99' } }), false)
    } finally { manager.getClientsInRoom = original }
})

test('shared NPC lobby recruitment fills remaining seats without a Five Boss-only delay', async () => {
    const p = player()
    const room = createRoom(p.viewerId, p.id, 1, mode.category, mode.visibleQuestId, 0, 111001)
    room.is_npc_mode = true
    const manager = load('multi/state/SessionManager').sessionManager
    const coordinator = load('multi/coordinator/embedded').embeddedMultiCoordinator
    const socket = new (require('node:events').EventEmitter)()
    Object.assign(socket, { destroyed: false, readable: true, writable: true, remoteAddress: '127.0.0.1',
        write: () => true, end: () => {}, destroy: () => { socket.destroyed = true } })
    const client = manager.createClient(socket, p.viewerId, room.room_number, `npc-host-${p.id}`, p.id)
    client.yourself = { viewerId: p.viewerId, playerId: p.id, comId: 0, state: [1], rank: 1,
        party: { characters: [[0, { id: 111001 }]], unison_characters: [], marker: 'host-party' } }
    client.mates = [client.yourself]
    manager.addClientToRoom(client)
    const lobby = load('multi/tcp/lobby')
    const recruit = async () => {
        lobby.recruitNpcMatesForRoom(room.room_number)
        await coordinator.enqueueRoomCommand(room.room_number, () => {})
    }
    try {
        await recruit()
        const npcs = client.mates.filter(m => m.comId)
        assert.equal(npcs.length, 2)
        for (const npc of npcs) {
            assert.ok(npc.party)
            assert.ok(Array.isArray(npc.party.characters))
        }
        await recruit()
        assert.equal(client.mates.filter(m => m.comId).length, 2)
        assert.equal(client.mates.length, 3)
    } finally {
        manager.removeClient(client)
        load('multi/room/manager').disbandRoom(room.room_number)
    }
})

test('AI auto-repeat keeps the first successful COM parties stable in the room', async t => {
    const p = player()
    const room = createRoom(p.viewerId, p.id, 1, mode.category, mode.visibleQuestId, 0, 111001)
    room.is_npc_mode = true
    const manager = load('multi/state/SessionManager').sessionManager
    const coordinator = load('multi/coordinator/embedded').embeddedMultiCoordinator
    const pool = load('multi/npc/player-party-pool')
    const socket = new (require('node:events').EventEmitter)()
    Object.assign(socket, { destroyed: false, readable: true, writable: true, remoteAddress: '127.0.0.1',
        write: () => true, end: () => {}, destroy: () => { socket.destroyed = true } })
    const client = manager.createClient(socket, p.viewerId, room.room_number, `stable-ai-host-${p.id}`, p.id)
    client.yourself = { viewerId: p.viewerId, playerId: p.id, comId: 0, state: [1], rank: 1,
        party: { characters: [[0, { id: 111001 }]], unison_characters: [], marker: 'host-party' } }
    client.mates = [client.yourself]
    manager.addClientToRoom(client)
    let selection = 0
    t.mock.method(pool, 'getRandomPlayerNpcPartiesSync', () => {
        selection++
        const prefix = selection === 1 ? 'first' : 'rerolled'
        return [1, 2].map(index => ({
            sourcePlayerId: 100 + index,
            party: {
                characters: [[0, { id: 111001 }], [0, { id: 111001 }], [0, { id: 111001 }]],
                unison_characters: [],
                marker: `${prefix}-${index}`,
            },
        }))
    })
    const lobby = load('multi/tcp/lobby')
    const recruit = async () => {
        lobby.recruitNpcMatesForRoom(room.room_number)
        await coordinator.enqueueRoomCommand(room.room_number, () => {})
    }
    try {
        await recruit()
        assert.deepEqual(
            client.mates.filter(mate => mate.comId).map(mate => mate.party.marker),
            ['first-1', 'first-2'],
        )
        assert.deepEqual(
            Object.values(room.npc_party_by_com_id).map(party => party.marker),
            ['first-1', 'first-2'],
        )

        room.lobby_generation = 1
        client.roomGeneration = 1
        room.expected_real_viewer_ids = [p.viewerId]
        room.rematch_ai_count = 2
        room.npc_count = 2
        client.mates = [client.yourself]
        room.mates = [{ viewer_id: p.viewerId, player_id: p.id, com_id: 0 }]
        await recruit()

        assert.equal(selection, 1, 'a rematch with fixed COM parties must not query the random pool again')
        assert.deepEqual(
            client.mates.filter(mate => mate.comId).map(mate => mate.party.marker),
            ['first-1', 'first-2'],
        )
        assert.equal(
            client.mates.some(mate => mate.party?.marker?.startsWith('rerolled')),
            false,
        )
    } finally {
        manager.removeClient(client)
        load('multi/room/manager').disbandRoom(room.room_number)
    }
})

test('invalid host fallback leaves AI seats empty until the host corrects its wire party', async t => {
    const p = player()
    const room = createRoom(p.viewerId, p.id, 1, mode.category, mode.visibleQuestId, 0, 111001)
    room.is_npc_mode = true
    const manager = load('multi/state/SessionManager').sessionManager
    const coordinator = load('multi/coordinator/embedded').embeddedMultiCoordinator
    const pool = load('multi/npc/player-party-pool')
    let selectionCount = 0
    let historicalParties = []
    t.mock.method(pool, 'getRandomPlayerNpcPartiesSync', () => { selectionCount++; return historicalParties })
    const timers = []
    t.mock.method(global, 'setTimeout', (callback, delay) => {
        const timer = { callback, delay, unref() { return this }, ref() { return this } }
        timers.push(timer)
        return timer
    })
    const socket = new (require('node:events').EventEmitter)()
    Object.assign(socket, { destroyed: false, readable: true, writable: true,
        write: () => true, end: () => {}, destroy: () => { socket.destroyed = true } })
    const client = manager.createClient(socket, p.viewerId, room.room_number, `blocked-ai-${p.id}`, p.id)
    client.enterData = {}
    client.yourself = { viewerId: p.viewerId, playerId: p.id, comId: 0, state: [0], rank: 1,
        currentPartyId: 1, party: {
            characters: [[0, { id: 111001 }]], unison_characters: [],
            equipments: [[0, { equipmentId: 100013 }], [1], [1]],
            abilitySoulIds: [[0, 100023], [1], [1]],
        } }
    client.mates = [client.yourself]
    manager.addClientToRoom(client)
    const lobby = load('multi/tcp/lobby')
    const equipmentIdleMs = load('multi/room/equipment-ready').EQUIPMENT_IDLE_MS
    try {
        lobby.recruitNpcMatesForRoom(room.room_number)
        await coordinator.enqueueRoomCommand(room.room_number, () => {})
        assert.equal(client.mates.filter(mate => mate.comId).length, 0)
        assert.equal(room.npc_count, 0)
        assert.deepEqual(room.npc_party_by_com_id, {})
        assert.deepEqual(client.yourself.party.equipments[0], [0, { equipmentId: 100013 }])
        assert.deepEqual(client.yourself.party.abilitySoulIds[0], [0, 100023])
        // Drain several delayed callback generations. A ready callback used to
        // schedule another recruitment, which installed another ready callback.
        let drainedTimers = 0
        for (let cycle = 0; cycle < 4; cycle++) {
            const pending = timers.slice(drainedTimers)
            drainedTimers = timers.length
            // Advance recruitment/readiness cycles, not the independent 30s
            // equipment idle deadline that deliberately disbands an invalid host.
            for (const timer of pending.filter(timer => timer.delay < equipmentIdleMs)) timer.callback()
            await coordinator.enqueueRoomCommand(room.room_number, () => {})
            await coordinator.enqueueRoomCommand(room.room_number, () => {})
        }
        assert.equal(selectionCount, 1, 'an empty legal pool must not be drawn again by delayed readiness')
        assert.equal(timers.length, drainedTimers, 'blocked recruitment must not create recurring timers')
        assert.equal(timers.some(timer => timer.delay === 100), false, 'invalid host must not retry indefinitely')

        const legal = { ...client.yourself.party,
            equipments: [[0, { equipmentId: 300101 }], [1], [1]],
            abilitySoulIds: [[0, 300201], [1], [1]],
        }
        historicalParties = [{ party: legal }]
        lobby.recruitNpcMatesForRoom(room.room_number)
        await coordinator.enqueueRoomCommand(room.room_number, () => {})
        for (let cycle = 0; cycle < 4; cycle++) {
            const pending = timers.slice(drainedTimers)
            drainedTimers = timers.length
            for (const timer of pending.filter(timer => timer.delay < equipmentIdleMs)) timer.callback()
            await coordinator.enqueueRoomCommand(room.room_number, () => {})
            await coordinator.enqueueRoomCommand(room.room_number, () => {})
        }
        assert.equal(client.mates.filter(mate => mate.comId).length, 1)
        assert.equal(selectionCount, 2, 'a partial legal roster must not keep rerolling its missing seat')
        assert.equal(timers.length, drainedTimers)
        assert.equal(timers.some(timer => timer.delay === 100), false)
        assert.equal(load('multi/room/manager').getRoom(room.room_number), room)
        assert.ok(client.equipmentReadyBlock, 'partial AI readiness must retain the host equipment gate')

        lobby.handleMessage(socket, [0, [2, { party: legal }, 1, 1]])
        await coordinator.enqueueRoomCommand(room.room_number, () => {})
        const reconciliation = timers.filter(timer => timer.delay === 100)
        assert.equal(reconciliation.length, 1)
        reconciliation[0].callback()
        await coordinator.enqueueRoomCommand(room.room_number, () => {})
        await coordinator.enqueueRoomCommand(room.room_number, () => {})
        assert.equal(client.mates.filter(mate => mate.comId).length, 2)
        assert.equal(room.npc_count, 2)
        for (const mate of client.mates.filter(mate => mate.comId)) {
            assert.deepEqual(mate.party, legal)
            assert.notEqual(mate.party, legal, 'the serialized business projection must not expose its source party reference')
        }
        assert.equal(selectionCount, 3)
    } finally {
        manager.removeClient(client)
        load('multi/room/manager').disbandRoom(room.room_number)
    }
})

test('invalid rematch cache is discarded and replaced with a legal pool party', async t => {
    const p = player()
    const room = createRoom(p.viewerId, p.id, 1, mode.category, mode.visibleQuestId, 0, 111001)
    room.is_npc_mode = true
    room.npc_party_by_com_id['1'] = {
        characters: [[0, { id: 111001 }]],
        equipments: [[0, { equipmentId: 100013 }]],
        abilitySoulIds: [[0, 100023]],
        marker: 'invalid-cache',
    }
    const manager = load('multi/state/SessionManager').sessionManager
    const coordinator = load('multi/coordinator/embedded').embeddedMultiCoordinator
    const pool = load('multi/npc/player-party-pool')
    t.mock.method(pool, 'getRandomPlayerNpcPartiesSync', (_host, count) =>
        Array.from({ length: count }, (_, index) => ({
            sourcePlayerId: 900 + index,
            party: {
                characters: [[0, { id: 111001 }], [0, { id: 111001 }], [0, { id: 111001 }]],
                equipments: [[0, { equipmentId: 300101 }], [1], [1]],
                abilitySoulIds: [[0, 300201], [1], [1]],
                marker: `replacement-${index}`,
            },
        })))
    const socket = new (require('node:events').EventEmitter)()
    Object.assign(socket, { destroyed: false, readable: true, writable: true, remoteAddress: '127.0.0.1',
        write: () => true, end: () => {}, destroy: () => { socket.destroyed = true } })
    const client = manager.createClient(socket, p.viewerId, room.room_number, `invalid-cache-${p.id}`, p.id)
    client.yourself = { viewerId: p.viewerId, playerId: p.id, comId: 0, state: [1], rank: 1,
        party: { characters: [[0, { id: 111001 }]], equipments: [], abilitySoulIds: [] } }
    client.mates = [client.yourself]
    manager.addClientToRoom(client)
    const lobby = load('multi/tcp/lobby')
    try {
        lobby.recruitNpcMatesForRoom(room.room_number)
        await coordinator.enqueueRoomCommand(room.room_number, () => {})
        assert.equal(
            Object.values(room.npc_party_by_com_id).some(party => party.marker === 'invalid-cache'),
            false,
        )
        assert.equal(client.mates.filter(mate => mate.comId).length, 2)
        assert.ok(client.mates.filter(mate => mate.comId)
            .every(mate => mate.party.marker?.startsWith('replacement-')))
    } finally {
        manager.removeClient(client)
        load('multi/room/manager').disbandRoom(room.room_number)
    }
})

test('shared random-recruitment fallback fills AI after the configured timeout', async () => {
    const p = player()
    const room = createRoom(p.viewerId, p.id, 1, mode.category, mode.visibleQuestId, 0, 111001)
    const manager = load('multi/state/SessionManager').sessionManager
    const coordinator = load('multi/coordinator/embedded').embeddedMultiCoordinator
    const socket = new (require('node:events').EventEmitter)()
    Object.assign(socket, { destroyed: false, readable: true, writable: true, remoteAddress: '127.0.0.1',
        write: () => true, end: () => {}, destroy: () => { socket.destroyed = true } })
    const client = manager.createClient(socket, p.viewerId, room.room_number, `fallback-host-${p.id}`, p.id)
    client.yourself = { viewerId: p.viewerId, playerId: p.id, comId: 0, state: [1], rank: 1,
        party: { characters: [[0, { id: 111001 }]], unison_characters: [], marker: 'host-party' } }
    client.mates = [client.yourself]
    manager.addClientToRoom(client)
    const aiFill = load('multi/ai-fill')
    const previousTimeout = process.env.MULTI_AI_FILL_TIMEOUT_MS
    process.env.MULTI_AI_FILL_TIMEOUT_MS = '20'
    try {
        aiFill.scheduleAiFallback(room.room_number)
        assert.equal(aiFill.hasAiFallback(room.room_number), true)
        const deadline = Date.now() + 3000
        while (Date.now() < deadline && client.mates.filter(m => m.comId).length < 2) {
            await new Promise(resolve => setTimeout(resolve, 25))
            await coordinator.enqueueRoomCommand(room.room_number, () => {})
        }
        assert.equal(client.mates.filter(m => m.comId).length, 2)
        assert.equal(aiFill.hasAiFallback(room.room_number), false)
    } finally {
        if (previousTimeout === undefined) delete process.env.MULTI_AI_FILL_TIMEOUT_MS
        else process.env.MULTI_AI_FILL_TIMEOUT_MS = previousTimeout
        manager.removeClient(client)
        load('multi/room/manager').disbandRoom(room.room_number)
    }
})

test('rematch restores the previous AI count and fills the extra AI after the real-player grace', async t => {
    const host = player(), guest = player()
    const room = createRoom(host.viewerId, host.id, 1, mode.category, mode.visibleQuestId, 0, 111001)
    room.lobby_generation = 1
    room.expected_real_viewer_ids = [host.viewerId, guest.viewerId]
    room.rematch_ai_count = 1
    room.is_npc_mode = true
    const manager = load('multi/state/SessionManager').sessionManager
    const coordinator = load('multi/coordinator/embedded').embeddedMultiCoordinator
    const socket = new (require('node:events').EventEmitter)()
    Object.assign(socket, { destroyed: false, readable: true, writable: true, remoteAddress: '127.0.0.1',
        write: () => true, end: () => {}, destroy: () => { socket.destroyed = true } })
    const client = manager.createClient(socket, host.viewerId, room.room_number, `rematch-host-${host.id}`, host.id)
    client.roomGeneration = room.lobby_generation
    client.enterData = {}
    client.yourself = { viewerId: host.viewerId, playerId: host.id, comId: 0, state: [1], rank: 1,
        party: { characters: [[0, { id: 111001 }]], unison_characters: [], marker: 'host-party' } }
    client.mates = [client.yourself]
    manager.addClientToRoom(client)
    const lobby = load('multi/tcp/lobby')
    const reservations = load('multi/room/rematch-roster')
    const mono = require('node:perf_hooks').performance
    let monotonicNow = mono.now()
    t.mock.method(mono, 'now', () => monotonicNow)
    reservations.markMemberSettlementCommitted(room, guest.viewerId)
    reservations.markRematchReturnWindowOpened(room)
    const returnDeadline = reservations.getNextReturnDeadline(room)
    assert.equal(returnDeadline, monotonicNow + 60_000)
    const waitForNpcCount = async expected => {
        const deadline = Date.now() + 3000
        while (Date.now() < deadline && client.mates.filter(m => m.comId).length < expected) {
            await new Promise(resolve => setTimeout(resolve, 20))
            await coordinator.enqueueRoomCommand(room.room_number, () => {})
        }
        return client.mates.filter(m => m.comId).length
    }
    try {
        lobby.recruitNpcMatesForRoom(room.room_number)
        assert.equal(await waitForNpcCount(1), 1)
        // The missing real player's seat stays reserved during the grace;
        // only the previous battle's AI count is restored immediately.
        assert.ok(room.rematch_wait_started_at !== null)
        assert.equal(client.mates.filter(m => m.comId).length, 1)

        monotonicNow = returnDeadline - 1
        assert.deepEqual(reservations.getExpiredReturnViewerIds(room), [])
        lobby.recruitNpcMatesForRoom(room.room_number)
        await coordinator.enqueueRoomCommand(room.room_number, () => {})
        assert.deepEqual(room.expected_real_viewer_ids, [host.viewerId, guest.viewerId])
        assert.equal(client.mates.filter(m => m.comId).length, 1)

        const originalAiParty = structuredClone(client.mates.find(mate => mate.comId).party)
        // Advance the member's monotonic result/return lease, then exercise
        // the actual room cleanup rather than editing its expected roster.
        monotonicNow = returnDeadline + 1
        lobby.scheduleRematchDisconnectCleanup(room.room_number)
        assert.equal(await waitForNpcCount(2), 2)
        assert.deepEqual(room.expected_real_viewer_ids, [host.viewerId])
        assert.equal(client.mates.length, 3)
        assert.deepEqual(client.mates.find(mate => mate.comId === 1).party, originalAiParty)
    } finally {
        manager.removeClient(client)
        load('multi/room/manager').disbandRoom(room.room_number)
    }
})

test('departed bell guest retains its return lease before expiry then AI fills and starts again', async t => {
    const host = player(), guest = player()
    const room = createRoom(host.viewerId, host.id, 1, mode.category, mode.visibleQuestId, 0, 111001)
    room.lobby_generation = 1
    room.expected_real_viewer_ids = [host.viewerId, guest.viewerId]
    room.member_viewer_ids = [host.viewerId, guest.viewerId]
    room.member_player_ids = { [host.viewerId]: host.id, [guest.viewerId]: guest.id }
    room.rematch_ai_count = 1
    room.npc_count = 1
    room.is_npc_mode = true
    const manager = load('multi/state/SessionManager').sessionManager
    const coordinator = load('multi/coordinator/embedded').embeddedMultiCoordinator
    const makeSocket = address => {
        const socket = new (require('node:events').EventEmitter)()
        Object.assign(socket, { destroyed: false, readable: true, writable: true, remoteAddress: address,
            write: () => true, end: () => {}, destroy: () => { socket.destroyed = true } })
        return socket
    }
    const hostSocket = makeSocket('127.0.0.1')
    const guestSocket = makeSocket('127.0.0.2')
    const hostClient = manager.createClient(
        hostSocket, host.viewerId, room.room_number, `departed-host-${host.id}`, host.id,
    )
    const guestClient = manager.createClient(
        guestSocket, guest.viewerId, room.room_number, `departed-guest-${guest.id}`, guest.id,
    )
    hostClient.roomGeneration = room.lobby_generation
    guestClient.roomGeneration = room.lobby_generation
    hostClient.enterData = guestClient.enterData = {}
    hostClient.yourself = { viewerId: host.viewerId, playerId: host.id, comId: 0, state: [1],
        autoplayMode: false, rank: 130, party: {
            characters: [[0, { id: 111001 }]], unison_characters: [],
        } }
    guestClient.yourself = { viewerId: guest.viewerId, playerId: guest.id, comId: 0, state: [1],
        autoplayMode: false, rank: 130, party: {
            characters: [[0, { id: 111001 }]], unison_characters: [],
        } }
    hostClient.mates = [hostClient.yourself, guestClient.yourself]
    guestClient.mates = hostClient.mates
    room.mates = [
        { viewer_id: host.viewerId, player_id: host.id, com_id: 0 },
        { viewer_id: guest.viewerId, player_id: guest.id, com_id: 0 },
    ]
    manager.addClientToRoom(hostClient)
    manager.addClientToRoom(guestClient)
    manager.markRescueGuest(room.room_number, guest.viewerId)
    const lobby = load('multi/tcp/lobby')
    const reservations = load('multi/room/rematch-roster')
    const mono = require('node:perf_hooks').performance
    let monotonicNow = mono.now()
    t.mock.method(mono, 'now', () => monotonicNow)
    reservations.markMemberSettlementCommitted(room, guest.viewerId)
    reservations.markRematchReturnWindowOpened(room)
    reservations.markMemberReturned(room, guest.viewerId)
    try {
        // A transport loss alone still reserves the real seat for reconnect.
        manager.removeClient(guestClient)
        assert.deepEqual(room.expected_real_viewer_ids, [host.viewerId, guest.viewerId])
        const returnDeadline = reservations.getNextReturnDeadline(room)
        assert.equal(returnDeadline, monotonicNow + 60_000)
        monotonicNow = returnDeadline - 1
        assert.deepEqual(reservations.getExpiredReturnViewerIds(room), [])

        // Legacy Notify10 can be automatic. It restores the previous COM but
        // cannot revoke an absent member's individual return lease.
        lobby.handleMessage(hostSocket, [0, [10, [{ name: 'COM1' }, { name: 'COM2' }]]])
        await coordinator.enqueueRoomCommand(room.room_number, () => {})
        assert.deepEqual(room.expected_real_viewer_ids, [host.viewerId, guest.viewerId])
        assert.deepEqual(room.member_viewer_ids, [host.viewerId, guest.viewerId])
        assert.equal(load('multi/room/manager').isRoomMember(room, guest.viewerId), true)
        assert.equal(hostClient.mates.filter(mate => mate.comId).length, 1)

        monotonicNow = returnDeadline + 1
        lobby.scheduleRematchDisconnectCleanup(room.room_number)
        const cleanupDeadline = Date.now() + 3000
        while (Date.now() < cleanupDeadline && room.expected_real_viewer_ids.includes(guest.viewerId)) {
            await new Promise(resolve => setTimeout(resolve, 10))
            await coordinator.enqueueRoomCommand(room.room_number, () => {})
        }
        assert.deepEqual(room.expected_real_viewer_ids, [host.viewerId])
        assert.deepEqual(room.member_viewer_ids, [host.viewerId])
        assert.equal(room.mates.some(mate => mate.viewer_id === guest.viewerId), false)

        const deadline = Date.now() + 3000
        while (Date.now() < deadline && hostClient.mates.filter(mate => mate.comId).length < 2) {
            await new Promise(resolve => setTimeout(resolve, 20))
            await coordinator.enqueueRoomCommand(room.room_number, () => {})
        }
        const npcMates = hostClient.mates.filter(mate => mate.comId)
        assert.equal(npcMates.length, 2)
        for (const mate of npcMates) mate.state = [1]
        lobby.checkHostAutoReady(room.room_number)
        assert.equal(hostClient.yourself.state[0], 1)

        lobby.handleMessage(hostSocket, [0, [6]])
        await coordinator.enqueueRoomCommand(room.room_number, () => {})
        assert.equal(room.lifecycle.phase, 'BATTLE')
        assert.deepEqual(room.expected_real_viewer_ids, [host.viewerId])
        assert.equal(room.npc_count, 2)
        assert.deepEqual(room.five_boss_runtime.expectedRealPlayerIds, [host.id])
    } finally {
        manager.removeClient(hostClient)
        load('multi/room/manager').disbandRoom(room.room_number)
    }
})

test('new gacha characters can be granted and load their own mana nodes through runtime accessors', () => {
    const p = player()
    const assets = load('lib/assets')
    for (const id of [129992, 139995]) {
        const master = assets.getCharacterDataSync(id)
        assert.ok(master, `missing character ${id}`)
        load('lib/character').givePlayerCharacterSync(p.id, id)
        assert.ok(characters.getPlayerCharacterSync(p.id, id))
        assert.ok(Object.keys(assets.getCharacterManaNodesSync(id, 1) || {}).length > 0)
    }
})

async function httpApp(p, routes, reuseSession = false) {
    if (!reuseSession) await load('data/domains/session').insertSessionWithToken({ token: String(p.viewerId), accountId: p.accountId,
        expires: new Date(Date.now() + 86400000), type: 2 })
    const app = require('fastify')({ logger: false })
    app.addHook('onSend', (_req, reply, payload, done) => {
        if (String(reply.getHeader('content-type')).startsWith('application/x-msgpack') && typeof payload === 'object') {
            done(null, JSON.stringify(payload)); return
        }
        done(null, payload)
    })
    await routes(app)
    await app.ready()
    return app
}
function httpStart(p, room) {
    return { viewer_id: p.viewerId, play_id: p.playId, quest_id: mode.visibleQuestId, category: mode.category,
        party_id: 1, use_boost_point: true, use_boss_boost_point: true, is_auto_start_mode: true,
        room_number: room?.room_number, mate_player_ids: [], mate_party_ids: [], api_count: 1, combat_power: 1 }
}
function httpFinish(p) {
    return { viewer_id: p.viewerId, play_id: p.playId, quest_id: mode.visibleQuestId, category: mode.category,
        is_accomplished: true, elapsed_time_ms: 30000, score: 100, add_mana: 0, continue_count: 0,
        statistics: { clear_phase: 1, max_combo_count: 0, party: { characters: [{ id: 111001 }],
            unison_characters: [], equipments: [], ability_soul_ids: [] } }, api_count: 2, mate_player_result: [] }
}

test('five-boss start acknowledges a room lost after the outer gate without charging', async () => {
    const p = player(1)
    const body = { ...httpStart(p), room_number: 'missing-after-five-boss-gate' }
    const headers = {}
    let statusCode = 0
    let payload = null
    const reply = {
        header(name, value) {
            headers[name] = value
            return this
        },
        status(value) {
            statusCode = value
            return this
        },
        send(value) {
            payload = value
            return value
        },
    }

    await load('multi/http/five-boss-battle').handleFiveBossStart(body, p.id, reply)

    assert.equal(statusCode, 200)
    assert.equal(headers['content-type'], 'application/x-msgpack')
    assert.equal(payload.data_headers.result_code, 4050)
    assert.deepEqual(payload.data, {})
    assert.equal(players.getPlayerSync(p.id).stamina, 100)
    assert.equal(items.getPlayerItemSync(p.id, mode.ticketItemId), 1)
    assert.equal(active.getPlayerActiveQuestSync(p.id), null)
    assert.equal(ledger.getFiveBossRunByClientSync({
        playerId: p.id,
        clientPlayId: p.playId,
    }), null)
})

test('queued five-boss start rejects a replaced battle or frozen run before persistent side effects', async t => {
    const persistence = load('lib/persistence-coordinator')
    const manager = load('multi/room/manager')
    const memory = load('routes/api/singleBattleQuest').activeQuests
    for (const changedIdentity of ['battleSessionId', 'frozenRunId']) {
        const p = player(2), room = run([p])
        room.lifecycle.phase = 'BATTLE'
        room.lifecycle.battleSessionId = `queued-battle-${room.room_number}`
        const originalRunId = room.five_boss_runtime.runId
        const before = {
            quest: active.getPlayerActiveQuestSync(p.id),
            memory: memory[p.id],
            tickets: items.getPlayerItemSync(p.id, mode.ticketItemId),
            stamina: players.getPlayerSync(p.id).stamina,
            staminaUsed: players.getPlayerSync(p.id).totalStaminaUsed,
        }
        const app = await httpApp(p, load('multi/http/battle').registerBattleRoutes)
        const originalTransaction = persistence.runPersistenceTransaction
        let intercepted = 0
        const mockedTransaction = t.mock.method(persistence, 'runPersistenceTransaction', (context, callback, ...rest) =>
            originalTransaction(context, () => {
                if (context.operation === 'five_boss_start') {
                    intercepted++
                    // Change identity after the HTTP gate captured the room,
                    // at the point where the queued transaction begins work.
                    if (changedIdentity === 'battleSessionId') room.lifecycle.battleSessionId += '-replacement'
                    else room.five_boss_runtime.runId += '-replacement'
                }
                return callback()
            }, ...rest))
        try {
            const response = await app.inject({ method: 'POST', url: '/start', payload: httpStart(p, room) })
            assert.equal(intercepted, 1, changedIdentity)
            assert.equal(response.statusCode, 200, response.body)
            assert.equal(response.json().data_headers.result_code, 4050, changedIdentity)
            assert.deepEqual(active.getPlayerActiveQuestSync(p.id), before.quest, changedIdentity)
            assert.equal(memory[p.id], before.memory, changedIdentity)
            assert.equal(items.getPlayerItemSync(p.id, mode.ticketItemId), before.tickets, changedIdentity)
            assert.equal(players.getPlayerSync(p.id).stamina, before.stamina, changedIdentity)
            assert.equal(players.getPlayerSync(p.id).totalStaminaUsed, before.staminaUsed, changedIdentity)
            assert.equal(ledger.getFiveBossRunByClientSync({ playerId: p.id, clientPlayId: p.playId }), null)
            assert.equal(getDb().prepare('SELECT COUNT(*) AS count FROM five_boss_gauntlet_runs WHERE run_id IN (?, ?)')
                .get(originalRunId, room.five_boss_runtime.runId).count, 0)
        } finally {
            mockedTransaction.mock.restore()
            manager.disbandRoom(room.room_number)
            await app.close()
        }
    }
})

test('solo full-manual rewards use the whole-run AUTO record and replay exactly once', async () => {
    const p = player()
    load('data/domains/option').updatePlayerOptionsSync(p.id, { auto_play: false })
    const app = await httpApp(p, async app => {
        await app.register(load('routes/api/singleBattleQuest').default, { prefix: '/quest' })
        await app.register(load('routes/api/option').default, { prefix: '/option' })
    })
    try {
        assert.equal((await app.inject({ method: 'POST', url: '/quest/start', payload: httpStart(p) })).statusCode, 200)
        assert.equal(solo.getFiveBossSoloRewardMultiplierSync(p.id, p.playId), 2)
        const result = await app.inject({ method: 'POST', url: '/quest/finish', payload: httpFinish(p) })
        assert.equal(result.statusCode, 200, result.body)
        const data = result.json().data
        assert.equal(data.item_list['10000145'], 10)
        assert.equal(items.getPlayerItemSync(p.id, 40001), null)
        assert.equal(items.getPlayerItemSync(p.id, 40002), null)
        assert.deepEqual(data.drop_score_reward_ids, [])
        assert.deepEqual(data.drop_rare_reward_ids, [])
        const exp = characters.getPlayerCharacterSync(p.id, 111001).exp
        const again = await app.inject({ method: 'POST', url: '/quest/finish', payload: httpFinish(p) })
        assert.deepEqual(again.json(), result.json())
        assert.equal(items.getPlayerItemSync(p.id, 10000145), 10)
        assert.equal(characters.getPlayerCharacterSync(p.id, 111001).exp, exp)
    } finally { await app.close() }
})

test('both option endpoints mark AUTO permanently for this solo play across retry and memory loss', async () => {
    for (const [endpoint, enabled] of [['update', true], ['update_in_battle', true], ['update', 1], ['update_in_battle', 1]]) {
        const p = player()
        load('data/domains/option').updatePlayerOptionsSync(p.id, { auto_play: false })
        const app = await httpApp(p, async app => {
            await app.register(load('routes/api/singleBattleQuest').default, { prefix: '/quest' })
            await app.register(load('routes/api/option').default, { prefix: '/option' })
        })
        try {
            assert.equal((await app.inject({ method: 'POST', url: '/quest/start', payload: httpStart(p) })).statusCode, 200)
            const option = value => app.inject({ method: 'POST', url: `/option/${endpoint}`,
                payload: { viewer_id: p.viewerId, api_count: 4, option_params: { auto_play: value } } })
            assert.equal((await option(enabled)).statusCode, 200)
            assert.equal((await option(false)).statusCode, 200)
            delete load('routes/api/singleBattleQuest').activeQuests[p.id]
            assert.equal((await app.inject({ method: 'POST', url: '/quest/start', payload: httpStart(p) })).statusCode, 200)
            assert.equal(solo.getFiveBossSoloRewardMultiplierSync(p.id, p.playId), 1)
            assert.equal(items.getPlayerItemSync(p.id, 10000143), 1)
            const result = await app.inject({ method: 'POST', url: '/quest/finish', payload: httpFinish(p) })
            assert.equal(result.statusCode, 200, result.body)
            assert.equal(result.json().data.item_list['10000145'], 5)
        } finally { await app.close() }
    }
})

test('AUTO updates use the exact current solo play even with historical and unrelated active rows', () => {
    const p = player(), other = player(), db = getDb()
    const insert = db.prepare(`INSERT INTO five_boss_solo_runs
        (player_id, play_id, status, auto_at_start, auto_used) VALUES (?, ?, ?, 0, 0)`)
    db.transaction(() => {
        for (let i = 0; i < 2000; i++) insert.run(p.id, `history-${i}`, 'settled')
        insert.run(p.id, 'stale-active', 'active')
        insert.run(p.id, p.playId, 'active')
        insert.run(other.id, p.playId, 'active')
    })()
    const bind = (category, questId, isMulti = false) => active.insertPlayerActiveQuestSync(p.id,
        { playerId: p.id, playId: p.playId, category, questId, isMulti, continueCount: 0 })
    bind(mode.category, mode.visibleQuestId, true)
    solo.markFiveBossSoloAutoUsedSync(p.id)
    bind(mode.category, 1000101)
    solo.markFiveBossSoloAutoUsedSync(p.id)
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM five_boss_solo_runs WHERE player_id = ? AND auto_used = 1').get(p.id).n, 0)
    bind(mode.category, mode.visibleQuestId)
    const prepare = db.prepare
    let markerSql
    db.prepare = function (sql) {
        if (/UPDATE five_boss_solo_runs SET auto_used/.test(sql)) markerSql = sql
        return prepare.call(this, sql)
    }
    try { solo.markFiveBossSoloAutoUsedSync(p.id) } finally { db.prepare = prepare }
    const changed = db.prepare('SELECT player_id,play_id FROM five_boss_solo_runs WHERE auto_used = 1 AND player_id IN (?, ?)').all(p.id, other.id)
    assert.deepEqual(changed, [{ player_id: p.id, play_id: p.playId }])
    const plan = db.prepare('EXPLAIN QUERY PLAN ' + markerSql)
        .all(p.id, p.id, mode.category, mode.visibleQuestId).map(row => row.detail).join('\n')
    assert.match(plan, /player_id=\? AND play_id=\?/)
})

test('option batches preserve privacy, skip equal coerced values and roll back with the AUTO marker', async () => {
    const p = player(), db = getDb(), options = load('data/domains/option')
    options.updatePlayerProfileSettingsSync(p.id, { showOwnedCharacterCount: false })
    options.updatePlayerOptionsSync(p.id, { auto_play: true, sound: false })
    const changes = () => db.prepare('SELECT total_changes() AS n').get().n
    const before = changes()
    options.updatePlayerOptionsSync(p.id, { auto_play: 1, sound: 0, 'profile.show_owned_character_count': true })
    assert.equal(changes(), before)
    assert.equal(options.getPlayerProfileSettingsSync(p.id).showOwnedCharacterCount, false)
    options.updatePlayerOptionsSync(p.id, { auto_play: false })
    const app = await httpApp(p, async app => {
        await app.register(load('routes/api/singleBattleQuest').default, { prefix: '/quest' })
        await app.register(load('routes/api/option').default, { prefix: '/option' })
    })
    try {
        assert.equal((await app.inject({ method: 'POST', url: '/quest/start', payload: httpStart(p) })).statusCode, 200)
        db.exec(`CREATE TEMP TRIGGER fail_auto_marker BEFORE UPDATE OF auto_used ON five_boss_solo_runs
            WHEN NEW.player_id = ${p.id} BEGIN SELECT RAISE(ABORT, 'injected marker failure'); END`)
        const response = await app.inject({ method: 'POST', url: '/option/update', payload: {
            viewer_id: p.viewerId, api_count: 4, option_params: { sound: true, auto_play: true } } })
        assert.equal(response.statusCode, 500)
        assert.equal(options.getPlayerOptionSync(p.id, 'sound'), false)
        assert.equal(options.getPlayerOptionSync(p.id, 'auto_play'), false)
        assert.equal(solo.getFiveBossSoloRewardMultiplierSync(p.id, p.playId), 2)
    } finally { db.exec('DROP TRIGGER IF EXISTS fail_auto_marker'); await app.close() }
    db.exec(`CREATE TEMP TRIGGER fail_option_batch BEFORE INSERT ON players_options
        WHEN NEW.key = 'fail-batch' BEGIN SELECT RAISE(ABORT, 'injected batch failure'); END`)
    try {
        assert.throws(() => options.updatePlayerOptionsSync(p.id, { sound: true, 'fail-batch': true }), /injected batch failure/)
        assert.equal(options.getPlayerOptionSync(p.id, 'sound'), false)
        db.transaction(() => {
            assert.throws(() => options.updatePlayerOptionsSync(p.id, { sound: true, 'fail-batch': true }), /injected batch failure/)
            assert.equal(options.getPlayerOptionSync(p.id, 'sound'), false)
        })()
    } finally { db.exec('DROP TRIGGER fail_option_batch') }
})

test('AUTO at start stays 1x; aborted marker cannot contaminate a fresh manual play', () => {
    const p = player(3), options = load('data/domains/option')
    const persist = () => active.insertPlayerActiveQuestSync(p.id, { playerId: p.id, playId: p.playId,
        category: mode.category, questId: mode.visibleQuestId, isMulti: false, continueCount: 0 })
    options.updatePlayerOptionsSync(p.id, { auto_play: true })
    solo.startFiveBossSoloSync(p.id, p.playId, persist)
    options.updatePlayerOptionsSync(p.id, { auto_play: false })
    assert.equal(solo.getFiveBossSoloRewardMultiplierSync(p.id, p.playId), 1)
    solo.abortFiveBossSoloSync(p.id, p.playId)
    p.playId += '-new'
    solo.startFiveBossSoloSync(p.id, p.playId, persist)
    assert.equal(solo.getFiveBossSoloRewardMultiplierSync(p.id, p.playId), 2)
    const planned = load('multi/five-boss/solo-rewards').grantFiveBossSoloRewardsSync({
        playerId: p.id, firstClear: true, rewardMultiplier: 2, randomFloat: () => 0,
        givePlayerItemSync: (_p, _id, amount) => amount })
    assert.equal(planned.items[10000145], 10)
    assert.equal(planned.items[10000147], 1)
    assert.equal(planned.items[10000144], 1)
    assert.equal(planned.items[10000146], 1)
})

test('solo ledger migration is additive, repeatable, and old active runs stay 1x', () => {
    const Database = require('better-sqlite3'), db = new Database(':memory:')
    try {
        db.exec(`CREATE TABLE players (id INTEGER PRIMARY KEY);
            INSERT INTO players VALUES (1);
            CREATE TABLE five_boss_solo_runs (player_id INTEGER NOT NULL, play_id TEXT NOT NULL,
                status TEXT NOT NULL, finish_request_key TEXT, response_json TEXT,
                PRIMARY KEY(player_id,play_id), UNIQUE(player_id,finish_request_key));
            INSERT INTO five_boss_solo_runs VALUES (1,'legacy','active',NULL,NULL);`)
        const init = load('data/initializers/five-boss-gauntlet').initializeFiveBossGauntlet
        init(db); init(db)
        assert.deepEqual(db.prepare('SELECT auto_at_start,auto_used FROM five_boss_solo_runs').get(),
            { auto_at_start: null, auto_used: 1 })
    } finally { db.close() }
})

test('multiplayer ledger migration adds battle entry evidence without rewriting old rows', () => {
    const Database = require('better-sqlite3'), db = new Database(':memory:')
    try {
        db.exec(`CREATE TABLE players (id INTEGER PRIMARY KEY);
            INSERT INTO players VALUES (1);
            CREATE TABLE five_boss_gauntlet_runs (
                run_id TEXT PRIMARY KEY, host_player_id INTEGER NOT NULL,
                route_id TEXT NOT NULL, room_number TEXT NOT NULL,
                ticket_item_id INTEGER NOT NULL, expected_member_count INTEGER NOT NULL,
                status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
            CREATE TABLE five_boss_gauntlet_members (
                run_id TEXT NOT NULL, player_id INTEGER NOT NULL, client_play_id TEXT,
                is_auto_mode INTEGER, started_at TEXT, aborted_at TEXT,
                level_next_at TEXT, finalized_at TEXT,
                party_character_ids_json TEXT NOT NULL DEFAULT '[]',
                PRIMARY KEY(run_id, player_id), UNIQUE(player_id, client_play_id));
            INSERT INTO five_boss_gauntlet_runs VALUES
                ('legacy',1,'five_boss','123456',10000143,1,'active','before','before');
            INSERT INTO five_boss_gauntlet_members VALUES
                ('legacy',1,'play',0,'before',NULL,NULL,NULL,'[]');`)
        const init = load('data/initializers/five-boss-gauntlet').initializeFiveBossGauntlet
        init(db); init(db)
        assert.deepEqual(db.prepare(`SELECT started_at, battle_entered_at
            FROM five_boss_gauntlet_members`).get(), {
            started_at: 'before',
            battle_entered_at: null,
        })
    } finally { db.close() }
})

test('new valid multiplayer start abandons solo atomically; invalid start preserves solo', async () => {
    const p = player(3), soloApp = await httpApp(p, load('routes/api/singleBattleQuest').default)
    const multiApp = await httpApp(p, load('multi/http/battle').registerBattleRoutes, true)
    try {
        assert.equal((await soloApp.inject({ method: 'POST', url: '/start', payload: httpStart(p) })).statusCode, 200)
        const oldPlay = p.playId, room = run([p])
        p.playId += '-multi'
        // Failure after attempted cleanup must roll both persistent and memory state back.
        const frozen = room.five_boss_runtime
        delete room.five_boss_runtime
        const rejected = await multiApp.inject({ method: 'POST', url: '/start', payload: httpStart(p, room) })
        assert.equal(rejected.statusCode, 200, rejected.body)
        assert.equal(rejected.json().data_headers.result_code, 4050)
        assert.equal(active.getPlayerActiveQuestSync(p.id).playId, oldPlay)
        assert.equal(solo.isActiveFiveBossSoloSync(p.id, oldPlay), true)
        room.five_boss_runtime = frozen
        const response = await multiApp.inject({ method: 'POST', url: '/start', payload: httpStart(p, room) })
        assert.equal(response.statusCode, 200, response.body)
        assert.equal(solo.isActiveFiveBossSoloSync(p.id, oldPlay), false)
        assert.equal(active.getPlayerActiveQuestSync(p.id).playId, p.playId)
        assert.equal(items.getPlayerItemSync(p.id, mode.ticketItemId), 1)
        assert.equal(players.getPlayerSync(p.id).stamina, 30)
        assert.equal(solo.abandonFiveBossSoloForMultiSync(p.id, oldPlay), false)
        assert.equal(active.getPlayerActiveQuestSync(p.id).playId, p.playId)
    } finally { await soloApp.close(); await multiApp.close() }
})

test('new five-boss room abandons an orphan ordinary solo active quest', async () => {
    const p = player(2)
    const oldPlay = 'orphan-ordinary-solo'
    const oldActive = {
        playerId: p.id,
        playId: oldPlay,
        questId: 1000101,
        category: 1,
        useBossBoostPoint: false,
        useBoostPoint: false,
        isAutoStartMode: false,
        isMulti: false,
        isMultiHost: false,
        roomNumber: null,
        continueCount: 0,
        startedAtMs: Date.now(),
    }
    active.insertPlayerActiveQuestSync(p.id, oldActive)
    load('routes/api/singleBattleQuest').activeQuests[p.id] = {
        ...oldActive,
        roomNumber: undefined,
    }
    const room = run([p])
    p.playId = 'five-after-orphan-solo'
    const app = await httpApp(p, load('multi/http/battle').registerBattleRoutes)
    try {
        const response = await app.inject({
            method: 'POST',
            url: '/start',
            payload: httpStart(p, room),
        })
        assert.equal(response.statusCode, 200, response.body)
        assert.equal(response.json().data.play_id, p.playId)
        assert.equal(active.getPlayerActiveQuestSync(p.id).playId, p.playId)
        assert.equal(load('routes/api/singleBattleQuest').activeQuests[p.id].playId, p.playId)
    } finally { await app.close() }
})

test('stale multiplayer with a missing room field is recovered from its immutable ledger', async () => {
    const p = player(3), previousRoom = run([p])
    start(p, previousRoom)
    const oldPlay = p.playId
    load('multi/room/manager').disbandRoom(previousRoom.room_number)
    getDb().prepare('UPDATE players_active_quests SET room_number = NULL WHERE player_id = ?').run(p.id)
    p.playId += '-next'
    const next = run([p]), app = await httpApp(p, load('multi/http/battle').registerBattleRoutes)
    try {
        const response = await app.inject({ method: 'POST', url: '/start', payload: httpStart(p, next) })
        assert.equal(response.statusCode, 200, response.body)
        assert.equal(active.getPlayerActiveQuestSync(p.id).playId, p.playId)
        assert.equal(ledger.getFiveBossRunByClientSync({ playerId: p.id, clientPlayId: oldPlay }).status, 'aborted')
        const late = await app.inject({ method: 'POST', url: '/finish', payload: { ...httpFinish(p), play_id: oldPlay } })
        // A finish for an already-aborted run is answered as a reward-less
        // failure instead of a 400 so the client cannot end up in a fatal
        // H400 dialog after its battle socket was gone.
        assert.equal(late.statusCode, 200, late.body)
        assert.equal(late.json().data.clear_rank, 0)
        assert.equal(active.getPlayerActiveQuestSync(p.id).playId, p.playId)
        assert.equal(items.getPlayerItemSync(p.id, 10000145), null)
    } finally { await app.close() }
})

test('authenticated SceneReady survives a later TCP close and prevents finish H400', { timeout: 15000 }, async () => {
    const p = player(), room = run([p]), connectionId = `trace-${p.id}`
    const coordinator = load('multi/coordinator/embedded').embeddedMultiCoordinator
    assert.equal(coordinator.commitBattleStart(room).ok, true)
    assert.ok(load('multi/state/battle-contract').getBattleSessionContract(room))
    room.five_boss_runtime.battleIdentityByViewerId[String(p.viewerId)] = {
        playerId: p.id, connectionId, remoteAddress: '127.0.0.1',
    }
    const runId = room.five_boss_runtime.runId
    const manager = load('multi/state/SessionManager').sessionManager
    const trace = load('multi/five-boss/connection-diagnostic').fiveBossConnectionDiagnostics
    const { EventEmitter, once } = require('node:events'), net = require('node:net')
    const lobbySocket = new EventEmitter()
    Object.assign(lobbySocket, { remoteAddress: '127.0.0.1', readable: true, writable: true, destroyed: false,
        write: () => true, end: () => {}, destroy: () => { lobbySocket.destroyed = true } })
    const lobbyClient = manager.createClient(lobbySocket, p.viewerId, room.room_number, connectionId, p.id)
    lobbyClient.roomGeneration = 1
    manager.addClientToRoom(lobbyClient)
    manager.setBattleExpectedCount(room.room_number, 1, [{ viewerId: p.viewerId, connectionId }])
    const app = await httpApp(p, load('multi/http/battle').registerBattleRoutes)
    const originalCreateServer = net.createServer, previousPort = process.env.SESSION_PORT
    const originalWarn = console.warn, messages = [], sockets = []
    let rawServer, tcp
    const waitFor = async condition => {
        const deadline = Date.now() + 3000
        while (!condition()) {
            assert.ok(Date.now() < deadline, 'TCP operation did not reach its expected state')
            await new Promise(resolve => setTimeout(resolve, 5))
        }
    }
    try {
        console.warn = (...args) => messages.push(args.join(' '))
        process.env.SESSION_PORT = '0'
        net.createServer = (...args) => { rawServer = originalCreateServer(...args); return rawServer }
        tcp = load('multi/tcp/server')
        await tcp.startSessionServer()
        net.createServer = originalCreateServer
        const started = await app.inject({ method: 'POST', url: '/start', payload: httpStart(p, room) })
        assert.equal(started.statusCode, 200, started.body)
        assert.equal(started.json().data_headers.result_code, 1, started.body)
        const connect = async () => {
            const incoming = once(rawServer, 'connection')
            const socket = net.createConnection({ host: '127.0.0.1', port: rawServer.address().port })
            sockets.push(socket)
            await once(socket, 'connect')
            const [serverSocket] = await incoming
            sockets.push(serverSocket)
            socket.on('data', () => {})
            socket.write(JSON.stringify({ socklet: 'cooperation_battle', room_number: room.room_number,
                connection_id: connectionId, sp_session: `five-boss-${p.id}` }) + '\0')
            await waitFor(() => manager.getBattleClient(connectionId)?.socket === serverSocket)
            return { socket, serverSocket }
        }
        const first = await connect()
        first.socket.write(JSON.stringify([0, [0]]) + '\0')
        await waitFor(() => trace.snapshot(runId, p.id).counts?.battle_entry_recorded)
        const closed = once(first.serverSocket, 'close')
        first.socket.end()
        await closed
        await coordinator.enqueueRoomCommand(room.room_number, () => {})
        const settled = await app.inject({ method: 'POST', url: '/finish', payload: httpFinish(p) })
        assert.equal(settled.statusCode, 200, settled.body)
        const crystals = items.getPlayerItemSync(p.id, 10000145)
        assert.ok(crystals > 0)
        const evidence = getDb().prepare(`SELECT battle_entered_at, level_next_at, finalized_at
            FROM five_boss_gauntlet_members WHERE run_id = ? AND player_id = ?`).get(runId, p.id)
        assert.ok(evidence.battle_entered_at)
        assert.equal(evidence.level_next_at, null)
        assert.equal(evidence.finalized_at, null)
        assert.equal((await app.inject({ method: 'POST', url: '/finish', payload: httpFinish(p) })).statusCode, 200)
        assert.equal(items.getPlayerItemSync(p.id, 10000145), crystals)
    } finally {
        net.createServer = originalCreateServer
        if (previousPort === undefined) delete process.env.SESSION_PORT
        else process.env.SESSION_PORT = previousPort
        for (const socket of sockets) socket.destroy()
        if (tcp) await tcp.stopSessionServer()
        manager.removeClient(lobbyClient)
        load('multi/room/manager').disbandRoom(room.room_number)
        await app.close()
        console.warn = originalWarn
    }
})

test('five-boss battle entry is recorded only after every real member is ready', async () => {
    const host = player(), guest = player(0), room = run([host, guest])
    start(host, room); start(guest, room)
    room.lifecycle.phase = 'BATTLE'
    room.lifecycle.battleSessionId = `battle-${room.room_number}`
    room.lobby_generation = 1
    const manager = load('multi/state/SessionManager').sessionManager
    const clients = [host, guest].map(member => {
        const socket = new (require('node:events').EventEmitter)()
        Object.assign(socket, {
            remoteAddress: `127.0.0.${member.id}`,
            destroyed: false,
            readable: true,
            writable: true,
            write: () => true,
            end() { this.destroyed = true },
            destroy() { this.destroyed = true },
        })
        const connectionId = `barrier-${member.id}`
        room.five_boss_runtime.battleIdentityByViewerId[String(member.viewerId)] = {
            playerId: member.id,
            remoteAddress: socket.remoteAddress,
            connectionId,
        }
        const client = manager.createClient(
            socket,
            member.viewerId,
            room.room_number,
            connectionId,
            member.id,
        )
        client.isBattle = true
        client.roomGeneration = room.lobby_generation
        assert.equal(manager.addBattleClient(connectionId, client), true)
        return client
    })
    manager.setBattleExpectedCount(room.room_number, 2, clients.map(client => ({
        viewerId: client.viewerId,
        connectionId: client.connectionId,
    })))
    try {
        assert.equal(manager.markSceneReady(clients[0].connectionId, room.room_number), false)
        assert.equal(getDb().prepare(`SELECT battle_entered_at FROM five_boss_gauntlet_members
            WHERE run_id = ? AND player_id = ?`).get(room.five_boss_runtime.runId, host.id).battle_entered_at, null)

        assert.equal(manager.markSceneReady(clients[1].connectionId, room.room_number), true)
        const waitForSignals = load('multi/five-boss/lobby-runtime').waitForFiveBossSignalPersistence
        await Promise.all([host, guest].map(member =>
            waitForSignals(room.five_boss_runtime.runId, member.id)))
        const rows = getDb().prepare(`SELECT player_id, battle_entered_at
            FROM five_boss_gauntlet_members WHERE run_id = ? ORDER BY player_id`)
            .all(room.five_boss_runtime.runId)
        assert.equal(rows.length, 2)
        assert.ok(rows.every(row => row.battle_entered_at))
    } finally {
        for (const client of clients) manager.removeClient(client)
        load('multi/room/manager').disbandRoom(room.room_number)
    }
})

test('finish waits for proof writes already accepted before the battle socket closes', async () => {
    const p = player(), room = run([p])
    room.lifecycle.phase = 'BATTLE'
    room.lobby_generation = 1
    const connectionId = `proof-race-${p.id}`
    room.five_boss_runtime.battleIdentityByViewerId[String(p.viewerId)] = {
        playerId: p.id, connectionId, remoteAddress: '127.0.0.1',
    }
    start(p, room)
    const app = await httpApp(p, load('multi/http/battle').registerBattleRoutes)
    const persistence = load('lib/persistence-coordinator')
    const lobby = load('multi/five-boss/lobby-runtime')
    const manager = load('multi/room/manager')
    const originalRunPersistenceTransaction = persistence.runPersistenceTransaction
    const delayed = async (...args) => {
        await new Promise(resolve => setTimeout(resolve, 20))
        return originalRunPersistenceTransaction(...args)
    }
    persistence.runPersistenceTransaction = delayed
    const client = {
        socket: { remoteAddress: '127.0.0.1', destroyed: true },
        viewerId: p.viewerId, playerId: p.id, connectionId, superseded: false,
    }
    try {
        lobby.recordFiveBossSignal(room, client, 'level_next')
        lobby.recordFiveBossSignal(room, client, 'finalize')
        const response = await app.inject({ method: 'POST', url: '/finish', payload: httpFinish(p) })
        assert.equal(response.statusCode, 200, response.body)
        assert.ok(items.getPlayerItemSync(p.id, 10000145) > 0)
    } finally {
        persistence.runPersistenceTransaction = originalRunPersistenceTransaction
        manager.disbandRoom(room.room_number)
        await app.close()
    }
})

test('finish without authenticated battle entry is terminal and forged identity cannot create it', async () => {
    const p = player(), room = run([p]);start(p, room)
    const app = await httpApp(p, load('multi/http/battle').registerBattleRoutes)
    const originalWarn = console.warn, messages = []
    console.warn = (...args) => messages.push(args.join(' '))
    try {
        const rejected = await app.inject({ method: 'POST', url: '/finish', payload: httpFinish(p) })
        assert.equal(rejected.statusCode, 200)
        assert.equal(rejected.json().data.clear_rank, 0)
        assert.equal(items.getPlayerItemSync(p.id, 10000145), null)
        assert.equal(active.getPlayerActiveQuestSync(p.id), null)
        const evidence = JSON.parse(messages.find(line => line.startsWith('[FIVE-BOSS-ACK]')).split('] ')[1])
        assert.equal(evidence.code, 'battle_proof_missing')
        assert.equal(evidence.proof.battle_entered_at, null)
        const prepare = getDb().prepare
        let diagnosticReads = 0
        getDb().prepare = function (sql) {
            if (/SELECT started_at, battle_entered_at, aborted_at, level_next_at, finalized_at/.test(sql)) diagnosticReads++
            return prepare.call(this, sql)
        }
        try {
            const admission = load('lib/persistence-admission').persistenceAdmission
            const digest = () => businessDatabaseDigest(getDb())
            const terminalBefore = digest(p.id, getDb())
            const rejectedBefore = admission.stats().rejected
            const retries = await Promise.all(Array.from({ length: 20 }, () =>
                app.inject({ method: 'POST', url: '/finish', payload: httpFinish(p) })))
            const admitted = retries.filter(response => response.statusCode === 200)
            const busy = retries.filter(response => response.statusCode === 503)
            assert.equal(admitted.length, 8, 'the per-player admission limit must remain eight')
            assert.equal(busy.length, 12)
            assert.ok(admitted.every(response => response.json().data.clear_rank === 0))
            assert.ok(busy.every(response => response.json().code === 'PERSISTENCE_QUEUE_FULL'))
            assert.equal(admission.stats().rejected - rejectedBefore, 12)
            assert.equal(admission.stats().total, 0)
            assert.equal(digest(p.id, getDb()), terminalBefore, 'overflow must preserve all terminal business state')
            const recovered = await Promise.all(Array.from({ length: 8 }, () =>
                app.inject({ method: 'POST', url: '/finish', payload: httpFinish(p) })))
            assert.ok(recovered.every(response => response.statusCode === 200 && response.json().data.clear_rank === 0))
            assert.equal(admission.stats().total, 0)
            assert.equal(digest(p.id, getDb()), terminalBefore, 'recovery must not grant or change business state')
            assert.equal(diagnosticReads, 0)
            const acknowledgements = messages
                .filter(line => line.startsWith('[FIVE-BOSS-ACK]'))
                .map(line => JSON.parse(line.split('] ')[1]))
            assert.deepEqual(
                [...new Set(acknowledgements.map(entry => entry.code))].sort(),
                ['battle_proof_missing', 'run_not_active'],
            )
            assert.equal(acknowledgements.length, 2)
        } finally { getDb().prepare = prepare }
        const forged = await app.inject({ method: 'POST', url: '/finish', payload: { ...httpFinish(p), quest_id: 1000101 } })
        assert.equal(forged.statusCode, 400)
        assert.equal(getDb().prepare('SELECT finalized_at FROM five_boss_gauntlet_members WHERE run_id = ? AND player_id = ?')
            .get(room.five_boss_runtime.runId, p.id).finalized_at, null)
        assert.equal(items.getPlayerItemSync(p.id, 10000145), null)
        assert.equal(ledger.getFiveBossRunByClientSync({
            playerId: p.id, clientPlayId: p.playId,
        }).status, 'aborted')
    } finally { console.warn = originalWarn; await app.close() }
})

test('multiplayer finish keeps the authenticated requester and distinct real teammates in follow info', async () => {
    const p = player(), mate = player(), room = run([p, mate])
    start(p, room); start(mate, room); proof(p, room); proof(mate, room)
    const app = await httpApp(p, load('multi/http/battle').registerBattleRoutes)
    const mateApp = await httpApp(mate, async () => {})
    try {
        load('data/domains/follow').addFollowSync(p.id, mate.id)
        const expected = load('lib/follow').buildFollowUserInfoSync(p.id, mate.id)
        assert.ok(expected)
        const response = await app.inject({ method: 'POST', url: '/finish', payload: { ...httpFinish(p),
            mate_player_result: [p.viewerId, mate.viewerId, mate.viewerId, 900000001].map(viewer_id => ({ viewer_id })) } })
        assert.equal(response.statusCode, 200, response.body)
        assert.deepEqual(response.json().data.follow_info, [expected])
    } finally { await app.close(); await mateApp.close() }
})

test('real multiplayer HTTP routes reject forged identities and retain the room for rematch', async () => {
    const p = player(), room = run([p])
    const app = await httpApp(p, async app => {
        load('multi/http/battle').registerBattleRoutes(app)
        load('multi/http/room').registerRoomRoutes(app)
    })
    try {
        const start = await app.inject({ method: 'POST', url: '/start', payload: httpStart(p, room) })
        assert.equal(start.statusCode, 200, start.body)
        assert.equal(items.getPlayerItemSync(p.id, mode.ticketItemId), 1)
        const payload = httpFinish(p)
        const forged = await app.inject({ method: 'POST', url: '/finish', payload: { ...payload, quest_id: 1000101 } })
        assert.equal(forged.statusCode, 400, forged.body)
        proof(p, room)
        const finish = await app.inject({ method: 'POST', url: '/finish', payload })
        assert.equal(finish.statusCode, 200, finish.body)
        const retainedRoom = load('multi/room/manager').getRoom(room.room_number)
        assert.equal(retainedRoom, room)
        assert.equal(retainedRoom.lifecycle.phase, 'RETURNING')
        assert.equal(retainedRoom.settlement_return_pending, true)
        assert.equal(retainedRoom.raising_state, 1)
        const exp = characters.getPlayerCharacterSync(p.id, 111001).exp
        const crystalCount = items.getPlayerItemSync(p.id, 10000145)
        const nextRoom = createRoom(p.viewerId, p.id, 1, mode.category, mode.visibleQuestId, 0, 111001)
        const dismissals = await Promise.all(Array.from({ length: 4 }, () => app.inject({
            method: 'POST', url: '/disband_room', payload: { viewer_id: p.viewerId, room_number: room.room_number },
        })))
        for (const response of dismissals) {
            assert.equal(response.statusCode, 200, response.body)
            assert.match(response.headers['content-type'], /application\/x-msgpack/)
            assert.deepEqual(response.json().data, {})
        }
        assert.equal(load('multi/room/manager').getRoom(nextRoom.room_number), nextRoom)
        assert.equal(items.getPlayerItemSync(p.id, mode.ticketItemId), 1)
        assert.equal(items.getPlayerItemSync(p.id, 10000145), crystalCount)
        const retry = await app.inject({ method: 'POST', url: '/finish', payload })
        assert.equal(retry.statusCode, 200, retry.body)
        assert.equal(characters.getPlayerCharacterSync(p.id, 111001).exp, exp)
        assert.deepEqual(retry.json().data.add_exp_list, finish.json().data.add_exp_list)
    } finally { await app.close() }
})

test('a returning five-boss guest can restore the original room after settlement', async () => {
    const host = player(), guest = player(), room = run([host, guest])
    const hostApp = await httpApp(host, async app => {
        load('multi/http/battle').registerBattleRoutes(app)
        load('multi/http/room').registerRoomRoutes(app)
        load('multi/http/lobby').registerLobbyRoutes(app)
    })
    const guestApp = await httpApp(guest, async app => {
        load('multi/http/battle').registerBattleRoutes(app)
        load('multi/http/room').registerRoomRoutes(app)
        load('multi/http/lobby').registerLobbyRoutes(app)
    })
    const manager = load('multi/room/manager')
    try {
        assert.equal((await hostApp.inject({ method: 'POST', url: '/start', payload: httpStart(host, room) })).statusCode, 200)
        assert.equal((await guestApp.inject({ method: 'POST', url: '/start', payload: httpStart(guest, room) })).statusCode, 200)
        proof(host, room); proof(guest, room)
        assert.equal((await hostApp.inject({ method: 'POST', url: '/finish', payload: httpFinish(host) })).statusCode, 200)
        assert.equal((await guestApp.inject({ method: 'POST', url: '/finish', payload: httpFinish(guest) })).statusCode, 200)
        assert.equal(room.lifecycle.phase, 'RETURNING')

        const search = await guestApp.inject({ method: 'POST', url: '/search_room', payload: {
            viewer_id: guest.viewerId, room_number: room.room_number, api_count: 1,
        } })
        assert.equal(search.statusCode, 200, search.body)
        assert.equal(search.json().data.room_exists, true)

        const select = await guestApp.inject({ method: 'POST', url: '/select_room', payload: {
            viewer_id: guest.viewerId, room_number: room.room_number,
            category: mode.category, quest_id: mode.visibleQuestId,
            party_id: 1, accepted_type: 0, api_count: 1,
        } })
        assert.equal(select.statusCode, 200, select.body)
        assert.equal(select.json().data.room_number, room.room_number)

        const restored = await guestApp.inject({ method: 'POST', url: '/restore_room', payload: {
            viewer_id: guest.viewerId, room_number: room.room_number,
        } })
        assert.equal(restored.statusCode, 200, restored.body)
        assert.equal(restored.json().data.room_number, room.room_number)
        assert.notEqual(restored.json().data.raising_state, 9)
    } finally {
        manager.disbandRoom(room.room_number)
        await hostApp.close(); await guestApp.close()
    }
})

test('room disband accepts repeated host cleanup but retains authentication and live-room ownership', async () => {
    const p = player(), guest = player()
    const room = createRoom(p.viewerId, p.id, 1, mode.category, 1000101, 0, 111001)
    room.member_viewer_ids.push(guest.viewerId)
    const app = await httpApp(p, load('multi/http/room').registerRoomRoutes)
    const guestApp = await httpApp(guest, async () => {})
    const dismiss = payload => app.inject({ method: 'POST', url: '/disband_room', payload })
    const payload = { viewer_id: p.viewerId, room_number: room.room_number }
    const manager = load('multi/room/manager')
    try {
        assert.equal((await dismiss({ ...payload, viewer_id: guest.viewerId })).statusCode, 403)
        assert.equal((await dismiss({ ...payload, viewer_id: 999999999 })).statusCode, 400)
        for (const room_number of [undefined, null, '', 123456, {}]) {
            assert.equal((await dismiss({ ...payload, room_number })).statusCode, 400)
        }
        assert.equal(manager.getRoom(room.room_number), room)
        const replies = await Promise.all(Array.from({ length: 4 }, () => dismiss(payload)))
        for (const response of replies) assert.equal(response.statusCode, 200, response.body)
        assert.equal(manager.getRoom(room.room_number), undefined)
        assert.equal((await dismiss(payload)).statusCode, 200)
        assert.equal((await dismiss({ ...payload, viewer_id: 999999999 })).statusCode, 400)
    } finally { await app.close(); await guestApp.close(); manager.disbandRoom(room.room_number) }
})

test('queued room disband cannot delete a replacement room or a later lobby generation', { timeout: 10000 }, async () => {
    const p = player(), manager = load('multi/room/manager')
    const coordinator = load('multi/coordinator/embedded').embeddedMultiCoordinator
    const gateway = load('multi/coordinator/default-runtime').getRoomCommandGateway()
    const app = await httpApp(p, load('multi/http/room').registerRoomRoutes)
    try {
        for (const replace of [true, false]) {
            const room = createRoom(p.viewerId, p.id, 1, mode.category, 1000101, 0, 111001)
            let release, onQueued
            const blocked = new Promise(resolve => { release = resolve })
            const queued = new Promise(resolve => { onQueued = resolve })
            const execute = gateway.execute
            const blocker = coordinator.enqueueRoomCommand(room.room_number, () => blocked)
            gateway.execute = function (kind, payload, options) {
                const result = execute.call(this, kind, payload, options)
                // Wait for this mutation's copied identity, not an unrelated
                // room's background command entering the same coordinator.
                if (kind === 'room.disband' && payload.roomNumber === room.room_number) onQueued(payload)
                return result
            }
            let request
            try {
                request = app.inject({ method: 'POST', url: '/disband_room', payload: {
                    viewer_id: p.viewerId, room_number: room.room_number,
                } }).then(response => response)
                const originalDecision = await queued
                assert.equal(originalDecision.identity.instanceId, room.lifecycle.instanceId)
                assert.equal(originalDecision.identity.generation, room.lobby_generation)
                let retained = room
                if (replace) {
                    manager.disbandRoom(room.room_number)
                    const crypto = require('node:crypto'), randomInt = crypto.randomInt
                    crypto.randomInt = () => Number(room.room_number)
                    try { retained = createRoom(p.viewerId, p.id, 1, mode.category, 1000101, 0, 111001) }
                    finally { crypto.randomInt = randomInt }
                } else {
                    room.lobby_generation += 1
                }
                release()
                const response = await request
                assert.equal(response.statusCode, 200, response.body)
                assert.equal(manager.getRoom(room.room_number), retained)
            } finally {
                gateway.execute = execute
                release()
                await blocker
                if (request) await request
                manager.disbandRoom(room.room_number)
            }
        }
    } finally { await app.close() }
})

test('real solo HTTP start/finish persists receipt; hidden scene and free finish are rejected', async () => {
    const p = player()
    load('data/domains/option').updatePlayerOptionsSync(p.id, { auto_play: true })
    const app = await httpApp(p, load('routes/api/singleBattleQuest').default)
    try {
        const free = await app.inject({ method: 'POST', url: '/finish', payload: httpFinish(p) })
        assert.equal(free.statusCode, 400, free.body)
        const hidden = await app.inject({ method: 'POST', url: '/start', payload: { ...httpStart(p), quest_id: 1099002 } })
        assert.equal(hidden.statusCode, 400, hidden.body)
        const start = await app.inject({ method: 'POST', url: '/start', payload: httpStart(p) })
        assert.equal(start.statusCode, 200, start.body)
        assert.equal(start.json().data.user_info.stamina, 65)
        assert.equal(items.getPlayerItemSync(p.id, mode.ticketItemId), 1)
        const finish = await app.inject({ method: 'POST', url: '/finish', payload: httpFinish(p) })
        assert.equal(finish.statusCode, 200, finish.body)
        assert.equal(finish.json().data.item_list['10000145'], 5)
        const exp = characters.getPlayerCharacterSync(p.id, 111001).exp
        load('lib/finish-response-cache').clearFinishResponseCache?.()
        const retry = await app.inject({ method: 'POST', url: '/finish', payload: httpFinish(p) })
        assert.equal(retry.statusCode, 200, retry.body)
        assert.equal(items.getPlayerItemSync(p.id, 10000145), 5)
        assert.equal(characters.getPlayerCharacterSync(p.id, 111001).exp, exp)
        const oldFinishBody = httpFinish(p)
        const lostPayload = getDb().prepare(`DELETE FROM player_operation_receipts
            WHERE player_id = ? AND operation = 'quest_finish.single' AND request_key = ?`).run(p.id, oldFinishBody.play_id)
        assert.equal(lostPayload.changes, 1)
        p.playId += '-new-run'
        const nextStart = await app.inject({ method: 'POST', url: '/start', payload: httpStart(p) })
        assert.equal(nextStart.statusCode, 200, nextStart.body)
        const staminaAfterStart = players.getPlayerSync(p.id).stamina
        const newActive = active.getPlayerActiveQuestSync(p.id)
        const newMemory = structuredClone(load('routes/api/singleBattleQuest').activeQuests[p.id])
        const beforeMissingPayload = businessDatabaseDigest(getDb())
        const missingPayloadRetry = await app.inject({ method: 'POST', url: '/finish', payload: oldFinishBody })
        assert.equal(missingPayloadRetry.statusCode, 400, 'a new ledger without payload must not fall back to the dedicated receipt')
        assert.equal(businessDatabaseDigest(getDb()), beforeMissingPayload)
        assert.deepEqual(active.getPlayerActiveQuestSync(p.id), newActive)
        assert.deepEqual(load('routes/api/singleBattleQuest').activeQuests[p.id], newMemory)
        // Upgrade compatibility is a different state: a pre-upgrade completed
        // run never had the generic permanent ledger or its retention queue.
        const removedGuard = getDb().prepare(`DELETE FROM battle_settlement_ledger
            WHERE player_id = ? AND play_id = ? AND mode = 'single'`).run(p.id, oldFinishBody.play_id)
        assert.equal(removedGuard.changes, 1, 'fixture must remove only the completed old play guard')
        assert.equal(getDb().prepare(`SELECT COUNT(*) n FROM battle_receipt_payload_queue
            WHERE player_id = ? AND play_id = ?`).get(p.id, oldFinishBody.play_id).n, 0, 'queue row must cascade with its fixture ledger')
        const dedicated = getDb().prepare(`SELECT status, response_json FROM five_boss_solo_runs
            WHERE player_id = ? AND play_id = ?`).get(p.id, oldFinishBody.play_id)
        assert.equal(dedicated.status, 'settled')
        assert.ok(dedicated.response_json, 'legacy fixture keeps the actual dedicated success response')
        const beforeLegacyReplay = businessDatabaseDigest(getDb())
        const oldRetry = await app.inject({ method: 'POST', url: '/finish', payload: oldFinishBody })
        assert.equal(oldRetry.statusCode, 200, oldRetry.body)
        assert.deepEqual(oldRetry.json(), finish.json())
        assert.equal(businessDatabaseDigest(getDb()), beforeLegacyReplay)
        assert.equal(load('data/domains/quest_active').getPlayerActiveQuestSync(p.id).playId, p.playId)
        assert.equal(load('routes/api/singleBattleQuest').activeQuests[p.id].playId, p.playId)
        assert.equal(players.getPlayerSync(p.id).stamina, staminaAfterStart)
        assert.equal(items.getPlayerItemSync(p.id, 10000145), 5)
        assert.equal(characters.getPlayerCharacterSync(p.id, 111001).exp, exp)
    } finally { await app.close() }
})

test('solo five-boss charges one ticket per run and keeps the ticket gate', async () => {
    const p = player(2)
    players.updatePlayerSync({
        id: p.id,
        stamina: 105,
        staminaHealTime: new Date(),
        rankPoint: 999_999_999,
    })
    const app = await httpApp(p, load('routes/api/singleBattleQuest').default)
    try {
        for (let round = 0; round < 2; round++) {
            if (round > 0) p.playId += '-next'
            const expectedStamina = 105 - 35 * (round + 1)
            const expectedTickets = 2 - (round + 1)
            const started = await app.inject({ method: 'POST', url: '/start', payload: httpStart(p) })
            assert.equal(started.statusCode, 200, started.body)
            assert.equal(started.json().data.user_info.stamina, expectedStamina)
            assert.equal(items.getPlayerItemSync(p.id, mode.ticketItemId), expectedTickets)
            const retry = await app.inject({ method: 'POST', url: '/start', payload: httpStart(p) })
            assert.equal(retry.statusCode, 200, retry.body)
            assert.equal(players.getPlayerSync(p.id).stamina, expectedStamina)
            assert.equal(items.getPlayerItemSync(p.id, mode.ticketItemId), expectedTickets)
            const finished = await app.inject({ method: 'POST', url: '/finish', payload: httpFinish(p) })
            assert.equal(finished.statusCode, 200, finished.body)
            assert.equal(active.getPlayerActiveQuestSync(p.id), null)
        }
        const denied = await app.inject({ method: 'POST', url: '/start',
            payload: { ...httpStart(p), play_id: p.playId + '-no-ticket' } })
        assert.equal(denied.statusCode, 200, denied.body)
        assert.equal(denied.json().data_headers.result_code, 4050)
        assert.equal(players.getPlayerSync(p.id).stamina, 35)
        assert.equal(players.getPlayerSync(p.id).totalStaminaUsed, 70)
        assert.equal(items.getPlayerItemSync(p.id, mode.ticketItemId), 0)
        assert.equal(active.getPlayerActiveQuestSync(p.id), null)
    } finally { await app.close() }
})

test('unreviewed five-boss ticket product rejects review and purchase without consuming existing tickets or costs', async () => {
    const p = player(3), id = 990099002, key = `boss_coin_shop:${id}`
    const operations = load('lib/content-operations'), store = operations.contentOperations()
    const state = store.state(key), revision = store.revision()
    items.setPlayerItemSync(p.id, 10000145, 120)
    const snapshot = () => load('data/snapshots/player-snapshot').createPlayerSaveSnapshotV2Sync(p.id).data.tables
    const before = snapshot()
    assert.equal(store.runtimeDefinitions.get(key)?.matchesCatalog, false)
    const action = { enabled: true, endsAtMs: null, readiness: 'verified', evidence: 'Unreviewed product must not acquire approval from this fixture' }
    assert.throws(() => store.update(key, { expectedRevision: revision, catalogDigest: store.digest,
        reason: 'Verify the existing unreviewed ticket-product boundary',
        actionOverrides: { visible: action, exchange: action } }, Date.now()), /定义|过时/)
    assert.equal(store.revision(), revision)
    assert.deepEqual(store.state(key), state)
    const app = await httpApp(p, async app => app.register(load('routes/api/shop').default, { prefix: '/shop' }))
    try {
        const denied = await app.inject({ method: 'POST', url: '/shop/buy', payload: {
            viewer_id: p.viewerId, api_count: 1, shop_type: 7, shop_item_id: id, number: 1 } })
        assert.equal(denied.statusCode, 400, denied.body)
        assert.match(denied.json().message, /not currently available/)
        assert.equal(items.getPlayerItemSync(p.id, mode.ticketItemId), 3)
        assert.equal(items.getPlayerItemSync(p.id, 10000145), 120)
        assert.deepEqual(snapshot(), before, 'failed review and purchase preserve the complete existing player save')
    } finally { await app.close() }
})

test('reviewed five-boss weapon purchases enforce both materials, five bodies and duplicate-only awakening', async () => {
    const p = player(0)
    const store = load('lib/content-operations').contentOperations()
    const action = { enabled: true, endsAtMs: null, readiness: 'verified', evidence: 'Isolated existing five-boss shop cost, stock and equipment fixture' }
    for (const id of [990099001]) {
        const key = `boss_coin_shop:${id}`
        assert.equal(store.runtimeDefinitions.get(key)?.matchesCatalog, true, `${key} requires a matching actual runtime definition`)
        store.update(key, { expectedRevision: store.revision(), catalogDigest: store.digest,
            reason: 'Explicit reviewed existing five-boss shop fixture',
            actionOverrides: { visible: action, exchange: action } }, Date.now())
        assert.equal(load('lib/content-economy-operations').shopContentDecision(7, id, 'exchange'), true)
    }
    const app = await httpApp(p, async app => {
        await app.register(load('routes/api/shop').default, { prefix: '/shop' })
        await app.register(load('routes/api/equipment').default, { prefix: '/equipment' })
    })
    const buy = (id, number = 1) => app.inject({ method: 'POST', url: '/shop/buy', payload: {
        viewer_id: p.viewerId, api_count: 1, shop_type: 7, shop_item_id: id, number } })
    const equipment = load('data/domains/equipment')
    try {
        const snapshot = () => load('data/snapshots/player-snapshot').createPlayerSaveSnapshotV2Sync(p.id).data.tables
        items.setPlayerItemSync(p.id, 10000144, 7)
        items.setPlayerItemSync(p.id, 10000145, 110)
        let before = snapshot()
        assert.equal((await buy(990099001)).statusCode, 400)
        assert.deepEqual(snapshot(), before, 'insufficient first material cannot consume the second material')
        items.setPlayerItemSync(p.id, 10000144, 48)
        items.setPlayerItemSync(p.id, 10000145, 19)
        before = snapshot()
        assert.equal((await buy(990099001)).statusCode, 400)
        assert.deepEqual(snapshot(), before, 'insufficient second material cannot consume the first material')
        items.setPlayerItemSync(p.id, 10000145, 110)
        for (let count = 1; count <= 5; count++) {
            const weapon = await buy(990099001)
            assert.equal(weapon.statusCode, 200, weapon.body)
            assert.equal(items.getPlayerItemSync(p.id, 10000144), 48 - 8 * count)
            assert.equal(items.getPlayerItemSync(p.id, 10000145), 110 - 20 * count)
            assert.equal(equipment.getPlayerEquipmentSync(p.id, 5900101).stack, count - 1)
        }
        before = snapshot()
        const extra = await buy(990099001)
        assert.equal(extra.statusCode, 400)
        assert.match(extra.body, /purchase limit/)
        assert.equal(items.getPlayerItemSync(p.id, 10000144), 8)
        assert.deepEqual(snapshot(), before, 'sixth purchase cannot change the complete player save')
        const sales = await app.inject({ method: 'POST', url: '/shop/get_sales_list', payload: {
            viewer_id: p.viewerId, shop_types: [], boss_coin_shop_category_ids: [99],
            equipment_enhancement_shop_category_ids: [], browse_treasure_flag: false, event_list: [] } })
        assert.equal(sales.statusCode, 200, sales.body)
        const weaponSale = sales.json().data.sales_list.find(row => row.shop_item_id === 990099001)
        assert.equal(weaponSale.stock_quantity, 0)
        const craftItem = load('lib/assets').getConfigSync().craft_point_item_id || 100000
        items.setPlayerItemSync(p.id, craftItem, 1000)
        items.setPlayerItemSync(p.id, 100004, 4)
        const identities = load('lib/gameplay-request-identity')
        identities.initializeGameplayRequestIdentitySchemaSync(getDb())
        const loginToken = getDb().transaction(() => identities.issueGameplayLoginTokenSync(getDb(), {
            accountId: p.accountId, viewerId: p.viewerId, udid: `five-boss-equipment-${p.viewerId}`,
            expiresAt: Date.now() + 86400000,
        }))()
        let upgradeApiCount = 0
        const upgrade = useStack => app.inject({ method: 'POST', url: '/equipment/upgrade',
            headers: { login_token: loginToken }, payload: {
            viewer_id: p.viewerId, api_count: ++upgradeApiCount, equipment_id: 5900101, use_stack: useStack,
            upgrade_count: 4, item_id: 100004 } })
        const steel = await upgrade(false)
        assert.equal(steel.statusCode, 400)
        assert.match(steel.body, /duplicate bodies/)
        assert.equal(items.getPlayerItemSync(p.id, craftItem), 1000)
        assert.equal(items.getPlayerItemSync(p.id, 100004), 4)
        const awaken = await upgrade(true)
        assert.equal(awaken.statusCode, 200, awaken.body)
        assert.equal(equipment.getPlayerEquipmentSync(p.id, 5900101).level, 5)
        assert.equal(equipment.getPlayerEquipmentSync(p.id, 5900101).stack, 0)
        assert.equal(items.getPlayerItemSync(p.id, 5900101), 4)
    } finally { await app.close() }
})

test('Deathbringer purchases advance and charge each level, including batches and all six stage boundaries', async () => {
    const p = player(0)
    const equipment = load('data/domains/equipment')
    equipment.insertPlayerEquipmentSync(p.id, 5900101, { level: 5, enhancementLevel: 0, protection: false, stack: 0 })
    const totals = { 10000145: 166, 2370100: 6, 2370097: 4, 10000147: 24 }
    for (const [id, count] of Object.entries(totals)) items.setPlayerItemSync(p.id, Number(id), count)
    const app = await httpApp(p, load('routes/api/shop').default)
    const buy = (id, number = 1) => app.inject({ method: 'POST', url: '/buy', payload: {
        viewer_id: p.viewerId, api_count: 1, shop_type: 10, shop_item_id: id, number } })
    const held = () => Object.fromEntries(Object.keys(totals).map(id => [id, items.getPlayerItemSync(p.id, Number(id))]))
    const level = () => equipment.getPlayerEquipmentSync(p.id, 5900101).enhancementLevel
    const expected = { ...totals }
    try {
        for (const id of [59001101, 59001102, 59001103, 59001104, 59001105, 59001106]) {
            assert.equal(load('lib/assets').getShopItemSync(10, id).enhancementPurchaseMode, 'per_level')
        }
        for (const [id, amount, targetLevel, cost] of [
            [59001101, 1, 1, { 10000145: 1 }],
            [59001101, 68, 69, { 10000145: 68 }],
            [59001102, 1, 70, { 10000145: 10, 2370100: 3, 2370097: 1 }],
            [59001103, 28, 98, { 10000145: 56 }],
            [59001104, 1, 99, { 10000145: 10, 10000147: 1, 2370100: 3 }],
            [59001105, 1, 100, { 10000145: 1, 10000147: 1 }],
            [59001105, 19, 119, { 10000145: 19, 10000147: 19 }],
            [59001106, 1, 120, { 10000145: 1, 2370097: 3, 10000147: 3 }],
        ]) {
            const response = await buy(id, amount)
            assert.equal(response.statusCode, 200, response.body)
            for (const [itemId, count] of Object.entries(cost)) expected[itemId] -= count
            assert.equal(level(), targetLevel)
            assert.deepEqual(held(), expected)
        }
        assert.ok(Object.values(held()).every(count => count === 0))
        assert.equal((await buy(59001106)).statusCode, 400)
        assert.equal(level(), 120)
        assert.deepEqual(held(), expected)
    } finally { await app.close() }
})

test('Deathbringer refuses insufficient materials, unawakened equipment and crossing/skipping stages without charging', async () => {
    const p = player(0)
    const equipment = load('data/domains/equipment')
    equipment.insertPlayerEquipmentSync(p.id, 5900101, { level: 4, enhancementLevel: 0, protection: false, stack: 0 })
    items.setPlayerItemSync(p.id, 10000145, 1)
    const app = await httpApp(p, load('routes/api/shop').default)
    const buy = (id, number = 1) => app.inject({ method: 'POST', url: '/buy', payload: {
        viewer_id: p.viewerId, api_count: 1, shop_type: 10, shop_item_id: id, number } })
    try {
        assert.equal((await buy(59001101)).statusCode, 400)
        equipment.updatePlayerEquipmentSync(p.id, 5900101, { level: 5 })
        for (const [id, amount] of [[59001101, 2], [59001101, 70], [59001102, 1]]) {
            assert.equal((await buy(id, amount)).statusCode, 400)
            assert.equal(equipment.getPlayerEquipmentSync(p.id, 5900101).enhancementLevel, 0)
            assert.equal(items.getPlayerItemSync(p.id, 10000145), 1)
        }
        equipment.updatePlayerEquipmentSync(p.id, 5900101, { enhancementLevel: 69 })
        items.setPlayerItemSync(p.id, 10000145, 10)
        items.setPlayerItemSync(p.id, 2370100, 3)
        // Missing the third material must not partially debit the first two.
        assert.equal((await buy(59001102)).statusCode, 400)
        assert.equal(equipment.getPlayerEquipmentSync(p.id, 5900101).enhancementLevel, 69)
        assert.equal(items.getPlayerItemSync(p.id, 10000145), 10)
        assert.equal(items.getPlayerItemSync(p.id, 2370100), 3)
    } finally { await app.close() }
})

function funded(p, free = 100, paid = 20) {
    players.updatePlayerSync({ id: p.id, freeVmoney: free, vmoney: paid })
}

test('effective Abyss final rewards follow the normal 30-floor pools without legacy five-star materials', () => {
    const assets = load('lib/assets')
    const cfg = assets.getRogueEventConfig(700099)
    assert.deepEqual(cfg.folder_clear_chance, [{ type: 0, id: 999014, count: 1, chance: 0.07 }])
    const random = Math.random
    try {
        for (const [roll, tickets] of [[0, 1], [0.999999, 0]]) {
            Math.random = () => roll
            const result = assets.getRushEventFolderClearRewards(700099, 1)
            const count = id => result.filter(x => x.id === id).reduce((n, x) => n + x.count, 0)
            assert.equal(count(10000143), tickets)
            assert.equal(count(11003), 0)
            assert.equal(count(13001), 0)
            for (const [id, n] of [[99, 800], [2370099, 70], [10002, 2], [12001, 2]]) assert.equal(count(id), n)
            assert.equal(count(999014), roll === 0 ? 1 : 0, 'base/extension must not duplicate the ten-pull ticket')
        }
    } finally { Math.random = random }
})

function seedRewardFinish(p, category, questId, host = true) {
    if (category === 24) {
        const eventId = 700099
        const rush = load('data/domains/rushEvent')
        const abyssRevision = load('lib/abyss-time-revision').getAbyssTimeRevision(eventId)
        if (!rush.getPlayerRushEventSync(p.id, eventId)) {
            rush.insertPlayerRushEventSync(p.id, {
                ...rush.getDefaultPlayerRushEventSync(eventId),
                towerRevision: abyssRevision,
            })
        }
        const round = questId % 1000
        const party = {
            characterIds: [111001, null, null],
            unisonCharacterIds: [null, null, null],
            equipmentIds: [null, null, null],
            abilitySoulIds: [null, null, null],
            evolutionImgLevels: [null, null, null],
            unisonEvolutionImgLevels: [null, null, null],
            battleType: 0,
        }
        for (let previous = 1; previous < round; previous++) {
            const row = getDb().prepare(`SELECT 1 FROM players_rush_events_played_parties
                WHERE player_id=? AND event_id=? AND round=? AND battle_type=0`)
                .get(p.id, eventId, eventId * 1000 + previous)
            if (!row) rush.insertPlayerRushEventPlayedPartySync(p.id, eventId, {
                ...party, round: eventId * 1000 + previous,
            })
        }
    }
    const quest = { playId: p.playId, category, questId, useBoostPoint: false,
        useBossBoostPoint: false, isAutoStartMode: true, isMulti: category === 7,
        isMultiHost: host, clockVersion: 1, continueCount: 0, startedAtMs: Date.now(), matePlayerIds: [], mateComIds: [],
        questTimeRevision: category === 24 ? load('lib/abyss-time-revision').getAbyssTimeRevision() : null }
    load('routes/api/singleBattleQuest').activeQuests[p.id] = quest
    // A registered solo battle has both memory and a durable active row. Seed
    // the real contract so the settlement can consume that exact play once.
    if (category === 24) load('data/domains/quest_active').insertPlayerActiveQuestSync(p.id, {
        ...quest, playerId: p.id, isMultiHost: false, roomNumber: null,
        entryItemId: null, eventId: null, partySlot: null,
    })
    if (category === 7) load('multi/settlement-snapshot').registerMultiSettlementSnapshot({
        battleInstanceId: p.playId, playerId: p.id, viewerId: p.viewerId, playId: p.playId,
        roomNumber: 'ticket-test', roomGeneration: 1, activeQuest: quest, participants: [],
        expectedRealViewerIds: [], isHost: host, isRescueGuest: !host,
        isRescueFragmentEligible: false, isNewbieRescueGuest: false })
    const body = { ...httpFinish(p), category, quest_id: questId }
    body.statistics.party = { characters: [{ id: 111001 }, { id: null }, { id: null }],
        unison_characters: [{ id: null }, { id: null }, { id: null }],
        equipments: [{ id: null }, { id: null }, { id: null }], ability_soul_ids: [null, null, null] }
    return body
}

test('Abyss HTTP settlement awards tickets only on successful floor 30, once per finish and again next run', async () => {
    const p = player(0)
    const app = await httpApp(p, load('routes/api/singleBattleQuest').default)
    const headers = { res_ver: require('../assets/asset-patch/manifest.json').cdn_version }
    const random = Math.random
    Math.random = () => 0
    try {
        for (const [round, accomplished, shouldGrant] of [[29, true, false], [30, false, false], [30, true, true], [30, true, true]]) {
            p.playId += '-next'
            const body = { ...seedRewardFinish(p, 24, 700099000 + round), is_accomplished: accomplished }
            const old = items.getPlayerItemSync(p.id, 10000143)
            const response = await app.inject({ method: 'POST', url: '/finish', headers, payload: body })
            assert.equal(response.statusCode, 200, response.body)
            const now = items.getPlayerItemSync(p.id, 10000143)
            assert.ok(shouldGrant ? [1, 2].includes(now - old) : now === old,
                JSON.stringify({ round, accomplished, old, now, response: response.json() }))
            if (shouldGrant) {
                const reward = response.json().data.rush_event.rush_battle_reward_list
                assert.equal(reward.find(x => x.kind_id === 10000143).number, now - old)
                assert.equal(reward.some(x => [11003, 13001].includes(x.kind_id)), false)
            }
            const retry = await app.inject({ method: 'POST', url: '/finish', headers, payload: body })
            assert.equal(retry.statusCode, 200, retry.body)
            assert.equal(items.getPlayerItemSync(p.id, 10000143), now)
        }
    } finally { Math.random = random; await app.close() }
})

test('Fantasy real multiplayer finish grants one ticket for full host clear; not for 5/10, rescue, failure or retry', async () => {
    const p = player(0)
    const app = await httpApp(p, load('multi/http/battle').registerBattleRoutes)
    try {
        // A fresh frozen play without a proven real-clock basis must not settle.
        const digest = () => businessDatabaseDigest(getDb())
        const receipts = () => getDb().prepare(
            "SELECT * FROM player_operation_receipts WHERE player_id=? ORDER BY operation, request_key"
        ).all(p.id)
        for (const clockVersion of [undefined, 0]) {
            p.playId += '-unproven-' + String(clockVersion)
            const body = { ...seedRewardFinish(p, 7, 300098003, true), is_accomplished: true }
            const frozen = load('multi/settlement-snapshot').getMultiSettlementSnapshot(p.id, p.playId)
            assert.equal(frozen.activeQuest.clockVersion, 1)
            for (const quest of [load('routes/api/singleBattleQuest').activeQuests[p.id], frozen.activeQuest]) {
                if (clockVersion === undefined) delete quest.clockVersion
                else quest.clockVersion = clockVersion
            }
            assert.equal(active.getPlayerActiveQuestSync(p.id), null, 'no durable current-clock play may mask the negative fixture')
            const before = digest(p.id, getDb()), beforeReceipts = receipts()
            assert.equal(beforeReceipts.length, 0, 'each rejected play must be fresh, without a replay receipt')
            const tickets = items.getPlayerItemSync(p.id, 10000143)
            const rejected = await app.inject({ method: 'POST', url: '/finish', payload: body })
            assert.equal(rejected.statusCode, 400, rejected.body)
            assert.equal(rejected.json().message, 'No unsettled multiplayer play.')
            assert.equal(digest(p.id, getDb()), before, 'unproven clock must preserve all business state')
            assert.equal(items.getPlayerItemSync(p.id, 10000143), tickets)
            assert.deepEqual(receipts(), beforeReceipts, 'unproven clock must not create a finish receipt')
        }
        for (const [questId, host, accomplished, expected] of [
            [300098001, true, true, 0], [300098002, true, true, 0],
            [300098003, false, true, 0], [300098003, true, false, 0],
            [300098003, true, true, 1], [300098003, true, true, 1],
        ]) {
            p.playId += '-next'
            const body = { ...seedRewardFinish(p, 7, questId, host), is_accomplished: accomplished }
            const old = items.getPlayerItemSync(p.id, 10000143)
            const response = await app.inject({ method: 'POST', url: '/finish', payload: body })
            assert.equal(response.statusCode, 200, response.body)
            assert.equal(items.getPlayerItemSync(p.id, 10000143), old + expected)
            if (expected) {
                const data = response.json().data
                assert.equal(data.rush_event, undefined, 'multiplayer must not enter the single-player Rush result process')
                assert.ok(data.drop_additional_reward_ids.some(x => x.group_id === 237009700 && x.index === 3 && x.number === 1))
                assert.equal(load('lib/mode15').getExpectedMode15StageSync(p.id), 1)
            }
            const retry = await app.inject({ method: 'POST', url: '/finish', payload: body })
            assert.equal(retry.statusCode, 200, retry.body)
            assert.equal(items.getPlayerItemSync(p.id, 10000143), old + expected)
        }
    } finally { await app.close() }
})

test('Fantasy multiplayer abort preserves its boundary stage without granting rewards', async () => {
    const p = player(0)
    const operations = load('lib/content-operations'), store = operations.contentOperations()
    const member = '7:300098002', key = operations.contentCatalog.questMap[member]
    assert.equal(key, 'advent_event:300098')
    const action = { enabled: true, endsAtMs: null, readiness: 'verified', evidence: 'Isolated native Fantasy stage-10 abort fixture' }
    store.update(key, { expectedRevision: store.revision(), catalogDigest: store.digest,
        reason: 'Explicit reviewed native Fantasy owner and exact abort stage',
        actionOverrides: { visible: action, enter: { ...action, questKeys: [member] } } }, Date.now())
    assert.equal(operations.contentQuestDecision(7, 300098002), true)
    const rush = load('data/domains/rushEvent')
    const mode15 = load('lib/mode15')
    const playedParty = {
        characterIds: [111001, null, null],
        unisonCharacterIds: [null, null, null],
        equipmentIds: [null, null, null],
        abilitySoulIds: [null, null, null],
        evolutionImgLevels: [null, null, null],
        unisonEvolutionImgLevels: [null, null, null],
        battleType: 0,
    }
    for (let stage = 1; stage < 10; stage++) {
        rush.insertPlayerRushEventPlayedPartySync(p.id, 700098, {
            ...playedParty,
            round: 700098000 + stage,
        })
    }
    assert.equal(mode15.getExpectedMode15StageSync(p.id), 10)
    const room = createRoom(p.viewerId, p.id, 1, 7, 300098002, 0, 111001)
    const manager = load('multi/room/manager')
    const app = await httpApp(p, load('multi/http/battle').registerBattleRoutes)
    try {
        const started = await app.inject({
            method: 'POST',
            url: '/start',
            payload: { ...httpStart(p, room), category: 7, quest_id: 300098002 },
        })
        assert.equal(started.statusCode, 200, started.body)
        assert.equal(active.getPlayerActiveQuestSync(p.id).playId, p.playId)
        const tokenBefore = items.getPlayerItemSync(p.id, 2370098) ?? 0

        const aborted = await app.inject({
            method: 'POST',
            url: '/abort',
            payload: {
                viewer_id: p.viewerId,
                play_id: p.playId,
                category: 7,
                quest_id: 300098002,
                room_number: room.room_number,
                api_count: 2,
            },
        })
        assert.equal(aborted.statusCode, 200, aborted.body)
        assert.equal(active.getPlayerActiveQuestSync(p.id), null)
        assert.equal(mode15.getExpectedMode15StageSync(p.id), 10)
        assert.equal(mode15.canStartMode15QuestSync(p.id, 7, 300098002).allowed, true)
        assert.equal(mode15.canStartMode15QuestSync(p.id, 7, 300098001).allowed, false)
        assert.equal(items.getPlayerItemSync(p.id, 2370098) ?? 0, tokenBefore)
        assert.equal(getDb().prepare(`SELECT COUNT(*) AS count
            FROM players_quest_progress
            WHERE player_id = ? AND section IN (7, 8) AND quest_id = 300098002`)
            .get(p.id).count, 0)
    } finally {
        manager.disbandRoom(room.room_number)
        await app.close()
    }
})

function continuePayload(p, apiCount = 10) {
    return { viewer_id: p.viewerId, play_id: p.playId, quest_id: mode.visibleQuestId, category: mode.category,
        api_count: apiCount, payment_type: 1, statistics: { continue_count: 0, playthrough_frame: 1800 } }
}
function wallet(p) { const row = players.getPlayerSync(p.id); return [row.freeVmoney, row.vmoney] }

test('solo continue costs 50 once for the whole run; retry, new start and recovery do not reset it', async () => {
    const p = player(); funded(p, 30, 100)
    const app = await httpApp(p, load('routes/api/singleBattleQuest').default)
    const send = payload => app.inject({ method: 'POST', url: '/play_continue', payload })
    try {
        assert.equal((await app.inject({ method: 'POST', url: '/start', payload: httpStart(p) })).statusCode, 200)
        const payload = continuePayload(p), first = await send(payload)
        assert.equal(first.statusCode, 200, first.body)
        assert.deepEqual(first.json().data.user_info, { free_vmoney: 0, vmoney: 80 })
        assert.equal(active.getPlayerActiveQuestSync(p.id).continueCount, 1)
        assert.equal((await send({ ...payload, retry_count: 1 })).statusCode, 200)
        assert.deepEqual(wallet(p), [0, 80])
        assert.equal((await app.inject({ method: 'POST', url: '/start', payload: httpStart(p) })).statusCode, 200)
        delete load('routes/api/singleBattleQuest').activeQuests[p.id]
        assert.equal((await send(payload)).statusCode, 200)
        assert.equal(load('routes/api/singleBattleQuest').activeQuests[p.id].continueCount, 1)
        // A legacy client can resend after a scene transition with a changed
        // api_count/statistics pair. The existing receipt makes this a
        // no-charge recovery acknowledgement instead of an H400 response.
        assert.equal((await send(continuePayload(p, 11))).statusCode, 200)
        assert.equal((await send({ ...payload, statistics: { continue_count: 1, playthrough_frame: 9000 } })).statusCode, 200)
        assert.equal(active.getPlayerActiveQuestSync(p.id).continueCount, 1)
        assert.equal((await send({ ...payload, quest_id: 1099003 })).statusCode, 400)
        assert.deepEqual(wallet(p), [0, 80])
        solo.abortFiveBossSoloSync(p.id, p.playId)
        // After the run is gone the legacy client would render a 400 as a
        // fatal H400; the stale continue is acknowledged without charging.
        assert.equal((await send(payload)).statusCode, 200)
        assert.deepEqual(wallet(p), [0, 80])
        p.playId += '-next-run'
        assert.equal((await app.inject({ method: 'POST', url: '/start', payload: httpStart(p) })).statusCode, 200)
        assert.equal((await send(continuePayload(p))).statusCode, 200)
        assert.deepEqual(wallet(p), [0, 30])
    } finally { await app.close() }
})

test('multiplayer each member gets one paid continue across level_next, start replay and reconnect', async () => {
    const host = player(), guest = player(0), room = run([host, guest]); funded(host); funded(guest)
    const app = await httpApp(host, load('multi/http/battle').registerBattleRoutes)
    const guestApp = await httpApp(guest, load('multi/http/battle').registerBattleRoutes)
    try {
        start(host, room); start(guest, room)
        const payload = continuePayload(host)
        const send = (body, a = app) => a.inject({ method: 'POST', url: '/play_continue', payload: body })
        const first = await send(payload)
        assert.equal(first.statusCode, 200, first.body)
        assert.deepEqual(wallet(host), [50, 20]); assert.deepEqual(wallet(guest), [100, 20])
        assert.equal(active.getPlayerActiveQuestSync(guest.id).continueCount, 0)
        const replayedStart = await app.inject({ method: 'POST', url: '/start', payload: httpStart(host, room) })
        assert.equal(replayedStart.statusCode, 200, replayedStart.body)
        assert.equal(active.getPlayerActiveQuestSync(host.id).continueCount, 1)
        ledger.recordMemberBattleSignalSync({ runId: room.five_boss_runtime.runId, playerId: host.id,
            roomNumber: room.room_number, signal: 'level_next' })
        delete load('routes/api/singleBattleQuest').activeQuests[host.id]
        assert.equal((await send(payload)).statusCode, 200)
        assert.equal(load('routes/api/singleBattleQuest').activeQuests[host.id].continueCount, 1)
        // A fresh Node process has no room/memory state and must still see the same spent chance.
        const childCode = `
            const assert = require('node:assert/strict');
            const { continueFiveBossSync } = require(${JSON.stringify(path.join(output, 'multi/five-boss/continue-runtime'))});
            const request = ${JSON.stringify({ playerId: host.id, isMulti: true, category: mode.category,
                questId: mode.visibleQuestId, playId: host.playId, apiCount: 10, statistics: payload.statistics })};
            assert.equal(continueFiveBossSync(request).continue_count, 1);
            assert.equal(continueFiveBossSync({ ...request, apiCount: 11 }).continue_count, 1);
            require(${JSON.stringify(path.join(output, 'data/db'))}).getDb().close();
            process.stdout.write('fresh-process-continue-passed');
            process.exit(0);`
        const childResult = require('node:child_process').execFileSync(process.execPath, ['-e', childCode], {
            env: { ...process.env, DATA_DIR: dataDir }, timeout: 15000, encoding: 'utf8' })
        assert.match(childResult, /fresh-process-continue-passed/)
        assert.equal((await send(continuePayload(host, 11))).statusCode, 200)
        assert.equal((await send(continuePayload(guest), guestApp)).statusCode, 200)
        assert.deepEqual(wallet(host), [50, 20]); assert.deepEqual(wallet(guest), [50, 20])
        assert.equal(active.getPlayerActiveQuestSync(guest.id).continueCount, 1)
        assert.equal((await send(continuePayload(guest, 12), guestApp)).statusCode, 200)
        ledger.recordMemberBattleSignalSync({ runId: room.five_boss_runtime.runId, playerId: host.id,
            roomNumber: room.room_number, signal: 'finalize' })
        // The finalized run is stale for this play id; acknowledge so the
        // client does not show a fatal H400, and never charge again.
        assert.equal((await send(payload)).statusCode, 200)
        assert.deepEqual(wallet(host), [50, 20])
        assert.deepEqual(wallet(guest), [50, 20])
    } finally { await app.close(); await guestApp.close() }
})

test('host abort mid-battle keeps the five-boss run alive for the remaining members', async () => {
    const host = player(), guest = player(0), room = run([host, guest])
    funded(host); funded(guest)
    start(host, room); start(guest, room)
    const app = await httpApp(host, load('multi/http/battle').registerBattleRoutes)
    const guestApp = await httpApp(guest, load('multi/http/battle').registerBattleRoutes)
    try {
        const ticketBefore = items.getPlayerItemSync(host.id, mode.ticketItemId)
        // The host retires mid-run; the run must survive for the other member.
        const aborted = await app.inject({ method: 'POST', url: '/abort', payload: {
            viewer_id: host.viewerId, play_id: host.playId, quest_id: mode.visibleQuestId,
            category: mode.category, api_count: 3 } })
        assert.equal(aborted.statusCode, 200, aborted.body)
        assert.equal(active.getPlayerActiveQuestSync(host.id), null)
        // The ticket was charged at battle start and is never refunded.
        assert.equal(items.getPlayerItemSync(host.id, mode.ticketItemId), ticketBefore)
        const runAfterHostLeave = ledger.getFiveBossRunByClientSync({ playerId: guest.id, clientPlayId: guest.playId })
        assert.equal(runAfterHostLeave.status, 'active')
        assert.equal(load('multi/room/manager').getRoom(room.room_number), room)

        // The remaining member continues and finishes with a normal, paid
        // settle even though the host is gone.
        const continued = await guestApp.inject({ method: 'POST', url: '/play_continue', payload: continuePayload(guest, 20) })
        assert.equal(continued.statusCode, 200, continued.body)
        assert.deepEqual(wallet(guest), [50, 20])
        proof(guest, room)
        const finished = await guestApp.inject({ method: 'POST', url: '/finish', payload: httpFinish(guest) })
        assert.equal(finished.statusCode, 200, finished.body)
        assert.equal(finished.json().data.clear_rank, 5)
        assert.equal(ledger.getFiveBossRunByClientSync({ playerId: guest.id, clientPlayId: guest.playId }).status, 'settled')
        assert.equal(getDb().prepare(`SELECT 1 FROM five_boss_gauntlet_receipts WHERE player_id = ?`).get(guest.id) !== undefined, true)
    } finally {
        load('multi/room/manager').disbandRoom(room.room_number)
        await app.close(); await guestApp.close()
    }
})

test('stale five-boss continue and finish after a member left acknowledge instead of H400', async () => {
    const host = player(), guest = player(0), room = run([host, guest])
    funded(host); funded(guest)
    start(host, room); start(guest, room)
    proof(host, room); proof(guest, room)
    const app = await httpApp(host, load('multi/http/battle').registerBattleRoutes)
    const guestApp = await httpApp(guest, load('multi/http/battle').registerBattleRoutes)
    try {
        // The guest retires; a later recovery retry from the same client can
        // no longer continue or settle that member.
        const aborted = await guestApp.inject({ method: 'POST', url: '/abort', payload: {
            viewer_id: guest.viewerId, play_id: guest.playId, quest_id: mode.visibleQuestId,
            category: mode.category, api_count: 3 } })
        assert.equal(aborted.statusCode, 200, aborted.body)
        assert.equal(active.getPlayerActiveQuestSync(guest.id), null)

        // Recovery continue after the abort: answered, never charged.
        const lateContinue = await guestApp.inject({ method: 'POST', url: '/play_continue', payload: continuePayload(guest, 30) })
        assert.equal(lateContinue.statusCode, 200, lateContinue.body)
        assert.equal(lateContinue.json().data.continue_count, mode.maxContinueCount)
        assert.deepEqual(wallet(guest), [100, 20])

        // The local battle then reports a clear for the dead run: the client
        // must still receive a parseable, reward-less result instead of 400.
        const lateFinish = await guestApp.inject({ method: 'POST', url: '/finish', payload: httpFinish(guest) })
        assert.equal(lateFinish.statusCode, 200, lateFinish.body)
        assert.equal(lateFinish.json().data.clear_rank, 0)
        assert.equal(items.getPlayerItemSync(guest.id, 10000145), null)
        assert.deepEqual(wallet(guest), [100, 20])

        // Aborting the already-gone guest run is a terminal acknowledgement too.
        const lateAbort = await guestApp.inject({ method: 'POST', url: '/abort', payload: {
            viewer_id: guest.viewerId, play_id: guest.playId, quest_id: mode.visibleQuestId,
            category: mode.category, api_count: 31 } })
        assert.equal(lateAbort.statusCode, 200, lateAbort.body)
        assert.equal(active.getPlayerActiveQuestSync(guest.id), null)
    } finally { await app.close(); await guestApp.close() }
})

test('continue rejects wrong identity and mode, insufficient gems, and atomically rolls back failed persistence', async () => {
    const p = player(), room = run([p]); funded(p, 20, 29); start(p, room)
    const multiApp = await httpApp(p, load('multi/http/battle').registerBattleRoutes)
    const soloApp = await httpApp(p, load('routes/api/singleBattleQuest').default, true)
    const send = (payload, a = multiApp) => a.inject({ method: 'POST', url: '/play_continue', payload })
    try {
        const payload = continuePayload(p)
        assert.equal((await send(payload)).statusCode, 400)
        assert.equal(active.getPlayerActiveQuestSync(p.id).continueCount, 0)
        assert.deepEqual(wallet(p), [20, 29])
        funded(p)
        // A stale play id is acknowledged without state changes (the client
        // has no business-error path); forged quest/category and malformed
        // api_count stay hard rejections.
        assert.equal((await send({ ...payload, play_id: 'wrong-play' })).statusCode, 200)
        for (const change of [{ quest_id: 1000101 }, { category: 1 }, { api_count: null }]) {
            assert.equal((await send({ ...payload, ...change })).statusCode, 400)
        }
        assert.equal((await send(payload, soloApp)).statusCode, 200)
        assert.deepEqual(wallet(p), [100, 20])
        getDb().exec(`CREATE TEMP TRIGGER fail_continue_receipt BEFORE INSERT ON five_boss_continue_receipts
            BEGIN SELECT RAISE(ABORT, 'injected persistence failure'); END`)
        try { assert.equal((await send(payload)).statusCode, 500) }
        finally { getDb().exec('DROP TRIGGER fail_continue_receipt') }
        assert.equal(active.getPlayerActiveQuestSync(p.id).continueCount, 0)
        assert.deepEqual(wallet(p), [100, 20])
        const results = await Promise.all([send(payload), send({ ...payload, retry_count: 1 })])
        for (const result of results) assert.equal(result.statusCode, 200, result.body)
        assert.deepEqual(wallet(p), [50, 20])
        assert.equal(active.getPlayerActiveQuestSync(p.id).continueCount, 1)
    } finally { await multiApp.close(); await soloApp.close() }
})

test('pre-update used continues are respected without a new receipt; ordinary multiplayer behavior is preserved', async () => {
    const p = player(), room = run([p]); funded(p); start(p, room)
    active.updatePlayerActiveQuestContinueCountSync(p.id, 1)
    const app = await httpApp(p, load('multi/http/battle').registerBattleRoutes)
    try {
        const denied = await app.inject({ method: 'POST', url: '/play_continue', payload: continuePayload(p) })
        assert.equal(denied.statusCode, 400)
        assert.deepEqual(wallet(p), [100, 20])
        const q = { ...active.getPlayerActiveQuestSync(p.id), questId: 1000101, playId: 'ordinary', continueCount: 0 }
        active.insertPlayerActiveQuestSync(p.id, q)
        load('routes/api/singleBattleQuest').activeQuests[p.id] = q
        for (let i = 1; i <= 2; i++) {
            const result = await app.inject({ method: 'POST', url: '/play_continue', payload: {
                ...continuePayload(p, 20 + i), quest_id: 1000101, play_id: 'ordinary' } })
            assert.equal(result.statusCode, 200, result.body)
            assert.equal(active.getPlayerActiveQuestSync(p.id).continueCount, i)
        }
        assert.deepEqual(wallet(p), [100, 20])
    } finally { await app.close() }
})

after(() => {
    getDb().close()
    const resolved = path.resolve(dataDir)
    assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep))
    assert.ok(path.basename(resolved).startsWith('startpoint-five-boss-test-'))
    fs.rmSync(resolved, { recursive: true, force: true })
})
