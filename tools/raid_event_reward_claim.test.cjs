require("ts-node/register/transpile-only")

const assert = require("node:assert/strict")
const { randomUUID } = require("node:crypto")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const databaseDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "raid-event-reward-claim-db-"))
const previousDataDirectory = process.env.DATA_DIR
const previousDatabaseDirectory = process.env.WDFP_DATABASE_DIR
process.env.DATA_DIR = databaseDirectory
delete process.env.WDFP_DATABASE_DIR
let db

function cleanup() {
    if (db?.open) db.close()
    fs.rmSync(databaseDirectory, { recursive: true, force: true })
    if (previousDataDirectory === undefined) delete process.env.DATA_DIR
    else process.env.DATA_DIR = previousDataDirectory
    if (previousDatabaseDirectory === undefined) delete process.env.WDFP_DATABASE_DIR
    else process.env.WDFP_DATABASE_DIR = previousDatabaseDirectory
}

process.once("exit", cleanup)

const { initializeDatabase } = require("../src/data")
const { getDb } = require("../src/data/db")
const { insertAccountSync } = require("../src/data/domains/account")
const { getPlayerDegreeIdsSync } = require("../src/data/domains/degree")
const { insertDefaultPlayerSync } = require("../src/data/domains/player")
const { claimRaidEventOverallRewardsSync } = require("../src/lib/raidEventGlobal")

initializeDatabase()
db = getDb()

const account = insertAccountSync({
    appId: "wf_cn",
    idpAlias: "",
    idpCode: "test",
    idpId: `raid-event-reward-${randomUUID()}`,
    status: "normal",
})
const playerId = insertDefaultPlayerSync(account.id).id

const firstClaim = claimRaidEventOverallRewardsSync(playerId, 7, 300)
assert.equal(firstClaim.receivedUpTo, 300)
assert.equal(
    firstClaim.rewardList.some(reward => reward.kind === 7),
    false,
    "Degree rewards must not be returned to the raid popup because the client throws C3419",
)
assert.equal(
    getPlayerDegreeIdsSync(playerId).includes(80054),
    true,
    "Ceremony degree must still be granted server-side",
)

assert.deepEqual(
    claimRaidEventOverallRewardsSync(playerId, 7, 300),
    { receivedUpTo: 300, rewardList: [] },
    "The same overall rewards must not be granted twice",
)

console.log("raid event reward claim tests passed")
cleanup()
process.removeListener("exit", cleanup)
