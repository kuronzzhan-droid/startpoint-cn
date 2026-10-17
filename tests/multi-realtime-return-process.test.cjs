'use strict'
// Real remote owner + real loopback TCP; no game-state shortcut in the parent.
const { test } = require('node:test')
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), net = require('node:net')
const { performance } = require('node:perf_hooks')
const out = process.env.STARPOINT_TEST_OUT_DIR
if (!out) throw Error('Use current isolated build via STARPOINT_TEST_OUT_DIR')
const load = name => require(path.join(out, name)), sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(predicate, label, ms = 6000) {
    const end = performance.now() + ms
    while (!predicate()) { if (performance.now() >= end) throw Error(`timeout: ${label}`); await sleep(5) }
}
class Wire {
    constructor(port) {
        this.frames = []; this.buffer = ''; this.closed = false
        this.socket = net.createConnection({ host: '127.0.0.1', port }); this.socket.setNoDelay(true); this.socket.setEncoding('utf8')
        this.socket.on('error', () => {}); this.socket.on('close', () => { this.closed = true })
        this.socket.on('data', chunk => {
            this.buffer += chunk; assert.ok(this.buffer.length < 1024 * 1024)
            let at
            while ((at = this.buffer.indexOf('\0')) >= 0) {
                const frame = this.buffer.slice(0, at); this.buffer = this.buffer.slice(at + 1)
                if (frame) this.frames.push(JSON.parse(frame))
            }
        })
    }
    send(frame) { this.socket.write(JSON.stringify(frame) + '\0') }
    async open(handshake) {
        await until(() => !this.socket.connecting, 'connect'); this.send(handshake)
        await until(() => this.frames.length > 0 || this.closed, 'handshake response')
        assert.equal(this.frames[0]?.[0], 0, JSON.stringify(this.frames))
    }
    count(tag) { return this.frames.filter(frame => frame[0] === 1 && frame[1]?.[0] === tag).length }
}

