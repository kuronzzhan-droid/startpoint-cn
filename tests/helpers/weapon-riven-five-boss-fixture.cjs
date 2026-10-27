const { after, mock } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'weapon-riven-five-boss-'))
process.env.DATA_DIR = dataDir
process.env.CLIENT_ADMISSION_CONFIG = path.join(dataDir, 'admission.json')
process.env.CLIENT_ADMISSION_KEYS = path.join(dataDir, 'keys.json')
fs.writeFileSync(process.env.CLIENT_ADMISSION_CONFIG, JSON.stringify({ enforce: false, builds: [] }))
fs.writeFileSync(process.env.CLIENT_ADMISSION_KEYS, '{}')
const output = process.env.LENS_BUILD_OUT || path.resolve(__dirname, '../../out')
const load = name => require(path.join(output, name))
const interval = global.setInterval
global.setInterval = (...args) => { const timer = interval(...args); timer.unref(); return timer }
const { getDb } = load('data/db')
const players = load('data/domains/player')
const items = load('data/domains/item')
const rivens = load('data/domains/weaponRiven')
const runtime = load('multi/five-boss/battle-runtime')
const ledger = load('data/domains/fiveBossGauntletRun')
const { FIVE_BOSS_GAUNTLET: mode } = load('multi/five-boss/contract')
const singleRoutes = load('routes/api/singleBattleQuest').default
global.setInterval = interval
let sequence = 0
const unknown = 16000000
// Keep these receipt/identity fixtures stable, including HTTP paths using the default source.
mock.method(Math, 'random', () => 0)

