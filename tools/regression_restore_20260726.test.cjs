require("ts-node/register/transpile-only")

const assert = require("node:assert/strict")
const { randomUUID } = require("node:crypto")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const databaseDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "regression-restore-db-"))
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
    migrateUnsafeViewerIdsSync,
} = require("../src/data/domains/session")
const { generateViewerId } = require("../src/utils")

initializeDatabase()
db = getDb()

function createAccount(label) {
    return insertAccountSync({
        appId: "wf_cn",
        idpAlias: "",
        idpCode: "test",
        idpId: `regression-restore-${label}-${randomUUID()}`,
        status: "normal",
    })
}

for (let index = 0; index < 5000; index += 1) {
    const viewerId = generateViewerId()
    assert.ok(viewerId >= 100000000 && viewerId < 900000000)
}

const unsafeAccount = createAccount("unsafe")
const safeAccount = createAccount("safe")
db.prepare("INSERT INTO sessions (token, account_id, expires, type) VALUES (?, ?, ?, 2)")
    .run("950000001", unsafeAccount.id, "2099-12-31T23:59:59.000Z")
db.prepare("INSERT INTO sessions (token, account_id, expires, type) VALUES (?, ?, ?, 2)")
    .run("450000001", safeAccount.id, "2099-12-31T23:59:59.000Z")
db.prepare("INSERT INTO device_bindings (device_id, account_id, last_seen, name) VALUES (?, ?, ?, ?)")
    .run(123456789, unsafeAccount.id, "2026-07-26T00:00:00.000Z", "unsafe-test")

assert.equal(migrateUnsafeViewerIdsSync(), 1)
const migrated = db.prepare("SELECT token, account_id FROM sessions WHERE account_id = ? AND type = 2")
    .get(unsafeAccount.id)
assert.equal(migrated.account_id, unsafeAccount.id)
assert.ok(Number(migrated.token) >= 100000000 && Number(migrated.token) < 900000000)
assert.deepEqual(
    db.prepare("SELECT device_id, account_id, name FROM device_bindings WHERE device_id = ?")
        .get(123456789),
    { device_id: 123456789, account_id: unsafeAccount.id, name: "unsafe-test" },
)
assert.equal(
    db.prepare("SELECT token FROM sessions WHERE account_id = ? AND type = 2").get(safeAccount.id).token,
    "450000001",
)
assert.equal(migrateUnsafeViewerIdsSync(), 0, "migration must be idempotent")

const handshakeSource = fs.readFileSync(
    path.resolve(__dirname, "../src/multi/tcp/handshake.ts"),
    "utf8",
)
assert.equal(handshakeSource.includes('"ROOM_NOT_FOUND"'), false)
assert.equal(handshakeSource.includes('"ROOM_FULL"'), false)
assert.equal(handshakeSource.includes('[1, "room_not_found"]'), false)
assert.equal(handshakeSource.includes('"room_full"'), false)
assert.ok(handshakeSource.includes('[3, "HANDSHAKE_DENIED"]'))
assert.ok(
    handshakeSource.includes("room handshake unavailable:")
        && handshakeSource.match(/sessionManager\.sendJson\(socket, \[3, "HANDSHAKE_DENIED"\]\)/g)?.length >= 3,
    "handshake races must use protocol denial without missing CN UiString keys",
)
assert.ok(
    handshakeSource.includes("indexedClient.socket.destroyed")
        && handshakeSource.includes("sessionManager.removeClient(indexedClient)"),
    "closed indexed lobby sockets must be removed before the capacity check",
)

const lobbySource = fs.readFileSync(
    path.resolve(__dirname, "../src/multi/tcp/lobby.ts"),
    "utf8",
)
assert.ok(lobbySource.includes("presentNpcCount < desiredNpcCount"))
assert.ok(lobbySource.includes("scheduleNpcReconcile(roomNumber)"))
assert.ok(lobbySource.includes("checkHostAutoReady(client.roomNumber)"))
assert.ok(lobbySource.includes("missingExpectedViewerIds"))
assert.ok(lobbySource.includes("StartBattle deferred: room=${client.roomNumber}`"))
assert.equal(
    lobbySource.includes("if (realMates.length === 1) checkHostAutoReady(client.roomNumber)"),
    false,
)

const singleBattleSource = fs.readFileSync(
    path.resolve(__dirname, "../src/routes/api/singleBattleQuest.ts"),
    "utf8",
)
assert.ok(singleBattleSource.includes("questId >= 1006001"))

console.log("2026-07-26 regression restoration test passed")
