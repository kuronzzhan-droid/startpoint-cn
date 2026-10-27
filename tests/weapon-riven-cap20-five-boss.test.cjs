const { test } = require('node:test')
const assert = require('node:assert/strict')
const { getDb, items, runtime, unknown, player, identity, multi, finishMulti, appFor,
    startBody, finishBody, count, seedCards, savedSouls, httpMulti,
} = require('./helpers/weapon-riven-five-boss-fixture.cjs')
const fragments = 16000900

function cappedPlayer(held, unknownAmount = 3) {
    const p = player([unknown, unknown, unknown])
    seedCards(p, held)
    items.setPlayerItemSync(p.id, unknown, unknownAmount)
    items.setPlayerItemSync(p.id, fragments, 7)
    return p
}
function assertEvents(events, amount) {
    assert.equal(events.length, amount)
    for (const event of events) {
        assert.equal(event.weapon_id, 300101)
        assert.deepEqual(event.rewards, [[fragments, 3]])
        assert.ok(event.affixes.length > 0)
        for (const affix of event.affixes) {
            assert.equal(affix.length, 3)
            assert.ok(affix.every(Number.isInteger))
            assert.ok(affix[1] >= 1 && affix[1] <= 100)
            assert.ok(affix[2] >= 1 && affix[2] <= 100)
        }
    }
}
function conversionReceipt(p) {
    const row = getDb().prepare(`SELECT response_json FROM player_operation_receipts
        WHERE player_id=? AND operation='weapon_riven_convert'`).get(p.id)
    return row && JSON.parse(row.response_json)
}
function assertNoConversionReceipts(p) {
    const row = getDb().prepare(`SELECT COUNT(*) AS n FROM player_operation_receipts
        WHERE player_id=? AND operation IN ('weapon_riven_convert','weapon_riven_grant')`).get(p.id)
    assert.equal(row.n, 0)
}

test('multiplayer at 19 stores its last card; at 20 consumes the unknown and grants exactly three fragments', () => {
    for (const held of [19, 20]) {
        const p = cappedPlayer(held, 1)
        const result = finishMulti(p, multi(p))
        assert.equal(count(p), 20)
        assert.equal(Object.keys(result.reward.weapon_riven_list).length, 20 - held)
        assert.deepEqual(result.reward.weapon_riven_granted, held === 19 ? [16000020] : [])
        assertEvents(result.reward.weapon_riven_auto_dismantled, held === 20 ? 1 : 0)
        assert.equal(items.getPlayerItemSync(p.id, unknown), 0)
        assert.equal(items.getPlayerItemSync(p.id, fragments), held === 20 ? 10 : 7)
        assert.deepEqual(savedSouls(p), [null, unknown, unknown])
    }
})

test('multiplayer three-slot conversion crosses 20 once and receipts preserve both overflow events', async () => {
    const p = cappedPlayer(19), room = multi(p)
    const first = finishMulti(p, room)
    const events = first.reward.weapon_riven_auto_dismantled
    assertEvents(events, 2)
    assert.equal(count(p), 20)
    assert.deepEqual(first.reward.weapon_riven_granted, [16000020])
    assert.equal(first.reward.itemTotals[unknown], 0)
    assert.equal(first.reward.itemTotals[fragments], 13)
    assert.deepEqual(conversionReceipt(p).weapon_riven_auto_dismantled, events)
    const receipt = getDb().prepare('SELECT reward_json FROM five_boss_gauntlet_receipts WHERE player_id=?').get(p.id)
    assert.deepEqual(JSON.parse(receipt.reward_json).weapon_riven_auto_dismantled, events)
    items.setPlayerItemSync(p.id, unknown, 42)
    items.setPlayerItemSync(p.id, fragments, 91)
    const replay = finishMulti(p, room, true, () => assert.fail('Replay must not draw'))
    assert.equal(replay.receiptStatus, 'already_settled')
    assert.deepEqual(replay.reward, first.reward)
    const response = (await httpMulti(p, room)).data
    assert.deepEqual(response.weapon_riven_auto_dismantled, events)
    assert.equal(response.item_list[unknown], 42)
    assert.equal(response.item_list[fragments], 91)
    assert.equal(count(p), 20)
    assert.equal(items.getPlayerItemSync(p.id, fragments), 91)
    assert.equal(getDb().prepare('SELECT reward_json FROM five_boss_gauntlet_receipts WHERE player_id=?').get(p.id).reward_json, receipt.reward_json)
})

