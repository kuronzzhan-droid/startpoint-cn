require("ts-node/register/transpile-only")

const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mission-registry-live-"))
const previousDatabaseDirectory = process.env.WF_DATABASE_DIR
process.env.WF_DATABASE_DIR = temporaryRoot
let database

try {
    const { getComputer } = require("../src/lib/mission/registry")
    const { RegularComputer } = require("../src/lib/mission/computer-regular")
    const { EventSafeComputer } = require("../src/lib/mission/computer-event-safe")
    const { CollectComputer } = require("../src/lib/mission/collect-progress")
    const { DegreeComputer } = require("../src/lib/mission/computer-degree")
    const { AwakeComputer } = require("../src/lib/mission/computer-awake")
    const { FallbackComputer } = require("../src/lib/mission/computer-fallback")
    database = require("../src/data/db").getDb()

    assert.equal(getComputer(1), RegularComputer)
    assert.equal(getComputer(2), RegularComputer)
    assert.equal(getComputer(3), EventSafeComputer)
    assert.equal(getComputer(4), CollectComputer)
    assert.equal(getComputer(5), DegreeComputer)
    assert.equal(getComputer(9), AwakeComputer)
    assert.equal(getComputer(999), FallbackComputer)

    console.log("mission registry live tests passed")
} finally {
    if (database?.open) database.close()
    if (previousDatabaseDirectory === undefined) delete process.env.WF_DATABASE_DIR
    else process.env.WF_DATABASE_DIR = previousDatabaseDirectory
    fs.rmSync(temporaryRoot, { recursive: true, force: true })
}
