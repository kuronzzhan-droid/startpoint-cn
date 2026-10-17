// Multi battle TCP session server
// Protocol: JSON messages delimited by null byte (\0)
// Post-handshake messages use typepacker format with useEnumIndex=true:
//   [index, param1, param2, ...]

import * as net from "net"
import { observeServerConnections } from "../../lib/memory-diagnostics"
import { authorizeSocketAdmission, checkSocketAdmission, stopSocketAdmission } from "../coordinator/socket-admission"
import { handleHandshake } from "./handshake"
import { handleBattleMessage, handleBattleRelayActivity, discardPinnedBattleControlsForShutdown } from "./battle"
import { battleRelayBridge, battleRelayProcessEnabled, isRelayProxySocket } from "./battle-relay/bridge"
import { relayFramesIdentityRejection, type RelayActivity, type RelayRoomIdentity } from "./battle-relay/protocol"
import { sessionManager } from "../state/SessionManager"
import { gameVerboseLog } from "../../lib/game-logging"
import { clearReliableSendState } from "./reliable-send"
import {
    finishTcpDisconnect,
    markTcpDisconnectReason,
    readTcpDisconnectReason,
    type TcpDisconnectReason,
} from "./disconnect-diagnostics"
import { embeddedMultiCoordinator } from "../coordinator/embedded"
import { battleTelemetry } from "../battle-telemetry"
import { runWithTcpBusinessAdmission } from "../coordinator/business-rpc"
import { getRoom } from "../room/manager"
import { fiveBossConnectionDiagnostics } from "../five-boss/connection-diagnostic"
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
let quiescing = false
let listenerClosed: Promise<void> | undefined
const activeSockets = new Set<net.Socket>()

export function handleRuntimeServerError(error: Error): void {
    const code = (error as NodeJS.ErrnoException).code ?? "unknown"
    console.error(`[TCP] session server error code=${code}:`, error.message)
}

