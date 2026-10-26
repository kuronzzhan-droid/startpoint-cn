import { existsSync } from "../../lib/file-exists";
import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { lstatSync, readdirSync, rmSync, statSync, writeFileSync } from "fs";
import path from "path";
import { randomBytes, randomUUID } from "crypto";
import { Worker } from "worker_threads";
import { getServerTime, getServerDate, getTimeOffset, getServerClockSnapshot } from "../../utils";
import { deleteAccountSync, getAccountPlayersSync, getAllAccountsSync, updateAccountSync } from "../../data/domains/account"
import { deletePlayerSync, getPlayerSync, insertDefaultPlayerSync, updatePlayerSync } from "../../data/domains/player"
import { getAllDeviceBindingsSync, getAllViewerSessionsSync, getDeviceBindingSync, getSessionByAccountIdSync } from "../../data/domains/session"
import { getPlayerCharactersSync } from "../../data/domains/character"
import { getAllAdminPlayerSummariesSync, type AdminPlayerSummary } from "../../data/domains/admin-player"
import { getActivePlayerId, getAdminPlayerSelectionState, getSelectedAccountId, setSelectedAccountId, removeDeletedAccountFromState, removeDeletedAccountsFromState, activatePlayerSave, removeDeletedPlayerFromState } from "../../data/activeAccount";
import { saveDefaultSaveTemplate, loadDefaultSaveTemplate, clearDefaultSaveTemplate, getDefaultSaveMeta } from "../../data/defaultSave";
import { detectCDNVersion, FULL_BASE, getEffectiveVersion, getPatchManifest } from "../../lib/version";
import { buildShortUpCharacterGachaTimeline, buildShortUpCharacterGachaCatalog, buildShortUpCharacterGachaCurrent } from "../../lib/admin-clairvoyance";
import { wantsJson } from "./http";
import { SessionType } from "../../data/types";
import { getDb } from "../../data/db";
import { disconnectDeletedPlayerLogin, playerLoginAdminOverview, playerLoginManaged } from "../../lib/player-login";
import { accountHasNote, ensureCascadeDeleteIndexes, selectUnnotedAccountIds } from "../../lib/admin-account-cleanup";
import { removePlayerQuestNpcPartySnapshots } from "../../multi/npc/player-party-pool";
import { runPersistenceTransaction, runPersistenceTransactionSync } from "../../lib/persistence-coordinator";
import { createFullDatabaseBackup, getDatabaseDirectory } from "../../lib/admin-database-backup";
import { getOnlinePlayerCount } from "../../lib/online-presence";
import { clearRecoveryFailuresForViewer } from "../cn/takeOver";
import { getZipFileSummary } from "../../lib/zip-summary-cache";
import { assertServerAcceptingWork, isServerShuttingDown, ServerClosingError, withShutdownCleanup } from "../../lib/shutdown-state";
import {
    createPlayerSaveSnapshotV2Sync,
    isPlayerSaveSnapshotV2,
    restorePlayerSaveSnapshotV2Sync,
    validatePlayerSaveSnapshotV2Sync,
} from "../../data/snapshots/player-snapshot";

import { contentClientReload, ContentClientReloadConflict, CONTENT_CLIENT_RELOAD_CONFIRM } from "../../lib/content-client-reload";
import type { ContentClientReloadPlay } from "../../lib/content-client-reload";
import { hasManagementSession } from "../../lib/management-auth";
import { getRoomCommandGateway } from "../../multi/coordinator/default-runtime";
import { readAdminAccountSummary, readAdminAccountPage, readAdminAccountDetail, readAdminAccountTargets } from "../../lib/admin-account-overview";
import { createAdminStaticCache } from "../../lib/admin-static-cache";

async function disconnectClientsForContentReload(): Promise<{ applied: boolean; viewerCount?: number; message?: string }> {
    try {
        return await getRoomCommandGateway().execute("runtime.disconnectAllForContentReload", {}) as { applied: boolean; viewerCount: number }
    } catch {
        // The durable epoch remains authoritative even when the owner is unavailable.
        // Never report that existing transports were closed without an owner ACK.
        return { applied: false, message: "重登通知已保存；在线连接清理尚未确认，请重试。" }
    }
}

