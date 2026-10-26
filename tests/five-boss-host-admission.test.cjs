const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'startpoint-five-boss-host-admission-'))
process.env.DATA_DIR = dataDir
const output = process.env.LENS_BUILD_OUT || path.resolve(__dirname, '../out')
const load = name => require(path.join(output, name))
const originalInterval = global.setInterval
global.setInterval = (...args) => { const timer = originalInterval(...args); timer.unref(); return timer }
const { getDb } = load('data/db')
const accounts = load('data/domains/account')
const players = load('data/domains/player')
const items = load('data/domains/item')
const active = load('data/domains/quest_active')
const ledger = load('data/domains/fiveBossGauntletRun')
const runtime = load('multi/five-boss/battle-runtime')
const { FIVE_BOSS_GAUNTLET: mode } = load('multi/five-boss/contract')
const { createRoom } = load('multi/room/manager')
global.setInterval = originalInterval
let sequence = 0

function player(tickets = 4) {
    const id = ++sequence
    const account = accounts.insertAccountSync({ appId: 'wf_cn', idpAlias: '', idpCode: 'test', idpId: `host-admission-${id}`, status: 'normal' })
    const p = players.insertDefaultPlayerSync(account.id)
    players.updatePlayerSync({ id: p.id, stamina: 100, staminaHealTime: new Date() })
    items.setPlayerItemSync(p.id, mode.ticketItemId, tickets)
    load('lib/character').givePlayerCharacterSync(p.id, 111001)
    return { ...p, viewerId: 789000000 + id, playId: `host-admission-play-${id}` }
}

function room(members) {
    const host = members[0]
    const value = createRoom(host.viewerId, host.id, 1, mode.category, mode.visibleQuestId, 0, 111001)
    value.raising_state = 4
    value.mates = members.map(p => ({ viewer_id: p.viewerId, player_id: p.id, com_id: 0 }))
    value.member_viewer_ids = members.map(p => p.viewerId)
    value.member_player_ids = Object.fromEntries(members.map(p => [p.viewerId, p.id]))
    value.five_boss_runtime = {
        runId: `host-admission-run-${++sequence}`,
        expectedRealPlayerIds: members.map(p => p.id),
        autoplayModeByPlayerId: Object.fromEntries(members.map((p, i) => [p.id, i > 0])),
        partyCharacterIdsByPlayerId: Object.fromEntries(members.map(p => [p.id, [111001]])),
        battleIdentityByViewerId: {},
    }
    return value
}

function start(p, value, hostAdmissionAuthorization) {
    return runtime.startFiveBossBattle({ playerId: p.id, clientPlayId: p.playId, room: value,
        requestRoomNumber: value.room_number, requestCategory: mode.category, requestQuestId: mode.visibleQuestId,
        useBoostPoint: false, useBossBoostPoint: false, hostAdmissionAuthorization })
}

function finalize(p, value) {
    for (const signal of ['scene_ready', 'level_next', 'finalize']) {
        ledger.recordMemberBattleSignalSync({ runId: value.five_boss_runtime.runId,
            playerId: p.id, roomNumber: value.room_number, signal })
    }
}

function oldBattle(finalized = false) {
    const host = player(), oldRoom = room([host])
    start(host, oldRoom)
    if (finalized) finalize(host, oldRoom)
    const authorization = { playId: host.playId, recoverable: false, reason: 'result_pending', retained: true }
    return { host, oldRoom, authorization }
}

function nextBattle(host) {
    const nextHost = { ...host, playId: `next-${host.playId}` }, guest = player()
    return { host: nextHost, guest, nextRoom: room([nextHost, guest]) }
}

function snapshot() {
    const database = getDb()
    const quote = value => '"' + value.replace(/"/g, '""') + '"'
    return database.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({ name }) => {
        const rows = database.prepare(`SELECT * FROM ${quote(name)}`).safeIntegers(true).raw().all().map(row =>
            JSON.stringify(row.map(value => Buffer.isBuffer(value) ? { blob: value.toString('hex') }
                : typeof value === 'bigint' ? { integer: value.toString() } : value))).sort()
        return { name, rows }
    })
}

