'use strict'
process.env.MULTI_REALTIME_PROCESS = '1'
const { test, after } = require('node:test'), assert = require('node:assert/strict')
const { fixture, load, until, sleep } = require('./helpers/weapon-riven-p2-wire.cjs')
after(() => { load('lib/client-admission').clientAdmission().close(); load('data/db').getDb().close() })

function balances(members, ticketId) {
    const db = load('data/db').getDb()
    return members.map(member => ({ playerId: member.id,
        ...db.prepare('SELECT stamina, stamina_heal_time, total_stamina_used FROM players WHERE id=?').get(member.id),
        ticket: db.prepare('SELECT amount FROM players_items WHERE player_id=? AND id=?').get(member.id, ticketId).amount,
        activeQuests: db.prepare('SELECT COUNT(*) AS n FROM players_active_quests WHERE player_id=?').get(member.id).n,
        fiveBossRuns: db.prepare('SELECT COUNT(*) AS n FROM five_boss_gauntlet_runs WHERE host_player_id=?').get(member.id).n,
    }))
}

for (const fiveBoss of [false, true]) test(`${fiveBoss ? 'five-boss' : 'ordinary'} pending concurrent HTTP starts never charge stamina or tickets before ACK or after cancellation`,
    { timeout: 25000 }, async t => {
        const mode = load('multi/five-boss/contract').FIVE_BOSS_GAUNTLET
        const x = await fixture(t, ['p2-wire', 'p2-wire'], fiveBoss ? { unknown: true,
            scope: { category: mode.category, quest_id: mode.visibleQuestId } } : {})
        assert.equal(x.status.mode, 'process'); assert.notEqual(x.status.pid, process.pid)
        const before = balances(x.members, mode.ticketItemId)
        assert.deepEqual(before.map(row => [row.stamina, row.ticket, row.activeQuests, row.fiveBossRuns]),
            [[100, 5, 0, 0], [100, 5, 0, 0]])

        let completed = 0
        const starts = x.members.map(member => x.startHttp(member).then(response => { completed++; return response }))
        await until(() => x.wires.every(wire => wire.latest()), 'HTTP starts prepare P2 snapshot')
        await sleep(40)
        assert.equal(completed, 0, 'both HTTP requests remain pending behind the ACK gate')
        assert.deepEqual(balances(x.members, mode.ticketItemId), before, 'prepare does not mutate persisted resources')

        x.wires[0].ack(); await sleep(40)
        assert.equal(completed, 0, 'one peer ACK cannot release either HTTP start')
        assert.deepEqual(balances(x.members, mode.ticketItemId), before, 'partial ACK does not spend stamina or tickets')
        assert.ok(x.wires.every(wire => wire.messages(5).length === 0))

        const snapshotId = x.wires[1].latest()[0].party.weapon_riven_snapshot_id
        // A non-downgrade NACK reason (the shipped client's invalid_snapshot re-decides instead; catalog-nack tests).
        x.wires[1].send([0, [9, `WFR2|N|${snapshotId}|user_rejected`]])
        await until(() => x.wires.every(wire => wire.messages(8)
            .some(frame => frame[1][1].startsWith(`WFR2_CANCEL|${snapshotId}|`))), 'NACK cancels preparation')
        await until(() => completed === 2, 'cancelled HTTP requests finish')
        for (const response of await Promise.all(starts)) {
            assert.equal(response.statusCode, 200, response.body)
            assert.notEqual(response.json().data_headers.result_code, 1, response.body)
        }
        assert.deepEqual(balances(x.members, mode.ticketItemId), before, 'cancelled HTTP starts leave the exact resource rows unchanged')
        assert.ok(x.wires.every(wire => wire.messages(5).length === 0))
    })
