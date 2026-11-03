"use strict";
// Multi battle TCP session server
// Protocol: JSON messages delimited by null byte (\0)
// Post-handshake messages use typepacker format with useEnumIndex=true:
//   [index, param1, param2, ...]
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.stopSessionServer = exports.quiesceSessionServer = exports.getSessionServer = exports.startSessionServer = exports.handleRuntimeServerError = exports.SESSION_MAX_FRAMES_PER_TICK = exports.SESSION_TCP_KEEPALIVE_MS = exports.SESSION_MAX_BUFFER_BYTES = exports.SESSION_MAX_FRAME_BYTES = exports.SESSION_HANDSHAKE_TIMEOUT_MS = exports.SESSION_HOST = exports.SESSION_PORT = void 0;
const net = __importStar(require("net"));
const memory_diagnostics_1 = require("../../lib/memory-diagnostics");
const socket_admission_1 = require("../coordinator/socket-admission");
const handshake_1 = require("./handshake");
const battle_1 = require("./battle");
const bridge_1 = require("./battle-relay/bridge");
const protocol_1 = require("./battle-relay/protocol");
const SessionManager_1 = require("../state/SessionManager");
const game_logging_1 = require("../../lib/game-logging");
const reliable_send_1 = require("./reliable-send");
const disconnect_diagnostics_1 = require("./disconnect-diagnostics");
const embedded_1 = require("../coordinator/embedded");
const battle_telemetry_1 = require("../battle-telemetry");
const business_rpc_1 = require("../coordinator/business-rpc");
const manager_1 = require("../room/manager");
const connection_diagnostic_1 = require("../five-boss/connection-diagnostic");
const tcp_1 = require("../../lounge/tcp");
exports.SESSION_PORT = parseInt(process.env.SESSION_PORT || "8003");
exports.SESSION_HOST = process.env.SESSION_HOST || "0.0.0.0";
function positiveInteger(name, fallback, minimum) {
    var _a;
    const value = Number.parseInt((_a = process.env[name]) !== null && _a !== void 0 ? _a : "", 10);
    return Number.isFinite(value) ? Math.max(minimum, value) : fallback;
}
exports.SESSION_HANDSHAKE_TIMEOUT_MS = positiveInteger("SESSION_HANDSHAKE_TIMEOUT_MS", 15000, 1000);
exports.SESSION_MAX_FRAME_BYTES = positiveInteger("SESSION_MAX_FRAME_BYTES", 262144, 1024);
exports.SESSION_MAX_BUFFER_BYTES = positiveInteger("SESSION_MAX_BUFFER_BYTES", 1048576, exports.SESSION_MAX_FRAME_BYTES);
exports.SESSION_TCP_KEEPALIVE_MS = positiveInteger("SESSION_TCP_KEEPALIVE_MS", 10000, 1000);
// A client can deliver many complete frames in one `data` callback. Keep one
// noisy socket from monopolizing the Node event loop while another player's
// heartbeat or room broadcast is waiting to run. Frames for one socket remain
// ordered; the remainder is resumed with setImmediate below.
exports.SESSION_MAX_FRAMES_PER_TICK = positiveInteger("SESSION_MAX_FRAMES_PER_TICK", 128, 1);
let server = null;
let quiescing = false;
let listenerClosed;
const activeSockets = new Set();
function handleRuntimeServerError(error) {
    var _a;
    const code = (_a = error.code) !== null && _a !== void 0 ? _a : "unknown";
    console.error(`[TCP] session server error code=${code}:`, error.message);
}
exports.handleRuntimeServerError = handleRuntimeServerError;
function attachSessionSocket(socket, initial) {
    if (quiescing) {
        socket.destroy();
        return;
    }
    activeSockets.add(socket);
    socket.once("close", () => activeSockets.delete(socket));
    const remoteAddr = `${socket.remoteAddress}:${socket.remotePort}`;
    (0, game_logging_1.gameVerboseLog)(() => `[TCP] new connection from ${remoteAddr}`);
    socket.setNoDelay(true);
    socket.setKeepAlive(true, exports.SESSION_TCP_KEEPALIVE_MS);
    socket.setEncoding("utf8");
    let buffer = "";
    let handshakeDone = false;
    let isBattleSocket = false;
    let isLoungeSocket = false;
    let socketRemoved = false;
    let battleDisconnectRecorded = false;
    let closedReason;
    let protocolClosed = false;
    let processingFrames = false;
    let processFramesScheduled = false;
    let handshakePending = null;
    let receivedUnits = 0, consumedUnits = 0;
    const relayCompletions = [];
    const completeRelayFrames = () => {
        if (processingFrames || handshakePending)
            return;
        if (protocolClosed || socket.destroyed) {
            for (const pending of relayCompletions.splice(0))
                pending.done(new Error("relay_socket_closed"));
            return;
        }
        while (relayCompletions[0] && relayCompletions[0].boundary <= consumedUnits) {
            const pending = relayCompletions.shift();
            const client = SessionManager_1.sessionManager.findClientBySocket(socket);
            if (client)
                battle_telemetry_1.battleTelemetry.controlDelay(client.roomNumber, "relay-control", performance.now() - pending.at);
            pending.done();
        }
    };
    let admissionToken, admissionSession;
    const closeForProtocolViolation = (reason) => {
        if (protocolClosed)
            return;
        protocolClosed = true;
        buffer = "";
        (0, disconnect_diagnostics_1.markTcpDisconnectReason)(socket, reason === "client build no longer admitted"
            ? "admission" : "protocol");
        console.warn(`[TCP] protocol violation from ${remoteAddr}: ${reason}`);
        connection_diagnostic_1.fiveBossConnectionDiagnostics.socketEvent(socket, "protocol_close", reason.split(":", 1)[0]);
        socket.destroy();
    };
    const handshakeTimer = setTimeout(() => {
        if (!handshakeDone)
            closeForProtocolViolation(`handshake timeout after ${exports.SESSION_HANDSHAKE_TIMEOUT_MS}ms`);
    }, exports.SESSION_HANDSHAKE_TIMEOUT_MS);
    handshakeTimer.unref();
    const clearHandshakeTimer = () => clearTimeout(handshakeTimer);
    const recordBattleDisconnect = (client, reason) => {
        if (battleDisconnectRecorded || !(client === null || client === void 0 ? void 0 : client.isBattle) || client.superseded
            || !SessionManager_1.sessionManager.isCurrentBattleClient(client))
            return;
        battle_telemetry_1.battleTelemetry.disconnected(client.roomNumber, client.viewerId, reason);
        battleDisconnectRecorded = true;
    };
    const removeSocketClient = () => {
        (0, reliable_send_1.clearReliableSendState)(socket);
        (0, tcp_1.detachLoungeSocket)(socket);
        if (socketRemoved)
            return;
        try {
            const client = SessionManager_1.sessionManager.findClientBySocket(socket);
            if (client) {
                socketRemoved = true;
                void embedded_1.embeddedMultiCoordinator.enqueueRoomCommand(client.roomNumber, () => {
                    // An error cleanup may remove the socket index
                    // before close. Record its current owner once;
                    // superseded cleanup must not reset a replacement.
                    recordBattleDisconnect(client, closedReason !== null && closedReason !== void 0 ? closedReason : (0, disconnect_diagnostics_1.readTcpDisconnectReason)(socket));
                    return SessionManager_1.sessionManager.removeClient(client);
                }).catch(error => {
                    console.error(`[TCP] queued socket cleanup failed: room=${client.roomNumber}`, error);
                });
            }
        }
        catch (_a) {
            // Socket shutdown is best-effort. The room lease cleanup is
            // still able to remove an already detached connection.
        }
    };
    const runBusinessFrame = (operation) => {
        // The operation starts locally now. Its promise is only a lifetime/drain
        // fence; battle barriers and other sockets never wait for parent grant.
        void (0, business_rpc_1.runWithTcpBusinessAdmission)(operation).catch(error => {
            (0, disconnect_diagnostics_1.markTcpDisconnectReason)(socket, "message_error");
            console.warn("[TCP] accepted business frame failed:", error.message);
            socket.destroy();
        });
    };
    const processFrames = () => {
        if (quiescing || protocolClosed || processingFrames || processFramesScheduled || handshakePending)
            return;
        processingFrames = true;
        let processed = 0;
        try {
            while (!protocolClosed && processed < exports.SESSION_MAX_FRAMES_PER_TICK) {
                const idx = buffer.indexOf("\0");
                if (idx < 0)
                    break;
                const raw = buffer.substring(0, idx);
                buffer = buffer.substring(idx + 1);
                consumedUnits += idx + 1;
                processed++;
                if (raw.trim().length === 0)
                    continue;
                const frameBytes = Buffer.byteLength(raw, "utf8");
                if (frameBytes > exports.SESSION_MAX_FRAME_BYTES) {
                    closeForProtocolViolation(`frame exceeded ${exports.SESSION_MAX_FRAME_BYTES} bytes`);
                    return;
                }
                let data;
                try {
                    data = JSON.parse(raw);
                }
                catch (e) {
                    closeForProtocolViolation(`invalid JSON frame: ${e.message}`);
                    return;
                }
                try {
                    if (!handshakeDone) {
                        if (!data || typeof data !== "object" || typeof data.socklet !== "string") {
                            closeForProtocolViolation("first frame was not a valid handshake");
                            return;
                        }
                        admissionToken = data.sp_admission;
                        admissionSession = data.sp_session;
                        const handshake = (0, business_rpc_1.runWithTcpBusinessAdmission)(() => __awaiter(this, void 0, void 0, function* () {
                            if (!(yield (0, socket_admission_1.authorizeSocketAdmission)(socket, admissionToken, admissionSession))) {
                                (0, disconnect_diagnostics_1.markTcpDisconnectReason)(socket, "admission");
                                socket.end(JSON.stringify([1, "CLIENT_ADMISSION_REQUIRED"]) + "\0");
                                protocolClosed = true;
                                clearHandshakeTimer();
                                return;
                            }
                            isBattleSocket = data.socklet === "cooperation_battle";
                            isLoungeSocket = data.socklet === "multi_special_exchange_socklet";
                            if (isBattleSocket && !(0, bridge_1.isRelayProxySocket)(socket) && bridge_1.battleRelayBridge.isReady) {
                                const adopted = bridge_1.battleRelayBridge.adopt(socket);
                                if (adopted) {
                                    protocolClosed = true;
                                    clearHandshakeTimer();
                                    activeSockets.delete(socket);
                                    attachSessionSocket(adopted.proxy, raw + "\0" + buffer + adopted.pending);
                                    buffer = "";
                                    return;
                                }
                            }
                            yield (isLoungeSocket
                                ? (0, tcp_1.handleLoungeHandshake)(socket, data)
                                : (0, handshake_1.handleHandshake)(socket, data));
                        }));
                        handshakePending = Promise.resolve(handshake).then(() => {
                            handshakePending = null;
                            clearHandshakeTimer();
                            if (protocolClosed || socket.destroyed || socket.writableEnded) {
                                // The peer can close while an uncached
                                // handshake is still resolving. If the
                                // handler indexed the socket after the
                                // close callback ran, clean it now.
                                removeSocketClient();
                                return;
                            }
                            handshakeDone = true;
                            processFrames();
                        }, (err) => {
                            handshakePending = null;
                            (0, disconnect_diagnostics_1.markTcpDisconnectReason)(socket, "handshake_error");
                            console.error(`[TCP] handshake failed:`, err);
                            removeSocketClient();
                            socket.destroy();
                        });
                        // A client may coalesce Enter/heartbeat with its
                        // handshake in one TCP chunk. Do not dispatch
                        // those frames before the async handshake has
                        // indexed this socket in SessionManager.
                        return;
                    }
                    else if (!(0, socket_admission_1.checkSocketAdmission)(socket, admissionToken, admissionSession)) {
                        closeForProtocolViolation("client build no longer admitted");
                        return;
                    }
                    else if (isBattleSocket) {
                        if (Array.isArray(data) && data[0] === 0 && Array.isArray(data[1])
                            && [0, 1, 2].includes(data[1][0])) {
                            runBusinessFrame(() => (0, battle_1.handleBattleMessage)(socket, data));
                        }
                        else
                            (0, battle_1.handleBattleMessage)(socket, data);
                    }
                    else if (isLoungeSocket) {
                        const handled = Array.isArray(data) && data[0] === 0
                            && Array.isArray(data[1]) && data[1][0] === 4
                            ? (0, business_rpc_1.runWithTcpBusinessAdmission)(() => (0, tcp_1.handleLoungeMessage)(socket, data))
                            : (0, tcp_1.handleLoungeMessage)(socket, data);
                        if (handled && typeof handled.then === "function") {
                            handshakePending = Promise.resolve(handled).then(() => {
                                handshakePending = null;
                                if (!protocolClosed && !socket.destroyed)
                                    processFrames();
                            }, err => {
                                handshakePending = null;
                                (0, disconnect_diagnostics_1.markTcpDisconnectReason)(socket, "message_error");
                                console.warn("[TCP] lounge message rejected:", err.message);
                                socket.destroy();
                            });
                            return;
                        }
                    }
                    else {
                        const lobby = require("./lobby");
                        if (Array.isArray(data) && data[0] === 0 && Array.isArray(data[1])
                            && ![4, 5, 8, 9].includes(data[1][0])) {
                            runBusinessFrame(() => lobby.handleMessage(socket, data));
                        }
                        else
                            lobby.handleMessage(socket, data);
                    }
                }
                catch (e) {
                    (0, disconnect_diagnostics_1.markTcpDisconnectReason)(socket, "message_error");
                    console.warn(`[TCP] message rejected from ${remoteAddr}:`, e.message);
                    socket.destroy();
                    return;
                }
            }
        }
        finally {
            processingFrames = false;
            completeRelayFrames();
            if (!protocolClosed && !handshakePending
                && buffer.includes("\0") && !processFramesScheduled) {
                processFramesScheduled = true;
                setImmediate(() => {
                    processFramesScheduled = false;
                    processFrames();
                });
            }
        }
        if (!protocolClosed && Buffer.byteLength(buffer, "utf8") > exports.SESSION_MAX_FRAME_BYTES) {
            closeForProtocolViolation(`unterminated frame exceeded ${exports.SESSION_MAX_FRAME_BYTES} bytes`);
        }
    };
    const onData = (chunk) => {
        if (protocolClosed)
            return;
        receivedUnits += chunk.length;
        buffer += chunk;
        if (Buffer.byteLength(buffer, "utf8") > exports.SESSION_MAX_BUFFER_BYTES) {
            closeForProtocolViolation(`receive buffer exceeded ${exports.SESSION_MAX_BUFFER_BYTES} bytes`);
            return;
        }
        processFrames();
    };
    if ((0, bridge_1.isRelayProxySocket)(socket)) {
        socket.on("relay-frames", (chunk, done, identity) => {
            const at = performance.now();
            const apply = () => {
                var _a, _b, _c, _d;
                if (protocolClosed || socket.destroyed) {
                    done(new Error("relay_socket_closed"));
                    return;
                }
                const client = SessionManager_1.sessionManager.findClientBySocket(socket);
                const room = client && (0, manager_1.getRoom)(client.roomNumber);
                const rejection = !client || !(room === null || room === void 0 ? void 0 : room.lifecycle) || !SessionManager_1.sessionManager.isCurrentBattleClient(client) ? "unbound"
                    : (0, protocol_1.relayFramesIdentityRejection)({ instanceId: room.lifecycle.instanceId,
                        battleSessionId: room.lifecycle.battleSessionId, sceneEpoch: (_a = room.lifecycle.sceneEpoch) !== null && _a !== void 0 ? _a : 0 }, { instanceId: (_b = client.roomInstanceId) !== null && _b !== void 0 ? _b : "", battleSessionId: (_c = client.battleSessionId) !== null && _c !== void 0 ? _c : null,
                        sceneEpoch: (_d = client.sceneEpoch) !== null && _d !== void 0 ? _d : 0 }, identity, chunk);
                if (rejection) {
                    bridge_1.battleRelayBridge.noteRejectedFrames(rejection);
                    (0, game_logging_1.gameVerboseLog)(() => `[BATTLE-RELAY] rejected stale ingress: sid=${socket.sid} reason=${rejection}`);
                    // Invalid old ownership never acts on a replacement room. It
                    // still completes the application ACK and releases IPC budget.
                    done();
                    if (rejection !== "scene")
                        socket.destroy();
                    return;
                }
                relayCompletions.push({ boundary: receivedUnits + chunk.length, at, done });
                onData(chunk);
                completeRelayFrames();
            };
            // Adoption replays the native handshake before child ingress. Validate
            // against the resulting binding, never an unfinished handshake.
            if (handshakePending)
                void handshakePending.then(apply, () => done(new Error("relay_handshake_failed")));
            else
                apply();
        });
    }
    else
        socket.on("data", onData);
    if ((0, bridge_1.isRelayProxySocket)(socket)) {
        socket.on("relay-activity", (activity) => {
            if (protocolClosed || !handshakeDone)
                return;
            if (!(0, socket_admission_1.checkSocketAdmission)(socket, admissionToken, admissionSession)) {
                closeForProtocolViolation("client build no longer admitted");
                return;
            }
            (0, battle_1.handleBattleRelayActivity)(socket, activity);
        });
        socket.on("relay-close-reason", (reason, detail) => {
            if (reason === "protocol" || reason === "send_backpressure" || reason === "send_queue_limit" || reason === "relay_exit") {
                (0, disconnect_diagnostics_1.markTcpDisconnectReason)(socket, reason);
                (0, game_logging_1.gameVerboseLog)(() => `[BATTLE-RELAY] socket closed: reason=${reason} detail=${detail !== null && detail !== void 0 ? detail : ""}`);
            }
        });
    }
    socket.on("end", () => {
        (0, disconnect_diagnostics_1.markTcpDisconnectReason)(socket, "peer_fin");
        connection_diagnostic_1.fiveBossConnectionDiagnostics.socketEvent(socket, "socket_end", "peer_fin");
    });
    socket.on("close", (hadError) => {
        for (const pending of relayCompletions.splice(0))
            pending.done(new Error("relay_socket_closed"));
        const reason = (0, disconnect_diagnostics_1.finishTcpDisconnect)(socket, hadError);
        closedReason = reason;
        const closedClient = SessionManager_1.sessionManager.findClientBySocket(socket);
        recordBattleDisconnect(closedClient, reason);
        connection_diagnostic_1.fiveBossConnectionDiagnostics.socketEvent(socket, "socket_close", hadError ? "with_error" : "without_error");
        clearHandshakeTimer();
        (0, game_logging_1.gameVerboseLog)(() => `[TCP] connection closed: ${remoteAddr} reason=${reason}`);
        removeSocketClient();
    });
    socket.on("error", (err) => {
        var _a;
        (0, disconnect_diagnostics_1.markTcpDisconnectReason)(socket, "socket_error");
        connection_diagnostic_1.fiveBossConnectionDiagnostics.socketEvent(socket, "socket_error", (_a = err.code) !== null && _a !== void 0 ? _a : "unknown");
        clearHandshakeTimer();
        console.warn(`[TCP] socket error from ${remoteAddr}:`, err.message);
        removeSocketClient();
    });
    // Attach all cleanup handlers before replaying handshake/coalesced bytes.
    if (initial !== undefined)
        onData(initial);
}
function startBattleRelay() {
    return __awaiter(this, void 0, void 0, function* () {
        if (!(0, bridge_1.battleRelayProcessEnabled)())
            return;
        const ready = bridge_1.battleRelayBridge.start().catch(error => {
            console.error("[BATTLE-RELAY] failed to start; battle sockets stay in the main process", error);
        });
        yield Promise.race([ready, new Promise(resolve => setTimeout(resolve, 5000).unref())]);
    });
}
function startSessionServer() {
    return __awaiter(this, void 0, void 0, function* () {
        if (server)
            return;
        quiescing = false;
        listenerClosed = undefined;
        yield startBattleRelay();
        return new Promise((resolve, reject) => {
            if (server) {
                resolve();
                return;
            }
            server = net.createServer(socket => attachSessionSocket(socket));
            (0, memory_diagnostics_1.observeServerConnections)("tcp", server);
            const handleListenError = (error) => {
                if (server) {
                    try {
                        server.close();
                    }
                    catch (_a) { }
                    server = null;
                }
                reject(error);
            };
            server.once("error", handleListenError);
            server.listen(exports.SESSION_PORT, exports.SESSION_HOST, () => {
                server === null || server === void 0 ? void 0 : server.off("error", handleListenError);
                // Accept-time failures (for example EMFILE) are emitted on the
                // listening server. Without a permanent listener they would become
                // process-level uncaught exceptions.
                server === null || server === void 0 ? void 0 : server.on("error", handleRuntimeServerError);
                console.log(`[TCP] session server listening on ${exports.SESSION_HOST}:${exports.SESSION_PORT}`);
                resolve();
            });
        });
    });
}
exports.startSessionServer = startSessionServer;
/** The listening session server, if started (diagnostics and tests). */
function getSessionServer() {
    return server;
}
exports.getSessionServer = getSessionServer;
/** Close ingress while retaining sockets/room state for already accepted work. */
function quiesceSessionServer() {
    if (quiescing)
        return;
    quiescing = true;
    for (const socket of activeSockets)
        socket.pause();
    (0, battle_1.discardPinnedBattleControlsForShutdown)();
    const current = server;
    if (current === null || current === void 0 ? void 0 : current.listening)
        listenerClosed = new Promise(resolve => current.close(() => resolve()));
}
exports.quiesceSessionServer = quiesceSessionServer;
function stopSessionServer() {
    quiesceSessionServer();
    (0, socket_admission_1.stopSocketAdmission)();
    return new Promise((resolve) => {
        const current = server;
        if (!current) {
            void bridge_1.battleRelayBridge.stop().then(resolve);
            return;
        }
        // net.Server.close() stops accepts but waits forever for established
        // clients. Shutdown is already an explicit service stop, so release
        // those sockets now and let their normal cleanup enqueue room leases.
        for (const socket of activeSockets) {
            (0, disconnect_diagnostics_1.markTcpDisconnectReason)(socket, "server_shutdown");
            socket.destroy();
        }
        const finish = () => {
            server = null;
            void bridge_1.battleRelayBridge.stop().then(resolve);
        };
        if (listenerClosed)
            void listenerClosed.then(finish);
        else if (!current.listening)
            finish();
        else
            current.close(finish);
    });
}
exports.stopSessionServer = stopSessionServer;
