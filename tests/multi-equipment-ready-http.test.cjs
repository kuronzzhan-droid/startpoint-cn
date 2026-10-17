const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { EventEmitter } = require('node:events')
const Fastify = require('fastify')

const parent = path.resolve(__dirname, '../tmp')
fs.mkdirSync(parent, { recursive: true })
const directory = fs.mkdtempSync(path.join(parent, 'equipment-http-'))
process.env.DATA_DIR = directory
const originalInterval = global.setInterval
const intervals = []
global.setInterval = (...args) => {
    const timer = originalInterval(...args)
    intervals.push(timer)
    return timer
}
let db, rooms, manager, lobby, coordinator, battle, partyRoutes, accounts, players, sessions, parties, active
try {
    db = require('../out/data/db').getDb()
    accounts = require('../out/data/domains/account')
    players = require('../out/data/domains/player')
    sessions = require('../out/data/domains/session')
    parties = require('../out/data/domains/party')
    active = require('../out/data/domains/quest_active')
    rooms = require('../out/multi/room/manager')
    manager = require('../out/multi/state/SessionManager').sessionManager
    lobby = require('../out/multi/tcp/lobby')
    coordinator = require('../out/multi/coordinator/embedded').embeddedMultiCoordinator
    battle = require('../out/multi/http/battle')
    partyRoutes = require('../out/routes/api/party').default
} finally {
    global.setInterval = originalInterval
}
const equipment = require('../out/multi/room/equipment-ready')
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
        appId: 'wf_cn', idpAlias: '', idpCode: 'test', idpId: `equipment-${n}`, status: 'normal',
    })
    const player = players.insertDefaultPlayerSync(account.id)
    require('../out/data/activeAccount').saveAccountDefaultPlayer(account.id, player.id)
    const viewerId = 880000000 + n
    sessions.insertSessionWithTokenSync({
        token: String(viewerId), accountId: account.id, type: 2,
        expires: new Date(Date.now() + 86400000),
    })
    return { ...player, viewerId }
}

function savedParty(soul = null) {
    return {
        category: 1, name: 'test', characterIds: [1, null, null],
        unisonCharacterIds: [null, null, null], equipmentIds: [null, null, null],
        abilitySoulIds: [soul, null, null], edited: true,
        options: { allowOtherPlayersToHealMe: true },
    }
}

