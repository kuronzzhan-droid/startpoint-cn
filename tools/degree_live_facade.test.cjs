require("ts-node/register/transpile-only")

const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wave2b-degree-live-"))
const previousDatabaseDirectory = process.env.WF_DATABASE_DIR
let database

try {
    process.env.WF_DATABASE_DIR = temporaryRoot

    const { DegreeComputer, getTargetDegree } = require("../src/lib/mission/computer-degree")
    const { DegreeComputerV2 } = require("../src/lib/mission/degree/computer")
    const { getDegreeMasterIndex } = require("../src/lib/mission/degree/master-index")
    const { getComputer } = require("../src/lib/mission/registry")
    database = require("../src/data/db").getDb()

    assert.equal(DegreeComputer, DegreeComputerV2,
        "the live facade must delegate to the reviewed V2 computer without a second implementation")
    assert.equal(getComputer(5), DegreeComputerV2,
        "the live registry must activate V2 for category 5")

    const masterIndex = getDegreeMasterIndex()
    for (const missionId of [1000, 1070, 2000]) {
        assert.equal(getTargetDegree(missionId), masterIndex.getTargetDegree(missionId),
            `target degree ${missionId} must use the frozen V2 master index`)
    }
    assert.throws(() => getTargetDegree(0), RangeError)

    console.log("degree live facade tests passed")
} finally {
    if (database?.open) database.close()
    if (previousDatabaseDirectory === undefined) delete process.env.WF_DATABASE_DIR
    else process.env.WF_DATABASE_DIR = previousDatabaseDirectory
    fs.rmSync(temporaryRoot, { recursive: true, force: true })
}