const MANUAL_DATABASE_BACKUP_KEEP_COUNT = 5
const ACCOUNT_CLEANUP_BATCH_SIZE = 5
const ACCOUNT_CLEANUP_BATCH_PAUSE_MS = 100
const MAX_SAVE_TEMPLATE_UPLOAD_BYTES = 64 * 1024 * 1024

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
    remainingAccounts: number
    interrupted: boolean
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
let accountCleanupWorkerExit: Promise<void> | null = null
let accountCleanupExecution: Promise<void> | null = null
let accountCleanupClosing = false
function cleanupClosing(): boolean { return accountCleanupClosing || isServerShuttingDown() }
function interruptCleanup(job: AccountCleanupJob): void {
    job.ok = false
    job.status = "failed"
    job.interrupted = true
    job.remainingAccounts = Math.max(0, job.totalAccounts - job.processedAccounts)
    job.finishedAt = new Date().toISOString()
    job.error = `服务器正在关闭，清理已停止；已提交删除 ${job.deletedAccounts} 个账号，剩余 ${job.remainingAccounts} 个待处理，可在重启后重新确认清理。`
}

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
    let backup: Awaited<ReturnType<typeof createFullDatabaseBackup>> | null = null
    const deletedAccountIds: number[] = []
    const deletedPlayerIds: number[] = []
    let interrupted = false
    let failure: unknown
    try {
        if (cleanupClosing()) { interruptCleanup(job); return }
        job.totalAccounts = plannedEntries.length
        job.remainingAccounts = job.totalAccounts
        job.phase = "backing_up"
        backup = await createFullDatabaseBackup("unnoted-accounts")
        job.backup = `.database/admin-backups/${backup.name}`

        job.phase = "indexing"
        if (!cleanupClosing()) {
            job.createdIndexes = await runPersistenceTransaction({
                domain: "admin", operation: "ensure_cleanup_indexes",
            }, () => ensureCascadeDeleteIndexes(getDb()))
        }

        job.phase = "deleting"
        let processedAccounts = 0
        let deletedAccounts = 0
        let deletedSaves = 0
        const plannedAccountIds = plannedEntries.map(entry => entry.accountId)

        for (let offset = 0; offset < plannedAccountIds.length; offset += ACCOUNT_CLEANUP_BATCH_SIZE) {
            // Each accepted transaction may finish; close never admits the
            // next batch under a blanket cleanup exemption.
            if (cleanupClosing()) { interrupted = true; break }
            const requestedIds = plannedAccountIds.slice(offset, offset + ACCOUNT_CLEANUP_BATCH_SIZE)
            if (requestedIds.length === 0) continue
            const placeholders = requestedIds.map(() => "?").join(", ")
            const batch = await runPersistenceTransaction({
                domain: "admin", operation: "delete_unnoted_accounts",
            }, () => {
                const candidates = getDb().prepare(`
                    SELECT a.id, a.admin_note
                    FROM accounts AS a
                    WHERE a.id IN (${placeholders})
                `).all(...requestedIds) as { id: number; admin_note: string | null }[]
                // Recheck inside the delete transaction using the same Unicode
                // whitespace rule as the UI and planner. Only a note preserves it.
                const existingAccounts = candidates.filter(account => !accountHasNote({
                    id: account.id, adminNote: account.admin_note,
                }))
                if (existingAccounts.length === 0) return []
                const eligibleIds = existingAccounts.map(account => account.id)
                const eligiblePlaceholders = eligibleIds.map(() => "?").join(", ")
                const players = getDb().prepare(
                    `SELECT id, account_id FROM players WHERE account_id IN (${eligiblePlaceholders})`,
                ).all(...eligibleIds) as { id: number; account_id: number }[]
                const viewers = getDb().prepare(
                    `SELECT token, account_id FROM sessions WHERE account_id IN (${eligiblePlaceholders}) AND type = ?`,
                ).all(...eligibleIds, SessionType.VIEWER) as { token: string; account_id: number }[]
                getDb().prepare(`DELETE FROM accounts WHERE id IN (${eligiblePlaceholders})`).run(...eligibleIds)
                return existingAccounts.map(account => ({
                    accountId: account.id,
                    viewerIds: viewers.filter(viewer => viewer.account_id === account.id)
                        .map(viewer => Number(viewer.token)).filter(viewer => Number.isSafeInteger(viewer) && viewer > 0),
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
            job.processedAccounts = processedAccounts
            job.deletedAccounts = deletedAccounts
            job.deletedSaves = deletedSaves
            job.remainingAccounts = Math.max(0, job.totalAccounts - processedAccounts)
            withShutdownCleanup(() => {
                removeDeletedAccountsFromState(batch)
                for (const viewerId of new Set(batch.flatMap(entry => entry.viewerIds))) {
                    disconnectDeletedPlayerLogin(viewerId)
                }
            })
            if (processedAccounts < plannedAccountIds.length) {
                await delay(ACCOUNT_CLEANUP_BATCH_PAUSE_MS)
            }
        }

    } catch (error) {
        if (error instanceof ServerClosingError) interrupted = true
        else failure = error
    }

    job.phase = "finalizing"
    // Only post-commit cleanup of already deleted objects may continue during
    // close. No new account deletion is hidden inside this cleanup scope.
    await withShutdownCleanup(() => cleanupDeletedPlayerAiSnapshots(deletedPlayerIds, `unnoted-account cleanup ${jobId}`))
    interrupted ||= cleanupClosing() && job.remainingAccounts > 0
    if (interrupted) interruptCleanup(job)
    else {
        job.status = failure ? "failed" : "completed"
        job.ok = !failure
        job.finishedAt = new Date().toISOString()
        if (failure) job.error = failure instanceof Error ? failure.message : String(failure)
    }
    try {
        if (!backup) return
        writeFileSync(
            path.join(backup.directory, "cleanup-result.json"),
            JSON.stringify({
                createdAt: new Date().toISOString(),
                jobId,
                deletedAccountIds,
                deletedPlayerIds,
                deletedSaves: job.deletedSaves,
                status: job.status,
                interrupted: job.interrupted,
                totalAccounts: job.totalAccounts,
                processedAccounts: job.processedAccounts,
                remainingAccounts: job.remainingAccounts,
                skippedActiveAccount: job.skippedActiveAccount,
                createdIndexes: job.createdIndexes,
            }, null, 2),
            "utf8",
        )

        try {
            if (job.status === "completed") job.removedBackups = removeOlderCleanupBackups(backup.directory).length
        } catch (error) {
            job.backupCleanupError = error instanceof Error ? error.message : String(error)
        }
    } catch (error) {
        job.backupCleanupError = error instanceof Error ? error.message : String(error)
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
): AccountCleanupJob {
    assertServerAcceptingWork()
    if (accountCleanupClosing) throw new ServerClosingError()
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
        remainingAccounts: accountIds.length,
        interrupted: false,
        deletedAccounts: 0,
        deletedSaves: 0,
        skippedActiveAccount: null,
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
    accountCleanupWorkerExit = new Promise<void>(resolve => {
        worker.once("exit", () => {
            if (accountCleanupWorker === worker) {
                accountCleanupWorker = null
                accountCleanupWorkerExit = null
            }
            job.workerThreadId = null
            resolve()
        })
    })
    job.workerThreadId = worker.threadId
    let planReceived = false

    worker.on("message", (message: any) => {
        if (!accountCleanupJob || accountCleanupJob.jobId !== jobId || message?.jobId !== jobId) return
        if (message.type === "phase") {
            accountCleanupJob.phase = message.phase
            return
        }
        if (message.type === "plan") {
            if (planReceived) return
            planReceived = true
            const plannedEntries = Array.isArray(message.plannedEntries)
                ? message.plannedEntries as PlannedCleanupEntry[]
                : []
            if (cleanupClosing()) { interruptCleanup(job); return }
            const execution = executeAccountCleanupPlan(jobId, plannedEntries)
            accountCleanupExecution = execution
            void execution.finally(() => {
                if (accountCleanupExecution === execution) accountCleanupExecution = null
            }).catch(error => {
                job.status = "failed"; job.ok = false
                job.finishedAt = new Date().toISOString()
                job.error = error instanceof Error ? error.message : String(error)
            })
            return
        }
        if (message.type === "failed") {
            accountCleanupJob.status = "failed"
            accountCleanupJob.finishedAt = new Date().toISOString()
            accountCleanupJob.error = message.error
        }
    })
    worker.on("error", error => {
        if (!accountCleanupJob || accountCleanupJob.jobId !== jobId || accountCleanupJob.status !== "running") return
        accountCleanupJob.status = "failed"
        accountCleanupJob.finishedAt = new Date().toISOString()
        accountCleanupJob.error = error instanceof Error ? error.message : String(error)
    })
    worker.on("exit", code => {
        if (accountCleanupWorker === worker) accountCleanupWorker = null
        if (planReceived) return
        if (!accountCleanupJob || accountCleanupJob.jobId !== jobId || accountCleanupJob.status !== "running") return
        if (cleanupClosing()) { interruptCleanup(job); return }
        accountCleanupJob.status = "failed"
        accountCleanupJob.finishedAt = new Date().toISOString()
        accountCleanupJob.error = `Cleanup worker exited before completion (code ${code})`
        accountCleanupJob.workerThreadId = null
    })
    return job
}

function buildAdminCdnStatus(root: string, cdnDir: string, patchManifest: ReturnType<typeof getPatchManifest>) {
    const cdnRoot = path.isAbsolute(cdnDir) ? path.join(cdnDir, "cn") : path.join(root, cdnDir, "cn")
    const archiveSummary = getZipFileSummary(cdnRoot)
    const activePatchSummary = getZipFileSummary(path.join(root, "assets", "asset-patch", "active"))
    const enabledPatches = patchManifest.patches.filter(patch => patch.enabled)
    const detectedVersion = detectCDNVersion()
    const effectiveVersion = getEffectiveVersion()
    return {
                baseUrl: getCdnBaseUrl(),
                baseline: {
                    mode: "fixed-cn-final",
                    source: "国服最终 CDN",
                    fullVersion: FULL_BASE,
                    cnFinalVersion: effectiveVersion,
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
            }
}
const adminCdnStatusCache = createAdminStaticCache<ReturnType<typeof buildAdminCdnStatus>>(60_000)

const routes = async (fastify: FastifyInstance) => {

    fastify.addHook("onClose", async () => {
        accountCleanupClosing = true
        if (accountCleanupWorker) {
            await accountCleanupWorker.terminate()
        }
        await accountCleanupWorkerExit
        await accountCleanupExecution
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
        const patchManifest = getPatchManifest()
        const cacheKey = JSON.stringify([root, cdnDir, getCdnBaseUrl()])
        const cdn = adminCdnStatusCache.get(cacheKey, patchManifest, () => buildAdminCdnStatus(root, cdnDir, patchManifest))
        return reply.status(200).send({
            server: {
                uptimeSeconds: Math.floor(process.uptime()),
                onlinePlayers: getOnlinePlayerCount(),
                nodeVersion: process.version,
                platform: `${process.platform}/${process.arch}`,
                pid: process.pid,
                memory: process.memoryUsage(),
                listenHost: process.env.CN_LISTEN_HOST || "localhost",
                listenPort: process.env.CN_LISTEN_PORT || "8001",
            },
            cdn,
        })
    })

    fastify.get("/currentTime", async (_request: FastifyRequest, reply: FastifyReply) => {
        const date = getServerDate()
        return reply.status(200).send({
            servertime: getServerTime(),
            date: date.toISOString(),
            isCustom: (getTimeOffset() ?? 0) !== 0,
            clockMode: getServerClockSnapshot().mode
        })
    })

    // Clock editing is retired: operational refresh must not alter business time.
    for (const endpoint of ["/resetTime", "/time"]) fastify.get(endpoint, async (_request, reply) => {
        return reply.status(409).send({ error: "服务器时间不可修改；请使用全员重新登录刷新运营配置。" })
    })

    fastify.get("/clientReload", async (request, reply) => {
        if (!hasManagementSession(request)) return reply.status(401).send({ error: "unauthorized" })
        return contentClientReload().state()
    })
    fastify.post("/clientReload", async (request, reply) => {
        if (!hasManagementSession(request)) return reply.status(401).send({ error: "unauthorized" })
        const body = request.body as { expectedEpoch?: unknown; confirm?: unknown } | null
        if (body?.confirm !== CONTENT_CLIENT_RELOAD_CONFIRM || !Number.isSafeInteger(body.expectedEpoch)
            || Number(body.expectedEpoch) < 0 || Number(body.expectedEpoch) >= Number.MAX_SAFE_INTEGER) {
            return reply.status(400).send({ error: "请确认全员重新登录操作，并提供当前重登版本。" })
        }
        try {
            // Capture only currently connected, committed plays before publishing the
            // epoch; an immediate /load cannot race ahead of its protection record.
            let preview: { plays: ContentClientReloadPlay[] }
            try {
                preview = await getRoomCommandGateway().execute("runtime.contentReloadPreview", {}) as { plays: ContentClientReloadPlay[] }
            } catch {
                return reply.status(503).send({ error: "多人连接状态暂不可用，尚未发出重登通知，请稍后重试。" })
            }
            const state = await runPersistenceTransaction({ domain: "admin", operation: "request_content_client_reload" }, () =>
                contentClientReload().request(body.expectedEpoch as number, Date.now(), preview.plays))
            const realtime = await disconnectClientsForContentReload()
            return reply.send({ ok: true, ...state, realtime })
        } catch (error) {
            if (error instanceof ContentClientReloadConflict) return reply.status(409).send({ error: error.message, current: error.current })
            throw error
        }
    })
    fastify.post("/clientReload/disconnect", async (request, reply) => {
        if (!hasManagementSession(request)) return reply.status(401).send({ error: "unauthorized" })
        const body = request.body as { epoch?: unknown; confirm?: unknown } | null
        if (body?.confirm !== CONTENT_CLIENT_RELOAD_CONFIRM || !Number.isSafeInteger(body.epoch) || Number(body.epoch) < 1) {
            return reply.status(400).send({ error: "请提供要重试的重登版本。" })
        }
        const state = contentClientReload().state()
        if (body.epoch !== state.epoch) return reply.status(409).send({ error: "重登状态已更新，请刷新后重试。", current: state })
        return reply.send({ ok: true, ...state, realtime: await disconnectClientsForContentReload() })
    })

    fastify.get("/clairvoyance/gacha", async (request: FastifyRequest, reply: FastifyReply) => {
        const view = (request.query as { view?: string }).view
        if (view !== undefined && view !== "catalog" && view !== "current") {
            return reply.status(400).send({ error: "不支持的卡池资料视图。" })
        }
        const patchManifest = getPatchManifest()
        const metadata = { cdnVersion: patchManifest.cdn_version, baseline: "fixed-cn-final" }
        if (view === "catalog") {
            const catalog = buildShortUpCharacterGachaCatalog()
            const etag = `"${catalog.catalogVersion}-${metadata.cdnVersion}"`
            reply.header("cache-control", "private, no-cache").header("etag", etag)
            const conditional = request.headers["if-none-match"]
            if (typeof conditional === "string" && conditional.split(",").some(value => {
                const tag = value.trim()
                return tag === "*" || tag.replace(/^W\//, "") === etag
            })) return reply.status(304).send()
            return reply.send({ ...metadata, ...catalog })
        }
        reply.header("cache-control", "no-store")
        return reply.send({ ...metadata, ...(view === "current"
            ? buildShortUpCharacterGachaCurrent(getServerDate())
            : buildShortUpCharacterGachaTimeline(getServerDate())) })
    })

    // === Account list (JSON, for admin SPA) ===

    fastify.get("/accounts/summary", async (_request, reply) => {
        return reply.header("cache-control", "no-store").send(readAdminAccountSummary(getDb()))
    })
    fastify.get("/accounts/page", async (request, reply) => {
        const query = request.query as { page?: string; pageSize?: string; q?: string }
        const page = Number(query.page ?? 1), pageSize = Number(query.pageSize ?? 20)
        if (!Number.isSafeInteger(page) || page < 1 || ![20, 50, 100].includes(pageSize)
            || (query.q !== undefined && typeof query.q !== "string")) {
            return reply.status(400).send({ error: "请提供有效页码和每页条数（20、50 或 100）。" })
        }
        return reply.header("cache-control", "no-store").send(readAdminAccountPage(getDb(), getAdminPlayerSelectionState(), page, pageSize, query.q ?? ""))
    })
    fastify.get("/accounts/targets", async (_request, reply) => {
        return reply.header("cache-control", "no-store").send(readAdminAccountTargets(getDb(), getAdminPlayerSelectionState()))
    })
    fastify.get("/accounts/:id", async (request, reply) => {
        const id = Number((request.params as { id: string }).id)
        if (!Number.isSafeInteger(id) || id < 1) return reply.status(400).send({ error: "无效账号。" })
        const account = readAdminAccountDetail(getDb(), getAdminPlayerSelectionState(), id)
        if (!account) return reply.status(404).send({ error: "账号不存在或已删除，请刷新账号列表。" })
        return reply.header("cache-control", "no-store").send(account)
    })

    fastify.get("/accounts", async (_request: FastifyRequest, reply: FastifyReply) => {
        const loginByAccount = playerLoginAdminOverview()
        const accounts = getAllAccountsSync()
        const selection = getAdminPlayerSelectionState()
        const activePlayerId = selection.activePlayerId
        const playersByAccount = new Map<number, AdminPlayerSummary[]>()
        for (const player of getAllAdminPlayerSummariesSync()) {
            const players = playersByAccount.get(player.accountId) ?? []
            players.push(player)
            playersByAccount.set(player.accountId, players)
        }
        const bindingsByAccount = new Map<number, Array<{ deviceId: number }>>()
        for (const binding of getAllDeviceBindingsSync()) {
            const bindings = bindingsByAccount.get(binding.account_id) ?? []
            bindings.push({ deviceId: binding.device_id })
            bindingsByAccount.set(binding.account_id, bindings)
        }
        const viewerIdByAccount = new Map<number, string>()
        for (const session of getAllViewerSessionsSync()) {
            if (!viewerIdByAccount.has(session.accountId)) {
                viewerIdByAccount.set(session.accountId, session.token)
            }
        }
        const latestTransfers = getDb().prepare(`
            SELECT transfer.target_account_id, transfer.source_viewer_id,
                   transfer.old_device_id, transfer.new_device_id,
                   transfer.source_player_count, transfer.transferred_at, transfer.source
            FROM account_transfer_audit AS transfer
            JOIN (
                SELECT target_account_id, MAX(id) AS latest_id
                FROM account_transfer_audit
                GROUP BY target_account_id
            ) AS latest ON latest.latest_id = transfer.id
        `).all() as Array<{
            target_account_id: number
            source_viewer_id: string | null
            old_device_id: number | null
            new_device_id: number
            source_player_count: number
            transferred_at: string
            source: string
        }>
        const latestTransferByAccount = new Map(
            latestTransfers.map(transfer => [transfer.target_account_id, transfer]),
        )
        const result = accounts.map(acc => {
            const players = playersByAccount.get(acc.id) ?? []
            const playerIds = players.map(player => player.id)
            const savedDefaultPid = selection.defaultPlayers[acc.id]
            const defaultPid = savedDefaultPid && playerIds.includes(savedDefaultPid)
                ? savedDefaultPid
                : (playerIds[0] ?? null)
            const defaultPlayer = players.find(player => player.id === defaultPid)
            const latestTransfer = latestTransferByAccount.get(acc.id)
            return {
                id: acc.id,
                viewerId: viewerIdByAccount.get(acc.id) ?? null,
                note: acc.adminNote ?? null,
                loginUsername: acc.username || null,
                playerLogin: loginByAccount.get(acc.id) ?? { bound: false, boundAt: null, sessionExpiresAt: null },
                takeoverConfigured: Boolean(acc.takeoverPassword),
                latestTransfer: latestTransfer ? {
                    abolishedViewerId: latestTransfer.source_viewer_id,
                    oldDeviceId: latestTransfer.old_device_id,
                    newDeviceId: latestTransfer.new_device_id,
                    discardedSaveCount: latestTransfer.source_player_count,
                    transferredAt: latestTransfer.transferred_at,
                    source: latestTransfer.source,
                } : null,
                bindings: bindingsByAccount.get(acc.id) ?? [],
                saveCount: playerIds.length,
                defaultPlayerId: defaultPid,
                defaultPlayerName: defaultPlayer?.name ?? null,
                activePlayerId,
                players: players.map(player => {
                    return {
                        id: player.id,
                        accountId: acc.id,
                        name: player.name,
                        comment: player.comment,
                        degreeId: player.degreeId,
                        isDefault: defaultPid === player.id,
                        isActive: activePlayerId === player.id,
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
            const buffer = await file.toBuffer()
            if (buffer.length > MAX_SAVE_TEMPLATE_UPLOAD_BYTES) {
                return reply.status(400).send({ error: `存档超过 ${MAX_SAVE_TEMPLATE_UPLOAD_BYTES / 1024 / 1024} MB 安全上限` })
            }
            const text = buffer.toString("utf-8")
            let parsed: any
            try { parsed = JSON.parse(text) } catch { return reply.status(400).send({ error: "文件不是有效的 JSON" }) }
            if (!parsed || typeof parsed !== "object" || parsed.schema !== "starpoint-cn-save")
                return reply.status(400).send({ error: "不是有效的存档快照（请使用本面板导出的存档）" })
            if (!isPlayerSaveSnapshotV2(parsed))
                return reply.status(400).send({ error: "仅支持 V2 完整存档；旧版 V1 存档与当前数据库结构不兼容" })
            validatePlayerSaveSnapshotV2Sync(parsed)
            saveDefaultSaveTemplate(parsed)
            return reply.send({ ok: true, ...getDefaultSaveMeta() })
        } catch (e: any) {
            if (e?.code === "FST_REQ_FILE_TOO_LARGE") {
                return reply.status(413).send({ error: `存档超过 ${MAX_SAVE_TEMPLATE_UPLOAD_BYTES / 1024 / 1024} MB 安全上限` })
            }
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
        if (!getPlayerSync(pid)) return reply.status(404).send({ error: "存档不存在" })
        const allAccounts = getAllAccountsSync()
        let accountId: number | null = null
        for (const a of allAccounts) {
            if (getAccountPlayersSync(a.id).includes(pid)) {
                accountId = a.id
                break
            }
        }
        activatePlayerSave(accountId, pid)
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
        let player: ReturnType<typeof insertDefaultPlayerSync>
        let appliedTemplate = false
        try {
            const template = loadDefaultSaveTemplate()
            const snapshot = template === null ? null : validatePlayerSaveSnapshotV2Sync(template)
            // Diagnose unusable selection state before creating anything. The
            // later JSON commit remains separate from the SQLite transaction.
            getAdminPlayerSelectionState()
            player = await runPersistenceTransaction({ domain: "admin", operation: "admin_create_save" }, () => {
                const created = insertDefaultPlayerSync(accId)
                if (snapshot) restorePlayerSaveSnapshotV2Sync(snapshot, created.id, { includeArchiveHistory: false })
                return created
            })
            appliedTemplate = snapshot !== null
        } catch (error: any) {
            const message = `新建存档失败，未创建新存档：${error?.message ?? error}`
            if (wantsJson(request)) return reply.status(409).send({ error: message })
            return reply.redirect(`/player?error=${encodeURIComponent(message)}`)
        }
        try { activatePlayerSave(accId, player.id) }
        catch (error: any) {
            const message = `存档 ${player.id} 已创建，但选档保存失败，请重新选择该存档，无需再次新建：${error?.message ?? error}`
            if (wantsJson(request)) return reply.status(500).send({ error: message, created: true, playerId: player.id, appliedTemplate })
            return reply.redirect(`/player?error=${encodeURIComponent(message)}`)
        }
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
            const deletedPlayerIds = runPersistenceTransactionSync({
                domain: "admin", operation: `admin_delete_save_account:${accountId}`,
            }, () => deleteAccountDataSync(accountId))
            removeDeletedAccountFromState(accountId, deletedPlayerIds)
            await cleanupDeletedPlayerAiSnapshots(deletedPlayerIds, `save ${pid} and account ${accountId} deletion`)
        } else {
            runPersistenceTransactionSync({
                domain: "admin", playerId: pid, operation: "admin_delete_save",
            }, () => deletePlayerSync(pid))
            await cleanupDeletedPlayerAiSnapshots([pid], `save ${pid} deletion`)
            const remainingPlayerIds = getAccountPlayersSync(accountId)
            removeDeletedPlayerFromState(accountId || null, pid, remainingPlayerIds[0] ?? null)
        }
        const accountAlsoDeleted = accountId && getAccountPlayersSync(accountId).length === 0
        if (wantsJson(request)) return reply.send({ ok: true, deleted: pid, accountAlsoDeleted: !!accountAlsoDeleted })
        return reply.redirect('/player')
    })

    // Delete entire account + all saves + device binding
    fastify.post("/deleteAccount", async (request: FastifyRequest, reply: FastifyReply) => {
        const { id } = (request.query || {}) as any
        const accountId = parseInt(id)
        if (isNaN(accountId)) return reply.status(400).send({ error: "Missing or invalid 'id'" })
        const playerIds = runPersistenceTransactionSync({
            domain: "admin", operation: `admin_delete_account:${accountId}`,
        }, () => deleteAccountDataSync(accountId))
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

    // Only account notes determine eligibility, including bound and selected accounts.
    fastify.post("/deleteUnnotedAccounts", async (request: FastifyRequest, reply: FastifyReply) => {
        assertServerAcceptingWork()
        if (accountCleanupClosing) throw new ServerClosingError()
        const body = (request.body || {}) as { confirm?: unknown }
        if (body.confirm !== "DELETE_UNNOTED_ACCOUNTS") {
            return reply.status(400).send({ error: "Confirmation token is required" })
        }
        if (accountCleanupJob?.status === "running" || accountCleanupExecution || accountCleanupWorker) {
            return reply.status(409).send({
                error: "An account cleanup job is already running",
                job: accountCleanupJob,
            })
        }

        const accounts = getAllAccountsSync()
        const accountIds = selectUnnotedAccountIds(accounts)

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
                remainingAccounts: 0,
                interrupted: false,
                deletedAccounts: 0,
                deletedSaves: 0,
                backup: null,
                removedBackups: 0,
                backupCleanupError: null,
                createdIndexes: 0,
                batchSize: ACCOUNT_CLEANUP_BATCH_SIZE,
                pauseMs: ACCOUNT_CLEANUP_BATCH_PAUSE_MS,
                workerThreadId: null,
                skippedActiveAccount: null,
                error: null,
            }
            return reply.send(accountCleanupJob)
        }

        try {
            const job = startAccountCleanupWorker(accountIds)
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
        runPersistenceTransactionSync({
            domain: "admin", playerId, operation: "rename_save",
        }, () => updatePlayerSync({ id: playerId, name: String(name) }))
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

        if (!getPlayerSync(playerId)) {
            if (wantsJson(request)) return reply.status(404).send({ error: "Source player not found" })
            return reply.redirect('/player')
        }
        let snapshot
        try {
            snapshot = createPlayerSaveSnapshotV2Sync(playerId)
        } catch (error: any) {
            if (wantsJson(request)) return reply.status(500).send({ error: `克隆前导出失败：${error?.message ?? error}` })
            return reply.redirect('/player')
        }

        let newPlayerId = 0
        let restored
        try {
            ({ newPlayerId, restored } = runPersistenceTransactionSync({
                domain: "admin", operation: "clone_save",
            }, () => {
                const newPlayer = insertDefaultPlayerSync(accountId)
                try {
                    return {
                        newPlayerId: newPlayer.id,
                        restored: restorePlayerSaveSnapshotV2Sync(snapshot, newPlayer.id, {
                            includeArchiveHistory: false,
                        }),
                    }
                } catch (error) {
                    try { deletePlayerSync(newPlayer.id) } catch { /* preserve original clone error */ }
                    throw error
                }
            }))
        } catch (error: any) {
            if (wantsJson(request)) return reply.status(500).send({ error: `克隆恢复失败：${error?.message ?? error}` })
            return reply.redirect('/player')
        }

        try { activatePlayerSave(accountId, newPlayerId) }
        catch (error: any) {
            const message = `克隆存档 ${newPlayerId} 已创建，但选档保存失败，请重新选择该存档，无需再次克隆：${error?.message ?? error}`
            if (wantsJson(request)) return reply.status(500).send({ error: message, created: true, playerId: newPlayerId })
            return reply.redirect(`/player?error=${encodeURIComponent(message)}`)
        }
        if (wantsJson(request)) return reply.send({ ok: true, newPlayerId, snapshotVersion: 2, restored })
        return reply.redirect('/player')
    })

    // Account-scoped note: it survives device replacement and account recovery.
    fastify.post("/account/rename", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as { account_id?: unknown; name?: unknown }
        const accountId = Number(body?.account_id)
        if (!Number.isSafeInteger(accountId) || accountId <= 0) {
            return reply.status(400).send({ error: "Missing account_id" })
        }
        const account = getAllAccountsSync().find(candidate => candidate.id === accountId)
        if (!account) return reply.status(404).send({ error: "Account not found" })
        const note = typeof body.name === "string" ? body.name.trim().slice(0, 100) : ""
        runPersistenceTransactionSync({
            domain: "admin", operation: "rename_account",
        }, () => updateAccountSync({ id: accountId, adminNote: note || null }))
        return reply.status(200).send({ ok: true, accountId, note: note || null })
    })

    fastify.post("/account/takeover-password/reset", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as { account_id?: unknown; confirm?: unknown }
        const accountId = Number(body?.account_id)
        if (!Number.isSafeInteger(accountId) || accountId <= 0) {
            return reply.status(400).send({ error: "Missing account_id" })
        }
        if (body.confirm !== "RESET_TAKEOVER_PASSWORD") {
            return reply.status(400).send({ error: "Confirmation token is required" })
        }
        if (playerLoginManaged(accountId)) {
            return reply.status(409).send({ error: "该存档已绑定登录账号，请生成登录密码重置码。旧继承密码不能恢复已绑定账号。" })
        }
        const account = getAllAccountsSync().find(candidate => candidate.id === accountId)
        if (!account) return reply.status(404).send({ error: "Account not found" })
        const replacementPassword = `R${randomBytes(6).toString("hex")}a1`
        runPersistenceTransactionSync({
            domain: "admin", operation: "reset_takeover_password",
        }, () => updateAccountSync({ id: accountId, takeoverPassword: replacementPassword }))
        const viewerSession = getSessionByAccountIdSync(accountId, SessionType.VIEWER)
        if (viewerSession) clearRecoveryFailuresForViewer(viewerSession.token)
        // Return the replacement once; account listing never exposes stored passwords.
        return reply.status(200).send({ ok: true, accountId, replacementPassword })
    })

    // Backward-compatible endpoint for old admin pages. Resolve the device,
    // but write the authoritative account-scoped note.
    fastify.post("/device/rename", async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as { device_id: number; name: string }
        const deviceId = body.device_id
        if (!deviceId) return reply.status(400).send({ error: "Missing device_id" })

        const binding = getDeviceBindingSync(deviceId)
        if (!binding) return reply.status(404).send({ error: "Device binding not found" })
        const note = typeof body.name === "string" ? body.name.trim().slice(0, 100) : ""
        runPersistenceTransactionSync({
            domain: "admin", operation: "rename_device_account",
        }, () => updateAccountSync({ id: binding.account_id, adminNote: note || null }))
        return reply.status(200).send({ ok: true })
    })
}

export default routes;
