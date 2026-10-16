const test = require('node:test')
const assert = require('node:assert/strict')
const { BattleTelemetry } = require('../out/multi/battle-telemetry')

function room(overrides = {}) {
    return {
        room_number: '880001', category: 2, quest_id: 1099001,
        lifecycle: { battleSessionId: 'battle-1' },
        mates: [{ viewer_id: 11, com_id: 0 }, { viewer_id: 12, com_id: 0 }, { viewer_id: null, com_id: 1 }],
        five_boss_runtime: { runId: 'run-1' },
        ...overrides,
    }
}

test('one summary per battle with per-member gaps, warnings, disconnects and barriers', () => {
    let now = 1_000
    const lines = []
    const telemetry = new BattleTelemetry(() => now, line => lines.push(line), 2)
    telemetry.begin(room())
    telemetry.connected('880001', 11)
    now += 200; telemetry.packet('880001', 11, 0, 0)
    now += 5_000; telemetry.packet('880001', 11, 1)
    now += 31_000; telemetry.packet('880001', 11, 0, 4)
    now += 10; telemetry.packet('880001', 11, 0, 1)
    telemetry.relayed('880001', 12)
    telemetry.backpressure('880001', 12, 1234.4)
    telemetry.disconnected('880001', 12, 'socket_error')
    telemetry.barrier('880001', 'initial', 812.6)
    telemetry.barrier('880001', 'next_scene', 4_000)
    telemetry.seatExpired('880001')
    now += 1_000
    const summary = telemetry.end('880001', 'returning:settlement')
    assert.equal(lines.length, 1)
    assert.ok(lines[0].startsWith('[MULTI-BATTLE] {'))
    assert.deepEqual(JSON.parse(lines[0].slice('[MULTI-BATTLE] '.length)), summary)
    assert.equal(summary.fiveBoss, true)
    assert.equal(summary.realMembers, 2)
    assert.equal(summary.aiMembers, 1)
    assert.equal(summary.durationMs, 37_210)
    assert.deepEqual(summary.barriers, [{ kind: 'initial', waitMs: 813 }, { kind: 'next_scene', waitMs: 4000 }])
    assert.equal(summary.seatsExpired, 1)
    const host = summary.members.find(member => member.viewer === 11)
    assert.equal(host.connections, 1)
    assert.equal(host.packets, 4)
    assert.equal(host.broadcasts, 1)
    assert.equal(host.sceneReady, 1)
    assert.equal(host.levelNext, 1)
    assert.equal(host.lineSpeedWarnings, 1)
    assert.equal(host.maxInboundGapMs, 31_000)
    assert.deepEqual(host.longGaps, [{ ms: 5_000, atMs: 5_200, scene: 0 }, { ms: 31_000, atMs: 36_200, scene: 0 }])
    assert.equal('lastInboundAt' in host, false)
    const guest = summary.members.find(member => member.viewer === 12)
    assert.equal(guest.relayedOut, 1)
    assert.equal(guest.backpressureEpisodes, 1)
    assert.equal(guest.maxBackpressureMs, 1234)
    assert.deepEqual(guest.disconnects, { socket_error: 1 })
    assert.equal(telemetry.activeCount(), 0)
    assert.equal(telemetry.end('880001', 'again'), undefined, 'a battle is summarized once')
})

test('long inbound gaps keep the three longest in time order with their scene', () => {
    let now = 1_000
    const telemetry = new BattleTelemetry(() => now, () => {}, 2)
    telemetry.begin(room())
    const report = maxGapMs => telemetry.relayActivity('880001', 11,
        { packets: 1, broadcasts: 1, lineSpeedWarnings: 0, maxGapMs, relayedOut: 2 })
    now += 1_000; report(2_000)
    now += 1_000; report(999)
    now += 1_000; telemetry.packet('880001', 11, 0, 1)
    now += 1_000; report(6_000)
    now += 1_000; report(1_500)
    now += 1_000; report(4_000)
    const host = telemetry.end('880001', 'returning:settlement').members.find(member => member.viewer === 11)
    assert.equal(host.maxInboundGapMs, 6_000)
    assert.deepEqual(host.longGaps, [
        { ms: 2_000, atMs: 1_000, scene: 0 },
        { ms: 6_000, atMs: 4_000, scene: 1 },
        { ms: 4_000, atMs: 6_000, scene: 1 },
    ])
})

test('events for rooms without an active battle are ignored and recent history is bounded', () => {
    const lines = []
    const telemetry = new BattleTelemetry(Date.now, line => lines.push(line), 2)
    telemetry.packet('nope', 1, 1)
    telemetry.disconnected('nope', 1, 'peer_fin')
    for (const number of ['1', '2', '3']) {
        telemetry.begin(room({ room_number: number, five_boss_runtime: undefined }))
        telemetry.end(number, 'disbanded:test')
    }
    assert.equal(lines.length, 3)
    assert.deepEqual(telemetry.recentSummaries().map(summary => summary.room), ['2', '3'])
    assert.equal(telemetry.recentSummaries()[0].fiveBoss, false)
})

test('MULTI_BATTLE_TELEMETRY=false disables collection', t => {
    process.env.MULTI_BATTLE_TELEMETRY = 'false'
    t.after(() => { delete process.env.MULTI_BATTLE_TELEMETRY })
    const lines = []
    const telemetry = new BattleTelemetry(Date.now, line => lines.push(line), 2)
    telemetry.begin(room())
    assert.equal(telemetry.activeCount(), 0)
    assert.equal(telemetry.end('880001', 'x'), undefined)
    assert.equal(lines.length, 0)
})

test('the coordinator opens a summary on BATTLE and closes it when the room leaves BATTLE', () => {
    const { battleTelemetry } = require('../out/multi/battle-telemetry')
    const { EmbeddedMultiCoordinator } = require('../out/multi/coordinator/embedded')
    const coordinator = new EmbeddedMultiCoordinator()
    const r = room({ room_number: '880077', lobby_generation: 0, raising_state: 1, five_boss_runtime: undefined })
    r.lifecycle = coordinator.createLifecycle()
    const original = console.warn
    const lines = []
    console.warn = line => lines.push(String(line))
    try {
        assert.equal(coordinator.commitBattleStart(r).ok, true)
        assert.equal(battleTelemetry.activeCount() >= 1, true)
        assert.equal(coordinator.commitDisband(r, 'test_disband').ok, true)
    } finally { console.warn = original }
    const line = lines.find(value => value.startsWith('[MULTI-BATTLE]'))
    assert.ok(line)
    const summary = JSON.parse(line.slice('[MULTI-BATTLE] '.length))
    assert.equal(summary.room, '880077')
    assert.equal(summary.end, 'disbanded:test_disband')
    assert.equal(summary.battle, r.lifecycle.battleSessionId)
})
