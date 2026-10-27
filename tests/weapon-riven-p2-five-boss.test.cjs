'use strict'
process.env.MULTI_REALTIME_PROCESS = '0'
const { test, after } = require('node:test'), assert = require('node:assert/strict')
const { fixture, load, until, sleep, canonical } = require('./helpers/weapon-riven-p2-wire.cjs')
after(() => { load('lib/client-admission').clientAdmission().close(); load('data/db').getDb().close() })

test('actual five-boss HTTP/TCP uses the same frozen unknown conversion loadout through all five scenes', { timeout: 20000 }, async t => {
    const mode = load('multi/five-boss/contract').FIVE_BOSS_GAUNTLET
    const x = await fixture(t, ['p2-wire', 'p2-wire'], { unknown: true,
        scope: { category: mode.category, quest_id: mode.visibleQuestId } })
    await x.prepare()
    const frozen = structuredClone(x.wires[0].latest()), expectedCanonical = canonical(frozen)
    const snapshotId = frozen[0].party.weapon_riven_snapshot_id
    assert.ok(frozen.every(mate => mate.party.abilitySoulIds[2][1] === 16000000))
    const partyDomain = load('data/domains/party'), host = x.members[0]
    const changed = partyDomain.getPlayerPartyGroupListSync(host.id, 1)[1].list[1]
    changed.abilitySoulIds[1] = 16000000; changed.abilitySoulIds[2] = null
    changed.equipmentIds[1] = host.weaponId; changed.equipmentIds[2] = null
    partyDomain.updatePlayerPartySync(host.id, 1, changed, 1)
    x.wires.forEach(wire => wire.ack()); await x.started()
    const room = load('multi/room/manager').getRoom(x.room), battleSessionId = room.lifecycle.battleSessionId
    const conversion = room.five_boss_runtime.weaponRivenLoadoutByPlayerId[host.id]
    assert.deepEqual(conversion.abilitySoulIds, [16000001, 0, 16000000])
    assert.deepEqual(conversion.equipmentIds, [host.weaponId, 0, host.weaponId])
    for (const response of await Promise.all(x.members.map(member => x.startHttp(member)))) {
        assert.equal(response.statusCode, 200, response.body)
        assert.equal(response.json().data_headers.result_code, 1, response.body)
    }
    const ledger = load('data/db').getDb().prepare('SELECT riven_loadout_json FROM five_boss_gauntlet_members WHERE player_id=?').get(host.id)
    assert.deepEqual(JSON.parse(ledger.riven_loadout_json), conversion)
    const battle = await x.battle()
    for (let scene = 0; scene < 5; scene++) {
        if (scene > 0) { battle.forEach(wire => wire.send([0, [1]])); await sleep(20) }
        battle[0].send([0, [0]]); await sleep(20)
        assert.equal(battle[0].messages(1).length, scene)
        battle[1].send([0, [0]])
        await until(() => battle.every(wire => wire.messages(1).length === scene + 1), `five-boss scene ${scene}`)
        assert.equal(room.lifecycle.sceneEpoch, scene)
        assert.equal(room.lifecycle.battleSessionId, battleSessionId)
        assert.equal(x.wires[0].messages(5)[0][1][1][0].party.weapon_riven_snapshot_id, snapshotId)
        assert.equal(canonical(x.wires[0].messages(5)[0][1][1]), expectedCanonical)
    }
    assert.deepEqual(room.five_boss_runtime.weaponRivenLoadoutByPlayerId[host.id], conversion)
})
