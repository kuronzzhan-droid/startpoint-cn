import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { Worker } from "worker_threads";
import { getServerTime, getServerDate, setServerTime, getTimeOffset } from "../../utils";
import { deleteAccountSync, getAccountPlayersSync, getAllAccountsSync } from "../../data/domains/account"
import { deletePlayerSync, getPlayerSync, insertDefaultPlayerSync, replacePlayerDataSync, updatePlayerSync } from "../../data/domains/player"
import { getAllDeviceBindingsSync, getSessionByAccountIdSync, updateDeviceBindingNameSync } from "../../data/domains/session"
import { getPlayerCharactersSync } from "../../data/domains/character"
import { getClientSerializedData, deserializePlayerData, reviveMergedPlayerDates } from "../../data/utils";
import { getActivePlayerId, setActivePlayerId, getSelectedAccountId, setSelectedAccountId, saveTimeOffset, saveAccountDefaultPlayer, getAccountDefaultPlayer, removeDeletedAccountFromState, removeDeletedAccountsFromState } from "../../data/activeAccount";
import { saveDefaultSaveTemplate, loadDefaultSaveTemplate, clearDefaultSaveTemplate, getDefaultSaveMeta } from "../../data/defaultSave";
import { detectCDNVersion, FULL_BASE, getEffectiveVersion, getPatchManifest } from "../../lib/version";
import { buildShortUpCharacterGachaTimeline } from "../../lib/admin-clairvoyance";
import { wantsJson } from "./http";
import { SessionType } from "../../data/types";
import { getDb } from "../../data/db";
import { ensureCascadeDeleteIndexes, selectUnnotedAccountIds } from "../../lib/admin-account-cleanup";
import { removePlayerQuestNpcPartySnapshots } from "../../multi/npc/player-party-pool";
import { runImmediateTransactionWithRetry } from "../../lib/sqlite-write-coordinator";

interface TimeQuery {
    time: string | undefined
}

const MANUAL_DATABASE_BACKUP_KEEP_COUNT = 5
const ACCOUNT_CLEANUP_BATCH_SIZE = 5
const ACCOUNT_CLEANUP_BATCH_PAUSE_MS = 100

type AccountCleanupStatus = "running" | "completed" | "failed"
type AccountCleanupPhase = "preparing" | "planning" | "backing_up" | "indexing" | "deleting" | "finalizing"

interface PlannedCleanupEntry {
    accountId: number
    playerIds: number[]
}

interface AccountCleanupJob {
    ok: boolean
    jobId: string
    status: AccountCleanupStatus
    phase: AccountCleanupPhase
    startedAt: string
    finishedAt: string | null
    totalAccounts: number
    processedAccounts: number
    deletedAccounts: number
    deletedSaves: number
    skippedActiveAccount: number | null
    backup: string | null
    removedBackups: number
    backupCleanupError: string | null
    createdIndexes: number
    batchSize: number
    pauseMs: number
    workerThreadId: number | null
    error: string | null
}

let accountCleanupJob: AccountCleanupJob | null = null
let accountCleanupWorker: Worker | null = null

function delay(milliseconds: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, milliseconds))
}

function deleteAccountDataSync(accountId: number): number[] {
    const playerIds = getAccountPlayersSync(accountId)
    for (const playerId of playerIds) deletePlayerSync(playerId)
    getDb().prepare(`DELETE FROM device_bindings WHERE account_id = ?`).run(accountId)
    deleteAccountSync(accountId)
    return playerIds
}

async function cleanupDeletedPlayerAiSnapshots(playerIds: number[], context: string): Promise<void> {
    if (playerIds.length === 0) return
    try {
        const result = await removePlayerQuestNpcPartySnapshots(playerIds)
        if (result.removedRows > 0) {
            console.log(
                `[ADMIN] removed ${result.removedRows} historical AI parties from ${result.affectedQuestCount} quest pools after ${context}`,
            )
        }
    } catch (error) {
        console.warn(
            `[ADMIN] player data was deleted, but historical AI party cleanup failed after ${context}:`,
            error,
        )
    }
}

function getDatabaseDirectory(): string {
    return process.env.DATA_DIR
        ? path.resolve(process.env.DATA_DIR)
        : path.resolve(__dirname, "../../../.database")
}

