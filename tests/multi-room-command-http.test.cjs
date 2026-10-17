const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const isolated = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-room-command-http-'))
process.env.DATA_DIR = isolated
const output = process.env.STARPOINT_TEST_OUT_DIR || path.resolve(__dirname, '../out')
const load = name => require(path.join(output, name))
const intervals = global.setInterval
global.setInterval = (...args) => { const timer = intervals(...args); timer.unref(); return timer }
const db = load('data/db').getDb(), rooms = load('multi/room/manager')
const manager = load('multi/state/SessionManager').sessionManager
const recruitment = load('multi/recruitment'), ai = load('multi/ai-fill')
const gateway = () => load('multi/coordinator/default-runtime').getRoomCommandGateway()
global.setInterval = intervals
let sequence = 0
function player() {
    const n = ++sequence
    const account = load('data/domains/account').insertAccountSync({ appId: 'wf_cn', idpAlias: '', idpCode: 'test', idpId: `room-command-${n}`, status: 'normal' })
    const p = load('data/domains/player').insertDefaultPlayerSync(account.id), viewerId = 886000000 + n
    load('data/activeAccount').saveAccountDefaultPlayer(account.id, p.id)
    load('data/domains/session').insertSessionWithTokenSync({ token: String(viewerId), accountId: account.id, type: 2, expires: new Date(Date.now() + 86400000) })
    load('lib/character').givePlayerCharacterSync(p.id, 111001)
    return { ...p, viewerId }
}
function room(host) { return rooms.createRoom(host.viewerId, host.id, 1, 2, 1033004, 0, 111001) }
async function app() {
    const server = require('fastify')({ logger: false })
    server.addHook('onSend', (_req, reply, payload, done) => done(null,
        String(reply.getHeader('content-type')).startsWith('application/x-msgpack') && typeof payload === 'object' ? JSON.stringify(payload) : payload))
    load('multi/http/room').registerRoomRoutes(server)
    load('multi/http/social').registerSocialRoutes(server)
    await server.ready()
    return server
}
const post = (server, url, p, r, extra = {}) => server.inject({ method: 'POST', url,
    payload: { viewer_id: p.viewerId, room_number: r.room_number, category: r.category, category_id: r.category, quest_id: r.quest_id, ...extra } })
function cleanup(r) { ai.cancelAiFallback(r.room_number); manager.commitRoomDisband(r.room_number, 'test_cleanup') }

test('real HTTP prepare retains host, offline guest, token lookup and unavailable response branches', async () => {
    const host = player(), guest = player(), r = room(host), server = await app()
    r.host_entry_time = 1
    try {
        const prepared = await post(server, '/prepare', host, r)
        assert.equal(prepared.statusCode, 200, prepared.body)
        assert.equal(prepared.json().data.raising_state, 1)
        assert.ok(r.host_entry_time > 1)
        assert.ok(prepared.json().data.port > 0)
        const token = await server.inject({ method: 'POST', url: '/prepare', payload: {
            viewer_id: guest.viewerId, access_token: r.access_token, category: r.category, quest_id: r.quest_id } })
        assert.equal(token.statusCode, 200, token.body)
        assert.equal(token.json().data.raising_state, 2)
        assert.equal(token.json().data.room_number, r.room_number)
        const mismatch = await post(server, '/prepare', host, r, { quest_id: 999 })
        assert.equal(mismatch.json().data.raising_state, 9)
        assert.equal(mismatch.json().data.port, 0)
        const missing = await post(server, '/prepare', host, r, { room_number: 'missing-room' })
        assert.equal(missing.json().data.raising_state, 9)
        assert.equal((await post(server, '/prepare', host, r, { viewer_id: 0 })).statusCode, 400)
    } finally { cleanup(r); await server.close() }
})

