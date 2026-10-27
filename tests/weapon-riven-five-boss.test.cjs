const { test } = require('node:test')
const assert = require('node:assert/strict')
const { load, getDb, items, rivens, runtime, mode, unknown, player, identity, multi, finishMulti,
    appFor, startBody, finishBody, count, savedParty, savedSouls, httpMulti,
} = require('./helpers/weapon-riven-five-boss-fixture.cjs')

test('multiplayer freezes three saved slots, converts owned weapons and replays its exact receipt', () => {
    const p = player([unknown, 0, unknown]), room = multi(p)
    getDb().prepare('UPDATE players_parties SET ability_soul_1=NULL,ability_soul_3=NULL WHERE player_id=?').run(p.id)
    room.five_boss_runtime.weaponRivenLoadoutByPlayerId[p.id].abilitySoulIds = [0, 0, 0]
    const first = finishMulti(p, room)
    assert.equal(Object.keys(first.reward.weapon_riven_list).length, 2)
    assert.deepEqual(first.reward.weapon_riven_granted, [16000001, 16000002])
    assert.equal(first.reward.itemTotals[unknown], 3)
    assert.deepEqual(first.reward.weapon_riven_deleted, [])
    assert.ok(Object.values(first.reward.weapon_riven_list).every(card => card.weapon_id === 300101))
    assert.equal(getDb().prepare('SELECT COUNT(*) AS n FROM players_items WHERE player_id=? AND id BETWEEN 16000001 AND 16000200').get(p.id).n, 0)
    items.setPlayerItemSync(p.id, unknown, 42)
    const replay = finishMulti(p, room, true, () => assert.fail('Replay must not draw'))
    assert.equal(replay.receiptStatus, 'already_settled')
    assert.deepEqual(replay.reward, first.reward)
    assert.equal(items.getPlayerItemSync(p.id, unknown), 42)
    assert.equal(count(p), 2)
})

test('failed multiplayer and explicit abort do not reveal or debit unknown rivens', () => {
    for (const abandoned of [false, true]) {
        const p = player([unknown, unknown, unknown]), room = multi(p)
        if (abandoned) runtime.abortFiveBossBattle(identity(p, room))
        else assert.equal(finishMulti(p, room, false).kind, 'failed')
        assert.equal(items.getPlayerItemSync(p.id, unknown), 5)
        assert.equal(count(p), 0)
        assert.deepEqual(savedSouls(p), [unknown, unknown, unknown])
    }
})

test('multiplayer HTTP replay exposes current balances and current cleaned party without replaying rewards', async () => {
    const p = player([unknown, unknown, unknown])
    items.setPlayerItemSync(p.id, unknown, 1)
    const room = multi(p), settled = finishMulti(p, room)
    assert.deepEqual(savedSouls(p), [null, unknown, unknown])
    assert.deepEqual(settled.reward.party_info_list[0].ability_soul_ids, [null, unknown, unknown])
    items.setPlayerItemSync(p.id, unknown, 99)
    items.setPlayerItemSync(p.id, 10000145, 999)
    savedParty(p, 1, 1, 1, [unknown, 1000001, null])
    const snapshots = load('multi/party-snapshot')
    snapshots.setRealPartySnapshot(p.id, { staleReceiptParty: true, abilitySoulIds: [[0, unknown], [0, unknown], [0, unknown]] })
    const payload = await httpMulti(p, room)
    assert.equal(snapshots.getRealPartySnapshot(p.id).staleReceiptParty, undefined)
    assert.equal(payload.data.item_list[unknown], 99)
    assert.equal(payload.data.item_list[10000145], 999)
    assert.equal(payload.data.item_list[16000001], 1)
    assert.deepEqual(payload.data.party_info_list[0].ability_soul_ids, [unknown, 1000001, null])
    assert.deepEqual(payload.data.weapon_riven_list, settled.reward.weapon_riven_list)
    assert.deepEqual(payload.data.weapon_riven_deleted, [])
    assert.deepEqual(payload.data.weapon_riven_granted, [16000001])
    assert.equal(count(p), 1)
    assert.deepEqual(savedSouls(p), [unknown, 1000001, null])
    const receipt = getDb().prepare('SELECT reward_json FROM five_boss_gauntlet_receipts WHERE player_id=?').get(p.id)
    assert.deepEqual(JSON.parse(receipt.reward_json), settled.reward)
})

