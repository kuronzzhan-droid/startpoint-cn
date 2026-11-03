"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assertRealtimeAuthority = exports.isRealtimeParent = exports.isRealtimeOwnerChild = void 0;
/** Production config is selected before listeners start; embedded is an explicit local mode. */
function isRealtimeOwnerChild() { return process.env.MULTI_REALTIME_OWNER_CHILD === "1"; }
exports.isRealtimeOwnerChild = isRealtimeOwnerChild;
function isRealtimeParent() {
    return !isRealtimeOwnerChild() && process.env.MULTI_REALTIME_PROCESS === "1";
}
exports.isRealtimeParent = isRealtimeParent;
function assertRealtimeAuthority() {
    if (isRealtimeParent())
        throw new Error("REALTIME_STATE_BELONGS_TO_CHILD");
}
exports.assertRealtimeAuthority = assertRealtimeAuthority;