function createBackupStamp(): string {
    const now = new Date()
    const pad = (value: number, width = 2) => String(value).padStart(width, "0")
    return [
        `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`,
        `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`,
        pad(now.getMilliseconds(), 3),
    ].join("-")
}

async function createFullDatabaseBackup(prefix: string): Promise<{ directory: string; name: string }> {
    const databaseDir = getDatabaseDirectory()
    const name = `${prefix}-${createBackupStamp()}`
    const directory = path.join(databaseDir, "admin-backups", name)
    mkdirSync(directory, { recursive: true })
    const versionPath = path.join(databaseDir, "wdfp_data.db.version")
    if (!existsSync(versionPath)) {
        throw new Error("Database version file is missing: wdfp_data.db.version")
    }
    await getDb().backup(path.join(directory, "wdfp_data.db"))
    copyFileSync(versionPath, path.join(directory, "wdfp_data.db.version"))
    const statePath = path.join(databaseDir, "active_account.json")
    if (existsSync(statePath)) copyFileSync(statePath, path.join(directory, "active_account.json"))
    writeFileSync(
        path.join(directory, "backup-info.json"),
        JSON.stringify({
            createdAt: new Date().toISOString(),
            type: prefix,
            database: "wdfp_data.db",
            databaseVersion: "wdfp_data.db.version",
            includesActiveAccountState: existsSync(statePath),
        }, null, 2),
        "utf8",
    )
    return { directory, name }
}

function removeExpiredManualDatabaseBackups(backupRoot: string): string[] {
    if (!existsSync(backupRoot)) return []
    const resolvedRoot = path.resolve(backupRoot)
    const backups = readdirSync(resolvedRoot)
        .filter(name => /^manual-full-\d{8}-\d{6}-\d{3}$/.test(name))
        .sort((left, right) => right.localeCompare(left))
    const removed: string[] = []
    for (const name of backups.slice(MANUAL_DATABASE_BACKUP_KEEP_COUNT)) {
        const candidate = path.resolve(resolvedRoot, name)
        if (path.dirname(candidate) !== resolvedRoot) continue
        const stats = lstatSync(candidate)
        if (!stats.isDirectory() || stats.isSymbolicLink()) continue
        rmSync(candidate, { recursive: true, force: true })
        removed.push(name)
    }
    return removed
}

function removeOlderCleanupBackups(currentBackupDirectory: string): string[] {
    const backupRoot = path.resolve(path.dirname(currentBackupDirectory))
    const currentDirectory = path.resolve(currentBackupDirectory)
    const removed: string[] = []
    if (!existsSync(backupRoot)) return removed
    for (const name of readdirSync(backupRoot)) {
        if (!/^unnoted-accounts-\d{8}-\d{6}(?:-\d{3})?$/.test(name)) continue
        const candidate = path.resolve(backupRoot, name)
        if (candidate === currentDirectory || path.dirname(candidate) !== backupRoot) continue
        const stats = lstatSync(candidate)
        if (!stats.isDirectory() || stats.isSymbolicLink()) continue
        rmSync(candidate, { recursive: true, force: true })
        removed.push(name)
    }
    return removed
}

