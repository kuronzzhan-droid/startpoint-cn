const { test } = require('node:test')
const assert = require('node:assert/strict')
const { load, getDb, items, rivens, unknown, player, multi, finishMulti, appFor,
    startBody, finishBody, count, seedCards, savedParty, savedSouls,
} = require('./helpers/weapon-riven-five-boss-fixture.cjs')

async function startBattle(p, solo, partyId = 1) {
    if (!solo) {
        const room = multi(p, [], partyId)
        return { room, finish: async () => finishMulti(p, room).reward, close: async () => {} }
    }
    const app = await appFor(p)
    const start = await app.inject({ method: 'POST', url: '/start', payload: { ...startBody(p), party_id: partyId } })
    assert.equal(start.statusCode, 200, start.body)
    return { finish: async () => {
        // Deliberately send party_id=1: settlement must use the start snapshot.
        const response = await app.inject({ method: 'POST', url: '/finish', payload: finishBody(p) })
        assert.equal(response.statusCode, 200, response.body)
        return response.json().data
    }, close: () => app.close() }
}

function battleReceipt(p, solo) {
    if (solo) {
        const row = getDb().prepare('SELECT response_json FROM five_boss_solo_runs WHERE player_id=? AND play_id=?').get(p.id, p.playId)
        return JSON.parse(row.response_json).data
    }
    const row = getDb().prepare('SELECT reward_json FROM five_boss_gauntlet_receipts WHERE player_id=?').get(p.id)
    return JSON.parse(row.reward_json)
}

test('loadout party identity accepts 1..120 and freezes only an existing NORMAL saved party', () => {
    const { normalizeWeaponRivenLoadout, parseWeaponRivenLoadout } = load('lib/weapon-riven/loadout')
    const { getSoloWeaponRivenStartLoadoutSync: start } = load('lib/weapon-riven/battle')
    for (const partyId of [1, 12, 120]) {
        const expected = { abilitySoulIds: [unknown, 0, 0], equipmentIds: [0, 0, 0], partyId }
        assert.deepEqual(normalizeWeaponRivenLoadout({ abilitySoulIds: [unknown], partyId }), expected)
        assert.deepEqual(parseWeaponRivenLoadout(JSON.stringify(expected)), expected)
    }
    for (const partyId of [undefined, null, '1', 0, -1, 1.5, 121, NaN, Infinity]) {
        assert.equal(Object.hasOwn(normalizeWeaponRivenLoadout({ partyId }), 'partyId'), false)
    }
    const p = player()
    getDb().prepare('DELETE FROM players_parties WHERE player_id=? AND category=1 AND group_id=12 AND slot=10').run(p.id)
    savedParty(p, 2, 12, 10, [unknown, null, null])
    assert.deepEqual(start(p.id, 120), { abilitySoulIds: [0, 0, 0], equipmentIds: [0, 0, 0] })
    savedParty(p, 1, 12, 10, [null, null, unknown])
    assert.deepEqual(start(p.id, 120), { abilitySoulIds: [0, 0, unknown], equipmentIds: [300101, 0, 0], partyId: 120 })
})

