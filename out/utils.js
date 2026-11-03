"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRequestPlatformSync = exports.Platform = exports.generateDataHeaders = exports.generateViewerId = exports.generateIdpAlias = exports.getDateFromServerTime = exports.getServerTimeForPlayer = exports.getTimeOffset = exports.setServerTimeOffset = exports.setServerTime = exports.realToVirtual = exports.getServerDate = exports.getServerTime = exports.onServerTimeOffsetChanged = exports.getRealServerDate = exports.getLegacyTimeOffset = exports.withCurrentServerClock = exports.withServerClock = void 0;
const crypto_1 = require("crypto");
const node_async_hooks_1 = require("node:async_hooks");
// The server's current time offset (real time + offset = simulated time)
let timeOffset = null; // milliseconds, null = use system time
console.log(`[TIME] startup offset=${timeOffset !== null && timeOffset !== void 0 ? timeOffset : 'null(system)'}`);
/**
 * In-process consumers that must share the main thread's virtual clock.
 *
 * The SQLite writer thread is a separate thread with its own copy of this
 * module, so it receives the offset over the worker protocol; this hook is how
 * it hears about later changes (management-panel time changes) without the
 * utility module depending on the writer client.
 */
const timeOffsetListeners = new Set();
const serverClock = new node_async_hooks_1.AsyncLocalStorage();
/** Freeze business time and its coordinate offset together across awaits. */
function withServerClock(now, callback, effectiveOffset) {
    var _a;
    if (effectiveOffset === void 0) { effectiveOffset = (_a = getTimeOffset()) !== null && _a !== void 0 ? _a : 0; }
    const nowMs = now instanceof Date ? now.getTime() : now;
    if (!Number.isFinite(nowMs) || !Number.isSafeInteger(effectiveOffset))
        throw new Error("Invalid server clock context");
    return serverClock.run({ nowMs, effectiveOffset }, callback);
}
exports.withServerClock = withServerClock;
function withCurrentServerClock(callback) {
    const captured = serverClock.getStore();
    return captured ? callback() : withServerClock(Date.now() + (timeOffset !== null && timeOffset !== void 0 ? timeOffset : 0), callback, timeOffset !== null && timeOffset !== void 0 ? timeOffset : 0);
}
exports.withCurrentServerClock = withCurrentServerClock;
/** The configured legacy offset, unaffected by an individual player's context. */
function getLegacyTimeOffset() { return timeOffset; }
exports.getLegacyTimeOffset = getLegacyTimeOffset;
/** Real time captured at the same execution boundary as the business clock. */
function getRealServerDate() {
    const captured = serverClock.getStore();
    return new Date(captured ? captured.nowMs - captured.effectiveOffset : Date.now());
}
exports.getRealServerDate = getRealServerDate;
function onServerTimeOffsetChanged(listener) {
    timeOffsetListeners.add(listener);
    return () => { timeOffsetListeners.delete(listener); };
}
exports.onServerTimeOffsetChanged = onServerTimeOffsetChanged;
function publishTimeOffset() {
    for (const listener of timeOffsetListeners) {
        try {
            listener(timeOffset);
        }
        catch (error) {
            console.error("[TIME] offset listener failed", error instanceof Error ? error.message : String(error));
        }
    }
}
/**
 * Returns the current server time as a unix epoch.
 * Without argument: returns simulated current time.
 * With argument: converts the given Date to epoch (ignoring offset for serialization).
 *
 * @param date An optional date to convert to epoch.
 * @returns The unix epoch.
 */
function getServerTime(date) {
    var _a, _b;
    if (date !== undefined) {
        return Math.floor(date.getTime() / 1000);
    }
    return Math.floor(((_b = (_a = serverClock.getStore()) === null || _a === void 0 ? void 0 : _a.nowMs) !== null && _b !== void 0 ? _b : Date.now() + (timeOffset !== null && timeOffset !== void 0 ? timeOffset : 0)) / 1000);
}
exports.getServerTime = getServerTime;
/**
 * Gets the current server time as a Date.
 *
 * @returns The current server time as a date.
 */
