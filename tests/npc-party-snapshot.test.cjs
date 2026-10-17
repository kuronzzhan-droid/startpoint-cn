const assert = require('node:assert/strict')
const { test } = require('node:test')
const path = require('node:path')
const Module = require('node:module')

const root = path.resolve(__dirname, '..')
const serverCharacters = { 11: { element: 1 }, 12: { element: 1 }, 13: { element: 1 } }
let storedParty
let reads = 0
// Only the database boundary is modeled: snapshot capture and settlement
// registration below execute the real compiled implementations.
const database = {
    prepare() {
        return {
            get() {
                reads++
                return storedParty ? { ...storedParty } : undefined
            },
        }
    },
}
const stubs = new Map([
    [path.join(root, 'out/data/db.js'), { getDb: () => database }],
    [path.join(root, 'out/lib/content-master.js'), {
        serverCharacters,
    }],
    [path.join(root, 'out/lib/memory-diagnostics.js'), { registerMemoryCounters() {} }],
    [path.join(root, 'out/lib/routine-game-logging.js'), { routineGameLog() {} }],
])
const originalLoad = Module._load
let captureQuestNpcPartySnapshot, cloneQuestNpcPartySnapshot, settlement
try {
    Module._load = function (request, parent, isMain) {
        const resolved = Module._resolveFilename(request, parent)
        if (stubs.has(resolved)) return stubs.get(resolved)
        return originalLoad.call(this, request, parent, isMain)
    }
    ;({ captureQuestNpcPartySnapshot } = require('../out/multi/npc/quest-party-snapshot'))
    ;({ cloneQuestNpcPartySnapshot } = require('../out/multi/npc/quest-party-pool-shared'))
    settlement = require('../out/multi/settlement-snapshot')
} finally {
    Module._load = originalLoad
}

function fixture() {
    storedParty = {
        character_id_1: 11, character_id_2: 12, character_id_3: 13,
        unison_character_1: 21, unison_character_2: null, unison_character_3: null,
        equipment_1: 300101, equipment_2: 300201, equipment_3: null,
        ability_soul_1: 300301, ability_soul_2: null, ability_soul_3: null,
        current_battle_power: 12000,
    }
    const character = id => [0, {
        id, evolution_level: 5, exp: 321, over_limit_step: 2,
        mana_node_ids: { 101: 2, 102: 1 },
        ex_boost: [0, { ability_id_list: [801], status_id: 902 }],
        illustration_settings: [1],
    }]
    return {
        characters: [character(11), character(12), character(13)],
        unison_characters: [character(21), [1], [1]],
        equipments: [
            [0, { equipmentId: 300101, level: 7, enhancementLevel: 4 }],
            [0, { equipmentId: 300201, level: 3, enhancementLevel: 2 }], [1],
        ],
        abilitySoulIds: [[0, 300301], [1], [1]],
    }
}
const capture = party => captureQuestNpcPartySnapshot(41, 2, 1099001, 1, party)

test('capture freezes the actual battle wire including nodes, EX and equipment levels', () => {
    const wire = fixture()
    const expected = structuredClone(wire)
    const snapshot = capture(wire)
    assert.ok(snapshot)
    assert.equal(snapshot.sourcePlayerId, 41)
    assert.equal(snapshot.partySlot, 1)
    assert.equal(snapshot.questCategory, 2)
    assert.equal(snapshot.questId, 1099001)
    assert.equal(snapshot.clearedAt, 0)
    assert.equal(snapshot.partyElement, null)
    assert.equal(snapshot.battlePower, 12000)
    assert.deepEqual(snapshot.party, expected)
    assert.notStrictEqual(snapshot.party, wire)
    // SET editing after battle start cannot change what this clear records.
    storedParty.character_id_1 = 99
    storedParty.equipment_1 = 400101
    storedParty.current_battle_power = 99999
    wire.characters[0][1].mana_node_ids[101] = 99
    wire.characters[0][1].ex_boost[1].ability_id_list.push(999)
    wire.equipments[0][1].enhancementLevel = 99
    assert.equal(snapshot.battlePower, 12000)
    assert.deepEqual(snapshot.party, expected)
})

for (const [kind, mutate] of [
    ['main character', row => { row.character_id_2 = 99 }],
    ['unison character', row => { row.unison_character_1 = 99 }],
    ['equipment', row => { row.equipment_2 = 400101 }],
    ['ability soul', row => { row.ability_soul_1 = 400201 }],
    ['empty unison slot', row => { row.unison_character_2 = 99 }],
    ['empty equipment slot', row => { row.equipment_3 = 400101 }],
    ['empty soul slot', row => { row.ability_soul_3 = 400201 }],
]) {
    test(`capture skips stale SET identity: ${kind}`, () => {
        const wire = fixture()
        mutate(storedParty)
        assert.equal(capture(wire), null)
    })
}