test('real HTTP restore keeps distinct absent room, lost member, lobby and original battle decisions', async () => {
    const host = player(), guest = player(), outsider = player(), r = room(host), server = await app()
    rooms.addRoomMember(r.room_number, guest.viewerId, guest.id)
    try {
        assert.equal((await post(server, '/restore_room', host, r)).json().data.raising_state, 1)
        assert.equal((await post(server, '/restore_room', guest, r)).json().data.raising_state, 2)
        const denied = await post(server, '/restore_room', outsider, r)
        assert.equal(denied.statusCode, 200, denied.body)
        assert.equal(denied.json().data.raising_state, 13)
        assert.equal(denied.json().data.category_id, r.category)
        assert.equal(denied.json().data.port, 0)
        assert.equal(denied.json().data.is_same_room, true)
        r.lifecycle.phase = 'BATTLE'; r.raising_state = 4
        r.lifecycle.battleSessionId = 'room-command-original-battle'
        r.expected_real_viewer_ids = [host.viewerId, guest.viewerId]
        assert.equal((await post(server, '/restore_room', guest, r)).json().data.raising_state, 4)
        manager.blockedRoomRestores.set(r.room_number, new Set([guest.viewerId]))
        assert.equal((await post(server, '/restore_room', guest, r)).json().data.raising_state, 9)
        manager.blockedRoomRestores.delete(r.room_number)
        cleanup(r)
        const missing = await post(server, '/restore_room', guest, r)
        assert.equal(missing.statusCode, 200, missing.body)
        assert.equal(missing.json().data.raising_state, 9)
    } finally { cleanup(r); await server.close() }
})

test('real HTTP share merges sticky options and schedules recruitment only through the owner', async () => {
    const host = player(), guest = player(), r = room(host), server = await app()
    try {
        assert.equal((await post(server, '/share_room', guest, r, { share_type_list: [3] })).statusCode, 403)
        assert.equal(r.share_room_options, 0)
        assert.equal((await post(server, '/share_room', host, r, { share_type_list: [1] })).statusCode, 200)
        assert.equal(r.share_room_options, 1)
        const random = await post(server, '/share_room', host, r, { share_type_list: [3] })
        assert.equal(random.statusCode, 200, random.body)
        assert.ok(random.json().data.config)
        assert.equal(r.share_room_options, 5)
        assert.equal(recruitment.isRandomRecruiting(r.room_number), true)
        assert.equal(ai.hasAiFallback(r.room_number), true)
        await post(server, '/share_room', host, r, { share_type_list: [2] })
        assert.equal(r.share_room_options, 7)
        const mismatch = await post(server, '/share_room', host, r, { quest_id: 999, share_type_list: [] })
        assert.equal(mismatch.statusCode, 200)
        assert.equal(r.share_room_options, 7)
        assert.equal(recruitment.isRandomRecruiting(r.room_number), true)
    } finally { cleanup(r); await server.close() }
})

test('real HTTP Mode15 business gate stays in the parent and closed rooms cannot prepare, restore or recruit', async () => {
    const host = player(), r = rooms.createRoom(host.viewerId, host.id, 1, 7, 300098001, 0, 111001), server = await app()
    const mode15 = load('lib/mode15')
    try {
        const expectedStage = mode15.getExpectedMode15StageSync(host.id)
        assert.equal(expectedStage, 1)
        assert.equal(load('multi/mode15-room-gate').isMode15RoomClosed(r), true)
        assert.equal((await post(server, '/prepare', host, r)).json().data.raising_state, 9)
        assert.equal((await post(server, '/restore_room', host, r)).json().data.raising_state, 9)
        assert.deepEqual((await post(server, '/summon', host, r)).json().data, { mate1: null, mate2: null })
        recruitment.publishRandomRecruitment(r.room_number)
        const shared = await post(server, '/share_room', host, r, { share_type_list: [3] })
        assert.equal(shared.statusCode, 200, shared.body)
        assert.equal(r.share_room_options, 0)
        assert.equal(recruitment.isRandomRecruiting(r.room_number), false)
        assert.equal(ai.hasAiFallback(r.room_number), false)
        assert.equal(mode15.getExpectedMode15StageSync(host.id), expectedStage)
    } finally { cleanup(r); await server.close() }
})

test('real HTTP summon keeps parent NPC provider behind the atomic room decision', async t => {
    const host = player(), guest = player(), r = room(host), server = await app()
    let built = 0
    t.mock.method(load('multi/npc/builder'), 'buildNpcMates', (quest, category) => {
        assert.equal(quest, r.quest_id); assert.equal(category, r.category); built++
        return { mate1: { marker: 'parent-npc-provider' }, mate2: null }
    })
    try {
        assert.deepEqual((await post(server, '/summon', host, r)).json().data, { mate1: null, mate2: null })
        assert.equal((await post(server, '/summon', guest, r)).statusCode, 403)
        r.is_npc_mode = true
        assert.equal((await post(server, '/summon', host, r)).json().data.mate1.marker, 'parent-npc-provider')
        assert.equal(built, 1)
        assert.deepEqual((await post(server, '/summon', host, r, { quest_id: 999 })).json().data, { mate1: null, mate2: null })
        assert.equal(built, 1)
    } finally { cleanup(r); await server.close() }
})

