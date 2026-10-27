const { test } = require('node:test')
const assert = require('node:assert/strict')
const { load, getDb, mode, unknown, player, appFor, startBody, savedParty, savedSouls, multi } =
    require('./helpers/weapon-riven-five-boss-fixture.cjs')
const first = 16000001, second = 16000002

test('solo five-boss start strips every revealed riven of an over-limit party before freezing and returns the saved party', async () => {
    const p = player([second, first, unknown]), app = await appFor(p)
    try {
        const response = await app.inject({ method: 'POST', url: '/start', payload: startBody(p) })
        assert.equal(response.statusCode, 200, response.body)
        assert.deepEqual(savedSouls(p), [null, null, unknown], 'two revealed rivens: both are ineffective (author 2026-10-27 15:17)')
        assert.deepEqual(response.json().data.party_info_list[0].ability_soul_ids, [null, null, unknown],
            'both revealed rivens are stripped; the unknown card stays for conversion')
        const row = getDb().prepare('SELECT riven_loadout_json FROM five_boss_solo_runs WHERE player_id=?').get(p.id)
        assert.deepEqual(JSON.parse(row.riven_loadout_json).abilitySoulIds, [0, 0, unknown])
    } finally { await app.close() }
})

test('failed five-boss start leaves the old party intact as part of the entry transaction', async () => {
    const p = player([second, first, unknown]), app = await appFor(p)
    load('data/domains/item').setPlayerItemSync(p.id, mode.ticketItemId, 0)
    try {
        const response = await app.inject({ method: 'POST', url: '/start', payload: startBody(p) })
        assert.equal(response.statusCode, 200, response.body)
        assert.deepEqual(savedSouls(p), [second, first, unknown])
        assert.equal(getDb().prepare('SELECT COUNT(*) AS n FROM five_boss_solo_runs WHERE player_id=?').get(p.id).n, 0)
    } finally { await app.close() }
})

test('ordinary solo start corrects the selected party without touching another saved party', async () => {
    const p = player([second, first, unknown]), app = await appFor(p)
    savedParty(p, 1, 1, 2, [first, second, unknown])
    // An owner of revealed cards; its stale client cache may still hold both stripped cards.
    getDb().transaction(() => load('data/domains/weaponRiven').insertWeaponRivenSync(p.id, 300101, [[15990001, 50]], 'party-battle-owner', () => 0))()
    try {
        const quests = require('../assets/main_quest.json')
        const questId = Number(Object.keys(quests)[0])
        const response = await app.inject({ method: 'POST', url: '/start',
            payload: { ...startBody(p), category: 1, quest_id: questId } })
        assert.equal(response.statusCode, 200, response.body)
        assert.deepEqual(savedSouls(p), [null, null, unknown], 'two revealed rivens: both are ineffective (author 2026-10-27 15:17)')
        assert.deepEqual(savedSouls(p, 1, 1, 2), [first, second, unknown])
        assert.deepEqual(response.json().data.party_info_list[0].ability_soul_ids, [null, null, unknown])
        const again = await app.inject({ method: 'POST', url: '/start',
            payload: { ...startBody(p), play_id: `${p.playId}-again`, category: 1, quest_id: questId } })
        assert.equal(again.statusCode, 200, again.body)
        assert.deepEqual(again.json().data.party_info_list[0].ability_soul_ids, [null, null, unknown],
            'a client still receives its authoritative party after an earlier room or solo repair')
    } finally { await app.close() }
})

test('parent room facts correct saved slots independently of forged wire slots', async () => {
    const p = player([second, first, unknown])
    const facts = await load('multi/coordinator/business-handlers').handleRealtimeBusiness('player.facts', {
        playerId: p.id, category: mode.category, questId: mode.visibleQuestId, partyId: 1,
        wireParty: { characters: [[0, { id: 111001 }]], abilitySoulIds: [[0, unknown], [0, unknown], [0, unknown]] },
    })
    assert.deepEqual(savedSouls(p), [null, null, unknown], 'two revealed rivens: both are ineffective (author 2026-10-27 15:17)')
    assert.deepEqual(facts.weaponRivenLoadout.abilitySoulIds, [0, 0, unknown])
})

test('embedded room readiness checks historical slots even for a quest that allows special equipment', () => {
    const p = player([second, first, unknown])
    const room = { category: mode.category, quest_id: mode.visibleQuestId }
    const client = { playerId: p.id, equipmentSelectedPartyId: 1, yourself: { party: { abilitySoulIds: [] } } }
    assert.equal(load('multi/room/equipment-ready').enforceEquipmentReady(room, client), true)
    assert.deepEqual(savedSouls(p), [null, null, unknown], 'two revealed rivens: both are ineffective (author 2026-10-27 15:17)')
})

test('multiplayer five-boss freezes no revealed riven when two are equipped, while leaving all unknown slots eligible', () => {
    const p = player([second, first, unknown])
    multi(p)
    const row = getDb().prepare('SELECT riven_loadout_json FROM five_boss_gauntlet_members WHERE player_id=?').get(p.id)
    assert.deepEqual(JSON.parse(row.riven_loadout_json).abilitySoulIds, [0, 0, unknown])
    const allUnknown = player([unknown, unknown, unknown])
    multi(allUnknown)
    const unknownRow = getDb().prepare('SELECT riven_loadout_json FROM five_boss_gauntlet_members WHERE player_id=?').get(allUnknown.id)
    assert.deepEqual(JSON.parse(unknownRow.riven_loadout_json).abilitySoulIds, [unknown, unknown, unknown])
})
