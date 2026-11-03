"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hasRoomStartClaims = exports.unpinRoomStart = exports.pinRoomStart = exports.deferPinnedRoomControl = void 0;
// A durable-start decision pins the frozen owner instance until explicit reconciliation.
// Timeout does not release an uncertain transaction or authorize a replacement run.
const pins = new WeakMap();
const deferred = new WeakMap();
/** Legacy scene controls have no epoch. Keep their TCP order until the durable start resolves. */
function deferPinnedRoomControl(room, apply) {
    if (!hasRoomStartClaims(room))
        return false;
    let queue = deferred.get(room);
    if (!queue)
        deferred.set(room, queue = []);
    if (queue.length >= 64)
        throw new Error("START_CONTROL_QUEUE_LIMIT");
    queue.push(apply);
    return true;
}
exports.deferPinnedRoomControl = deferPinnedRoomControl;
function pinRoomStart(room, token) {
    let current = pins.get(room);
    if (!current)
        pins.set(room, current = new Set());
    current.add(token);
}
exports.pinRoomStart = pinRoomStart;
function unpinRoomStart(room, token) {
    const current = pins.get(room);
    current === null || current === void 0 ? void 0 : current.delete(token);
    if (!(current === null || current === void 0 ? void 0 : current.size)) {
        pins.delete(room);
        const queue = deferred.get(room);
        deferred.delete(room);
        for (const apply of queue !== null && queue !== void 0 ? queue : []) {
            try {
                apply();
            }
            catch (error) {
                console.error("[MULTI-REALTIME] deferred start control failed", error);
            }
        }
    }
}
exports.unpinRoomStart = unpinRoomStart;
function hasRoomStartClaims(room) { var _a; return !!((_a = pins.get(room)) === null || _a === void 0 ? void 0 : _a.size); }
exports.hasRoomStartClaims = hasRoomStartClaims;
