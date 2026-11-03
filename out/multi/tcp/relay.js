"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.relayToBattleRoom = void 0;
const SessionManager_1 = require("../state/SessionManager");
const chain_diagnostic_1 = require("./chain-diagnostic");
const node_perf_hooks_1 = require("node:perf_hooks");
const server_work_performance_1 = require("../../lib/server-work-performance");
const realtime_diagnostics_1 = require("../../lib/realtime-diagnostics");
const battle_telemetry_1 = require("../battle-telemetry");
function relayToBattleRoom(source, data, relayKind, transportTag) {
    // Freeze this logical broadcast's receiver list before writing. A client
    // reconnecting during the loop belongs to another connection generation
    // and must not cause one member of this packet fan-out to be skipped.
    const recipients = SessionManager_1.sessionManager.snapshotBattleRelayRecipients(source);
    (0, chain_diagnostic_1.recordBattleRelay)(source, recipients, relayKind, transportTag, data);
    if (recipients.length === 0)
        return;
    // Every recipient receives the same immutable protocol payload. Serialize
    // once per logical fan-out instead of once per teammate.
    const encodeStarted = node_perf_hooks_1.performance.now();
    const frame = JSON.stringify(data) + "\0";
    (0, server_work_performance_1.recordServerWork)("multi.relay.encode", node_perf_hooks_1.performance.now() - encodeStarted);
    const sendStarted = node_perf_hooks_1.performance.now();
    for (const client of recipients) {
        SessionManager_1.sessionManager.sendFrame(client.socket, frame, {
            roomNumber: source.roomNumber,
            connectionId: client.connectionId,
            viewerId: client.viewerId,
            roomGeneration: source.roomGeneration,
            channel: `battle_${relayKind}`,
        });
        battle_telemetry_1.battleTelemetry.relayed(source.roomNumber, client.viewerId);
    }
    const sendMs = node_perf_hooks_1.performance.now() - sendStarted;
    (0, server_work_performance_1.recordServerWork)("multi.relay.send", sendMs);
    (0, realtime_diagnostics_1.recordRealtimeDiagnostic)(source.roomNumber, "relay", {
        kind: relayKind,
        recipients: recipients.length,
        sendMs: Math.round(sendMs * 1000) / 1000,
    });
}
exports.relayToBattleRoom = relayToBattleRoom;
