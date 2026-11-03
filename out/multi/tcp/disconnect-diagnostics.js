"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.finishTcpDisconnect = exports.readTcpDisconnectReason = exports.markTcpDisconnectReason = void 0;
const memory_diagnostics_1 = require("../../lib/memory-diagnostics");
const reasons = [
    "peer_fin",
    "client_bye",
    "socket_error",
    "protocol",
    "admission",
    "handshake_denied",
    "handshake_error",
    "message_error",
    "loading_timeout",
    "heartbeat_timeout",
    "level_next_timeout",
    "send_backpressure",
    "send_queue_limit",
    "send_write_error",
    "superseded",
    "login_replaced",
    "room_rejected",
    "rescue_timeout",
    "room_disband",
    "server_shutdown",
    "relay_exit",
    "unknown_close",
];
const pending = new WeakMap();
const counters = Object.fromEntries(reasons.map(reason => [reason, 0]));
let total = 0;
(0, memory_diagnostics_1.registerMemoryCounters)("tcpDisconnects", () => (Object.assign({ total }, counters)));
/** Preserve the first cause: later socket errors are usually consequences. */
function markTcpDisconnectReason(socket, reason) {
    if (!pending.has(socket))
        pending.set(socket, reason);
}
exports.markTcpDisconnectReason = markTcpDisconnectReason;
/** Read the first cause without finalizing counters or discarding it. */
function readTcpDisconnectReason(socket, hadError = false) {
    var _a;
    return (_a = pending.get(socket)) !== null && _a !== void 0 ? _a : (hadError ? "socket_error" : "unknown_close");
}
exports.readTcpDisconnectReason = readTcpDisconnectReason;
function finishTcpDisconnect(socket, hadError) {
    const reason = readTcpDisconnectReason(socket, hadError);
    pending.delete(socket);
    counters[reason]++;
    total++;
    return reason;
}
exports.finishTcpDisconnect = finishTcpDisconnect;
