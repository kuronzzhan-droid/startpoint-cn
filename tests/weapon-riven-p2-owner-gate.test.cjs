'use strict'
const assert = require('node:assert/strict'), { test } = require('node:test')
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module')
const ts = require('typescript')
require('ts-node/register/transpile-only')
const { canonicalRivenMembers } = require('../src/lib/weapon-riven/multi-protocol')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve)) }
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }

function fixture() {
    const room = { room_number: '901001', category: 1, quest_id: 1001, lobby_generation: 0,
        lifecycle: { instanceId: 'room-1', phase: 'LOBBY', battleSessionId: null } }
    const peers = [1, 2].map(id => ({ viewerId: id, playerId: id, connectionId: `peer-${id}`,
        roomNumber: room.room_number, roomGeneration: 0, equipmentSelectedPartyId: 1,
        socket: { destroyed: false }, superseded: false, enterData: {},
        yourself: { viewerId: id, connectionId: `peer-${id}`, state: [1], party: {
            characters: [[0, { id }], [1], [1]], unison_characters: [[1], [1], [1]],
            equipments: [[1], [1], [1]], abilitySoulIds: [[1], [1], [1]],
        } } }))
    const frames = [], calls = [], disbands = [], snapshots = []
    let freezeOverride, commitOverride, validateOverride, gate
    const manager = {
        getClient: id => peers.find(peer => peer.viewerId === id), getClientsInRoom: () => peers,
        sendFrame: (socket, frame) => { frames.push({ socket, data: JSON.parse(frame.slice(0, -1)) }); return 'sent' },
        sendJson() {}, broadcastToRoom() {},
        commitRoomDisband: (number, reason) => { disbands.push({ number, reason }); room.lifecycle.phase = 'DISBANDED'; gate.releaseWeaponRivenRoom(room); return true },
    }
    function makeSnapshot(request) {
        const snapshotId = `snapshot-${snapshots.length + 1}`
        const members = request.members.map(member => ({ ...structuredClone(member.mate), party: {
            ...structuredClone(member.mate.party), weapon_rivens: [[1], [1], [1]],
            weapon_riven_scope: 'multi-v1', weapon_riven_snapshot_id: snapshotId,
            weapon_riven_mode: 0, weapon_riven_catalog: 'none', weapon_riven_reason: 'mixed_version',
        } }))
        const snapshot = { identity: request.identity, snapshotId, members, mode: 0, catalog: 'none',
            reason: 'mixed_version', ackConnectionIds: peers.map(peer => peer.connectionId),
            canonical: canonicalRivenMembers(members), conversionLoadouts: [], audit: [], rulesDigest: 'x', sha256: 'x' }
        snapshots.push(snapshot); return snapshot
    }
    const stubs = new Map([
        ['../../multi/room/manager', { getRoom: () => room }],
        ['../../multi/state/SessionManager', { sessionManager: manager }],
        ['../../multi/coordinator/embedded', { embeddedMultiCoordinator: { enqueueRoomCommand: (_number, fn) => Promise.resolve().then(fn) } }],
        ['../../multi/coordinator/socket-admission', { getSocketRivenCredentials: () => ({ token: 'token', session: 'session', weaponRiven: { p1: true, p2: true, catalog: 'catalog' } }) }],
        ['../../multi/room/equipment-ready', { selectedPartyId: peer => peer.equipmentSelectedPartyId, setPreparation: (peer, state) => { peer.yourself.state = state } }],
        ['../../multi/coordinator/business-rpc', {
            retainRealtimeBusinessTail: promise => promise,
            createRealtimeMaintenanceTimer: fn => fn(), runWithTcpBusinessAdmission: fn => Promise.resolve().then(fn),
            invokeRealtimeBusiness: async (kind, payload) => {
                calls.push({ kind, payload })
                if (kind === 'riven.freeze') return freezeOverride ? freezeOverride(payload, makeSnapshot) : makeSnapshot(payload)
                if (kind === 'riven.commit') return commitOverride ? commitOverride(payload) : snapshots.find(s => s.snapshotId === payload.snapshotId)
                if (kind === 'riven.validate') return validateOverride ? validateOverride(payload) : { ok: true }
                return true
            },
        }],
    ])
    const filename = path.resolve(__dirname, '../src/lib/weapon-riven/multi-room.ts')
    const isolated = new Module(filename, module), realRequire = Module.createRequire(filename)
    isolated.filename = filename; isolated.paths = Module._nodeModulePaths(path.dirname(filename))
    isolated.require = request => stubs.has(request) ? stubs.get(request) : realRequire(request)
    isolated._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    }).outputText, filename)
    gate = isolated.exports
    return { room, peers, frames, calls, disbands, snapshots, gate,
        freeze: fn => { freezeOverride = fn }, commit: fn => { commitOverride = fn },
        validate: fn => { validateOverride = fn },
        prepare: deadline => gate.startWeaponRivenPreparation(room, peers.map(peer => peer.yourself), () => {}, deadline),
        async ack() { await flush(); const snapshot = snapshots.at(-1); peers.forEach(peer => gate.acceptWeaponRivenAck(peer,
            `WFR2|A|${snapshot.snapshotId}|${snapshot.canonical}`)); await flush() },
        bind(id) { room.lifecycle.phase = 'BATTLE'; room.lifecycle.battleSessionId = id; room.lobby_generation++;
            gate.commitWeaponRivenPreparation(room) },
        next() { gate.releaseWeaponRivenRoom(room); room.lifecycle.phase = 'LOBBY'; room.lifecycle.battleSessionId = null;
            peers.forEach(peer => { peer.roomGeneration = room.lobby_generation; peer.yourself.state = [1] }) },
        close() { gate.releaseWeaponRivenRoom(room); return true },
    }
}

