"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.clearOnlinePlayers = exports.ONLINE_PLAYER_WINDOW_MS = exports.getOnlinePlayerCount = exports.markPlayerOnlineFromTcp = exports.markPlayerOnline = void 0;
const ONLINE_WINDOW_MS = 5 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 60 * 1000;
const TCP_UPDATE_INTERVAL_MS = 30 * 1000;
const lastSeenByViewerId = new Map();
let nextCleanupAt = 0;
function normalizeViewerId(value) {
    if (typeof value !== "number" && typeof value !== "string")
        return null;
    const viewerId = Number(value);
    if (!Number.isSafeInteger(viewerId) || viewerId <= 0)
        return null;
    return viewerId;
}
function cleanupExpired(now) {
    const cutoff = now - ONLINE_WINDOW_MS;
    for (const [viewerId, lastSeen] of lastSeenByViewerId) {
        if (lastSeen < cutoff)
            lastSeenByViewerId.delete(viewerId);
    }
    nextCleanupAt = now + CLEANUP_INTERVAL_MS;
}
/**
 * Records one player as recently active. This is deliberately memory-only:
 * no SQLite writes, timers, logs, or additional client requests are involved.
 */
function markPlayerOnline(value, now = Date.now()) {
    const viewerId = normalizeViewerId(value);
    if (viewerId === null)
        return false;
    lastSeenByViewerId.set(viewerId, now);
    if (now >= nextCleanupAt)
        cleanupExpired(now);
    return true;
}
exports.markPlayerOnline = markPlayerOnline;
/** Reuses the HTTP presence window for identified multiplayer TCP activity. */
function markPlayerOnlineFromTcp(value, now = Date.now()) {
    const viewerId = normalizeViewerId(value);
    if (viewerId === null)
        return false;
    // Battle traffic can be frequent; at most one extra map write per UID per
    // 30 seconds is enough to keep the five-minute activity window current.
    const lastSeen = lastSeenByViewerId.get(viewerId);
    if (lastSeen !== undefined && now - lastSeen < TCP_UPDATE_INTERVAL_MS)
        return true;
    lastSeenByViewerId.set(viewerId, now);
    if (now >= nextCleanupAt)
        cleanupExpired(now);
    return true;
}
exports.markPlayerOnlineFromTcp = markPlayerOnlineFromTcp;
/** Returns the number of unique players active during the last five minutes. */
function getOnlinePlayerCount(now = Date.now()) {
    // The management page calls this every 30 seconds; remove expired entries
    // before returning without adding a background timer.
    cleanupExpired(now);
    return lastSeenByViewerId.size;
}
exports.getOnlinePlayerCount = getOnlinePlayerCount;
exports.ONLINE_PLAYER_WINDOW_MS = ONLINE_WINDOW_MS;
/** Test helper; not used by runtime code. */
function clearOnlinePlayers() {
    lastSeenByViewerId.clear();
    nextCleanupAt = 0;
}
exports.clearOnlinePlayers = clearOnlinePlayers;
