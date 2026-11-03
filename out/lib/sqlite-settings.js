"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.applySqliteSettings = exports.sqliteSettings = void 0;
const multicore_config_1 = require("./multicore-config");
function integer(value, fallback, min, max) {
    if (!(value === null || value === void 0 ? void 0 : value.trim()))
        return fallback;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}
function sqliteSettings(environment = process.env) {
    var _a;
    const multicore = (0, multicore_config_1.multicoreConfig)(environment);
    return {
        // FULL preserves acknowledged commits across power loss. NORMAL is opt-in.
        synchronous: ((_a = environment.SQLITE_SYNCHRONOUS) === null || _a === void 0 ? void 0 : _a.toUpperCase()) === "NORMAL" ? "NORMAL" : "FULL",
        cacheKiB: integer(environment.SQLITE_CACHE_KIB, multicore.enabled ? 65536 : 2048, 2048, 262144),
        mmapBytes: integer(environment.SQLITE_MMAP_MIB, multicore.enabled ? 256 : 0, 0, 1024) * 1024 * 1024,
    };
}
exports.sqliteSettings = sqliteSettings;
function applySqliteSettings(db, readonly = false) {
    const settings = sqliteSettings();
    db.pragma(`cache_size = -${settings.cacheKiB}`);
    db.pragma(`mmap_size = ${settings.mmapBytes}`);
    if (!readonly)
        db.pragma(`synchronous = ${settings.synchronous}`);
}
exports.applySqliteSettings = applySqliteSettings;
