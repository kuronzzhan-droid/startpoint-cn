// Round 2 review (Argon findings 1, 2, 3, 5, 6).
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { load, getDb, items, rivens, mode, unknown, player, appFor, savedParty, savedSouls } =
    require('./helpers/weapon-riven-five-boss-fixture.cjs')
const spirit = 16000901, abyss = 16000902, fragment = 16000900
const RUSH = 4, RAID = 3

const addCard = (p, key) => getDb().transaction(() => rivens.insertWeaponRivenSync(p.id, 300101, [[15990001, 50]], key, () => 0))()
const isInstance = id => load('lib/weapon-riven/constants').isWeaponRivenItemId(id)
const soulIds = party => (party.abilitySoulIds ?? []).map(slot => Array.isArray(slot) ? slot[1] : slot)

// ---- Finding 1: save restore must keep themed unknown cards (and the fragment) in parties ----
test('V2 restore keeps themed unknown cards in parties and still clears dangling instance references', () => {
    const source = player([unknown, 0, 0]), target = player([unknown, 0, 0])
    const owned = addCard(source, 'review-restore')
    items.setPlayerItemSync(source.id, spirit, 2)
    items.setPlayerItemSync(source.id, abyss, 1)
    savedParty(source, 1, 1, 1, [owned, spirit, abyss])
    savedParty(source, 1, 1, 2, [16000150, spirit, fragment])
    const snapshots = load('data/snapshots/player-snapshot')
    snapshots.restorePlayerSaveSnapshotV2Sync(snapshots.createPlayerSaveSnapshotV2Sync(source.id), target.id)
    assert.deepEqual(savedSouls(target), [owned, spirit, abyss], 'themed unknown cards are items, not dangling instances')
    assert.deepEqual(savedSouls(target, 1, 1, 2), [null, spirit, fragment], 'only the dangling instance is cleared')
    assert.equal(items.getPlayerItemSync(target.id, spirit), 2)
})

test('the restore cleanup itself leaves the whole themed block and the fragment alone', () => {
    const p = player([16000919, 16000901, 16000999])
    load('data/snapshots/weapon-riven').clearInvalidWeaponRivenPartyReferences(getDb(), p.id)
    assert.deepEqual(savedSouls(p), [16000919, 16000901, null])
})

// ---- Finding 2: rush_event / raid_event battle starts apply the over-limit rule ----
async function routesFor(p, path, t) {
    // The fixture events may be closed by the content operations schedule; the
    // weapon riven start rule is what these cases exercise.
    t.mock.method(load('lib/content-operations'), 'isContentQuestOpenAt', () => true)
    const app = await appFor(p)
    await load(path).default(app)
    return app
}

test('rush_event/battle/start strips every revealed card of an over-limit rush party and returns it', async t => {
    const p = player([unknown, 0, 0]), first = addCard(p, 'review-rush-a'), second = addCard(p, 'review-rush-b')
    savedParty(p, RUSH, 1, 1, [first, second, unknown])
    savedParty(p, RUSH, 1, 2, [first, second, null])
    const app = await routesFor(p, 'routes/api/rushEvent', t)
    try {
        const response = await app.inject({ method: 'POST', url: '/battle/start', payload: {
            viewer_id: p.viewerId, party_id: 1, quest_id: 700007001, is_auto_start_mode: false,
            play_id: `${p.playId}-rush`, api_count: 1 } })
        assert.equal(response.statusCode, 200, response.body)
        assert.deepEqual(savedSouls(p, RUSH, 1, 1), [null, null, unknown])
        assert.deepEqual(savedSouls(p, RUSH, 1, 2), [first, second, null], 'other saved parties are untouched')
        const list = response.json().data.party_info_list
        assert.equal(list.length, 1)
        assert.equal(list[0].party_category, RUSH)
        assert.equal(list[0].party_id, 1)
        assert.deepEqual(list[0].ability_soul_ids, [null, null, unknown])
    } finally { await app.close() }
})

test('raid_event/battle/start applies the rule to every saved party of the raid group', async t => {
    const p = player([unknown, 0, 0]), first = addCard(p, 'review-raid-a'), second = addCard(p, 'review-raid-b')
    savedParty(p, RAID, 1, 1, [first, second, unknown])
    savedParty(p, RAID, 1, 2, [first, null, null])
    savedParty(p, RAID, 1, 3, [second, first, first])
    savedParty(p, RAID, 2, 1, [first, second, null])
    // Every fixture party reuses one character; the roster check is not under test here.
    t.mock.method(load('lib/quest/battle-roster'), 'captureRaidBattleRosterSync', () => ({}))
    const app = await routesFor(p, 'routes/api/raidEvent', t)
    try {
        const response = await app.inject({ method: 'POST', url: '/battle/start', payload: {
            viewer_id: p.viewerId, quest_id: 7001, event_id: 7, party_group_id: 1, play_id: `${p.playId}-raid`,
            use_auto_start_point: false, is_auto_start_mode: false, api_count: 1 } })
        assert.equal(response.statusCode, 200, response.body)
        assert.deepEqual(savedSouls(p, RAID, 1, 1), [null, null, unknown])
        assert.deepEqual(savedSouls(p, RAID, 1, 2), [first, null, null], 'one revealed card stays effective')
        assert.deepEqual(savedSouls(p, RAID, 1, 3), [null, null, null])
        assert.deepEqual(savedSouls(p, RAID, 2, 1), [first, second, null], 'another raid group is untouched')
        const list = response.json().data.party_info_list
        assert.deepEqual(list.map(party => [party.party_category, party.party_id]), [[RAID, 1], [RAID, 2], [RAID, 3]])
        assert.deepEqual(list[0].ability_soul_ids, [null, null, unknown])
    } finally { await app.close() }
})

