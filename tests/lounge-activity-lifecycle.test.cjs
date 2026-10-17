// Lounge is the three-player character-selection activity, not a battle room.
process.env.LOUNGE_DISBAND_SOCKET_GRACE_MS = '0'
process.env.LOUNGE_ENTER_TIMEOUT_MS = '100'
process.env.SESSION_HOST = '127.0.0.1'
process.env.SESSION_PORT = '0'
const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const net = require('node:net')
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-lounge-activity-'))
process.env.DATA_DIR = path.join(directory, 'database')
fs.mkdirSync(process.env.DATA_DIR)
const originalInterval = global.setInterval
global.setInterval = (...args) => { const timer = originalInterval(...args); timer.unref(); return timer }
const lounge = require('../out/lounge/state')
const tcp = require('../out/lounge/tcp')
const server = require('../out/multi/tcp/server')
const admission = require('../out/lib/client-admission')
const eligibility = require('../out/lounge/eligibility')
const { getDb } = require('../out/data/db')
const { insertAccountSync } = require('../out/data/domains/account')
const { insertSessionWithTokenSync } = require('../out/data/domains/session')
global.setInterval = originalInterval

class Socket extends EventEmitter {
    constructor({ delayedClose = false } = {}) {
        super(); this.destroyed = false; this.writable = true; this.readable = true
        this.frames = []; this.delayedClose = delayedClose
        this.on('close', () => lounge.detachLoungeSocket(this))
    }
    write(frame) { this.frames.push(JSON.parse(String(frame).replace(/\0$/, ''))); return true }
    end() { this.writable = false }
    destroy() {
        if (this.destroyed) return
        this.destroyed = true; this.writable = false; this.readable = false
        if (!this.delayedClose) this.emit('close')
    }
}
function makeRoom(hostViewerId = 101, hostPlayerId = 201) {
    const room = lounge.createLounge({ advice: 'activity-test', useCase: 1, campaignId: 3,
        hostViewerId, hostPlayerId,
        hostProfile: { name: 'host', characterId: 1, characterEvolutionLevel: 0 } })
    lounge.prepareLounge(room)
    return room
}
function join(room, id, options) {
    const socket = new Socket(options)
    lounge.attachLoungeSocket(room, id, socket)
    assert.ok(lounge.enterLounge(socket, { name: `member-${id}` }))
    return socket
}
const starts = socket => socket.frames.filter(frame => frame[1]?.[0] === 5)
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(predicate, label) {
    for (let count = 0; count < 200; count++) { if (predicate()) return; await sleep(5) }
    assert.fail(`Timed out: ${label}`)
}
test.beforeEach(t => {
    // Fake-socket tests isolate roster/state transitions. The final real TCP
    // test and activity integration exercise actual saved qualifications.
    if (!t.name.startsWith('real TCP')) {
        t.mock.method(eligibility, 'decideLoungeTickets', () => true)
        const business = require('../out/multi/coordinator/business-handlers')
        const original = business.handleRealtimeBusiness
        // Fake sockets bypass authenticated handshake; isolate the same ticket
        // decision at its new parent RPC boundary without inventing player IDs.
        t.mock.method(business, 'handleRealtimeBusiness', (kind, payload) =>
            kind === 'lounge.start' ? Promise.resolve(true) : original(kind, payload))
    }
})
test.afterEach(() => lounge.resetLoungesForTests())
test.after(async () => { await server.stopSessionServer(); getDb().close(); fs.rmSync(directory, { recursive: true, force: true }) })

test('superseded sockets cannot change readiness, start, heartbeat or remove a replacement', async () => {
    const room = makeRoom(), old = join(room, 101, { delayedClose: true })
    const guest = join(room, 102); join(room, 103)
    const replacement = new Socket()
    lounge.attachLoungeSocket(room, 101, replacement)
    assert.ok(lounge.enterLounge(replacement, { name: 'replacement' }))
    room.lastActivityAt = 123
    tcp.handleLoungeMessage(old, [0, [3, [0]]])
    assert.deepEqual(room.members.get(101).readyState, [1])
    tcp.handleLoungeMessage(old, [0, [1]])
    assert.equal(room.lastActivityAt, 123)
    await tcp.handleLoungeMessage(old, [0, [4]])
    tcp.handleLoungeMessage(old, [0, [6]])
    old.emit('close')
    assert.equal(starts(guest).length, 0)
    assert.equal(room.members.get(101).socket, replacement)
})

