import {
    closeSync,
    copyFileSync,
    existsSync,
    fsyncSync,
    openSync,
    readFileSync,
    renameSync,
    unlinkSync,
    writeFileSync,
} from "fs";
import { basename, dirname, join } from "path";

let temporarySequence = 0;

function temporaryPath(target: string, suffix: string): string {
    temporarySequence += 1;
    return join(
        dirname(target),
        `.${basename(target)}.${process.pid}.${temporarySequence}.${suffix}`
    );
}

function removeIfPresent(path: string): void {
    try {
        if (existsSync(path)) unlinkSync(path);
    } catch {
        // Best-effort cleanup must not hide the original persistence error.
    }
}

function syncFile(path: string): void {
    // Windows requires a writable handle for FlushFileBuffers/fsync.
    const descriptor = openSync(path, "r+");
    try {
        fsyncSync(descriptor);
    } finally {
        closeSync(descriptor);
    }
}

function replaceBackup(source: string, destination: string): void {
    try {
        renameSync(source, destination);
    } catch (error) {
        // Some Windows filesystems do not replace an existing destination.
        if (!existsSync(destination)) throw error;
        unlinkSync(destination);
        renameSync(source, destination);
    }
}

/**
 * Writes JSON through a validated same-directory temporary file. A valid
 * previous primary is retained as `.bak` before the atomic replacement.
 */
export function writeJsonAtomicSync(path: string, value: unknown): void {
    const serialized = JSON.stringify(value, null, 2);
    const temporary = temporaryPath(path, "tmp");
    const backup = `${path}.bak`;
    const backupTemporary = temporaryPath(path, "bak.tmp");
    let descriptor: number | null = null;

    try {
        descriptor = openSync(temporary, "wx");
        writeFileSync(descriptor, serialized, "utf-8");
        fsyncSync(descriptor);
        closeSync(descriptor);
        descriptor = null;

        // Verify exactly what reached disk before it can replace the primary.
        JSON.parse(readFileSync(temporary, "utf-8"));

        if (existsSync(path)) {
            // Do not overwrite a known-good backup with a corrupt primary.
            let primaryIsValid = false;
            try {
                JSON.parse(readFileSync(path, "utf-8"));
                primaryIsValid = true;
            } catch {
                // The validated temporary file may repair the corrupt primary.
            }
            if (primaryIsValid) {
                copyFileSync(path, backupTemporary);
                syncFile(backupTemporary);
                replaceBackup(backupTemporary, backup);
            }
        }

        renameSync(temporary, path);
    } finally {
        if (descriptor !== null) {
            try { closeSync(descriptor); } catch { /* already closed */ }
        }
        removeIfPresent(temporary);
        removeIfPresent(backupTemporary);
    }
}

/**
 * Reads the primary JSON file, falling back to its last valid `.bak` copy.
 */
export function readJsonWithBackupSync<T>(path: string): T | undefined {
    if (existsSync(path)) {
        try {
            return JSON.parse(readFileSync(path, "utf-8")) as T;
        } catch (error) {
            console.error(`[JSON] primary file is invalid: ${path}`, error);
        }
    }

    const backup = `${path}.bak`;
    if (existsSync(backup)) {
        try {
            const value = JSON.parse(readFileSync(backup, "utf-8")) as T;
            console.warn(`[JSON] recovered from backup: ${backup}`);
            return value;
        } catch (error) {
            console.error(`[JSON] backup file is invalid: ${backup}`, error);
        }
    }

    return undefined;
}
