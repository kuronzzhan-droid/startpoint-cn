'use strict'
// Same contract as weapon-riven-p2-catalog-nack over the real parent/DB-free owner child (reverse RPC).
process.env.MULTI_REALTIME_PROCESS = '1'
const { test, after } = require('node:test'), assert = require('node:assert/strict')
const { fixture, load, until, sleep } = require('./helpers/weapon-riven-p2-wire.cjs')
after(() => { load('lib/client-admission').clientAdmission().close(); load('data/db').getDb().close() })
const contextOf = members => members.find(mate => !mate.comId).party

test('owner child re-decides a client NACK through parent RPC: old parent snapshot cancelled, mode-0 start commits', { timeout: 25000 }, async t => {
    const business = load('lib/weapon-riven/multi-business'), original = business.handleRivenBusiness, calls = []
    t.mock.method(business, 'handleRivenBusiness', async (kind, payload) => {
        calls.push({ kind, preparationId: payload?.identity?.preparationId, disabledReason: payload?.disabledReason })
        return original(kind, payload)
    })
    const x = await fixture(t)
    assert.equal(x.status.mode, 'process'); assert.notEqual(x.status.pid, process.pid)
    const start = x.startHttp(x.members[0])
    await until(() => x.wires.every(wire => wire.latest()), 'owner prepare via reverse RPC')
    const first = structuredClone(x.wires[0].latest())
    assert.equal(contextOf(first).weapon_riven_mode, 1)
    x.wires[1].nack('invalid_snapshot') // the shipped C22/r2/C23 client reason
    await until(() => x.wires.every(wire => wire.prepared().length === 2), 're-decided prepare')
    const second = structuredClone(x.wires[0].latest()), id = contextOf(second).weapon_riven_snapshot_id
    assert.deepEqual(x.wires[1].latest(), second)
    assert.equal(contextOf(second).weapon_riven_mode, 0)
    assert.equal(contextOf(second).weapon_riven_catalog, 'none')
    assert.equal(contextOf(second).weapon_riven_reason, 'catalog_mismatch')
    assert.ok(second.every(mate => JSON.stringify(mate.party.weapon_rivens) === '[[1],[1],[1]]'))
    await until(() => x.wires.every(wire => wire.updates('WFR2_DISABLED|').includes(`WFR2_DISABLED|${id}|catalog_mismatch`)), 'disabled notice')
    await sleep(40); assert.ok(x.wires.every(wire => !wire.messages(5).length))
    x.wires.forEach(wire => wire.ack()); await x.started()
    assert.equal((await start).statusCode, 200)
    assert.equal((await x.startHttp(x.members[1])).statusCode, 200)
    for (const wire of x.wires) assert.deepEqual(wire.messages(5)[0][1][1], second)
    const freezes = calls.filter(call => call.kind === 'riven.freeze')
    assert.equal(freezes.length, 2)
    assert.equal(freezes[0].disabledReason, undefined); assert.equal(freezes[1].disabledReason, 'catalog_mismatch')
    assert.notEqual(freezes[0].preparationId, freezes[1].preparationId)
    assert.ok(calls.some(call => call.kind === 'riven.cancel' && call.preparationId === freezes[0].preparationId), 'old parent snapshot released')
    assert.ok(calls.some(call => call.kind === 'riven.commit' && call.preparationId === freezes[1].preparationId))
    const store = load('lib/weapon-riven/multi-store').rivenSnapshotStore.stats()
    assert.equal(store.committed, 1); assert.equal(store.preparing, 0)
    const battle = await x.battle()
    assert.ok(battle.every(wire => !wire.closed))
})

test('owner child: nobody holds a riven, Start needs no riven ACK', { timeout: 20000 }, async t => {
    const x = await fixture(t, ['p2-wire', 'p2-wire'], { noRivens: true })
    const start = x.startHttp(x.members[0])
    await x.started()
    const prepared = x.wires[0].latest()
    assert.equal(contextOf(prepared).weapon_riven_mode, 0); assert.equal(contextOf(prepared).weapon_riven_reason, 'no_rivens')
    assert.equal((await start).statusCode, 200)
    for (const wire of x.wires) assert.deepEqual(wire.messages(5)[0][1][1], prepared)
})
