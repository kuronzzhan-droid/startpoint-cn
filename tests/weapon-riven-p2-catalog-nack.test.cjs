'use strict'
// 2026-10-27: a P2 client that cannot accept an enabled prepare NACKs it. The shipped C22/r2/C23 client always sends
// `WFR2|N|<snapshot>|invalid_snapshot` (catalog constant mismatch, missing tables, invalid context); `catalog` is the
// reserved explicit reason. The owner re-decides
// the room once as disabled (mode 0, catalog none, reason catalog_mismatch) and the ordinary two-phase start continues.
// Other NACK reasons still cancel. A room where nobody holds any riven never waits on a riven ACK.
process.env.MULTI_REALTIME_PROCESS = '0'
const { test, after } = require('node:test'), assert = require('node:assert/strict')
const { fixture, load, until, sleep } = require('./helpers/weapon-riven-p2-wire.cjs')
after(() => { load('lib/client-admission').clientAdmission().close(); load('data/db').getDb().close() })
const noStart = x => x.wires.every(wire => !wire.messages(5).length)
const contextOf = members => members.find(mate => !mate.comId).party

function assertDisabled(members, reason) {
    for (const mate of members) {
        if (mate.comId) { assert.equal(Object.keys(mate.party).some(key => key.startsWith('weapon_riven')), false); continue }
        assert.equal(mate.party.weapon_riven_mode, 0)
        assert.equal(mate.party.weapon_riven_catalog, 'none')
        assert.equal(mate.party.weapon_riven_reason, reason)
        assert.deepEqual(mate.party.weapon_rivens, [[1], [1], [1]])
        assert.ok(mate.party.abilitySoulIds.every(slot => slot[0] === 1 || slot[1] < 16000001 || slot[1] > 16000999))
    }
}

for (const reason of ['invalid_snapshot', 'catalog']) test(`${reason} NACK re-decides the whole room as mode 0 and the start proceeds after fresh ACKs`, { timeout: 20000 }, async t => {
    const x = await fixture(t); await x.prepare()
    const first = structuredClone(x.wires[0].latest()), firstId = contextOf(first).weapon_riven_snapshot_id
    assert.equal(contextOf(first).weapon_riven_mode, 1)
    x.wires[0].ack()
    x.wires[1].nack(reason)
    await until(() => x.wires.every(wire => wire.prepared().length === 2), 're-decided prepare')
    const second = x.wires[0].latest(), secondId = contextOf(second).weapon_riven_snapshot_id
    assert.deepEqual(x.wires[1].latest(), second)
    assert.notEqual(secondId, firstId)
    assertDisabled(second, 'catalog_mismatch')
    await until(() => x.wires.every(wire => wire.updates('WFR2_DISABLED|').length), 'disabled notice')
    for (const wire of x.wires) {
        assert.deepEqual(wire.updates('WFR2_DISABLED|'), [`WFR2_DISABLED|${secondId}|catalog_mismatch`])
        assert.deepEqual(wire.updates('WFR2_CANCEL|'), [], 'a catalog NACK is not a cancellation')
    }
    assert.ok(noStart(x))
    x.wires.forEach(wire => wire.ack(first)); await sleep(40)
    assert.ok(noStart(x), 'ACKs of the superseded enabled prepare never count')
    x.wires[0].ack(); await sleep(40)
    assert.ok(noStart(x), 'every P2 member must ACK the re-decided prepare')
    x.wires[1].ack(); await x.started()
    for (const wire of x.wires) assert.deepEqual(wire.messages(5)[0][1][1], second)
    for (const response of await Promise.all(x.members.map(member => x.startHttp(member)))) assert.equal(response.statusCode, 200, response.body)
    const battle = await x.battle()
    assert.ok(battle.every(wire => !wire.closed), 'mode-0 battle sockets are admitted')
    const store = load('lib/weapon-riven/multi-store').rivenSnapshotStore
    assert.equal(store.stats().committed >= 1, true)
})