async function executeAccountCleanupPlan(
    jobId: string,
    plannedEntries: PlannedCleanupEntry[],
): Promise<void> {
    const job = accountCleanupJob
    if (!job || job.jobId !== jobId || job.status !== "running") return

    try {
        job.phase = "backing_up"
        const backup = await createFullDatabaseBackup("unnoted-accounts")
        job.backup = `.database/admin-backups/${backup.name}`

        job.phase = "indexing"
        job.createdIndexes = await runImmediateTransactionWithRetry(
            () => ensureCascadeDeleteIndexes(getDb()),
        )

        job.phase = "deleting"
        let processedAccounts = 0
        let deletedAccounts = 0
        let deletedSaves = 0
        const deletedAccountIds: number[] = []
        const deletedPlayerIds: number[] = []
        const plannedAccountIds = plannedEntries.map(entry => entry.accountId)

        for (let offset = 0; offset < plannedAccountIds.length; offset += ACCOUNT_CLEANUP_BATCH_SIZE) {
            const requestedIds = plannedAccountIds.slice(offset, offset + ACCOUNT_CLEANUP_BATCH_SIZE)
            if (requestedIds.length === 0) continue
            const placeholders = requestedIds.map(() => "?").join(", ")
            const batch = await runImmediateTransactionWithRetry(() => {
                const existingAccounts = getDb().prepare(
                    `SELECT id FROM accounts WHERE id IN (${placeholders})`,
                ).all(...requestedIds) as { id: number }[]
                const players = getDb().prepare(
                    `SELECT id, account_id FROM players WHERE account_id IN (${placeholders})`,
                ).all(...requestedIds) as { id: number; account_id: number }[]
                getDb().prepare(`DELETE FROM accounts WHERE id IN (${placeholders})`).run(...requestedIds)
                return existingAccounts.map(account => ({
                    accountId: account.id,
                    playerIds: players
                        .filter(player => player.account_id === account.id)
                        .map(player => player.id),
                }))
            })

            const batchPlayerIds = batch.flatMap(entry => entry.playerIds)
            processedAccounts += requestedIds.length
            deletedAccounts += batch.length
            deletedSaves += batchPlayerIds.length
            deletedAccountIds.push(...batch.map(entry => entry.accountId))
            deletedPlayerIds.push(...batchPlayerIds)
            removeDeletedAccountsFromState(batch)
            job.processedAccounts = processedAccounts
            job.deletedAccounts = deletedAccounts
            job.deletedSaves = deletedSaves
            if (processedAccounts < plannedAccountIds.length) {
                await delay(ACCOUNT_CLEANUP_BATCH_PAUSE_MS)
            }
        }

        job.phase = "finalizing"
        await cleanupDeletedPlayerAiSnapshots(deletedPlayerIds, `unnoted-account cleanup ${jobId}`)
        writeFileSync(
            path.join(backup.directory, "cleanup-result.json"),
            JSON.stringify({
                createdAt: new Date().toISOString(),
                jobId,
                deletedAccountIds,
                deletedPlayerIds,
                deletedSaves,
                skippedActiveAccount: job.skippedActiveAccount,
                createdIndexes: job.createdIndexes,
            }, null, 2),
            "utf8",
        )

        try {
            job.removedBackups = removeOlderCleanupBackups(backup.directory).length
        } catch (error) {
            job.backupCleanupError = error instanceof Error ? error.message : String(error)
        }
        job.status = "completed"
        job.finishedAt = new Date().toISOString()
    } catch (error) {
        job.status = "failed"
        job.finishedAt = new Date().toISOString()
        job.error = error instanceof Error ? error.message : String(error)
    }
}

function countZipFiles(dir: string): { exists: boolean; count: number; latestMtime: string | null; totalBytes: number } {
    if (!existsSync(dir)) return { exists: false, count: 0, latestMtime: null, totalBytes: 0 }
    let count = 0
    let totalBytes = 0
    let latest = 0
    const stack = [dir]
    while (stack.length) {
        const current = stack.pop()!
        for (const name of readdirSync(current)) {
            const fp = path.join(current, name)
            const st = statSync(fp)
            if (st.isDirectory()) {
                stack.push(fp)
                continue
            }
            if (!name.endsWith(".zip")) continue
            count += 1
            totalBytes += st.size
            latest = Math.max(latest, st.mtimeMs)
        }
    }
    return {
        exists: true,
        count,
        latestMtime: latest ? new Date(latest).toISOString() : null,
        totalBytes,
    }
}

function getCdnBaseUrl(): string {
    const cdnHost = process.env.CN_LISTEN_HOST || "localhost"
    const cdnPort = process.env.CN_LISTEN_PORT || "8001"
    const cdnDisplayHost = cdnHost === "0.0.0.0" ? "localhost" : cdnHost
    return process.env.CDN_BASE_URL || `http://${cdnDisplayHost}:${cdnPort}/patch/cn`
}

function getCleanupWorkerLocation(): { filename: string; execArgv?: string[] } {
    const compiledWorker = path.resolve(__dirname, "../../workers/admin-account-cleanup-worker.js")
    if (existsSync(compiledWorker)) return { filename: compiledWorker }
    const sourceWorker = path.resolve(__dirname, "../../workers/admin-account-cleanup-worker.ts")
    return {
        filename: sourceWorker,
        execArgv: ["-r", require.resolve("ts-node/register/transpile-only")],
    }
}