test('real HTTP disband checks owner and acknowledges repeated absent cleanup', async () => {
    const host = player(), guest = player(), r = room(host), server = await app()
    try {
        assert.equal((await post(server, '/disband_room', guest, r)).statusCode, 403)
        assert.equal(rooms.getRoom(r.room_number), r)
        assert.equal((await post(server, '/disband_room', host, r)).statusCode, 200)
        assert.equal(rooms.getRoom(r.room_number), undefined)
        assert.equal((await post(server, '/disband_room', host, r)).statusCode, 200)
    } finally { cleanup(r); await server.close() }
})

test('real HTTP disband cannot delete a replacement instance after its projection was read', async t => {
    const host = player(), r = room(host), server = await app(), commands = gateway()
    const originalExecute = commands.execute.bind(commands)
    let replacement, intercepted = 0
    t.mock.method(commands, 'execute', (kind, payload, options) => {
        if (kind === 'room.disband') {
            intercepted++
            cleanup(r)
            const random = t.mock.method(require('node:crypto'), 'randomInt', () => Number(r.room_number))
            try { replacement = room(host) } finally { random.mock.restore() }
        }
        return originalExecute(kind, payload, options)
    })
    try {
        const response = await post(server, '/disband_room', host, r)
        assert.equal(response.statusCode, 200, response.body)
        assert.equal(intercepted, 1)
        assert.notEqual(replacement.lifecycle.instanceId, r.lifecycle.instanceId)
        assert.equal(rooms.getRoom(r.room_number), replacement)
        assert.equal(replacement.lifecycle.phase, 'LOBBY')
    } finally { if (replacement) cleanup(replacement); await server.close() }
})

test('real HTTP queued disband keeps its original instance and generation while a room command is pending', async t => {
    const host = player(), server = await app(), coordinator = load('multi/coordinator/embedded').embeddedMultiCoordinator
    try {
        for (const change of ['instance', 'generation']) {
            const r = room(host)
            let release, queued, request, replacement
            const blocked = new Promise(resolve => { release = resolve })
            const accepted = new Promise(resolve => { queued = resolve })
            const enqueue = coordinator.enqueueRoomCommand
            const blocker = enqueue.call(coordinator, r.room_number, () => blocked)
            const queueHook = t.mock.method(coordinator, 'enqueueRoomCommand', function (number, operation) {
                const result = enqueue.call(this, number, operation)
                queued()
                return result
            })
            try {
                request = post(server, '/disband_room', host, r).then(response => response)
                await accepted
                if (change === 'instance') {
                    cleanup(r)
                    const random = t.mock.method(require('node:crypto'), 'randomInt', () => Number(r.room_number))
                    try { replacement = room(host) } finally { random.mock.restore() }
                } else {
                    r.lobby_generation++
                }
                release()
                const response = await request
                assert.equal(response.statusCode, 200, response.body)
                assert.equal(rooms.getRoom(r.room_number), replacement || r, change)
                assert.equal((replacement || r).lifecycle.phase, 'LOBBY')
            } finally {
                queueHook.mock.restore()
                release()
                await blocker
                if (request) await request
                cleanup(replacement || r)
            }
        }
    } finally { await server.close() }
})

test('real HTTP prepare and restore recheck one unapplied stale host return within the same instance and generation', async t => {
    const host = player(), r = room(host), server = await app(), commands = gateway()
    const coordinator = load('multi/coordinator/embedded').embeddedMultiCoordinator
    const originalExecute = commands.execute.bind(commands)
    try {
        for (const route of ['prepare', 'restore']) {
            r.lifecycle.phase = 'RETURNING'; r.lifecycle.battleSessionId = `return-${route}`
            r.lobby_generation = 1; r.settlement_return_pending = true
            const originalInstance = r.lifecycle.instanceId
            let decisions = 0, queries = 0
            const ids = []
            const hook = t.mock.method(commands, 'execute', (kind, payload, options) => {
                if (kind === 'room.query') queries++
                if (kind === `room.${route}`) {
                    decisions++; ids.push(options.commandId)
                    if (decisions === 1) assert.equal(coordinator.completeSettlementReturn(r).ok, true)
                }
                return originalExecute(kind, payload, options)
            })
            try {
                const response = await post(server, route === 'restore' ? '/restore_room' : '/prepare', host, r)
                assert.equal(response.statusCode, 200, response.body)
                assert.equal(response.json().data.raising_state, 1)
                assert.equal(decisions, 2)
                assert.equal(queries, 2)
                assert.notEqual(ids[0], ids[1])
                assert.equal(r.lifecycle.instanceId, originalInstance)
                assert.equal(r.lobby_generation, 1)
            } finally { hook.mock.restore() }
        }
    } finally { cleanup(r); await server.close() }
})