function player(souls = [unknown, 0, 0]) {
    const account = load('data/domains/account').insertAccountSync({ appId: 'wf_cn', idpAlias: '',
        idpCode: 'test', idpId: `riven-five-${++sequence}`, status: 'normal' })
    const p = players.insertDefaultPlayerSync(account.id)
    load('data/activeAccount').saveAccountDefaultPlayer(account.id, p.id)
    players.updatePlayerSync({ id: p.id, stamina: 100, staminaHealTime: new Date() })
    items.setPlayerItemSync(p.id, mode.ticketItemId, 2)
    items.setPlayerItemSync(p.id, unknown, 5)
    load('lib/character').givePlayerCharacterSync(p.id, 111001)
    getDb().prepare('DELETE FROM players_equipment WHERE player_id=?').run(p.id)
    load('data/domains/equipment').insertPlayerEquipmentSync(p.id, 300101,
        { level: 1, enhancementLevel: 0, protection: false, stack: 0 })
    getDb().prepare(`INSERT OR IGNORE INTO players_party_groups(player_id,id,category,color_id) VALUES (?,1,1,15)`).run(p.id)
    getDb().prepare(`INSERT OR REPLACE INTO players_parties(player_id,group_id,slot,category,name,character_id_1,
        equipment_1,ability_soul_1,ability_soul_2,ability_soul_3,edited) VALUES (?,1,1,1,'Riven',111001,300101,?,?,?,1)`)
        .run(p.id, ...souls.map(id => id || null))
    return { ...p, accountId: account.id, viewerId: 971000000 + sequence, playId: `riven-play-${sequence}` }
}
function identity(p, room) {
    return { playerId: p.id, clientPlayId: p.playId, requestRoomNumber: room.room_number,
        requestCategory: mode.category, requestQuestId: mode.visibleQuestId }
}
function multi(p, peers = [], partyId = 1) {
    const members = [p, ...peers]
    const room = load('multi/room/manager').createRoom(p.viewerId, p.id, partyId, mode.category, mode.visibleQuestId, 0, 111001)
    room.raising_state = 4
    room.five_boss_runtime = { runId: `riven-run-${sequence}`, expectedRealPlayerIds: members.map(member => member.id),
        autoplayModeByPlayerId: Object.fromEntries(members.map(member => [member.id, false])),
        partyCharacterIdsByPlayerId: Object.fromEntries(members.map(member => [member.id, [111001]])),
        weaponRivenLoadoutByPlayerId: Object.fromEntries(members.map(member => [member.id,
            load('lib/weapon-riven/battle').getSoloWeaponRivenStartLoadoutSync(member.id, partyId)])),
        battleIdentityByViewerId: {} }
    for (const member of members) {
        runtime.startFiveBossBattle({ ...identity(member, room), room, useBoostPoint: false, useBossBoostPoint: false })
        for (const signal of ['level_next', 'finalize']) ledger.recordMemberBattleSignalSync({
            runId: room.five_boss_runtime.runId, playerId: member.id, roomNumber: room.room_number, signal })
    }
    return room
}
function finishMulti(p, room, accomplished = true, randomFloat = () => 0) {
    return runtime.finishFiveBossBattle({ ...identity(p, room), accomplished, elapsedTimeMs: 30000, randomFloat })
}
async function appFor(p) {
    await load('data/domains/session').insertSessionWithToken({ token: String(p.viewerId), accountId: p.accountId,
        expires: new Date(Date.now() + 86400000), type: 2 })
    const app = require('fastify')({ logger: false })
    app.addHook('onSend', (_req, reply, payload, done) => {
        done(null, String(reply.getHeader('content-type')).startsWith('application/x-msgpack')
            && typeof payload === 'object' ? JSON.stringify(payload) : payload)
    })
    await singleRoutes(app)
    return app
}
function startBody(p) {
    return { viewer_id: p.viewerId, play_id: p.playId, quest_id: mode.visibleQuestId, category: mode.category,
        party_id: 1, use_boost_point: false, use_boss_boost_point: false, is_auto_start_mode: false, api_count: 1 }
}
function finishBody(p, accomplished = true) {
    return { ...startBody(p), api_count: 2, is_accomplished: accomplished, elapsed_time_ms: 30000,
        score: 100, add_mana: 0, continue_count: 0, statistics: { clear_phase: 1, max_combo_count: 0,
            party: { characters: [{ id: 111001 }], unison_characters: [], equipments: [], ability_soul_ids: [] } } }
}
function count(p) { return Object.keys(rivens.getPlayerWeaponRivenListSync(p.id)).length }
function seedCards(p, amount) {
    getDb().transaction(() => {
        for (let index = 0; index < amount; index++) rivens.insertWeaponRivenSync(p.id, 300101, [[15990001, 50]], `seed:${index}`, () => 0)
    })()
}
function savedParty(p, category, group, slot, souls) {
    getDb().prepare('INSERT OR IGNORE INTO players_party_groups(player_id,id,category,color_id) VALUES (?,?,?,15)')
        .run(p.id, group, category)
    getDb().prepare(`INSERT OR REPLACE INTO players_parties(player_id,category,group_id,slot,name,character_id_1,
        equipment_1,ability_soul_1,ability_soul_2,ability_soul_3,edited) VALUES (?,?,?,?,'Saved',111001,300101,?,?,?,1)`)
        .run(p.id, category, group, slot, ...souls)
}
function savedSouls(p, category = 1, group = 1, slot = 1) {
    const row = getDb().prepare(`SELECT ability_soul_1,ability_soul_2,ability_soul_3 FROM players_parties
        WHERE player_id=? AND category=? AND group_id=? AND slot=?`).get(p.id, category, group, slot)
    return [row.ability_soul_1, row.ability_soul_2, row.ability_soul_3]
}
async function httpMulti(p, room) {
    let status, payload
    const reply = { raw: new (require('node:events').EventEmitter)(),
        header() { return this }, status(value) { status = value; return this },
        send(value) { payload = value; return value } }
    await load('multi/http/five-boss-battle').handleFiveBossFinish({ ...finishBody(p), room_number: room.room_number }, p.id, reply, async () => [])
    assert.equal(status, 200)
    return payload
}


after(() => {
    getDb().close()
    const target = path.resolve(dataDir)
    assert.ok(target.startsWith(path.resolve(os.tmpdir()) + path.sep))
    assert.ok(path.basename(target).startsWith('weapon-riven-five-boss-'))
    fs.rmSync(target, { recursive: true, force: true })
})

module.exports = { load, getDb, items, rivens, runtime, ledger, mode, unknown, player, identity, multi, finishMulti,
    appFor, startBody, finishBody, count, seedCards, savedParty, savedSouls, httpMulti }
