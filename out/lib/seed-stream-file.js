"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.writeSeedJsonAtomicSync = exports.seedJsonChunks = void 0;
const file_exists_1 = require("./file-exists");
const crypto_1 = require("crypto");
const fs_1 = require("fs");
const path_1 = require("path");
const verifiedFiles = new Map();
const CHUNK_BYTES = 64 * 1024;
/** Encode entries directly instead of building a second copy of every seed map. */
function* seedJsonChunks(pools, kind) {
    let chunk = "{", firstPool = true;
    for (const [movie, pool] of pools) {
        const maps = kind === "confirmed"
            ? [[movie, pool.confirmPool], [`${movie}_pend`, pool.pendingPool]]
            : [[movie, kind === "purified" ? pool.playPool : pool.verifiedPool]];
        for (const [name, entries] of maps) {
            chunk += `${firstPool ? "" : ","}${JSON.stringify(name)}:{`;
            firstPool = false;
            let firstSeed = true;
            for (const [seed, value] of entries) {
                const encoded = JSON.stringify(value);
                if (encoded === undefined)
                    continue;
                chunk += `${firstSeed ? "" : ","}${JSON.stringify(String(seed))}:${encoded}`;
                firstSeed = false;
                if (chunk.length >= CHUNK_BYTES) {
                    yield chunk;
                    chunk = "";
                }
            }
            chunk += "}";
        }
    }
    yield chunk + "}";
}
exports.seedJsonChunks = seedJsonChunks;
function digestFile(file, buffer) {
    const fd = (0, fs_1.openSync)(file, "r"), hash = (0, crypto_1.createHash)("sha256");
    try {
        for (;;) {
            const length = (0, fs_1.readSync)(fd, buffer, 0, buffer.length, null);
            if (length === 0)
                break;
            hash.update(buffer.subarray(0, length));
        }
        return hash.digest("hex");
    }
    finally {
        (0, fs_1.closeSync)(fd);
    }
}
function removeTemporary(file) {
    try {
        if ((0, file_exists_1.existsSync)(file))
            (0, fs_1.unlinkSync)(file);
    }
    catch ( /* retain the original error */_a) { /* retain the original error */ }
}
/** Same primary + .bak contract, bounded serialization/readback allocation. */
function writeSeedJsonAtomicSync(file, pools, kind) {
    const prefix = (0, path_1.join)((0, path_1.dirname)(file), `.${(0, path_1.basename)(file)}.${process.pid}.${(0, crypto_1.randomUUID)()}`);
    const temporary = `${prefix}.tmp`, backupTemporary = `${prefix}.bak.tmp`, backup = `${file}.bak`;
    let fd = null, bytes = 0;
    let scratch = Buffer.allocUnsafe(CHUNK_BYTES);
    try {
        fd = (0, fs_1.openSync)(temporary, "wx");
        const expected = (0, crypto_1.createHash)("sha256");
        for (const chunk of seedJsonChunks(pools, kind)) {
            const length = Buffer.byteLength(chunk, "utf8");
            if (length > scratch.length)
                scratch = Buffer.allocUnsafe(length);
            scratch.write(chunk, "utf8");
            const buffer = scratch.subarray(0, length);
            (0, fs_1.writeFileSync)(fd, buffer);
            expected.update(buffer);
            bytes += buffer.length;
        }
        (0, fs_1.fsyncSync)(fd);
        (0, fs_1.closeSync)(fd);
        fd = null;
        const digest = expected.digest("hex");
        if (digestFile(temporary, scratch) !== digest)
            throw new Error("Seed file readback checksum mismatch");
        if ((0, file_exists_1.existsSync)(file)) {
            let valid = false;
            let previous = "";
            try {
                previous = digestFile(file, scratch);
                if (verifiedFiles.get(file) === previous)
                    valid = true;
                else {
                    // First write after startup or externally replaced content:
                    // establish JSON validity before replacing a known-good backup.
                    const raw = (0, fs_1.readFileSync)(file);
                    JSON.parse(raw.toString("utf8"));
                    valid = (0, crypto_1.createHash)("sha256").update(raw).digest("hex") === previous;
                }
            }
            catch (_a) {
                valid = false;
            }
            if (valid) {
                (0, fs_1.copyFileSync)(file, backupTemporary);
                if (digestFile(backupTemporary, scratch) !== previous)
                    throw new Error("Seed backup changed during copy");
                const backupFd = (0, fs_1.openSync)(backupTemporary, "r+");
                try {
                    (0, fs_1.fsyncSync)(backupFd);
                }
                finally {
                    (0, fs_1.closeSync)(backupFd);
                }
                try {
                    (0, fs_1.renameSync)(backupTemporary, backup);
                }
                catch (error) {
                    if (!(0, file_exists_1.existsSync)(backup))
                        throw error;
                    (0, fs_1.unlinkSync)(backup);
                    (0, fs_1.renameSync)(backupTemporary, backup);
                }
            }
        }
        (0, fs_1.renameSync)(temporary, file);
        verifiedFiles.delete(file);
        verifiedFiles.set(file, digest);
        if (verifiedFiles.size > 16)
            verifiedFiles.delete(verifiedFiles.keys().next().value);
        return bytes;
    }
    finally {
        if (fd !== null)
            (0, fs_1.closeSync)(fd);
        removeTemporary(temporary);
        removeTemporary(backupTemporary);
    }
}
exports.writeSeedJsonAtomicSync = writeSeedJsonAtomicSync;
