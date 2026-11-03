"use strict";
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
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.isAutomaticChainFallbackEnabled = exports.isBattleSendDiagnosticEnabled = exports.recordBattleSendAnomaly = exports.clearChainDiagnosticRoom = exports.recordBattleNotify = exports.recordBattleRelay = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
function enabled(value) {
    return /^(1|true|yes|on)$/i.test(value !== null && value !== void 0 ? value : "false");
}
const FULL_DIAGNOSTIC_ENABLED = enabled(process.env.MULTI_CHAIN_DIAGNOSTIC);
const SEND_DIAGNOSTIC_ENABLED = enabled((_a = process.env.MULTI_CHAIN_SEND_DIAGNOSTIC) !== null && _a !== void 0 ? _a : process.env.MULTI_CHAIN_DIAGNOSTIC);
const ANY_DIAGNOSTIC_ENABLED = FULL_DIAGNOSTIC_ENABLED || SEND_DIAGNOSTIC_ENABLED;
const MAX_FILE_BYTES = Math.max(1024 * 1024, parseInt(process.env.MULTI_CHAIN_DIAGNOSTIC_MAX_BYTES || "33554432", 10) || 33554432);
const MAX_PAYLOAD_CHARS = Math.max(512, parseInt(process.env.MULTI_CHAIN_DIAGNOSTIC_MAX_PAYLOAD_CHARS || "16384", 10) || 16384);
const roomStates = new Map();
let stream;
let writtenBytes = 0;
let stoppedByLimit = false;
function roomKey(client) {
    return `${client.roomNumber}:${client.roomGeneration}`;
}
function ensureStream() {
    if (!ANY_DIAGNOSTIC_ENABLED || stoppedByLimit)
        return undefined;
    if (stream)
        return stream;
    const logDirectory = path.join(process.cwd(), ".logs");
    fs.mkdirSync(logDirectory, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const logPath = path.join(logDirectory, `multi-chain-${stamp}-${process.pid}.jsonl`);
    stream = fs.createWriteStream(logPath, { flags: "a" });
    stream.on("error", (error) => {
        if (!stoppedByLimit)
            console.warn(`[MULTI-CHAIN] diagnostic log failed: ${error.message}`);
        stoppedByLimit = true;
    });
    console.warn(`[MULTI-CHAIN] diagnostic enabled: path=${logPath}`
        + ` fullRelay=${FULL_DIAGNOSTIC_ENABLED} sendAnomaly=${SEND_DIAGNOSTIC_ENABLED}`
        + " automaticFallback=disabled_pending_packet_identification");
    return stream;
}
function safePayload(data) {
    let json;
    try {
        json = JSON.stringify(data);
    }
    catch (_a) {
        json = JSON.stringify({ unserializable: true });
    }
    if (json.length <= MAX_PAYLOAD_CHARS)
        return { json, truncated: false };
    return { json: json.slice(0, MAX_PAYLOAD_CHARS), truncated: true };
}
function writeRecord(record) {
    const output = ensureStream();
    if (!output)
        return;
    const line = JSON.stringify(record) + "\n";
    const bytes = Buffer.byteLength(line);
    if (writtenBytes + bytes > MAX_FILE_BYTES) {
        stoppedByLimit = true;
        output.end();
        stream = undefined;
        console.warn(`[MULTI-CHAIN] diagnostic stopped at byte limit: maxBytes=${MAX_FILE_BYTES}`);
        return;
    }
    writtenBytes += bytes;
    output.write(line);
}
function nextState(client) {
    const key = roomKey(client);
    let state = roomStates.get(key);
    if (!state) {
        state = { generation: client.roomGeneration, packetSequence: 0, lastObservedAt: Date.now() };
        roomStates.set(key, state);
    }
    state.packetSequence += 1;
    state.lastObservedAt = Date.now();
    return state;
}
function recordBattleRelay(source, recipients, kind, transportTag, data) {
    if (!FULL_DIAGNOSTIC_ENABLED)
        return;
    const state = nextState(source);
    const payload = safePayload(data);
    writeRecord({
        event: "battle_relay",
        time: new Date().toISOString(),
        room: source.roomNumber,
        generation: source.roomGeneration,
        sequence: state.packetSequence,
        sourceConnection: source.connectionId,
        sourceViewer: source.viewerId,
        recipientConnections: recipients.map((client) => client.connectionId),
        recipientViewers: recipients.map((client) => client.viewerId),
        kind,
        transportTag,
        payload: payload.json,
        payloadTruncated: payload.truncated,
    });
}
exports.recordBattleRelay = recordBattleRelay;
function recordBattleNotify(client, notifyTag, data) {
    if (!FULL_DIAGNOSTIC_ENABLED)
        return;
    const state = nextState(client);
    const payload = safePayload(data);
    writeRecord({
        event: "battle_notify",
        time: new Date().toISOString(),
        room: client.roomNumber,
        generation: client.roomGeneration,
        sequence: state.packetSequence,
        sourceConnection: client.connectionId,
        sourceViewer: client.viewerId,
        notifyTag,
        payload: payload.json,
        payloadTruncated: payload.truncated,
    });
}
exports.recordBattleNotify = recordBattleNotify;
function clearChainDiagnosticRoom(roomNumber) {
    if (!FULL_DIAGNOSTIC_ENABLED)
        return;
    for (const key of roomStates.keys()) {
        if (key.startsWith(`${roomNumber}:`))
            roomStates.delete(key);
    }
}
exports.clearChainDiagnosticRoom = clearChainDiagnosticRoom;
function recordBattleSendAnomaly(anomaly, context, details = {}) {
    if (!SEND_DIAGNOSTIC_ENABLED)
        return;
    writeRecord(Object.assign({ event: "battle_send_anomaly", anomaly, time: new Date().toISOString(), room: context === null || context === void 0 ? void 0 : context.roomNumber, generation: context === null || context === void 0 ? void 0 : context.roomGeneration, connection: context === null || context === void 0 ? void 0 : context.connectionId, viewer: context === null || context === void 0 ? void 0 : context.viewerId, channel: context === null || context === void 0 ? void 0 : context.channel }, details));
}
exports.recordBattleSendAnomaly = recordBattleSendAnomaly;
function isBattleSendDiagnosticEnabled() {
    return SEND_DIAGNOSTIC_ENABLED;
}
exports.isBattleSendDiagnosticEnabled = isBattleSendDiagnosticEnabled;
// Layer two intentionally remains observation-only until a real multi-human
// sample identifies the official Chain trigger packet. Guessing a packet here
// could produce duplicate damage or diverging battle simulations.
function isAutomaticChainFallbackEnabled() {
    return false;
}
exports.isAutomaticChainFallbackEnabled = isAutomaticChainFallbackEnabled;