test('conversion and all battle rewards roll back when receipt persistence fails', () => {
    const p = player(), room = multi(p)
    items.setPlayerItemSync(p.id, unknown, 1)
    getDb().exec(`CREATE TEMP TRIGGER fail_riven_receipt BEFORE INSERT ON five_boss_gauntlet_receipts
        BEGIN SELECT RAISE(ABORT, 'riven receipt failure'); END`)
    try { assert.throws(() => finishMulti(p, room), /riven receipt failure/) }
    finally { getDb().exec('DROP TRIGGER fail_riven_receipt') }
    assert.equal(count(p), 0)
    assert.equal(items.getPlayerItemSync(p.id, unknown), 1)
    assert.deepEqual(savedSouls(p), [unknown, null, null])
    assert.equal(items.getPlayerItemSync(p.id, 10000145), null)
    assert.equal(finishMulti(p, room).receiptStatus, 'settled')
    assert.equal(count(p), 1)
    assert.deepEqual(savedSouls(p), [null, null, null])
})

test('parent business facts authorize only the saved loadout, regardless of forged wire slots', async () => {
    const p = player([0, 0, 0])
    const facts = await load('multi/coordinator/business-handlers').handleRealtimeBusiness('player.facts', {
        playerId: p.id, category: mode.category, questId: mode.visibleQuestId, partyId: 1,
        wireParty: { characters: [[0, { id: 111001 }]], abilitySoulIds: [[0, unknown], [0, unknown], [0, unknown]] },
    })
    assert.deepEqual(facts.weaponRivenLoadout, { abilitySoulIds: [0, 0, 0], equipmentIds: [300101, 0, 0], partyId: 1 })
})

test('solo HTTP start freezes the saved party; finish and retries preserve the conversion but refresh balances', async () => {
    const p = player([unknown, unknown, 0]), app = await appFor(p)
    try {
        const start = await app.inject({ method: 'POST', url: '/start', payload: startBody(p) })
        assert.equal(start.statusCode, 200, start.body)
        getDb().prepare('UPDATE players_parties SET ability_soul_1=NULL,ability_soul_2=NULL WHERE player_id=?').run(p.id)
        assert.equal((await app.inject({ method: 'POST', url: '/start', payload: startBody(p) })).statusCode, 200)
        const first = await app.inject({ method: 'POST', url: '/finish', payload: finishBody(p) })
        assert.equal(first.statusCode, 200, first.body)
        const data = first.json().data
        assert.equal(Object.keys(data.weapon_riven_list).length, 2)
        assert.deepEqual(data.weapon_riven_granted, [16000001, 16000002])
        assert.equal(data.item_list[unknown], 3)
        assert.deepEqual(data.weapon_riven_deleted, [])
        items.setPlayerItemSync(p.id, unknown, 44)
        const retry = await app.inject({ method: 'POST', url: '/finish', payload: { ...finishBody(p), api_count: 99 } })
        assert.equal(retry.statusCode, 200, retry.body)
        assert.deepEqual(retry.json(), { ...first.json(), data: { ...data, item_list: { ...data.item_list, [unknown]: 44 } } })
        assert.equal(count(p), 2)
        assert.equal(items.getPlayerItemSync(p.id, unknown), 44)
        const receipt = getDb().prepare('SELECT response_json FROM five_boss_solo_runs WHERE player_id=? AND play_id=?').get(p.id, p.playId)
        assert.deepEqual(JSON.parse(receipt.response_json).data.weapon_riven_list, data.weapon_riven_list)
        assert.deepEqual(JSON.parse(receipt.response_json).data.weapon_riven_granted, data.weapon_riven_granted)
    } finally { await app.close() }
})

test('solo failed finish and abort preserve unknown rivens', async () => {
    for (const outcome of ['failed', 'aborted']) {
        const p = player([unknown, unknown, unknown]), app = await appFor(p)
        try {
            assert.equal((await app.inject({ method: 'POST', url: '/start', payload: startBody(p) })).statusCode, 200)
            const finish = await app.inject({ method: 'POST', url: outcome === 'aborted' ? '/abort' : '/finish',
                payload: finishBody(p, false) })
            assert.equal(finish.statusCode, 200, finish.body)
            assert.equal(items.getPlayerItemSync(p.id, unknown), 5)
            assert.equal(count(p), 0)
            assert.deepEqual(savedSouls(p), [unknown, unknown, unknown])
        } finally { await app.close() }
    }
})

