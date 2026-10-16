// Multi battle TCP session server
// Protocol: JSON messages delimited by null byte (\0)
// Post-handshake messages use typepacker format with useEnumIndex=true:
//   [index, param1, param2, ...]

import * as net from "net"
import { observeServerConnections } from "../../lib/memory-diagnostics"
import { clientAdmission } from "../../lib/client-admission"
import { handleHandshake } from "./handshake"
import { handleBattleMessage } from "./battle"
import { sessionManager } from "../state/SessionManager"
import { gameVerboseLog } from "../../lib/game-logging"
import { clearReliableSendState } from "./reliable-send"
import {
    finishTcpDisconnect,
    markTcpDisconnectReason,
} from "./disconnect-diagnostics"
import { embeddedMultiCoordinator } from "../coordinator/embedded"
import { battleTelemetry } from "../battle-telemetry"
import { fiveBossConnectionDiagnostics } from "../five-boss/connection-diagnostic"
import { battleRelayBridge, battleRelayProcessEnabled, isRelayProxySocket } from "./battle-relay/bridge"
import { handleBattleRelayActivity } from "./battle"
import type { RelayActivity } from "./battle-relay/protocol"
import {
    detachLoungeSocket,
    handleLoungeHandshake,
    handleLoungeMessage,
} from "../../lounge/tcp"

export const SESSION_PORT = parseInt(process.env.SESSION_PORT || "8003")
export const SESSION_HOST = process.env.SESSION_HOST || "0.0.0.0"

function positiveInteger(name: string, fallback: number, minimum: number): number {
    const value = Number.parseInt(process.env[name] ?? "", 10)
    return Number.isFinite(value) ? Math.max(minimum, value) : fallback
}

export const SESSION_HANDSHAKE_TIMEOUT_MS = positiveInteger("SESSION_HANDSHAKE_TIMEOUT_MS", 15_000, 1_000)
export const SESSION_MAX_FRAME_BYTES = positiveInteger("SESSION_MAX_FRAME_BYTES", 262_144, 1_024)
export const SESSION_MAX_BUFFER_BYTES = positiveInteger("SESSION_MAX_BUFFER_BYTES", 1_048_576, SESSION_MAX_FRAME_BYTES)
export const SESSION_TCP_KEEPALIVE_MS = positiveInteger("SESSION_TCP_KEEPALIVE_MS", 10_000, 1_000)
// A client can deliver many complete frames in one `data` callback. Keep one
// noisy socket from monopolizing the Node event loop while another player's
// heartbeat or room broadcast is waiting to run. Frames for one socket remain
// ordered; the remainder is resumed with setImmediate below.
export const SESSION_MAX_FRAMES_PER_TICK = positiveInteger(
    "SESSION_MAX_FRAMES_PER_TICK",
    128,
    1,
)

let server: net.Server | null = null
const activeSockets = new Set<net.Socket>()

export function handleRuntimeServerError(error: Error): void {
    const code = (error as NodeJS.ErrnoException).code ?? "unknown"
    console.error(`[TCP] session server error code=${code}:`, error.message)
}

/**
 * Wires one session socket: framing, handshake, dispatch and cleanup. With the
 * battle relay process enabled, a battle socket is moved to the child right
 * after its handshake frame and this function runs again for the
 * RelayProxySocket that replaces it, with the frames read so far as `initial`.
 */
