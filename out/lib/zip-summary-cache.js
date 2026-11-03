"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getZipFileSummary = exports.getZipArchiveMetadata = exports.invalidateZipSummaryCache = exports.invalidateZipCache = void 0;
const file_exists_1 = require("./file-exists");
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
const ZIP_SUMMARY_CACHE_TTL_MS = 15000;
const ZIP_CATALOG_CACHE_TTL_MS = 5000;
const zipCache = new Map();
const cacheKey = (kind, directory) => (`${kind}:${path_1.default.resolve(directory)}`);
function invalidateZipCache(directory) {
    if (directory === undefined) {
        zipCache.clear();
        return;
    }
    const resolved = path_1.default.resolve(directory);
    zipCache.delete(`summary:${resolved}`);
    zipCache.delete(`catalog:${resolved}`);
}
exports.invalidateZipCache = invalidateZipCache;
function invalidateZipSummaryCache(directory) {
    invalidateZipCache(directory);
}
exports.invalidateZipSummaryCache = invalidateZipSummaryCache;
/** Reads flat ZIP names and sizes; callers build request-specific URLs later. */
function getZipArchiveMetadata(directory) {
    const resolved = path_1.default.resolve(directory);
    const key = cacheKey("catalog", resolved);
    const now = Date.now();
    const directoryMtimeMs = (0, fs_1.statSync)(resolved).mtimeMs;
    const cached = zipCache.get(key);
    if ((cached === null || cached === void 0 ? void 0 : cached.kind) === "catalog"
        && cached.expiresAt > now
        && cached.directoryMtimeMs === directoryMtimeMs) {
        return cached.archives;
    }
    const archives = (0, fs_1.readdirSync)(resolved)
        .filter(filename => filename.endsWith(".zip"))
        .map(filename => ({
        filename,
        size: (0, fs_1.statSync)(path_1.default.join(resolved, filename)).size,
    }));
    zipCache.set(key, {
        kind: "catalog",
        expiresAt: now + ZIP_CATALOG_CACHE_TTL_MS,
        directoryMtimeMs,
        archives,
    });
    return archives;
}
exports.getZipArchiveMetadata = getZipArchiveMetadata;
/** Recursively summarizes ZIP files, reusing the result briefly for admin polling. */
function getZipFileSummary(dir) {
    const resolved = path_1.default.resolve(dir);
    const key = cacheKey("summary", resolved);
    const now = Date.now();
    const cached = zipCache.get(key);
    if ((cached === null || cached === void 0 ? void 0 : cached.kind) === "summary" && cached.expiresAt > now)
        return cached.summary;
    if (!(0, file_exists_1.existsSync)(resolved)) {
        const summary = { exists: false, count: 0, latestMtime: null, totalBytes: 0 };
        zipCache.set(key, { kind: "summary", expiresAt: now + ZIP_SUMMARY_CACHE_TTL_MS, summary });
        return summary;
    }
    let count = 0;
    let totalBytes = 0;
    let latest = 0;
    const stack = [resolved];
    while (stack.length) {
        const current = stack.pop();
        for (const name of (0, fs_1.readdirSync)(current)) {
            const filePath = path_1.default.join(current, name);
            const stats = (0, fs_1.statSync)(filePath);
            if (stats.isDirectory()) {
                stack.push(filePath);
                continue;
            }
            if (!name.endsWith(".zip"))
                continue;
            count += 1;
            totalBytes += stats.size;
            latest = Math.max(latest, stats.mtimeMs);
        }
    }
    const summary = {
        exists: true,
        count,
        latestMtime: latest ? new Date(latest).toISOString() : null,
        totalBytes,
    };
    zipCache.set(key, { kind: "summary", expiresAt: now + ZIP_SUMMARY_CACHE_TTL_MS, summary });
    return summary;
}
exports.getZipFileSummary = getZipFileSummary;