test('remote owner keeps slow peer result and return reservation after host return plus legacy Notify10', { timeout: 40000 }, async t => {
    const directory = fs.mkdtempSync(path.join(path.resolve(__dirname, '../tmp'), 'remote-return-'))
    process.env.DATA_DIR = directory; process.env.MULTI_REALTIME_PROCESS = '1'; process.env.MULTI_REALTIME_OWNER_CHILD = '0'
    process.env.MULTI_BATTLE_RELAY_PROCESS = '0'; process.env.SESSION_HOST = '127.0.0.1'; process.env.SESSION_PORT = '0'
    process.env.MULTI_SETTLEMENT_BARRIER_MS = '20'
    process.env.CLIENT_ADMISSION_CONFIG = path.join(directory, 'admission.json'); process.env.CLIENT_ADMISSION_KEYS = path.join(directory, 'keys.json')
    fs.writeFileSync(process.env.CLIENT_ADMISSION_CONFIG, JSON.stringify({ enforce: false, updateMessage: 'isolated return', builds: [] }))
    fs.writeFileSync(process.env.CLIENT_ADMISSION_KEYS, '{}')
    const accounts = load('data/domains/account'), players = load('data/domains/player'), sessions = load('data/domains/session')
    const active = load('data/domains/quest_active'), items = load('data/domains/item')
    const members = [1, 2].map(index => {
        const account = accounts.insertAccountSync({ appId: 'wf_cn', idpAlias: '', idpCode: 'test', idpId: `return-owner-${index}`, status: 'normal' })
        const p = players.insertDefaultPlayerSync(account.id)
        load('data/activeAccount').saveAccountDefaultPlayer(account.id, p.id)
        players.updatePlayerSync({ id: p.id, stamina: 100, staminaHealTime: new Date() })
        load('lib/character').givePlayerCharacterSync(p.id, 111001)
        items.setPlayerItemSync(p.id, 10000145, 77)
        load('data/domains/party').updatePlayerPartySync(p.id, 1, { category: 1, name: 'remote-return', characterIds: [111001, null, null], unisonCharacterIds: [null, null, null], equipmentIds: [null, null, null], abilitySoulIds: [null, null, null], edited: true, options: {} }, 1)
        const viewerId = 886200000 + index
        sessions.insertSessionWithTokenSync({ token: String(viewerId), accountId: account.id, type: 2, expires: new Date(Date.now() + 86400000) })
        return { id: p.id, viewerId, cid: `remote-return-original-${index}`, playId: `remote-return-play-${index}` }
    })
    const runtime = load('multi/coordinator/default-runtime'), app = require('fastify')(), wires = []
    app.addHook('onSend', (_request, reply, payload, done) => done(null, reply.getHeader('content-type') === 'application/x-msgpack' ? JSON.stringify(payload) : payload))
    await app.register(load('multi/http/register').multiBattleRoutes, { prefix: '/multi' })
    await app.ready()
    t.after(async () => {
        wires.forEach(wire => wire.socket.destroy()); await runtime.stopRealtimeSessionServer(); await app.close()
        await load('multi/npc/player-party-pool').stopQuestNpcPartyPoolWorker()
        load('data/db').getDb().close(); fs.rmSync(directory, { recursive: true, force: true })
    })
    const post = async (url, payload) => {
        const response = await app.inject({ method: 'POST', url: `/multi/${url}`, payload })
        assert.equal(response.statusCode, 200, response.body)
        const value = response.json(); assert.equal(value.data_headers.result_code, 1, response.body)
        return value
    }
    await runtime.startRealtimeSessionServer()
    const status = runtime.realtimeOwnerStatus(), gateway = runtime.getRoomCommandGateway()
    assert.equal(status.mode, 'process'); assert.notEqual(status.pid, process.pid); assert.ok(status.endpoint.port > 0)
    assert.equal(load('multi/tcp/server').getSessionServer(), null)
    assert.throws(() => load('multi/room/manager').getRooms(1), /REALTIME_STATE_BELONGS_TO_CHILD/)
    const scope = { category: 1, quest_id: 9001001, party_id: 1 }
    const created = (await post('create_room', { viewer_id: members[0].viewerId, ...scope })).data
    const room = created.room_number
    await post('select_room', { viewer_id: members[1].viewerId, ...scope, room_number: room, accepted_type: 0 })
    const openLobby = async (member, cid) => {
        const wire = new Wire(status.endpoint.port); wires.push(wire)
        await wire.open({ socklet: 'cooperation_room', viewerId: member.viewerId, room_number: room, connection_id: cid })
        wire.send([0, [0, {}, 1]]); await until(() => wire.count(0) > 0, 'lobby Enter')
        return wire
    }
    const originalLobby = []
    for (const member of members) originalLobby.push(await openLobby(member, member.cid))
    originalLobby.forEach(wire => wire.send([0, [3, [1]]]))
    await until(() => originalLobby.every(wire => wire.frames.some(frame => frame[1]?.[0] === 2 && frame[1]?.[2]?.[0] === 1)), 'Ready')
    originalLobby[0].send([0, [6]])
    await until(() => originalLobby.every(wire => wire.count(5) > 0), 'lobby Start')
    for (const member of members) await post('start', { viewer_id: member.viewerId, ...scope, room_number: room, play_id: member.playId,
        use_boost_point: false, use_boss_boost_point: false, is_auto_start_mode: false, mate_player_ids: [], mate_party_ids: [] })
    const battle = []
    for (const member of members) {
        const wire = new Wire(status.endpoint.port); wires.push(wire); battle.push(wire)
        await wire.open({ socklet: 'cooperation_battle', room_number: room, connection_id: member.cid })
    }
    battle.forEach(wire => wire.send([0, [0]]))
    await until(() => battle.every(wire => wire.count(1) === 1), 'battle SceneReady')
    const frozen = await gateway.execute('room.query', { roomNumber: room })
    assert.ok(frozen.identity.battleSessionId)
    battle.forEach(wire => wire.send([0, [2]]))
    await until(() => battle.every(wire => wire.count(2) > 0), 'Finalize ACK')
    // Normal result-page socket close after Finalize is not a disconnect/recovery test.
    ;[...originalLobby, ...battle].forEach(wire => wire.socket.destroy())
    await until(() => battle.every(wire => wire.closed), 'normal battle closes')
    const finishBody = member => ({ viewer_id: member.viewerId, play_id: member.playId, category: scope.category, quest_id: scope.quest_id,
        is_accomplished: true, elapsed_time_ms: 30000, score: 100, add_mana: 0, continue_count: 0,
        statistics: { clear_phase: 1, max_combo_count: 0, party: { characters: [{ id: 111001 }], unison_characters: [], equipments: [], ability_soul_ids: [] } }, mate_player_result: [] })
    await post('finish', finishBody(members[0]))
    assert.equal(active.getPlayerActiveQuestSync(members[0].id), null)
    assert.equal(active.getPlayerActiveQuestSync(members[1].id).playId, members[1].playId)
    const returnedHost = await openLobby(members[0], 'remote-return-host-lobby')
    returnedHost.send([0, [10]])
    await sleep(40)
    const held = await gateway.execute('lobby.query', { roomNumber: room, viewerId: members[1].viewerId })
    assert.equal(held.phase, 'LOBBY'); assert.equal(held.returningMember, true)
    assert.equal(held.identity.instanceId, frozen.identity.instanceId)
    assert.notEqual((await post('restore_room', { viewer_id: members[1].viewerId, room_number: room })).data.raising_state, 9)
    const lateFinish = await post('finish', finishBody(members[1]))
    const replay = await post('finish', finishBody(members[1]))
    assert.deepEqual(replay, lateFinish)
    assert.equal(active.getPlayerActiveQuestSync(members[1].id), null)
    const restored = (await post('restore_room', { viewer_id: members[1].viewerId, room_number: room })).data
    assert.equal(restored.room_number, room); assert.ok(![9, 13].includes(restored.raising_state))
    await openLobby(members[1], 'remote-return-guest-lobby')
    const oldRun = await gateway.execute('battle.query', { roomNumber: room, viewerId: members[1].viewerId, playerId: members[1].id, playId: members[1].playId })
    assert.equal(oldRun.binding.battleSessionId, frozen.identity.battleSessionId)
    assert.equal(oldRun.binding.phase, 'RETURNED')
    const oldBattle = new Wire(status.endpoint.port); wires.push(oldBattle)
    await until(() => !oldBattle.socket.connecting, 'old battle connection')
    oldBattle.send({ socklet: 'cooperation_battle', room_number: room, connection_id: members[1].cid })
    await until(() => oldBattle.frames.length > 0 || oldBattle.closed, 'old battle denied')
    assert.notEqual(oldBattle.frames[0]?.[0], 0, 'completed original run cannot be rejoined as live battle')
    for (const member of members) {
        assert.ok(items.getPlayerItemSync(member.id, 10000145) >= 77)
        assert.ok(load('data/domains/character').getPlayerCharacterSync(member.id, 111001))
    }
    const durable = members.map(member => ({ currency: items.getPlayerItemSync(member.id, 10000145), active: active.getPlayerActiveQuestSync(member.id) }))
    await runtime.stopRealtimeSessionServer()
    assert.deepEqual(members.map(member => ({ currency: items.getPlayerItemSync(member.id, 10000145), active: active.getPlayerActiveQuestSync(member.id) })), durable)
    assert.equal(runtime.realtimeOwnerStatus().ready, false); assert.equal(load('multi/tcp/server').getSessionServer(), null)
    t.diagnostic('Two real players: original run Finalize, host settle/return/Notify10, slow peer settle/replay/restore/Enter, original run RETURNED fence; remote owner stop preserves durable player rows.')
})
