'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'battle-roster-contract-'))
Object.assign(process.env, { DATA_DIR: directory, GACHA_SEED_DIR: path.join(directory, 'seeds'),
    CN_WRITER_THREAD: '0', GAME_ROUTINE_LOGS: 'off' })
const load = name => require(path.join(__dirname, '..', 'out', name))
load('data').initializeDatabase()
const db = load('data/db').getDb(), roster = load('lib/quest/battle-roster')
const empty = () => ({ characters: [], unison_characters: [] })
test.after(async () => {
    await load('lib/seed-validator').default.close()
    db.close()
    assert.equal(path.dirname(fs.realpathSync(directory)), fs.realpathSync(os.tmpdir()))
    fs.rmSync(directory, { recursive: true })
})

test('primary party is bounded to three plus three with unique integral character identities', () => {
    const value = roster.normalizeBattleParty({ characters: [{ id: 1 }, null], unison_characters: [{ id: 2 }],
        equipments: [{ id: 7 }], ability_soul_ids: [8] })
    assert.deepEqual(value.characters, [{ id: 1 }, null, null])
    assert.deepEqual(value.unison_characters, [{ id: 2 }, null, null])
    for (const party of [null, [], { characters: [1], unison_characters: [] },
        { characters: [{ id: '1' }], unison_characters: [] },
        { characters: [{ id: 1.5 }], unison_characters: [] },
        { characters: [{ id: 1 }], unison_characters: [{ id: 1 }] },
        { characters: [null, null, null, null], unison_characters: [] },
        { ...empty(), equipments: [null, null, null, null] },
        { ...empty(), ability_soul_ids: ['8'] }]) {
        assert.throws(() => roster.normalizeBattleParty(party), error => roster.isBattleRosterError(error))
    }
})

test('stored roster absence has one explicit compatibility path and corrupted data cannot become absence', () => {
    assert.equal(roster.decodeBattleRoster(null), null)
    assert.equal(roster.decodeBattleRoster(undefined), null)
    for (const value of ['{', '{}', '{"version":2,"party":null}', '{"version":1,"party":{"characters":[1]}}']) {
        assert.throws(() => roster.decodeBattleRoster(value))
    }
})

test('fixed-party identity repetition keeps structural checks without applying the ordinary SET uniqueness rule', () => {
    const party = { characters: [{ id: 1 }], unison_characters: [{ id: 1 }] }
    assert.throws(() => roster.normalizeBattleParty(party), error => roster.isBattleRosterError(error))
    assert.deepEqual(roster.normalizeBattleParty(party, true).unison_characters, [{ id: 1 }, null, null])
    assert.throws(() => roster.normalizeBattleParty({ characters: [1], unison_characters: [] }, true))
})

test('wire Options and HTTP statistics retain their own encodings when a lobby roster is frozen', () => {
    const wire = { characters: [[0, { id: 1 }], [1], [1]], unison_characters: [[1], [1], [1]],
        equipments: [[0, { equipmentId: 7 }], [1], [1]], abilitySoulIds: [[0, 8], [1], [1]] }
    const frozen = roster.battlePartyFromWire(wire)
    wire.characters[0][1].id = 2
    assert.equal(frozen.characters[0].id, 1)
    assert.equal(frozen.equipments[0].id, 7)
    assert.equal(frozen.ability_soul_ids[0], 8)
    assert.equal(roster.battlePartyFromWire({ equipments: [] }), undefined, 'old synthetic/absent wire uses the explicit saved-source capture')
})

test('an existing active table acquires a nullable roster without rewriting the pending play', () => {
    const legacy = require('better-sqlite3')(':memory:')
    try {
        legacy.exec("CREATE TABLE players_active_quests(player_id INTEGER PRIMARY KEY,play_id TEXT); INSERT INTO players_active_quests VALUES(7,'old-play')")
        load('data/schema').ensureSchemaColumn(legacy, 'players_active_quests.battle_roster_json')
        assert.deepEqual(legacy.prepare('SELECT * FROM players_active_quests').get(),
            { player_id: 7, play_id: 'old-play', battle_roster_json: null })
    } finally { legacy.close() }
})

test('Raid JSON retains three ordered identities while sub statistics bind by ID instead of position', () => {
    const party = id => ({ characters: [{ id }], unison_characters: [] })
    const frozen = roster.decodeBattleRoster(JSON.stringify({ version: 1, party: party(1), raid: {
        partyGroupId: 2, parties: [1, 2, 3].map((id, subId) => ({ partyId: 11 + subId, subId, party: party(id) })),
    } }))
    assert.deepEqual(frozen.raid.parties.map(row => row.partyId), [11, 12, 13])
    const received = [{ sub_id: 2, party: party(9), damage: 17 }, { sub_id: 1, party: party(8), damage: 23 }]
    const bound = roster.resolveRaidSubStatistics(frozen, { sub_id: 0 }, received)
    assert.deepEqual(bound.map(row => [row.sub_id, row.party.characters[0].id, row.damage]), [[2, 3, 17], [1, 2, 23]])
    assert.equal(received[0].party.characters[0].id, 9, 'binding does not mutate the received request')
    assert.equal(roster.resolveRaidSubStatistics(frozen, {}, undefined), undefined)
    assert.deepEqual(roster.resolveRaidSubStatistics(frozen, {}, []), [])
})

test('Raid rejects provided malformed sub identities without tightening old unclassified telemetry', () => {
    const party = () => ({ characters: [{ id: 1 }], unison_characters: [] })
    const frozen = { version: 1, party: party(), raid: { partyGroupId: 1,
        parties: [0, 1, 2].map(subId => ({ partyId: subId + 1, subId, party: party() })) } }
    for (const value of [null, {}, [{ sub_id: 0, party: party() }], [{ sub_id: '1', party: party() }],
        [{ sub_id: 1, party: party() }, { sub_id: 1, party: party() }],
        [{ sub_id: 1, party: { characters: [1], unison_characters: [] } }]]) {
        assert.throws(() => roster.resolveRaidSubStatistics(frozen, {}, value), error => roster.isBattleRosterError(error))
    }
    assert.throws(() => roster.resolveRaidSubStatistics(frozen, { sub_id: 2 }, []))
    const oldTelemetry = { legacy: true }
    assert.equal(roster.resolveRaidSubStatistics(null, {}, oldTelemetry), oldTelemetry)
})