test('legacy battles with no frozen loadout never infer conversion from a later saved party', () => {
    const p = player(), room = multi(p)
    getDb().prepare("UPDATE five_boss_gauntlet_members SET riven_loadout_json='{}' WHERE player_id=?").run(p.id)
    const result = finishMulti(p, room)
    assert.deepEqual(result.reward.weapon_riven_list, {})
    assert.deepEqual(result.reward.weapon_riven_granted, [])
    assert.equal(items.getPlayerItemSync(p.id, unknown), 5)
    assert.deepEqual(savedSouls(p), [unknown, null, null])
})

test('conversion trims excess references from the last category, group, party and soul slot', () => {
    const p = player([unknown, unknown, unknown]), other = player([unknown, unknown, unknown])
    savedParty(p, 1, 1, 2, [unknown, 1000001, unknown])
    savedParty(p, 1, 2, 1, [unknown, unknown, 1000001])
    savedParty(p, 2, 1, 1, [unknown, unknown, unknown])
    const converted = rivens.convertUnknownWeaponRivensSync(p.id, { abilitySoulIds: [unknown] }, 'ordered', () => 0.5)
    assert.equal(converted.item_list[unknown], 4)
    assert.deepEqual(savedSouls(p), [unknown, unknown, unknown])
    assert.deepEqual(savedSouls(p, 1, 1, 2), [unknown, 1000001, null])
    assert.deepEqual(savedSouls(p, 1, 2, 1), [null, null, 1000001])
    assert.deepEqual(savedSouls(p, 2, 1, 1), [null, null, null])
    assert.deepEqual(savedSouls(other), [unknown, unknown, unknown])
    assert.deepEqual(converted.party_info_list.map(party => [party.party_category, party.party_id]), [[1, 2], [1, 11], [2, 1]])
    items.setPlayerItemSync(p.id, unknown, 20)
    savedParty(p, 2, 1, 1, [unknown, null, 1000001])
    const replay = rivens.convertUnknownWeaponRivensSync(p.id, { abilitySoulIds: [unknown] }, 'ordered', () => assert.fail('replay drew'))
    assert.equal(replay.item_list[unknown], 20)
    assert.deepEqual(replay.party_info_list[2].ability_soul_ids, [unknown, null, 1000001])
    assert.deepEqual(savedSouls(p, 2, 1, 1), [unknown, null, 1000001])
    assert.equal(count(p), 1)
})

test('three co-op participants share source keys but each clears only its converted slot', () => {
    const members = Array.from({ length: 3 }, () => player([unknown, unknown, unknown]))
    for (const p of members) items.setPlayerItemSync(p.id, unknown, 1)
    const room = multi(members[0], members.slice(1))
    for (const p of members) {
        const result = finishMulti(p, room)
        assert.equal(Object.keys(result.reward.weapon_riven_list).length, 1)
        assert.deepEqual(result.reward.weapon_riven_granted, [16000001])
        assert.equal(items.getPlayerItemSync(p.id, unknown), 0)
        assert.deepEqual(savedSouls(p), [null, unknown, unknown])
        assert.deepEqual(result.reward.party_info_list[0].ability_soul_ids, [null, unknown, unknown])
    }
    const sources = getDb().prepare('SELECT source_key FROM player_weapon_rivens WHERE player_id IN (?,?,?)')
        .all(...members.map(p => p.id)).map(row => row.source_key)
    assert.equal(sources.length, 3)
    assert.equal(new Set(sources).size, 1)
})