test('pending host replacement cannot ready, heartbeat or start before Enter', async () => {
    const room = makeRoom(); join(room, 101); const guest = join(room, 102); join(room, 103)
    const replacement = new Socket(); lounge.attachLoungeSocket(room, 101, replacement)
    room.lastActivityAt = 123
    tcp.handleLoungeMessage(replacement, [0, [3, [0]]])
    assert.deepEqual(room.members.get(101).readyState, [1])
    tcp.handleLoungeMessage(replacement, [0, [1]])
    assert.equal(room.lastActivityAt, 123)
    await tcp.handleLoungeMessage(replacement, [0, [4]])
    assert.equal(starts(guest).length, 0)
    assert.equal(room.raisingState, 2)
})

test('failed replacement before Enter releases the dead member and updates remaining mates', () => {
    const room = makeRoom(), host = join(room, 101); join(room, 102); join(room, 103)
    const replacement = new Socket(); lounge.attachLoungeSocket(room, 102, replacement)
    replacement.destroy()
    assert.equal(room.members.has(102), false)
    assert.equal(lounge.getLoungeOccupancy(room), 2)
    assert.equal(lounge.canAttachLoungeViewer(room, 104), true)
    assert.equal(lounge.loungeCanStart(room), false)
    assert.deepEqual(host.frames.at(-1)[1][1].map(mate => mate.viewerId), [101, 103])
})

test('successful replacement retains its seat when old close arrives late', () => {
    const room = makeRoom(); join(room, 101); const old = join(room, 102, { delayedClose: true }); join(room, 103)
    const replacement = new Socket(); lounge.attachLoungeSocket(room, 102, replacement)
    assert.equal(lounge.getLoungeOccupancy(room), 3)
    assert.equal(lounge.loungeCanStart(room), false)
    assert.ok(lounge.enterLounge(replacement, { name: 'new' }))
    old.emit('close')
    assert.equal(room.members.get(102).socket, replacement)
    assert.equal(lounge.loungeCanStart(room), true)
})

test('a handshake without Enter has a bounded lease despite other members activity', async () => {
    const room = makeRoom(), host = join(room, 101)
    const pending = new Socket(); lounge.attachLoungeSocket(room, 102, pending)
    await until(() => { tcp.handleLoungeMessage(host, [0, [1]]); return pending.destroyed }, 'pending expiry')
    assert.equal(room.pendingSockets.has(102), false)
    assert.equal(lounge.getLoungeOccupancy(room), 1)
})

test('Start requires three live entered members and is broadcast only once', async () => {
    const room = makeRoom(), host = join(room, 101), guest = join(room, 102)
    await tcp.handleLoungeMessage(host, [0, [4]])
    assert.equal(starts(guest).length, 0)
    const third = join(room, 103)
    tcp.handleLoungeMessage(third, [0, [3, [0]]])
    await tcp.handleLoungeMessage(host, [0, [4]])
    assert.equal(starts(guest).length, 0)
    tcp.handleLoungeMessage(third, [0, [3, [1]]])
    await tcp.handleLoungeMessage(host, [0, [4]])
    await tcp.handleLoungeMessage(host, [0, [4]])
    assert.equal(starts(guest).length, 1)
    assert.equal(room.raisingState, 97)
    lounge.prepareLounge(room)
    assert.equal(room.raisingState, 97, 'HTTP prepare cannot reopen an already started lounge')
    await tcp.handleLoungeMessage(host, [0, [4]])
    assert.equal(starts(guest).length, 1)
})

test('ordinary guest disconnect updates the remaining roster', () => {
    const room = makeRoom(), host = join(room, 101), guest = join(room, 102); join(room, 103)
    guest.destroy()
    assert.deepEqual(host.frames.at(-1), [1, [4, lounge.serializeLoungeMates(room)]])
    assert.deepEqual(room.members.keys().toArray(), [101, 103])
})

test('host disconnect preserves the open lounge for login re-entry; host Bye disbands', () => {
    const room = makeRoom(), host = join(room, 101), guest = join(room, 102)
    lounge.disconnectLoungePlayerLogin(101)
    assert.equal(host.destroyed, true)
    assert.equal(lounge.getLounge(room.id), room)
    assert.equal(room.members.has(101), false)
    const replacement = join(room, 101)
    tcp.handleLoungeMessage(replacement, [0, [6]])
    assert.equal(lounge.getLounge(room.id), undefined)
    assert.deepEqual(guest.frames.at(-1), [1, [1, 'multibattle_room_dismissed']])
})

