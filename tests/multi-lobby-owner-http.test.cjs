const { test, after } = require('node:test')
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-lobby-owner-http-'))
process.env.DATA_DIR = directory
process.env.MULTI_REALTIME_PROCESS = '0'
process.env.MULTI_REALTIME_OWNER_CHILD = '0'
const out = process.env.STARPOINT_TEST_OUT_DIR
if (!out) throw new Error('Use the isolated current build via STARPOINT_TEST_OUT_DIR')
const load = name => require(path.join(out, name))
const realInterval = global.setInterval
global.setInterval = (...args) => { const timer = realInterval(...args); timer.unref(); return timer }
const db = load('data/db').getDb(), rooms = load('multi/room/manager')
const sessions = load('multi/state/SessionManager').sessionManager, embedded = load('multi/coordinator/embedded').embeddedMultiCoordinator
const recruitment = load('multi/recruitment'), lounge = load('lounge/state'), admissions = load('multi/room/admission').roomAdmissionRegistry
const gateway = () => load('multi/coordinator/default-runtime').getRoomCommandGateway()
global.setInterval = realInterval
let sequence = 0
function player(eligible = false) {
    const n = ++sequence, account = load('data/domains/account').insertAccountSync({ appId: 'wf_cn', idpAlias: '', idpCode: 'test', idpId: `lobby-owner-${n}`, status: 'normal' })
    const p = load('data/domains/player').insertDefaultPlayerSync(account.id), viewerId = 887000000 + n
    load('data/activeAccount').saveAccountDefaultPlayer(account.id, p.id)
    load('data/domains/session').insertSessionWithTokenSync({ token: String(viewerId), accountId: account.id, type: 2, expires: new Date(Date.now() + 86400000) })
    load('lib/character').givePlayerCharacterSync(p.id, 111001)
    if (eligible) load('data/domains/campaign').updatePlayerMultiSpecialExchangeCampaignSync(p.id, { campaignId: 3, status: 1 })
    return { ...p, viewerId }
}
function room(host) { return rooms.createRoom(host.viewerId, host.id, 1, 2, 1033004, 0, 111001) }
function cleanup(r) { if (r) sessions.commitRoomDisband(r.room_number, 'test_cleanup') }
async function app() {
    const server = require('fastify')({ logger: false })
    server.addHook('onSend', (_req, reply, payload, done) => done(null,
        String(reply.getHeader('content-type')).startsWith('application/x-msgpack') && typeof payload === 'object' ? JSON.stringify(payload) : payload))
    load('multi/http/lobby').registerLobbyRoutes(server)
    await server.register(load('routes/api/attention').default, { prefix: '/attention' })
    await server.register(load('routes/api/lounge').default, { prefix: '/lounge' })
    await server.ready(); return server
}
const post = (server, url, p, fields = {}) => server.inject({ method: 'POST', url, payload: { viewer_id: p.viewerId, ...fields } })
const select = (server, p, r, fields = {}) => post(server, '/select_room', p, { room_number: r.room_number, category: r.category, quest_id: r.quest_id, accepted_type: 1, ...fields })

test('real HTTP create validates business quest before owner create and cleans only idle hosted rooms', async t => {
    const host = player(), old = room(host), active = room(host), server = await app()
    t.mock.method(sessions, 'hasRoomConnections', number => number === active.room_number)
    let created
    try {
        const denied = await post(server, '/create_room', host, { category: 2, quest_id: 999999999, party_id: 1 })
        assert.equal(denied.statusCode, 200); assert.equal(denied.json().data_headers.result_code, 4507)
        assert.equal(rooms.getRoom(old.room_number), old)
        const response = await post(server, '/create_room', host, { category: 2, quest_id: 1033004, party_id: 1 })
        assert.equal(response.statusCode, 200, response.body)
        created = rooms.getRoom(response.json().data.room_number)
        assert.ok(created); assert.equal(created.host_player_id, host.id)
        assert.equal(rooms.getRoom(old.room_number), undefined)
        assert.equal(rooms.getRoom(active.room_number), active)
        const telemetry = await post(server, '/create_room_failure', host)
        assert.deepEqual(telemetry.json().data, {})
    } finally { cleanup(old); cleanup(active); cleanup(created); await server.close() }
})