test('solo cleanup returns changed parties and both receipt paths read current inventory and party state', async () => {
    const p = player([unknown, unknown, unknown]), app = await appFor(p)
    items.setPlayerItemSync(p.id, unknown, 1)
    try {
        assert.equal((await app.inject({ method: 'POST', url: '/start', payload: startBody(p) })).statusCode, 200)
        const first = await app.inject({ method: 'POST', url: '/finish', payload: finishBody(p) })
        assert.equal(first.statusCode, 200, first.body)
        assert.equal(first.json().data.item_list[unknown], 0)
        assert.deepEqual(first.json().data.party_info_list[0].ability_soul_ids, [null, unknown, unknown])
        assert.deepEqual(savedSouls(p), [null, unknown, unknown])
        savedParty(p, 1, 1, 1, [1000001, null, null])
        items.setPlayerItemSync(p.id, unknown, 7)
        items.setPlayerItemSync(p.id, 10000145, 987)
        const snapshots = load('multi/party-snapshot')
        // With the battle settlement ledger a missing operation receipt is a corrupt
        // settlement and is refused, so only the receipt path itself is replayed.
        for (const legacy of [false]) {
            if (legacy) getDb().prepare("DELETE FROM player_operation_receipts WHERE player_id=? AND operation='quest_finish.single'").run(p.id)
            snapshots.setRealPartySnapshot(p.id, { staleReceiptParty: true, abilitySoulIds: [[0, unknown], [0, unknown], [0, unknown]] })
            const replay = await app.inject({ method: 'POST', url: '/finish', payload: { ...finishBody(p), api_count: 99 } })
            assert.equal(replay.statusCode, 200, replay.body)
            assert.equal(replay.json().data.item_list[unknown], 7)
            assert.equal(replay.json().data.item_list[10000145], 987)
            assert.deepEqual(replay.json().data.party_info_list[0].ability_soul_ids, [1000001, null, null])
            assert.equal(snapshots.getRealPartySnapshot(p.id).staleReceiptParty, undefined)
        }
        getDb().prepare('DELETE FROM player_weapon_rivens WHERE player_id=?').run(p.id)
        const deleted = await app.inject({ method: 'POST', url: '/finish', payload: finishBody(p) })
        assert.equal(deleted.json().data.item_list[16000001], 0)
        assert.deepEqual(deleted.json().data.weapon_riven_list, {})
        assert.deepEqual(deleted.json().data.weapon_riven_deleted, [16000001])
        assert.deepEqual(deleted.json().data.weapon_riven_granted, [])
        const receipt = getDb().prepare('SELECT response_json FROM five_boss_solo_runs WHERE player_id=? AND play_id=?').get(p.id, p.playId)
        assert.deepEqual(JSON.parse(receipt.response_json), first.json())
    } finally { await app.close() }
})

test('conversion replay preserves reward identity across revised cards, deletion and recycled slots, including old receipts', () => {
    const p = player([unknown, unknown, unknown])
    const source = 'identity-replay', loadout = { abilitySoulIds: [unknown, unknown, unknown] }
    const first = rivens.convertUnknownWeaponRivensSync(p.id, loadout, source, () => 0)
    assert.deepEqual(first.weapon_riven_granted, [16000001, 16000002, 16000003])
    const receipt = getDb().prepare(`SELECT response_json FROM player_operation_receipts
        WHERE player_id=? AND operation='weapon_riven_convert' AND request_key=?`).get(p.id, source)
    assert.deepEqual(JSON.parse(receipt.response_json).weapon_riven_granted, first.weapon_riven_granted)
    getDb().prepare('DELETE FROM player_weapon_rivens WHERE player_id=? AND item_id IN (?,?)').run(p.id, 16000001, 16000002)
    getDb().transaction(() => assert.equal(
        rivens.insertWeaponRivenSync(p.id, 300101, [[15990001, 50]], 'replacement', () => 0), 16000001))()
    getDb().prepare('UPDATE player_weapon_rivens SET revision=revision+1 WHERE player_id=? AND item_id=?').run(p.id, 16000003)
    const replacement = rivens.getPlayerWeaponRivenSync(p.id, 16000001)
    assert.notEqual(replacement.riven_id, first.weapon_riven_list[16000001].riven_id)
    items.setPlayerItemSync(p.id, unknown, 15)
    for (const legacy of [false, true]) {
        if (legacy) {
            const old = JSON.parse(receipt.response_json)
            delete old.weapon_riven_granted
            getDb().prepare(`UPDATE player_operation_receipts SET response_json=?
                WHERE player_id=? AND operation='weapon_riven_convert' AND request_key=?`).run(JSON.stringify(old), p.id, source)
        }
        const replay = rivens.convertUnknownWeaponRivensSync(p.id, loadout, source, () => assert.fail('replay drew'))
        assert.deepEqual(replay.weapon_riven_granted, [16000003])
        assert.deepEqual(replay.weapon_riven_deleted, [16000002])
        assert.equal(replay.weapon_riven_list[16000001].riven_id, replacement.riven_id)
        assert.equal(replay.weapon_riven_list[16000003].revision, first.weapon_riven_list[16000003].revision + 1)
        assert.equal(replay.item_list[unknown], 15)
        assert.equal(replay.item_list[16000002], 0)
        assert.equal(count(p), 2)
    }
})

