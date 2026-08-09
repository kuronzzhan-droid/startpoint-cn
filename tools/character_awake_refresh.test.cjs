require("ts-node/register/transpile-only")

const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const databaseDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "awake-refresh-db-"))
const previousDataDirectory = process.env.DATA_DIR
process.env.DATA_DIR = databaseDirectory

const {
    computeManaBoardAwakeFromNodes,
    filterCharacterManaBoardAwakeLevels,
    mergeManaBoardAwakeMaps,
    validateCompatibleManaBoardAwakeRequest,
    validateManaBoardAwakeRequest,
} = require("../src/lib/character-helpers")
const { getCharacterManaNodesSync } = require("../src/lib/assets")

assert.deepEqual(
    [...mergeManaBoardAwakeMaps(
        new Map([["101", { 1: 1 }]]),
        new Map([["101", { 1: 2 }], ["102", { 1: 1 }]]),
    ).entries()],
    [["101", { 1: 2 }], ["102", { 1: 1 }]],
)

const boardNodes = [1001, 1002, 1003]
assert.equal(
    validateManaBoardAwakeRequest([1001], 1, 1, boardNodes, boardNodes),
    null,
)
assert.equal(
    validateManaBoardAwakeRequest([1001], 1, 0, boardNodes, boardNodes),
    "Awake missions are not complete.",
)

const assetCharacterId = 111165
const assetBoardNodes = Object.keys(getCharacterManaNodesSync(assetCharacterId, 1)).map(Number)
assert.deepEqual(
    filterCharacterManaBoardAwakeLevels(assetCharacterId, { 1: 1 }, assetBoardNodes.slice(1)),
    {},
    "awake layer must stay hidden until the base board is complete",
)
assert.deepEqual(
    filterCharacterManaBoardAwakeLevels(assetCharacterId, { 1: 1 }, assetBoardNodes),
    { 1: 1 },
)
const partialAwakeLevels = Object.fromEntries(assetBoardNodes.map((nodeId, index) => [
    nodeId,
    index === 0 ? 1 : 0,
]))
assert.equal(
    computeManaBoardAwakeFromNodes({ [assetCharacterId]: partialAwakeLevels })
        .has(String(assetCharacterId)),
    false,
    "a partially awakened board must not switch the whole board UI",
)
assert.deepEqual(
    computeManaBoardAwakeFromNodes({
        [assetCharacterId]: Object.fromEntries(assetBoardNodes.map(nodeId => [nodeId, 1])),
    }).get(String(assetCharacterId)),
    { 1: 1 },
)

// Private-server compatibility keeps level 1 available without a mission row
// and accepts an already-awakened legacy level supplied as the expected level.
assert.equal(validateCompatibleManaBoardAwakeRequest([1001], 1, 1, boardNodes), null)
assert.equal(validateCompatibleManaBoardAwakeRequest([1001], 2, 2, boardNodes), null)
assert.equal(
    validateCompatibleManaBoardAwakeRequest([1001], 2, 1, boardNodes),
    "Invalid awake level.",
)
assert.equal(
    validateCompatibleManaBoardAwakeRequest([1001, 1001], 1, 1, boardNodes),
    "Invalid mana node list.",
)
assert.equal(
    validateCompatibleManaBoardAwakeRequest([9999], 1, 1, boardNodes),
    "Mana node is outside the awake board.",
)

const routeSource = fs.readFileSync(
    path.resolve(__dirname, "../src/routes/api/character/mana.ts"),
    "utf8",
)
assert.match(routeSource, /persistedUnlockLevel/)
assert.match(routeSource, /existingNodeAwakeLevel/)
assert.match(routeSource, /Math\.max\(persistedUnlockLevel,\s*existingNodeAwakeLevel\)/)
assert.match(routeSource, /validateManaBoardAwakeRequest\(/)
assert.match(routeSource, /learnedNodeIds/)
assert.match(routeSource, /getDb\(\)\.transaction\(\(\)\s*=>/)

const loadSource = fs.readFileSync(
    path.resolve(__dirname, "../src/data/utils/player-data.ts"),
    "utf8",
)
assert.match(loadSource, /reconcileAwakeUnlocksFromProgress\(/)
assert.match(loadSource, /mergeManaBoardAwakeMaps\(/)

console.log("character awake refresh tests passed")

const db = require("../src/data/db").getDb()
if (db.open) db.close()
fs.rmSync(databaseDirectory, { recursive: true, force: true })
if (previousDataDirectory === undefined) delete process.env.DATA_DIR
else process.env.DATA_DIR = previousDataDirectory
