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
var __asyncValues = (this && this.__asyncValues) || function (o) {
    if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
    var m = o[Symbol.asyncIterator], i;
    return m ? m.call(o) : (o = typeof __values === "function" ? __values(o) : o[Symbol.iterator](), i = {}, verb("next"), verb("throw"), verb("return"), i[Symbol.asyncIterator] = function () { return this; }, i);
    function verb(n) { i[n] = o[n] && function (v) { return new Promise(function (resolve, reject) { v = o[n](v), settle(resolve, reject, v.done, v.value); }); }; }
    function settle(resolve, reject, d, v) { Promise.resolve(v).then(function(v) { resolve({ value: v, done: d }); }, reject); }
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.unlockUnstartedMaintenance = exports.completeMaintenance = exports.releaseMaintenance = exports.rollbackMaintenance = exports.applyMaintenance = exports.previewMaintenance = exports.maintenancePaths = void 0;
/** Offline maintenance CLI. Deliberately never imports data/db or server startup. */
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const crypto_1 = require("crypto");
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
const atomic_json_file_1 = require("./lib/atomic-json-file");
const storage_layout_1 = require("./lib/storage-layout");
const maintenance_state_1 = require("./lib/maintenance-state");
const receive_history_retention_1 = require("./lib/receive-history-retention");
function maintenancePaths(project = path_1.default.resolve(__dirname, "..")) {
    const root = (0, fs_1.realpathSync)(project);
    const dataDir = (0, fs_1.realpathSync)(process.env.DATA_DIR ? path_1.default.resolve(root, process.env.DATA_DIR) : path_1.default.join(root, ".database"));
    return { project: root, database: path_1.default.join(dataDir, "wdfp_data.db"), lock: path_1.default.join(dataDir, "storage-maintenance.lock"),
        state: path_1.default.join(dataDir, "storage-maintenance-state.json"), backups: path_1.default.join(dataDir, "maintenance-backups") };
}
exports.maintenancePaths = maintenancePaths;
function sha256(file) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, e_1, _b, _c;
        const hash = (0, crypto_1.createHash)("sha256");
        try {
            for (var _d = true, _e = __asyncValues((0, fs_1.createReadStream)(file)), _f; _f = yield _e.next(), _a = _f.done, !_a; _d = true) {
                _c = _f.value;
                _d = false;
                const chunk = _c;
                hash.update(chunk);
            }
        }
        catch (e_1_1) { e_1 = { error: e_1_1 }; }
        finally {
            try {
                if (!_d && !_a && (_b = _e.return)) yield _b.call(_e);
            }
            finally { if (e_1) throw e_1.error; }
        }
        return hash.digest("hex");
    });
}
function loadState(paths) {
    const state = JSON.parse((0, fs_1.readFileSync)(paths.state, "utf8"));
    const backupRoot = path_1.default.resolve(paths.backups);
    const directory = path_1.default.dirname(path_1.default.resolve(state.backup));
    if (state.format !== 1 || state.database !== paths.database || path_1.default.dirname(directory) !== backupRoot || path_1.default.basename(directory) !== state.id
        || !/^storage-\d{8}T\d{9}Z-[a-f0-9-]{36}$/.test(state.id) || path_1.default.basename(state.backup) !== "wdfp_data.db") {
        throw new Error("维护状态与当前数据库不匹配");
    }
    return state;
}
function saveState(paths, state, phase) {
    state.phase = phase;
    (0, atomic_json_file_1.writeJsonAtomicSync)(paths.state, state);
    (0, atomic_json_file_1.writeJsonAtomicSync)(path_1.default.join(path_1.default.dirname(state.backup), "report.json"), state);
}
function databaseStats(db) {
    return { pageCount: db.pragma("page_count", { simple: true }), freePages: db.pragma("freelist_count", { simple: true }),
        pageSize: db.pragma("page_size", { simple: true }), layoutVersion: (0, storage_layout_1.getStorageLayoutVersion)(db),
        objects: db.prepare("SELECT name,SUM(pgsize) bytes FROM dbstat GROUP BY name ORDER BY bytes DESC").all() };
}
function previewMaintenance(paths) {
    var _a;
    const versionFile = paths.database + ".version";
    if (!(0, fs_1.existsSync)(versionFile))
        throw new Error("缺少 wdfp_data.db.version，不能确认基础数据库版本，未执行维护");
    const databaseVersion = Number((0, fs_1.readFileSync)(versionFile, "utf8").trim());
    if (databaseVersion !== storage_layout_1.WDFP_DATA_VERSION)
        throw new Error(`基础数据库版本 ${databaseVersion} 与维护工具要求 ${storage_layout_1.WDFP_DATA_VERSION} 不一致`);
    const db = new better_sqlite3_1.default(paths.database, { readonly: true, fileMustExist: true });
    try {
        db.pragma("query_only=ON");
        (0, storage_layout_1.assertStorageLayout)(db);
        const settings = db.prepare("SELECT 1 FROM sqlite_master WHERE name='server_maintenance_settings'").get();
        const policy = settings ? (0, maintenance_state_1.readHistoryPolicy)(db) : maintenance_state_1.DEFAULT_HISTORY_POLICY;
        const cutoff = new Date(Date.now() - policy.maxDays * 86400000).toISOString();
        const candidates = db.prepare(`SELECT COUNT(*) n FROM (SELECT create_time,
            ROW_NUMBER() OVER(PARTITION BY player_id ORDER BY create_time DESC,id DESC) position FROM players_receive_history)
            WHERE position>? OR julianday(create_time)<julianday(?)`).get(policy.maxRows, cutoff);
        const size = (0, fs_1.statSync)(paths.database).size;
        const logicalBytes = Number(db.pragma("page_count", { simple: true })) * Number(db.pragma("page_size", { simple: true }));
        const fs = (0, fs_1.statfsSync)(path_1.default.dirname(paths.database));
        const available = Number(fs.bavail) * Number(fs.bsize);
        return { database: paths.database, databaseVersion, lock: paths.lock, state: paths.state, backups: paths.backups, bytes: size,
            logicalBytes, availableBytes: available, requiredAdditionalBytes: Math.max(size, logicalBytes) * 3 + 256 * 1024 * 1024,
            policy, automaticRetentionEnabled: (0, receive_history_retention_1.isReceiveHistoryRetentionEnabled)(), historyDeletionCandidates: candidates.n, locked: (0, fs_1.existsSync)(paths.lock),
            port: Number((_a = process.env.CN_LISTEN_PORT) !== null && _a !== void 0 ? _a : 8001), stats: databaseStats(db) };
    }
    finally {
        db.close();
    }
}
exports.previewMaintenance = previewMaintenance;
function openExclusive(paths) {
    const db = new better_sqlite3_1.default(paths.database, { fileMustExist: true, timeout: 1000 });
    try {
        db.pragma("temp_store=FILE");
        db.pragma("locking_mode=EXCLUSIVE");
        db.exec("BEGIN EXCLUSIVE; COMMIT");
        return db;
    }
    catch (error) {
        db.close();
        throw error;
    }
}
function applyMaintenance(paths_1) {
    return __awaiter(this, arguments, void 0, function* (paths, checkpoint = () => { }) {
        if ((0, fs_1.existsSync)(paths.state)) {
            const previous = loadState(paths);
            if (!["completed", "rolled-back"].includes(previous.phase))
                throw new Error(`上次维护尚未结束（${previous.phase}），请使用恢复入口`);
        }
        const preview = previewMaintenance(paths);
        if (!preview.automaticRetentionEnabled)
            throw new Error("RECEIVE_HISTORY_RETENTION_ENABLED 已关闭自动维护；请先检查该配置，当前不会覆盖原有开关");
        if (preview.availableBytes < preview.requiredAdditionalBytes)
            throw new Error("磁盘空间不足以同时保留备份、迁移临时数据和空间回收文件");
        const descriptor = (0, fs_1.openSync)(paths.lock, "wx");
        (0, fs_1.writeFileSync)(descriptor, JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString(), database: paths.database }));
        (0, fs_1.fsyncSync)(descriptor);
        (0, fs_1.closeSync)(descriptor);
        let db;
        let state;
        try {
            db = openExclusive(paths);
            (0, storage_layout_1.assertStorageLayout)(db);
            if (db.pragma("quick_check", { simple: true }) !== "ok")
                throw new Error("数据库检查失败，未执行迁移");
            const id = `storage-${new Date().toISOString().replace(/[-:.]/g, "")}-${(0, crypto_1.randomUUID)()}`;
            const directory = path_1.default.join(paths.backups, id);
            (0, fs_1.mkdirSync)(directory, { recursive: true });
            state = { format: 1, id, database: paths.database, phase: "backing-up", createdAt: new Date().toISOString(),
                backup: path_1.default.join(directory, "wdfp_data.db"), layoutBefore: (0, storage_layout_1.getStorageLayoutVersion)(db), before: preview };
            saveState(paths, state, "backing-up");
            yield db.backup(state.backup);
            const backupDb = new better_sqlite3_1.default(state.backup, { fileMustExist: true });
            try {
                backupDb.pragma("journal_mode=DELETE");
                if (backupDb.pragma("quick_check", { simple: true }) !== "ok")
                    throw new Error("备份完整性检查失败");
            }
            finally {
                backupDb.close();
            }
            state.backupSha256 = yield sha256(state.backup);
            for (const name of ["wdfp_data.db.version", "active_account.json"]) {
                const source = path_1.default.join(path_1.default.dirname(paths.database), name);
                if ((0, fs_1.existsSync)(source))
                    (0, fs_1.copyFileSync)(source, path_1.default.join(directory, name));
            }
            saveState(paths, state, "migrating");
            checkpoint("backup-verified");
            state.migration = (0, storage_layout_1.migrateStorageLayout)(db, checkpoint);
            saveState(paths, state, "retaining-history");
            (0, maintenance_state_1.initializeMaintenanceState)(db);
            const lease = (0, maintenance_state_1.acquireHistoryLease)(db);
            if (!lease)
                throw new Error("数据库仍有历史清理任务租约，稍后恢复维护，避免重叠运行");
            try {
                const result = yield (0, receive_history_retention_1.runReceiveHistoryRetentionPass)(db, Object.assign(Object.assign({}, (0, maintenance_state_1.readHistoryPolicy)(db)), { pauseMs: 0 }), () => { (0, maintenance_state_1.refreshHistoryLease)(db, lease); return false; });
                (0, maintenance_state_1.finishHistoryLease)(db, lease, result, result.failedPlayers === 0 && !result.stopped);
                state.retention = result;
                if (result.failedPlayers > 0 || result.stopped)
                    throw new Error("领取历史维护未完整完成");
            }
            catch (error) {
                (0, maintenance_state_1.finishHistoryLease)(db, lease, undefined, false, String(error));
                throw error;
            }
            saveState(paths, state, "compacting");
            checkpoint("before-vacuum");
            db.exec("VACUUM; ANALYZE");
            if (db.pragma("integrity_check", { simple: true }) !== "ok" || db.pragma("foreign_key_check").length > 0)
                throw new Error("维护后数据库完整性检查失败");
            state.after = databaseStats(db);
            db.pragma("wal_checkpoint(TRUNCATE)");
            saveState(paths, state, "ready");
            return state;
        }
        catch (error) {
            if (state) {
                state.error = error instanceof Error ? error.message : String(error);
                saveState(paths, state, "failed");
            }
            else
                (0, fs_1.unlinkSync)(paths.lock); // No data or migration has been written yet.
            throw error;
        }
        finally {
            if (db === null || db === void 0 ? void 0 : db.open)
                db.close();
        }
    });
}
exports.applyMaintenance = applyMaintenance;
function rollbackMaintenance(paths) {
    return __awaiter(this, void 0, void 0, function* () {
        const state = loadState(paths);
        if (!(0, fs_1.existsSync)(paths.lock))
            throw new Error("维护锁不存在，不能回滚可能已恢复服务的数据库");
        if (state.phase === "rollback-ready")
            return state;
        if (!["failed", "backing-up", "migrating", "retaining-history", "compacting", "ready", "restoring"].includes(state.phase)) {
            throw new Error("服务可能已重新开放写入，拒绝覆盖旧备份；请使用继续启动/状态检查");
        }
        if (!state.backupSha256) {
            // Failure before the verified backup cannot have modified game data.
            saveState(paths, state, "rollback-ready");
            return state;
        }
        if ((yield sha256(state.backup)) !== state.backupSha256)
            throw new Error("备份校验值不匹配，拒绝恢复");
        if (state.phase !== "restoring") {
            const db = openExclusive(paths);
            try {
                db.pragma("wal_checkpoint(TRUNCATE)");
                // Let SQLite remove its own WAL/SHM under the exclusive lock.
                // An SHM file can remain after a readonly connection closes; its
                // mere existence does not prove that another process is active.
                if (db.pragma("journal_mode=DELETE", { simple: true }) !== "delete")
                    throw new Error("无法独占关闭 WAL 日志");
            }
            finally {
                db.close();
            }
        }
        for (const suffix of ["-wal", "-shm"]) {
            const file = paths.database + suffix;
            if (!(0, fs_1.existsSync)(file))
                continue;
            if (suffix === "-wal" && (0, fs_1.statSync)(file).size > 0)
                throw new Error("数据库旁仍有未回收 WAL 内容，拒绝恢复");
            // journal_mode=DELETE succeeded under an exclusive lock above. Any
            // remaining SHM is now a stale index, and the WAL must be empty.
            if (path_1.default.dirname(path_1.default.resolve(file)) !== path_1.default.dirname(paths.database))
                throw new Error("数据库恢复路径越界");
            (0, fs_1.unlinkSync)(file);
        }
        saveState(paths, state, "restoring");
        const temp = paths.database + ".maintenance-restore";
        (0, fs_1.copyFileSync)(state.backup, temp);
        const descriptor = (0, fs_1.openSync)(temp, "r+");
        (0, fs_1.fsyncSync)(descriptor);
        (0, fs_1.closeSync)(descriptor);
        (0, fs_1.renameSync)(temp, paths.database);
        const verify = new better_sqlite3_1.default(paths.database, { readonly: true, fileMustExist: true });
        try {
            if (verify.pragma("quick_check", { simple: true }) !== "ok")
                throw new Error("恢复后数据库检查失败");
        }
        finally {
            verify.close();
        }
        saveState(paths, state, "rollback-ready");
        return state;
    });
}
exports.rollbackMaintenance = rollbackMaintenance;
function releaseMaintenance(paths) {
    const state = loadState(paths);
    if (!["ready", "rollback-ready", "service-starting", "rollback-starting"].includes(state.phase))
        throw new Error("维护尚未校验完成，不能启动服务");
    const rollback = state.phase.startsWith("rollback");
    saveState(paths, state, rollback ? "rollback-starting" : "service-starting");
    if ((0, fs_1.existsSync)(paths.lock))
        (0, fs_1.unlinkSync)(paths.lock);
    return state;
}
exports.releaseMaintenance = releaseMaintenance;
function completeMaintenance(paths) {
    const state = loadState(paths);
    if (!["service-starting", "rollback-starting"].includes(state.phase))
        throw new Error("维护不在启动验收阶段");
    saveState(paths, state, state.phase === "rollback-starting" ? "rolled-back" : "completed");
    pruneMaintenanceBackups(paths, state.id);
    return state;
}
exports.completeMaintenance = completeMaintenance;
/** Keep three completed backups, including the latest pre-migration baseline. */
function pruneMaintenanceBackups(paths, currentId) {
    const root = (0, fs_1.realpathSync)(paths.backups);
    const candidates = [];
    for (const entry of (0, fs_1.readdirSync)(root, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.isSymbolicLink() || !/^storage-\d{8}T\d{9}Z-[a-f0-9-]{36}$/.test(entry.name))
            continue;
        const directory = path_1.default.resolve(root, entry.name);
        if ((0, fs_1.realpathSync)(directory) !== directory)
            continue;
        try {
            const state = JSON.parse((0, fs_1.readFileSync)(path_1.default.join(directory, "report.json"), "utf8"));
            if (state.format === 1 && state.id === entry.name && state.database === paths.database && ["completed", "rolled-back"].includes(state.phase))
                candidates.push({ id: entry.name, state, directory });
        }
        catch ( /* Unknown/incomplete directories remain available for recovery. */_a) { /* Unknown/incomplete directories remain available for recovery. */ }
    }
    candidates.sort((a, b) => b.id.localeCompare(a.id));
    const keep = new Set([currentId]);
    const baseline = candidates.find(c => c.state.layoutBefore === 0 && c.state.phase === "completed");
    if (baseline)
        keep.add(baseline.id);
    for (const c of candidates) {
        if (keep.size >= 3)
            break;
        keep.add(c.id);
    }
    const allowed = new Set(["wdfp_data.db", "wdfp_data.db.version", "active_account.json", "report.json", "report.json.bak"]);
    for (const c of candidates) {
        if (keep.has(c.id))
            continue;
        const files = (0, fs_1.readdirSync)(c.directory);
        if (files.some(f => !allowed.has(f) || !(0, fs_1.lstatSync)(path_1.default.join(c.directory, f)).isFile() || (0, fs_1.lstatSync)(path_1.default.join(c.directory, f)).isSymbolicLink()))
            continue;
        // Each exact resolved target is checked within this backup directory.
        for (const f of files) {
            const target = path_1.default.resolve(c.directory, f);
            if (path_1.default.dirname(target) !== c.directory)
                throw new Error("备份路径越界");
            (0, fs_1.unlinkSync)(target);
        }
        (0, fs_1.rmdirSync)(c.directory);
    }
}
function unlockUnstartedMaintenance(paths) {
    if ((0, fs_1.existsSync)(paths.state) && !["completed", "rolled-back"].includes(loadState(paths).phase))
        throw new Error("已有未结束维护，不能直接解锁");
    if (!(0, fs_1.existsSync)(paths.lock))
        return;
    const lock = JSON.parse((0, fs_1.readFileSync)(paths.lock, "utf8"));
    if (lock.database !== paths.database || !Number.isSafeInteger(lock.pid) || lock.pid < 1)
        throw new Error("维护锁信息无效");
    let running = true;
    try {
        process.kill(lock.pid, 0);
    }
    catch (error) {
        if (error.code === "ESRCH")
            running = false;
        else
            throw error;
    }
    if (running)
        throw new Error("维护进程仍在运行，不能解锁");
    (0, fs_1.unlinkSync)(paths.lock);
}
exports.unlockUnstartedMaintenance = unlockUnstartedMaintenance;
function main() {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const command = (_a = process.argv[2]) !== null && _a !== void 0 ? _a : "preview";
        const projectArgument = process.argv.indexOf("--project");
        if (projectArgument >= 0 && !process.argv[projectArgument + 1])
            throw new Error("--project 缺少项目目录");
        const paths = maintenancePaths(projectArgument >= 0 ? process.argv[projectArgument + 1] : undefined);
        let result;
        switch (command) {
            case "preview":
                result = previewMaintenance(paths);
                break;
            case "status":
                result = (0, fs_1.existsSync)(paths.state) ? loadState(paths) : { phase: "not-started", database: paths.database };
                break;
            case "apply":
                result = yield applyMaintenance(paths, stage => console.error(`[STORAGE] ${stage}`));
                break;
            case "rollback":
                result = yield rollbackMaintenance(paths);
                break;
            case "release":
                result = releaseMaintenance(paths);
                break;
            case "complete":
                result = completeMaintenance(paths);
                break;
            case "unlock-unstarted":
                unlockUnstartedMaintenance(paths);
                result = { unlocked: true };
                break;
            default: throw new Error("支持命令：preview / apply / status / rollback / release / complete");
        }
        if (["apply", "rollback", "release", "complete"].includes(command)) {
            const state = result;
            result = { id: state.id, phase: state.phase, database: state.database, backup: state.backup, report: paths.state,
                migration: state.migration, retention: state.retention, error: state.error };
        }
        console.log(JSON.stringify(result, null, 2));
    });
}
if (require.main === module)
    void main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