test('two guests cannot fill the host seat before its first Enter or after login disconnect', () => {
    const room = makeRoom(); join(room, 102); join(room, 103)
    assert.equal(lounge.canAttachLoungeViewer(room, 104), false)
    assert.equal(lounge.canAttachLoungeViewer(room, 101), true)
    assert.deepEqual(lounge.listLounges(1), [], 'search must not offer the reserved host seat to guests')
    const host = join(room, 101)
    lounge.disconnectLoungePlayerLogin(101)
    assert.equal(host.destroyed, true)
    assert.equal(lounge.canAttachLoungeViewer(room, 104), false)
    assert.equal(lounge.canAttachLoungeViewer(room, 101), true)
    assert.ok(join(room, 101))
    assert.equal(lounge.loungeCanStart(room), true)
})

test('host replacement lease expiry preserves an open room and its host re-entry slot', async () => {
    const room = makeRoom(); join(room, 101); join(room, 102); join(room, 103)
    const replacement = new Socket(); lounge.attachLoungeSocket(room, 101, replacement)
    await until(() => replacement.destroyed, 'host Enter lease expiry')
    assert.equal(lounge.getLounge(room.id), room)
    assert.equal(room.raisingState, 2)
    assert.equal(room.members.has(101), false)
    assert.equal(lounge.canAttachLoungeViewer(room, 104), false)
    assert.equal(lounge.canAttachLoungeViewer(room, 101), true)
    const newHost = join(room, 101)
    await tcp.handleLoungeMessage(newHost, [0, [4]])
    assert.equal(room.raisingState, 97)
    newHost.destroy()
    assert.equal(room.raisingState, 97, 'a disconnect cannot undo the started transition')
})

test('HTTP restore reports open/started/dismissed states without reopening a started room', async () => {
    const Fastify = require('fastify')
    const active = require('../out/data/activeAccount')
    const players = require('../out/data/domains/player')
    const account = insertAccountSync({ appId: 'wf_cn', idpAlias: '', idpCode: 'test', idpId: 'lounge-http-host', status: 'normal' })
    const player = players.insertDefaultPlayerSync(account.id)
    active.saveAccountDefaultPlayer(account.id, player.id)
    insertSessionWithTokenSync({ token: '20101', accountId: account.id, expires: new Date(0), type: 2 })
    require('../out/data/domains/campaign').updatePlayerMultiSpecialExchangeCampaignSync(player.id, { campaignId: 3, status: 1 })
    const app = Fastify()
    app.addHook('onSend', (_request, reply, payload, done) => {
        if (reply.getHeader('content-type') === 'application/x-msgpack' && typeof payload === 'object') done(null, JSON.stringify(payload))
        else done(null, payload)
    })
    await app.register(require('../out/routes/api/lounge').default, { prefix: '/lounge' })
    const room = makeRoom(20101, player.id); const host = join(room, 20101); join(room, 20102); join(room, 20103)
    const payload = { viewer_id: 20101, use_case: 1, campaign_id: 3, lounge_id: room.id, advice: room.advice, establisher_viewer_id: 20101 }
    const restore = async () => {
        const response = await app.inject({ method: 'POST', url: '/lounge/restore', payload })
        assert.equal(response.statusCode, 200)
        const body = JSON.parse(response.body)
        assert.equal(body.data_headers.result_code, 1)
        return body.data
    }
    try {
        assert.equal((await restore()).raising_state, 2)
        await tcp.handleLoungeMessage(host, [0, [4]])
        assert.equal((await restore()).raising_state, 97)
        const prepared = await app.inject({ method: 'POST', url: '/lounge/prepare', payload })
        assert.equal(prepared.statusCode, 200)
        assert.equal((await restore()).raising_state, 97)
        lounge.disbandLounge(room)
        const dismissed = await restore()
        assert.equal(dismissed.raising_state, 99)
        assert.equal(dismissed.port, 0)
        assert.equal((await restore()).raising_state, 99, 'stale repeated restore remains a normal response')
    } finally { await app.close() }
})

test('a started host Bye is normal selection handoff and cannot dismiss slower guests', async () => {
    const room = makeRoom(), host = join(room, 101), guest = join(room, 102)
    join(room, 103)
    await tcp.handleLoungeMessage(host, [0, [4]])
    const before = guest.frames.length
    tcp.handleLoungeMessage(host, [0, [6]])
    assert.equal(room.raisingState, 97)
    assert.equal(lounge.getLounge(room.id), room)
    assert.equal(room.members.has(101), false)
    assert.equal(guest.frames.length, before, 'no dismissed or mates frame after Start')
})

