'use strict'
const assert = require('node:assert/strict'), path = require('node:path')
const out = process.env.STARPOINT_TEST_OUT_DIR || path.resolve(__dirname, '../out')
const compiled = name => require(path.join(out, name))

// This trusted test-only bootstrap runs the production owner, RPC transport and
// TCP server. Only the selected reverse-RPC clock is advanced: the registered
// production 10-second callback runs unchanged; every other clock remains real.
exports.register = async (executor, lifecycle) => {
    const timers = new Map(), requests = [], events = []
    const realSetTimeout = global.setTimeout, realClearTimeout = global.clearTimeout
    const realSend = process.send, rpc = compiled('multi/coordinator/business-rpc')
    const realInvoke = rpc.invokeRealtimeBusiness
    let latestTimer
    global.setTimeout = function (callback, delay, ...args) {
        const handle = realSetTimeout(callback, delay, ...args)
        if (delay === 10_000 && String(callback).includes('BUSINESS_OUTCOME_UNKNOWN')) {
            latestTimer = { handle, callback, args, active: true, delay }
            timers.set(handle, latestTimer)
        }
        return handle
    }
    global.clearTimeout = function (handle) {
        if (timers.has(handle)) timers.get(handle).active = false
        return realClearTimeout(handle)
    }
    process.send = function (message, ...args) {
        if (latestTimer && ['business-request', 'tcp-work-begin', 'tcp-work-end'].includes(message.t)) {
            Object.assign(latestTimer, { requestId: message.requestId, kind: message.kind, payload: message.payload })
            requests.push(latestTimer); latestTimer = undefined
        }
        return realSend.call(process, message, ...args)
    }
    rpc.invokeRealtimeBusiness = async (kind, payload) => {
        try { return await realInvoke(kind, payload) }
        catch (error) {
            if (error.code === 'BUSINESS_OUTCOME_UNKNOWN') {
                const request = requests.findLast(value => value.kind === kind
                    && JSON.stringify(value.payload) === JSON.stringify(payload))
                assert.ok(request, 'unknown outcome belongs to a real child request')
                const identity = structuredClone(payload.identity)
                events.push({ kind, identity, requestId: request.requestId, status: 'unknown', code: error.code })
                void error.confirmation.then(value => events.push({ kind, identity, requestId: request.requestId,
                    status: 'confirmed', snapshotId: value?.snapshotId }), failure => events.push({ kind, identity,
                    requestId: request.requestId, status: 'rejected', code: failure.code || failure.message }))
            }
            throw error // The production gate receives the original confirmation promise.
        }
    }
    executor.register('p2fixture.rpcTimeout', ({ kind }) => {
        const request = requests.findLast(value => value.kind === kind && value.active)
        assert.ok(request, `pending real RPC timer: ${kind}`)
        assert.equal(request.delay, 10_000, 'production default has not been shortened')
        request.active = false; realClearTimeout(request.handle); request.callback(...request.args)
        return { kind, requestId: request.requestId, timeoutMs: request.delay }
    })
    executor.register('p2fixture.rpcEvidence', () => events)
    executor.register('p2fixture.rivenGet', reference => rpc.invokeRealtimeBusiness('riven.get', reference))
    return compiled('multi/coordinator/realtime-owner-bootstrap').register(executor, lifecycle)
}

