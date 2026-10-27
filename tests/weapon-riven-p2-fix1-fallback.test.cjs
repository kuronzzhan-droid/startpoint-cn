'use strict'
process.env.MULTI_REALTIME_PROCESS = '0'
const { test, after } = require('node:test'), assert = require('node:assert/strict')
const { fixture, load, until, sleep, canonical } = require('./helpers/weapon-riven-p2-wire.cjs')

after(() => { load('lib/client-admission').clientAdmission().close(); load('data/db').getDb().close() })

function gate(t, value) {
    const before = process.env.WEAPON_RIVEN_MULTI_ENABLED
    if (value === undefined) delete process.env.WEAPON_RIVEN_MULTI_ENABLED
    else process.env.WEAPON_RIVEN_MULTI_ENABLED = value
    t.after(() => {
        if (before === undefined) delete process.env.WEAPON_RIVEN_MULTI_ENABLED
        else process.env.WEAPON_RIVEN_MULTI_ENABLED = before
    })
}
function interceptRiven(t, failure) {
    const rpc = load('multi/coordinator/business-rpc'), invoke = rpc.invokeRealtimeBusiness, calls = []
    t.mock.method(rpc, 'invokeRealtimeBusiness', async (kind, payload) => {
        if (!kind.startsWith('riven.')) return invoke(kind, payload)
        calls.push(kind)
        if (!failure || kind === 'riven.freeze') throw Object.assign(new Error(failure || 'GATE_OFF_RIVEN_RPC'), { code: failure })
        return invoke(kind, payload)
    })
    return calls
}
async function roomFixture(t, { fiveBoss = false, noRiven = false } = {}) {
    const mode = load('multi/five-boss/contract').FIVE_BOSS_GAUNTLET
    let update
    if (noRiven) {
        const parties = load('data/domains/party'), realUpdate = parties.updatePlayerPartySync
        update = t.mock.method(parties, 'updatePlayerPartySync', (playerId, partyId, party, ...rest) =>
            realUpdate(playerId, partyId, { ...party, abilitySoulIds: [null, null, null] }, ...rest))
    }
    try {
        const x = await fixture(t, ['p2-wire', 'p2-wire'], fiveBoss ? { unknown: true,
            scope: { category: mode.category, quest_id: mode.visibleQuestId } } : {})
        // A real legacy client sends its selected party on Enter. The P2 helper's
        // empty Enter is only sufficient when successful freeze rebuilds from DB.
        for (const wire of x.wires) {
            const saved = load('data/domains/party').getPlayerPartyGroupListSync(wire.member.id, 1)[1].list[1]
            const party = load('multi/party-snapshot').buildRealParty(wire.member.id, saved)
            const welcomes = wire.messages(0).length
            wire.send([0, [0, { party, autoplayMode: false }, 1]])
            await until(() => wire.messages(0).length > welcomes, 'selected saved party Enter')
        }
        for (const wire of x.wires) wire.send([0, [3, [1]]])
        await until(() => x.members.every(member => load('multi/state/SessionManager').sessionManager
            .getClient(member.viewerId, x.room)?.isReady), 'selected party Ready')
        return x
    } finally { update?.mock.restore() }
}
function balances(x) {
    const db = load('data/db').getDb(), mode = load('multi/five-boss/contract').FIVE_BOSS_GAUNTLET
    return x.members.map(member => ({
        stamina: db.prepare('SELECT stamina FROM players WHERE id=?').get(member.id).stamina,
        ticket: load('data/domains/item').getPlayerItemSync(member.id, mode.ticketItemId),
        active: db.prepare('SELECT COUNT(*) AS n FROM players_active_quests WHERE player_id=?').get(member.id).n,
    }))
}
function successful(response) {
    assert.equal(response.statusCode, 200, response.body)
    assert.equal(response.json().data_headers.result_code, 1, response.body)
}