for (const solo of [false, true]) {
    const mode = solo ? 'solo' : 'multiplayer'
    for (const souls of [[unknown, 1000001, null], [unknown, 1000001, unknown]]) {
        const convertedCount = souls.filter(id => id === unknown).length
        test(`${mode} clears ${convertedCount} converted slots despite spare inventory and preserves other parties`, async () => {
            const p = player(souls), other = player(souls)
            items.setPlayerItemSync(p.id, unknown, 20)
            savedParty(p, 1, 1, 2, souls)
            savedParty(p, 2, 1, 1, souls)
            const battle = await startBattle(p, solo)
            try {
                const first = await battle.finish(), cleared = [null, 1000001, null]
                assert.equal(count(p), convertedCount)
                assert.equal(items.getPlayerItemSync(p.id, unknown), 20 - convertedCount)
                assert.deepEqual(savedSouls(p), cleared)
                assert.deepEqual(savedSouls(p, 1, 1, 2), souls)
                assert.deepEqual(savedSouls(p, 2, 1, 1), souls)
                assert.deepEqual(savedSouls(other), souls)
                assert.deepEqual(first.party_info_list.map(row => [row.party_category, row.party_id, row.ability_soul_ids]), [[1, 1, cleared]])
                assert.deepEqual(battleReceipt(p, solo).party_info_list, first.party_info_list)
                const conversion = getDb().prepare(`SELECT response_json FROM player_operation_receipts
                    WHERE player_id=? AND operation='weapon_riven_convert'`).get(p.id)
                assert.deepEqual(JSON.parse(conversion.response_json).party_info_list, first.party_info_list)
                assert.deepEqual((await battle.finish()).party_info_list, first.party_info_list)
                savedParty(p, 1, 1, 1, souls)
                const replay = await battle.finish()
                assert.deepEqual(savedSouls(p), souls)
                assert.deepEqual(replay.party_info_list, solo
                    ? [{ ...first.party_info_list[0], party_name: 'Saved', ability_soul_ids: souls }] : first.party_info_list)
                assert.deepEqual(battleReceipt(p, solo).party_info_list, first.party_info_list)
                assert.equal(items.getPlayerItemSync(p.id, unknown), 20 - convertedCount)
                assert.equal(count(p), convertedCount)
            } finally { await battle.close() }
        })
    }

    test(`${mode} preserves changed and unconverted slots in frozen party 12 after the current party changes`, async () => {
        const p = player(), other = player()
        items.setPlayerItemSync(p.id, unknown, 20)
        savedParty(p, 1, 2, 2, [unknown, null, unknown])
        savedParty(p, 2, 2, 2, [unknown, null, unknown])
        savedParty(other, 1, 2, 2, [unknown, null, unknown])
        const battle = await startBattle(p, solo, 12)
        try {
            const table = solo ? 'five_boss_solo_runs' : 'five_boss_gauntlet_members'
            const frozen = getDb().prepare(`SELECT riven_loadout_json FROM ${table} WHERE player_id=?`).get(p.id)
            assert.equal(JSON.parse(frozen.riven_loadout_json).partyId, 12)
            savedParty(p, 1, 2, 2, [1000001, unknown, unknown])
            if (!solo) battle.room.five_boss_runtime.weaponRivenLoadoutByPlayerId[p.id].partyId = 1
            const result = await battle.finish()
            assert.equal(count(p), 2)
            assert.deepEqual(savedSouls(p, 1, 2, 2), [1000001, unknown, null])
            assert.deepEqual(savedSouls(p), [unknown, null, null])
            assert.deepEqual(savedSouls(p, 2, 2, 2), [unknown, null, unknown])
            assert.deepEqual(savedSouls(other, 1, 2, 2), [unknown, null, unknown])
            assert.deepEqual(result.party_info_list.map(row => [row.party_category, row.party_id]), [[1, 12]])
            assert.deepEqual(battleReceipt(p, solo).party_info_list, result.party_info_list)
        } finally { await battle.close() }
    })

    test(`${mode} auto-dismantling at 20 also clears converted slots while unknown inventory remains`, async () => {
        const p = player([unknown, 1000001, unknown])
        seedCards(p, 20)
        items.setPlayerItemSync(p.id, unknown, 20)
        const battle = await startBattle(p, solo)
        try {
            const result = await battle.finish()
            assert.equal(count(p), 20)
            assert.equal(result.weapon_riven_auto_dismantled.length, 2)
            assert.deepEqual(result.weapon_riven_granted, [])
            assert.equal(items.getPlayerItemSync(p.id, unknown), 18)
            assert.deepEqual(savedSouls(p), [null, 1000001, null])
            assert.deepEqual(result.party_info_list[0].ability_soul_ids, [null, 1000001, null])
            assert.deepEqual(battleReceipt(p, solo).party_info_list, result.party_info_list)
        } finally { await battle.close() }
    })
}

test('cleanup counts protected unconverted battle slots but trims other parties from the last reference', () => {
    const p = player([unknown, unknown, unknown])
    savedParty(p, 1, 1, 2, [unknown, unknown, unknown])
    savedParty(p, 1, 2, 1, [unknown, null, null])
    savedParty(p, 2, 1, 1, [unknown, unknown, unknown])
    const frozen = load('lib/weapon-riven/battle').getSoloWeaponRivenStartLoadoutSync(p.id, 11)
    savedParty(p, 1, 2, 1, [unknown, unknown, unknown])
    const result = rivens.convertUnknownWeaponRivensSync(p.id, frozen, 'protected-order', () => 0)
    assert.equal(result.item_list[unknown], 4)
    assert.deepEqual(savedSouls(p, 1, 2, 1), [null, unknown, unknown])
    assert.deepEqual(savedSouls(p), [unknown, unknown, null])
    assert.deepEqual(savedSouls(p, 1, 1, 2), [null, null, null])
    assert.deepEqual(savedSouls(p, 2, 1, 1), [null, null, null])
    const keys = result.party_info_list.map(row => `${row.party_category}:${row.party_id}`)
    assert.equal(new Set(keys).size, 4)
    assert.deepEqual([...keys].sort(), ['1:1', '1:11', '1:2', '2:1'])
})

test('no conversion due to empty inventory or no owned weapon leaves every saved slot unchanged', () => {
    for (const reason of ['inventory', 'weapons']) {
        const p = player([unknown, unknown, unknown])
        if (reason === 'inventory') items.setPlayerItemSync(p.id, unknown, 0)
        else getDb().prepare('DELETE FROM players_equipment WHERE player_id=?').run(p.id)
        const frozen = load('lib/weapon-riven/battle').getSoloWeaponRivenStartLoadoutSync(p.id, 1)
        const result = rivens.convertUnknownWeaponRivensSync(p.id, frozen, `no-conversion:${reason}`, () => assert.fail('Must not roll'))
        assert.deepEqual(result.party_info_list, [])
        assert.deepEqual(savedSouls(p), [unknown, unknown, unknown])
        assert.equal(items.getPlayerItemSync(p.id, unknown), reason === 'inventory' ? 0 : 5)
        assert.equal(count(p), 0)
    }
})