async function setup(t, quest = { category: 1, questId: 9001001 }) {
    const host = makePlayer(), guest = makePlayer()
    const room = rooms.createRoom(host.viewerId, host.id, 1, quest.category, quest.questId, 0, 1)
    const clients = [host, guest].map(player => {
        const c = manager.createClient(new Socket(), player.viewerId, room.room_number, `cid-${player.id}`, player.id)
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
    await app.register(partyRoutes, { prefix: '/party' })
    await app.ready()
    const notify = async (index, data) => {
        lobby.handleMessage(clients[index].socket, [0, data])
        await coordinator.enqueueRoomCommand(room.room_number, () => {})
    }
    const start = (player = host, extra = {}) => app.inject({
        method: 'POST', url: '/multi/start', payload: {
            viewer_id: player.viewerId, category: quest.category, quest_id: quest.questId,
            party_id: 1, room_number: room.room_number, play_id: `play-${player.id}`,
            use_boost_point: false, use_boss_boost_point: false, is_auto_start_mode: false,
            mate_player_ids: [], mate_party_ids: [], ...extra,
        },
    })
    const edit = (soul, slot = 1) => app.inject({
        method: 'POST', url: '/party/edit', payload: {
            viewer_id: guest.viewerId, main_party_id: 1, party_info_list: [{
                party_category: 1, party_name: 'test', party_id: slot, party_edited: true,
                character_ids: [1, null, null], unison_character_ids: [null, null, null],
                equipment_ids: [null, null, null], ability_soul_ids: [soul, null, null],
                options: { allow_other_players_to_heal_me: true },
            }],
        },
    })
    return { host, guest, room, clients, app, notify, start, edit }
}

test('HTTP-first start cannot bypass a restricted peer or allocate a partial battle', async t => {
    const x = await setup(t)
    parties.updatePlayerPartySync(x.guest.id, 1, savedParty(100013))
    const before = players.getPlayerSync(x.host.id)
    const denied = await x.start()
    assert.equal(denied.statusCode, 200)
    assert.equal(denied.json().data_headers.result_code, 4050)
    assert.equal(x.room.lifecycle.phase, 'LOBBY')
    assert.equal(x.room.lobby_generation, 0)
    assert.equal(active.getPlayerActiveQuestSync(x.host.id), null)
    assert.equal(active.getPlayerActiveQuestSync(x.guest.id), null)
    assert.equal(players.getPlayerSync(x.host.id).stamina, before.stamina)
    assert.equal(x.clients[1].isReady, false)
    assert.ok(x.clients.every(c => c.socket.frames.every(f => ![5, 6, 10].includes(f[1][0]))))

    parties.updatePlayerPartySync(x.guest.id, 1, savedParty())
    await x.notify(1, [3, [1]])
    const accepted = await x.start()
    assert.equal(accepted.json().data.play_id, `play-${x.host.id}`)
    const generation = x.room.lobby_generation
    await x.notify(0, [6])
    assert.equal(x.room.lobby_generation, generation, 'HTTP/TCP must share one generation')
    assert.ok(x.clients.every(c => c.socket.frames.filter(f => f[1][0] === 5).length === 1))
})

test('real party save blocks current gear, ignores other SETs/retries, and repairs without removing ownership', async t => {
    const x = await setup(t)
    assert.equal((await x.edit(100013)).json().data_headers.result_code, 1)
    assert.equal(x.clients[1].isReady, false)
    const firstBlock = x.clients[1].equipmentReadyBlock
    assert.ok(firstBlock)
    assert.equal((await x.edit(100013)).json().data_headers.result_code, 1)
    assert.equal(x.clients[1].equipmentReadyBlock, firstBlock, 'identical save is not user activity')
    await x.edit(100023, 2)
    assert.equal(x.clients[1].equipmentReadyBlock, firstBlock, 'other SET does not renew idle')
    assert.equal((await x.edit(null)).json().data_headers.result_code, 1)
    assert.equal(x.clients[1].equipmentReadyBlock, undefined)
    await x.notify(1, [3, [1]])
    assert.equal(x.clients[1].isReady, true)
    assert.equal(x.clients[0].isReady, true, 'two legal members still auto-ready the host')
    assert.equal(x.room.readyCountdownPending, false)
    assert.ok(x.clients.every(c => c.socket.frames.every(f => f[1][0] !== 10)),
        'two-player manual rooms must not receive an automatic countdown')
    assert.equal(equipment.hasRestrictedEquipment(x.room, x.clients[1]), false)
})

test('frozen selections tolerate later DB edits but reject a forged new request party', async t => {
    const x = await setup(t)
    await x.notify(0, [6])
    assert.equal(x.room.lifecycle.phase, 'BATTLE')
    parties.updatePlayerPartySync(x.guest.id, 1, savedParty(100013))
    const accepted = await x.start(x.guest)
    assert.equal(accepted.json().data.play_id, `play-${x.guest.id}`)
    const forged = await x.start(x.guest, {
        client_battle_party: { equipments: [{ equipment_id: 100013 }] },
    })
    assert.equal(forged.json().data_headers.result_code, 4050)
    const switched = await x.start(x.guest, { party_id: 2 })
    assert.equal(switched.json().data_headers.result_code, 4050)
})

function prepareCompleteParty(x) {
    x.room.mates = x.clients.map(client => ({
        viewer_id: client.viewerId, player_id: client.playerId, com_id: 0,
    }))
    const saved = { ...savedParty(), characterIds: [1, 2, 3], currentBattlePower: 12_000 }
    const characters = require('../out/data/domains/character')
    for (const [index, player] of [x.host, x.guest].entries()) {
        for (const id of [2, 3]) {
            if (!characters.getPlayerCharacterSync(player.id, id)) {
                characters.insertDefaultPlayerCharacterSync(player.id, id)
            }
        }
        parties.updatePlayerPartySync(player.id, 1, saved)
        x.clients[index].yourself.party = {
            characters: [[0, { id: 1 }], [0, { id: 2 }], [0, { id: 3 }]],
            unison_characters: [[1], [1], [1]],
            equipments: [[1], [1], [1]],
            abilitySoulIds: [[1], [1], [1]],
        }
    }
}

for (const change of ['clear room snapshot map', 'advance to another generation']) {
    test(`HTTP start owns its frozen clear party while persistence awaits: ${change}`, async t => {
        const x = await setup(t, { category: 2, questId: 1001001 })
        prepareCompleteParty(x)
        const persistence = require('../out/lib/persistence-coordinator')
        const snapshots = require('../out/multi/settlement-snapshot')
        const originalTransaction = persistence.runPersistenceTransaction
        let frozen, battleGeneration
        t.mock.method(persistence, 'runPersistenceTransaction', async (meta, work) => {
            const result = await originalTransaction(meta, work)
            if (meta.operation === 'start' && meta.playerId === x.host.id) {
                assert.ok(x.room.npcPartySnapshots[x.host.viewerId])
                frozen = JSON.parse(JSON.stringify(x.room.npcPartySnapshots[x.host.viewerId]))
                battleGeneration = x.room.lobby_generation
                // Model return/new battle cleanup before HTTP resumes after
                // its durable active-quest write. Its old room copy is mutable.
                x.room.npcPartySnapshots = {}
                if (change === 'advance to another generation') {
                    x.room.lobby_generation++
                    x.room.mates = []
                    x.room.expected_real_viewer_ids = [999999]
                }
            }
            return result
        })
        const accepted = await x.start()
        assert.equal(accepted.json().data.play_id, `play-${x.host.id}`)
        const registered = snapshots.getMultiSettlementSnapshot(x.host.id, `play-${x.host.id}`)
        assert.deepEqual(registered.npcPartySnapshot, frozen)
        assert.equal(registered.roomGeneration, battleGeneration)
        assert.equal(registered.battleInstanceId,
            `${x.room.lifecycle.instanceId}:${battleGeneration}:2:1001001`)
        assert.ok(registered.participants.some(mate => mate.viewerId === x.host.viewerId))
        assert.ok(registered.participants.some(mate => mate.viewerId === x.guest.viewerId))
        assert.equal(registered.participants.some(mate => mate.viewerId === 999999), false)
    })
}

test('a fixed-party HTTP start never registers the selected SET as a clear-party snapshot', async t => {
    const x = await setup(t, { category: 2, questId: 1001001 })
    prepareCompleteParty(x)
    const assets = require('../out/lib/assets')
    const snapshots = require('../out/multi/settlement-snapshot')
    const quest = assets.getQuestFromCategorySync(2, 1001001)
    const originalQuest = assets.getQuestFromCategorySync
    // Keep a history-eligible quest and a capturable SET, changing only the
    // fixed-party declaration so this assertion cannot pass via category gating.
    t.mock.method(assets, 'getQuestFromCategorySync', (category, questId) =>
        category === 2 && questId === 1001001
            ? { ...quest, fixedParty: 23 } : originalQuest(category, questId))
    const accepted = await x.start()
    assert.equal(accepted.json().data.play_id, `play-${x.host.id}`)
    assert.ok(x.room.npcPartySnapshots[x.host.viewerId], 'the ordinary SET was otherwise capturable')
    const registered = snapshots.getMultiSettlementSnapshot(x.host.id, `play-${x.host.id}`)
    assert.equal(registered.npcPartySnapshot, undefined)
})

function finishPayload(x, accomplished) {
    return {
        viewer_id: x.host.viewerId, play_id: `play-${x.host.id}`,
        category: 2, quest_id: 1001001, room_number: x.room.room_number,
        is_accomplished: accomplished, elapsed_time_ms: 30_000, score: 100,
        add_mana: 0, continue_count: 0, api_count: 2, mate_player_result: [],
        statistics: {
            clear_phase: 1, max_combo_count: 0,
            party: {
                characters: [{ id: 1 }, { id: 2 }, { id: 3 }],
                unison_characters: [null, null, null],
                equipments: [null, null, null], ability_soul_ids: [null, null, null],
            },
        },
    }
}

test('successful HTTP finish records its start party after SET edits and room loss, once per play', async t => {
    const x = await setup(t, { category: 2, questId: 1001001 })
    prepareCompleteParty(x)
    const pool = require('../out/multi/npc/player-party-pool')
    const snapshots = require('../out/multi/settlement-snapshot')
    const recorded = []
    t.mock.method(pool, 'recordSuccessfulQuestNpcParty', snapshot => recorded.push(snapshot))
    assert.equal((await x.start()).json().data.play_id, `play-${x.host.id}`)
    const frozen = JSON.parse(JSON.stringify(snapshots
        .getMultiSettlementSnapshot(x.host.id, `play-${x.host.id}`).npcPartySnapshot))
    parties.updatePlayerPartySync(x.host.id, 1, {
        ...savedParty(100023), characterIds: [1, 2, 3], currentBattlePower: 25_000,
    })
    manager.commitRoomDisband(x.room.room_number, 'test_room_loss')
    assert.equal(rooms.getRoom(x.room.room_number), undefined)
    const payload = finishPayload(x, true)
    const first = await x.app.inject({ method: 'POST', url: '/multi/finish', payload })
    assert.equal(first.statusCode, 200, first.body)
    assert.equal(first.json().data_headers.result_code, 1, first.body)
    assert.equal(recorded.length, 1)
    assert.deepEqual(recorded[0], frozen)
    assert.equal(recorded[0].battlePower, 12_000)
    assert.deepEqual(recorded[0].party.abilitySoulIds, [[1], [1], [1]])
    const retry = await x.app.inject({ method: 'POST', url: '/multi/finish', payload })
    assert.equal(retry.statusCode, 200, retry.body)
    assert.deepEqual(retry.json(), first.json())
    assert.equal(recorded.length, 1, 'a cached finish retry must not record another clear')
})

test('unsuccessful HTTP finish never records a clear-party snapshot', async t => {
    const x = await setup(t, { category: 2, questId: 1001001 })
    prepareCompleteParty(x)
    const pool = require('../out/multi/npc/player-party-pool')
    const recorded = []
    t.mock.method(pool, 'recordSuccessfulQuestNpcParty', snapshot => recorded.push(snapshot))
    assert.equal((await x.start()).json().data.play_id, `play-${x.host.id}`)
    const response = await x.app.inject({
        method: 'POST', url: '/multi/finish', payload: finishPayload(x, false),
    })
    assert.equal(response.statusCode, 200, response.body)
    assert.equal(response.json().data_headers.result_code, 1, response.body)
    assert.deepEqual(recorded, [])
})

test.after(() => {
    for (const timer of intervals) clearInterval(timer)
    if (db.open) db.close()
    fs.rmSync(directory, { recursive: true, force: true })
    try { fs.rmdirSync(parent) } catch {}
})