test('replacing a spent lounge retires it without cancelling slower selection clients', async () => {
    const room = makeRoom(), host = join(room, 101), guest = join(room, 102)
    join(room, 103)
    await tcp.handleLoungeMessage(host, [0, [4]])
    const before = guest.frames.length
    const next = makeRoom()
    assert.equal(lounge.getLounge(room.id), undefined)
    assert.equal(lounge.getLounge(next.id), next)
    assert.equal(guest.frames.length, before)
    assert.equal(lounge.getLoungeSocketContext(guest), null)
})

test('TTL disbands entered and pending sockets through the normal dismissal protocol', () => {
    const room = makeRoom(), host = join(room, 101), pending = new Socket()
    lounge.attachLoungeSocket(room, 102, pending)
    lounge.cleanupExpiredLounges(room.lastActivityAt + 30 * 60 * 1000)
    assert.equal(room.raisingState, 99)
    assert.equal(lounge.getLounge(room.id), undefined)
    assert.deepEqual(host.frames.at(-1), [1, [1, 'multibattle_room_dismissed']])
    assert.deepEqual(pending.frames.at(-1), [1, [1, 'multibattle_room_dismissed']])
    assert.equal(lounge.getLoungeSocketContext(pending), null)
    lounge.prepareLounge(room)
    assert.equal(room.raisingState, 99)
})

test('real TCP failed Enter replacement releases a seat, then three entered peers start once', async t => {
    t.mock.method(admission, 'clientAdmission', () => ({ checkActivity: () => ({ ok: true }) }))
    const playerIds = new Map()
    for (const id of [101, 102, 103, 104]) {
        const account = insertAccountSync({ appId: 'wf_cn', idpAlias: '', idpCode: 'test', idpId: `lounge-${id}`, status: 'normal' })
        const player = require('../out/data/domains/player').insertDefaultPlayerSync(account.id)
        require('../out/data/activeAccount').saveAccountDefaultPlayer(account.id, player.id)
        require('../out/data/domains/campaign').updatePlayerMultiSpecialExchangeCampaignSync(player.id, { campaignId: 3, status: 1 })
        playerIds.set(id, player.id)
        insertSessionWithTokenSync({ token: String(id), accountId: account.id, expires: new Date(0), type: 2 })
    }
    const room = makeRoom(101, playerIds.get(101)), clients = []
    await server.startSessionServer()
    const port = server.getSessionServer().address().port
    const send = (socket, frame) => socket.write(JSON.stringify(frame) + '\0')
    async function connect(id, enter = true) {
        const socket = net.createConnection({ host: '127.0.0.1', port }); clients.push(socket)
        socket.frames = []; socket.on('error', () => {}); let buffer = ''
        socket.on('data', chunk => { buffer += chunk.toString(); for (let end; (end = buffer.indexOf('\0')) >= 0;) {
            socket.frames.push(JSON.parse(buffer.slice(0, end))); buffer = buffer.slice(end + 1)
        } })
        await new Promise(resolve => socket.once('connect', resolve))
        send(socket, { socklet: 'multi_special_exchange_socklet', viewerId: id, loungeId: room.id,
            useCase: 1, establisherViewerId: 101, advice: room.advice })
        await until(() => socket.frames.some(frame => frame[0] === 0), 'handshake')
        if (enter) { send(socket, [0, [0, { name: 'test' }]]); await until(() => room.members.has(id) && !room.pendingSockets.has(id), 'Enter') }
        return socket
    }
    try {
        const host = await connect(101); await connect(102); const peer = await connect(103)
        const replacement = await connect(102, false); replacement.destroy()
        await until(() => !room.pendingSockets.has(102), 'pending closed')
        assert.equal(room.members.has(102), false)
        assert.equal(lounge.getLoungeOccupancy(room), 2)
        assert.equal(lounge.loungeCanStart(room), false)
        await connect(104)
        send(host, [0, [4]]); send(host, [0, [4]])
        await until(() => starts(peer).length > 0, 'start')
        await sleep(20)
        assert.equal(starts(peer).length, 1)
    } finally { for (const socket of clients) socket.destroy(); await server.stopSessionServer() }
})
