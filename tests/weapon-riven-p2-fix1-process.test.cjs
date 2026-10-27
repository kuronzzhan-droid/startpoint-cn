'use strict'
const path = require('node:path'), assert = require('node:assert/strict')
const out = process.env.STARPOINT_TEST_OUT_DIR || path.resolve(__dirname, '../out')
const compiled = name => require(path.join(out, name))

// Keep the production owner and IPC transport. Observe the error received by
// the child, rather than injecting a preclassified code at its RPC boundary.
exports.register = async (executor, lifecycle) => {
    const rpc = compiled('multi/coordinator/business-rpc'), invoke = rpc.invokeRealtimeBusiness, errors = []
    rpc.invokeRealtimeBusiness = async (kind, payload) => {
        try { return await invoke(kind, payload) }
        catch (error) {
            errors.push({ kind, code: error.code ?? null, message: error.message })
            throw error
        }
    }
    executor.register('fix1fixture.rpcErrors', () => errors)
    executor.register('fix1fixture.nonRivenError', async () => {
        try { await rpc.invokeRealtimeBusiness('fix1.nonRiven', {}); return null }
        catch (error) { return { code: error.code ?? null, message: error.message } }
    })
    return compiled('multi/coordinator/realtime-owner-bootstrap').register(executor, lifecycle)
}

if (process.env.MULTI_REALTIME_OWNER_CHILD !== '1') {
    process.env.MULTI_REALTIME_PROCESS = '1'
    const { test, after } = require('node:test')
    const { fixture, load, until, sleep } = require('./helpers/weapon-riven-p2-wire.cjs')
    after(() => { load('lib/client-admission').clientAdmission().close(); load('data/db').getDb().close() })

    function missingParentHandler(t, message) {
        const module = load('multi/coordinator/command-process'), Original = module.CommandProcessTransport, calls = []
        t.mock.method(module, 'CommandProcessTransport', class extends Original {
            constructor(options) {
                super({ ...options, registerModule: __filename, businessHandler: async (kind, payload) => {
                    if (kind.startsWith('riven.')) calls.push(kind)
                    if (kind === 'riven.freeze' || kind === 'fix1.nonRiven') {
                        const error = new Error(message)
                        assert.equal(error.code, undefined, 'production unknown-kind handlers throw an unclassified Error')
                        throw error
                    }
                    return options.businessHandler(kind, payload)
                } })
            }
        })
        return calls
    }
    async function noRivenRoom(t) {
        const parties = load('data/domains/party'), update = parties.updatePlayerPartySync
        const mock = t.mock.method(parties, 'updatePlayerPartySync', (id, slot, party, ...rest) =>
            update(id, slot, { ...party, abilitySoulIds: [null, null, null] }, ...rest))
        try { return await fixture(t) }
        finally { mock.mock.restore() }
    }
    const command = (x, name) => x.runtime.getRoomCommandGateway().execute(name, {})
    function activeCount(x) {
        return load('data/db').getDb().prepare('SELECT COUNT(*) AS n FROM players_active_quests WHERE player_id IN (?,?)')
            .get(...x.members.map(member => member.id)).n
    }

    for (const [message, httpFirst] of [['UNKNOWN_REALTIME_BUSINESS_KIND', false], ['UNKNOWN_RIVEN_BUSINESS_KIND', true]]) {
        test(`Fix1 real owner IPC preserves raw ${message} and starts a no-riven room with a disabled snapshot`,
            { timeout: 20000 }, async t => {
                const calls = missingParentHandler(t, message), x = await noRivenRoom(t)
                assert.equal(x.status.mode, 'process'); assert.notEqual(x.status.pid, process.pid)
                assert.equal(x.status.endpoint.database, 'business-rpc-only')
                const starts = httpFirst ? [x.startHttp(x.members[0])] : []
                if (!httpFirst) x.wires[0].send([0, [6]])
                await until(() => x.wires.every(wire => wire.latest()), 'disabled preparation after actual IPC rejection')
                const errors = await command(x, 'fix1fixture.rpcErrors')
                assert.deepEqual(errors.filter(error => error.kind === 'riven.freeze'),
                    [{ kind: 'riven.freeze', code: message, message }])
                const prepared = structuredClone(x.wires[0].latest())
                for (const wire of x.wires) assert.deepEqual(wire.latest(), prepared)
                for (const mate of prepared) {
                    assert.equal(mate.party.weapon_riven_mode, 0)
                    assert.equal(mate.party.weapon_riven_reason, 'rpc_unavailable')
                    assert.deepEqual(mate.party.abilitySoulIds, [[1], [1], [1]])
                    assert.deepEqual(mate.party.weapon_rivens, [[1], [1], [1]])
                }
                assert.equal(activeCount(x), 0)
                x.wires[0].ack(); x.wires[0].ack(); await sleep(30)
                assert.ok(x.wires.every(wire => wire.messages(5).length === 0))
                x.wires[1].ack(); await x.started()
                if (!httpFirst) starts.push(x.startHttp(x.members[0]))
                starts.push(x.startHttp(x.members[1]))
                for (const response of await Promise.all(starts)) {
                    assert.equal(response.statusCode, 200, response.body)
                    assert.equal(response.json().data_headers.result_code, 1, response.body)
                }
                assert.equal(activeCount(x), 2)
                assert.deepEqual(calls, ['riven.freeze'], 'disabled local snapshot never calls parent validate or commit')
                for (const wire of x.wires) {
                    assert.equal(wire.messages(5).length, 1)
                    assert.deepEqual(wire.messages(5)[0][1][1], prepared)
                }
                assert.deepEqual(await command(x, 'fix1fixture.nonRivenError'),
                    { code: 'BUSINESS_HANDLER_FAILED', message: 'BUSINESS_HANDLER_FAILED' },
                    'the same raw message outside riven RPC retains the existing generic error contract')
            })
    }

    for (const message of ['RIVEN_PLAYER_AUTHORIZATION', 'UNKNOWN_REALTIME_BUSINESS_KIND:private-detail']) {
        test(`Fix1 actual IPC does not downgrade raw ${message}`, { timeout: 20000 }, async t => {
            missingParentHandler(t, message)
            const x = await noRivenRoom(t), started = x.startHttp(x.members[0])
            await until(() => x.wires.every(wire => wire.messages(8)
                .some(frame => frame[1][1].startsWith('WFR2_CANCEL|'))), 'ordinary handler failure cancels')
            const response = await started
            assert.notEqual(response.json().data_headers.result_code, 1, response.body)
            assert.deepEqual((await command(x, 'fix1fixture.rpcErrors')).filter(error => error.kind === 'riven.freeze'),
                [{ kind: 'riven.freeze', code: 'BUSINESS_HANDLER_FAILED', message: 'BUSINESS_HANDLER_FAILED' }])
            assert.equal(activeCount(x), 0)
            for (const wire of x.wires) {
                assert.equal(wire.prepared().length, 0)
                assert.equal(wire.messages(5).length, 0)
                assert.ok(!wire.messages(8).some(frame => frame[1][1].endsWith('|rpc_unavailable')))
            }
        })
    }
}
