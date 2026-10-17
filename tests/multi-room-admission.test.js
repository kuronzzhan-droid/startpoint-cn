const test = require("node:test")
const assert = require("node:assert/strict")

const {
    RoomAdmissionRegistry,
    drainRoomAdmissionPerformanceSummary,
} = require("../out/multi/room/admission")

function withAdmissionTtl(value, operation) {
    const previous = process.env.MULTI_ROOM_ADMISSION_TTL_MS
    if (value === undefined) delete process.env.MULTI_ROOM_ADMISSION_TTL_MS
    else process.env.MULTI_ROOM_ADMISSION_TTL_MS = value
    try { return operation() }
    finally {
        if (previous === undefined) delete process.env.MULTI_ROOM_ADMISSION_TTL_MS
        else process.env.MULTI_ROOM_ADMISSION_TTL_MS = previous
    }
}

test("default reservation survives a 35-second boost prompt but expires at 60 seconds", () => {
    withAdmissionTtl(undefined, () => {
        const registry = new RoomAdmissionRegistry()
        assert.equal(registry.reserve("100008", 1, 20, [10], 3, 1_000), true)
        assert.equal(registry.claim("100008", 1, 20, "after-boost", 36_000).ok, true)
        assert.equal(registry.reserve("100009", 1, 30, [10], 3, 1_000), true)
        assert.equal(registry.has("100009", 1, 30, 60_999), true)
        assert.deepEqual(registry.claim("100009", 1, 30, "at-expiry", 61_000), {
            ok: false, reason: "expired",
        })
        assert.equal(registry.getOccupancy("100009", 1, [10], 61_001), 1)
    })
})

test("longer default reservation still limits three seats and rejects a previous generation", () => {
    withAdmissionTtl(undefined, () => {
        const registry = new RoomAdmissionRegistry()
        assert.equal(registry.reserve("100010", 7, 20, [10], 3, 1_000), true)
        assert.equal(registry.reserve("100010", 7, 30, [10], 3, 1_000), true)
        assert.equal(registry.reserve("100010", 7, 40, [10], 3, 36_000), false)
        assert.deepEqual(registry.claim("100010", 8, 20, "old-generation", 36_000), {
            ok: false, reason: "generation_mismatch",
        })
        assert.equal(registry.claim("100010", 7, 30, "current-generation", 36_000).ok, true)
        assert.deepEqual(registry.claim("100010", 7, 40, "without-selection", 36_000), {
            ok: false, reason: "missing",
        })
    })
})

test("explicit admission TTL configuration remains authoritative and invalid values use the new default", () => {
    withAdmissionTtl("15000", () => {
        const registry = new RoomAdmissionRegistry()
        registry.reserve("100011", 1, 20, [10], 3, 1_000)
        assert.equal(registry.has("100011", 1, 20, 15_999), true)
        assert.equal(registry.claim("100011", 1, 20, "configured-expiry", 16_000).ok, false)
    })
    withAdmissionTtl("90000", () => {
        const registry = new RoomAdmissionRegistry()
        registry.reserve("100012", 1, 20, [10], 3, 1_000)
        assert.equal(registry.claim("100012", 1, 20, "configured-longer", 66_000).ok, true)
    })
    for (const invalid of ["invalid", "999"]) withAdmissionTtl(invalid, () => {
        const registry = new RoomAdmissionRegistry()
        registry.reserve("100013", 1, 20, [10], 3, 1_000)
        assert.equal(registry.claim("100013", 1, 20, "fallback-default", 36_000).ok, true)
    })
})

test("claimed admission returns to the reservation when TCP closes before Enter", () => {
    const registry = new RoomAdmissionRegistry(15_000)
    assert.equal(registry.reserve("100001", 4, 20, [10], 3, 1_000), true)
    assert.deepEqual(registry.claim("100001", 4, 20, "connection-a", 1_100), {
        ok: true,
        kind: "claimed",
    })
    assert.equal(registry.releaseClaim("100001", 4, 20, "connection-a", 1_200), true)
    assert.deepEqual(registry.claim("100001", 4, 20, "connection-b", 1_300), {
        ok: true,
        kind: "claimed",
    })
    assert.equal(registry.commit("100001", 4, 20, "connection-b"), true)
    assert.equal(registry.getOccupancy("100001", 4, [10], 1_400), 1)
})

test("a replacement TCP connection owns the claim and the old socket cannot release it", () => {
    const registry = new RoomAdmissionRegistry(15_000)
    assert.equal(registry.reserve("100002", 8, 30, [10], 3, 2_000), true)
    assert.equal(registry.claim("100002", 8, 30, "old", 2_100).ok, true)
    assert.deepEqual(registry.claim("100002", 8, 30, "replacement", 2_200), {
        ok: true,
        kind: "reclaimed",
    })
    assert.equal(registry.releaseClaim("100002", 8, 30, "old", 2_300), false)
    assert.equal(registry.commit("100002", 8, 30, "replacement"), true)
})

test("a repeated HTTP selection cannot steal a live TCP claim", () => {
    const registry = new RoomAdmissionRegistry(15_000)
    assert.equal(registry.reserve("100006", 5, 30, [10], 3, 7_000), true)
    assert.equal(registry.claim("100006", 5, 30, "current", 7_100).ok, true)
    assert.equal(registry.reserve("100006", 5, 30, [10], 3, 7_200), true)
    assert.equal(registry.releaseClaim("100006", 5, 30, "other", 7_300), false)
    assert.equal(registry.commit("100006", 5, 30, "current"), true)
})

test("capacity counts reservations and claims without double-counting viewers", () => {
    const registry = new RoomAdmissionRegistry(15_000)
    assert.equal(registry.reserve("100003", 1, 20, [10], 3, 3_000), true)
    assert.equal(registry.claim("100003", 1, 20, "a", 3_100).ok, true)
    assert.equal(registry.reserve("100003", 1, 30, [10, 20], 3, 3_200), true)
    assert.equal(registry.getOccupancy("100003", 1, [10, 20], 3_300), 3)
    assert.equal(registry.reserve("100003", 1, 40, [10, 20], 3, 3_400), false)
})

test("the latest reserved selection records whether this TCP admission is rescue", () => {
    const registry = new RoomAdmissionRegistry(15_000)
    assert.equal(registry.reserve("100007", 1, 20, [10], 3, 8_000, "rescue"), true)
    assert.equal(registry.isRescue("100007", 1, 20, 8_100), true)
    assert.equal(registry.reserve("100007", 1, 20, [10], 3, 8_200, "direct"), true)
    assert.equal(registry.isRescue("100007", 1, 20, 8_300), false)
})

test("expired and previous-generation reservations are never claimed", () => {
    const registry = new RoomAdmissionRegistry(1_000)
    assert.equal(registry.reserve("100004", 2, 20, [10], 3, 4_000), true)
    assert.deepEqual(registry.claim("100004", 2, 20, "late", 5_001), {
        ok: false,
        reason: "expired",
    })

    assert.equal(registry.reserve("100005", 2, 20, [10], 3, 6_000), true)
    assert.deepEqual(registry.claim("100005", 3, 20, "stale", 6_100), {
        ok: false,
        reason: "generation_mismatch",
    })
})

test("admission diagnostics are aggregated instead of logged per success", () => {
    const summary = drainRoomAdmissionPerformanceSummary()
    assert.match(summary, /reserve=/)
    assert.match(summary, /claim=/)
    assert.match(summary, /select_to_tcp\{n=/)
    assert.equal(drainRoomAdmissionPerformanceSummary(), "none")
})