test('start-party helper returns nothing for a player without revealed cards whose party needed no change', () => {
    const p = player([unknown, 0, 0])
    const party = load('data/domains/weapon-riven-party')
    const result = getDb().transaction(() => party.enforceWeaponRivenStartPartiesSync(p.id, 1, [1, 0, 999]))()
    assert.deepEqual(result, [])
    assert.deepEqual(party.getSavedPartyIdsInGroupSync(p.id, 1, 1), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    assert.deepEqual(party.getSavedPartyIdsInGroupSync(p.id, 1, 2), party.getSavedPartyIdsInGroupSync(p.id, 1, 2).map((_, i) => 11 + i))
    assert.deepEqual(party.getSavedPartyIdsInGroupSync(p.id, 1, 13), [])
})

// ---- Finding 3: room facts repair the saved party before reading the wire party ----
test('room facts read the wire party after the over-limit repair and drop the stale lobby snapshot', async () => {
    const p = player([unknown, 0, 0]), first = addCard(p, 'review-facts-a'), second = addCard(p, 'review-facts-b')
    // The legacy lobby wire party is the first NPC-named saved party.
    savedParty(p, 1, 1, 1, [second, first, unknown])
    getDb().prepare(`UPDATE players_parties SET name='NPC riven' WHERE player_id=? AND category=1 AND group_id=1 AND slot=1`).run(p.id)
    const facts = await load('multi/coordinator/business-handlers').handleRealtimeBusiness('player.facts', {
        playerId: p.id, category: mode.category, questId: mode.visibleQuestId, partyId: 1 })
    assert.deepEqual(savedSouls(p), [null, null, unknown])
    assert.deepEqual(facts.weaponRivenLoadout.abilitySoulIds, [0, 0, unknown])
    assert.ok(!soulIds(facts.party).some(isInstance), `stale wire party: ${JSON.stringify(facts.party.abilitySoulIds)}`)
    const snapshots = load('multi/party-snapshot')
    snapshots.getRealPartySnapshot(p.id)
    const cached = snapshots.getRealPartySnapshot(p.id)
    savedParty(p, 1, 1, 1, [second, first, unknown])
    load('data/domains/weapon-riven-party').enforceWeaponRivenPartyLimitSync(p.id, 1)
    assert.notEqual(snapshots.getRealPartySnapshot(p.id), cached, 'a repair invalidates the cached lobby party')
})

// ---- Finding 5: legacy 15990017 is an independent-damage affix outside the shared budget ----
test('legacy paralysis slayer 15990017 is independent damage and neither dilutes nor shares the 500% budget', () => {
    const rules = load('lib/weapon-riven/rules').weaponRivenRuleSet
    const quality = load('lib/weapon-riven/quality')
    const definition = key => rules.affixes.affixes.find(affix => affix.key === key)
    const slayer = definition(15990017)
    assert.equal(slayer.legacy_only, true)
    assert.equal(slayer.independent_damage, true)
    assert.equal(quality.isWeaponRivenBudgetAffix(slayer, rules), false)
    const card = [[15990006, 1], [15990019, 1], [15990017, 1]]
    const coefficient = quality.weaponRivenDispositionCoefficient(5, rules)
    assert.equal(quality.weaponRivenAffixBudget(definition(15990006), card, 5, rules), 250 * coefficient)
    assert.equal(quality.weaponRivenAffixBudget(slayer, card, 5, rules), 20 * coefficient)
    // Every positive "slayer" family row is independent damage, legacy or not.
    for (const affix of rules.affixes.affixes) {
        if (affix.polarity === '+' && /slayer/.test(affix.family ?? affix.id)) assert.equal(affix.independent_damage, true, affix.id)
    }
})

test('legacy-only rows are also checked for endpoint coverage at configuration load', () => {
    const validate = load('lib/weapon-riven/validate-v3')
    const fn = Object.values(validate).find(value => typeof value === 'function' && /validate/i.test(value.name))
    assert.ok(fn, 'validator export')
    const rules = structuredClone(load('lib/weapon-riven/rules').weaponRivenRuleSet)
    fn(rules)
    rules.affixes.affixes.find(affix => affix.key === 15990017).hi = 10
    assert.throws(() => fn(rules), /global endpoints do not cover every disposition/)
})

// ---- Finding 6 (decision, no clamp): v1 -> v3 migration preserves the old value; q may be below quality.min ----
test('v1 migration keeps the historical value, so a low old roll yields q below the draw minimum (migration_min=0)', () => {
    const rules = load('lib/weapon-riven/rules')
    const ruleSet = rules.weaponRivenRuleSet
    const migrate = load('lib/weapon-riven/migrate-quality')
    const changes = []
    const [[key, q]] = migrate.migrateWeaponRivenAffixes(300101, [[15990006, 10]], ruleSet, change => changes.push(change))
    assert.equal(key, 15990006)
    assert.equal(ruleSet.rules.quality.migration_min, 0)
    assert.ok(q < ruleSet.rules.quality.min, `q=${q}`)
    assert.ok(q >= ruleSet.rules.quality.migration_min)
    assert.equal(changes[0].capped, false)
    assert.ok(Math.abs(changes[0].new_value - changes[0].old_value) < 1e-3, JSON.stringify(changes[0]))
    load('lib/weapon-riven/quality').validateWeaponRivenQualities([[key, q]], ruleSet)
})