test('real HTTP selection serializes concurrent guest admission and preserves COM/battle native denial', async () => {
    const host = player(), guests = [player(), player(), player()], r = room(host), server = await app()
    try {
        const responses = await Promise.all(guests.map(p => select(server, p, r)))
        assert.ok(responses.every(response => response.statusCode === 200), responses.map(r => r.body).join('\n'))
        assert.equal(responses.filter(response => response.json().data.port > 0).length, 2)
        assert.equal(responses.filter(response => response.json().data.raising_state === 3).length, 1)
        for (const guest of guests) admissions.release(r.room_number, guest.viewerId)
        r.npc_count = 2; r.is_npc_mode = true
        r.mates = [{ viewer_id: host.viewerId }, { viewer_id: -1 }, { viewer_id: -2 }]
        assert.equal((await select(server, guests[0], r)).json().data.raising_state, 3)
        assert.equal((await select(server, host, r)).json().data.raising_state, 1)
        r.lifecycle.phase = 'BATTLE'
        assert.equal((await select(server, guests[0], r)).json().data.raising_state, 4)
    } finally { cleanup(r); await server.close() }
})

test('real HTTP select rejects captured replaced-instance and later-generation commands without taking capacity', async t => {
    const host = player(), guest = player(), r = room(host), server = await app()
    const original = embedded.enqueueRoomCommand.bind(embedded)
    let changed = false
    t.mock.method(embedded, 'enqueueRoomCommand', (number, operation) => {
        if (number === r.room_number && !changed) { changed = true; r.lifecycle.instanceId += '-replacement'; r.lobby_generation++ }
        return original(number, operation)
    })
    try {
        const response = await select(server, guest, r)
        assert.equal(response.statusCode, 500)
        assert.equal(admissions.has(r.room_number, r.lobby_generation, guest.viewerId), false)
        assert.equal(response.body.includes('raising_state'), false)
    } finally { cleanup(r); await server.close() }
})

test('real HTTP select retries only unapplied same-instance version change and never unknown timeout', async t => {
    const host = player(), guest = player(), r = room(host), server = await app(), transport = gateway()
    const original = transport.execute.bind(transport)
    let selects = 0
    t.mock.method(transport, 'execute', (kind, payload, options) => {
        if (kind === 'lobby.select' && ++selects === 1) r.lifecycle.version++
        return original(kind, payload, options)
    })
    try {
        const successful = await select(server, guest, r)
        assert.equal(successful.statusCode, 200, successful.body); assert.ok(successful.json().data.port > 0)
        assert.equal(selects, 2)
        admissions.release(r.room_number, guest.viewerId)
        t.mock.restoreAll(); selects = 0
        const { RoomCommandError } = load('multi/coordinator/command-protocol')
        t.mock.method(transport, 'execute', (kind, payload, options) => {
            if (kind === 'lobby.select') { selects++; throw new RoomCommandError('ACK_TIMEOUT', 'unknown outcome', options.commandId, true) }
            return original(kind, payload, options)
        })
        assert.equal((await select(server, guest, r)).statusCode, 500)
        assert.equal(selects, 1)
    } finally { cleanup(r); await server.close() }
})

test('real attention HTTP applies parent eligibility and owner delivery/acceptance state without live parent reads', async t => {
    const host = player(), guest = player(), r = room(host), server = await app()
    t.mock.method(sessions, 'isHostOnline', () => true)
    recruitment.publishRandomRecruitment(r.room_number)
    try {
        const response = await post(server, '/attention/check', guest, { request_number: 3, holding_number: 0 })
        assert.equal(response.statusCode, 200, response.body)
        const notice = response.json().data.multi.find(item => item.quest_info.room_number === r.room_number)
        assert.ok(notice.attention_key); assert.equal(notice.quest_info.quest_id, r.quest_id)
        assert.equal(recruitment.wasRandomRecruitmentDeliveredTo(r.room_number, guest.viewerId), true)
        assert.equal((await select(server, guest, r, { accepted_type: 2 })).statusCode, 200)
        assert.equal(recruitment.wasRandomRecruitmentAcceptedBy(r.room_number, guest.viewerId), true)
        assert.equal((await post(server, '/attention/check', guest, { request_number: 3, holding_number: 0 })).json().data.multi, null)
    } finally { cleanup(r); await server.close() }
})

