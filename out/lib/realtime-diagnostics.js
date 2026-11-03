"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordRealtimeDiagnostic = exports.getRealtimeDiagnostics = exports.configureRealtimeDiagnostics = void 0;
const memory_diagnostics_1 = require("./memory-diagnostics");
const state = {
    mode: "basic",
    expiresAt: 0,
    maxEvents: 256,
    events: [],
    droppedEvents: 0,
};
function expireIfNeeded(now = Date.now()) {
    if (state.mode !== "basic" && state.expiresAt > 0 && state.expiresAt <= now) {
        state.mode = "basic";
        state.roomNumber = undefined;
        state.expiresAt = 0;
        state.events = [];
        state.droppedEvents = 0;
    }
}
function positiveInteger(value, fallback, min, max) {
    const parsed = typeof value === "number" ? value : Number(value);
    if (!Number.isSafeInteger(parsed))
        return fallback;
    return Math.min(max, Math.max(min, parsed));
}
function configureRealtimeDiagnostics(input) {
    const mode = input.mode === "room-trace" ? "room-trace" : "basic";
    if (mode === "room-trace") {
        const roomNumber = typeof input.roomNumber === "string" ? input.roomNumber.trim() : "";
        if (!roomNumber)
            throw new Error("room-trace 模式必须指定 roomNumber");
        state.mode = mode;
        state.roomNumber = roomNumber.slice(0, 128);
        state.expiresAt = Date.now() + positiveInteger(input.ttlMs, 10 * 60000, 30000, 30 * 60000);
        state.maxEvents = positiveInteger(input.maxEvents, 256, 16, 2000);
        state.events = [];
        state.droppedEvents = 0;
    }
    else {
        state.mode = "basic";
        state.roomNumber = undefined;
        state.expiresAt = 0;
        state.events = [];
        state.droppedEvents = 0;
    }
    return getRealtimeDiagnostics();
}
exports.configureRealtimeDiagnostics = configureRealtimeDiagnostics;
function getRealtimeDiagnostics() {
    var _a;
    expireIfNeeded();
    const remainingMs = state.expiresAt > 0 ? Math.max(0, state.expiresAt - Date.now()) : 0;
    return {
        mode: state.mode,
        roomNumber: (_a = state.roomNumber) !== null && _a !== void 0 ? _a : null,
        expiresAt: state.expiresAt > 0 ? new Date(state.expiresAt).toISOString() : null,
        remainingMs,
        maxEvents: state.maxEvents,
        bufferedEvents: state.events.length,
        droppedEvents: state.droppedEvents,
        events: [...state.events],
    };
}
exports.getRealtimeDiagnostics = getRealtimeDiagnostics;
/** Record bounded metadata for one selected room without serializing payloads. */
function recordRealtimeDiagnostic(roomNumber, event, details) {
    expireIfNeeded();
    if (state.mode !== "room-trace" || state.roomNumber !== roomNumber)
        return;
    if (state.events.length >= state.maxEvents) {
        state.droppedEvents++;
        return;
    }
    state.events.push(Object.assign({ at: new Date().toISOString(), roomNumber, event: event.slice(0, 80) }, (details ? { details } : {})));
}
exports.recordRealtimeDiagnostic = recordRealtimeDiagnostic;
(0, memory_diagnostics_1.registerMemoryCounters)("realtimeDiagnostics", () => {
    expireIfNeeded();
    return {
        modeRoomTrace: state.mode === "room-trace",
        traceRoomActive: state.roomNumber ? 1 : 0,
        traceRemainingMs: state.expiresAt > 0 ? Math.max(0, state.expiresAt - Date.now()) : 0,
        bufferedEvents: state.events.length,
        droppedEvents: state.droppedEvents,
    };
});
