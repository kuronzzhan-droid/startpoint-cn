const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { pack, unpack } = require('msgpackr')
const { fixture, load, db, app, gate, dir } = require('./helpers/weapon-riven-api-fixture.cjs')
const parties = load('data/domains/party')
const { limitWeaponRivenPartySouls } = load('lib/weapon-riven/party-limit')
const { normalizeWeaponRivenLoadout } = load('lib/weapon-riven/loadout')
const UNKNOWN = 16000000, FRAGMENT = 16000900
app.register(load('routes/api/party').default, { prefix: '/party' })
after(async () => { await app.close(); gate.close(); db.close(); fs.rmSync(dir, { recursive: true, force: true }) })

function party(souls, category = 1) {
    return { name: 'v3 party', category, characterIds: [1, null, null],
        unisonCharacterIds: [null, null, null], equipmentIds: [null, null, null],
        abilitySoulIds: souls, options: { allowOtherPlayersToHealMe: true }, edited: true }
}
function editRow(souls, id = 1, category = 1) {
    return { party_id: id, party_category: category, party_name: 'v3 party', party_edited: true,
        character_ids: [1, null, null], unison_character_ids: [null, null, null],
        equipment_ids: [null, null, null], ability_soul_ids: souls,
        options: { allow_other_players_to_heal_me: true } }
}
async function edit(p, rows, capable = true) {
    const response = await app.inject({ method: 'POST', url: '/party/edit',
        headers: { ...(capable ? p.headers : {}), 'content-type': 'application/x-msgpack' },
        payload: pack({ viewer_id: p.viewer, main_party_id: 1, party_info_list: rows }) })
    assert.equal(response.statusCode, 200, response.body)
    return unpack(response.rawPayload)
}
const souls = (p, id = 1, category = 1) => parties.getPlayerPartyGroupListSync(p.id, category)
    [Math.floor((id - 1) / 10) + 1].list[((id - 1) % 10) + 1].abilitySoulIds
function addCard(p, source) {
    return db.transaction(() => load('data/domains/weaponRiven').insertWeaponRivenSync(
        p.id, 300101, [[15990001, 50]], source, () => 0))()
}

test('party limit follows soul slot order, excludes unknown and fragment items, and never mutates input', () => {
    for (const [input, expected] of [
        [[UNKNOWN, UNKNOWN, UNKNOWN], [UNKNOWN, UNKNOWN, UNKNOWN]],
        [[16000002, 16000001, UNKNOWN], [16000002, null, UNKNOWN]],
        [[null, 16000002, 16000001], [null, 16000002, null]],
        [[16000001, 16000001, 16000001], [16000001, null, null]],
        [[FRAGMENT, 16000201, 16000001], [FRAGMENT, 16000201, null]],
    ]) {
        const original = [...input]
        assert.deepEqual(limitWeaponRivenPartySouls(input), expected)
        assert.deepEqual(input, original)
    }
    assert.deepEqual(normalizeWeaponRivenLoadout({ partyId: 12, abilitySoulIds: [16000002, 16000001, UNKNOWN],
        equipmentIds: [300101, 300102, 0] }), { partyId: 12, abilitySoulIds: [0, 0, UNKNOWN], equipmentIds: [300101, 300102, 0] },
        'battle loadouts: over the limit every revealed riven is ineffective')
    assert.deepEqual(normalizeWeaponRivenLoadout({ partyId: 12, abilitySoulIds: [16000002, 16000901, UNKNOWN],
        equipmentIds: [300101, 300102, 0] }).abilitySoulIds, [16000002, 16000901, UNKNOWN], 'themed unknown cards do not count')
})

test('party/edit keeps one revealed riven per party and returns complete corrected parties without deleting cards', async () => {
    const p = await fixture(), second = addCard(p, 'party-second'), third = addCard(p, 'party-third')
    const response = await edit(p, [editRow([second, p.item, UNKNOWN]), editRow([third, second, p.item], 12)])
    assert.equal(response.data_headers.result_code, 1)
    assert.deepEqual(souls(p), [second, null, UNKNOWN])
    assert.deepEqual(souls(p, 12), [third, null, null])
    assert.deepEqual(response.data.party_info_list.map(row => [row.party_id, row.ability_soul_ids]),
        [[1, [second, null, UNKNOWN]], [12, [third, null, null]]])
    for (const row of response.data.party_info_list) assert.equal(row.character_ids.length, 3)
    assert.equal(Object.keys(load('data/domains/weaponRiven').getPlayerWeaponRivenListSync(p.id)).length, 3)
    const sameCardDifferentParties = await edit(p, [editRow([p.item, UNKNOWN, UNKNOWN]), editRow([p.item, null, null], 12)])
    assert.equal(sameCardDifferentParties.data_headers.result_code, 1)
    assert.deepEqual(souls(p), [p.item, UNKNOWN, UNKNOWN])
    assert.deepEqual(souls(p, 12), [p.item, null, null])
})

