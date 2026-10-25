import { existsSync } from "./file-exists";
import {
    closeSync,
    copyFileSync,
    fsyncSync,
    openSync,
    readFileSync,
    renameSync,
    statSync,
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
    // Never remove the last backup merely because a replacement failed.
    renameSync(source, destination);
}

export interface AtomicJsonOptions {
    validate?: (value: unknown) => void;
    backup?: boolean;
}

/**
 * Writes JSON through a validated same-directory temporary file. A valid
 * previous primary is retained as `.bak` before the atomic replacement.
 */
export function writeJsonAtomicSync(path: string, value: unknown, options: AtomicJsonOptions = {}): void {
    const serialized = JSON.stringify(value, null, 2);
    options.validate?.(JSON.parse(serialized));
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
        const written: unknown = JSON.parse(readFileSync(temporary, "utf-8"));
        options.validate?.(written);

        if (options.backup !== false && existsSync(path)) {
            // Do not overwrite a known-good backup with a corrupt primary.
            let primaryIsValid = false;
            try {
                const previous = JSON.parse(readFileSync(path, "utf-8"));
                options.validate?.(previous);
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

/** File identity includes the backup so a repaired/replaced sidecar invalidates caches. */
export function jsonFileIdentitySync(path: string): string {
    return [path, `${path}.bak`].map(file => {
        try {
            const stat = statSync(file);
            return [stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs].join(":");
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") return "absent";
            throw error;
        }
    }).join("|");
}

export type ValidatedJsonRead<T> = { source: "absent"; value?: never }
    | { source: "primary" | "backup"; value: T };

/** Missing is distinct from unreadable or invalid. Recovery never rewrites either file. */
export function readValidatedJsonWithBackupSync<T>(path: string, validate: (value: unknown) => void): ValidatedJsonRead<T> {
    const errors: string[] = [];
    for (const [file, source] of [[path, "primary"], [`${path}.bak`, "backup"]] as const) {
        let text: string;
        try { text = readFileSync(file, "utf-8"); }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") errors.push(`${source}: ${(error as Error).message}`);
            continue;
        }
        try {
            const value: unknown = JSON.parse(text);
            validate(value);
            return { source, value: value as T };
        } catch (error) { errors.push(`${source}: ${(error as Error).message}`); }
    }
    if (errors.length) throw new Error(`JSON 主文件和备份均不可用（${basename(path)}）：${errors.join("; ")}`);
    return { source: "absent" };
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
