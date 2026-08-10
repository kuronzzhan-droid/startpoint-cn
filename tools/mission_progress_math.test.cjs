require("ts-node/register/transpile-only")

const assert = require("node:assert/strict")
const { addMissionProgressDelta } = require("../src/lib/mission/progress")

assert.equal(addMissionProgressDelta(4, 3), 7)
assert.equal(addMissionProgressDelta(4, 0), null)
assert.equal(addMissionProgressDelta(4, -1), null)
assert.equal(addMissionProgressDelta(4, 1.5), null)

console.log("mission progress math tests passed")
