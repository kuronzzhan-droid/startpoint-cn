"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getReliableSendQueueStats = exports.clearReliableSendState = exports.sendFrameReliably = void 0;
const chain_diagnostic_1 = require("./chain-diagnostic");
const memory_diagnostics_1 = require("../../lib/memory-diagnostics");
const disconnect_diagnostics_1 = require("./disconnect-diagnostics");
const battle_telemetry_1 = require("../battle-telemetry");
const socketStates = new WeakMap();
const closedAttemptLogged = new WeakSet();
let queuedMessages = 0, queuedBytes = 0;
(0, memory_diagnostics_1.registerMemoryCounters)("tcpSendQueue", () => ({ queuedMessages, queuedBytes }));
function discardQueue(state) {
    queuedMessages -= state.queue.length;
    queuedBytes -= state.queuedBytes;
    state.queue.length = 0;
    state.queuedBytes = 0;
}
function positiveInteger(name, fallback, minimum = 1) {
    const parsed = parseInt(process.env[name] || "", 10);
    return Number.isFinite(parsed) ? Math.max(minimum, parsed) : fallback;
}
const MAX_MESSAGES = positiveInteger("MULTI_SEND_QUEUE_MAX_MESSAGES", 512);
const MAX_BYTES = positiveInteger("MULTI_SEND_QUEUE_MAX_BYTES", 4 * 1024 * 1024, 1024);
const MAX_AGE_MS = positiveInteger("MULTI_SEND_QUEUE_MAX_AGE_MS", 15000, 1000);
const MIN_DIAGNOSTIC_BLOCK_MS = positiveInteger("MULTI_CHAIN_SEND_DIAGNOSTIC_MIN_BLOCK_MS", 100);
function describe(context) {
    var _a, _b, _c, _d, _e;
    if (!context)
        return "";
    return ` room=${(_a = context.roomNumber) !== null && _a !== void 0 ? _a : "?"}`
        + ` connection=${(_b = context.connectionId) !== null && _b !== void 0 ? _b : "?"}`
        + ` viewer=${(_c = context.viewerId) !== null && _c !== void 0 ? _c : "?"}`
        + ` generation=${(_d = context.roomGeneration) !== null && _d !== void 0 ? _d : "?"}`
        + ` channel=${(_e = context.channel) !== null && _e !== void 0 ? _e : "?"}`;
}
function clearTimer(state) {
    if (state.timeout)
        clearTimeout(state.timeout);
    state.timeout = undefined;
}
function blockedDuration(state, now = Date.now()) {
    return state.blockedSince === 0 ? 0 : Math.max(0, now - state.blockedSince);
}
function beginBackpressure(state, context) {
    if (state.blockedSince !== 0)
        return;
    state.blockedSince = Date.now();
    state.episodeContext = context !== null && context !== void 0 ? context : state.context;
    state.peakQueuedMessages = state.queue.length;
    state.peakQueuedBytes = state.queuedBytes;
    state.terminalRecorded = false;
}
function updateQueuePeaks(state) {
    state.peakQueuedMessages = Math.max(state.peakQueuedMessages, state.queue.length);
    state.peakQueuedBytes = Math.max(state.peakQueuedBytes, state.queuedBytes);
}
function diagnosticDetails(state) {
    return {
        blockedMs: blockedDuration(state),
        queuedMessages: state.queue.length,
        queuedBytes: state.queuedBytes,
        peakQueuedMessages: state.peakQueuedMessages,
        peakQueuedBytes: state.peakQueuedBytes,
    };
}
function recordTerminalAnomaly(state, anomaly, details = {}) {
    var _a, _b;
    if (state.terminalRecorded)
        return;
    state.terminalRecorded = true;
    const context = (_a = state.episodeContext) !== null && _a !== void 0 ? _a : state.context;
    battle_telemetry_1.battleTelemetry.backpressure(context === null || context === void 0 ? void 0 : context.roomNumber, context === null || context === void 0 ? void 0 : context.viewerId, blockedDuration(state));
    (0, chain_diagnostic_1.recordBattleSendAnomaly)(anomaly, (_b = state.episodeContext) !== null && _b !== void 0 ? _b : state.context, Object.assign(Object.assign({}, diagnosticDetails(state)), details));
}
function resetBackpressure(state) {
    state.blockedSince = 0;
    state.episodeContext = undefined;
    state.peakQueuedMessages = 0;
    state.peakQueuedBytes = 0;
    state.terminalRecorded = false;
}
function recordBackpressureRecovery(state) {
    var _a, _b;
    const blockedMs = blockedDuration(state);
    if (blockedMs >= MIN_DIAGNOSTIC_BLOCK_MS) {
        const context = (_a = state.episodeContext) !== null && _a !== void 0 ? _a : state.context;
        battle_telemetry_1.battleTelemetry.backpressure(context === null || context === void 0 ? void 0 : context.roomNumber, context === null || context === void 0 ? void 0 : context.viewerId, blockedMs);
        (0, chain_diagnostic_1.recordBattleSendAnomaly)("backpressure_recovered", (_b = state.episodeContext) !== null && _b !== void 0 ? _b : state.context, Object.assign(Object.assign({}, diagnosticDetails(state)), { queuedMessages: 0, queuedBytes: 0 }));
    }
    resetBackpressure(state);
}
function disconnectSlowSocket(socket, state, reason) {
    const queuedMessages = state.queue.length;
    const queuedBytes = state.queuedBytes;
    recordTerminalAnomaly(state, reason, {
        maxMessages: MAX_MESSAGES,
        maxBytes: MAX_BYTES,
        maxAgeMs: MAX_AGE_MS,
    });
    clearTimer(state);
    discardQueue(state);
    console.warn(`[MULTI] slow battle connection removed: reason=${reason}`
        + ` queuedMessages=${queuedMessages} queuedBytes=${queuedBytes}`
        + describe(state.context));
    (0, disconnect_diagnostics_1.markTcpDisconnectReason)(socket, reason === "queue_limit"
        ? "send_queue_limit" : "send_backpressure");
    if (!socket.destroyed)
        socket.destroy();
}
function armTimeout(socket, state) {
    var _a;
    clearTimer(state);
    const startedAt = state.blockedSince || ((_a = state.queue[0]) === null || _a === void 0 ? void 0 : _a.queuedAt) || Date.now();
    const remaining = Math.max(1, MAX_AGE_MS - (Date.now() - startedAt));
    state.timeout = setTimeout(() => {
        const current = socketStates.get(socket);
        if (current !== state || socket.destroyed)
            return;
        disconnectSlowSocket(socket, state, "backpressure_timeout");
    }, remaining);
    state.timeout.unref();
}
function ensureState(socket) {
    let state = socketStates.get(socket);
    if (state)
        return state;
    state = {
        queue: [],
        queuedBytes: 0,
        blockedSince: 0,
        drainListening: false,
        peakQueuedMessages: 0,
        peakQueuedBytes: 0,
        terminalRecorded: false,
    };
    socketStates.set(socket, state);
    const cleanup = () => clearReliableSendState(socket);
    socket.once("close", cleanup);
    socket.once("error", cleanup);
    return state;
}
function listenForDrain(socket, state) {
    if (state.drainListening || socket.destroyed)
        return;
    state.drainListening = true;
    socket.once("drain", () => {
        const current = socketStates.get(socket);
        if (current !== state || socket.destroyed)
            return;
        state.drainListening = false;
        clearTimer(state);
        while (state.queue.length > 0 && socket.writable && !socket.destroyed) {
            const next = state.queue.shift();
            state.queuedBytes -= next.bytes;
            queuedMessages--;
            queuedBytes -= next.bytes;
            state.context = next.context;
            let writable = false;
            try {
                writable = socket.write(next.frame);
            }
            catch (error) {
                recordTerminalAnomaly(state, "write_error", {
                    error: error instanceof Error ? error.message : String(error),
                });
                console.warn(`[MULTI] battle socket write failed:${describe(next.context)}`, error instanceof Error ? error.message : String(error));
                (0, disconnect_diagnostics_1.markTcpDisconnectReason)(socket, "send_write_error");
                if (!socket.destroyed)
                    socket.destroy();
                return;
            }
            if (!writable) {
                beginBackpressure(state, next.context);
                updateQueuePeaks(state);
                listenForDrain(socket, state);
                armTimeout(socket, state);
                return;
            }
        }
        if (state.queue.length === 0) {
            recordBackpressureRecovery(state);
            state.context = undefined;
        }
    });
}
function sendFrameReliably(socket, frame, context) {
    if (!socket.writable || socket.destroyed) {
        if (!closedAttemptLogged.has(socket)) {
            closedAttemptLogged.add(socket);
            (0, chain_diagnostic_1.recordBattleSendAnomaly)("send_on_closed_socket", context);
        }
        return "closed";
    }
    const state = ensureState(socket);
    state.context = context;
    if (state.blockedSince !== 0 || state.queue.length > 0) {
        const bytes = Buffer.byteLength(frame);
        if (state.queue.length + 1 > MAX_MESSAGES || state.queuedBytes + bytes > MAX_BYTES) {
            disconnectSlowSocket(socket, state, "queue_limit");
            return "closed";
        }
        state.queue.push({ frame, bytes, queuedAt: Date.now(), context });
        state.queuedBytes += bytes;
        queuedMessages++;
        queuedBytes += bytes;
        beginBackpressure(state, context);
        updateQueuePeaks(state);
        listenForDrain(socket, state);
        armTimeout(socket, state);
        return "queued";
    }
    try {
        const writable = socket.write(frame);
        if (!writable) {
            beginBackpressure(state, context);
            updateQueuePeaks(state);
            listenForDrain(socket, state);
            armTimeout(socket, state);
        }
        return "sent";
    }
    catch (error) {
        recordTerminalAnomaly(state, "write_error", {
            error: error instanceof Error ? error.message : String(error),
        });
        console.warn(`[MULTI] battle socket write failed:${describe(context)}`, error instanceof Error ? error.message : String(error));
        (0, disconnect_diagnostics_1.markTcpDisconnectReason)(socket, "send_write_error");
        if (!socket.destroyed)
            socket.destroy();
        return "closed";
    }
}
exports.sendFrameReliably = sendFrameReliably;
function clearReliableSendState(socket) {
    const state = socketStates.get(socket);
    if (!state)
        return;
    if (state.blockedSince !== 0 && !state.terminalRecorded) {
        recordTerminalAnomaly(state, "socket_closed_during_backpressure");
    }
    clearTimer(state);
    discardQueue(state);
    socketStates.delete(socket);
}
exports.clearReliableSendState = clearReliableSendState;
function getReliableSendQueueStats(socket) {
    var _a, _b, _c;
    const state = socketStates.get(socket);
    return {
        messages: (_a = state === null || state === void 0 ? void 0 : state.queue.length) !== null && _a !== void 0 ? _a : 0,
        bytes: (_b = state === null || state === void 0 ? void 0 : state.queuedBytes) !== null && _b !== void 0 ? _b : 0,
        blocked: ((_c = state === null || state === void 0 ? void 0 : state.blockedSince) !== null && _c !== void 0 ? _c : 0) !== 0,
    };
}
exports.getReliableSendQueueStats = getReliableSendQueueStats;
