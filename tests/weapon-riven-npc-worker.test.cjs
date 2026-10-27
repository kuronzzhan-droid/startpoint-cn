const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { Worker } = require('node:worker_threads')
const Database = require('better-sqlite3')

test('actual COM worker strips private souls and all P2 context in new storage, deltas and historical reloads', { timeout: 15000 }, async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'riven-npc-worker-'))
    const worker = new Worker(path.resolve(__dirname, '../out/workers/quest-npc-party-pool-worker.js'), {
        env: { ...process.env, DATA_DIR: directory, NPC_INCREMENTAL_UPDATES: 'true' },
    })
    const messages = []
    worker.on('message', message => {
        messages.push(message)
        if (message.type === 'quest_snapshot') worker.postMessage({ type: 'snapshot_ack', revision: message.revision })
    })
    const waitFor = type => new Promise((resolve, reject) => {
        const timer = setTimeout(() => { cleanup(); reject(Error(`timed out awaiting ${type}`)) }, 10000)
        const onMessage = message => { if (message.type === type) { cleanup(); resolve(message) }
            else if (message.type === 'operation_error') { cleanup(); reject(Error(message.error)) } }
        const onError = error => { cleanup(); reject(error) }
        function cleanup() { clearTimeout(timer); worker.off('message', onMessage); worker.off('error', onError) }
        worker.on('message', onMessage); worker.on('error', onError)
    })
    let db
    try {
        await waitFor('ready')
        const party = { characters: [[0, { id: 1 }], [0, { id: 2 }], [0, { id: 3 }]],
            unison_characters: [[1], [1], [1]], equipments: [[1], [1], [1]],
            abilitySoulIds: [[0, 16000001], [0, 16000000], [0, 16000999]],
            weapon_rivens: [[0, [16000001, 100001, 15990001, 50]], [1], [1]],
            weapon_riven_scope: "multi-v1", weapon_riven_snapshot_id: "injected",
            weapon_riven_catalog: "catalog", weapon_riven_mode: 1, weapon_riven_reason: "",
            user_weapon_riven_list: { secret: { pending: [1] } } }
        const recorded = waitFor('record_done')
        worker.postMessage({ type: 'record', snapshot: { questCategory: 2, questId: 1001, sourcePlayerId: 1,
            partySlot: 1, battlePower: 12000, partyElement: 1, clearedAt: 1234, party, weapon_riven_snapshot_id: "outer-injected",
            user_weapon_riven_list: { private: true } } })
        await recorded
        const delta = messages.find(message => message.type === 'quest_delta')
        assert.deepEqual(delta.entry.party.abilitySoulIds, [[1], [1], [1]])
        assert.equal(JSON.stringify(delta).includes('weapon_riven'), false)
        db = new Database(path.join(directory, 'quest_ai_party_pool.db'))
        const row = db.prepare('SELECT party_payload FROM quest_npc_party_pool').get()
        assert.deepEqual(JSON.parse(row.party_payload).abilitySoulIds, [[1], [1], [1]])
        assert.equal(row.party_payload.includes('weapon_riven'), false)
        db.prepare('UPDATE quest_npc_party_pool SET party_payload=?').run(JSON.stringify(party))
        const refreshed = waitFor('ready')
        worker.postMessage({ type: 'reload' })
        await refreshed
        const snapshot = messages.find(message => message.type === 'quest_snapshot')
        assert.deepEqual(snapshot.entries[0].party.abilitySoulIds, [[1], [1], [1]])
        assert.equal(JSON.stringify(snapshot).includes('weapon_riven'), false)
        assert.deepEqual(party.abilitySoulIds, [[0, 16000001], [0, 16000000], [0, 16000999]])
    } finally {
        db?.close()
        await worker.terminate()
        fs.rmSync(directory, { recursive: true, force: true })
    }
})
