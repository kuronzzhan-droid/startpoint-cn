const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const temporaryRoot = path.resolve(__dirname, '../tmp/riven-p2-fixed-party')
fs.mkdirSync(temporaryRoot, { recursive: true })
for (const name of ['TMP', 'TEMP', 'TMPDIR']) process.env[name] = temporaryRoot
const { load, getDb, player } = require('./helpers/weapon-riven-five-boss-fixture.cjs')
const { handleRealtimeBusiness } = load('multi/coordinator/business-handlers')
const { readRivenResourceCatalog } = load('lib/weapon-riven/multi-catalog')
process.env.WEAPON_RIVEN_MULTI_ENABLED = '1'
process.env.WEAPON_RIVEN_MULTI_CATALOG = path.resolve(__dirname, '../assets/weapon_riven_multi_catalog.json')

test('real fixed-party quest preserves owner party, strips injected riven data and never reads NORMAL loadouts', async t => {
    const category = 1, questId = 10002002
    const quest = load('lib/assets').getQuestFromCategorySync(category, questId)
    assert.equal(quest.fixedParty, 7, 'use the actual fixed-party quest asset')
    const p = player([16000001, 16000002, 16000000])
    await load('data/domains/session').insertSessionWithToken({ token: String(p.viewerId), accountId: p.accountId,
        expires: new Date(Date.now() + 86_400_000), type: 2 })
    const catalog = readRivenResourceCatalog(), token = `fixed-test-${p.id}`
    t.mock.method(load('lib/client-admission').clientAdmission(), 'socketLease', supplied => ({
        ok: supplied === token, remainingMs: 60_000, weaponRiven: { p1: true, p2: true, catalog: catalog.id },
    }))
    const originalOwnerParty = {
        characters: [[0, { id: 222002, exp: 456 }], [1], [1]],
        unison_characters: [[0, { id: 333003 }], [1], [1]],
        equipments: [[0, { equipmentId: 2010002, level: 4, enhancementLevel: 2 }], [1], [1]],
        abilitySoulIds: [[0, 16000001], [0, 16000000], [0, 123456]],
        weapon_rivens: [[0, [16000001, 999999, 15990001, 100]], [1], [1]],
        weapon_riven_scope: 'forged-scope', weapon_riven_snapshot_id: 'forged-snapshot',
        weapon_riven_mode: 1, weapon_riven_catalog: 'forged-catalog', weapon_riven_reason: 'forged-reason',
        user_weapon_riven_list: { 16000001: { pending: 'private-pending' } },
        weapon_riven_pending: 'private-pending',
        nested: { retained: 'owner-fixed-extra', weapon_rivens: ['injected-row'],
            weapon_riven_snapshot_id: 'nested-forged-token' },
    }
    const beforeOwner = structuredClone(originalOwnerParty)
    const savedParty = () => getDb().prepare(`SELECT character_id_1,ability_soul_1,ability_soul_2,ability_soul_3
        FROM players_parties WHERE player_id=? AND category=1 AND group_id=1 AND slot=1`).get(p.id)
    const beforeSaved = savedParty()
    assert.equal(beforeSaved.character_id_1, 111001, 'NORMAL source intentionally differs from the fixed owner party')

    // If fixed mode accidentally enters ordinary-party construction, fail at the actual production boundary.
    for (const [module, method] of [['data/domains/party', 'getPlayerPartyGroupListSync'],
        ['multi/party-snapshot', 'buildRealParty'],
        ['data/initializers/weapon-riven-quality', 'migrateWeaponRivenQualities'],
        ['data/domains/weapon-riven-party', 'enforceWeaponRivenPartyLimitSync']]) {
        t.mock.method(load(module), method, () => { throw new Error(`FIXED_PARTY_MUST_NOT_CALL_${method}`) })
    }
    const identity = { ownerEpoch: 'fixed-owner', roomInstanceId: 'fixed-room',
        sourceLobbyGeneration: 1, preparationId: 'fixed-prepare' }
    const snapshot = await handleRealtimeBusiness('riven.freeze', { identity, category, questId,
        members: [{ viewerId: p.viewerId, playerId: p.id, connectionId: 'fixed-connection', partyId: 1,
            admissionToken: token, session: 'bound-test-session', mate: { viewerId: p.viewerId, party: originalOwnerParty } }] })
    try {
        assert.equal(snapshot.mode, 0)
        assert.equal(snapshot.reason, 'fixed_party')
        assert.equal(snapshot.catalog, 'none')
        assert.deepEqual(snapshot.ackConnectionIds, ['fixed-connection'])
        assert.deepEqual(snapshot.conversionLoadouts, [])
        assert.deepEqual(snapshot.audit, [])
        const party = snapshot.members[0].party
        for (const key of ['characters', 'unison_characters', 'equipments']) assert.deepEqual(party[key], beforeOwner[key])
        assert.deepEqual(party.abilitySoulIds, [[1], [0, 16000000], [0, 123456]])
        assert.deepEqual(party.weapon_rivens, [[1], [1], [1]])
        assert.equal(party.weapon_riven_scope, 'multi-v1')
        assert.equal(party.weapon_riven_snapshot_id, snapshot.snapshotId)
        assert.equal(party.weapon_riven_mode, 0)
        assert.equal(party.weapon_riven_catalog, 'none')
        assert.equal(party.weapon_riven_reason, 'fixed_party')
        assert.equal(Object.hasOwn(party, 'user_weapon_riven_list'), false)
        assert.equal(Object.hasOwn(party, 'weapon_riven_pending'), false)
        assert.deepEqual(party.nested, { retained: 'owner-fixed-extra' })
        assert.doesNotMatch(JSON.stringify(snapshot.members), /forged|private-pending|injected-row/)
        assert.deepEqual(originalOwnerParty, beforeOwner, 'sanitize a copy of the owner source')
        assert.deepEqual(savedParty(), beforeSaved, 'do not normalize or overwrite unrelated NORMAL save data')
        t.diagnostic(JSON.stringify({ questId, fixedParty: quest.fixedParty, mode: snapshot.mode,
            ownerMain: party.characters[0][1].id, savedNormalMain: beforeSaved.character_id_1,
            soulSlots: party.abilitySoulIds, conversionLoadouts: snapshot.conversionLoadouts }))
    } finally {
        await handleRealtimeBusiness('riven.release', { identity, snapshotId: snapshot.snapshotId })
    }
})