function attachSessionSocket(socket: net.Socket, initial?: string): void {
    activeSockets.add(socket)
    socket.once("close", () => activeSockets.delete(socket))
    const remoteAddr = `${socket.remoteAddress}:${socket.remotePort}`
    gameVerboseLog(() => `[TCP] new connection from ${remoteAddr}`)

    socket.setNoDelay(true)
    socket.setKeepAlive(true, SESSION_TCP_KEEPALIVE_MS)
    socket.setEncoding("utf8")
    let buffer = ""
    let handshakeDone = false
    let isBattleSocket = false
    let isLoungeSocket = false
    let socketRemoved = false
    let protocolClosed = false
    let processingFrames = false
    let processFramesScheduled = false
    let handshakePending: Promise<void> | null = null
    let admissionToken: unknown, admissionSession: unknown

    const closeForProtocolViolation = (reason: string) => {
        if (protocolClosed) return
        protocolClosed = true
        buffer = ""
        markTcpDisconnectReason(socket, reason === "client build no longer admitted"
            ? "admission" : "protocol")
        console.warn(`[TCP] protocol violation from ${remoteAddr}: ${reason}`)
        fiveBossConnectionDiagnostics.socketEvent(socket, "protocol_close", reason.split(":", 1)[0])
        socket.destroy()
    }

    const handshakeTimer = setTimeout(() => {
        if (!handshakeDone) closeForProtocolViolation(`handshake timeout after ${SESSION_HANDSHAKE_TIMEOUT_MS}ms`)
    }, SESSION_HANDSHAKE_TIMEOUT_MS)
    handshakeTimer.unref()

    const clearHandshakeTimer = () => clearTimeout(handshakeTimer)

    const removeSocketClient = () => {
        clearReliableSendState(socket)
        detachLoungeSocket(socket)
        if (socketRemoved) return
        try {
            const client = sessionManager.findClientBySocket(socket)
            if (client) {
                socketRemoved = true
                void embeddedMultiCoordinator.enqueueRoomCommand(
                    client.roomNumber,
                    () => sessionManager.removeClient(client),
                ).catch(error => {
                    console.error(`[TCP] queued socket cleanup failed: room=${client.roomNumber}`, error)
                })
            }
        } catch {
            // Socket shutdown is best-effort. The room lease cleanup is
            // still able to remove an already detached connection.
        }
    }

    const processFrames = (): void => {
        if (protocolClosed || processingFrames || processFramesScheduled || handshakePending) return
        processingFrames = true
        let processed = 0
        try {
            while (!protocolClosed && processed < SESSION_MAX_FRAMES_PER_TICK) {
                const idx = buffer.indexOf("\0")
                if (idx < 0) break
                const raw = buffer.substring(0, idx)
                buffer = buffer.substring(idx + 1)
                processed++
                if (raw.trim().length === 0) continue
                const frameBytes = Buffer.byteLength(raw, "utf8")
                if (frameBytes > SESSION_MAX_FRAME_BYTES) {
                    closeForProtocolViolation(`frame exceeded ${SESSION_MAX_FRAME_BYTES} bytes`)
                    return
                }

                let data: any
                try {
                    data = JSON.parse(raw)
                } catch (e) {
                    closeForProtocolViolation(`invalid JSON frame: ${(e as Error).message}`)
                    return
                }
                try {
                    if (!handshakeDone) {
                        if (!data || typeof data !== "object" || typeof data.socklet !== "string") {
                            closeForProtocolViolation("first frame was not a valid handshake")
                            return
                        }
                        admissionToken = data.sp_admission
                        admissionSession = data.sp_session
                        if (!clientAdmission().checkActivity(admissionToken, admissionSession).ok) {
                            markTcpDisconnectReason(socket, "admission")
                            socket.end(JSON.stringify([1, "CLIENT_ADMISSION_REQUIRED"]) + "\0")
                            protocolClosed = true
                            clearHandshakeTimer()
                            return
                        }
                        isBattleSocket = data.socklet === "cooperation_battle"
                        isLoungeSocket = data.socklet === "multi_special_exchange_socklet"
                        if (isBattleSocket && !isRelayProxySocket(socket) && battleRelayBridge.isReady) {
                            const adopted = battleRelayBridge.adopt(socket)
                            if (adopted) {
                                // This closure no longer owns the socket. The
                                // proxy replays the handshake and anything
                                // after it through the normal path below.
                                protocolClosed = true
                                clearHandshakeTimer()
                                activeSockets.delete(socket)
                                attachSessionSocket(
                                    adopted.proxy as unknown as net.Socket,
                                    raw + "\0" + buffer + adopted.pending,
                                )
                                buffer = ""
                                return
                            }
                        }
                        const handshake = isLoungeSocket
                            ? handleLoungeHandshake(socket, data)
                            : handleHandshake(socket, data)
                        handshakePending = Promise.resolve(handshake).then(() => {
                            handshakePending = null
                            clearHandshakeTimer()
                            if (protocolClosed || socket.destroyed || socket.writableEnded) {
                                // The peer can close while an uncached
                                // handshake is still resolving. If the
                                // handler indexed the socket after the
                                // close callback ran, clean it now.
                                removeSocketClient()
                                return
                            }
                            handshakeDone = true
                            processFrames()
                        }, (err) => {
                            handshakePending = null
                            markTcpDisconnectReason(socket, "handshake_error")
                            console.error(`[TCP] handshake failed:`, err)
                            removeSocketClient()
                            socket.destroy()
                        })
                        // A client may coalesce Enter/heartbeat with its
                        // handshake in one TCP chunk. Do not dispatch
                        // those frames before the async handshake has
                        // indexed this socket in SessionManager.
                        return
                    } else if (!clientAdmission().checkActivity(admissionToken, admissionSession).ok) {
                        closeForProtocolViolation("client build no longer admitted")
                        return
                    } else if (isBattleSocket) {
                        handleBattleMessage(socket, data)
                    } else if (isLoungeSocket) {
                        handleLoungeMessage(socket, data)
                    } else {
                        const lobby = require("./lobby")
                        lobby.handleMessage(socket, data)
                    }
                } catch (e) {
                    markTcpDisconnectReason(socket, "message_error")
                    console.warn(`[TCP] message rejected from ${remoteAddr}:`, (e as Error).message)
                    socket.destroy()
                    return
                }
            }
        } finally {
            processingFrames = false
            if (!protocolClosed && !handshakePending
                && buffer.includes("\0") && !processFramesScheduled) {
                processFramesScheduled = true
                setImmediate(() => {
                    processFramesScheduled = false
                    processFrames()
                })
            }
        }
        if (!protocolClosed && Buffer.byteLength(buffer, "utf8") > SESSION_MAX_FRAME_BYTES) {
            closeForProtocolViolation(`unterminated frame exceeded ${SESSION_MAX_FRAME_BYTES} bytes`)
        }
    }

    const onData = (chunk: string) => {
        if (protocolClosed) return
        buffer += chunk
        if (Buffer.byteLength(buffer, "utf8") > SESSION_MAX_BUFFER_BYTES) {
            closeForProtocolViolation(`receive buffer exceeded ${SESSION_MAX_BUFFER_BYTES} bytes`)
            return
        }
        processFrames()
    }
    socket.on("data", onData)

    if (isRelayProxySocket(socket)) {
        // Frames the child relayed or acknowledged itself still count as
        // battle activity, and the client build must remain admitted.
        socket.on("relay-activity", (activity: RelayActivity) => {
            if (protocolClosed || !handshakeDone) return
            if (!clientAdmission().checkActivity(admissionToken, admissionSession).ok) {
                closeForProtocolViolation("client build no longer admitted")
                return
            }
            handleBattleRelayActivity(socket, activity)
        })
        socket.on("relay-close-reason", (reason: string, detail?: string) => {
            if (reason === "protocol") {
                markTcpDisconnectReason(socket, "protocol")
                console.warn(`[TCP] protocol violation from ${remoteAddr}: ${detail ?? "relay"}`)
            } else if (reason === "send_backpressure" || reason === "send_queue_limit") {
                markTcpDisconnectReason(socket, reason)
                console.warn(`[MULTI] slow battle connection removed by relay: reason=${reason} ${detail ?? ""}`
                    + ` remote=${remoteAddr}`)
            } else if (reason === "relay_exit") {
                markTcpDisconnectReason(socket, "relay_exit")
            }
        })
    }
    if (initial !== undefined) onData(initial)

    socket.on("end", () => {
        markTcpDisconnectReason(socket, "peer_fin")
        fiveBossConnectionDiagnostics.socketEvent(socket, "socket_end", "peer_fin")
    })

    socket.on("close", (hadError: boolean) => {
        const reason = finishTcpDisconnect(socket, hadError)
        const closedClient = sessionManager.findClientBySocket(socket)
        if (closedClient?.isBattle) {
            battleTelemetry.disconnected(closedClient.roomNumber, closedClient.viewerId, reason)
        }
        fiveBossConnectionDiagnostics.socketEvent(socket, "socket_close", hadError ? "with_error" : "without_error")
        clearHandshakeTimer()
        gameVerboseLog(() => `[TCP] connection closed: ${remoteAddr} reason=${reason}`)
        removeSocketClient()
    })

    socket.on("error", (err) => {
        markTcpDisconnectReason(socket, "socket_error")
        fiveBossConnectionDiagnostics.socketEvent(socket, "socket_error", (err as NodeJS.ErrnoException).code ?? "unknown")
        clearHandshakeTimer()
        console.warn(`[TCP] socket error from ${remoteAddr}:`, err.message)
        removeSocketClient()
    })
}