function startAccountCleanupWorker(
    accountIds: number[],
    skippedActiveAccount: number | null,
): AccountCleanupJob {
    const jobId = randomUUID()
    const databaseDirectory = getDatabaseDirectory()
    const workerLocation = getCleanupWorkerLocation()
    const job: AccountCleanupJob = {
        ok: true,
        jobId,
        status: "running",
        phase: "preparing",
        startedAt: new Date().toISOString(),
        finishedAt: null,
        totalAccounts: accountIds.length,
        processedAccounts: 0,
        deletedAccounts: 0,
        deletedSaves: 0,
        skippedActiveAccount,
        backup: null,
        removedBackups: 0,
        backupCleanupError: null,
        createdIndexes: 0,
        batchSize: ACCOUNT_CLEANUP_BATCH_SIZE,
        pauseMs: ACCOUNT_CLEANUP_BATCH_PAUSE_MS,
        workerThreadId: null,
        error: null,
    }
    accountCleanupJob = job

    const worker = new Worker(workerLocation.filename, {
        execArgv: workerLocation.execArgv,
        workerData: {
            jobId,
            databasePath: path.join(databaseDirectory, "wdfp_data.db"),
            accountIds,
            batchSize: ACCOUNT_CLEANUP_BATCH_SIZE,
        },
    })
    accountCleanupWorker = worker
    job.workerThreadId = worker.threadId
    let planReceived = false

    worker.on("message", (message: any) => {
        if (!accountCleanupJob || accountCleanupJob.jobId !== jobId || message?.jobId !== jobId) return
        if (message.type === "phase") {
            accountCleanupJob.phase = message.phase
            return
        }
        if (message.type === "plan") {
            planReceived = true
            accountCleanupJob.workerThreadId = null
            const plannedEntries = Array.isArray(message.plannedEntries)
                ? message.plannedEntries as PlannedCleanupEntry[]
                : []
            void executeAccountCleanupPlan(jobId, plannedEntries)
            return
        }
        if (message.type === "failed") {
            accountCleanupJob.status = "failed"
            accountCleanupJob.finishedAt = new Date().toISOString()
            accountCleanupJob.error = message.error
            accountCleanupJob.workerThreadId = null
        }
    })
    worker.on("error", error => {
        if (!accountCleanupJob || accountCleanupJob.jobId !== jobId || accountCleanupJob.status !== "running") return
        accountCleanupJob.status = "failed"
        accountCleanupJob.finishedAt = new Date().toISOString()
        accountCleanupJob.error = error.message
        accountCleanupJob.workerThreadId = null
    })
    worker.on("exit", code => {
        if (accountCleanupWorker === worker) accountCleanupWorker = null
        if (planReceived && code === 0) return
        if (!accountCleanupJob || accountCleanupJob.jobId !== jobId || accountCleanupJob.status !== "running") return
        accountCleanupJob.status = "failed"
        accountCleanupJob.finishedAt = new Date().toISOString()
        accountCleanupJob.error = `Cleanup worker exited before completion (code ${code})`
        accountCleanupJob.workerThreadId = null
    })
    return job
}

