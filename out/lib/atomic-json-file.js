"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readJsonWithBackupSync = exports.writeJsonAtomicSync = void 0;
const file_exists_1 = require("./file-exists");
const fs_1 = require("fs");
const path_1 = require("path");
let temporarySequence = 0;
function temporaryPath(target, suffix) {
    temporarySequence += 1;
    return (0, path_1.join)((0, path_1.dirname)(target), `.${(0, path_1.basename)(target)}.${process.pid}.${temporarySequence}.${suffix}`);
}
function removeIfPresent(path) {
    try {
        if ((0, file_exists_1.existsSync)(path))
            (0, fs_1.unlinkSync)(path);
    }
    catch (_a) {
        // Best-effort cleanup must not hide the original persistence error.
    }
}
function syncFile(path) {
    // Windows requires a writable handle for FlushFileBuffers/fsync.
    const descriptor = (0, fs_1.openSync)(path, "r+");
    try {
        (0, fs_1.fsyncSync)(descriptor);
    }
    finally {
        (0, fs_1.closeSync)(descriptor);
    }
}
function replaceBackup(source, destination) {
    try {
        (0, fs_1.renameSync)(source, destination);
    }
    catch (error) {
        // Some Windows filesystems do not replace an existing destination.
        if (!(0, file_exists_1.existsSync)(destination))
            throw error;
        (0, fs_1.unlinkSync)(destination);
        (0, fs_1.renameSync)(source, destination);
    }
}
/**
 * Writes JSON through a validated same-directory temporary file. A valid
 * previous primary is retained as `.bak` before the atomic replacement.
 */
function writeJsonAtomicSync(path, value) {
    const serialized = JSON.stringify(value, null, 2);
    const temporary = temporaryPath(path, "tmp");
    const backup = `${path}.bak`;
    const backupTemporary = temporaryPath(path, "bak.tmp");
    let descriptor = null;
    try {
        descriptor = (0, fs_1.openSync)(temporary, "wx");
        (0, fs_1.writeFileSync)(descriptor, serialized, "utf-8");
        (0, fs_1.fsyncSync)(descriptor);
        (0, fs_1.closeSync)(descriptor);
        descriptor = null;
        // Verify exactly what reached disk before it can replace the primary.
        JSON.parse((0, fs_1.readFileSync)(temporary, "utf-8"));
        if ((0, file_exists_1.existsSync)(path)) {
            // Do not overwrite a known-good backup with a corrupt primary.
            let primaryIsValid = false;
            try {
                JSON.parse((0, fs_1.readFileSync)(path, "utf-8"));
                primaryIsValid = true;
            }
            catch (_a) {
                // The validated temporary file may repair the corrupt primary.
            }
            if (primaryIsValid) {
                (0, fs_1.copyFileSync)(path, backupTemporary);
                syncFile(backupTemporary);
                replaceBackup(backupTemporary, backup);
            }
        }
        (0, fs_1.renameSync)(temporary, path);
    }
    finally {
        if (descriptor !== null) {
            try {
                (0, fs_1.closeSync)(descriptor);
            }
            catch ( /* already closed */_b) { /* already closed */ }
        }
        removeIfPresent(temporary);
        removeIfPresent(backupTemporary);
    }
}
exports.writeJsonAtomicSync = writeJsonAtomicSync;
/**
 * Reads the primary JSON file, falling back to its last valid `.bak` copy.
 */
function readJsonWithBackupSync(path) {
    if ((0, file_exists_1.existsSync)(path)) {
        try {
            return JSON.parse((0, fs_1.readFileSync)(path, "utf-8"));
        }
        catch (error) {
            console.error(`[JSON] primary file is invalid: ${path}`, error);
        }
    }
    const backup = `${path}.bak`;
    if ((0, file_exists_1.existsSync)(backup)) {
        try {
            const value = JSON.parse((0, fs_1.readFileSync)(backup, "utf-8"));
            console.warn(`[JSON] recovered from backup: ${backup}`);
            return value;
        }
        catch (error) {
            console.error(`[JSON] backup file is invalid: ${backup}`, error);
        }
    }
    return undefined;
}
exports.readJsonWithBackupSync = readJsonWithBackupSync;
