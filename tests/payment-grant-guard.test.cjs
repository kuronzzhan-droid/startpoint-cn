const { test } = require('node:test')
const assert = require('node:assert/strict')
const { PaymentGrantGuard } = require('../out/lib/payment-grant-guard')

function fixture(options = {}) {
    let now = 0
    const guard = new PaymentGrantGuard({ now: () => now, ...options })
    function grant(playerId, productId = 'A') {
        const input = { playerId, productId }, decision = guard.check(input)
        if (decision.allowed) guard.commit(input, decision.at)
        return decision
    }
    return { guard, grant, clock: value => { now = value } }
}

test('10-second cooldown is per player/product and only successful commits consume it', () => {
    const f = fixture()
    assert.equal(f.guard.check({ playerId: 1, productId: 'A' }).allowed, true)
    assert.deepEqual(f.guard.inspect(), { players: 0, products: 0, grants: 0 })
    assert.equal(f.grant(1).allowed, true)
    f.clock(9_999)
    assert.equal(f.grant(1).retryAfterMs, 1)
    assert.equal(f.grant(1, 'B').allowed, true)
    assert.equal(f.grant(2).allowed, true)
    f.clock(10_000)
    assert.equal(f.grant(1).allowed, true)
    assert.equal(f.guard.inspect().grants, 4)
})

test('fixed hourly window admits 60 grants across products, refuses 61 and recovers at exact boundary', () => {
    const f = fixture()
    for (let n = 0; n < 60; n++) assert.equal(f.grant(1, String(n)).allowed, true)
    assert.equal(f.grant(1, '61').reason, 'hourly_cap')
    f.clock(3_599_999)
    assert.equal(f.grant(1, '61').retryAfterMs, 1)
    assert.equal(f.guard.inspect().grants, 60)
    f.clock(3_600_000)
    assert.equal(f.grant(1, '61').allowed, true)
    assert.equal(f.guard.inspect().grants, 1)
    f.clock(3_610_000)
    assert.equal(f.grant(1, '61').allowed, true)
    f.clock(7_199_999)
    for (let n = 0; n < 58; n++) assert.equal(f.grant(1, String(n)).allowed, true)
    assert.equal(f.grant(1, 'extra').reason, 'hourly_cap', 'later successes must not move the window start')
    f.clock(7_200_000)
    assert.equal(f.grant(1, 'extra').allowed, true)
})

test('hour rollover preserves a recent product cooldown and clock rollback cannot refill budget', () => {
    const f = fixture()
    f.grant(1, 'A')
    f.clock(3_599_999); f.grant(1, 'B')
    f.clock(3_600_000)
    assert.equal(f.grant(1, 'B').reason, 'product_cooldown')
    assert.equal(f.grant(1, 'A').allowed, true)
    f.clock(0)
    assert.equal(f.grant(1, 'A').reason, 'product_cooldown')
    f.clock(NaN)
    assert.equal(f.grant(1, 'C').reason, 'invalid_clock')
    f.clock(3_610_000)
    assert.equal(f.grant(1, 'B').allowed, true)
})

test('5000 active players remain protected; capacity rejection recovers only after expiry', () => {
    const f = fixture()
    for (let id = 1; id <= 5_000; id++) assert.equal(f.grant(id).allowed, true)
    assert.equal(f.grant(5_001).reason, 'capacity')
    assert.equal(f.guard.inspect().players, 5_000)
    assert.equal(f.grant(1).reason, 'product_cooldown')
    f.clock(10_000)
    assert.equal(f.grant(5_001).reason, 'capacity')
    assert.equal(f.grant(1).allowed, true, 'capacity must not block an already tracked subject')
    f.clock(3_600_000)
    assert.equal(f.grant(5_001).allowed, true)
    assert.equal(f.guard.inspect().players, 1)
})

test('bounded product tracking keeps recent cooldowns across hourly expiry', () => {
    const f = fixture({ maxTrackedPlayers: 1 })
    f.grant(1)
    f.clock(3_599_999); f.grant(1, 'B')
    f.clock(3_600_000)
    assert.equal(f.grant(2).reason, 'capacity', 'recent cooldown cannot be evicted at hour expiry')
    f.clock(3_609_999)
    assert.equal(f.grant(2).allowed, true)
    for (let n = 0; n < 1_000; n++) {
        f.clock(3_620_000 + 10_000 * n)
        f.grant(2, String(n))
        assert.equal(f.guard.inspect().products <= 1, true)
    }
})
