'use strict'
process.env.MULTI_REALTIME_PROCESS = '0'
const { test, after } = require('node:test'), assert = require('node:assert/strict')
const { fixture, load, until, sleep, canonical } = require('./helpers/weapon-riven-p2-wire.cjs')
after(() => { load('lib/client-admission').clientAdmission().close(); load('data/db').getDb().close() })

test('P2 real TCP first freezes same-item per-player rows, ignores forged Enter, and waits for all ACKs', { timeout: 20000 }, async t => {
    const x = await fixture(t)
    x.wires[0].send([0, [0, { party: { ...x.wires[0].messages(0)[0][1][1].party, weapon_rivens: [[0, [16000001, 1, 15990001, 1]]],
        weapon_riven_snapshot_id: 'forged', weapon_riven_mode: 1 } }, 1]])
    await x.prepare()
    const prepared = x.wires[0].latest()
    assert.deepEqual(x.wires[1].latest(), prepared)
    assert.equal(prepared[0].party.weapon_riven_mode, 1)
    for (let index = 0; index < 2; index++) {
        const m = x.members[index], mate = prepared.find(entry => entry.viewerId === m.viewerId)
        assert.deepEqual(mate.party.weapon_rivens[index], [0, [16000001, m.weaponId, m.key, m.level]])
    }
    assert.equal(JSON.stringify(prepared).includes('pending_json'), false)
    assert.equal(JSON.stringify(prepared).includes('admissionToken'), false)
    x.wires[0].ack(); x.wires[0].ack(); x.wires[0].send([0, [6]])
    const heartbeatCount = x.wires[1].messages(11).length
    x.wires[1].send([0, [4]])
    await until(() => x.wires[1].messages(11).length > heartbeatCount, 'heartbeat while ACK pending')
    assert.ok(x.wires.every(wire => !wire.messages(5).length))
    x.wires[1].ack(); await x.started()
    for (const wire of x.wires) assert.deepEqual(wire.messages(5)[0][1][1], prepared)
    assert.equal(x.wires[0].prepared().length, 1, 'duplicate Start joins one frozen candidate')
    await Promise.all(x.members.map(member => x.startHttp(member)))
    const battle = await x.battle()
    battle[0].send([0, [0]]); await sleep(30)
    assert.equal(battle[0].messages(1).length, 0, 'SceneReady still waits for peer')
    battle[1].send([0, [0]])
    await until(() => battle.every(wire => wire.messages(1).length === 1), 'original battle barrier')
    for (let scene = 1; scene < 5; scene++) {
        battle.forEach(wire => wire.send([0, [1]])); await sleep(20)
        battle.forEach(wire => wire.send([0, [0]]))
        await until(() => battle.every(wire => wire.messages(1).length === scene + 1), `scene ${scene}`)
    }
    assert.equal(canonical(prepared), canonical(x.wires[0].messages(5)[0][1][1]))
})

test('P2 real HTTP first and concurrent /start wait outside owner queue; no active quest before ACK', { timeout: 20000 }, async t => {
    const x = await fixture(t), db = load('data/db').getDb()
    let complete = false
    const first = x.startHttp(x.members[0]).then(response => { complete = true; return response })
    await until(() => x.wires.every(wire => wire.latest()), 'HTTP prepares all TCP peers')
    const second = x.startHttp(x.members[1])
    await sleep(40)
    assert.equal(complete, false)
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM players_active_quests WHERE player_id IN (?,?)')
        .get(...x.members.map(m => m.id)).n, 0)
    x.wires.forEach(wire => wire.ack())
    await x.started()
    for (const response of await Promise.all([first, second])) assert.equal(response.statusCode, 200, response.body)
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM players_active_quests WHERE player_id IN (?,?)')
        .get(...x.members.map(m => m.id)).n, 2)
})

test('bad canonical cancels before Start and late ACK cannot confirm a new candidate', { timeout: 20000 }, async t => {
    const x = await fixture(t); await x.prepare()
    const old = structuredClone(x.wires[0].latest())
    x.wires[0].ack(old, canonical(old) + ',99')
    await until(() => x.wires.every(wire => wire.messages(8).some(frame => frame[1][1].startsWith('WFR2_CANCEL|'))), 'cancel notice')
    assert.ok(x.wires.every(wire => !wire.messages(5).length))
    for (const wire of x.wires) wire.send([0, [3, [1]]])
    await sleep(30); x.wires[0].send([0, [6]])
    await until(() => x.wires.every(wire => wire.prepared().length === 2), 'new candidate in same generation')
    assert.notEqual(x.wires[0].latest()[0].party.weapon_riven_snapshot_id, old[0].party.weapon_riven_snapshot_id)
    x.wires.forEach(wire => wire.ack(old)); await sleep(30)
    assert.ok(x.wires.every(wire => !wire.messages(5).length))
    x.wires.forEach(wire => wire.ack()); await x.started()
})

for (const peerBuild of ['p1-wire', null, 'p2-other']) test(`mixed ${peerBuild ?? 'legacy'} disables whole room and waits only for P2 ACKs`, { timeout: 15000 }, async t => {
    const x = await fixture(t, ['p2-wire', peerBuild]); await x.prepare()
    const prepared = x.wires[0].latest()
    for (const member of prepared) {
        assert.equal(member.party.weapon_riven_mode, 0)
        assert.equal(member.party.weapon_riven_catalog, 'none')
        assert.deepEqual(member.party.weapon_rivens, [[1], [1], [1]])
        assert.deepEqual(member.party.abilitySoulIds, [[1], [1], [1]])
    }
    x.wires[0].ack()
    if (peerBuild === 'p2-other') {
        await sleep(40); assert.ok(x.wires.every(wire => !wire.messages(5).length))
        x.wires[1].ack()
    }
    await x.started()
})

test('three authenticated TCP peers require the third ACK; duplicate first ACK never counts twice', { timeout: 15000 }, async t => {
    const x = await fixture(t, ['p2-wire', 'p2-wire', 'p2-wire']); await x.prepare()
    x.wires[0].ack(); x.wires[0].ack(); x.wires[1].ack(); await sleep(40)
    assert.ok(x.wires.every(wire => !wire.messages(5).length))
    x.wires[2].ack(); await x.started()
    assert.deepEqual(x.wires[0].messages(5)[0], x.wires[2].messages(5)[0])
})

test('lost ACK times out with explicit cancellation and never starts or creates an active quest', { timeout: 20000 }, async t => {
    const x = await fixture(t); await x.prepare(); x.wires[0].ack()
    await until(() => x.wires[0].messages(8).some(frame => frame[1][1].endsWith('|timeout')), 'lost ACK timeout', 12000)
    assert.ok(x.wires.every(wire => !wire.messages(5).length))
    assert.equal(load('data/db').getDb().prepare('SELECT COUNT(*) AS n FROM players_active_quests WHERE player_id IN (?,?)')
        .get(...x.members.map(m => m.id)).n, 0)
})