test('real room list retains parent follow gate and public avatar plus native COM-full response', async t => {
    const host = player(), guest = player(), r = room(host), server = await app()
    t.mock.method(sessions, 'isHostOnline', () => true)
    r.share_room_options = 1; r.npc_count = 2; r.mates = [{ viewer_id: host.viewerId }, { viewer_id: -1 }, { viewer_id: -2 }]
    try {
        assert.deepEqual((await post(server, '/get_rooms', guest, { category_id: 2 })).json().data.rooms, [])
        t.mock.method(load('data/domains/follow'), 'getFollowRelationSync', () => ({ state: 1, followTime: new Date() }))
        const response = await post(server, '/get_rooms', guest, { category_id: 2 })
        assert.equal(response.statusCode, 200, response.body)
        const listed = response.json().data.rooms.find(room => room.room_number === r.room_number)
        assert.equal(listed.raising_state, 3); assert.equal(listed.establisher_character, 111001)
        assert.equal(listed.establisher_follow, 1); assert.equal(listed.mates, 3)
        const projection = await gateway().execute('lobby.query', { viewerId: guest.viewerId, roomNumber: r.room_number })
        projection.mateCount = 999; projection.identity.instanceId = 'mutated-copy'
        assert.equal(r.mates.length, 3); assert.notEqual(r.lifecycle.instanceId, 'mutated-copy')
    } finally { cleanup(r); await server.close() }
})

test('real lounge HTTP retains campaign gate, access, prepare/share and connection projection', async () => {
    const host = player(true), guest = player(true), blocked = player(), server = await app()
    // Default players may already have campaign participation. Model an
    // explicitly completed campaign rather than assuming a missing row.
    load('data/domains/campaign').updatePlayerMultiSpecialExchangeCampaignSync(blocked.id, { campaignId: 3, status: 4 })
    try {
        assert.equal((await post(server, '/lounge/create', blocked, { use_case: 1, campaign_id: 3 })).json().data_headers.result_code, 4511)
        const created = await post(server, '/lounge/create', host, { use_case: 1, campaign_id: 3 })
        assert.equal(created.statusCode, 200, created.body)
        const r = lounge.getLounge(created.json().data.lounge_id), access = { lounge_id: r.id, use_case: 1, advice: r.advice, establisher_viewer_id: host.viewerId }
        assert.equal((await post(server, '/lounge/prepare', host, access)).json().data_headers.result_code, 1)
        assert.equal(r.raisingState, 2)
        assert.equal((await post(server, '/lounge/select', blocked, access)).json().data_headers.result_code, 4511)
        const selected = await post(server, '/lounge/select', guest, access)
        assert.equal(selected.json().data.raising_state, 2); assert.equal(selected.json().data.lounge_number, r.number)
        assert.equal((await post(server, '/lounge/search', guest, { use_case: 1, lounge_number: r.number })).json().data.lounge_exists, true)
        assert.equal((await post(server, '/lounge/restore', guest, access)).json().data.raising_state, 2)
        assert.deepEqual((await post(server, '/lounge/share', host, { ...access, share_type_list: [1, 3] })).json().data, {})
        assert.deepEqual([...r.shareTypes], [1, 3])
        assert.equal((await post(server, '/lounge/select', guest, { ...access, advice: 'wrong-instance' })).json().data.raising_state, 99)
        const list = await post(server, '/lounge/get_list', guest, { use_case: 1 })
        assert.equal(list.json().data.lounge_list[0].lounge_id, r.id)
    } finally { lounge.resetLoungesForTests(); await server.close() }
})

test('real lounge mutation cannot target a reused id whose advice changed after query', async t => {
    const host = player(true), server = await app(), transport = gateway(), original = transport.execute.bind(transport)
    let shareCommands = 0
    try {
        const created = await post(server, '/lounge/create', host, { use_case: 1, campaign_id: 3 })
        const r = lounge.getLounge(created.json().data.lounge_id), access = { lounge_id: r.id, use_case: 1, advice: r.advice, establisher_viewer_id: host.viewerId }
        t.mock.method(transport, 'execute', (kind, payload, options) => {
            if (kind === 'lounge.share') { shareCommands++; r.advice = 'replacement-instance' }
            return original(kind, payload, options)
        })
        const response = await post(server, '/lounge/share', host, { ...access, share_type_list: [3] })
        // The production lounge scope reports unavailable, never a forged
        // disbanded room, after an explicitly unapplied identity mismatch.
        assert.equal(response.statusCode, 200)
        assert.equal(response.json().data_headers.result_code, 4050)
        assert.deepEqual(response.json().data, {})
        assert.equal(shareCommands, 1, 'stale lounge instance must not be retried against the replacement')
        assert.equal(r.shareTypes.size, 0)
    } finally { lounge.resetLoungesForTests(); await server.close() }
})