test('duplicate party edits return the final saved state only once', async () => {
    const p = await fixture(), second = addCard(p, 'duplicate-second')
    const response = await edit(p, [editRow([p.item, second, null]), editRow([UNKNOWN, second, p.item])])
    assert.equal(response.data.party_info_list.length, 1)
    assert.deepEqual(response.data.party_info_list[0].ability_soul_ids, [UNKNOWN, second, null])
    assert.deepEqual(souls(p), [UNKNOWN, second, null])
})

test('reserved slots 201 and 999 cannot bypass ownership while fragment 900 stays an ordinary item', async () => {
    const p = await fixture()
    await edit(p, [editRow([16000201, p.item, 16000999])])
    assert.deepEqual(souls(p), [null, p.item, null])
    for (const capable of [false, true]) {
        await edit(p, [editRow([16000201, FRAGMENT, 16000999])], capable)
        assert.deepEqual(souls(p), [null, FRAGMENT, null])
    }
    const client = load('lib/weapon-riven/client')
    assert.equal(client.isWeaponRivenInstanceId(16000201), true)
    assert.equal(client.isWeaponRivenInstanceId(16000999), true)
    assert.equal(client.isWeaponRivenInstanceId(FRAGMENT), false)
    const source = { item_list: { 16000201: 1, 16000999: 1, [FRAGMENT]: 3 },
        party_info_list: [{ ability_soul_ids: [16000201, FRAGMENT, 16000999] }] }
    assert.deepEqual(client.projectWeaponRivenClientResponse(source, false), { item_list: { [FRAGMENT]: 3 },
        party_info_list: [{ ability_soul_ids: [null, FRAGMENT, null] }] })
    assert.deepEqual(client.projectWeaponRivenClientResponse(source, true), source)
    assert.deepEqual(client.stripWeaponRivenPartySouls({ abilitySoulIds: [[0, 16000201], [0, FRAGMENT], [0, 16000999]] }),
        { abilitySoulIds: [[1], [0, FRAGMENT], [1]] })
})

test('legacy empty submissions preserve only the earliest live hidden riven and explicit replacements still win', async () => {
    const p = await fixture(), second = addCard(p, 'legacy-second')
    for (const category of [1, 99]) {
        parties.updatePlayerPartySync(p.id, 1, party([p.item, null, UNKNOWN], category), 1)
        db.prepare('UPDATE players_parties SET ability_soul_2=? WHERE player_id=? AND category=? AND group_id=1 AND slot=1')
            .run(second, p.id, category)
        const response = await edit(p, [editRow([null, null, UNKNOWN], 1, category)], false)
        assert.deepEqual(souls(p, 1, category), [p.item, null, UNKNOWN])
        assert.deepEqual(response.data.party_info_list[0].ability_soul_ids, [null, null, UNKNOWN])
        await edit(p, [editRow([UNKNOWN, null, null], 1, category)], false)
        assert.deepEqual(souls(p, 1, category), [UNKNOWN, null, null])
    }
})

test('all domain write paths enforce the limit independently in each party category', async () => {
    const p = await fixture(), second = addCard(p, 'domain-second')
    for (const category of [1, 2, 3, 4, 5, 6, 7, 8, 99]) {
        const requested = party([UNKNOWN, second, p.item], category)
        parties.updatePlayerPartySync(p.id, 1, requested, 1)
        assert.deepEqual(souls(p, 1, category), [UNKNOWN, second, null])
        parties.updatePlayerPartySync(p.id, 1, { ...requested, abilitySoulIds: [second, p.item, UNKNOWN] }, 1)
        assert.deepEqual(souls(p, 1, category), [second, null, UNKNOWN])
        db.prepare('DELETE FROM players_parties WHERE player_id=? AND category=? AND group_id IN (11,12)').run(p.id, category)
        db.prepare('DELETE FROM players_party_groups WHERE player_id=? AND category=? AND id IN (11,12)').run(p.id, category)
        parties.insertPlayerPartyGroupListSync(p.id, { 11: { category, colorId: 15, list: { 1: requested } } })
        parties.ensurePlayerPartyGroupListSync(p.id, { 12: { category, colorId: 15, list: { 1: requested } } })
        assert.deepEqual(souls(p, 101, category), [UNKNOWN, second, null])
        assert.deepEqual(souls(p, 111, category), [UNKNOWN, second, null])
        assert.deepEqual(requested.abilitySoulIds, [UNKNOWN, second, p.item])
    }
})
