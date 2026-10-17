const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const out = process.env.STARPOINT_TEST_OUT_DIR || path.resolve(__dirname, '../out')
const { BoundedLatencyHistogram, MeasurementCollector } = require(path.join(out, 'multi/latency-statistics'))
const { BattleTelemetry } = require(path.join(out, 'multi/battle-telemetry'))

test('fixed buckets bound memory and report quantiles, overflow and small tail sample counts', () => {
    const h = new BoundedLatencyHistogram()
    const empty = h.snapshot()
    assert.equal(empty.p99Ms, null)
    for (let i = 1; i <= 100; i++) h.record(i)
    assert.deepEqual([h.snapshot().p50Ms, h.snapshot().p95Ms, h.snapshot().p99Ms], [50, 95, 99])
    assert.equal(h.snapshot().p99TailSampleEstimate, 1)
    h.record(90000); h.record(NaN); h.record(-1)
    assert.equal(h.snapshot().overflowCount, 1)
    assert.equal(h.snapshot().maxMs, 90000)
    assert.equal(h.snapshot().invalidSamples, 2)
    for (let i = 0; i < 100000; i++) h.record(.1)
    assert.equal(h.snapshot().bucketCount, empty.bucketCount)
    assert.ok(h.snapshot().p50Ms >= .1 && h.snapshot().p50Ms <= .1625)
})

test('RTT and adjacent-success jitter use only matched local timestamps; generic ACKs excluded', () => {
    let now = 100
    const c = new MeasurementCollector({ clock: () => now, timeoutMs: 100 })
    const one = c.start(); now = 120
    assert.equal(c.receive(one.id, one.sentAt), 'success')
    assert.equal(c.receive(0, 0), 'generic')
    const two = c.start(); now = 155
    assert.equal(c.receive(two.id, two.sentAt), 'success')
    assert.equal(c.receive(two.id, two.sentAt), 'duplicate')
    assert.equal(c.receive(998, 100), 'unmatched')
    const s = c.snapshot()
    assert.equal(s.success, 2); assert.equal(s.genericIgnored, 1); assert.equal(s.duplicate, 1)
    assert.equal(s.rttMs.meanMs, 27.5); assert.equal(s.jitterMs.meanMs, 15)
    assert.equal(s.rttMs.count, 2)
})

test('late responses keep deadline misses and do not contaminate on-time RTT/jitter', () => {
    let now = 10
    const c = new MeasurementCollector({ clock: () => now, timeoutMs: 30 })
    const one = c.start(); now = 40
    assert.equal(c.expire(), 1)
    now = 50
    assert.equal(c.receive(one.id, one.sentAt), 'late')
    assert.equal(c.receive(one.id, one.sentAt), 'duplicate')
    const two = c.start(); now = 81
    assert.equal(c.receive(two.id, two.sentAt), 'late', 'deadline expiry also detected on receipt')
    const s = c.snapshot()
    assert.equal(s.timeout, 2); assert.equal(s.late, 2); assert.equal(s.pending, 0)
    assert.equal(s.rttMs.count, 0); assert.equal(s.jitterMs.count, 0); assert.equal(s.lateRttMs.count, 2)
})

test('mismatched echoes do not consume a pending request and negative elapsed times are invalid', () => {
    let now = 100
    const c = new MeasurementCollector({ clock: () => now })
    const m = c.start(); now = 105
    assert.equal(c.receive(m.id, 99), 'mismatched')
    assert.equal(c.receive(m.id, m.sentAt, 90), 'invalid')
    assert.equal(c.snapshot().pending, 1)
    assert.equal(c.receive(m.id, m.sentAt), 'success')
    assert.throws(() => c.start(m.id), /new positive/)
    assert.throws(() => c.start(2 ** 31), /int32/)
})

test('pending and completed retention are bounded; ancient replies explicitly become unmatched', () => {
    let now = 10
    const c = new MeasurementCollector({ clock: () => now, maxPending: 1, maxCompleted: 2, timeoutMs: 20 })
    const old = c.start()
    assert.throws(() => c.start(), /capacity/)
    now += 1; c.receive(old.id, old.sentAt)
    for (let i = 0; i < 4; i++) { const m = c.start(); now += 1; c.receive(m.id, m.sentAt) }
    assert.equal(c.snapshot().retainedCompleted, 2)
    assert.equal(c.receive(old.id, old.sentAt), 'unmatched')
    assert.equal(c.snapshot().capacityRejected, 1)
    assert.throws(() => new MeasurementCollector({ maxPending: Infinity }))
})

test('server control spans are separate metrics and never fabricated player RTT', () => {
    const t = new BattleTelemetry(() => 1000, () => {}, 0)
    t.begin({ room_number: 'latency-test', category: 2, quest_id: 1 })
    t.controlDelay('latency-test', 'relay-control', 20)
    t.controlDelay('latency-test', 'relay-control', 40)
    t.controlDelay('latency-test', 'unbounded-label', 900)
    t.controlDelay('latency-test', 'member-sync', NaN)
    const s = t.end('latency-test', 'test')
    assert.equal(s.serverControlDelayMs['relay-control'].count, 2)
    assert.equal(s.serverControlDelayMs['relay-control'].meanMs, 30)
    assert.equal(s.serverControlDelayMs['member-sync'], undefined)
    assert.equal(s.serverControlDelayMs['unbounded-label'], undefined)
    assert.equal(s.rttMs, undefined)
})