test('capture requires all three main characters and the pool power threshold', () => {
    for (let slot = 0; slot < 3; slot++) {
        const wire = fixture()
        wire.characters[slot] = [1]
        storedParty[`character_id_${slot + 1}`] = null
        assert.equal(capture(wire), null)
    }
    const wire = fixture()
    storedParty.current_battle_power = 7999
    assert.equal(capture(wire), null)
    storedParty.current_battle_power = 8000
    assert.ok(capture(wire))
    storedParty = undefined
    assert.equal(capture(wire), null)
})

test('element classification includes unison and keeps unknown or mixed parties unclassified', () => {
    const wire = fixture()
    assert.equal(capture(wire).partyElement, null)
    try {
        serverCharacters[21] = { element: 1 }
        assert.equal(capture(wire).partyElement, 1)
        serverCharacters[21].element = 2
        assert.equal(capture(wire).partyElement, null)
    } finally {
        delete serverCharacters[21]
    }
})

test('capture rejects plain or malformed wire slots and ineligible quests', () => {
    for (const mutate of [
        wire => { wire.characters[0] = { id: 11 } },
        wire => { wire.equipments[2] = null },
        wire => { wire.abilitySoulIds[2] = [1, 300301] },
        wire => { wire.unison_characters.pop() },
    ]) {
        const wire = fixture()
        mutate(wire)
        assert.equal(capture(wire), null)
    }
    assert.equal(captureQuestNpcPartySnapshot(41, 1, 1099001, 1, fixture()), null)
})

test('matching saved identities still require positive safe-integer wire IDs', () => {
    for (const id of [0, -1, 11.5, Number.MAX_SAFE_INTEGER + 1, '11']) {
        const wire = fixture()
        wire.characters[0][1].id = id
        storedParty.character_id_1 = id
        assert.equal(capture(wire), null)
        const soulWire = fixture()
        soulWire.abilitySoulIds[0][1] = id
        storedParty.ability_soul_1 = id
        assert.equal(capture(soulWire), null)
    }
})

test('settlement owns its snapshot after caller mutation and room-map removal', () => {
    const snapshot = capture(fixture())
    assert.ok(snapshot)
    const expected = structuredClone(snapshot)
    const roomSnapshots = new Map([[41, snapshot]])
    const input = {
        battleInstanceId: 'snapshot-room:1:2:1099001', playerId: 41, viewerId: 141,
        playId: 'snapshot-clear', roomNumber: 'snapshot-room', roomGeneration: 1,
        activeQuest: { category: 2, questId: 1099001, matePlayerIds: [], mateComIds: [1] },
        participants: [{ viewerId: 141, comId: 0 }, { viewerId: 900000001, comId: 1 }],
        expectedRealViewerIds: [141], isHost: true, isRescueGuest: false,
        isRescueFragmentEligible: false, isNewbieRescueGuest: false,
        npcPartySnapshot: roomSnapshots.get(41),
    }
    settlement.registerMultiSettlementSnapshot(input)
    const readsBeforeSettlement = reads
    input.npcPartySnapshot.party.characters[0][1].mana_node_ids[101] = 77
    input.npcPartySnapshot.party.abilitySoulIds[0][1] = 99
    input.npcPartySnapshot.battlePower = 1
    roomSnapshots.delete(41)
    const saved = settlement.getMultiSettlementSnapshot(41, 'snapshot-clear')
    assert.ok(saved)
    assert.deepEqual(saved.npcPartySnapshot, expected)
    assert.equal(reads, readsBeforeSettlement)
})

test('optional snapshot clone preserves wire data and isolates nested edits', () => {
    assert.equal(cloneQuestNpcPartySnapshot(undefined), undefined)
    const snapshot = capture(fixture())
    const copy = cloneQuestNpcPartySnapshot(snapshot)
    assert.deepEqual(copy, snapshot)
    copy.party.characters[0][1].ex_boost[1].ability_id_list.push(42)
    copy.party.equipments[0][1].level = 99
    assert.deepEqual(snapshot.party.characters[0][1].ex_boost[1].ability_id_list, [801])
    assert.equal(snapshot.party.equipments[0][1].level, 7)
})
