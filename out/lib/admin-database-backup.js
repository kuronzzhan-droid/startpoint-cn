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
exports.cleanupPlayerImportBackups = exports.createPlayerImportSnapshotBackup = exports.createFullDatabaseBackup = exports.getDatabaseDirectory = void 0;
const file_exists_1 = require("./file-exists");
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
const db_1 = require("../data/db");
const PLAYER_IMPORT_BACKUP_NAME = /^player-import-[1-9]\d*-\d{8}-\d{6}-\d{3}$/;
function getDatabaseDirectory() {
    return process.env.DATA_DIR
        ? path_1.default.resolve(process.env.DATA_DIR)
        : path_1.default.resolve(__dirname, "../../.database");
}
exports.getDatabaseDirectory = getDatabaseDirectory;
function createBackupStamp() {
    const now = new Date();
    const pad = (value, width = 2) => String(value).padStart(width, "0");
    return [
        `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`,
        `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`,
        pad(now.getMilliseconds(), 3),
    ].join("-");
}
function createFullDatabaseBackup(prefix_1) {
    return __awaiter(this, arguments, void 0, function* (prefix, metadata = {}) {
        if (!/^[a-z0-9-]+$/.test(prefix))
            throw new Error("Database backup prefix is invalid");
        const databaseDir = getDatabaseDirectory();
        const name = `${prefix}-${createBackupStamp()}`;
        const directory = path_1.default.join(databaseDir, "admin-backups", name);
        (0, fs_1.mkdirSync)(directory, { recursive: true });
        const versionPath = path_1.default.join(databaseDir, "wdfp_data.db.version");
        if (!(0, file_exists_1.existsSync)(versionPath)) {
            throw new Error("Database version file is missing: wdfp_data.db.version");
        }
        yield (0, db_1.getDb)().backup(path_1.default.join(directory, "wdfp_data.db"));
        (0, fs_1.copyFileSync)(versionPath, path_1.default.join(directory, "wdfp_data.db.version"));
        const statePath = path_1.default.join(databaseDir, "active_account.json");
        if ((0, file_exists_1.existsSync)(statePath))
            (0, fs_1.copyFileSync)(statePath, path_1.default.join(directory, "active_account.json"));
        (0, fs_1.writeFileSync)(path_1.default.join(directory, "backup-info.json"), JSON.stringify(Object.assign({ createdAt: new Date().toISOString(), type: prefix, database: "wdfp_data.db", databaseVersion: "wdfp_data.db.version", includesActiveAccountState: (0, file_exists_1.existsSync)(statePath) }, metadata), null, 2), "utf8");
        return { directory, name };
    });
}
exports.createFullDatabaseBackup = createFullDatabaseBackup;
function createPlayerImportSnapshotBackup(playerId, snapshot, metadata = {}) {
    if (!Number.isSafeInteger(playerId) || playerId < 1)
        throw new Error("Player ID is invalid");
    const databaseDir = getDatabaseDirectory();
    const name = `player-import-${playerId}-${createBackupStamp()}`;
    const backupRoot = path_1.default.resolve(databaseDir, "admin-backups");
    const directory = path_1.default.resolve(backupRoot, name);
    if (path_1.default.dirname(directory) !== backupRoot || !PLAYER_IMPORT_BACKUP_NAME.test(name)) {
        throw new Error("Player-import backup path is invalid");
    }
    (0, fs_1.mkdirSync)(backupRoot, { recursive: true });
    (0, fs_1.mkdirSync)(directory);
    try {
        (0, fs_1.writeFileSync)(path_1.default.join(directory, "player-save.json"), JSON.stringify(snapshot), "utf8");
        (0, fs_1.writeFileSync)(path_1.default.join(directory, "backup-info.json"), JSON.stringify(Object.assign({ createdAt: new Date().toISOString(), type: "player-import", targetPlayerId: playerId, backupScope: "player-archive", snapshot: "player-save.json", snapshotVersion: 2, includesFullDatabase: false }, metadata), null, 2), "utf8");
    }
    catch (error) {
        if (path_1.default.dirname(directory) === backupRoot && PLAYER_IMPORT_BACKUP_NAME.test(name)) {
            (0, fs_1.rmSync)(directory, { recursive: true, force: true });
        }
        throw error;
    }
    return { directory, name };
}
exports.createPlayerImportSnapshotBackup = createPlayerImportSnapshotBackup;
function cleanupPlayerImportBackups(currentBackupDirectory, keepCount = 5) {
    if (!Number.isSafeInteger(keepCount) || keepCount < 1 || keepCount > 100) {
        throw new Error("Player-import backup keep count is invalid");
    }
    const backupRoot = path_1.default.resolve(getDatabaseDirectory(), "admin-backups");
    const resolvedCurrent = path_1.default.resolve(currentBackupDirectory);
    const currentName = path_1.default.basename(resolvedCurrent);
    if (path_1.default.dirname(resolvedCurrent) !== backupRoot ||
        !PLAYER_IMPORT_BACKUP_NAME.test(currentName) ||
        !(0, file_exists_1.existsSync)(resolvedCurrent) ||
        !(0, fs_1.lstatSync)(resolvedCurrent).isDirectory() ||
        (0, fs_1.lstatSync)(resolvedCurrent).isSymbolicLink()) {
        throw new Error("Current player-import backup directory is invalid");
    }
    const candidates = (0, fs_1.readdirSync)(backupRoot, { withFileTypes: true })
        .filter(entry => entry.isDirectory() && !entry.isSymbolicLink() && PLAYER_IMPORT_BACKUP_NAME.test(entry.name))
        .map(entry => {
        const absolutePath = path_1.default.resolve(backupRoot, entry.name);
        return {
            name: entry.name,
            absolutePath,
            mtimeMs: (0, fs_1.lstatSync)(absolutePath).mtimeMs,
        };
    })
        .sort((left, right) => right.mtimeMs - left.mtimeMs || right.name.localeCompare(left.name));
    const retained = new Set([resolvedCurrent]);
    for (const candidate of candidates) {
        if (retained.size >= keepCount)
            break;
        retained.add(candidate.absolutePath);
    }
    let removedBackups = 0;
    const cleanupErrors = [];
    for (const candidate of candidates) {
        if (retained.has(candidate.absolutePath))
            continue;
        if (path_1.default.dirname(candidate.absolutePath) !== backupRoot ||
            !PLAYER_IMPORT_BACKUP_NAME.test(candidate.name)) {
            cleanupErrors.push(`${candidate.name}: 路径校验失败`);
            continue;
        }
        try {
            (0, fs_1.rmSync)(candidate.absolutePath, { recursive: true, force: true });
            removedBackups++;
        }
        catch (error) {
            cleanupErrors.push(`${candidate.name}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    return {
        retainedBackups: candidates.length - removedBackups,
        removedBackups,
        backupCleanupError: cleanupErrors.length > 0 ? cleanupErrors.join("；") : null,
    };
}
exports.cleanupPlayerImportBackups = cleanupPlayerImportBackups;
