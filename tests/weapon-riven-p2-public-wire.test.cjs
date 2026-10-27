'use strict'
process.env.MULTI_REALTIME_PROCESS = '0'
const { test, after } = require('node:test'), assert = require('node:assert/strict')
const { fixture, load, until, sleep } = require('./helpers/weapon-riven-p2-wire.cjs')
after(() => { load('lib/client-admission').clientAdmission().close(); load('data/db').getDb().close() })
const privateFields = { weapon_rivens: [[0, [16000999, 2010002, 15990001, 80]], [1], [1]],
    weapon_riven_scope: 'multi-v1', weapon_riven_snapshot_id: 'injected', weapon_riven_mode: 1,
    weapon_riven_catalog: 'catalog', weapon_riven_reason: '', user_weapon_riven_list: { pending: true } }

// NPC_COPY_HOST_PARTY (copy-host) is a test-server-only lobby patch and is not part of this branch.
for (const sourceKind of ['cached', 'pool', 'empty-pool-fallback']) {
    test(`real COM recruitment sanitizes ${sourceKind} source and isolates host, cache and Mate`, { timeout: 15000 }, async t => {
        const previousCopy = process.env.NPC_COPY_HOST_PARTY
        process.env.NPC_COPY_HOST_PARTY = sourceKind === 'copy-host' ? '1' : '0'
        t.after(() => { if (previousCopy === undefined) delete process.env.NPC_COPY_HOST_PARTY
            else process.env.NPC_COPY_HOST_PARTY = previousCopy })
        const x = await fixture(t), room = load('multi/room/manager').getRoom(x.room)
        const manager = load('multi/state/SessionManager').sessionManager
        const host = manager.getClient(x.members[0].viewerId, x.room)
        const source = { ...structuredClone(host.yourself.party), ...privateFields,
            abilitySoulIds: [[0, 16000000], [0, 16000999], [0, 16000900]],
            characters: [[0, { id: 111001, mana_node_ids: [1, 2] }], [1], [1]] }
        host.yourself.party = source
        const before = structuredClone(source)
        if (sourceKind === 'cached') room.npc_party_by_com_id = { 1: source, 2: source }
        const business = load('multi/coordinator/business-handlers'), original = business.handleRealtimeBusiness
        let poolCalls = 0
        t.mock.method(business, 'handleRealtimeBusiness', (kind, payload) => {
            if (kind === 'npc.parties') { poolCalls++; return Promise.resolve(sourceKind === 'pool' ? [source] : []) }
            return original(kind, payload)
        })
        room.is_npc_mode = true
        x.wires[0].send([0, [10, [{ name: 'public source fixture' }]]])
        await until(() => x.wires.every(wire => wire.messages(1).some(frame => frame[1][1]?.some(mate => mate.comId))), 'COM source accepted')
        const npc = host.mates.find(mate => mate.comId), cached = room.npc_party_by_com_id[String(npc.comId)]
        assert.ok(npc && cached)
        for (const party of [npc.party, cached]) {
            assert.deepEqual(party.abilitySoulIds, [[1], [1], [0, 16000900]])
            assert.equal(JSON.stringify(party).includes('weapon_riven'), false)
        }
        assert.equal(poolCalls, ['pool', 'empty-pool-fallback'].includes(sourceKind) ? 1 : 0)
        assert.notEqual(npc.party, cached); assert.notEqual(cached, source)
        npc.party.characters[0][1].id = 999
        assert.equal(cached.characters[0][1].id, before.characters[0][1].id)
        assert.deepEqual(source, before, 'the real host or source candidate is never changed')
    })
}

test('ordinary Welcome and Mates wire projections never leak injected P1/P2 fields but retain real unknown cards', { timeout: 15000 }, async t => {
    const x = await fixture(t), manager = load('multi/state/SessionManager').sessionManager
    const peer = manager.getClient(x.members[0].viewerId, x.room)
    const mate = { ...structuredClone(peer.yourself), party: { ...structuredClone(peer.yourself.party),
        ...privateFields, abilitySoulIds: [[0, 16000000], [0, 16000999], [0, 16000900]] } }
    const before = structuredClone(mate)
    const welcomeCount = x.wires[0].messages(0).length, matesCount = x.wires[0].messages(1).length
    manager.sendJson(peer.socket, [1, [0, mate, [mate]]])
    manager.sendJson(peer.socket, [1, [1, [mate]]])
    await until(() => x.wires[0].messages(0).length > welcomeCount && x.wires[0].messages(1).length > matesCount, 'ordinary projected frames')
    for (const frame of [x.wires[0].messages(0).at(-1), x.wires[0].messages(1).at(-1)]) {
        assert.equal(JSON.stringify(frame).includes('weapon_riven'), false)
        const received = frame[1][0] === 0 ? frame[1][1] : frame[1][1][0]
        assert.deepEqual(received.party.abilitySoulIds, [[0, 16000000], [1], [0, 16000900]])
    }
    assert.deepEqual(mate, before)
    await x.prepare()
    const count = x.wires[0].messages(1).length
    manager.sendJson(peer.socket, [1, [1, [mate]]]); await sleep(30)
    assert.equal(x.wires[0].messages(1).length, count, 'ordinary preview cannot overwrite a registered prepare')
})
