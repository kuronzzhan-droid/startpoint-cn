"use strict";
/**
 * Configuration for the optional single-writer SQLite thread.
 *
 * The writer thread owns every business write while the main thread keeps
 * protocol, realtime and read work. It is opt-in so a deployment can always
 * fall back to the in-process persistence coordinator by unsetting one switch.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.writerThreadConfig = exports.WRITER_PROTOCOL_VERSION = void 0;
// 2: the client pushes the main thread's virtual-clock offset to the worker
//    (`set_time_offset`) before dispatching commands.
exports.WRITER_PROTOCOL_VERSION = 2;
function integer(value, fallback, min, max) {
    if (!(value === null || value === void 0 ? void 0 : value.trim()))
        return fallback;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}
function switchValue(value, fallback) {
    if (/^(1|true|yes|on)$/i.test(value !== null && value !== void 0 ? value : ""))
        return true;
    if (/^(0|false|no|off)$/i.test(value !== null && value !== void 0 ? value : ""))
        return false;
    return fallback;
}
function writerThreadConfig(environment = process.env) {
    return {
        enabled: switchValue(environment.CN_WRITER_THREAD, false),
        fallback: switchValue(environment.SQLITE_WRITER_FALLBACK, false),
        queueMax: integer(environment.SQLITE_WRITER_QUEUE_MAX, 512, 1, 100000),
        maxInFlight: integer(environment.SQLITE_WRITER_MAX_IN_FLIGHT, 32, 1, 512),
        commandTimeoutMs: integer(environment.SQLITE_WRITER_COMMAND_TIMEOUT_MS, 30000, 0, 600000),
        groupCommitWindowMs: integer(environment.SQLITE_GROUP_COMMIT_WINDOW_MS, 2, 0, 50),
        groupCommitMax: integer(environment.SQLITE_GROUP_COMMIT_MAX, 64, 1, 512),
        busyTimeoutMs: integer(environment.SQLITE_WRITER_BUSY_TIMEOUT_MS, 1000, 0, 60000),
        maxRestarts: integer(environment.SQLITE_WRITER_MAX_RESTARTS, 5, 0, 100),
    };
}
exports.writerThreadConfig = writerThreadConfig;
