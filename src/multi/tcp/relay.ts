import { sessionManager } from "../state/SessionManager"
import type { SessionClient } from "../state/SessionManager"
import { recordBattleRelay } from "./chain-diagnostic"
import { performance } from "node:perf_hooks"
import { recordServerWork } from "../../lib/server-work-performance"
import { recordRealtimeDiagnostic } from "../../lib/realtime-diagnostics"
import { battleTelemetry } from "../battle-telemetry"

export function relayToBattleRoom(
    source: SessionClient,
    data: unknown,
    relayKind: "broadcast" | "direct",
    transportTag: number,
): void {
    // Freeze this logical broadcast's receiver list before writing. A client
    // reconnecting during the loop belongs to another connection generation
    // and must not cause one member of this packet fan-out to be skipped.
    const recipients = sessionManager.snapshotBattleRelayRecipients(source)
    recordBattleRelay(source, recipients, relayKind, transportTag, data)
    if (recipients.length === 0) return
    // Every recipient receives the same immutable protocol payload. Serialize
    // once per logical fan-out instead of once per teammate.
    const encodeStarted = performance.now()
    const frame = JSON.stringify(data) + "\0"
    recordServerWork("multi.relay.encode", performance.now() - encodeStarted)
    const sendStarted = performance.now()
    for (const client of recipients) {
        sessionManager.sendFrame(client.socket, frame, {
            roomNumber: source.roomNumber,
            connectionId: client.connectionId,
            viewerId: client.viewerId,
            roomGeneration: source.roomGeneration,
            channel: `battle_${relayKind}`,
        })
        battleTelemetry.relayed(source.roomNumber, client.viewerId)
    }
    const sendMs = performance.now() - sendStarted
    recordServerWork("multi.relay.send", sendMs)
    recordRealtimeDiagnostic(source.roomNumber, "relay", {
        kind: relayKind,
        recipients: recipients.length,
        sendMs: Math.round(sendMs * 1000) / 1000,
    })
}
