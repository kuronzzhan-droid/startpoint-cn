import * as net from "net"
import { sessionManager } from "../state/SessionManager"
import type { SessionClient } from "../state/SessionManager"
import { relayToBattleRoom } from "./relay"
import { recordBattleNotify } from "./chain-diagnostic"
import { getRoom } from "../room/manager"
import { recordFiveBossSignal } from "../five-boss/lobby-runtime"
import { fiveBossConnectionDiagnostics } from "../five-boss/connection-diagnostic"
import { notifyRealtimePresence as markPlayerOnlineFromTcp } from "../coordinator/business-facts"
import { battleTelemetry } from "../battle-telemetry"
import { recordBattleFrame } from "./relay-recorder"
import type { RelayActivity } from "./battle-relay/protocol"
import { markBattleMemberPhase } from "../state/battle-contract"
import { deferPinnedRoomControl } from "../coordinator/room-start-claims"
import { captureRealtimeBusinessContext, retainRealtimeBusinessTail } from "../coordinator/business-rpc"
import {
    handleBattleFingerprintNotify,
    isStateFingerprintEnabled,
    isStateFingerprintNotify,
    isStateFingerprintPacket,
} from "./state-fingerprint"

// Each room still has the existing 64-control pin FIFO. The aggregate matches
// the bounded TCP work budget, and one close listener serves each socket.
const pendingPinnedControls = new Set<() => void>()
const pinnedControlsBySocket = new Map<net.Socket, { controls: Set<() => void>; close: () => void }>()
const MAX_PENDING_PINNED_CONTROLS = 128

function trackPinnedControl(socket: net.Socket, discard: () => void): () => void {
    if (pendingPinnedControls.size >= MAX_PENDING_PINNED_CONTROLS) throw new Error("START_CONTROL_WORK_BUDGET")
    let entry = pinnedControlsBySocket.get(socket)
    if (!entry) {
        const controls = new Set<() => void>()
        entry = { controls, close: () => { for (const cancel of [...controls]) cancel() } }
        pinnedControlsBySocket.set(socket, entry)
        socket.once("close", entry.close)
    }
    entry.controls.add(discard)
    pendingPinnedControls.add(discard)
    return () => {
        pendingPinnedControls.delete(discard)
        entry!.controls.delete(discard)
        if (!entry!.controls.size) {
            socket.off("close", entry!.close)
            pinnedControlsBySocket.delete(socket)
        }
    }
}

/** Called after TCP ingress closes. No room transition, proof or business write. */
export function discardPinnedBattleControlsForShutdown(): void {
    for (const discard of [...pendingPinnedControls]) discard()
}

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
            if (client && room) markBattleMemberPhase(room, client.viewerId, "FINALIZED")
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
            if (isStateFingerprintNotify(data)) {
                handleBattleFingerprintNotify(socket, data, client)
                break
            }
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
    if (activityClient && !sessionManager.isCurrentBattleClient(activityClient)) return
    if (activityClient && tag === 0 && Array.isArray(data[1]) && [0, 1, 2].includes(data[1][0])) {
        const room = getRoom(activityClient.roomNumber), control = data[1][0]
        const instanceId = room?.lifecycle.instanceId, battleSessionId = room?.lifecycle.battleSessionId
        if (room) {
            let completeDeferred!: () => void
            const deferredTail = new Promise<void>(resolve => { completeDeferred = resolve })
            const restoreBusinessContext = captureRealtimeBusinessContext()
            let discarded = false, completed = false, untrack = () => {}
            const finish = () => {
                if (completed) return
                completed = true; untrack(); completeDeferred()
            }
            const discard = () => { discarded = true; finish() }
            try {
                if (deferPinnedRoomControl(room, () => {
                    if (discarded) return
                    try {
                        restoreBusinessContext(() => {
                            const current = getRoom(activityClient.roomNumber)
                            if (current === room && current.lifecycle.instanceId === instanceId
                                && current.lifecycle.battleSessionId === battleSessionId
                                && !socket.destroyed && sessionManager.isCurrentBattleClient(activityClient)) {
                                handleBattleMessage(socket, [0, [control]])
                            }
                        })
                    } catch { socket.destroy() }
                    finally { finish() }
                })) {
                    // A stored callback is outside the original async chain.
                    // Keep its accepted TCP work alive until replay or discard;
                    // any proof scheduled by replay retains its own tail.
                    untrack = trackPinnedControl(socket, discard)
                    if (socket.destroyed) discard()
                    void retainRealtimeBusinessTail(deferredTail).catch(() => socket.destroy())
                    return
                }
                finish()
            } catch { discard(); socket.destroy(); return }
        }
    }
    fiveBossConnectionDiagnostics.packet(socket, !!activityClient)
    if (activityClient && (!isStateFingerprintPacket(data) || isStateFingerprintEnabled())) {
        recordBattleFrame(activityClient.roomNumber, activityClient.roomGeneration,
            activityClient.viewerId, activityClient.connectionId, data)
    }
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

/** Child-local packets refresh existing leases and diagnostics without replay. */
export function handleBattleRelayActivity(socket: net.Socket, activity: RelayActivity): void {
    const client = findBattleClientBySocket(socket)
    if (!client || socket.destroyed || !sessionManager.isCurrentBattleClient(client)) return
    const packets = activity.broadcasts + activity.sends + activity.heartbeats
        + activity.measurements + activity.lineSpeedWarnings
    if (packets > 0) {
        fiveBossConnectionDiagnostics.packet(socket, true)
        sessionManager.noteBattleActivity(client.connectionId)
        markPlayerOnlineFromTcp(client.viewerId)
    }
    battleTelemetry.relayActivity(client.roomNumber, client.viewerId, {
        packets, broadcasts: activity.broadcasts + activity.sends,
        lineSpeedWarnings: activity.lineSpeedWarnings, maxGapMs: activity.maxGapMs,
        relayedOut: activity.relayedOut,
    })
    if (activity.maxBackpressureMs >= 100) {
        battleTelemetry.backpressure(client.roomNumber, client.viewerId, activity.maxBackpressureMs)
    }
}