/** Starts the relay child when enabled; battle sockets stay in-process until it is ready. */
function startBattleRelay(): Promise<void> {
    if (!battleRelayProcessEnabled()) return Promise.resolve()
    const ready = battleRelayBridge.start().catch(error => {
        console.error("[BATTLE-RELAY] failed to start; battle sockets stay in the main process", error)
    })
    const timeout = new Promise<void>(resolve => setTimeout(resolve, 5_000).unref())
    return Promise.race([ready, timeout])
}

export async function startSessionServer(): Promise<void> {
    await startBattleRelay()
    return new Promise((resolve, reject) => {
        if (server) {
            resolve()
            return
        }
        server = net.createServer((socket) => attachSessionSocket(socket))

        observeServerConnections("tcp", server)
        const handleListenError = (error: Error) => {
            if (server) {
                try { server.close() } catch {}
                server = null
            }
            reject(error)
        }
        server.once("error", handleListenError)
        server.listen(SESSION_PORT, SESSION_HOST, () => {
            server?.off("error", handleListenError)
            // Accept-time failures (for example EMFILE) are emitted on the
            // listening server. Without a permanent listener they would become
            // process-level uncaught exceptions.
            server?.on("error", handleRuntimeServerError)
            console.log(`[TCP] session server listening on ${SESSION_HOST}:${SESSION_PORT}`)
            resolve()
        })
    })
}

/** The listening session server, if started (diagnostics and tests). */
export function getSessionServer(): net.Server | null {
    return server
}

export function stopSessionServer(): Promise<void> {
    return new Promise((resolve) => {
        const current = server
        if (!current) {
            resolve()
            return
        }
        // net.Server.close() stops accepts but waits forever for established
        // clients. Shutdown is already an explicit service stop, so release
        // those sockets now and let their normal cleanup enqueue room leases.
        for (const socket of activeSockets) {
            markTcpDisconnectReason(socket, "server_shutdown")
            socket.destroy()
        }
        current.close(() => {
            server = null
            void battleRelayBridge.stop().then(resolve)
        })
    })
}