for (const scenario of [
    { value: undefined, first: 'TCP', fiveBoss: false },
    { value: '0', first: 'HTTP', fiveBoss: false },
    { value: undefined, first: 'HTTP', fiveBoss: true },
    { value: '0', first: 'TCP', fiveBoss: true },
]) test(`Fix1 gate ${scenario.value ?? 'unset'} ${scenario.fiveBoss ? 'five-boss' : 'ordinary'} ${scenario.first}-first starts without any riven RPC or ACK`,
    { timeout: 20000 }, async t => {
        gate(t, scenario.value)
        const calls = interceptRiven(t), x = await roomFixture(t, scenario)
        let hostResponse
        if (scenario.first === 'HTTP') { hostResponse = await x.startHttp(x.members[0]); successful(hostResponse) }
        x.wires[0].send([0, [6]])
        await x.started()
        for (const wire of x.wires) {
            assert.equal(wire.prepared().length, 0, 'legacy gate-off path has no P2 ACK preparation')
            assert.equal(wire.messages(5).length, 1)
        }
        if (!hostResponse) successful(await x.startHttp(x.members[0]))
        successful(await x.startHttp(x.members[1]))
        assert.deepEqual(balances(x).map(row => row.active), [1, 1])
        assert.deepEqual(calls, [], 'disabled gate must not acquire a riven business dependency')
    })

for (const rejection of ['BUSINESS_CHANNEL_CLOSED', 'BUSINESS_PENDING_BUDGET']) test(`Fix1 unknown freeze confirmation rejecting ${rejection} never downgrades an uncertain operation`,
    { timeout: 15000 }, async t => {
        gate(t, '1')
        const rpc = load('multi/coordinator/business-rpc'), invoke = rpc.invokeRealtimeBusiness, calls = []
        let rejectConfirmation
        const confirmation = new Promise((_resolve, reject) => { rejectConfirmation = reject })
        t.mock.method(rpc, 'invokeRealtimeBusiness', async (kind, payload) => {
            if (!kind.startsWith('riven.')) return invoke(kind, payload)
            calls.push(kind)
            if (kind === 'riven.freeze') throw Object.assign(new Error('BUSINESS_OUTCOME_UNKNOWN'),
                { code: 'BUSINESS_OUTCOME_UNKNOWN', confirmation })
            return invoke(kind, payload)
        })
        const x = await roomFixture(t), before = balances(x), started = x.startHttp(x.members[0])
        await until(() => calls.includes('riven.freeze'), 'unknown freeze is awaiting original confirmation')
        await sleep(40)
        assert.ok(x.wires.every(wire => !wire.prepared().length && !wire.messages(5).length))
        assert.deepEqual(balances(x), before)
        rejectConfirmation(Object.assign(new Error(rejection), { code: rejection }))
        await until(() => x.wires.every(wire => wire.messages(8)
            .some(frame => frame[1][1].startsWith('WFR2_CANCEL|'))), 'unknown confirmation failure cancels')
        const response = await started
        assert.equal(response.statusCode, 200, response.body)
        assert.notEqual(response.json().data_headers.result_code, 1, response.body)
        assert.ok(x.wires.every(wire => !wire.prepared().length && !wire.messages(5).length))
        assert.deepEqual(balances(x), before)
        assert.equal(calls.filter(kind => kind === 'riven.freeze').length, 1)
        assert.ok(!calls.includes('riven.validate') && !calls.includes('riven.commit'))
    })

