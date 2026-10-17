const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const { EventEmitter } = require('node:events')

function historyPool(entries, category, questId) {
    let worker
    class Worker extends EventEmitter {
        constructor() { super(); worker = this }
        postMessage() {}
    }
    const filename = path.resolve(__dirname, '../out/multi/npc/player-party-pool.js')
    const isolated = new Module(filename, module)
    const realRequire = Module.createRequire(filename)
    isolated.filename = filename
    isolated.require = request => {
        if (request === 'worker_threads') return { Worker }
        if (request === '../../lib/file-exists') return { existsSync: () => true }
        if (request === '../../lib/memory-diagnostics') {
            return { observeWorkerMemory() {}, registerMemoryCounters() {} }
        }
        if (request === '../../data/db' || request === '../tcp/handshake') {
            assert.fail('historical AI selection must not import mutable SET storage')
        }
        return realRequire(request)
    }
    isolated._compile(fs.readFileSync(filename, 'utf8'), filename)
    const pool = isolated.exports
    pool.startQuestNpcPartyPoolWorker()
    worker.emit('message', { type: 'snapshot_begin', revision: 1 })
    worker.emit('message', { type: 'quest_snapshot', revision: 2,
        key: `${category}:${questId}`, entries })
    worker.emit('message', { type: 'snapshot_end', revision: 3 })
    return pool
}

function clear(sourcePlayerId, equipmentId, soulId) {
    return {
        sourcePlayerId, battlePower: 12_000, partyElement: 1,
        party: {
            characters: [[0, { id: 131012 }], [0, { id: 141007 }], [0, { id: 151001 }]],
            unison_characters: [[1], [1], [1]],
            equipments: [[0, { equipmentId }], [1], [1]],
            abilitySoulIds: [[0, soulId], [1], [1]],
        },
    }
}

test('ordinary history skips whole Fantasy-equipped clears and reuses a legal clear unchanged', () => {
    const weapon = clear(101, 100013, 300201)
    const soul = clear(102, 300101, 100023)
    const legal = clear(103, 300101, 300201)
    const original = JSON.stringify([weapon, soul, legal])
    const pool = historyPool([weapon, soul, legal], 2, 1001001)
    const selected = pool.getRandomPlayerNpcPartiesSync(101, 2, { questCategory: 2, questId: 1001001 })
    assert.deepEqual(selected.map(entry => entry.sourcePlayerId), [103, 103])
    assert.ok(selected.every(entry => entry.party === legal.party))
    assert.equal(JSON.stringify([weapon, soul, legal]), original)
    const invalidOnly = historyPool([weapon, soul], 2, 1001001)
    assert.deepEqual(invalidOnly.getRandomPlayerNpcPartiesSync(101, 2,
        { questCategory: 2, questId: 1001001 }), [])
})

test('Fantasy history keeps its successful whole loadout including weapons and souls', () => {
    const fantasy = clear(101, 100013, 100023)
    const pool = historyPool([fantasy], 7, 300098001)
    const selected = pool.getRandomPlayerNpcPartiesSync(101, 2,
        { questCategory: 7, questId: 300098001 })
    assert.equal(selected.length, 2)
    assert.ok(selected.every(entry => entry.party === fantasy.party))
    assert.deepEqual(selected[0].party.equipments[0], [0, { equipmentId: 100013 }])
    assert.deepEqual(selected[0].party.abilitySoulIds[0], [0, 100023])
})