test('real HTTP connection does not retry a busy or outcome-unknown command under a new ID', async t => {
    const host = player(), r = room(host), server = await app(), commands = gateway()
    const originalExecute = commands.execute.bind(commands)
    const { RoomCommandError } = load('multi/coordinator/command-protocol')
    try {
        for (const [code, outcomeUnknown] of [['OUTCOME_UNKNOWN', true], ['QUEUE_LIMIT', false]]) {
            let queries = 0
            const ids = []
            const hook = t.mock.method(commands, 'execute', (kind, payload, options) => {
                if (kind === 'room.query') queries++
                if (kind === 'room.restore') {
                    ids.push(options.commandId)
                    throw new RoomCommandError(code, 'injected command boundary failure', options.commandId, outcomeUnknown)
                }
                return originalExecute(kind, payload, options)
            })
            try {
                const response = await post(server, '/restore_room', host, r)
                assert.equal(response.statusCode, 500, response.body)
                assert.equal(response.json().data?.raising_state, undefined)
                assert.equal(ids.length, 1)
                assert.equal(queries, 1)
                assert.equal(rooms.getRoom(r.room_number), r)
            } finally { hook.mock.restore() }
        }
    } finally { cleanup(r); await server.close() }
})

test('real HTTP stale connection never follows a later generation or maps it to room-missing', async t => {
    const host = player(), r = room(host), server = await app(), commands = gateway()
    const originalExecute = commands.execute.bind(commands)
    let decisions = 0
    const hook = t.mock.method(commands, 'execute', (kind, payload, options) => {
        if (kind === 'room.restore') { decisions++; r.lobby_generation++ }
        return originalExecute(kind, payload, options)
    })
    try {
        const response = await post(server, '/restore_room', host, r)
        assert.equal(response.statusCode, 500, response.body)
        assert.equal(response.json().data?.raising_state, undefined)
        assert.equal(decisions, 1)
        assert.equal(rooms.getRoom(r.room_number), r)
    } finally { hook.mock.restore(); cleanup(r); await server.close() }
})

test('query and replay return independent JSON projections; social HTTP retains parent player enrichment', async () => {
    const host = player(), guest = player(), r = room(host), server = await app()
    try {
        const commandId = load('multi/coordinator/command-protocol').createRoomCommandId()
        const first = await gateway().execute('room.query', { roomNumber: r.room_number }, { commandId })
        const originalVersion = r.lifecycle.version, originalInstance = r.lifecycle.instanceId
        first.identity.version = 999; first.identity.instanceId = 'caller-edited-copy'; first.host_player_id = -1
        const replay = await gateway().execute('room.query', { roomNumber: r.room_number }, { commandId })
        assert.equal(replay.identity.version, originalVersion)
        assert.equal(replay.identity.instanceId, originalInstance)
        assert.equal(replay.host_player_id, host.id)
        assert.equal(r.lifecycle.version, originalVersion)
        const verified = await server.inject({ method: 'POST', url: '/verify_access_token', payload: { viewer_id: guest.viewerId, access_token: r.access_token } })
        assert.equal(verified.statusCode, 200, verified.body)
        assert.equal(verified.json().data.room_exists, true)
        assert.equal(verified.json().data.establisher, host.viewerId)
        assert.equal(verified.json().data.establisher_name, load('data/domains/player').getPlayerSync(host.id).name)
        const missing = await server.inject({ method: 'POST', url: '/verify_access_token', payload: { viewer_id: guest.viewerId, access_token: 'absent-token' } })
        assert.deepEqual(missing.json().data, { room_exists: false })
    } finally { cleanup(r); await server.close() }
})

after(async () => {
    await load('multi/npc/player-party-pool').stopQuestNpcPartyPoolWorker()
    db.close()
    const target = path.resolve(isolated), boundary = path.resolve(os.tmpdir()) + path.sep
    assert.ok(target.startsWith(boundary) && path.basename(target).startsWith('sp-room-command-http-'))
    fs.rmSync(target, { recursive: true, force: true })
})
