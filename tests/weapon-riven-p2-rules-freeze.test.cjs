const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

// The shared fixture creates DATA_DIR under os.tmpdir(); keep that directory in this candidate.
const temporaryRoot = path.resolve(__dirname, '../tmp/riven-p2-rules-freeze')
fs.mkdirSync(temporaryRoot, { recursive: true })
for (const name of ['TMP', 'TEMP', 'TMPDIR']) process.env[name] = temporaryRoot
const { load, getDb, player, mode, rivens } = require('./helpers/weapon-riven-five-boss-fixture.cjs')
const { handleRivenBusiness } = load('lib/weapon-riven/multi-business')
const { readRivenResourceCatalog, rivenRulesDigest } = load('lib/weapon-riven/multi-catalog')
const { weaponRivenRuleSet } = load('lib/weapon-riven/rules')
const { displayWeaponRivenAffixes } = load('lib/weapon-riven/display')
process.env.WEAPON_RIVEN_MULTI_ENABLED = '1'
process.env.WEAPON_RIVEN_MULTI_CATALOG = path.resolve(__dirname, '../assets/weapon_riven_multi_catalog.json')

test('committed room retains frozen levels after real disposition changes; a new preparation recomputes levels and rules digest', async t => {
    const catalog = readRivenResourceCatalog(), weaponId = 2010002, itemId = 16000001, key = 15990001
    const authorizedTokens = new Set(), qualities = [.5, 1], members = []
    t.mock.method(load('lib/client-admission').clientAdmission(), 'socketLease', token => ({
        ok: authorizedTokens.has(token), remainingMs: 60_000,
        weaponRiven: { p1: true, p2: true, catalog: catalog.id },
    }))
    for (let slot = 0; slot < 2; slot++) {
        const souls = [16000000, 16000000, 0]; souls[slot] = itemId
        const p = player(souls), token = `rules-test-${p.id}`
        load('data/domains/equipment').insertPlayerEquipmentSync(p.id, weaponId,
            { level: 1, enhancementLevel: 0, protection: false, stack: 0 })
        getDb().prepare(`UPDATE players_parties SET equipment_1=?,equipment_2=?
            WHERE player_id=? AND category=1 AND group_id=1 AND slot=1`).run(weaponId, weaponId, p.id)
        await load('data/domains/session').insertSessionWithToken({ token: String(p.viewerId), accountId: p.accountId,
            expires: new Date(Date.now() + 86_400_000), type: 2 })
        getDb().transaction(() => rivens.insertWeaponRivenSync(p.id, weaponId, [[key, qualities[slot]]],
            'rules-freeze-card', () => 0, 3))()
        authorizedTokens.add(token)
        members.push({ viewerId: p.viewerId, playerId: p.id, connectionId: `rules-${p.id}`, partyId: 1,
            admissionToken: token, session: 'bound-test-session', mate: { viewerId: p.viewerId, party: {} } })
    }
    const identity = { ownerEpoch: 'rules-owner', roomInstanceId: 'rules-room',
        sourceLobbyGeneration: 1, preparationId: 'rules-before' }
    const request = { identity, category: mode.category, questId: mode.visibleQuestId, members }
    const rows = snapshot => snapshot.members.map((mate, slot) => mate.party.weapon_rivens[slot][1])
    const expectedRows = () => qualities.map(q => [itemId, weaponId,
        ...displayWeaponRivenAffixes(weaponId, [[key, q]], 3, weaponRivenRuleSet).flatMap(([k, level]) => [k, level])])
    const durableRows = () => members.map(member => getDb().prepare(`SELECT riven_id,item_id,revision,affixes_json
        FROM player_weapon_rivens WHERE player_id=? AND item_id=?`).get(member.playerId, itemId))
    const weaponKey = String(weaponId), dispositions = weaponRivenRuleSet.disposition.weapons
    const originallyPresent = Object.hasOwn(dispositions, weaponKey), originalDisposition = dispositions[weaponKey]
    const beforeDb = durableRows(), beforeRules = rivenRulesDigest(weaponRivenRuleSet)
    const first = await handleRivenBusiness('riven.freeze', request)
    const firstReference = { identity, snapshotId: first.snapshotId,
        battleSessionId: 'e50e4f4f-51ab-4e57-9414-3c12526549c5:1:24:9001001' }
    let nextReference
    try {
        assert.equal(first.mode, 1)
        assert.deepEqual(rows(first), expectedRows())
        assert.equal(first.rulesDigest, beforeRules)
        await handleRivenBusiness('riven.commit', firstReference)

        // Change the actual normalized object consumed by the production q-to-L path, not a mock result.
        const initialDisposition = originalDisposition ?? weaponRivenRuleSet.disposition.default
        const changedDisposition = initialDisposition > 2.5 ? .1 : 5
        dispositions[weaponKey] = changedDisposition
        const changedRules = rivenRulesDigest(weaponRivenRuleSet), changedRows = expectedRows()
        assert.notEqual(changedRules, beforeRules)
        assert.notDeepEqual(changedRows, rows(first), 'the selected rule edit must actually change projected L')

        for (const current of [await handleRivenBusiness('riven.get', firstReference),
            await handleRivenBusiness('riven.freeze', request),
            await handleRivenBusiness('riven.commit', firstReference)]) {
            assert.equal(current.snapshotId, first.snapshotId)
            assert.deepEqual(rows(current), rows(first))
            assert.equal(current.canonical, first.canonical)
            assert.equal(current.sha256, first.sha256)
            assert.equal(current.rulesDigest, beforeRules)
        }
        assert.equal(await handleRivenBusiness('riven.release', firstReference), true)
        await assert.rejects(handleRivenBusiness('riven.get', firstReference), /RIVEN_SNAPSHOT_MISSING/)

        const nextIdentity = { ...identity, sourceLobbyGeneration: 2, preparationId: 'rules-after' }
        const next = await handleRivenBusiness('riven.freeze', { ...request, identity: nextIdentity })
        nextReference = { identity: nextIdentity, snapshotId: next.snapshotId }
        assert.equal(next.mode, 1)
        assert.notEqual(next.snapshotId, first.snapshotId)
        assert.deepEqual(rows(next), changedRows)
        assert.notEqual(next.canonical, first.canonical)
        assert.notEqual(next.sha256, first.sha256)
        assert.equal(next.rulesDigest, changedRules)
        assert.notEqual(next.rulesDigest, first.rulesDigest)
        assert.equal(next.catalog, first.catalog, 'server disposition changes do not change client resource identity')
        assert.deepEqual(next.conversionLoadouts, first.conversionLoadouts)
        assert.deepEqual(durableRows(), beforeDb, 'stored q, permanent instance identity and revision are unchanged')
        t.diagnostic(JSON.stringify({ disposition: { before: initialDisposition, after: changedDisposition },
            levels: { frozen: rows(first).map(row => row[3]), next: rows(next).map(row => row[3]) },
            rulesDigest: { before: first.rulesDigest, after: next.rulesDigest }, catalog: first.catalog }))
    } finally {
        if (originallyPresent) dispositions[weaponKey] = originalDisposition
        else delete dispositions[weaponKey]
        await handleRivenBusiness('riven.release', firstReference)
        if (nextReference) await handleRivenBusiness('riven.release', nextReference)
    }
    assert.equal(rivenRulesDigest(weaponRivenRuleSet), beforeRules, 'restore the process rule object after the test')
})