function rejectsUnchanged(action) {
    const before = snapshot()
    assert.throws(action, error => error instanceof ledger.FiveBossGauntletRunError && error.code === 'run_conflict')
    assert.deepEqual(snapshot(), before)
}

test('a guest cannot charge a host whose previous battle is still playing', () => {
    const old = oldBattle(), next = nextBattle(old.host)
    rejectsUnchanged(() => start(next.guest, next.nextRoom,
        { playId: old.host.playId, recoverable: true, reason: 'active' }))
})

test('result_pending authorization cannot detach a host without durable Finalize proof', () => {
    const old = oldBattle(), next = nextBattle(old.host)
    rejectsUnchanged(() => start(next.guest, next.nextRoom, old.authorization))
})

test('a finalized host still needs an exact owner authorization before first payment', () => {
    const old = oldBattle(true), next = nextBattle(old.host)
    for (const authorization of [undefined,
        { ...old.authorization, playId: 'different-play' },
        { ...old.authorization, recoverable: true },
        { ...old.authorization, reason: 'unknown' },
        { ...old.authorization, reason: 'recoverable' }]) {
        rejectsUnchanged(() => start(next.guest, next.nextRoom, authorization))
    }
})

test('known nonrecoverable owner outcomes admit a finalized host only with durable SQL proof', () => {
    for (const reason of ['missing_room_number', 'room_missing', 'room_not_in_battle', 'quest_mismatch',
        'member_not_in_battle', 'battle_identity_missing', 'battle_identity_mismatch']) {
        const old = oldBattle(true), next = nextBattle(old.host)
        assert.equal(start(next.guest, next.nextRoom, { ...old.authorization, reason }).startStatus, 'started', reason)
        assert.equal(active.getPlayerActiveQuestSync(old.host.id), null, reason)
        start(next.host, next.nextRoom)
        assert.equal(items.getPlayerItemSync(old.host.id, mode.ticketItemId), 2, reason)
        assert.equal(players.getPlayerSync(old.host.id).totalStaminaUsed, 70, reason)
    }
})

test('room_missing without Finalize proof cannot release host occupancy or charge a new run', () => {
    const old = oldBattle(), next = nextBattle(old.host)
    rejectsUnchanged(() => start(next.guest, next.nextRoom, { ...old.authorization, reason: 'room_missing' }))
})

test('a host play replaced after owner prepare cannot be detached or charged', () => {
    const old = oldBattle(true), next = nextBattle(old.host)
    active.insertPlayerActiveQuestSync(old.host.id, { ...active.getPlayerActiveQuestSync(old.host.id), playId: 'replacement-play' })
    rejectsUnchanged(() => start(next.guest, next.nextRoom, old.authorization))
})

