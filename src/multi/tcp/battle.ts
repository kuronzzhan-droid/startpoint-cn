import * as net from "net"
import { sessionManager } from "../state/SessionManager"
import type { SessionClient } from "../state/SessionManager"
import { relayToBattleRoom } from "./relay"
import { recordBattleNotify } from "./chain-diagnostic"
import { getRoom } from "../room/manager"
import { recordFiveBossSignal } from "../five-boss/lobby-runtime"
import { fiveBossConnectionDiagnostics } from "../five-boss/connection-diagnostic"
import { markPlayerOnlineFromTcp } from "../../lib/online-presence"
import { battleTelemetry } from "../battle-telemetry"
import type { RelayActivity } from "./battle-relay/protocol"

function findBattleClientBySocket(socket: net.Socket): SessionClient | undefined {
    const client = sessionManager.findClientBySocket(socket)
    return client?.isBattle ? client : undefined
}

function sendToBattleClient(client: SessionClient, data: unknown, channel: string): void {
    sessionManager.sendJson(client.socket, data, {
        roomNumber: client.roomNumber,
        connectionId: client.connectionId,
        viewerId: client.viewerId,
        roomGeneration: client.roomGeneration,
        channel,
    })
}

function handleBattleNotify(socket: net.Socket, data: unknown, indexedClient?: SessionClient): void {
    if (!Array.isArray(data)) return
    const tag = data[0] as number
    // The outer packet handler already resolved this socket. Reuse that
    // lookup for notify/relay handling so a high-rate battle connection does
    // not perform the same Map lookup three times for every frame.
    const client = indexedClient ?? findBattleClientBySocket(socket)
    if (client) recordBattleNotify(client, tag, data)
    if (tag === 0 || tag === 1 || tag === 2) {
        fiveBossConnectionDiagnostics.socketEvent(socket, tag === 0 ? "scene_ready" : tag === 1 ? "level_next" : "finalize",
            client ? "indexed" : "client_unindexed")
    }

    switch (tag) {
        case 0: { // SceneReady
            if (!client) break
            sessionManager.markSceneReady(client.connectionId, client.roomNumber)
            break
        }
        case 1: { // LevelNext (CN dual-boss battle)
            if (client) {
                const room = getRoom(client.roomNumber)
                if (room?.five_boss_runtime) recordFiveBossSignal(room, client, "level_next")
                sessionManager.beginBattleLevelNext(client.connectionId, client.roomNumber)
            }
            break
        }
        case 2: { // Finalize
            const room = client && getRoom(client.roomNumber)
            if (client && room?.five_boss_runtime) recordFiveBossSignal(room, client, "finalize")
            if (client) client.finalizeSent = true
            if (client) sendToBattleClient(client, [1, [2]], "battle_finalize_ack")
            break
        }
        case 3: { // Measurement
            if (client) {
                const params = data[1]
                const frame = params?.[0] ?? 0
                const clientTime = params?.[1] ?? 0
                sendToBattleClient(client, [1, [3, frame, clientTime, Date.now()]], "battle_measurement_ack")
            }
            break
        }
        case 4: // LineSpeedWarning
            break
        case 5: // Heartbeat
            if (client) sendToBattleClient(client, [1, [3, 0, 0, Date.now()]], "battle_heartbeat_ack")
            break
        default:
            break
    }
}

export function handleBattleMessage(socket: net.Socket, data: unknown): void {
    if (!Array.isArray(data)) return
    const tag = data[0] as number
    const activityClient = findBattleClientBySocket(socket)
    fiveBossConnectionDiagnostics.packet(socket, !!activityClient)
    if (activityClient) {
        sessionManager.noteBattleActivity(activityClient.connectionId)
        battleTelemetry.packet(activityClient.roomNumber, activityClient.viewerId, tag,
            tag === 0 && Array.isArray(data[1]) ? data[1][0] as number : undefined)
        if (!socket.destroyed && sessionManager.isCurrentBattleClient(activityClient)) {
            markPlayerOnlineFromTcp(activityClient.viewerId)
        }
    }

    switch (tag) {
        case 0: // Notify
            handleBattleNotify(socket, data[1], activityClient)
            break
        case 1: { // Broadcast → relay as BattleServer2Client.Messages(2, senderId, array)
            const client = activityClient
            if (client) {
                const bcData = data[1]
                relayToBattleRoom(client, [2, client.connectionId, bcData], "broadcast", tag)
                sendToBattleClient(client, [1, [3, 0, 0, Date.now()]], "battle_broadcast_ack")
            }
            break
        }
        case 2: { // Send → relay as BattleServer2Client.Send(3, senderId, message)
            const client = activityClient
            if (client) {
                const sendMsg = data[2]
                if (sendMsg !== undefined && sendMsg !== null) {
                    relayToBattleRoom(client, [3, client.connectionId, sendMsg], "direct", tag)
                }
                sendToBattleClient(client, [1, [3, 0, 0, Date.now()]], "battle_direct_ack")
            }
            break
        }
        default:
            break
    }
}

/**
 * Applies what the battle relay child handled on its own (relayed frames and
 * Heartbeat/Measurement acks) to the same lease, presence and telemetry state
 * handleBattleMessage() updates per frame in the in-process path.
 */
export function handleBattleRelayActivity(socket: net.Socket, activity: RelayActivity): void {
    const client = findBattleClientBySocket(socket)
    if (!client) return
    const packets = activity.broadcasts + activity.sends + activity.heartbeats
        + activity.measurements + activity.lineSpeedWarnings
    if (packets > 0) {
        fiveBossConnectionDiagnostics.packet(socket, true)
        sessionManager.noteBattleActivity(client.connectionId)
        if (!socket.destroyed && sessionManager.isCurrentBattleClient(client)) {
            markPlayerOnlineFromTcp(client.viewerId)
        }
    }
    battleTelemetry.relayActivity(client.roomNumber, client.viewerId, {
        packets,
        broadcasts: activity.broadcasts + activity.sends,
        lineSpeedWarnings: activity.lineSpeedWarnings,
        maxGapMs: activity.maxGapMs,
        relayedOut: activity.relayedOut,
    })
    if (activity.maxBackpressureMs >= 100) {
        battleTelemetry.backpressure(client.roomNumber, client.viewerId, activity.maxBackpressureMs)
    }
}