test('multiplayer HTTP grants use frozen identity and old receipts remain readable after a slot is recycled', async () => {
    const p = player(), room = multi(p)
    const first = finishMulti(p, room)
    const receipt = getDb().prepare('SELECT reward_json FROM five_boss_gauntlet_receipts WHERE player_id=?').get(p.id)
    const old = JSON.parse(receipt.reward_json)
    delete old.weapon_riven_granted
    delete old.weapon_riven_auto_dismantled
    getDb().prepare('UPDATE five_boss_gauntlet_receipts SET reward_json=? WHERE player_id=?').run(JSON.stringify(old), p.id)
    const legacy = (await httpMulti(p, room)).data
    assert.deepEqual(legacy.weapon_riven_granted, [16000001])
    assert.deepEqual(legacy.weapon_riven_auto_dismantled, [])
    getDb().prepare('DELETE FROM player_weapon_rivens WHERE player_id=?').run(p.id)
    getDb().transaction(() => rivens.insertWeaponRivenSync(p.id, 300101, [[15990001, 50]], 'replacement', () => 0))()
    const replay = await httpMulti(p, room)
    assert.deepEqual(replay.data.weapon_riven_granted, [])
    assert.notEqual(replay.data.weapon_riven_list[16000001].riven_id, first.reward.weapon_riven_list[16000001].riven_id)
    assert.equal(items.getPlayerItemSync(p.id, unknown), 4)
    assert.equal(count(p), 1)
    assert.equal(getDb().prepare('SELECT reward_json FROM five_boss_gauntlet_receipts WHERE player_id=?').get(p.id).reward_json, JSON.stringify(old))
})

test('both solo receipt paths derive historical grants and reject replacement identities without granting rewards again', async () => {
    const p = player(), app = await appFor(p)
    try {
        assert.equal((await app.inject({ method: 'POST', url: '/start', payload: startBody(p) })).statusCode, 200)
        const first = await app.inject({ method: 'POST', url: '/finish', payload: finishBody(p) })
        assert.equal(first.statusCode, 200, first.body)
        const original = first.json().data.weapon_riven_list[16000001].riven_id
        for (const table of ['player_operation_receipts', 'five_boss_solo_runs']) {
            const where = table === 'player_operation_receipts' ? "AND operation='quest_finish.single'" : ''
            const old = getDb().prepare(`SELECT response_json FROM ${table} WHERE player_id=? ${where}`).get(p.id)
            const response = JSON.parse(old.response_json)
            delete response.data.weapon_riven_granted
            delete response.data.weapon_riven_auto_dismantled
            getDb().prepare(`UPDATE ${table} SET response_json=? WHERE player_id=? ${where}`).run(JSON.stringify(response), p.id)
        }
        assert.deepEqual((await app.inject({ method: 'POST', url: '/finish', payload: finishBody(p) })).json().data.weapon_riven_granted, [16000001])
        getDb().prepare('DELETE FROM player_weapon_rivens WHERE player_id=?').run(p.id)
        getDb().transaction(() => rivens.insertWeaponRivenSync(p.id, 300101, [[15990001, 50]], 'replacement', () => 0))()
        // With the battle settlement ledger a missing operation receipt is a corrupt
        // settlement and is refused, so only the receipt path itself is replayed.
        for (const fallback of [false]) {
            if (fallback) getDb().prepare("DELETE FROM player_operation_receipts WHERE player_id=? AND operation='quest_finish.single'").run(p.id)
            const replay = await app.inject({ method: 'POST', url: '/finish', payload: finishBody(p) })
            assert.equal(replay.statusCode, 200, replay.body)
            assert.deepEqual(replay.json().data.weapon_riven_granted, [])
            assert.deepEqual(replay.json().data.weapon_riven_auto_dismantled, [])
            assert.notEqual(replay.json().data.weapon_riven_list[16000001].riven_id, original)
            assert.equal(items.getPlayerItemSync(p.id, unknown), 4)
            assert.equal(count(p), 1)
        }
    } finally { await app.close() }
})
