"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const file_exists_1 = require("../../lib/file-exists");
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
const crypto_1 = require("crypto");
const worker_threads_1 = require("worker_threads");
const utils_1 = require("../../utils");
const account_1 = require("../../data/domains/account");
const player_1 = require("../../data/domains/player");
const session_1 = require("../../data/domains/session");
const admin_player_1 = require("../../data/domains/admin-player");
const activeAccount_1 = require("../../data/activeAccount");
const defaultSave_1 = require("../../data/defaultSave");
const version_1 = require("../../lib/version");
const admin_clairvoyance_1 = require("../../lib/admin-clairvoyance");
const http_1 = require("./http");
const types_1 = require("../../data/types");
const db_1 = require("../../data/db");
const player_login_1 = require("../../lib/player-login");
const admin_account_cleanup_1 = require("../../lib/admin-account-cleanup");
const player_party_pool_1 = require("../../multi/npc/player-party-pool");
const persistence_coordinator_1 = require("../../lib/persistence-coordinator");
const admin_database_backup_1 = require("../../lib/admin-database-backup");
const online_presence_1 = require("../../lib/online-presence");
const takeOver_1 = require("../cn/takeOver");
const zip_summary_cache_1 = require("../../lib/zip-summary-cache");
const shutdown_state_1 = require("../../lib/shutdown-state");
const player_snapshot_1 = require("../../data/snapshots/player-snapshot");
const MANUAL_DATABASE_BACKUP_KEEP_COUNT = 5;
const ACCOUNT_CLEANUP_BATCH_SIZE = 5;
const ACCOUNT_CLEANUP_BATCH_PAUSE_MS = 100;
const MAX_SAVE_TEMPLATE_UPLOAD_BYTES = 64 * 1024 * 1024;
let accountCleanupJob = null;
let accountCleanupWorker = null;
let accountCleanupWorkerExit = null;
let accountCleanupExecution = null;
let accountCleanupClosing = false;
function cleanupClosing() { return accountCleanupClosing || (0, shutdown_state_1.isServerShuttingDown)(); }
function interruptCleanup(job) {
    job.ok = false;
    job.status = "failed";
    job.interrupted = true;
    job.remainingAccounts = Math.max(0, job.totalAccounts - job.processedAccounts);
    job.finishedAt = new Date().toISOString();
    job.error = `服务器正在关闭，清理已停止；已提交删除 ${job.deletedAccounts} 个账号，剩余 ${job.remainingAccounts} 个待处理，可在重启后重新确认清理。`;
}
function delay(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}
function deleteAccountDataSync(accountId) {
    const playerIds = (0, account_1.getAccountPlayersSync)(accountId);
    for (const playerId of playerIds)
        (0, player_1.deletePlayerSync)(playerId);
    (0, db_1.getDb)().prepare(`DELETE FROM device_bindings WHERE account_id = ?`).run(accountId);
    (0, account_1.deleteAccountSync)(accountId);
    return playerIds;
}
function cleanupDeletedPlayerAiSnapshots(playerIds, context) {
    return __awaiter(this, void 0, void 0, function* () {
        if (playerIds.length === 0)
            return;
        try {
            const result = yield (0, player_party_pool_1.removePlayerQuestNpcPartySnapshots)(playerIds);
            if (result.removedRows > 0) {
                console.log(`[ADMIN] removed ${result.removedRows} historical AI parties from ${result.affectedQuestCount} quest pools after ${context}`);
            }
        }
        catch (error) {
            console.warn(`[ADMIN] player data was deleted, but historical AI party cleanup failed after ${context}:`, error);
        }
    });
}
function removeExpiredManualDatabaseBackups(backupRoot) {
    if (!(0, file_exists_1.existsSync)(backupRoot))
        return [];
    const resolvedRoot = path_1.default.resolve(backupRoot);
    const backups = (0, fs_1.readdirSync)(resolvedRoot)
        .filter(name => /^manual-full-\d{8}-\d{6}-\d{3}$/.test(name))
        .sort((left, right) => right.localeCompare(left));
    const removed = [];
    for (const name of backups.slice(MANUAL_DATABASE_BACKUP_KEEP_COUNT)) {
        const candidate = path_1.default.resolve(resolvedRoot, name);
        if (path_1.default.dirname(candidate) !== resolvedRoot)
            continue;
        const stats = (0, fs_1.lstatSync)(candidate);
        if (!stats.isDirectory() || stats.isSymbolicLink())
            continue;
        (0, fs_1.rmSync)(candidate, { recursive: true, force: true });
        removed.push(name);
    }
    return removed;
}
function removeOlderCleanupBackups(currentBackupDirectory) {
    const backupRoot = path_1.default.resolve(path_1.default.dirname(currentBackupDirectory));
    const currentDirectory = path_1.default.resolve(currentBackupDirectory);
    const removed = [];
    if (!(0, file_exists_1.existsSync)(backupRoot))
        return removed;
    for (const name of (0, fs_1.readdirSync)(backupRoot)) {
        if (!/^unnoted-accounts-\d{8}-\d{6}(?:-\d{3})?$/.test(name))
            continue;
        const candidate = path_1.default.resolve(backupRoot, name);
        if (candidate === currentDirectory || path_1.default.dirname(candidate) !== backupRoot)
            continue;
        const stats = (0, fs_1.lstatSync)(candidate);
        if (!stats.isDirectory() || stats.isSymbolicLink())
            continue;
        (0, fs_1.rmSync)(candidate, { recursive: true, force: true });
        removed.push(name);
    }
    return removed;
}
function executeAccountCleanupPlan(jobId, plannedEntries) {
    return __awaiter(this, void 0, void 0, function* () {
        const job = accountCleanupJob;
        if (!job || job.jobId !== jobId || job.status !== "running")
            return;
        let backup = null;
        const deletedAccountIds = [];
        const deletedPlayerIds = [];
        let interrupted = false;
        let failure;
        try {
            if (cleanupClosing()) {
                interruptCleanup(job);
                return;
            }
            job.totalAccounts = plannedEntries.length;
            job.remainingAccounts = job.totalAccounts;
            job.phase = "backing_up";
            backup = yield (0, admin_database_backup_1.createFullDatabaseBackup)("unnoted-accounts");
            job.backup = `.database/admin-backups/${backup.name}`;
            job.phase = "indexing";
            if (!cleanupClosing()) {
                job.createdIndexes = yield (0, persistence_coordinator_1.runPersistenceTransaction)({
                    domain: "admin", operation: "ensure_cleanup_indexes",
                }, () => (0, admin_account_cleanup_1.ensureCascadeDeleteIndexes)((0, db_1.getDb)()));
            }
            job.phase = "deleting";
            let processedAccounts = 0;
            let deletedAccounts = 0;
            let deletedSaves = 0;
            const plannedAccountIds = plannedEntries.map(entry => entry.accountId);
            for (let offset = 0; offset < plannedAccountIds.length; offset += ACCOUNT_CLEANUP_BATCH_SIZE) {
                // Each accepted transaction may finish; close never admits the
                // next batch under a blanket cleanup exemption.
                if (cleanupClosing()) {
                    interrupted = true;
                    break;
                }
                const requestedIds = plannedAccountIds.slice(offset, offset + ACCOUNT_CLEANUP_BATCH_SIZE);
                if (requestedIds.length === 0)
                    continue;
                const placeholders = requestedIds.map(() => "?").join(", ");
                const batch = yield (0, persistence_coordinator_1.runPersistenceTransaction)({
                    domain: "admin", operation: "delete_unnoted_accounts",
                }, () => {
                    const candidates = (0, db_1.getDb)().prepare(`
                    SELECT a.id, a.admin_note
                    FROM accounts AS a
                    WHERE a.id IN (${placeholders})
                `).all(...requestedIds);
                    // Recheck inside the delete transaction using the same Unicode
                    // whitespace rule as the UI and planner. Only a note preserves it.
                    const existingAccounts = candidates.filter(account => !(0, admin_account_cleanup_1.accountHasNote)({
                        id: account.id, adminNote: account.admin_note,
                    }));
                    if (existingAccounts.length === 0)
                        return [];
                    const eligibleIds = existingAccounts.map(account => account.id);
                    const eligiblePlaceholders = eligibleIds.map(() => "?").join(", ");
                    const players = (0, db_1.getDb)().prepare(`SELECT id, account_id FROM players WHERE account_id IN (${eligiblePlaceholders})`).all(...eligibleIds);
                    const viewers = (0, db_1.getDb)().prepare(`SELECT token, account_id FROM sessions WHERE account_id IN (${eligiblePlaceholders}) AND type = ?`).all(...eligibleIds, types_1.SessionType.VIEWER);
                    (0, db_1.getDb)().prepare(`DELETE FROM accounts WHERE id IN (${eligiblePlaceholders})`).run(...eligibleIds);
                    return existingAccounts.map(account => ({
                        accountId: account.id,
                        viewerIds: viewers.filter(viewer => viewer.account_id === account.id)
                            .map(viewer => Number(viewer.token)).filter(viewer => Number.isSafeInteger(viewer) && viewer > 0),
                        playerIds: players
                            .filter(player => player.account_id === account.id)
                            .map(player => player.id),
                    }));
                });
                const batchPlayerIds = batch.flatMap(entry => entry.playerIds);
                processedAccounts += requestedIds.length;
                deletedAccounts += batch.length;
                deletedSaves += batchPlayerIds.length;
                deletedAccountIds.push(...batch.map(entry => entry.accountId));
                deletedPlayerIds.push(...batchPlayerIds);
                job.processedAccounts = processedAccounts;
                job.deletedAccounts = deletedAccounts;
                job.deletedSaves = deletedSaves;
                job.remainingAccounts = Math.max(0, job.totalAccounts - processedAccounts);
                (0, shutdown_state_1.withShutdownCleanup)(() => {
                    (0, activeAccount_1.removeDeletedAccountsFromState)(batch);
                    for (const viewerId of new Set(batch.flatMap(entry => entry.viewerIds))) {
                        (0, player_login_1.disconnectDeletedPlayerLogin)(viewerId);
                    }
                });
                if (processedAccounts < plannedAccountIds.length) {
                    yield delay(ACCOUNT_CLEANUP_BATCH_PAUSE_MS);
                }
            }
        }
        catch (error) {
            if (error instanceof shutdown_state_1.ServerClosingError)
                interrupted = true;
            else
                failure = error;
        }
        job.phase = "finalizing";
        // Only post-commit cleanup of already deleted objects may continue during
        // close. No new account deletion is hidden inside this cleanup scope.
        yield (0, shutdown_state_1.withShutdownCleanup)(() => cleanupDeletedPlayerAiSnapshots(deletedPlayerIds, `unnoted-account cleanup ${jobId}`));
        interrupted || (interrupted = cleanupClosing() && job.remainingAccounts > 0);
        if (interrupted)
            interruptCleanup(job);
        else {
            job.status = failure ? "failed" : "completed";
            job.ok = !failure;
            job.finishedAt = new Date().toISOString();
            if (failure)
                job.error = failure instanceof Error ? failure.message : String(failure);
        }
        try {
            if (!backup)
                return;
            (0, fs_1.writeFileSync)(path_1.default.join(backup.directory, "cleanup-result.json"), JSON.stringify({
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
            }, null, 2), "utf8");
            try {
                if (job.status === "completed")
                    job.removedBackups = removeOlderCleanupBackups(backup.directory).length;
            }
            catch (error) {
                job.backupCleanupError = error instanceof Error ? error.message : String(error);
            }
        }
        catch (error) {
            job.backupCleanupError = error instanceof Error ? error.message : String(error);
        }
    });
}
function getCdnBaseUrl() {
    const cdnHost = process.env.CN_LISTEN_HOST || "localhost";
    const cdnPort = process.env.CN_LISTEN_PORT || "8001";
    const cdnDisplayHost = cdnHost === "0.0.0.0" ? "localhost" : cdnHost;
    return process.env.CDN_BASE_URL || `http://${cdnDisplayHost}:${cdnPort}/patch/cn`;
}
function getCleanupWorkerLocation() {
    const compiledWorker = path_1.default.resolve(__dirname, "../../workers/admin-account-cleanup-worker.js");
    if ((0, file_exists_1.existsSync)(compiledWorker))
        return { filename: compiledWorker };
    const sourceWorker = path_1.default.resolve(__dirname, "../../workers/admin-account-cleanup-worker.ts");
    return {
        filename: sourceWorker,
        execArgv: ["-r", require.resolve("ts-node/register/transpile-only")],
    };
}
function startAccountCleanupWorker(accountIds) {
    (0, shutdown_state_1.assertServerAcceptingWork)();
    if (accountCleanupClosing)
        throw new shutdown_state_1.ServerClosingError();
    const jobId = (0, crypto_1.randomUUID)();
    const databaseDirectory = (0, admin_database_backup_1.getDatabaseDirectory)();
    const workerLocation = getCleanupWorkerLocation();
    const job = {
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
    };
    accountCleanupJob = job;
    const worker = new worker_threads_1.Worker(workerLocation.filename, {
        execArgv: workerLocation.execArgv,
        workerData: {
            jobId,
            databasePath: path_1.default.join(databaseDirectory, "wdfp_data.db"),
            accountIds,
            batchSize: ACCOUNT_CLEANUP_BATCH_SIZE,
        },
    });
    accountCleanupWorker = worker;
    accountCleanupWorkerExit = new Promise(resolve => {
        worker.once("exit", () => {
            if (accountCleanupWorker === worker) {
                accountCleanupWorker = null;
                accountCleanupWorkerExit = null;
            }
            job.workerThreadId = null;
            resolve();
        });
    });
    job.workerThreadId = worker.threadId;
    let planReceived = false;
    worker.on("message", (message) => {
        if (!accountCleanupJob || accountCleanupJob.jobId !== jobId || (message === null || message === void 0 ? void 0 : message.jobId) !== jobId)
            return;
        if (message.type === "phase") {
            accountCleanupJob.phase = message.phase;
            return;
        }
        if (message.type === "plan") {
            if (planReceived)
                return;
            planReceived = true;
            const plannedEntries = Array.isArray(message.plannedEntries)
                ? message.plannedEntries
                : [];
            if (cleanupClosing()) {
                interruptCleanup(job);
                return;
            }
            const execution = executeAccountCleanupPlan(jobId, plannedEntries);
            accountCleanupExecution = execution;
            void execution.finally(() => {
                if (accountCleanupExecution === execution)
                    accountCleanupExecution = null;
            }).catch(error => {
                job.status = "failed";
                job.ok = false;
                job.finishedAt = new Date().toISOString();
                job.error = error instanceof Error ? error.message : String(error);
            });
            return;
        }
        if (message.type === "failed") {
            accountCleanupJob.status = "failed";
            accountCleanupJob.finishedAt = new Date().toISOString();
            accountCleanupJob.error = message.error;
        }
    });
    worker.on("error", error => {
        if (!accountCleanupJob || accountCleanupJob.jobId !== jobId || accountCleanupJob.status !== "running")
            return;
        accountCleanupJob.status = "failed";
        accountCleanupJob.finishedAt = new Date().toISOString();
        accountCleanupJob.error = error instanceof Error ? error.message : String(error);
    });
    worker.on("exit", code => {
        if (accountCleanupWorker === worker)
            accountCleanupWorker = null;
        if (planReceived)
            return;
        if (!accountCleanupJob || accountCleanupJob.jobId !== jobId || accountCleanupJob.status !== "running")
            return;
        if (cleanupClosing()) {
            interruptCleanup(job);
            return;
        }
        accountCleanupJob.status = "failed";
        accountCleanupJob.finishedAt = new Date().toISOString();
        accountCleanupJob.error = `Cleanup worker exited before completion (code ${code})`;
        accountCleanupJob.workerThreadId = null;
    });
    return job;
}
const routes = (fastify) => __awaiter(void 0, void 0, void 0, function* () {
    fastify.addHook("onClose", () => __awaiter(void 0, void 0, void 0, function* () {
        accountCleanupClosing = true;
        if (accountCleanupWorker) {
            yield accountCleanupWorker.terminate();
        }
        yield accountCleanupWorkerExit;
        yield accountCleanupExecution;
    }));
    fastify.post("/databaseBackup", (_request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        const backup = yield (0, admin_database_backup_1.createFullDatabaseBackup)("manual-full");
        let removedBackups = [];
        let backupCleanupError = null;
        try {
            removedBackups = removeExpiredManualDatabaseBackups(path_1.default.dirname(backup.directory));
        }
        catch (error) {
            backupCleanupError = error instanceof Error ? error.message : String(error);
        }
        return reply.send({
            ok: true,
            backup: `.database/admin-backups/${backup.name}`,
            retainedBackups: MANUAL_DATABASE_BACKUP_KEEP_COUNT,
            removedBackups: removedBackups.length,
            backupCleanupError,
        });
    }));
    fastify.get("/status", (_request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        const root = process.cwd();
        const cdnDir = process.env.CDN_DIR || ".cdn";
        const cdnRoot = path_1.default.isAbsolute(cdnDir) ? path_1.default.join(cdnDir, "cn") : path_1.default.join(root, cdnDir, "cn");
        const archiveSummary = (0, zip_summary_cache_1.getZipFileSummary)(cdnRoot);
        const activePatchSummary = (0, zip_summary_cache_1.getZipFileSummary)(path_1.default.join(root, "assets", "asset-patch", "active"));
        const patchManifest = (0, version_1.getPatchManifest)();
        const enabledPatches = patchManifest.patches.filter(p => p.enabled);
        const detectedVersion = (0, version_1.detectCDNVersion)();
        const effectiveVersion = (0, version_1.getEffectiveVersion)();
        return reply.status(200).send({
            server: {
                uptimeSeconds: Math.floor(process.uptime()),
                onlinePlayers: (0, online_presence_1.getOnlinePlayerCount)(),
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
                    fullVersion: version_1.FULL_BASE,
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
                fullVersion: version_1.FULL_BASE,
                detectedVersion,
                effectiveVersion,
                manifestVersion: patchManifest.cdn_version,
                enabledPatchCount: enabledPatches.length,
                totalPatchCount: patchManifest.patches.length,
                activePatchArchiveCount: activePatchSummary.count,
            },
        });
    }));
    fastify.get("/currentTime", (_request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        const date = (0, utils_1.getServerDate)();
        return reply.status(200).send({
            servertime: (0, utils_1.getServerTime)(),
            date: date.toISOString(),
            isCustom: date.getTime() !== Date.now()
        });
    }));
    fastify.get("/resetTime", (_request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        (0, utils_1.setServerTime)(null);
        (0, activeAccount_1.saveTimeOffset)(null);
        return reply.status(200).send({
            servertime: (0, utils_1.getServerTime)(),
            date: (0, utils_1.getServerDate)().toISOString(),
            isCustom: false
        });
    }));
    fastify.get("/time", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        const newTime = request.query.time;
        if (!newTime)
            return reply.status(400).send({
                "error": "Bad Request",
                "message": "Missing 'time' parameter. Use format: 2025-06-01T12:00:00"
            });
        try {
            let dateStr = newTime;
            if (!dateStr.includes('T')) {
                dateStr = dateStr + 'T00:00:00';
            }
            if (!dateStr.includes('Z') && !dateStr.includes('+') && !dateStr.includes('-', 10)) {
                dateStr = dateStr + 'Z';
            }
            const time = new Date(dateStr);
            if (isNaN(time.getTime())) {
                return reply.status(400).send({
                    "error": "Bad Request",
                    "message": `Invalid time format: "${newTime}". Use ISO format.`
                });
            }
            (0, utils_1.setServerTime)(time);
            (0, activeAccount_1.saveTimeOffset)((0, utils_1.getTimeOffset)());
            return reply.status(200).send({
                servertime: (0, utils_1.getServerTime)(),
                date: (0, utils_1.getServerDate)().toISOString(),
                isCustom: true
            });
        }
        catch (error) {
            return reply.status(500).send({
                "error": "Internal Server Error",
                "message": (_a = error === null || error === void 0 ? void 0 : error.message) !== null && _a !== void 0 ? _a : "Unknown error"
            });
        }
    }));
    fastify.get("/clairvoyance/gacha", (_request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        const patchManifest = (0, version_1.getPatchManifest)();
        return reply.status(200).send(Object.assign({ cdnVersion: patchManifest.cdn_version, baseline: "fixed-cn-final" }, (0, admin_clairvoyance_1.buildShortUpCharacterGachaTimeline)((0, utils_1.getServerDate)())));
    }));
    // === Account list (JSON, for admin SPA) ===
    fastify.get("/accounts", (_request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        var _b, _c;
        const loginByAccount = (0, player_login_1.playerLoginAdminOverview)();
        const accounts = (0, account_1.getAllAccountsSync)();
        const selection = (0, activeAccount_1.getAdminPlayerSelectionState)();
        const activePlayerId = selection.activePlayerId;
        const playersByAccount = new Map();
        for (const player of (0, admin_player_1.getAllAdminPlayerSummariesSync)()) {
            const players = (_b = playersByAccount.get(player.accountId)) !== null && _b !== void 0 ? _b : [];
            players.push(player);
            playersByAccount.set(player.accountId, players);
        }
        const bindingsByAccount = new Map();
        for (const binding of (0, session_1.getAllDeviceBindingsSync)()) {
            const bindings = (_c = bindingsByAccount.get(binding.account_id)) !== null && _c !== void 0 ? _c : [];
            bindings.push({ deviceId: binding.device_id });
            bindingsByAccount.set(binding.account_id, bindings);
        }
        const viewerIdByAccount = new Map();
        for (const session of (0, session_1.getAllViewerSessionsSync)()) {
            if (!viewerIdByAccount.has(session.accountId)) {
                viewerIdByAccount.set(session.accountId, session.token);
            }
        }
        const latestTransfers = (0, db_1.getDb)().prepare(`
            SELECT transfer.target_account_id, transfer.source_viewer_id,
                   transfer.old_device_id, transfer.new_device_id,
                   transfer.source_player_count, transfer.transferred_at, transfer.source
            FROM account_transfer_audit AS transfer
            JOIN (
                SELECT target_account_id, MAX(id) AS latest_id
                FROM account_transfer_audit
                GROUP BY target_account_id
            ) AS latest ON latest.latest_id = transfer.id
        `).all();
        const latestTransferByAccount = new Map(latestTransfers.map(transfer => [transfer.target_account_id, transfer]));
        const result = accounts.map(acc => {
            var _a, _b, _c, _d, _e, _f, _g;
            const players = (_a = playersByAccount.get(acc.id)) !== null && _a !== void 0 ? _a : [];
            const playerIds = players.map(player => player.id);
            const savedDefaultPid = selection.defaultPlayers[acc.id];
            const defaultPid = savedDefaultPid && playerIds.includes(savedDefaultPid)
                ? savedDefaultPid
                : ((_b = playerIds[0]) !== null && _b !== void 0 ? _b : null);
            const defaultPlayer = players.find(player => player.id === defaultPid);
            const latestTransfer = latestTransferByAccount.get(acc.id);
            return {
                id: acc.id,
                viewerId: (_c = viewerIdByAccount.get(acc.id)) !== null && _c !== void 0 ? _c : null,
                note: (_d = acc.adminNote) !== null && _d !== void 0 ? _d : null,
                loginUsername: acc.username || null,
                playerLogin: (_e = loginByAccount.get(acc.id)) !== null && _e !== void 0 ? _e : { bound: false, boundAt: null, sessionExpiresAt: null },
                takeoverConfigured: Boolean(acc.takeoverPassword),
                latestTransfer: latestTransfer ? {
                    abolishedViewerId: latestTransfer.source_viewer_id,
                    oldDeviceId: latestTransfer.old_device_id,
                    newDeviceId: latestTransfer.new_device_id,
                    discardedSaveCount: latestTransfer.source_player_count,
                    transferredAt: latestTransfer.transferred_at,
                    source: latestTransfer.source,
                } : null,
                bindings: (_f = bindingsByAccount.get(acc.id)) !== null && _f !== void 0 ? _f : [],
                saveCount: playerIds.length,
                defaultPlayerId: defaultPid,
                defaultPlayerName: (_g = defaultPlayer === null || defaultPlayer === void 0 ? void 0 : defaultPlayer.name) !== null && _g !== void 0 ? _g : null,
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
                    };
                }),
                playerIds
            };
        });
        return reply.send(result);
    }));
    // === Default save template (admin-uploaded, applied when a new save is created) ===
    // 查询当前默认存档模板信息
    fastify.get("/defaultSave", (_request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        return reply.send((0, defaultSave_1.getDefaultSaveMeta)());
    }));
    // 上传默认存档模板（multipart，快照格式同 GET /api/player/save 导出）
    fastify.post("/defaultSave", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        var _d;
        try {
            const file = yield request.file();
            if (!file)
                return reply.status(400).send({ error: "未选择文件" });
            const buffer = yield file.toBuffer();
            if (buffer.length > MAX_SAVE_TEMPLATE_UPLOAD_BYTES) {
                return reply.status(400).send({ error: `存档超过 ${MAX_SAVE_TEMPLATE_UPLOAD_BYTES / 1024 / 1024} MB 安全上限` });
            }
            const text = buffer.toString("utf-8");
            let parsed;
            try {
                parsed = JSON.parse(text);
            }
            catch (_e) {
                return reply.status(400).send({ error: "文件不是有效的 JSON" });
            }
            if (!parsed || typeof parsed !== "object" || parsed.schema !== "starpoint-cn-save")
                return reply.status(400).send({ error: "不是有效的存档快照（请使用本面板导出的存档）" });
            if (!(0, player_snapshot_1.isPlayerSaveSnapshotV2)(parsed))
                return reply.status(400).send({ error: "仅支持 V2 完整存档；旧版 V1 存档与当前数据库结构不兼容" });
            (0, player_snapshot_1.validatePlayerSaveSnapshotV2Sync)(parsed);
            (0, defaultSave_1.saveDefaultSaveTemplate)(parsed);
            return reply.send(Object.assign({ ok: true }, (0, defaultSave_1.getDefaultSaveMeta)()));
        }
        catch (e) {
            if ((e === null || e === void 0 ? void 0 : e.code) === "FST_REQ_FILE_TOO_LARGE") {
                return reply.status(413).send({ error: `存档超过 ${MAX_SAVE_TEMPLATE_UPLOAD_BYTES / 1024 / 1024} MB 安全上限` });
            }
            return reply.status(500).send({ error: (_d = e === null || e === void 0 ? void 0 : e.message) !== null && _d !== void 0 ? _d : "上传失败" });
        }
    }));
    // 清除默认存档模板
    fastify.delete("/defaultSave", (_request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        const removed = (0, defaultSave_1.clearDefaultSaveTemplate)();
        return reply.send({ ok: true, removed });
    }));
    // === Account & Save management (device-binding based) ===
    // Select account to view saves
    fastify.post("/selectAccount", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        const { accountId } = (request.query || {});
        const aid = parseInt(accountId);
        if (isNaN(aid)) {
            if ((0, http_1.wantsJson)(request))
                return reply.status(400).send({ error: "Invalid accountId" });
            return reply.redirect('/player');
        }
        (0, activeAccount_1.setSelectedAccountId)(aid);
        if ((0, http_1.wantsJson)(request))
            return reply.send({ ok: true, accountId: aid });
        return reply.redirect('/player');
    }));
    // Switch active save
    fastify.post("/activateSave", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        const { playerId } = (request.query || {});
        const pid = parseInt(playerId);
        if (isNaN(pid)) {
            if ((0, http_1.wantsJson)(request))
                return reply.status(400).send({ error: "Invalid playerId" });
            return reply.redirect('/player');
        }
        (0, activeAccount_1.setActivePlayerId)(pid);
        const allAccounts = (0, account_1.getAllAccountsSync)();
        for (const a of allAccounts) {
            if ((0, account_1.getAccountPlayersSync)(a.id).includes(pid)) {
                (0, activeAccount_1.saveAccountDefaultPlayer)(a.id, pid);
                break;
            }
        }
        if ((0, http_1.wantsJson)(request))
            return reply.send({ ok: true, playerId: pid });
        return reply.redirect('/player');
    }));
    // Create new empty save under the given account
    fastify.post("/newSave", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        var _f;
        const { accountId: aid } = (request.query || {});
        const accId = parseInt(aid);
        if (isNaN(accId)) {
            if ((0, http_1.wantsJson)(request))
                return reply.status(400).send({ error: "Invalid accountId" });
            return reply.redirect('/player');
        }
        const player = (0, persistence_coordinator_1.runPersistenceTransactionSync)({
            domain: "admin", operation: "admin_create_save",
        }, () => (0, player_1.insertDefaultPlayerSync)(accId));
        // 若管理员配置了默认存档模板，用它替换新建的空存档
        let appliedTemplate = false;
        try {
            const template = (0, defaultSave_1.loadDefaultSaveTemplate)();
            if (template !== null) {
                if (!(0, player_snapshot_1.isPlayerSaveSnapshotV2)(template)) {
                    throw new Error("默认存档模板不是受支持的 V2 完整存档，请重新上传");
                }
                const snapshot = (0, player_snapshot_1.validatePlayerSaveSnapshotV2Sync)(template);
                (0, persistence_coordinator_1.runPersistenceTransactionSync)({
                    domain: "admin", playerId: player.id, operation: "admin_apply_save_template_v2",
                }, () => (0, player_snapshot_1.restorePlayerSaveSnapshotV2Sync)(snapshot, player.id, {
                    includeArchiveHistory: false,
                }));
                appliedTemplate = true;
            }
        }
        catch (error) {
            try {
                (0, persistence_coordinator_1.runPersistenceTransactionSync)({
                    domain: "admin", playerId: player.id, operation: "admin_rollback_new_save",
                }, () => (0, player_1.deletePlayerSync)(player.id));
            }
            catch ( /* preserve template error */_g) { /* preserve template error */ }
            const message = `默认存档应用失败，未创建新存档：${(_f = error === null || error === void 0 ? void 0 : error.message) !== null && _f !== void 0 ? _f : error}`;
            if ((0, http_1.wantsJson)(request))
                return reply.status(409).send({ error: message });
            return reply.redirect(`/player?error=${encodeURIComponent(message)}`);
        }
        (0, activeAccount_1.setActivePlayerId)(player.id);
        (0, activeAccount_1.saveAccountDefaultPlayer)(accId, player.id);
        if ((0, http_1.wantsJson)(request))
            return reply.send({ ok: true, playerId: player.id, appliedTemplate });
        return reply.redirect('/player');
    }));
    // Delete a save
    fastify.post("/deleteSave", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        const { playerId } = (request.query || {});
        const pid = parseInt(playerId);
        if (isNaN(pid)) {
            if ((0, http_1.wantsJson)(request))
                return reply.status(400).send({ error: "Invalid playerId" });
            return reply.redirect('/player');
        }
        const allAccounts = (0, account_1.getAllAccountsSync)();
        let accountId = 0;
        for (const a of allAccounts) {
            if ((0, account_1.getAccountPlayersSync)(a.id).includes(pid)) {
                accountId = a.id;
                break;
            }
        }
        if (accountId && (0, account_1.getAccountPlayersSync)(accountId).length <= 1) {
            const deletedPlayerIds = (0, persistence_coordinator_1.runPersistenceTransactionSync)({
                domain: "admin", operation: `admin_delete_save_account:${accountId}`,
            }, () => deleteAccountDataSync(accountId));
            (0, activeAccount_1.removeDeletedAccountFromState)(accountId, deletedPlayerIds);
            yield cleanupDeletedPlayerAiSnapshots(deletedPlayerIds, `save ${pid} and account ${accountId} deletion`);
        }
        else {
            (0, persistence_coordinator_1.runPersistenceTransactionSync)({
                domain: "admin", playerId: pid, operation: "admin_delete_save",
            }, () => (0, player_1.deletePlayerSync)(pid));
            yield cleanupDeletedPlayerAiSnapshots([pid], `save ${pid} deletion`);
            const remainingPlayerIds = (0, account_1.getAccountPlayersSync)(accountId);
            if ((0, activeAccount_1.getAccountDefaultPlayer)(accountId) === pid && remainingPlayerIds.length > 0) {
                (0, activeAccount_1.saveAccountDefaultPlayer)(accountId, remainingPlayerIds[0]);
            }
        }
        const accountAlsoDeleted = accountId && (0, account_1.getAccountPlayersSync)(accountId).length === 0;
        if ((0, activeAccount_1.getActivePlayerId)() === pid)
            (0, activeAccount_1.setActivePlayerId)(null);
        if ((0, http_1.wantsJson)(request))
            return reply.send({ ok: true, deleted: pid, accountAlsoDeleted: !!accountAlsoDeleted });
        return reply.redirect('/player');
    }));
    // Delete entire account + all saves + device binding
    fastify.post("/deleteAccount", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        const { id } = (request.query || {});
        const accountId = parseInt(id);
        if (isNaN(accountId))
            return reply.status(400).send({ error: "Missing or invalid 'id'" });
        const playerIds = (0, persistence_coordinator_1.runPersistenceTransactionSync)({
            domain: "admin", operation: `admin_delete_account:${accountId}`,
        }, () => deleteAccountDataSync(accountId));
        (0, activeAccount_1.removeDeletedAccountFromState)(accountId, playerIds);
        yield cleanupDeletedPlayerAiSnapshots(playerIds, `account ${accountId} deletion`);
        if ((0, http_1.wantsJson)(request))
            return reply.send({ ok: true, accountId, deletedSaves: playerIds.length });
        return reply.redirect('/player');
    }));
    fastify.get("/deleteUnnotedAccounts/status", (_request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        return reply.send(accountCleanupJob !== null && accountCleanupJob !== void 0 ? accountCleanupJob : {
            ok: true,
            status: "idle",
        });
    }));
    // Only account notes determine eligibility, including bound and selected accounts.
    fastify.post("/deleteUnnotedAccounts", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        (0, shutdown_state_1.assertServerAcceptingWork)();
        if (accountCleanupClosing)
            throw new shutdown_state_1.ServerClosingError();
        const body = (request.body || {});
        if (body.confirm !== "DELETE_UNNOTED_ACCOUNTS") {
            return reply.status(400).send({ error: "Confirmation token is required" });
        }
        if ((accountCleanupJob === null || accountCleanupJob === void 0 ? void 0 : accountCleanupJob.status) === "running" || accountCleanupExecution || accountCleanupWorker) {
            return reply.status(409).send({
                error: "An account cleanup job is already running",
                job: accountCleanupJob,
            });
        }
        const accounts = (0, account_1.getAllAccountsSync)();
        const accountIds = (0, admin_account_cleanup_1.selectUnnotedAccountIds)(accounts);
        if (accountIds.length === 0) {
            const now = new Date().toISOString();
            accountCleanupJob = {
                ok: true,
                jobId: (0, crypto_1.randomUUID)(),
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
            };
            return reply.send(accountCleanupJob);
        }
        try {
            const job = startAccountCleanupWorker(accountIds);
            return reply.status(202).send(job);
        }
        catch (error) {
            accountCleanupJob = null;
            return reply.status(500).send({
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }));
    // Rename a save
    fastify.post("/renameSave", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        const body = request.body || {};
        const playerId = parseInt(body.playerId);
        const name = body.name;
        if (isNaN(playerId) || !name)
            return reply.status(400).send({ error: "Missing params" });
        (0, persistence_coordinator_1.runPersistenceTransactionSync)({
            domain: "admin", playerId, operation: "rename_save",
        }, () => (0, player_1.updatePlayerSync)({ id: playerId, name: String(name) }));
        if ((0, http_1.wantsJson)(request))
            return reply.send({ ok: true, playerId, name: String(name) });
        return reply.redirect('/player');
    }));
    // Clone a save to another account
    fastify.post("/cloneSave", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        var _h, _j;
        const { playerId: pid, accountId: aid } = (request.query || {});
        const playerId = parseInt(pid);
        const accountId = parseInt(aid);
        if (isNaN(playerId) || isNaN(accountId)) {
            if ((0, http_1.wantsJson)(request))
                return reply.status(400).send({ error: "Invalid playerId or accountId" });
            return reply.redirect('/player');
        }
        if (!(0, player_1.getPlayerSync)(playerId)) {
            if ((0, http_1.wantsJson)(request))
                return reply.status(404).send({ error: "Source player not found" });
            return reply.redirect('/player');
        }
        let snapshot;
        try {
            snapshot = (0, player_snapshot_1.createPlayerSaveSnapshotV2Sync)(playerId);
        }
        catch (error) {
            if ((0, http_1.wantsJson)(request))
                return reply.status(500).send({ error: `克隆前导出失败：${(_h = error === null || error === void 0 ? void 0 : error.message) !== null && _h !== void 0 ? _h : error}` });
            return reply.redirect('/player');
        }
        let newPlayerId = 0;
        let restored;
        try {
            ({ newPlayerId, restored } = (0, persistence_coordinator_1.runPersistenceTransactionSync)({
                domain: "admin", operation: "clone_save",
            }, () => {
                const newPlayer = (0, player_1.insertDefaultPlayerSync)(accountId);
                try {
                    return {
                        newPlayerId: newPlayer.id,
                        restored: (0, player_snapshot_1.restorePlayerSaveSnapshotV2Sync)(snapshot, newPlayer.id, {
                            includeArchiveHistory: false,
                        }),
                    };
                }
                catch (error) {
                    try {
                        (0, player_1.deletePlayerSync)(newPlayer.id);
                    }
                    catch ( /* preserve original clone error */_a) { /* preserve original clone error */ }
                    throw error;
                }
            }));
        }
        catch (error) {
            if ((0, http_1.wantsJson)(request))
                return reply.status(500).send({ error: `克隆恢复失败：${(_j = error === null || error === void 0 ? void 0 : error.message) !== null && _j !== void 0 ? _j : error}` });
            return reply.redirect('/player');
        }
        (0, activeAccount_1.setActivePlayerId)(newPlayerId);
        (0, activeAccount_1.saveAccountDefaultPlayer)(accountId, newPlayerId);
        if ((0, http_1.wantsJson)(request))
            return reply.send({ ok: true, newPlayerId, snapshotVersion: 2, restored });
        return reply.redirect('/player');
    }));
    // Account-scoped note: it survives device replacement and account recovery.
    fastify.post("/account/rename", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        const body = request.body;
        const accountId = Number(body === null || body === void 0 ? void 0 : body.account_id);
        if (!Number.isSafeInteger(accountId) || accountId <= 0) {
            return reply.status(400).send({ error: "Missing account_id" });
        }
        const account = (0, account_1.getAllAccountsSync)().find(candidate => candidate.id === accountId);
        if (!account)
            return reply.status(404).send({ error: "Account not found" });
        const note = typeof body.name === "string" ? body.name.trim().slice(0, 100) : "";
        (0, persistence_coordinator_1.runPersistenceTransactionSync)({
            domain: "admin", operation: "rename_account",
        }, () => (0, account_1.updateAccountSync)({ id: accountId, adminNote: note || null }));
        return reply.status(200).send({ ok: true, accountId, note: note || null });
    }));
    fastify.post("/account/takeover-password/reset", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        const body = request.body;
        const accountId = Number(body === null || body === void 0 ? void 0 : body.account_id);
        if (!Number.isSafeInteger(accountId) || accountId <= 0) {
            return reply.status(400).send({ error: "Missing account_id" });
        }
        if (body.confirm !== "RESET_TAKEOVER_PASSWORD") {
            return reply.status(400).send({ error: "Confirmation token is required" });
        }
        if ((0, player_login_1.playerLoginManaged)(accountId)) {
            return reply.status(409).send({ error: "该存档已绑定登录账号，请生成登录密码重置码。旧继承密码不能恢复已绑定账号。" });
        }
        const account = (0, account_1.getAllAccountsSync)().find(candidate => candidate.id === accountId);
        if (!account)
            return reply.status(404).send({ error: "Account not found" });
        const replacementPassword = `R${(0, crypto_1.randomBytes)(6).toString("hex")}a1`;
        (0, persistence_coordinator_1.runPersistenceTransactionSync)({
            domain: "admin", operation: "reset_takeover_password",
        }, () => (0, account_1.updateAccountSync)({ id: accountId, takeoverPassword: replacementPassword }));
        const viewerSession = (0, session_1.getSessionByAccountIdSync)(accountId, types_1.SessionType.VIEWER);
        if (viewerSession)
            (0, takeOver_1.clearRecoveryFailuresForViewer)(viewerSession.token);
        // Return the replacement once; account listing never exposes stored passwords.
        return reply.status(200).send({ ok: true, accountId, replacementPassword });
    }));
    // Backward-compatible endpoint for old admin pages. Resolve the device,
    // but write the authoritative account-scoped note.
    fastify.post("/device/rename", (request, reply) => __awaiter(void 0, void 0, void 0, function* () {
        const body = request.body;
        const deviceId = body.device_id;
        if (!deviceId)
            return reply.status(400).send({ error: "Missing device_id" });
        const binding = (0, session_1.getDeviceBindingSync)(deviceId);
        if (!binding)
            return reply.status(404).send({ error: "Device binding not found" });
        const note = typeof body.name === "string" ? body.name.trim().slice(0, 100) : "";
        (0, persistence_coordinator_1.runPersistenceTransactionSync)({
            domain: "admin", operation: "rename_device_account",
        }, () => (0, account_1.updateAccountSync)({ id: binding.account_id, adminNote: note || null }));
        return reply.status(200).send({ ok: true });
    }));
});
exports.default = routes;