const routes = async (fastify: FastifyInstance) => {

    fastify.addHook("onClose", async () => {
        if (accountCleanupWorker) {
            await accountCleanupWorker.terminate()
            accountCleanupWorker = null
        }
    })

    fastify.post("/databaseBackup", async (_request: FastifyRequest, reply: FastifyReply) => {
        const backup = await createFullDatabaseBackup("manual-full")
        let removedBackups: string[] = []
        let backupCleanupError: string | null = null
        try {
            removedBackups = removeExpiredManualDatabaseBackups(path.dirname(backup.directory))
        } catch (error) {
            backupCleanupError = error instanceof Error ? error.message : String(error)
        }
        return reply.send({
            ok: true,
            backup: `.database/admin-backups/${backup.name}`,
            retainedBackups: MANUAL_DATABASE_BACKUP_KEEP_COUNT,
            removedBackups: removedBackups.length,
            backupCleanupError,
        })
    })

    fastify.get("/status", async (_request: FastifyRequest, reply: FastifyReply) => {
        const root = process.cwd()
        const cdnDir = process.env.CDN_DIR || ".cdn"
        const cdnRoot = path.isAbsolute(cdnDir) ? path.join(cdnDir, "cn") : path.join(root, cdnDir, "cn")
        const archiveSummary = countZipFiles(cdnRoot)
        const activePatchSummary = countZipFiles(path.join(root, "assets", "asset-patch", "active"))
        const patchManifest = getPatchManifest()
        const enabledPatches = patchManifest.patches.filter(p => p.enabled)
        const detectedVersion = detectCDNVersion()
        const effectiveVersion = getEffectiveVersion()

        reply.status(200).send({
            server: {
                uptimeSeconds: Math.floor(process.uptime()),
                nodeVersion: process.version,
                platform: `${process.platform}/${process.arch}`,
                pid: process.pid,
                memory: process.memoryUsage(),
                listenHost: process.env.CN_LISTEN_HOST || "localhost",
                listenPort: process.env.CN_LISTEN_PORT || "8001",
            },
            cdn: {
                baseUrl: getCdnBaseUrl(),
                baseline: {
                    mode: "fixed-cn-final",
                    source: "国服最终 CDN",
                    fullVersion: FULL_BASE,
                    cnFinalVersion: patchManifest.cdn_version,
                    detectedArchiveVersion: detectedVersion,
                    manifestVersion: patchManifest.cdn_version,
                    pinned: true,
                    dataScope: ["items", "characters", "events", "quests", "shops"],
                },
                extension: {
                    mode: "reserved-patch-version-layer",
                    status: enabledPatches.length > 0 ? "manifest-enabled" : "reserved",
                    runtimeEnabled: enabledPatches.length > 0,
                    effectiveVersionPreview: effectiveVersion,
                    enabledPatchCount: enabledPatches.length,
                    totalPatchCount: patchManifest.patches.length,
                    activePatchArchiveCount: activePatchSummary.count,
                    note: "Reserved for future custom characters and event patch imports.",
                },
                storage: {
                    configuredDir: cdnDir,
                    directoryPresent: archiveSummary.exists,
                    archiveCount: archiveSummary.count,
                    archiveBytes: archiveSummary.totalBytes,
                    latestArchiveMtime: archiveSummary.latestMtime,
                },
                // Backward-compatible flat fields for temporary admin scripts and older SPA builds.
                configuredDir: cdnDir,
                directoryPresent: archiveSummary.exists,
                archiveCount: archiveSummary.count,
                archiveBytes: archiveSummary.totalBytes,
                latestArchiveMtime: archiveSummary.latestMtime,
                fullVersion: FULL_BASE,
                detectedVersion,
                effectiveVersion,
                manifestVersion: patchManifest.cdn_version,
                enabledPatchCount: enabledPatches.length,
                totalPatchCount: patchManifest.patches.length,
                activePatchArchiveCount: activePatchSummary.count,
            },
        })
    })

    fastify.get("/currentTime", async (_request: FastifyRequest, reply: FastifyReply) => {
        const date = getServerDate()
        reply.status(200).send({
            servertime: getServerTime(),
            date: date.toISOString(),
            isCustom: date.getTime() !== Date.now()
        })
    })

    fastify.get("/resetTime", async (_request: FastifyRequest, reply: FastifyReply) => {
        setServerTime(null)
        saveTimeOffset(null)
        reply.status(200).send({
            servertime: getServerTime(),
            date: getServerDate().toISOString(),
            isCustom: false
        })
    })

    fastify.get("/time", async (request: FastifyRequest, reply: FastifyReply) => {
        const newTime = (request.query as TimeQuery).time
        if (!newTime) return reply.status(400).send({
            "error": "Bad Request",
            "message": "Missing 'time' parameter. Use format: 2025-06-01T12:00:00"
        })

        try {
            let dateStr = newTime
            if (!dateStr.includes('T')) {
                dateStr = dateStr + 'T00:00:00'
            }
            if (!dateStr.includes('Z') && !dateStr.includes('+') && !dateStr.includes('-', 10)) {
                dateStr = dateStr + 'Z'
            }
            const time = new Date(dateStr)
            if (isNaN(time.getTime())) {
                return reply.status(400).send({
                    "error": "Bad Request",
                    "message": `Invalid time format: "${newTime}". Use ISO format.`
                })
            }
            setServerTime(time)
            saveTimeOffset(getTimeOffset())
            reply.status(200).send({
                servertime: getServerTime(),
                date: getServerDate().toISOString(),
                isCustom: true
            })
        } catch (error: any) {
            return reply.status(500).send({
                "error": "Internal Server Error",
                "message": error?.message ?? "Unknown error"
            })
        }
    })

    fastify.get("/clairvoyance/gacha", async (_request: FastifyRequest, reply: FastifyReply) => {
        const patchManifest = getPatchManifest()
        return reply.status(200).send({
            cdnVersion: patchManifest.cdn_version,
            baseline: "fixed-cn-final",
            ...buildShortUpCharacterGachaTimeline(getServerDate()),
        })
    })

    // === Account list (JSON, for admin SPA) ===

    fastify.get("/accounts", async (_request: FastifyRequest, reply: FastifyReply) => {
        const accounts = getAllAccountsSync()
        const deviceBindings = getAllDeviceBindingsSync()
        const activePlayerId = getActivePlayerId()
        const result = accounts.map(acc => {
            const playerIds = getAccountPlayersSync(acc.id)
            const viewerSession = getSessionByAccountIdSync(acc.id, SessionType.VIEWER)
            const savedDefaultPid = getAccountDefaultPlayer(acc.id)
            const defaultPid = savedDefaultPid && playerIds.includes(savedDefaultPid)
                ? savedDefaultPid
                : (playerIds[0] ?? null)
            const defaultPlayer = defaultPid ? getPlayerSync(defaultPid) : null
            return {
                id: acc.id,
                viewerId: viewerSession ? String(viewerSession.token) : null,
                bindings: deviceBindings
                    .filter(binding => binding.account_id === acc.id)
                    .map(binding => ({
                        deviceId: binding.device_id,
                        note: binding.name,
                    })),
                saveCount: playerIds.length,
                defaultPlayerId: defaultPid,
                defaultPlayerName: defaultPlayer?.name ?? null,
                activePlayerId,
                players: playerIds.map(pid => {
                    const player = getPlayerSync(pid)
                    return {
                        id: pid,
                        accountId: acc.id,
                        name: player?.name ?? `存档 #${pid}`,
                        comment: player?.comment ?? "",
                        degreeId: player?.degreeId ?? 0,
                        isDefault: defaultPid === pid,
                        isActive: activePlayerId === pid,
                    }
                }),
                playerIds
            }
        })
        return reply.send(result)
    })

    // === Default save template (admin-uploaded, applied when a new save is created) ===

    // 查询当前默认存档模板信息
    fastify.get("/defaultSave", async (_request: FastifyRequest, reply: FastifyReply) => {
        return reply.send(getDefaultSaveMeta())
    })

    // 上传默认存档模板（multipart，快照格式同 GET /api/player/save 导出）
    fastify.post("/defaultSave", async (request: FastifyRequest, reply: FastifyReply) => {
        try {
            const file = await (request as any).file()
            if (!file) return reply.status(400).send({ error: "未选择文件" })
            const text = (await file.toBuffer()).toString("utf-8")
            let parsed: any
            try { parsed = JSON.parse(text) } catch { return reply.status(400).send({ error: "文件不是有效的 JSON" }) }
            if (!parsed || typeof parsed !== "object" || parsed.schema !== "starpoint-cn-save")
                return reply.status(400).send({ error: "不是有效的存档快照（请使用本面板导出的存档）" })
            if (parsed.version !== 1)
                return reply.status(400).send({ error: `不支持的存档版本：${parsed.version}` })
            if (!parsed.data || typeof parsed.data !== "object" || !parsed.data.player)
                return reply.status(400).send({ error: "存档数据缺失 player 字段" })
            saveDefaultSaveTemplate(parsed)
            return reply.send({ ok: true, ...getDefaultSaveMeta() })
        } catch (e: any) {
            return reply.status(500).send({ error: e?.message ?? "上传失败" })
        }
    })

    // 清除默认存档模板
    fastify.delete("/defaultSave", async (_request: FastifyRequest, reply: FastifyReply) => {
        const removed = clearDefaultSaveTemplate()
        return reply.send({ ok: true, removed })
    })

    // === Account & Save management (device-binding based) ===

    // Select account to view saves
    fastify.post("/selectAccount", async (request: FastifyRequest, reply: FastifyReply) => {
        const { accountId } = (request.query || {}) as any
        const aid = parseInt(accountId)
        if (isNaN(aid)) {
            if (wantsJson(request)) return reply.status(400).send({ error: "Invalid accountId" })
            return reply.redirect('/player')
        }
        setSelectedAccountId(aid)
        if (wantsJson(request)) return reply.send({ ok: true, accountId: aid })
        return reply.redirect('/player')
    })

    // Switch active save
    fastify.post("/activateSave", async (request: FastifyRequest, reply: FastifyReply) => {
        const { playerId } = (request.query || {}) as any
        const pid = parseInt(playerId)
        if (isNaN(pid)) {
            if (wantsJson(request)) return reply.status(400).send({ error: "Invalid playerId" })
            return reply.redirect('/player')
        }
        setActivePlayerId(pid)
        const allAccounts = getAllAccountsSync()
        for (const a of allAccounts) {
            if (getAccountPlayersSync(a.id).includes(pid)) {
                saveAccountDefaultPlayer(a.id, pid)
                break
            }
        }
        if (wantsJson(request)) return reply.send({ ok: true, playerId: pid })
        return reply.redirect('/player')
    })

    // Create new empty save under the given account
    fastify.post("/newSave", async (request: FastifyRequest, reply: FastifyReply) => {
        const { accountId: aid } = (request.query || {}) as any
        const accId = parseInt(aid)
        if (isNaN(accId)) {
            if (wantsJson(request)) return reply.status(400).send({ error: "Invalid accountId" })
            return reply.redirect('/player')
        }
        const player = insertDefaultPlayerSync(accId)
        // 若管理员配置了默认存档模板，用它替换新建的空存档
        let appliedTemplate = false
        try {
            const template = loadDefaultSaveTemplate()
            if (template?.data?.player) {
                const data = reviveMergedPlayerDates(template.data)
                data.player.id = player.id
                replacePlayerDataSync(data)
                appliedTemplate = true
            }
        } catch (_) { /* 模板损坏则退回空存档 */ }
        setActivePlayerId(player.id)
        saveAccountDefaultPlayer(accId, player.id)
        if (wantsJson(request)) return reply.send({ ok: true, playerId: player.id, appliedTemplate })
        return reply.redirect('/player')
    })

    // Delete a save
    fastify.post("/deleteSave", async (request: FastifyRequest, reply: FastifyReply) => {
        const { playerId } = (request.query || {}) as any
        const pid = parseInt(playerId)
        if (isNaN(pid)) {
            if (wantsJson(request)) return reply.status(400).send({ error: "Invalid playerId" })
            return reply.redirect('/player')
        }
        const allAccounts = getAllAccountsSync()
        let accountId = 0
        for (const a of allAccounts) {
            if (getAccountPlayersSync(a.id).includes(pid)) { accountId = a.id; break }
        }
        if (accountId && getAccountPlayersSync(accountId).length <= 1) {
            const deletedPlayerIds = deleteAccountDataSync(accountId)
            removeDeletedAccountFromState(accountId, deletedPlayerIds)
            await cleanupDeletedPlayerAiSnapshots(deletedPlayerIds, `save ${pid} and account ${accountId} deletion`)
        } else {
            deletePlayerSync(pid)
            await cleanupDeletedPlayerAiSnapshots([pid], `save ${pid} deletion`)
            const remainingPlayerIds = getAccountPlayersSync(accountId)
            if (getAccountDefaultPlayer(accountId) === pid && remainingPlayerIds.length > 0) {
                saveAccountDefaultPlayer(accountId, remainingPlayerIds[0])
            }
        }
        const accountAlsoDeleted = accountId && getAccountPlayersSync(accountId).length === 0
        if (getActivePlayerId() === pid) setActivePlayerId(null)
        if (wantsJson(request)) return reply.send({ ok: true, deleted: pid, accountAlsoDeleted: !!accountAlsoDeleted })
        return reply.redirect('/player')
    })

    // Delete entire account + all saves + device binding
    fastify.post("/deleteAccount", async (request: FastifyRequest, reply: FastifyReply) => {
        const { id } = (request.query || {}) as any
        const accountId = parseInt(id)
        if (isNaN(accountId)) return reply.status(400).send({ error: "Missing or invalid 'id'" })
        const playerIds = deleteAccountDataSync(accountId)
        removeDeletedAccountFromState(accountId, playerIds)
        await cleanupDeletedPlayerAiSnapshots(playerIds, `account ${accountId} deletion`)
        if (wantsJson(request)) return reply.send({ ok: true, accountId, deletedSaves: playerIds.length })
        return reply.redirect('/player')
    })

    fastify.get("/deleteUnnotedAccounts/status", async (_request: FastifyRequest, reply: FastifyReply) => {
        return reply.send(accountCleanupJob ?? {
            ok: true,
            status: "idle",
        })
    })

    // Start a background cleanup for all accounts whose device-binding notes
    // are blank. The current active account is always preserved.
    fastify.post("/deleteUnnotedAccounts", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = (request.body || {}) as { confirm?: unknown }
        if (body.confirm !== "DELETE_UNNOTED_ACCOUNTS") {
            return reply.status(400).send({ error: "Confirmation token is required" })
        }
        if (accountCleanupJob?.status === "running") {
            return reply.status(409).send({
                error: "An account cleanup job is already running",
                job: accountCleanupJob,
            })
        }

        const accounts = getAllAccountsSync()
        const bindings = getAllDeviceBindingsSync()
        const activePlayerId = getActivePlayerId()
        const accountPlayers = new Map(accounts.map(account => [account.id, getAccountPlayersSync(account.id)]))
        const activeAccountId = activePlayerId === null
            ? null
            : accounts.find(account => accountPlayers.get(account.id)?.includes(activePlayerId))?.id ?? null
        const accountIds = selectUnnotedAccountIds(accounts.map(account => account.id), bindings, activeAccountId)

        if (accountIds.length === 0) {
            const now = new Date().toISOString()
            accountCleanupJob = {
                ok: true,
                jobId: randomUUID(),
                status: "completed",
                phase: "finalizing",
                startedAt: now,
                finishedAt: now,
                totalAccounts: 0,
                processedAccounts: 0,
                deletedAccounts: 0,
                deletedSaves: 0,
                backup: null,
                removedBackups: 0,
                backupCleanupError: null,
                createdIndexes: 0,
                batchSize: ACCOUNT_CLEANUP_BATCH_SIZE,
                pauseMs: ACCOUNT_CLEANUP_BATCH_PAUSE_MS,
                workerThreadId: null,
                skippedActiveAccount: activeAccountId,
                error: null,
            }
            return reply.send(accountCleanupJob)
        }

        try {
            const job = startAccountCleanupWorker(accountIds, activeAccountId)
            return reply.status(202).send(job)
        } catch (error) {
            accountCleanupJob = null
            return reply.status(500).send({
                error: error instanceof Error ? error.message : String(error),
            })
        }
    })

    // Rename a save
    fastify.post("/renameSave", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as Record<string, any> || {}
        const playerId = parseInt(body.playerId)
        const name = body.name
        if (isNaN(playerId) || !name) return reply.status(400).send({ error: "Missing params" })
        updatePlayerSync({ id: playerId, name: String(name) })
        if (wantsJson(request)) return reply.send({ ok: true, playerId, name: String(name) })
        return reply.redirect('/player')
    })

    // Clone a save to another account
    fastify.post("/cloneSave", async (request: FastifyRequest, reply: FastifyReply) => {
        const { playerId: pid, accountId: aid } = (request.query || {}) as any
        const playerId = parseInt(pid)
        const accountId = parseInt(aid)
        if (isNaN(playerId) || isNaN(accountId)) {
            if (wantsJson(request)) return reply.status(400).send({ error: "Invalid playerId or accountId" })
            return reply.redirect('/player')
        }

        const serialized = getClientSerializedData(playerId, { viewerId: 0 })
        if (!serialized) {
            if (wantsJson(request)) return reply.status(404).send({ error: "Source player not found" })
            return reply.redirect('/player')
        }

        const newPlayer = insertDefaultPlayerSync(accountId)
        setActivePlayerId(newPlayer.id)

        const mergedData = deserializePlayerData(newPlayer.id, serialized)
        replacePlayerDataSync(mergedData)

        saveAccountDefaultPlayer(accountId, newPlayer.id)
        if (wantsJson(request)) return reply.send({ ok: true, newPlayerId: newPlayer.id })
        return reply.redirect('/player')
    })

    // Device binding rename
    fastify.post("/device/rename", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as { device_id: number; name: string }
        const deviceId = body.device_id
        if (!deviceId) return reply.status(400).send({ error: "Missing device_id" })

        updateDeviceBindingNameSync(deviceId, body.name || null)
        return reply.status(200).send({ ok: true })
    })
}

export default routes;
