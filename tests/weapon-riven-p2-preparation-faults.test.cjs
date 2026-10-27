'use strict'
process.env.MULTI_REALTIME_PROCESS = '1'
const { test, after } = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs')
const { fixture, load, until, sleep, catalog } = require('./helpers/weapon-riven-p2-wire.cjs')
after(() => { load('lib/client-admission').clientAdmission().close(); load('data/db').getDb().close() })

const cancelled = (wire, snapshotId) => wire.messages(8)
    .some(frame => frame[1][1].startsWith(`WFR2_CANCEL|${snapshotId}|`))
function assertNotStarted(x) {
    assert.ok(x.wires.every(wire => wire.messages(5).length === 0))
    assert.equal(load('data/db').getDb().prepare('SELECT COUNT(*) AS n FROM players_active_quests WHERE player_id IN (?,?)')
        .get(...x.members.map(member => member.id)).n, 0)
}
function assertProcessOwner(x) {
    assert.equal(x.status.mode, 'process')
    assert.notEqual(x.status.pid, process.pid)
    assert.equal(x.status.endpoint.database, 'business-rpc-only')
}

for (const departure of ['Bye', 'socket disconnect']) {
    test(`real owner cancels P2 preparation immediately on guest ${departure}`, { timeout: 20000 }, async t => {
        const x = await fixture(t); assertProcessOwner(x); await x.prepare()
        const prepared = structuredClone(x.wires[0].latest())
        const snapshotId = prepared[0].party.weapon_riven_snapshot_id
        x.wires[0].ack(); await sleep(25); assertNotStarted(x)
        if (departure === 'Bye') x.wires[1].send([0, [1]])
        else x.wires[1].socket.destroy()
        // The bound is much shorter than the preparation's ten-second ACK deadline.
        await until(() => cancelled(x.wires[0], snapshotId), `${departure} cancellation`, 1500)
        x.wires[0].ack(prepared); await sleep(40)
        assertNotStarted(x)
        assert.equal(x.wires[0].prepared().length, 1)
    })
}

test('parent admission capability reload cancels final ACK and a fresh disabled preparation needs only the remaining P2 ACK',
    { timeout: 25000 }, async t => {
        const configPath = process.env.CLIENT_ADMISSION_CONFIG, original = fs.readFileSync(configPath, 'utf8')
        const config = JSON.parse(original), peerBuild = config.builds.find(build => build.id === 'p2-other')
        peerBuild.weaponRivenCatalog = catalog
        const gate = load('lib/client-admission').clientAdmission()
        fs.writeFileSync(configPath, JSON.stringify(config)); assert.equal(gate.reload(), true)
        t.after(() => { fs.writeFileSync(configPath, original); assert.equal(gate.reload(), true) })

        const x = await fixture(t, ['p2-wire', 'p2-other']); assertProcessOwner(x); await x.prepare()
        const prepared = structuredClone(x.wires[0].latest())
        assert.ok(prepared.every(mate => mate.party.weapon_riven_mode === 1))
        const snapshotId = prepared[0].party.weapon_riven_snapshot_id, guest = x.members[1]
        x.wires[0].ack(); await sleep(30); assertNotStarted(x)

        peerBuild.capabilities = ['weapon-riven-v1']
        fs.writeFileSync(configPath, JSON.stringify(config)); assert.equal(gate.reload(), true)
        assert.equal(gate.check(guest.admissionToken, guest.session, true).ok, true,
            'the authenticated grant is preserved; only P2 capability was withdrawn')
        assert.deepEqual(gate.socketLease(guest.admissionToken, guest.session, false).weaponRiven,
            { p1: true, p2: false, catalog })
        x.wires[1].ack()
        await until(() => x.wires.every(wire => cancelled(wire, snapshotId)), 'parent capability validation cancels final ACK', 2000)
        assertNotStarted(x)

        const readyCounts = x.wires.map(wire => x.members.map(member => wire.messages(2)
            .filter(frame => frame[1][1] === member.cid && frame[1][2]?.[0] === 1).length))
        x.wires.forEach(wire => wire.send([0, [3, [1]]]))
        await until(() => x.wires.every((wire, index) => x.members.every((member, memberIndex) => wire.messages(2)
            .filter(frame => frame[1][1] === member.cid && frame[1][2]?.[0] === 1).length > readyCounts[index][memberIndex])),
        'both peers Ready again')
        x.wires[0].send([0, [6]])
        await until(() => x.wires.every(wire => wire.prepared().length === 2), 'fresh disabled preparation')
        const disabled = x.wires[0].latest()
        assert.notEqual(disabled[0].party.weapon_riven_snapshot_id, snapshotId)
        for (const mate of disabled) {
            assert.equal(mate.party.weapon_riven_mode, 0)
            assert.equal(mate.party.weapon_riven_catalog, 'none')
            assert.deepEqual(mate.party.weapon_rivens, [[1], [1], [1]])
            assert.deepEqual(mate.party.abilitySoulIds, [[1], [1], [1]])
        }
        assert.ok(x.wires.every(wire => wire.messages(8).some(frame => frame[1][1].startsWith('WFR2_DISABLED|'))))
        x.wires[1].ack(prepared); await sleep(30); assertNotStarted(x)
        // The downgraded peer sends no ACK for this token. Parent freeze recalculates the ACK set.
        x.wires[0].ack(); await x.started()
        assert.deepEqual(x.wires[0].messages(5)[0][1][1], disabled)
        assert.deepEqual(x.wires[1].messages(5)[0][1][1], disabled)
        assert.equal(gate.check(guest.admissionToken, guest.session, true).ok, true)
    })
