const assert = require('node:assert/strict')
const { test } = require('node:test')
require('ts-node/register/transpile-only')
const { stripWeaponRivenPublicPayload: project } = require('../src/lib/weapon-riven/public-payload')
const { stripWeaponRivenPartySouls } = require('../src/lib/weapon-riven/client')
const { cloneQuestNpcPartySnapshot } = require('../src/multi/npc/quest-party-pool-shared')
const { QuestPartyPoolCache } = require('../src/multi/npc/quest-party-pool-cache')

const metadata = {
    weapon_rivens: [[0, [16000001, 100001, 15990001, 80]], [1], [1]],
    weapon_riven_scope: 'multi-v1', weapon_riven_snapshot_id: 'secret', weapon_riven_mode: 1,
    weapon_riven_catalog: 'catalog', weapon_riven_reason: '',
    user_weapon_riven_list: { 16000001: { pending: { affixes: [[15990001, 10]] } } },
    weapon_riven_list: { private: true }, weapon_riven_deleted: [16000001],
    weapon_riven_granted: [16000001], weapon_riven_auto_dismantled: [{ private: true }],
}

test('public projection strips unknown and full reserved range, all context and private lists, preserving fragments', () => {
    const source = { ...metadata, party: { ...metadata,
        abilitySoulIds: [[0, 16000000], [0, 16000201], [0, 16000999]],
        characters: [[0, { id: 16000001, mana_node_ids: [1, 2] }], [1], [1]],
        equipments: [[0, { equipmentId: 16000001 }], [1], [1]],
        nested: { ability_soul_ids: [16000001, 16000900, 500001],
            ability_soul_id_1: 16000000, ability_soul_id_2: 16000999, ability_soul_id_3: 16000900 },
    }, item_list: { 16000000: 1, 16000999: 1, 16000900: 5, 500001: 2 } }
    const before = structuredClone(source), result = project(source)
    assert.deepEqual(result.party.abilitySoulIds, [[1], [1], [1]])
    assert.deepEqual(result.party.nested, { ability_soul_ids: [null, 16000900, 500001],
        ability_soul_id_1: null, ability_soul_id_2: null, ability_soul_id_3: 16000900 })
    assert.deepEqual(result.item_list, { 16000900: 5, 500001: 2 })
    assert.equal(JSON.stringify(result).includes('weapon_riven'), false)
    assert.deepEqual(result.party.characters, before.party.characters)
    assert.deepEqual(result.party.equipments, before.party.equipments)
    assert.deepEqual(project(result), result, 'public projection is idempotent')
    result.party.characters[0][1].mana_node_ids.push(99)
    assert.deepEqual(source, before, 'even untouched branches are independent copies')
})

test('real-player room and five-boss inputs remain distinct from public projection', () => {
    const source = { abilitySoulIds: [[0, 16000000], [0, 16000001], [0, 16000900]],
        conversionLoadout: { partyId: 1, abilitySoulIds: [16000000, 16000001, 0], equipmentIds: [1, 2, 3] } }
    const before = structuredClone(source)
    const room = stripWeaponRivenPartySouls(source)
    assert.deepEqual(room.abilitySoulIds, [[0, 16000000], [1], [0, 16000900]])
    assert.deepEqual(project(source).abilitySoulIds, [[1], [1], [0, 16000900]])
    assert.equal('conversionLoadout' in project(source), false)
    assert.deepEqual(source, before, 'internal conversion source is never rewritten')
})

test('COM snapshot cloning removes outer sidecars and isolates all party branches', () => {
    const source = { ...metadata, sourcePlayerId: 10, party: { ...metadata,
        abilitySoulIds: [[0, 16000000], [0, 16000999], [0, 500001]],
        characters: [[0, { id: 1 }], [1], [1]] } }
    const before = structuredClone(source), a = cloneQuestNpcPartySnapshot(source), b = cloneQuestNpcPartySnapshot(source)
    assert.equal(JSON.stringify(a).includes('weapon_riven'), false)
    assert.deepEqual(a.party.abilitySoulIds, [[1], [1], [0, 500001]])
    a.party.characters[0][1].id = 99
    assert.equal(b.party.characters[0][1].id, 1)
    assert.deepEqual(source, before)
})

test('COM cache accepts clean independent snapshots and deltas from historical or injected worker messages', () => {
    const cache = new QuestPartyPoolCache(), entry = { ...metadata, sourcePlayerId: 1,
        party: { ...metadata, abilitySoulIds: [[0, 16000000], [0, 16000999], [0, 500001]] } }
    cache.apply({ type: 'snapshot_begin', revision: 1 })
    cache.apply({ type: 'quest_snapshot', revision: 2, key: '2:1', entries: [entry] })
    cache.apply({ type: 'snapshot_end', revision: 3 })
    assert.equal(JSON.stringify(cache.pools.get('2:1')).includes('weapon_riven'), false)
    entry.party.abilitySoulIds[2][1] = 500002
    assert.equal(cache.pools.get('2:1')[0].party.abilitySoulIds[2][1], 500001)
    cache.apply({ type: 'quest_delta', revision: 4, key: '2:1', removedPlayerIds: [], entry })
    assert.equal(JSON.stringify(cache.pools.get('2:1')).includes('weapon_riven'), false)
    entry.party.abilitySoulIds[2][1] = 500003
    assert.equal(cache.pools.get('2:1')[0].party.abilitySoulIds[2][1], 500002)
})
