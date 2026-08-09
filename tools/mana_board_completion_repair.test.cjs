require("ts-node/register/transpile-only")

const assert = require("node:assert/strict")
const { randomUUID } = require("node:crypto")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const databaseDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "mana-board-repair-db-"))
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
const {
    getPlayerCharacterSync,
    insertPlayerCharacterManaNodesSync,
    insertPlayerCharacterSync,
} = require("../src/data/domains/character")
const { insertDefaultPlayerSync } = require("../src/data/domains/player")
const { getCharacterManaNodesSync } = require("../src/lib/assets")
const {
    reconcilePlayerManaBoardCompletionSync,
} = require("../src/lib/character-helpers")

initializeDatabase()
db = getDb()
const account = insertAccountSync({
    appId: "wf_cn",
    idpAlias: "",
    idpCode: "test",
    idpId: `mana-board-repair-${randomUUID()}`,
    status: "normal",
})
const playerId = insertDefaultPlayerSync(account.id).id
const characterId = 111165
const now = new Date("2024-01-01T00:00:00.000Z")
insertPlayerCharacterSync(playerId, characterId, {
    entryCount: 1,
    evolutionLevel: 0,
    overLimitStep: 0,
    protection: false,
    joinTime: now,
    updateTime: now,
    exp: 0,
    stack: 0,
    manaBoardIndex: 1,
    // Reproduce an old/imported save that lost all bond-token rows.
    bondTokenList: [],
})

const board1NodeIds = Object.keys(getCharacterManaNodesSync(characterId, 1)).map(Number)
insertPlayerCharacterManaNodesSync(playerId, characterId, board1NodeIds)

const firstRepair = reconcilePlayerManaBoardCompletionSync(playerId, [characterId])
assert.deepEqual(firstRepair.repairedCharacterIds, [characterId])
assert.deepEqual(firstRepair.evolutionCharacterIds, [characterId])
let repaired = getPlayerCharacterSync(playerId, characterId)
assert.equal(repaired.evolutionLevel, 1, "completed first board must restore the crown/evolution")
assert.equal(
    repaired.bondTokenList.find(token => token.manaBoardIndex === 1)?.status,
    1,
    "completed first board must restore the receivable bond token",
)

const secondRepair = reconcilePlayerManaBoardCompletionSync(playerId, [characterId])
assert.deepEqual(secondRepair.repairedCharacterIds, [])
assert.deepEqual(secondRepair.evolutionCharacterIds, [])
repaired = getPlayerCharacterSync(playerId, characterId)
assert.equal(repaired.bondTokenList[0].manaBoardIndex, 1)

console.log("mana board completion repair tests passed")
cleanup()
