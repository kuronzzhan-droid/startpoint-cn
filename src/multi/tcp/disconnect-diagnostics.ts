import type * as net from "net"
import { registerMemoryCounters } from "../../lib/memory-diagnostics"

export type TcpDisconnectReason =
    | "peer_fin"
    | "client_bye"
    | "socket_error"
    | "protocol"
    | "admission"
    | "handshake_denied"
    | "handshake_error"
    | "message_error"
    | "loading_timeout"
    | "heartbeat_timeout"
    | "level_next_timeout"
    | "send_backpressure"
    | "send_queue_limit"
    | "send_write_error"
    | "superseded"
    | "login_replaced"
    | "room_rejected"
    | "rescue_timeout"
    | "room_disband"
    | "server_shutdown"
    | "relay_exit"
    | "unknown_close"

const reasons: readonly TcpDisconnectReason[] = [
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
]

const pending = new WeakMap<net.Socket, TcpDisconnectReason>()
const counters = Object.fromEntries(reasons.map(reason => [reason, 0])) as Record<TcpDisconnectReason, number>
let total = 0

registerMemoryCounters("tcpDisconnects", () => ({ total, ...counters }))

/** Preserve the first cause: later socket errors are usually consequences. */
export function markTcpDisconnectReason(socket: net.Socket, reason: TcpDisconnectReason): void {
    if (!pending.has(socket)) pending.set(socket, reason)
}

/** Read the first cause without finalizing counters or discarding it. */
export function readTcpDisconnectReason(socket: net.Socket, hadError = false): TcpDisconnectReason {
    return pending.get(socket) ?? (hadError ? "socket_error" : "unknown_close")
}

export function finishTcpDisconnect(socket: net.Socket, hadError: boolean): TcpDisconnectReason {
    const reason = readTcpDisconnectReason(socket, hadError)
    pending.delete(socket)
    counters[reason]++
    total++
    return reason
}