test('parent false commit is a failure and must never emit StartBattle', async t => {
    const x = fixture(); t.after(() => x.close()); x.commit(() => false)
    x.prepare(); await x.ack(); x.bind('battle-1'); await flush()
    assert.equal(await x.gate.waitWeaponRivenPreparation(x.room), false)
    assert.equal(x.frames.filter(frame => frame.data[1][0] === 5).length, 0)
    assert.equal(x.disbands.length, 1)
})

test('late rejected freeze cannot cancel another preparation in the same generation', async t => {
    const x = fixture(), old = deferred(); t.after(() => x.close())
    x.freeze(() => old.promise); x.prepare(); await flush()
    x.gate.cancelWeaponRivenPreparation(x.room, 'change_party'); x.freeze(null)
    x.prepare(); await x.ack(); old.reject(Error('late old freeze')); await flush()
    assert.equal(x.disbands.length, 0)
    x.bind('battle-1'); await flush()
    assert.equal(await x.gate.waitWeaponRivenPreparation(x.room), true)
    assert.equal(x.frames.filter(frame => frame.data[1][0] === 5).length, 2)
})

test('late rejected commit from a released battle cannot disband a new preparation on the same room object', async t => {
    const x = fixture(), old = deferred(); t.after(() => x.close())
    x.commit(() => old.promise); x.prepare(); await x.ack(); x.bind('battle-old'); await flush()
    x.next(); x.commit(null); x.prepare(); await x.ack()
    old.reject(Error('late old commit')); await flush()
    assert.equal(x.disbands.length, 0)
    x.bind('battle-new'); await flush()
    assert.equal(await x.gate.waitWeaponRivenPreparation(x.room), true)
    assert.equal(x.frames.filter(frame => frame.data[1][0] === 5).length, 2)
})

test('binding deadline closes the incomplete battle and a late commit cannot resurrect Start', async t => {
    const x = fixture(), delayed = deferred(); t.after(() => x.close())
    x.commit(() => delayed.promise); x.prepare(120); await x.ack(); x.bind('battle-timeout')
    await sleep(160); await flush()
    assert.equal(x.disbands.length, 1)
    assert.equal(await x.gate.waitWeaponRivenPreparation(x.room), false)
    delayed.resolve(x.snapshots[0]); await flush()
    assert.equal(x.frames.filter(frame => frame.data[1][0] === 5).length, 0)
})


test('missing positive parent validation result never grants a ready candidate', async t => {
    const x = fixture(); t.after(() => x.close()); x.validate(() => null)
    x.prepare(); await x.ack()
    assert.equal(await x.gate.waitWeaponRivenPreparation(x.room), false)
    assert.equal(x.frames.filter(frame => frame.data[1][0] === 5).length, 0)
})

test('unknown freeze outcome waits for same-request confirmation and duplicate start cannot create another freeze', async t => {
    const x = fixture(), confirmation = deferred(); t.after(() => x.close())
    let frozen
    x.freeze((request, makeSnapshot) => {
        frozen = makeSnapshot(request)
        throw Object.assign(Error('unknown freeze outcome'), { code: 'BUSINESS_OUTCOME_UNKNOWN', confirmation: confirmation.promise })
    })
    x.prepare(); await flush(); x.prepare(); await flush()
    assert.equal(x.calls.filter(call => call.kind === 'riven.freeze').length, 1)
    assert.equal(x.frames.length, 0, 'an unknown result cannot publish prepare or Start')
    confirmation.resolve(frozen); await flush(); await x.ack(); x.bind('battle-confirmed'); await flush()
    assert.equal(await x.gate.waitWeaponRivenPreparation(x.room), true)
    const committed = x.calls.find(call => call.kind === 'riven.commit').payload
    assert.deepEqual(committed.identity, x.calls.find(call => call.kind === 'riven.freeze').payload.identity)
    assert.equal(committed.snapshotId, frozen.snapshotId)
    assert.equal(x.frames.filter(frame => frame.data[1][0] === 1).length, 2)
    assert.equal(x.frames.filter(frame => frame.data[1][0] === 5).length, 2)
    for (const frame of x.frames) assert.deepEqual(frame.data[1][1], frozen.members)
})

