// Complete activity protocol in an isolated database; no production listeners.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const net = require('node:net')
const { spawnSync } = require('node:child_process')
const root = process.env.LOUNGE_TEST_ROOT || path.resolve(__dirname, '..')
const source = process.env.LOUNGE_TEST_SOURCE === '1'
if (source) require('ts-node/register/transpile-only')
const load = name => require(path.join(root, source ? 'src' : 'out', name + (source ? '.ts' : '.js')))
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-activity-integration-'))
process.env.DATA_DIR = path.join(directory, 'database')
process.env.SESSION_HOST = '127.0.0.1'
process.env.SESSION_PORT = '0'
process.env.MULTI_BATTLE_RELAY_PROCESS = 'false'
process.env.LOUNGE_DISBAND_SOCKET_GRACE_MS = '0'
fs.mkdirSync(process.env.DATA_DIR)
const policy = path.join(directory, 'admission.json')
fs.writeFileSync(policy, JSON.stringify({ enforce: false, builds: [], updateMessage: 'isolated activity fixture' }))
process.env.CLIENT_ADMISSION_CONFIG = policy
const originalInterval = global.setInterval
global.setInterval = (...args) => { const timer = originalInterval(...args); timer.unref(); return timer }
const Fastify = require('fastify')
const server = load('multi/tcp/server')
const lounge = load('lounge/state')
const loungeRoutes = load('routes/api/lounge').default
const exchangeRoutes = load('routes/api/multiSpecialExchange').default
const { getDb } = load('data/db')
const { insertAccountSync } = load('data/domains/account')
const { insertDefaultPlayerSync, getPlayerSync } = load('data/domains/player')
const { resolvePlayerIdSync, saveAccountDefaultPlayer } = load('data/activeAccount')
const { insertSessionWithTokenSync } = load('data/domains/session')
const { getPlayerItemSync } = load('data/domains/item')
const { getPlayerMultiSpecialExchangeCampaignsSync, updatePlayerMultiSpecialExchangeCampaignSync } = load('data/domains/campaign')
const characters = require(path.join(root, 'assets/multi_special_exchange_campaign_character.json'))
global.setInterval = originalInterval
const clients = []
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(predicate, label) {
    for (let n = 0; n < 200; n++) { if (predicate()) return; await sleep(10) }
    assert.fail('Timed out: ' + label)
}
function send(socket, value) { socket.write(JSON.stringify(value) + '\0') }
async function handshake(room, viewer, overrides = {}) {
    const socket = net.createConnection({ host: '127.0.0.1', port: server.getSessionServer().address().port })
    socket.frames = []; clients.push(socket); let pending = ''
    socket.on('error', () => {})
    socket.on('data', chunk => {
        pending += chunk.toString()
        for (let end; (end = pending.indexOf('\0')) >= 0;) {
            socket.frames.push(JSON.parse(pending.slice(0, end))); pending = pending.slice(end + 1)
        }
    })
    await new Promise(resolve => socket.once('connect', resolve))
    send(socket, { socklet: 'multi_special_exchange_socklet', viewerId: viewer,
        loungeId: room.id, useCase: 1, establisherViewerId: room.hostViewerId, advice: room.advice, ...overrides })
    await until(() => socket.frames.length > 0, 'handshake result')
    return socket
}
async function open(room, viewer) {
    const socket = await handshake(room, viewer)
    assert.equal(socket.frames[0][0], 0, 'eligible handshake accepted')
    send(socket, [0, [0, { name: 'integration-player', characterId: 1, rank: 1 }]])
    await until(() => room.members.has(viewer) && !room.pendingSockets.has(viewer), 'Enter')
    return socket
}
async function makePlayer(viewer) {
    const account = insertAccountSync({ appId: 'wf_cn', idpAlias: '', idpCode: 'test',
        idpId: 'activity-integration-' + viewer, status: 'normal' })
    const player = insertDefaultPlayerSync(account.id)
    saveAccountDefaultPlayer(account.id, player.id)
    const playerId = resolvePlayerIdSync(account.id)
    updatePlayerMultiSpecialExchangeCampaignSync(playerId, { campaignId: 3, status: 1 })
    insertSessionWithTokenSync({ token: String(viewer), accountId: account.id, expires: new Date(0), type: 2 })
    return { viewer, playerId }
}
test('activity HTTP + real three-client TCP + draw/exchange + stale recovery', async t => {
    const app = Fastify({ logger: false })
    app.addHook('onSend', (_request, reply, payload, done) => done(null,
        String(reply.getHeader('content-type') || '').startsWith('application/x-msgpack') && typeof payload === 'object'
            ? JSON.stringify(payload) : payload))
    await app.register(loungeRoutes, { prefix: '/lounge' })
    await app.register(exchangeRoutes, { prefix: '/multi_special_exchange' })
    await app.ready()
    const post = async (url, payload) => {
        const response = await app.inject({ method: 'POST', url, payload })
        assert.equal(response.statusCode, 200)
        return JSON.parse(response.payload)
    }
    t.after(async () => {
        for (const socket of clients) socket.destroy()
        await server.stopSessionServer(); lounge.resetLoungesForTests(); await app.close(); getDb().close()
        const absolute = path.resolve(directory)
        assert.ok(absolute.startsWith(path.resolve(os.tmpdir()) + path.sep))
        fs.rmSync(absolute, { recursive: true, force: true })
    })
    const players = await Promise.all([301001, 301002, 301003].map(makePlayer))
    const host = players[0]
    const created = await post('/lounge/create', { viewer_id: host.viewer, use_case: 1, campaign_id: 3 })
    assert.equal(created.data_headers.result_code, 1)
    const room = lounge.getLounge(created.data.lounge_id)
    const access = { lounge_id: room.id, use_case: 1, advice: room.advice, establisher_viewer_id: host.viewer }
    await post('/lounge/prepare', { ...access, viewer_id: host.viewer })
    await server.startSessionServer()
    const first = await open(room, host.viewer)
    const second = await open(room, players[1].viewer)
    send(first, [0, [4]])
    await until(() => first.frames.some(frame => frame[1]?.[0] === 6), 'two-player Start rejected')
    assert.equal(room.raisingState, 2)
    const selected = await post('/lounge/select', { ...access, viewer_id: players[2].viewer })
    assert.equal(selected.data.raising_state, 2)
    const third = await open(room, players[2].viewer)
    send(third, [0, [3, [0]]])
    await until(() => room.members.get(players[2].viewer).readyState[0] === 0, 'not ready')
    assert.equal(lounge.loungeCanStart(room), false)
    send(third, [0, [3, [1]]])
    await until(() => lounge.loungeCanStart(room), 'three ready')
    send(first, [0, [4]])
    await until(() => [first, second, third].every(socket => socket.frames.some(frame => frame[1]?.[0] === 5)), 'Start')
    assert.equal(room.raisingState, 97)
    send(first, [0, [4]]); await sleep(40)
    for (const socket of [first, second, third]) assert.equal(socket.frames.filter(frame => frame[1]?.[0] === 5).length, 1)
    for (const player of players) {
        const saved = getPlayerMultiSpecialExchangeCampaignsSync(player.playerId).find(value => value.campaignId === 3)
        assert.equal(saved.status, 2, 'pending ticket was committed before clients receive Start')
        assert.equal(saved.ticketItemId, 980005)
        assert.equal(getPlayerItemSync(player.playerId, 980005) ?? 0, 0, 'Start does not award inventory')
    }
    send(first, [0, [6]])
    await until(() => !room.members.has(host.viewer), 'host finished selection and sent Bye')
    assert.equal(room.raisingState, 97)
    assert.equal(second.frames.some(frame => frame[1]?.[0] === 1), false, 'slow guest not dismissed by host handoff')
    const mateFrames = first.frames.filter(frame => frame[1]?.[0] === 4).length
    third.destroy()
    await until(() => !room.members.has(players[2].viewer), 'selection transition socket retired')
    await sleep(20)
    assert.equal(first.frames.filter(frame => frame[1]?.[0] === 4).length, mateFrames,
        'normal selection handoff must not rebroadcast a roster change')
    for (const player of players) {
        const payload = { viewer_id: player.viewer, campaign_id: 3 }
        const drawn = await post('/multi_special_exchange/multi_draw_ticket', payload)
        assert.equal(drawn.data_headers.result_code, 1)
        assert.equal(drawn.data.multi_special_exchange_campaign_list[0].ticket_item_id, 980005)
        assert.equal(getPlayerItemSync(player.playerId, 980005), 1)
        const replay = await post('/multi_special_exchange/multi_draw_ticket', payload)
        assert.equal(replay.data_headers.result_code, 1)
        assert.equal(getPlayerItemSync(player.playerId, 980005), 1)
        const exchanged = await post('/multi_special_exchange/exchange_character', {
            ...payload, ticket_item_id: 980005, character_id: characters['980005'][0] })
        assert.equal(exchanged.data_headers.result_code, 1)
        assert.equal(getPlayerItemSync(player.playerId, 980005), 0)
        assert.equal(getPlayerMultiSpecialExchangeCampaignsSync(player.playerId).find(value => value.campaignId === 3).status, 4)
    }
    lounge.disbandLounge(room)
    for (const player of players) {
        const restored = await post('/lounge/restore', { ...access, viewer_id: player.viewer })
        assert.equal(restored.data_headers.result_code, 1)
        assert.equal(restored.data.raising_state, 99)
        assert.equal(restored.data.port, 0)
        assert.ok(getPlayerSync(player.playerId))
    }
    await t.test('startup TicketDecided continuation completes once', async () => {
        const player = await makePlayer(301004)
        updatePlayerMultiSpecialExchangeCampaignSync(player.playerId, { campaignId: 3, status: 2, ticketItemId: null })
        const payload = { viewer_id: player.viewer, campaign_id: 3 }
        const drawn = await post('/multi_special_exchange/multi_draw_ticket', payload)
        assert.equal(drawn.data_headers.result_code, 1)
        assert.equal(drawn.data.multi_special_exchange_campaign_list[0].status, 3)
        const replay = await post('/multi_special_exchange/multi_draw_ticket', payload)
        assert.equal(replay.data_headers.result_code, 1)
        assert.equal(getPlayerItemSync(player.playerId, 980005), 1)
    })
    await t.test('direct TCP cannot bypass saved eligibility and stale restore exits normally', async () => {
        const newHost = await makePlayer(301005), blocked = await makePlayer(301006)
        const guest = await makePlayer(301007), extra = await makePlayer(301008)
        updatePlayerMultiSpecialExchangeCampaignSync(blocked.playerId, { campaignId: 3, status: 4 })
        const created = await post('/lounge/create', { viewer_id: newHost.viewer, use_case: 1, campaign_id: 3 })
        const otherRoom = lounge.getLounge(created.data.lounge_id)
        const otherAccess = { lounge_id: otherRoom.id, use_case: 1, advice: otherRoom.advice,
            establisher_viewer_id: newHost.viewer }
        await post('/lounge/prepare', { ...otherAccess, viewer_id: newHost.viewer })
        const denied = await handshake(otherRoom, blocked.viewer)
        assert.equal(denied.frames[0][0], 1)
        assert.equal(lounge.getLoungeOccupancy(otherRoom), 0)
        const invalid = await handshake(otherRoom, guest.viewer, { useCase: true })
        assert.equal(invalid.frames[0][0], 1)
        const restore = await post('/lounge/restore', { ...otherAccess, viewer_id: blocked.viewer })
        assert.equal(restore.data_headers.result_code, 1)
        assert.equal(restore.data.raising_state, 99)
        assert.equal(restore.data.port, 0)
        assert.equal(lounge.getLounge(otherRoom.id), otherRoom, 'one invalid restore does not dismiss other participants')
        await open(otherRoom, guest.viewer)
        await open(otherRoom, extra.viewer)
        const waiting = await makePlayer(301009)
        const fullSearch = await post('/lounge/search', { viewer_id: waiting.viewer, use_case: 1, lounge_number: otherRoom.number })
        assert.equal(fullSearch.data.lounge_exists, false, 'offline host still owns its seat')
        await open(otherRoom, newHost.viewer)
        assert.equal(lounge.loungeCanStart(otherRoom), true)
        assert.equal(getPlayerItemSync(blocked.playerId, 980005) ?? 0, 0)
        // The guest consumed its valid draw in a concurrent single-player
        // flow. Starting the room must not half-transition the other two.
        updatePlayerMultiSpecialExchangeCampaignSync(guest.playerId, { campaignId: 3, status: 4 })
        const hostSocket = [...clients].find(socket => socket !== first && socket.frames[0]?.[0] === 0
            && socket.frames[0]?.[1] === 'lounge-' + newHost.viewer)
        send(hostSocket, [0, [4]])
        await until(() => hostSocket.frames.some(frame => frame[1]?.[0] === 6), 'changed eligibility denied Start')
        assert.equal(otherRoom.raisingState, 2)
        assert.equal(getPlayerMultiSpecialExchangeCampaignsSync(newHost.playerId).find(value => value.campaignId === 3).status, 1)
        assert.equal(getPlayerMultiSpecialExchangeCampaignsSync(extra.playerId).find(value => value.campaignId === 3).status, 1)
        updatePlayerMultiSpecialExchangeCampaignSync(guest.playerId, { campaignId: 3, status: 1 })
        const group = [newHost, guest, extra]
        getDb().exec('CREATE TRIGGER lounge_start_fail BEFORE UPDATE ON players_multi_special_exchange_campaigns '
            + 'WHEN NEW.player_id=' + guest.playerId + " AND NEW.status=2 BEGIN SELECT RAISE(ABORT,'synthetic start failure'); END")
        const failures = hostSocket.frames.filter(frame => frame[1]?.[0] === 6).length
        send(hostSocket, [0, [4]])
        await until(() => hostSocket.frames.filter(frame => frame[1]?.[0] === 6).length > failures, 'group transaction failure')
        assert.equal(otherRoom.raisingState, 2)
        assert.equal(hostSocket.frames.some(frame => frame[1]?.[0] === 5), false)
        for (const player of group) {
            const saved = getPlayerMultiSpecialExchangeCampaignsSync(player.playerId).find(value => value.campaignId === 3)
            assert.equal(saved.status, 1, 'a later participant failure rolls back earlier writes')
            assert.equal(saved.ticketItemId, null)
            assert.equal(getPlayerItemSync(player.playerId, 980005) ?? 0, 0)
        }
        getDb().exec('DROP TRIGGER lounge_start_fail')
        send(hostSocket, [0, [4]])
        await until(() => otherRoom.raisingState === 97, 'retry committed all pending tickets')
        const recover = (participants, roomAccess) => {
            const restarted = spawnSync(process.execPath, [
                path.join(__dirname, 'fixtures/lounge-recovery-process.cjs'),
                root, source ? 'src' : 'out', JSON.stringify(participants), JSON.stringify(roomAccess),
            ], { cwd: root, env: process.env, encoding: 'utf8', timeout: 15000 })
            assert.equal(restarted.status, 0, restarted.stderr + restarted.stdout)
            assert.match(restarted.stdout, /FRESH_PROCESS_RECOVERY_PASSED/)
        }
        recover(group.map(player => ({ ...player, campaignId: 3, ticketItemId: 980005 })), otherAccess)
        for (const player of group) assert.equal(getPlayerItemSync(player.playerId, 980005), 1)
        // Multi-ticket campaign: the decision made by Start must survive a
        // fresh process as well; the draw cannot choose a different ticket.
        for (const player of group) updatePlayerMultiSpecialExchangeCampaignSync(player.playerId, { campaignId: 1, status: 1 })
        const campaignOne = await post('/lounge/create', { viewer_id: newHost.viewer, use_case: 1, campaign_id: 1 })
        const finalRoom = lounge.getLounge(campaignOne.data.lounge_id)
        const finalAccess = { lounge_id: finalRoom.id, use_case: 1, advice: finalRoom.advice, establisher_viewer_id: newHost.viewer }
        await post('/lounge/prepare', { ...finalAccess, viewer_id: newHost.viewer })
        const finalHost = await open(finalRoom, newHost.viewer)
        await open(finalRoom, guest.viewer); await open(finalRoom, extra.viewer)
        send(finalHost, [0, [4]])
        await until(() => finalRoom.raisingState === 97, 'campaign1 Start committed')
        const decided = group.map(player => {
            const saved = getPlayerMultiSpecialExchangeCampaignsSync(player.playerId).find(value => value.campaignId === 1)
            assert.equal(saved.status, 2)
            assert.ok([980001, 980002, 980003].includes(saved.ticketItemId))
            assert.equal(getPlayerItemSync(player.playerId, saved.ticketItemId) ?? 0, 0)
            return { ...player, campaignId: 1, ticketItemId: saved.ticketItemId }
        })
        recover(decided, finalAccess)
        for (const player of decided) assert.equal(getPlayerItemSync(player.playerId, player.ticketItemId), 1)
    })
})