test('solo cap and crossing settlements persist overflow; both receipt paths replay events with current fragment balances', async () => {
    for (const held of [19, 20]) {
        const p = cappedPlayer(held), app = await appFor(p)
        try {
            assert.equal((await app.inject({ method: 'POST', url: '/start', payload: startBody(p) })).statusCode, 200)
            const first = await app.inject({ method: 'POST', url: '/finish', payload: finishBody(p) })
            assert.equal(first.statusCode, 200, first.body)
            const data = first.json().data, events = data.weapon_riven_auto_dismantled
            assertEvents(events, held === 19 ? 2 : 3)
            assert.equal(count(p), 20)
            assert.deepEqual(data.weapon_riven_granted, held === 19 ? [16000020] : [])
            assert.equal(data.item_list[unknown], 0)
            assert.equal(data.item_list[fragments], held === 19 ? 13 : 16)
            assert.deepEqual(savedSouls(p), [null, null, null])
            assert.deepEqual(conversionReceipt(p).weapon_riven_auto_dismantled, events)
            const soloReceipt = getDb().prepare('SELECT response_json FROM five_boss_solo_runs WHERE player_id=?').get(p.id)
            assert.deepEqual(JSON.parse(soloReceipt.response_json).data.weapon_riven_auto_dismantled, events)
            const operationReceipt = getDb().prepare(`SELECT response_json FROM player_operation_receipts
                WHERE player_id=? AND operation='quest_finish.single'`).get(p.id)
            assert.deepEqual(JSON.parse(operationReceipt.response_json).data.weapon_riven_auto_dismantled, events)
            // With the battle settlement ledger a missing operation receipt is a corrupt
            // settlement and is refused, so only the receipt path itself is replayed.
            for (const fallback of [false]) {
                if (fallback) getDb().prepare("DELETE FROM player_operation_receipts WHERE player_id=? AND operation='quest_finish.single'").run(p.id)
                items.setPlayerItemSync(p.id, fragments, fallback ? 123 : 91)
                items.setPlayerItemSync(p.id, unknown, 42)
                const replay = await app.inject({ method: 'POST', url: '/finish', payload: finishBody(p) })
                assert.equal(replay.statusCode, 200, replay.body)
                assert.deepEqual(replay.json().data.weapon_riven_auto_dismantled, events)
                assert.equal(replay.json().data.item_list[fragments], fallback ? 123 : 91)
                assert.equal(replay.json().data.item_list[unknown], 42)
                assert.equal(count(p), 20)
                assert.equal(items.getPlayerItemSync(p.id, fragments), fallback ? 123 : 91)
            }
            assert.equal(getDb().prepare('SELECT response_json FROM five_boss_solo_runs WHERE player_id=?').get(p.id).response_json, soloReceipt.response_json)
        } finally { await app.close() }
    }
})

test('failed and abandoned multiplayer or solo battles at cap leave unknowns, fragments and parties untouched', async () => {
    for (const solo of [false, true]) for (const abandoned of [false, true]) {
        const p = cappedPlayer(20)
        if (solo) {
            const app = await appFor(p)
            try {
                assert.equal((await app.inject({ method: 'POST', url: '/start', payload: startBody(p) })).statusCode, 200)
                const response = await app.inject({ method: 'POST', url: abandoned ? '/abort' : '/finish', payload: finishBody(p, false) })
                assert.equal(response.statusCode, 200, response.body)
                assert.deepEqual(response.json().data.weapon_riven_auto_dismantled ?? [], [])
            } finally { await app.close() }
        } else {
            const room = multi(p)
            if (abandoned) runtime.abortFiveBossBattle(identity(p, room))
            else assert.equal(finishMulti(p, room, false).kind, 'failed')
        }
        assert.equal(count(p), 20)
        assert.equal(items.getPlayerItemSync(p.id, unknown), 3)
        assert.equal(items.getPlayerItemSync(p.id, fragments), 7)
        assert.deepEqual(savedSouls(p), [unknown, unknown, unknown])
        assertNoConversionReceipts(p)
    }
})

test('multiplayer receipt failure rolls back the stored card, auto fragments, unknown debit and party cleanup together', () => {
    const p = cappedPlayer(19), room = multi(p)
    getDb().exec(`CREATE TEMP TRIGGER fail_cap20_receipt BEFORE INSERT ON five_boss_gauntlet_receipts
        BEGIN SELECT RAISE(ABORT, 'cap20 receipt failure'); END`)
    try { assert.throws(() => finishMulti(p, room), /cap20 receipt failure/) }
    finally { getDb().exec('DROP TRIGGER fail_cap20_receipt') }
    assert.equal(count(p), 19)
    assert.equal(items.getPlayerItemSync(p.id, unknown), 3)
    assert.equal(items.getPlayerItemSync(p.id, fragments), 7)
    assert.deepEqual(savedSouls(p), [unknown, unknown, unknown])
    assert.equal(items.getPlayerItemSync(p.id, 10000145), null)
    assertNoConversionReceipts(p)
    const retry = finishMulti(p, room)
    assertEvents(retry.reward.weapon_riven_auto_dismantled, 2)
    assert.equal(count(p), 20)
    assert.equal(items.getPlayerItemSync(p.id, fragments), 13)
})

test('solo final receipt failure rolls back all conversion writes and the solo receipt, then retry grants once', async () => {
    const p = cappedPlayer(19), app = await appFor(p)
    try {
        assert.equal((await app.inject({ method: 'POST', url: '/start', payload: startBody(p) })).statusCode, 200)
        getDb().exec(`CREATE TEMP TRIGGER fail_cap20_solo_receipt BEFORE INSERT ON player_operation_receipts
            WHEN NEW.operation='quest_finish.single'
            BEGIN SELECT RAISE(ABORT, 'cap20 solo receipt failure'); END`)
        try {
            const failed = await app.inject({ method: 'POST', url: '/finish', payload: finishBody(p) })
            assert.equal(failed.statusCode, 500, failed.body)
        } finally { getDb().exec('DROP TRIGGER fail_cap20_solo_receipt') }
        assert.equal(count(p), 19)
        assert.equal(items.getPlayerItemSync(p.id, unknown), 3)
        assert.equal(items.getPlayerItemSync(p.id, fragments), 7)
        assert.deepEqual(savedSouls(p), [unknown, unknown, unknown])
        assert.equal(items.getPlayerItemSync(p.id, 10000145), null)
        assertNoConversionReceipts(p)
        assert.equal(getDb().prepare('SELECT response_json FROM five_boss_solo_runs WHERE player_id=?').get(p.id).response_json, null)
        const retry = await app.inject({ method: 'POST', url: '/finish', payload: finishBody(p) })
        assert.equal(retry.statusCode, 200, retry.body)
        assertEvents(retry.json().data.weapon_riven_auto_dismantled, 2)
        assert.equal(count(p), 20)
        assert.equal(items.getPlayerItemSync(p.id, fragments), 13)
    } finally { await app.close() }
})
