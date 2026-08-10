require("ts-node/register/transpile-only")

const assert = require("node:assert/strict")
const { addMissionProgressDelta } = require("../src/lib/mission/progress")

assert.equal(addMissionProgressDelta(4, 3), 7)
assert.equal(addMissionProgressDelta(4, 0), null)
assert.equal(addMissionProgressDelta(4, -1), null)
assert.equal(addMissionProgressDelta(4, 1.5), null)
assert.equal(addMissionProgressDelta(4, NaN), null)
assert.equal(addMissionProgressDelta(4, Infinity), null)
assert.equal(addMissionProgressDelta(NaN, 1), 1)
assert.equal(addMissionProgressDelta(Infinity, 1), 1)
assert.equal(addMissionProgressDelta(-1, 1), 1)
assert.equal(addMissionProgressDelta(Number.MAX_SAFE_INTEGER - 1, 1), Number.MAX_SAFE_INTEGER)
assert.deepEqual(
    [
        addMissionProgressDelta(0, Number.MAX_SAFE_INTEGER + 1),
        addMissionProgressDelta(Number.MAX_SAFE_INTEGER, 1),
    ],
    [null, null],
)
assert.equal(addMissionProgressDelta(1.5, 1), 1)

console.log("mission progress math tests passed")
