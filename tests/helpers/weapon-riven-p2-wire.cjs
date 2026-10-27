'use strict'
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path')
const os = require('node:os'), net = require('node:net'), crypto = require('node:crypto')
const { seedParty } = require('./weapon-riven-p2-seed.cjs')
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'weapon-riven-p2-wire-'))
process.env.DATA_DIR = path.join(directory, 'db')
process.env.CLIENT_ADMISSION_CONFIG = path.join(directory, 'admission.json')
process.env.CLIENT_ADMISSION_KEYS = path.join(directory, 'keys.json')
process.env.SESSION_HOST = '127.0.0.1'; process.env.SESSION_PORT = '0'
process.env.MULTI_BATTLE_RELAY_PROCESS = '0'
process.env.NPC_JOIN_DELAY_MS = '5'; process.env.NPC_READY_DELAY_MS = '5'
const out = process.env.STARPOINT_TEST_OUT_DIR || path.resolve(__dirname, '../../out')
const load = name => require(path.join(out, name))
const key = '7a'.repeat(32)
const resources = ['master/ability/ability_soul.orderedmap', 'master/item/equipment.orderedmap',
    'master/item/item.orderedmap', 'master/string/custom_ability_string.orderedmap'].map((logical, index) => {
    const name = `synthetic-resource-${index}.json`, bytes = JSON.stringify({ fixture: true, logical })
    fs.writeFileSync(path.join(directory, name), bytes)
    return { logical, path: name, sha256: crypto.createHash('sha256').update(bytes).digest('hex') }
})
const manifest = { version: 1, resources, soulKeys: [16000001, 15990001, 15990002], weaponIds: [2010002] }
const catalog = load('lib/weapon-riven/multi-catalog').verifyRivenCatalog(manifest, directory).id
process.env.WEAPON_RIVEN_MULTI_CATALOG = path.join(directory, 'catalog.json')
fs.writeFileSync(process.env.WEAPON_RIVEN_MULTI_CATALOG, JSON.stringify(manifest))
process.env.WEAPON_RIVEN_MULTI_ENABLED = '1'
fs.writeFileSync(process.env.CLIENT_ADMISSION_CONFIG, JSON.stringify({ enforce: false, updateMessage: 'isolated fixture', builds: [
    { id: 'p2-wire', name: 'P2 synthetic', enabled: true, allowUntil: null,
        capabilities: ['weapon-riven-v1', 'weapon-riven-multi-v1'], weaponRivenCatalog: catalog },
    { id: 'p1-wire', name: 'P1 synthetic', enabled: true, allowUntil: null, capabilities: ['weapon-riven-v1'] },
    { id: 'p2-other', name: 'Other catalog', enabled: true, allowUntil: null,
        capabilities: ['weapon-riven-v1', 'weapon-riven-multi-v1'], weaponRivenCatalog: 'other_catalog' },
] }))
fs.writeFileSync(process.env.CLIENT_ADMISSION_KEYS, JSON.stringify({ 'p2-wire': key, 'p1-wire': key, 'p2-other': key }))
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(condition, label, timeout = 6000) {
    const end = Date.now() + timeout
    while (!condition()) { if (Date.now() > end) throw Error(`timeout: ${label}`); await sleep(5) }
}
let sequence = 0
function player(build, slot) {
    const index = ++sequence, account = load('data/domains/account').insertAccountSync({ appId: 'wf_cn',
        idpAlias: '', idpCode: 'test', idpId: `p2-wire-${index}`, status: 'normal' })
    const p = load('data/domains/player').insertDefaultPlayerSync(account.id), viewerId = 887000000 + index
    load('data/activeAccount').saveAccountDefaultPlayer(account.id, p.id)
    load('data/domains/session').insertSessionWithTokenSync({ token: String(viewerId), accountId: account.id,
        type: 2, expires: new Date(Date.now() + 86400000) })
    const seeded = seedParty(load, p.id, slot === 0 ? 1 : .25, slot)
    let admissionToken = null, session = null
    if (build) {
        const admission = load('lib/client-admission'), gate = admission.clientAdmission(), ip = `wire-${index}`
        const challenge = gate.challenge({ build, protocol: 1 }, ip).data
        const proof = crypto.createHmac('sha256', Buffer.from(key, 'hex'))
            .update(admission.proofMessage(build, challenge.challenge, challenge.nonce)).digest('hex')
        admissionToken = gate.prove({ challenge: challenge.challenge, proof }, ip).data.token
        session = `wire-session-${index}`; gate.bind(admissionToken, session)
    }
    return { ...seeded, id: p.id, viewerId, cid: `p2-wire-${index}`, admissionToken, session }
}
class Wire {
    constructor(port, member, room, battle = false) {
        Object.assign(this, { member, room, battle, frames: [], buffer: '', closed: false })
        this.socket = net.createConnection({ host: '127.0.0.1', port }); this.socket.setEncoding('utf8'); this.socket.setNoDelay(true)
        this.socket.on('error', () => {}); this.socket.on('close', () => { this.closed = true })
        this.socket.on('data', chunk => {
            this.buffer += chunk; let at
            while ((at = this.buffer.indexOf('\0')) >= 0) {
                const frame = this.buffer.slice(0, at); this.buffer = this.buffer.slice(at + 1)
                if (frame) this.frames.push(JSON.parse(frame))
            }
        })
    }
    send(value) { this.socket.write(JSON.stringify(value) + '\0') }
    async open() {
        await until(() => !this.socket.connecting, 'TCP connect')
        this.send({ socklet: this.battle ? 'cooperation_battle' : 'cooperation_room', viewerId: this.member.viewerId,
            room_number: this.room, connection_id: this.member.cid,
            sp_admission: this.member.admissionToken, sp_session: this.member.session })
        await until(() => this.frames.some(frame => frame[0] === 0), 'TCP handshake')
        if (!this.battle) { this.send([0, [0, {}, 1]]); await until(() => this.messages(0).length, 'Welcome') }
    }
    messages(tag) { return this.frames.filter(frame => frame[0] === 1 && frame[1]?.[0] === tag) }
    prepared() { return this.messages(1).filter(frame => frame[1][1]?.some(mate => mate.party?.weapon_riven_scope === 'multi-v1')) }
    latest() { return this.prepared().at(-1)?.[1][1] }
    ack(members = this.latest(), override) {
        const id = members.find(mate => !mate.comId).party.weapon_riven_snapshot_id
        this.send([0, [9, `WFR2|A|${id}|${override ?? canonical(members)}`]])
    }
    nack(reason, members = this.latest()) {
        this.send([0, [9, `WFR2|N|${members.find(mate => !mate.comId).party.weapon_riven_snapshot_id}|${reason}`]])
    }
    updates(prefix) { return this.messages(8).map(frame => frame[1][1]).filter(text => typeof text === 'string' && text.startsWith(prefix)) }
}
// Independent wire-side encoder follows the fixed scalar contract.
function canonical(members) {
    const context = members.find(member => !member.comId).party
    const values = ['WFR2C1', context.weapon_riven_catalog, context.weapon_riven_mode, members.length]
    const option = value => value[0] === 0 ? value[1] : null
    for (const member of members) {
        values.push(member.comId ? 'C' : 'V', member.comId || member.viewerId)
        for (let slot = 0; slot < 3; slot++) {
            const party = member.party, row = party.weapon_rivens ? option(party.weapon_rivens[slot]) : null
            values.push(option(party.characters[slot])?.id || 0, option(party.unison_characters[slot])?.id || 0,
                option(party.equipments[slot])?.equipmentId || 0, option(party.abilitySoulIds[slot]) || 0, row?.length || 0)
            if (row) values.push(...row)
        }
    }
    return values.join('|')
}
async function fixture(t, builds = ['p2-wire', 'p2-wire'], options = {}) {
    const members = builds.map((build, index) => player(build, index)), runtime = load('multi/coordinator/default-runtime')
    const scope = options.scope ?? { category: 1, quest_id: 9001001 }
    if (options.noRivens) for (const member of members) {
        const parties = load('data/domains/party'), saved = parties.getPlayerPartyGroupListSync(member.id, 1)[1].list[1]
        saved.abilitySoulIds = [null, null, null]
        parties.updatePlayerPartySync(member.id, 1, saved, 1)
    }
    if (options.unknown) for (const member of members) {
        const parties = load('data/domains/party'), saved = parties.getPlayerPartyGroupListSync(member.id, 1)[1].list[1]
        saved.abilitySoulIds[2] = 16000000; saved.equipmentIds[2] = member.weaponId
        parties.updatePlayerPartySync(member.id, 1, saved, 1)
        load('data/domains/item').setPlayerItemSync(member.id, 16000000, 5)
        load('data/domains/player').updatePlayerSync({ id: member.id, rankPoint: 999999999 })
    }
    const app = require('fastify')({ logger: false })
    app.addHook('onSend', (_req, reply, payload, done) => done(null,
        String(reply.getHeader('content-type')).startsWith('application/x-msgpack') && typeof payload === 'object'
            ? JSON.stringify(payload) : payload))
    await app.register(load('multi/http/register').multiBattleRoutes, { prefix: '/multi' })
    await runtime.startRealtimeSessionServer()
    const status = runtime.realtimeOwnerStatus()
    const port = status.endpoint?.port ?? load('multi/tcp/server').getSessionServer().address().port
    const post = (url, member, extra = {}) => app.inject({ method: 'POST', url: `/multi/${url}`,
        payload: { viewer_id: member.viewerId, ...scope, party_id: 1, ...extra } })
    const created = await post('create_room', members[0]); assert.equal(created.statusCode, 200, created.body)
    const room = created.json().data.room_number; assert.ok(room, created.body)
    await post('prepare', members[0], { room_number: room })
    for (const member of members.slice(1)) {
        const selected = await post('select_room', member, { room_number: room,
            access_token: created.json().data.access_token, accepted_type: 0 })
        assert.equal(selected.statusCode, 200, selected.body)
    }
    const wires = []
    t.after(async () => {
        wires.forEach(wire => wire.socket.destroy())
        await runtime.stopRealtimeSessionServer(); await app.close()
    })
    for (const member of members) { const wire = new Wire(port, member, room); wires.push(wire); await wire.open() }
    if (options.com) {
        assert.equal(process.env.MULTI_REALTIME_PROCESS, '0', 'COM fixture uses embedded owner setup')
        load('multi/room/manager').getRoom(room).is_npc_mode = true
        wires[0].send([0, [10, [{ name: 'P2 COM fixture' }]]])
        await until(() => wires.every(wire => wire.messages(1).some(frame => frame[1][1]?.some(mate => mate.comId))), 'COM roster')
        await sleep(30)
    }
    for (const wire of wires) wire.send([0, [3, [1]]])
    await until(() => wires.every(wire => members.every(member => wire.messages(2)
        .some(frame => frame[1][1] === member.cid && frame[1][2]?.[0] === 1))), 'all real peers Ready')
    const startHttp = member => post('start', member, { room_number: room, play_id: `p2-play-${member.id}`,
        use_boost_point: false, use_boss_boost_point: false, is_auto_start_mode: false,
        mate_player_ids: [], mate_party_ids: [], client_battle_party: { weapon_rivens: [[0, [16000001, 1, 15990001, 99]]] } })
    return { members, wires, room, port, runtime, app, post, startHttp, status, load,
        async prepare() { wires[0].send([0, [6]]); await until(() => wires.every(wire => wire.latest()), 'Mates prepare') },
        async started() { await until(() => wires.every(wire => wire.messages(5).length), 'StartBattle') },
        async battle() {
            const battleWires = []
            for (const member of members) { const wire = new Wire(port, member, room, true); wires.push(wire); battleWires.push(wire); await wire.open() }
            return battleWires
        } }
}
module.exports = { fixture, load, Wire, until, sleep, canonical, directory, catalog }