test('unknown commit outcome withholds Start until confirmed and rejects a negative confirmation', async t => {
    for (const positive of [true, false]) {
        const x = fixture(), confirmation = deferred(); t.after(() => x.close())
        x.commit(() => { throw Object.assign(Error('unknown commit outcome'), {
            code: 'BUSINESS_OUTCOME_UNKNOWN', confirmation: confirmation.promise,
        }) })
        x.prepare(); await x.ack(); x.bind(`battle-${positive}`); await flush()
        assert.equal(x.frames.filter(frame => frame.data[1][0] === 5).length, 0)
        confirmation.resolve(positive ? x.snapshots[0] : false); await flush()
        assert.equal(await x.gate.waitWeaponRivenPreparation(x.room), positive)
        assert.equal(x.frames.filter(frame => frame.data[1][0] === 5).length, positive ? 2 : 0)
        assert.equal(x.calls.filter(call => call.kind === 'riven.commit').length, 1)
        assert.equal(x.disbands.length, positive ? 0 : 1)
        x.close()
    }
})

for (const reason of ['invalid_snapshot', 'catalog']) test(`${reason} NACK cancels the old parent identity, freezes one new disabled identity and re-arms the deadline`, async t => {
    const x = fixture(); t.after(() => x.close())
    x.freeze((payload, makeSnapshot) => {
        const snapshot = makeSnapshot(payload)
        if (payload.disabledReason) snapshot.reason = payload.disabledReason
        else snapshot.mode = 1 // owner only reads mode for the re-decision
        return snapshot
    })
    x.prepare(150); await flush()
    const first = x.snapshots[0]
    await sleep(100)
    x.gate.acceptWeaponRivenAck(x.peers[0], `WFR2|A|${first.snapshotId}|${first.canonical}`)
    x.gate.acceptWeaponRivenAck(x.peers[1], `WFR2|N|${first.snapshotId}|${reason}`); await flush()
    const freezes = x.calls.filter(call => call.kind === 'riven.freeze').map(call => call.payload)
    assert.equal(freezes.length, 2)
    assert.equal(freezes[0].disabledReason, undefined); assert.equal(freezes[1].disabledReason, 'catalog_mismatch')
    assert.notEqual(freezes[1].identity.preparationId, freezes[0].identity.preparationId)
    for (const key of ['ownerEpoch', 'roomInstanceId', 'sourceLobbyGeneration']) assert.equal(freezes[1].identity[key], freezes[0].identity[key])
    assert.deepEqual(x.calls.find(call => call.kind === 'riven.cancel').payload, { identity: freezes[0].identity, snapshotId: first.snapshotId })
    x.peers.forEach(peer => x.gate.acceptWeaponRivenAck(peer, `WFR2|A|${first.snapshotId}|${first.canonical}`)); await flush()
    assert.equal(x.calls.filter(call => call.kind === 'riven.validate').length, 0, 'old ACKs never complete the new candidate')
    await sleep(100) // past the first deadline: the re-decision got a fresh window
    await x.ack(); x.bind('battle-redecided'); await flush()
    assert.equal(await x.gate.waitWeaponRivenPreparation(x.room), true)
    const commit = x.calls.find(call => call.kind === 'riven.commit').payload
    assert.deepEqual(commit.identity, freezes[1].identity); assert.equal(commit.snapshotId, x.snapshots[1].snapshotId)
    const starts = x.frames.filter(frame => frame.data[1][0] === 5)
    assert.equal(starts.length, 2)
    for (const frame of starts) assert.deepEqual(frame.data[1][1], x.snapshots[1].members)
})

test('client NACK of an already disabled candidate cancels instead of looping', async t => {
    const x = fixture(); t.after(() => x.close())
    x.prepare(); await flush()
    const first = x.snapshots[0] // mode 0 (mixed_version)
    x.gate.acceptWeaponRivenAck(x.peers[1], `WFR2|N|${first.snapshotId}|invalid_snapshot`); await flush()
    assert.equal(x.calls.filter(call => call.kind === 'riven.freeze').length, 1)
    assert.equal(x.calls.filter(call => call.kind === 'riven.cancel').length, 1)
    assert.equal(await x.gate.waitWeaponRivenPreparation(x.room), false)
})