test('finalized host detaches for guest-first admission; host and retries do not pay twice', () => {
    const old = oldBattle(true), next = nextBattle(old.host)
    const oldMemberBefore = getDb().prepare('SELECT * FROM five_boss_gauntlet_members WHERE run_id = ? AND player_id = ?')
        .get(old.oldRoom.five_boss_runtime.runId, old.host.id)
    players.updatePlayerSync({ id: next.guest.id, stamina: 0, staminaHealTime: new Date() })
    assert.equal(start(next.guest, next.nextRoom, old.authorization).startStatus, 'started')
    assert.equal(active.getPlayerActiveQuestSync(old.host.id), null)
    assert.equal(active.getPlayerActiveQuestSync(next.guest.id).playId, next.guest.playId)
    assert.equal(items.getPlayerItemSync(old.host.id, mode.ticketItemId), 2)
    assert.equal(players.getPlayerSync(old.host.id).stamina, 30)
    assert.equal(players.getPlayerSync(old.host.id).totalStaminaUsed, 70)
    assert.equal(players.getPlayerSync(next.guest.id).stamina, 0)
    assert.equal(start(next.host, next.nextRoom).startStatus, 'started')
    assert.equal(start(next.guest, next.nextRoom).startStatus, 'already_started')
    assert.equal(start(next.host, next.nextRoom).startStatus, 'already_started')
    assert.equal(items.getPlayerItemSync(old.host.id, mode.ticketItemId), 2)
    assert.equal(players.getPlayerSync(old.host.id).totalStaminaUsed, 70)
    const oldMemberAfter = getDb().prepare('SELECT * FROM five_boss_gauntlet_members WHERE run_id = ? AND player_id = ?')
        .get(old.oldRoom.five_boss_runtime.runId, old.host.id)
    for (const key of ['client_play_id', 'battle_entered_at', 'level_next_at', 'finalized_at', 'aborted_at']) {
        assert.equal(oldMemberAfter[key], oldMemberBefore[key], key)
    }
    assert.equal(getDb().prepare('SELECT COUNT(*) AS n FROM five_boss_gauntlet_receipts WHERE run_id = ?')
        .get(old.oldRoom.five_boss_runtime.runId).n, 0)
    assert.equal(ledger.getFiveBossRunByClientSync({ playerId: old.host.id, clientPlayId: old.host.playId }).status, 'active')
})

test('a late guest active SQL failure rolls back host detach, fee and the entire new run', () => {
    const old = oldBattle(true), next = nextBattle(old.host)
    getDb().exec(`CREATE TEMP TRIGGER reject_host_admission_guest BEFORE INSERT ON players_active_quests
        WHEN NEW.player_id = ${next.guest.id} BEGIN SELECT RAISE(ABORT, 'host admission late persist failure'); END`)
    try {
        const before = snapshot()
        assert.throws(() => start(next.guest, next.nextRoom, old.authorization), /host admission late persist failure/)
        assert.deepEqual(snapshot(), before)
    } finally { getDb().exec('DROP TRIGGER reject_host_admission_guest') }
})

test('domain start persistence failure rolls back an authorized host detach and first fee', () => {
    const old = oldBattle(true), next = nextBattle(old.host)
    const before = snapshot()
    assert.throws(() => ledger.startMemberSync({ runId: next.nextRoom.five_boss_runtime.runId,
        hostPlayerId: next.host.id, routeId: mode.routeId, roomNumber: next.nextRoom.room_number,
        ticketItemId: mode.ticketItemId, hostStaminaCost: 35, rosterPlayerIds: [next.host.id, next.guest.id],
        playerId: next.guest.id, clientPlayId: next.guest.playId, isAutoMode: true,
        hostAdmissionAuthorization: old.authorization }, () => { throw new Error('host admission persist callback failure') }),
    /host admission persist callback failure/)
    assert.deepEqual(snapshot(), before)
})

test('a free host admits a zero-stamina guest first and the existing run charges only once', () => {
    const host = player(1), guest = player(0), value = room([host, guest])
    players.updatePlayerSync({ id: guest.id, stamina: 0, staminaHealTime: new Date() })
    start(guest, value)
    assert.equal(active.getPlayerActiveQuestSync(host.id), null)
    assert.equal(items.getPlayerItemSync(host.id, mode.ticketItemId), 0)
    assert.equal(players.getPlayerSync(host.id).stamina, 65)
    start(host, value)
    start(guest, value)
    assert.equal(items.getPlayerItemSync(host.id, mode.ticketItemId), 0)
    assert.equal(players.getPlayerSync(host.id).totalStaminaUsed, 35)
    assert.equal(players.getPlayerSync(guest.id).stamina, 0)
})

after(() => {
    getDb().close()
    const resolved = path.resolve(dataDir)
    assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep))
    assert.ok(path.basename(resolved).startsWith('startpoint-five-boss-host-admission-'))
    fs.rmSync(resolved, { recursive: true })
})
