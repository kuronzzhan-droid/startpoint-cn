const assert = require("node:assert/strict")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const useCompiledServer = process.env.ADMIN_CLEANUP_COMPILED === "1"
if (!useCompiledServer) require("ts-node/register/transpile-only")
const serverModuleRoot = useCompiledServer ? "../out" : "../src"

const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "sp-admin-cleanup-"))
process.env.DATA_DIR = dataDirectory

async function main() {
    const Fastify = require("fastify")
    const { getDb } = require(`${serverModuleRoot}/data/db`)
    const { insertAccountSync, getAccountSync } = require(`${serverModuleRoot}/data/domains/account`)
    const { insertDefaultPlayerSync } = require(`${serverModuleRoot}/data/domains/player`)
    const { insertDeviceBindingSync } = require(`${serverModuleRoot}/data/domains/session`)
    const { setActivePlayerId } = require(`${serverModuleRoot}/data/activeAccount`)
    const { stopQuestNpcPartyPoolWorker } = require(`${serverModuleRoot}/multi/npc/player-party-pool`)
    const serverRoutes = require(`${serverModuleRoot}/routes/web_api/server`).default

    const createAccount = (suffix, note) => {
        const account = insertAccountSync({
            appId: "wf_cn",
            idpAlias: "",
            idpCode: "leiting",
            idpId: `cleanup-${suffix}`,
            status: "normal",
        })
        const player = insertDefaultPlayerSync(account.id)
        insertDeviceBindingSync(900000 + account.id, account.id, note)
        return { account, player }
    }

    const noted = createAccount("noted", "保留")
    const unnotedAccounts = Array.from({ length: 139 }, (_, index) =>
        createAccount(`unnoted-${index}`, index % 2 === 0 ? "   " : null))
    const unnoted = unnotedAccounts[0]
    const activeUnnoted = createAccount("active", null)
    setActivePlayerId(activeUnnoted.player.id)

    const automaticBackupRoot = path.join(dataDirectory, "admin-backups")
    const oldAutomaticBackup = path.join(automaticBackupRoot, "unnoted-accounts-20200101-000000")
    const unrelatedBackup = path.join(automaticBackupRoot, "manual-backup")
    fs.mkdirSync(oldAutomaticBackup, { recursive: true })
    fs.mkdirSync(unrelatedBackup, { recursive: true })
    fs.writeFileSync(path.join(oldAutomaticBackup, "marker.txt"), "old")
    fs.writeFileSync(path.join(unrelatedBackup, "marker.txt"), "keep")

    const app = Fastify()
    await app.register(serverRoutes, { prefix: "/api/server" })
    await app.ready()

    const rejected = await app.inject({
        method: "POST",
        url: "/api/server/deleteUnnotedAccounts",
        payload: { confirm: "wrong" },
    })
    assert.equal(rejected.statusCode, 400)

    const startTime = Date.now()
    const response = await app.inject({
        method: "POST",
        url: "/api/server/deleteUnnotedAccounts",
        payload: { confirm: "DELETE_UNNOTED_ACCOUNTS" },
    })
    assert.equal(response.statusCode, 202)
    assert.ok(Date.now() - startTime < 1000, "starting cleanup should not wait for backup or deletion")
    assert.equal(response.json().status, "running")

    const duplicate = await app.inject({
        method: "POST",
        url: "/api/server/deleteUnnotedAccounts",
        payload: { confirm: "DELETE_UNNOTED_ACCOUNTS" },
    })
    assert.equal(duplicate.statusCode, 409)

    let result
    let maximumStatusLatency = 0
    let maximumWriteLatency = 0
    let writeAttempts = 0
    const deadline = Date.now() + 60000
    while (Date.now() < deadline) {
        const statusStart = Date.now()
        const statusResponse = await app.inject({
            method: "GET",
            url: "/api/server/deleteUnnotedAccounts/status",
        })
        maximumStatusLatency = Math.max(maximumStatusLatency, Date.now() - statusStart)
        assert.equal(statusResponse.statusCode, 200)
        result = statusResponse.json()
        if (result.status !== "running") break
        const writeStart = Date.now()
        const writeResponse = await app.inject({
            method: "POST",
            url: "/api/server/device/rename",
            payload: {
                device_id: 900000 + noted.account.id,
                name: `保留-${writeAttempts}`,
            },
        })
        maximumWriteLatency = Math.max(maximumWriteLatency, Date.now() - writeStart)
        assert.equal(writeResponse.statusCode, 200, writeResponse.body)
        writeAttempts += 1
        await new Promise(resolve => setTimeout(resolve, 20))
    }
    assert.ok(result, "cleanup status should be available")
    assert.equal(result.status, "completed", result.error)
    assert.ok(maximumStatusLatency < 1000, `main thread status latency was ${maximumStatusLatency}ms`)
    assert.ok(writeAttempts > 0, "test should write through the main connection during cleanup")
    assert.ok(maximumWriteLatency < 1000, `main thread write latency was ${maximumWriteLatency}ms`)
    assert.equal(result.deletedAccounts, 139)
    assert.equal(result.deletedSaves, 139)
    assert.equal(result.skippedActiveAccount, activeUnnoted.account.id)
    assert.equal(result.removedBackups, 1)
    assert.equal(result.backupCleanupError, null)
    assert.equal(getAccountSync(unnoted.account.id), null)
    assert.notEqual(getAccountSync(noted.account.id), null)
    assert.notEqual(getAccountSync(activeUnnoted.account.id), null)

    const backupDirectory = path.join(
        dataDirectory,
        result.backup.replace(/^\.database[\\/]admin-backups[\\/]/, "admin-backups/"),
    )
    assert.equal(fs.existsSync(path.join(backupDirectory, "wdfp_data.db")), true)
    assert.equal(fs.existsSync(path.join(backupDirectory, "active_account.json")), true)
    assert.equal(fs.existsSync(path.join(backupDirectory, "cleanup-result.json")), true)
    assert.equal(fs.existsSync(oldAutomaticBackup), false)
    assert.equal(fs.existsSync(path.join(unrelatedBackup, "marker.txt")), true)
    const BackupDatabase = require("better-sqlite3")
    const backupDb = new BackupDatabase(path.join(backupDirectory, "wdfp_data.db"), { readonly: true })
    assert.equal(backupDb.pragma("integrity_check", { simple: true }), "ok")
    backupDb.close()
    const cleanupIndexes = getDb().prepare(`
        SELECT COUNT(*) AS count
        FROM sqlite_master
        WHERE type = 'index' AND name LIKE 'idx_cleanup_fk_%'
    `).get()
    assert.ok(cleanupIndexes.count > 0, "cascade-delete indexes should be installed")

    console.log(JSON.stringify({
        cleanupMilliseconds: Date.now() - startTime,
        maximumStatusLatency,
        maximumWriteLatency,
        writeAttempts,
    }))

    await app.close()
    await stopQuestNpcPartyPoolWorker()
    getDb().close()
}

main().then(
    () => console.log("admin account cleanup smoke test passed"),
    error => {
        console.error(error)
        process.exitCode = 1
    },
).finally(() => {
    if (path.dirname(dataDirectory) === os.tmpdir() && path.basename(dataDirectory).startsWith("sp-admin-cleanup-")) {
        fs.rmSync(dataDirectory, { recursive: true, force: true })
    }
})