after(() => { lounge.resetLoungesForTests(); db.close(); fs.rmSync(directory, { recursive: true, force: true }) })

test('real HTTP discovery pages remain bounded and do not chase rooms created after the first page', async t => {
    const host = player(), guest = player(), server = await app(), created = [], transport = gateway(), original = transport.execute.bind(transport)
    t.mock.method(sessions, 'isHostOnline', () => true)
    t.mock.method(load('data/domains/follow'), 'getFollowRelationSync', () => ({ state: 1, followTime: new Date() }))
    for (let n = 0; n < 270; n++) { const r = room(host); r.share_room_options = 1; created.push(r) }
    let pages = 0, extra
    t.mock.method(transport, 'execute', async (kind, payload, options) => {
        const result = await original(kind, payload, options)
        if (kind === 'lobby.list') {
            pages++; assert.ok(result.rooms.length <= 64)
            if (pages === 1) { extra = room(host); extra.share_room_options = 1; created.push(extra) }
        }
        return result
    })
    try {
        const response = await post(server, '/get_rooms', guest, { category_id: 2 })
        assert.equal(response.statusCode, 200, response.body)
        const listed = response.json().data.rooms
        assert.equal(listed.length, 256); assert.equal(pages, 4)
        assert.equal(new Set(listed.map(r => r.room_number)).size, listed.length)
        assert.equal(listed.some(r => r.room_number === extra.room_number), false)
    } finally { for (const r of created) cleanup(r); await server.close() }
})

test('real HTTP child create refreshes matching host facts before cleanup and room publication', async t => {
    const host = player(), old = room(host), server = await app(), transport = gateway(), original = transport.execute.bind(transport)
    const facts = load('multi/coordinator/business-facts')
    let refreshes = 0, allow = false, created
    t.mock.method(facts, 'refreshRealtimePlayerFacts', async (playerId, scope) => {
        assert.equal(playerId, host.id)
        assert.deepEqual(scope, { category: 2, questId: 1033004, partyId: 1 })
        refreshes++
    })
    t.mock.method(facts, 'getPlayerBusinessFacts', (playerId, scope) => {
        assert.equal(playerId, host.id)
        assert.equal(scope.category, 2); assert.equal(scope.questId, 1033004)
        return { playerId, questPolicy: { hostAllowed: allow, isMode15: false } }
    })
    t.mock.method(transport, 'execute', async (kind, payload, options) => {
        if (kind !== 'lobby.create') return original(kind, payload, options)
        process.env.MULTI_REALTIME_OWNER_CHILD = '1'
        try { return await original(kind, payload, options) }
        finally { process.env.MULTI_REALTIME_OWNER_CHILD = '0' }
    })
    try {
        const refused = await post(server, '/create_room', host, { category: 2, quest_id: 1033004, party_id: 1 })
        assert.equal(refused.statusCode, 500)
        assert.equal(rooms.getRoom(old.room_number), old, 'unavailable fresh policy must not delete prior idle room')
        allow = true
        const accepted = await post(server, '/create_room', host, { category: 2, quest_id: 1033004, party_id: 1 })
        assert.equal(accepted.statusCode, 200, accepted.body)
        created = rooms.getRoom(accepted.json().data.room_number)
        assert.ok(created); assert.equal(rooms.getRoom(old.room_number), undefined)
        assert.equal(refreshes, 2)
        process.env.MULTI_REALTIME_OWNER_CHILD = '1'
        assert.equal(load('multi/mode15-room-gate').isMode15RoomClosed(created), false)
    } finally { process.env.MULTI_REALTIME_OWNER_CHILD = '0'; cleanup(old); cleanup(created); await server.close() }
})