for (const scenario of [
    { code: 'REALTIME_BUSINESS_CHANNEL_UNAVAILABLE', first: 'TCP', noRiven: true },
    { code: 'UNKNOWN_REALTIME_BUSINESS_KIND', first: 'HTTP', noRiven: true },
    { code: 'UNKNOWN_RIVEN_BUSINESS_KIND', first: 'TCP' },
    { code: 'BUSINESS_PENDING_BUDGET', first: 'HTTP' },
    { code: 'REALTIME_BUSINESS_CHANNEL_UNAVAILABLE', first: 'HTTP', fiveBoss: true },
]) test(`Fix1 ${scenario.fiveBoss ? 'five-boss' : scenario.noRiven ? 'no-riven ordinary' : 'equipped ordinary'} ${scenario.first}-first ${scenario.code} disables whole room and starts after exact ACKs`,
    { timeout: 20000 }, async t => {
        gate(t, '1')
        const calls = interceptRiven(t, scenario.code), x = await roomFixture(t, scenario), before = balances(x)
        let completed = 0
        const starts = scenario.first === 'HTTP' ? x.members.map(member => x.startHttp(member)
            .then(response => { completed++; return response })) : []
        if (scenario.first === 'TCP') x.wires[0].send([0, [6]])
        await until(() => x.wires.every(wire => wire.latest()), 'disabled fallback preparation')
        const prepared = structuredClone(x.wires[0].latest()), expected = canonical(prepared)
        for (const wire of x.wires) {
            assert.deepEqual(wire.latest(), prepared)
            assert.ok(wire.messages(8).some(frame => frame[1][1].endsWith('|rpc_unavailable')))
        }
        for (const mate of prepared) {
            assert.equal(mate.party.weapon_riven_mode, 0)
            assert.equal(mate.party.weapon_riven_catalog, 'none')
            assert.equal(mate.party.weapon_riven_reason, 'rpc_unavailable')
            assert.deepEqual(mate.party.weapon_rivens, [[1], [1], [1]])
            const member = x.members.find(value => value.viewerId === mate.viewerId)
            assert.deepEqual(mate.party.abilitySoulIds[member.slot], [1], 'instance soul effects are stripped')
            if (scenario.fiveBoss) assert.deepEqual(mate.party.abilitySoulIds[2], [0, 16000000])
        }
        assert.deepEqual(balances(x), before)
        assert.equal(completed, 0)
        x.wires[0].ack(); x.wires[0].ack(); await sleep(40)
        assert.ok(x.wires.every(wire => wire.messages(5).length === 0), 'duplicate host ACK does not count for guest')
        assert.deepEqual(balances(x), before)
        assert.equal(completed, 0)
        x.wires[1].ack(); await x.started()
        for (const wire of x.wires) {
            assert.equal(wire.messages(5).length, 1)
            assert.deepEqual(wire.messages(5)[0][1][1], prepared)
            assert.equal(canonical(wire.messages(5)[0][1][1]), expected)
        }
        if (!starts.length) starts.push(...x.members.map(member => x.startHttp(member)))
        for (const response of await Promise.all(starts)) successful(response)
        assert.deepEqual(calls, ['riven.freeze'], 'local disabled fallback must not validate or commit by unavailable RPC')
        assert.deepEqual(balances(x).map(row => row.active), [1, 1])
        if (scenario.fiveBoss) {
            const mode = load('multi/five-boss/contract').FIVE_BOSS_GAUNTLET
            const room = load('multi/room/manager').getRoom(x.room), db = load('data/db').getDb()
            for (const member of x.members) {
                const trusted = room.five_boss_runtime.weaponRivenLoadoutByPlayerId[member.id]
                const expectedSouls = [0, 0, 16000000]; expectedSouls[member.slot] = member.itemId
                assert.deepEqual(trusted.abilitySoulIds, expectedSouls, 'conversion uses saved owned loadout, not stripped wire party')
                const row = db.prepare('SELECT riven_loadout_json FROM five_boss_gauntlet_members WHERE player_id=?').get(member.id)
                assert.deepEqual(JSON.parse(row.riven_loadout_json), trusted)
            }
            assert.deepEqual(balances(x), [
                { stamina: before[0].stamina - mode.staminaCost, ticket: before[0].ticket - 1, active: 1 },
                { stamina: before[1].stamina, ticket: before[1].ticket, active: 1 },
            ])
        }
    })

for (const code of ['RIVEN_PLAYER_AUTHORIZATION', 'RIVEN_ADMISSION_REJECTED', 'BUSINESS_CHANNEL_CLOSED']) test(`Fix1 ${code} remains a rejection and never enters disabled fallback`,
    { timeout: 15000 }, async t => {
        gate(t, '1')
        const calls = interceptRiven(t, code), x = await roomFixture(t), before = balances(x)
        const started = x.startHttp(x.members[0])
        await until(() => x.wires.every(wire => wire.messages(8)
            .some(frame => frame[1][1].startsWith('WFR2_CANCEL|'))), 'authorization rejection cancels preparation')
        const response = await started
        assert.equal(response.statusCode, 200, response.body)
        assert.notEqual(response.json().data_headers.result_code, 1, response.body)
        for (const wire of x.wires) {
            assert.equal(wire.prepared().length, 0)
            assert.equal(wire.messages(5).length, 0)
            assert.ok(!wire.messages(8).some(frame => frame[1][1].endsWith('|rpc_unavailable')))
        }
        assert.deepEqual(balances(x), before)
        assert.equal(calls.filter(kind => kind === 'riven.freeze').length, 1)
        assert.ok(!calls.includes('riven.validate') && !calls.includes('riven.commit'))
    })