function getServerDate() {
    var _a, _b;
    return new Date((_b = (_a = serverClock.getStore()) === null || _a === void 0 ? void 0 : _a.nowMs) !== null && _b !== void 0 ? _b : Date.now() + (timeOffset !== null && timeOffset !== void 0 ? timeOffset : 0));
}
exports.getServerDate = getServerDate;
/** Convert a real Date (as stored in DB) to virtual epoch seconds for client. */
function realToVirtual(date) {
    var _a;
    return Math.floor((date.getTime() + ((_a = getTimeOffset()) !== null && _a !== void 0 ? _a : 0)) / 1000);
}
exports.realToVirtual = realToVirtual;
/**
 * Sets a custom server time from an absolute date.
 * The offset (target - real time) is computed and stored.
 * Set to null to reset to system time.
 */
function setServerTime(date) {
    timeOffset = date ? date.getTime() - Date.now() : null;
    console.log(`[TIME] setServerTime → ${(date === null || date === void 0 ? void 0 : date.toISOString()) || 'null(system)'} offset=${timeOffset}`);
    publishTimeOffset();
}
exports.setServerTime = setServerTime;
/**
 * Sets the time offset directly (used on startup restore).
 */
function setServerTimeOffset(offset) {
    timeOffset = offset;
    console.log(`[TIME] startup restore offset=${offset !== null && offset !== void 0 ? offset : 'null(system)'}`);
    publishTimeOffset();
}
exports.setServerTimeOffset = setServerTimeOffset;
/**
 * Returns the raw time offset (used for persistence).
 */
function getTimeOffset() {
    var _a, _b;
    return (_b = (_a = serverClock.getStore()) === null || _a === void 0 ? void 0 : _a.effectiveOffset) !== null && _b !== void 0 ? _b : timeOffset;
}
exports.getTimeOffset = getTimeOffset;
/**
 * Returns server time for a specific player.
 * Content and client time use the global legacy clock; saved EXP offsets are storage coordinates.
 */
function getServerTimeForPlayer(playerId) {
    void playerId;
    return getServerTime();
}
exports.getServerTimeForPlayer = getServerTimeForPlayer;
/**
 * Converts a server time value (unix epoch in seconds) into a Date.
 *
 * @param serverTime The unix epoch value.
 * @returns The date.
 */
function getDateFromServerTime(serverTime) {
    return new Date(serverTime * 1000);
}
exports.getDateFromServerTime = getDateFromServerTime;
/**
 * Generates an IdpAlias to identify a particular device.
 *
 * @param appId
 * @param idpId
 * @param serialNo
 * @returns The generated IdpAlias
 */
function generateIdpAlias(appId, deviceId, serialNo) {
    return `${appId}:${deviceId}:${serialNo}`;
}
exports.generateIdpAlias = generateIdpAlias;
/**
 * Generates a random viewer ID using the crypto library.
 *
 * @returns A number between 100,000,000 and 899,999,999.
 *
 * Values from 900,000,000 onward are reserved by the multiplayer protocol
 * for COM/AI participants. Assigning a real account one of those values makes
 * older clients treat that player as an AI and omit them from co-op results.
 */
function generateViewerId() {
    return (0, crypto_1.randomInt)(100000000, 900000000);
}
exports.generateViewerId = generateViewerId;
/**
 * Generates a default data headers object, which is used in communication with the client.
 *
 * @param customValues A partial DataHeaders object with custom fields to replace the default ones.
 * @returns A DataHeaders object.
 */
function generateDataHeaders(customValues = {}, fields = ['force_update', 'asset_update', 'force_news', 'short_udid', 'viewer_id', 'servertime', 'result_code']) {
    const defaultHeaders = {
        force_update: false,
        asset_update: false,
        force_news: null,
        short_udid: 0,
        viewer_id: 0,
        servertime: 0,
        result_code: 1
    };
    const headers = {};
    for (const field of fields) {
        const customValue = customValues[field];
        let defaultValue = defaultHeaders[field];
        // servertime evaluated fresh each request (uses simulated time if set)
        if (field === 'servertime') {
            defaultValue = getServerTime();
        }
        headers[field] = customValue === undefined ? defaultValue : customValue;
    }
    return headers;
}
exports.generateDataHeaders = generateDataHeaders;
var Platform;
(function (Platform) {
    Platform[Platform["ANDROID"] = 0] = "ANDROID";
    Platform[Platform["IOS"] = 1] = "IOS";
})(Platform || (exports.Platform = Platform = {}));
function getRequestPlatformSync(request) {
    // check user agent
    if ((request.headers["user-agent"] || '').includes('iOS;'))
        return Platform.IOS;
    // check requestedby header
    if ((request.headers["requestedby"] || '') === 'ios')
        return Platform.IOS;
    return Platform.ANDROID;
}
exports.getRequestPlatformSync = getRequestPlatformSync;
