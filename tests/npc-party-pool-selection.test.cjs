const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const { EventEmitter } = require('node:events')

const poolPath = path.resolve(__dirname, '../out/multi/npc/player-party-pool.js')

function loadPool() {
    const workers = []
    const unexpectedCalls = []
    const forbidden = name => () => {
        unexpectedCalls.push(name)
        assert.fail(`history-only NPC selection must not call ${name}`)
    }
    class Worker extends EventEmitter {
        messages = []
        constructor() { super(); workers.push(this) }
        postMessage(message) { this.messages.push(message) }
        async terminate() {}
    }
    const stubs = new Map([
        ['worker_threads', { Worker }],
        ['../../lib/file-exists', { existsSync: () => true }],
        ['../../lib/memory-diagnostics', { observeWorkerMemory() {}, registerMemoryCounters() {} }],
        ['../../data/db', { getDb: forbidden('getDb') }],
        ['../tcp/handshake', { buildRealParty: forbidden('buildRealParty') }],
        ['../../data/types', { PartyCategory: { NORMAL: 1 } }],
        ['../../lib/content-master', { serverCharacters: {} }],
    ])
    const isolated = new Module(poolPath, module)
    isolated.filename = poolPath
    isolated.paths = Module._nodeModulePaths(path.dirname(poolPath))
    const realRequire = Module.createRequire(poolPath)
    isolated.require = request => stubs.has(request) ? stubs.get(request) : realRequire(request)
    isolated._compile(fs.readFileSync(poolPath, 'utf8'), poolPath)
    const pool = isolated.exports
    pool.startQuestNpcPartyPoolWorker()
    const worker = workers[0]
    function publish(entries, category = 2, questId = 1001, ready = true) {
        worker.emit('message', { type: 'snapshot_begin', revision: 1 })
        worker.emit('message', { type: 'quest_snapshot', revision: 2,
            key: `${category}:${questId}`, entries })
        worker.emit('message', { type: 'snapshot_end', revision: 3 })
        if (ready) worker.emit('message', { type: 'ready' })
    }
    return { pool, worker, publish, unexpectedCalls }
}

function snapshot(overrides = {}) {
    return {
        questCategory: 2, questId: 1001, sourcePlayerId: 101, partySlot: 1,
        battlePower: 12_000, partyElement: 1, clearedAt: 123,
        party: {
            characters: [[0, { id: 131012 }], [0, { id: 141007 }], [0, { id: 151001 }]],
            unison_characters: [[1], [1], [1]],
            equipments: [[0, { equipmentId: 300101, level: 5 }], [1], [1]],
            abilitySoulIds: [[0, 300201], [1], [1]],
        },
        ...overrides,
    }
}

test('an empty same-quest history returns no candidates without scanning ordinary SETs', () => {
    const { pool, publish, unexpectedCalls } = loadPool()
    publish([snapshot({ questId: 2002 })], 2, 2002)
    assert.deepEqual(pool.getRandomPlayerNpcPartiesSync(101, 2, {
        questCategory: 2, questId: 1001,
    }), [])
    assert.deepEqual(pool.getRandomPlayerNpcPartiesSync(101, 2), [])
    assert.deepEqual(unexpectedCalls, [])
    const stats = pool.getPlayerNpcPartyPoolStats()
    assert.deepEqual([stats.size, stats.expiresAt, stats.ttlMs, stats.maxEntries], [0, 0, 0, 0])
    assert.equal(pool.refreshPlayerNpcPartyPoolSync, undefined)
    assert.equal(pool.invalidatePlayerNpcPartyPool, undefined)
})

test('same-quest history respects power, element and complete-party requirements', () => {
    const { pool, publish, unexpectedCalls } = loadPool()
    const accepted = snapshot()
    publish([
        snapshot({ sourcePlayerId: 102, battlePower: 9_999 }),
        snapshot({ sourcePlayerId: 103, partyElement: 2 }),
        snapshot({ sourcePlayerId: 104, party: { characters: [[0, { id: 1 }], [1], [1]] } }),
        accepted,
    ])
    const selected = pool.getRandomPlayerNpcPartiesSync(999, 2, {
        questCategory: 2, questId: 1001, minimumBattlePower: 10_000, requiredElement: 1,
    })
    assert.equal(selected.length, 2)
    assert.deepEqual(selected.map(entry => entry.sourcePlayerId), [101, 101])
    assert.ok(selected.every(entry => entry.party === accepted.party))
    assert.deepEqual(unexpectedCalls, [])
})

test('history with no qualifying clear does not fall through to ordinary SET candidates', () => {
    const { pool, publish, unexpectedCalls } = loadPool()
    publish([snapshot({ partyElement: 2 })])
    assert.deepEqual(pool.getRandomPlayerNpcPartiesSync(101, 2, {
        questCategory: 2, questId: 1001, requiredElement: 1,
    }), [])
    assert.deepEqual(pool.getRandomPlayerNpcPartiesSync(101, 0, {
        questCategory: 2, questId: 1001,
    }), [])
    assert.deepEqual(unexpectedCalls, [])
})

test('successful recording uses the supplied battle snapshot and owns a deep copy while queued', () => {
    const { pool, worker, unexpectedCalls } = loadPool()
    const frozen = snapshot()
    const originalParty = JSON.parse(JSON.stringify(frozen.party))
    const before = Date.now()
    pool.recordSuccessfulQuestNpcParty(frozen)
    frozen.party.characters[0][1].id = 999
    frozen.party.equipments[0][1].equipmentId = 100013
    frozen.party.abilitySoulIds[0][1] = 100023
    worker.emit('message', { type: 'ready' })
    const records = worker.messages.filter(message => message.type === 'record')
    assert.equal(records.length, 1)
    assert.deepEqual(records[0].snapshot.party, originalParty)
    assert.equal(records[0].snapshot.partySlot, 1)
    assert.ok(records[0].snapshot.clearedAt >= before)
    assert.ok(records[0].snapshot.clearedAt <= Date.now())
    assert.equal(frozen.clearedAt, 123)
    assert.deepEqual(unexpectedCalls, [])
})

test('recording rejects missing, ineligible, low-power and incomplete snapshots', () => {
    const { pool, worker, publish, unexpectedCalls } = loadPool()
    publish([])
    for (const invalid of [
        null, undefined,
        snapshot({ questCategory: 1 }),
        snapshot({ battlePower: 7_999 }),
        snapshot({ battlePower: NaN }),
        snapshot({ party: { characters: [[0, { id: 1 }], [1], [1]] } }),
    ]) pool.recordSuccessfulQuestNpcParty(invalid)
    assert.equal(worker.messages.filter(message => message.type === 'record').length, 0)
    const accepted = snapshot({ battlePower: 8_000 })
    pool.recordSuccessfulQuestNpcParty(accepted)
    const record = worker.messages.find(message => message.type === 'record')
    assert.deepEqual(record.snapshot.party, accepted.party)
    assert.notEqual(record.snapshot.party, accepted.party)
    assert.deepEqual(unexpectedCalls, [])
})