if (process.env.MULTI_REALTIME_OWNER_CHILD !== '1') {
    process.env.MULTI_REALTIME_PROCESS = '1'
    const { test, after } = require('node:test')
    const { fixture, load, until, sleep } = require('./helpers/weapon-riven-p2-wire.cjs')
    after(() => { load('lib/client-admission').clientAdmission().close(); load('data/db').getDb().close() })

    function delayedOwner(t) {
        const module = load('multi/coordinator/command-process'), Original = module.CommandProcessTransport
        const calls = [], holds = []
        const block = kind => {
            let release
            const hold = { kind, pending: new Promise(resolve => { release = resolve }), release: () => release() }
            holds.push(hold); return hold
        }
        t.after(() => holds.forEach(hold => hold.release()))
        t.mock.method(module, 'CommandProcessTransport', class extends Original {
            constructor(options) {
                super({ ...options, registerModule: __filename, businessHandler: async (kind, payload) => {
                    calls.push({ kind, payload: structuredClone(payload) })
                    const value = await options.businessHandler(kind, payload)
                    const hold = holds.find(entry => entry.kind === kind && !entry.applied)
                    if (hold) {
                        Object.assign(hold, { applied: true, payload: structuredClone(payload), value: structuredClone(value) })
                        await hold.pending // Business is applied; only its original IPC reply is delayed.
                    }
                    return value
                } })
            }
        })
        return { calls, block }
    }
    const rpcCommand = (x, kind, payload = {}) => x.runtime.getRoomCommandGateway().execute(kind, payload)
    async function evidence(x, kind, status, requestId) {
        for (let n = 0; n < 300; n++) {
            const events = await rpcCommand(x, 'p2fixture.rpcEvidence')
            const event = events.find(value => value.kind === kind && value.status === status
                && (requestId === undefined || value.requestId === requestId))
            if (event) return event
            await sleep(5)
        }
        assert.fail(`missing child RPC ${kind} ${status}`)
    }
    function balances(x, ticketId) {
        const db = load('data/db').getDb()
        return x.members.map(member => ({
            stamina: db.prepare('SELECT stamina FROM players WHERE id=?').get(member.id).stamina,
            ticket: load('data/domains/item').getPlayerItemSync(member.id, ticketId),
            active: db.prepare('SELECT COUNT(*) AS n FROM players_active_quests WHERE player_id=?').get(member.id).n,
        }))
    }
    async function timeoutAndGet(x, hold) {
        const timer = await rpcCommand(x, 'p2fixture.rpcTimeout', { kind: hold.kind })
        const unknown = await evidence(x, hold.kind, 'unknown', timer.requestId)
        assert.equal(unknown.code, 'BUSINESS_OUTCOME_UNKNOWN')
        assert.deepEqual(unknown.identity, hold.payload.identity)
        const stored = await rpcCommand(x, 'p2fixture.rivenGet', { identity: hold.payload.identity,
            snapshotId: hold.value.snapshotId,
            ...(hold.payload.battleSessionId ? { battleSessionId: hold.payload.battleSessionId } : {}) })
        assert.deepEqual(stored.identity, hold.payload.identity)
        assert.equal(stored.snapshotId, hold.value.snapshotId)
        assert.equal(stored.canonical, hold.value.canonical)
        return timer.requestId
    }

    test('actual owner IPC unknown freeze and commit await their original replies before Start or a single five-boss debit', { timeout: 25000 }, async t => {
        const owner = delayedOwner(t), frozen = owner.block('riven.freeze'), committed = owner.block('riven.commit')
        const mode = load('multi/five-boss/contract').FIVE_BOSS_GAUNTLET
        const x = await fixture(t, ['p2-wire', 'p2-wire'], { unknown: true,
            scope: { category: mode.category, quest_id: mode.visibleQuestId } })
        assert.equal(x.status.mode, 'process'); assert.notEqual(x.status.pid, process.pid)
        assert.equal(x.status.endpoint.database, 'business-rpc-only')
        const before = balances(x, mode.ticketItemId)
        x.wires[0].send([0, [6]])
        await until(() => frozen.applied, 'parent applies freeze before holding its IPC reply')
        const freezeRequestId = await timeoutAndGet(x, frozen)
        const starts = [x.startHttp(x.members[0]), x.startHttp(x.members[0]), x.startHttp(x.members[1])]
        for (const pending of starts) void pending.catch(() => {})
        x.wires[0].send([0, [6]]); await sleep(30)
        assert.ok(x.wires.every(wire => wire.prepared().length === 0 && wire.messages(5).length === 0))
        assert.deepEqual(balances(x, mode.ticketItemId), before, 'unknown freeze cannot charge or create an active quest')
        assert.equal(owner.calls.filter(call => call.kind === 'riven.freeze').length, 1)
        frozen.release()
        const confirmedFreeze = await evidence(x, 'riven.freeze', 'confirmed', freezeRequestId)
        assert.equal(confirmedFreeze.snapshotId, frozen.value.snapshotId)
        await until(() => x.wires.every(wire => wire.latest()), 'prepare after original freeze confirmation')
        x.wires.forEach(wire => wire.ack())
        await until(() => committed.applied, 'parent applies commit before holding its IPC reply')
        const commitRequestId = await timeoutAndGet(x, committed)
        x.wires.forEach(wire => wire.ack()); x.wires[0].send([0, [6]]); await sleep(30)
        assert.ok(x.wires.every(wire => wire.messages(5).length === 0))
        assert.deepEqual(balances(x, mode.ticketItemId), before, 'unknown commit cannot release payment or Start')
        assert.equal(owner.calls.filter(call => call.kind === 'riven.commit').length, 1)
        committed.release()
        const confirmedCommit = await evidence(x, 'riven.commit', 'confirmed', commitRequestId)
        assert.equal(confirmedCommit.snapshotId, frozen.value.snapshotId)
        await x.started()
        for (const response of await Promise.all(starts)) {
            assert.equal(response.statusCode, 200, response.body)
            assert.equal(response.json().data_headers.result_code, 1, response.body)
        }
        for (const wire of x.wires) {
            assert.equal(wire.messages(5).length, 1)
            assert.deepEqual(wire.messages(5)[0][1][1], frozen.value.members)
        }
        const paid = balances(x, mode.ticketItemId)
        assert.deepEqual(paid, [{ stamina: before[0].stamina - mode.staminaCost, ticket: before[0].ticket - 1, active: 1 },
            { stamina: before[1].stamina, ticket: before[1].ticket, active: 1 }])
        assert.equal(load('data/db').getDb().prepare('SELECT COUNT(*) AS n FROM five_boss_gauntlet_members WHERE player_id IN (?,?)')
            .get(...x.members.map(member => member.id)).n, 2)
    })

    test('late original IPC confirmation after cancelled unknown freeze cannot overwrite or unlock a newer preparation', { timeout: 20000 }, async t => {
        const owner = delayedOwner(t), old = owner.block('riven.freeze'), x = await fixture(t)
        const mode = load('multi/five-boss/contract').FIVE_BOSS_GAUNTLET, before = balances(x, mode.ticketItemId)
        x.wires[0].send([0, [6]]); await until(() => old.applied, 'old freeze applied')
        const oldRequestId = await timeoutAndGet(x, old), member = x.members[1]
        const parties = load('data/domains/party'), groups = parties.getPlayerPartyGroupListSync(member.id, 1)
        parties.updatePlayerPartySync(member.id, 2, { ...groups[1].list[1], name: 'next P2 party' }, 1)
        x.wires[1].send([0, [2, { currentPartyId: 2, party: x.wires[1].messages(0)[0][1][1].party }, false, 2]])
        await until(() => x.wires[0].messages(8).some(frame => frame[1][1].startsWith('WFR2_CANCEL|')), 'cancel old unknown candidate')
        x.wires.forEach(wire => wire.send([0, [3, [1]]])); await sleep(30)
        x.wires[0].send([0, [6]]); await until(() => x.wires.every(wire => wire.latest()), 'new candidate prepared')
        const next = structuredClone(x.wires[0].latest())
        assert.notEqual(next[0].party.weapon_riven_snapshot_id, old.value.snapshotId)
        assert.equal(next.find(mate => mate.viewerId === member.viewerId).currentPartyId, 2)
        old.release(); await evidence(x, 'riven.freeze', 'confirmed', oldRequestId); await sleep(30)
        assert.equal(owner.calls.filter(call => call.kind === 'riven.freeze').length, 2)
        assert.ok(x.wires.every(wire => wire.prepared().length === 1 && wire.messages(5).length === 0))
        assert.deepEqual(x.wires[0].latest(), next)
        assert.deepEqual(balances(x, mode.ticketItemId), before)
        x.wires.forEach(wire => wire.ack(old.value.members)); await sleep(30)
        assert.ok(x.wires.every(wire => wire.messages(5).length === 0))
        x.wires.forEach(wire => wire.ack()); await x.started()
        for (const wire of x.wires) assert.deepEqual(wire.messages(5)[0][1][1], next)
    })
}