test('a NACK with another reason still cancels before Start', { timeout: 15000 }, async t => {
    const x = await fixture(t); await x.prepare()
    const id = contextOf(x.wires[0].latest()).weapon_riven_snapshot_id
    x.wires[0].ack(); x.wires[1].nack('user_rejected')
    await until(() => x.wires.every(wire => wire.updates('WFR2_CANCEL|').length), 'cancel notice')
    for (const wire of x.wires) assert.deepEqual(wire.updates('WFR2_CANCEL|'), [`WFR2_CANCEL|${id}|client_rejected`])
    await sleep(40)
    assert.ok(x.wires.every(wire => wire.prepared().length === 1), 'no re-decided prepare')
    assert.ok(noStart(x))
})

test('only one re-decision: a NACK of the disabled prepare cancels', { timeout: 15000 }, async t => {
    const x = await fixture(t); await x.prepare()
    x.wires[1].nack('invalid_snapshot')
    await until(() => x.wires.every(wire => wire.prepared().length === 2), 're-decided prepare')
    const id = contextOf(x.wires[0].latest()).weapon_riven_snapshot_id
    x.wires[1].nack('invalid_snapshot')
    await until(() => x.wires.every(wire => wire.updates('WFR2_CANCEL|').length), 'cancel notice')
    for (const wire of x.wires) assert.deepEqual(wire.updates('WFR2_CANCEL|'), [`WFR2_CANCEL|${id}|client_rejected`])
    await sleep(40)
    assert.ok(x.wires.every(wire => wire.prepared().length === 2))
    assert.ok(noStart(x))
})

test('client NACK in a room with a server COM still starts with the COM', { timeout: 20000 }, async t => {
    const x = await fixture(t, ['p2-wire', 'p2-wire'], { com: true }); await x.prepare()
    const first = x.wires[0].latest()
    assert.equal(first.length, 3); assert.ok(first.find(mate => mate.comId))
    x.wires[0].nack('invalid_snapshot')
    await until(() => x.wires.every(wire => wire.prepared().length === 2), 're-decided prepare')
    const second = x.wires[0].latest()
    assert.equal(second.length, 3)
    assert.deepEqual(second.find(mate => mate.comId).comId, first.find(mate => mate.comId).comId)
    assertDisabled(second, 'catalog_mismatch')
    x.wires.forEach(wire => wire.ack()); await x.started()
    for (const wire of x.wires) assert.deepEqual(wire.messages(5)[0][1][1], second)
})

test('gate on but nobody holds a riven: disabled with an empty ACK set, starts without any ACK and ignores a NACK', { timeout: 15000 }, async t => {
    const x = await fixture(t, ['p2-wire', 'p2-wire'], { noRivens: true }); await x.prepare()
    const prepared = x.wires[0].latest()
    assertDisabled(prepared, 'no_rivens')
    x.wires[1].nack('invalid_snapshot')
    await x.started()
    for (const wire of x.wires) {
        assert.deepEqual(wire.messages(5)[0][1][1], prepared)
        assert.deepEqual(wire.updates('WFR2_DISABLED|'), [], 'no notice: nothing was disabled')
        assert.deepEqual(wire.updates('WFR2_CANCEL|'), [])
        assert.equal(wire.prepared().length, 1)
    }
    for (const response of await Promise.all(x.members.map(member => x.startHttp(member)))) assert.equal(response.statusCode, 200, response.body)
})

test('an unknown riven alone still counts as holding a riven (conversion needs the frozen snapshot)', { timeout: 15000 }, async t => {
    const x = await fixture(t, ['p2-wire', 'p2-wire'], { noRivens: true, unknown: true }); await x.prepare()
    assert.equal(contextOf(x.wires[0].latest()).weapon_riven_mode, 1)
    await sleep(40); assert.ok(noStart(x), 'enabled room waits for ACKs')
    x.wires.forEach(wire => wire.ack()); await x.started()
})
