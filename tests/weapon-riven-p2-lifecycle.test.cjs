'use strict'
process.env.MULTI_REALTIME_PROCESS = '0'
const { test, after } = require('node:test'), assert = require('node:assert/strict')
const { fixture, Wire, load, until, sleep } = require('./helpers/weapon-riven-p2-wire.cjs')
after(() => { load('lib/client-admission').clientAdmission().close(); load('data/db').getDb().close() })
const cancelled = wire => wire.messages(8).some(frame => frame[1][1].startsWith('WFR2_CANCEL|'))

test('two real P2 peers plus server COM agree while COM receives no private context and sends no ACK', { timeout: 15000 }, async t => {
    const business = load('multi/coordinator/business-handlers'), original = business.handleRealtimeBusiness
    t.mock.method(business, 'handleRealtimeBusiness', async (kind, payload) => {
        try { return await original(kind, payload) } catch (error) { t.diagnostic(`${kind}: ${error.message}`); throw error }
    })
    const x = await fixture(t, ['p2-wire', 'p2-wire'], { com: true })
    try { await x.prepare() } catch (error) {
        const room = load('multi/room/manager').getRoom(x.room)
        t.diagnostic(JSON.stringify({ room: { mates: room.mates, phase: room.lifecycle.phase, generation: room.lobby_generation },
            clients: load('multi/state/SessionManager').sessionManager.getClientsInRoom(x.room)
                .map(client => ({ viewer: client.viewerId, state: client.yourself?.state, mates: client.mates.map(mate => ({ viewer: mate.viewerId, com: mate.comId, state: mate.state })) })) }))
        throw error
    }
    const mates = x.wires[0].latest(), npc = mates.find(mate => mate.comId)
    assert.equal(mates.length, 3); assert.ok(npc)
    assert.equal(Object.keys(npc.party).some(key => key.startsWith('weapon_riven')), false)
    assert.ok(npc.party.abilitySoulIds.every(slot => slot[0] === 1 || slot[1] < 16000000 || slot[1] > 16000999))
    x.wires.forEach(wire => wire.ack()); await x.started()
    assert.deepEqual(x.wires[0].messages(5)[0][1][1], mates)
})

test('all P1 peers keep ordinary multiplayer with an empty ACK set', { timeout: 15000 }, async t => {
    const x = await fixture(t, ['p1-wire', 'p1-wire']); await x.prepare(); await x.started()
    assert.ok(x.wires[0].latest().every(mate => mate.party.weapon_riven_mode === 0))
})

test('ChangeParty cancels frozen candidate and a late previous ACK cannot release the new party', { timeout: 15000 }, async t => {
    const x = await fixture(t); await x.prepare()
    const old = structuredClone(x.wires[0].latest()), p = x.members[1]
    const groups = load('data/domains/party').getPlayerPartyGroupListSync(p.id, 1)
    load('data/domains/party').updatePlayerPartySync(p.id, 2, { ...groups[1].list[1], name: 'second P2 party' }, 1)
    x.wires[1].send([0, [2, { currentPartyId: 2, party: x.wires[1].messages(0)[0][1][1].party,
        weapon_riven_snapshot_id: 'forged', weapon_riven_mode: 1 }, false, 2]])
    await until(() => x.wires.every(cancelled), 'party change cancellation')
    x.wires.forEach(wire => wire.ack(old)); await sleep(20)
    assert.ok(x.wires.every(wire => !wire.messages(5).length))
    x.wires.forEach(wire => wire.send([0, [3, [1]]])); await sleep(30)
    x.wires[0].send([0, [6]])
    await until(() => x.wires.every(wire => wire.prepared().length === 2), 'second-party prepare')
    assert.equal(x.wires[0].latest().find(m => m.viewerId === p.viewerId).currentPartyId, 2)
    x.wires.forEach(wire => wire.ack()); await x.started()
})

test('replacement authenticated socket invalidates the old ACK and requires the new connection', { timeout: 15000 }, async t => {
    const x = await fixture(t); await x.prepare()
    const old = structuredClone(x.wires[0].latest()), previous = x.wires[1]
    const next = new Wire(x.port, { ...x.members[1], cid: x.members[1].cid + '-replacement' }, x.room)
    x.wires.push(next); await next.open()
    await until(() => cancelled(x.wires[0]), 'replacement cancellation')
    previous.ack(old); x.wires[0].ack(old); next.ack(old); await sleep(30)
    assert.equal(x.wires[0].messages(5).length, 0)
    const current = [x.wires[0], next]
    current.forEach(wire => wire.send([0, [3, [1]]])); await sleep(30); current[0].send([0, [6]])
    await until(() => current[0].prepared().length === 2 && next.prepared().length === 1, 'new connection prepare')
    current[0].ack(); await sleep(30)
    assert.equal(current[0].messages(5).length, 0)
    next.ack(); await until(() => current.every(wire => wire.messages(5).length === 1), 'new socket ACK')
})