function attachSessionSocket(socket: net.Socket, initial?: string): void {
    if (quiescing) { socket.destroy(); return }
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
    let battleDisconnectRecorded = false
    let closedReason: TcpDisconnectReason | undefined
    let protocolClosed = false
    let processingFrames = false
    let processFramesScheduled = false
    let handshakePending: Promise<void> | null = null
    let receivedUnits = 0, consumedUnits = 0
    const relayCompletions: Array<{ boundary: number; at: number; done: (error?: Error) => void }> = []
    const completeRelayFrames = () => {
        if (processingFrames || handshakePending) return
        if (protocolClosed || socket.destroyed) {
            for (const pending of relayCompletions.splice(0)) pending.done(new Error("relay_socket_closed"))
            return
        }
        while (relayCompletions[0] && relayCompletions[0].boundary <= consumedUnits) {
            const pending = relayCompletions.shift()!
            const client = sessionManager.findClientBySocket(socket)
            if (client) battleTelemetry.controlDelay(client.roomNumber, "relay-control", performance.now() - pending.at)
            pending.done()
        }
    }
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

    const recordBattleDisconnect = (client: ReturnType<typeof sessionManager.findClientBySocket>,
        reason: TcpDisconnectReason) => {
        if (battleDisconnectRecorded || !client?.isBattle || client.superseded
            || !sessionManager.isCurrentBattleClient(client)) return
        battleTelemetry.disconnected(client.roomNumber, client.viewerId, reason)
        battleDisconnectRecorded = true
    }

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
                    () => {
                        // An error cleanup may remove the socket index
                        // before close. Record its current owner once;
                        // superseded cleanup must not reset a replacement.
                        recordBattleDisconnect(client, closedReason ?? readTcpDisconnectReason(socket))
                        return sessionManager.removeClient(client)
                    },
                ).catch(error => {
                    console.error(`[TCP] queued socket cleanup failed: room=${client.roomNumber}`, error)
                })
            }
        } catch {
            // Socket shutdown is best-effort. The room lease cleanup is
            // still able to remove an already detached connection.
        }
    }

    const runBusinessFrame = (operation: () => unknown): void => {
        // The operation starts locally now. Its promise is only a lifetime/drain
        // fence; battle barriers and other sockets never wait for parent grant.
        void runWithTcpBusinessAdmission(operation).catch(error => {
            markTcpDisconnectReason(socket, "message_error")
            console.warn("[TCP] accepted business frame failed:", (error as Error).message)
            socket.destroy()
        })
    }

    const processFrames = (): void => {
        if (quiescing || protocolClosed || processingFrames || processFramesScheduled || handshakePending) return
        processingFrames = true
        let processed = 0
        try {
            while (!protocolClosed && processed < SESSION_MAX_FRAMES_PER_TICK) {
                const idx = buffer.indexOf("\0")
                if (idx < 0) break
                const raw = buffer.substring(0, idx)
                buffer = buffer.substring(idx + 1)
                consumedUnits += idx + 1
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
                        const handshake = runWithTcpBusinessAdmission(async () => {
                        if (!await authorizeSocketAdmission(socket, admissionToken, admissionSession)) {
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
                                protocolClosed = true
                                clearHandshakeTimer()
                                activeSockets.delete(socket)
                                attachSessionSocket(adopted.proxy as unknown as net.Socket, raw + "\0" + buffer + adopted.pending)
                                buffer = ""
                                return
                            }
                        }
                        await (isLoungeSocket
                            ? handleLoungeHandshake(socket, data)
                            : handleHandshake(socket, data))
                        })
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
                    } else if (!checkSocketAdmission(socket, admissionToken, admissionSession)) {
                        closeForProtocolViolation("client build no longer admitted")
                        return
                    } else if (isBattleSocket) {
                        if (Array.isArray(data) && data[0] === 0 && Array.isArray(data[1])
                            && [0, 1, 2].includes(data[1][0])) {
                            runBusinessFrame(() => handleBattleMessage(socket, data))
                        } else handleBattleMessage(socket, data)
                    } else if (isLoungeSocket) {
                        const handled = Array.isArray(data) && data[0] === 0
                            && Array.isArray(data[1]) && data[1][0] === 4
                            ? runWithTcpBusinessAdmission(() => handleLoungeMessage(socket, data))
                            : handleLoungeMessage(socket, data)
                        if (handled && typeof (handled as Promise<void>).then === "function") {
                            handshakePending = Promise.resolve(handled).then(() => {
                                handshakePending = null
                                if (!protocolClosed && !socket.destroyed) processFrames()
                            }, err => {
                                handshakePending = null
                                markTcpDisconnectReason(socket, "message_error")
                                console.warn("[TCP] lounge message rejected:", (err as Error).message)
                                socket.destroy()
                            })
                            return
                        }
                    } else {
                        const lobby = require("./lobby")
                        if (Array.isArray(data) && data[0] === 0 && Array.isArray(data[1])
                            && ![4, 5, 8, 9].includes(data[1][0])) {
                            runBusinessFrame(() => lobby.handleMessage(socket, data))
                        } else lobby.handleMessage(socket, data)
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
            completeRelayFrames()
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
        receivedUnits += chunk.length
        buffer += chunk
        if (Buffer.byteLength(buffer, "utf8") > SESSION_MAX_BUFFER_BYTES) {
            closeForProtocolViolation(`receive buffer exceeded ${SESSION_MAX_BUFFER_BYTES} bytes`)
            return
        }
        processFrames()
    }
    if (isRelayProxySocket(socket)) {
        socket.on("relay-frames", (chunk: string, done: (error?: Error) => void, identity?: RelayRoomIdentity) => {
            const at = performance.now()
            const apply = () => {
                if (protocolClosed || socket.destroyed) { done(new Error("relay_socket_closed")); return }
                const client = sessionManager.findClientBySocket(socket)
                const room = client && getRoom(client.roomNumber)
                const rejection = !client || !room?.lifecycle || !sessionManager.isCurrentBattleClient(client) ? "unbound"
                    : relayFramesIdentityRejection({ instanceId: room.lifecycle.instanceId,
                        battleSessionId: room.lifecycle.battleSessionId, sceneEpoch: room.lifecycle.sceneEpoch ?? 0 },
                    { instanceId: client.roomInstanceId ?? "", battleSessionId: client.battleSessionId ?? null,
                        sceneEpoch: client.sceneEpoch ?? 0 }, identity, chunk)
                if (rejection) {
                    battleRelayBridge.noteRejectedFrames(rejection)
                    gameVerboseLog(() => `[BATTLE-RELAY] rejected stale ingress: sid=${socket.sid} reason=${rejection}`)
                    // Invalid old ownership never acts on a replacement room. It
                    // still completes the application ACK and releases IPC budget.
                    done()
                    if (rejection !== "scene") socket.destroy()
                    return
                }
                relayCompletions.push({ boundary: receivedUnits + chunk.length, at, done })
                onData(chunk)
                completeRelayFrames()
            }
            // Adoption replays the native handshake before child ingress. Validate
            // against the resulting binding, never an unfinished handshake.
            if (handshakePending) void handshakePending.then(apply, () => done(new Error("relay_handshake_failed")))
            else apply()
        })
    } else socket.on("data", onData)

    if (isRelayProxySocket(socket)) {
        socket.on("relay-activity", (activity: RelayActivity) => {
            if (protocolClosed || !handshakeDone) return
            if (!checkSocketAdmission(socket, admissionToken, admissionSession)) {
                closeForProtocolViolation("client build no longer admitted")
                return
            }
            handleBattleRelayActivity(socket, activity)
        })
        socket.on("relay-close-reason", (reason: string, detail?: string) => {
            if (reason === "protocol" || reason === "send_backpressure" || reason === "send_queue_limit" || reason === "relay_exit") {
                markTcpDisconnectReason(socket, reason)
                gameVerboseLog(() => `[BATTLE-RELAY] socket closed: reason=${reason} detail=${detail ?? ""}`)
            }
        })
    }

    socket.on("end", () => {
        markTcpDisconnectReason(socket, "peer_fin")
        fiveBossConnectionDiagnostics.socketEvent(socket, "socket_end", "peer_fin")
    })

    socket.on("close", (hadError: boolean) => {
        for (const pending of relayCompletions.splice(0)) pending.done(new Error("relay_socket_closed"))
        const reason = finishTcpDisconnect(socket, hadError)
        closedReason = reason
        const closedClient = sessionManager.findClientBySocket(socket)
        recordBattleDisconnect(closedClient, reason)
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
    // Attach all cleanup handlers before replaying handshake/coalesced bytes.
    if (initial !== undefined) onData(initial)
}

async function startBattleRelay(): Promise<void> {
    if (!battleRelayProcessEnabled()) return
    const ready = battleRelayBridge.start().catch(error => {
        console.error("[BATTLE-RELAY] failed to start; battle sockets stay in the main process", error)
    })
    await Promise.race([ready, new Promise<void>(resolve => setTimeout(resolve, 5_000).unref())])
}

export async function startSessionServer(): Promise<void> {
    if (server) return
    quiescing = false; listenerClosed = undefined
    await startBattleRelay()
    return new Promise((resolve, reject) => {
        if (server) { resolve(); return }
        server = net.createServer(socket => attachSessionSocket(socket))

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

/** Close ingress while retaining sockets/room state for already accepted work. */
export function quiesceSessionServer(): void {
    if (quiescing) return
    quiescing = true
    for (const socket of activeSockets) socket.pause()
    discardPinnedBattleControlsForShutdown()
    const current = server
    if (current?.listening) listenerClosed = new Promise(resolve => current.close(() => resolve()))
}

export function stopSessionServer(): Promise<void> {
    quiesceSessionServer()
    stopSocketAdmission()
    return new Promise((resolve) => {
        const current = server
        if (!current) {
            void battleRelayBridge.stop().then(resolve)
            return
        }
        // net.Server.close() stops accepts but waits forever for established
        // clients. Shutdown is already an explicit service stop, so release
        // those sockets now and let their normal cleanup enqueue room leases.
        for (const socket of activeSockets) {
            markTcpDisconnectReason(socket, "server_shutdown")
            socket.destroy()
        }
        const finish = () => {
            server = null
            void battleRelayBridge.stop().then(resolve)
        }
        if (listenerClosed) void listenerClosed.then(finish)
        else if (!current.listening) finish()
        else current.close(finish)
    })
}