test('DB row changes in ACK window cannot alter the frozen Start rows', { timeout: 15000 }, async t => {
    const x = await fixture(t); await x.prepare()
    const old = structuredClone(x.wires[0].latest()), p = x.members[0]
    load('data/db').getDb().prepare('UPDATE player_weapon_rivens SET affixes_json=?,revision=revision+1 WHERE player_id=? AND item_id=?')
        .run(JSON.stringify([[15990002, .5]]), p.id, p.itemId)
    x.wires.forEach(wire => wire.ack()); await x.started()
    assert.deepEqual(x.wires[0].messages(5)[0][1][1], old)
    assert.notEqual(load('data/domains/weaponRiven').getPlayerWeaponRivenSync(p.id, p.itemId).affixes[0][0], p.key)
})

test('owner settlement return releases old snapshot and next generation freezes current DB with a new token', { timeout: 15000 }, async t => {
    const x = await fixture(t); await x.prepare()
    const old = structuredClone(x.wires[0].latest())
    x.wires.forEach(wire => wire.ack()); await x.started()
    const room = load('multi/room/manager').getRoom(x.room)
    const coordinator = load('multi/coordinator/embedded').embeddedMultiCoordinator
    const manager = load('multi/state/SessionManager').sessionManager
    // Invoke the production settlement-return boundary; this test does not
    // fabricate a quest payout or claim full finish-route coverage.
    await coordinator.enqueueRoomCommand(x.room, () => {
        manager.clearBattleExpectedCount(x.room)
        assert.equal(coordinator.beginSettlementReturn(room, room.lobby_generation).ok, true)
        assert.equal(manager.completeSettlementReturn(x.room), true)
    })
    assert.equal(room.lifecycle.phase, 'LOBBY')
    load('data/db').getDb().prepare('UPDATE player_weapon_rivens SET affixes_json=?,revision=revision+1 WHERE player_id=? AND item_id=?')
        .run(JSON.stringify([[15990002, .5]]), x.members[0].id, 16000001)
    x.wires.forEach(wire => wire.send([0, [0, {}, 1]]))
    await until(() => x.wires.every(wire => wire.messages(0).length === 2), 'new generation Enter')
    x.wires.forEach(wire => wire.send([0, [3, [1]]])); await sleep(30)
    x.wires[0].send([0, [6]])
    await until(() => x.wires.every(wire => wire.prepared().length === 2), 'next-generation prepare')
    const next = x.wires[0].latest()
    assert.notEqual(next[0].party.weapon_riven_snapshot_id, old[0].party.weapon_riven_snapshot_id)
    assert.equal(next[0].party.weapon_rivens[0][1][2], 15990002)
    x.wires.forEach(wire => wire.ack(old)); await sleep(30)
    assert.ok(x.wires.every(wire => wire.messages(5).length === 1))
    x.wires.forEach(wire => wire.ack())
    await until(() => x.wires.every(wire => wire.messages(5).length === 2), 'next-generation Start')
})

for (const kind of ['nack', 'oversize', 'truncated']) test(`${kind} ACK never releases battle`, { timeout: 15000 }, async t => {
    const x = await fixture(t); await x.prepare()
    const id = x.wires[0].latest()[0].party.weapon_riven_snapshot_id
    // A non-downgrade NACK reason still cancels; the shipped client's invalid_snapshot downgrades (catalog-nack tests).
    x.wires[0].send([0, [9, kind === 'nack' ? `WFR2|N|${id}|user_rejected`
        : kind === 'oversize' ? `WFR2|A|${id}|${'0'.repeat(4096)}` : `WFR2|A|${id}|WFR2C1`]])
    await until(() => x.wires.every(cancelled), `${kind} rejected`)
    assert.ok(x.wires.every(wire => !wire.messages(5).length))
})

test('shipped-client invalid_snapshot NACK never releases the enabled snapshot; only the mode-0 re-decision starts', { timeout: 15000 }, async t => {
    const x = await fixture(t); await x.prepare()
    const old = structuredClone(x.wires[0].latest()), id = old[0].party.weapon_riven_snapshot_id
    x.wires[0].ack(old); x.wires[1].send([0, [9, `WFR2|N|${id}|invalid_snapshot`]])
    await until(() => x.wires.every(wire => wire.prepared().length === 2), 're-decided prepare')
    x.wires[1].ack(old); await sleep(30)
    assert.ok(x.wires.every(wire => !wire.messages(5).length), 'the enabled snapshot can no longer be confirmed')
    assert.ok(!x.wires.some(cancelled))
    x.wires.forEach(wire => wire.ack()); await x.started()
    assert.ok(x.wires[0].messages(5)[0][1][1].every(mate => mate.party.weapon_riven_mode === 0))
})
