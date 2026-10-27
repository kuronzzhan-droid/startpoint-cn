import { routineGameLog } from "../../lib/routine-game-logging"
import { stripWeaponRivenPartySouls } from "../../lib/weapon-riven/client"
import { stripWeaponRivenRoomPreview } from "../../lib/weapon-riven/room-preview"
// Multi battle session manager
// Atomic indexing of room clients, battle clients and per-room state machines.
// Protocol arrays follow typepacker useEnumIndex=true format (see sessionServer.ts).

import * as net from "net"
import { performance } from "node:perf_hooks"
import { Result, ClientState, BattleState } from "../types"
import { ClientStateMachine } from "./ClientStateMachine"
import { gameVerboseLog } from "../../lib/game-logging"
import { clearReliableSendState, sendFrameReliably } from "../tcp/reliable-send"
import type { ReliableSendContext, ReliableSendResult } from "../tcp/reliable-send"
import { clearChainDiagnosticRoom } from "../tcp/chain-diagnostic"
import { embeddedMultiCoordinator } from "../coordinator/embedded"
import { roomAdmissionRegistry } from "../room/admission"
import { fiveBossConnectionDiagnostics } from "../five-boss/connection-diagnostic"
import { isFiveBossGauntletQuest } from "../five-boss/contract"
import { registerMemoryCounters } from "../../lib/memory-diagnostics"
import { recordServerWork } from "../../lib/server-work-performance"
import { recordRealtimeDiagnostic } from "../../lib/realtime-diagnostics"
import { markTcpDisconnectReason } from "../tcp/disconnect-diagnostics"
import { battleTelemetry } from "../battle-telemetry"
import { clearEquipmentBlock } from "../room/equipment-ready"
import { battleRelayBridge, isRelayProxySocket } from "../tcp/battle-relay/bridge"
import type { RelayMember } from "../tcp/battle-relay/protocol"
import { battleConnectionMatches, battleMemberCanPlay, bindBattleConnection, beginBattleSceneEpoch,
    ensureBattleSessionContract, getBattleSessionContract, markBattleMemberPhase } from "./battle-contract"
import type { ContentClientReloadPlay } from "../../lib/content-client-reload"

export interface SessionClient {
    socket: net.Socket
    viewerId: number
    roomNumber: string
    connectionId: string
    playerId: number | null
    isBattle: boolean
    isReady: boolean
    buffer: string
    mates: any[]
    enterData: any
    yourself?: any
    roomGeneration: number
    connectionGeneration: number
    roomInstanceId?: string
    battleSessionId?: string | null
    sceneEpoch?: number
    superseded: boolean
    connectedAt: number
    fiveBossBattleEntered: boolean
    /** This battle connection sent Finalize: its battle ended normally. */
    finalizeSent: boolean
    /** Battle session for which Finalized was pushed as a server-confirmed clear. */
    serverClearSent?: string
    admissionClaimed: boolean
    admissionGeneration?: number
    equipmentSelectedPartyId?: number
    equipmentReadyBlock?: {
        instanceId: string
        generation: number
        deadline: number
        timer: NodeJS.Timeout
    }
    clientState: ClientStateMachine
    battleState: BattleState
}

interface RescueGuestWaitState {
    deadline: number
    ready: boolean
    warningTimer: NodeJS.Timeout
    ejectTimer: NodeJS.Timeout
}

interface SupersededSocketBucket {
    roomNumber: string
    sockets: Set<net.Socket>
}

interface BattleSeat {
    viewerId: number
    connectionId: string
}

interface BattleBarrierCycle {
    roomInstanceId?: string
    battleSessionId?: string | null
    sceneEpoch: number
    timers: Map<string, NodeJS.Timeout>
    missing: Map<string, BattleSeat>
    arrived: Set<string>
    startedAt: number
}

export class SessionManager {
    public memoryCounters(): Record<string, number> {
        return { lobbyClients: this.clients.size, battleClients: this.cidToBattleClient.size,
            lobbyRooms: this.roomClients.size, battleRooms: this.battleClients.size,
            heartbeatTimers: this.battleHeartbeatTimers.size, returningTimers: this.settlementReturnTimers.size,
            abandonedTimers: this.abandonedBattleTimers.size, supersededBuckets: this.supersededSocketBuckets.size,
            blockedRestores: this.blockedRoomRestores.size, roomGenerations: this.roomConnectionGenerations.size }
    }
    /** An account login replacement revokes both lobby and battle transports. */
    public disconnectPlayerLogin(viewerId: number): void {
        for (const client of Array.from(this.clients.values())) {
            if (client.viewerId === viewerId) {
                markTcpDisconnectReason(client.socket, "login_replaced")
                client.socket.destroy()
            }
        }
    }
    /** Operational reload closes current transports through their ordinary close handlers.
     * It does not delete durable active quests, settlement records or saved player state. */
    public contentReloadViewerIds(): number[] {
        return [...new Set([...this.clients.values(), ...this.cidToBattleClient.values()]
            .filter(client => !client.socket.destroyed).map(client => client.viewerId))]
    }
    public contentReloadActivePlays(): ContentClientReloadPlay[] {
        const plays = new Map<string, ContentClientReloadPlay>()
        for (const client of new Set([...this.clients.values(), ...this.cidToBattleClient.values()])) {
            if (client.socket.destroyed) continue
            const room = require("../room/manager").getRoom(client.roomNumber)
            if (!room || room.lifecycle.phase !== "BATTLE") continue
            const run = getBattleSessionContract(room)
            const member = run?.members.get(client.viewerId)
            if (!run || !member?.playCommitted || !member.playerId || !member.playId
                || !["LOADING", "READY", "ACTIVE"].includes(member.phase)) continue
            const play = { viewerId: client.viewerId, playerId: member.playerId, playId: member.playId,
                roomNumber: client.roomNumber, category: run.category, questId: run.questId }
            plays.set(`${play.playerId}:${play.playId}`, play)
        }
        return [...plays.values()]
    }
    public disconnectAllForContentReload(staleViewers: ReadonlySet<number>): number[] {
        const clients = new Set([...this.clients.values(), ...this.cidToBattleClient.values()])
        const viewers = new Set<number>()
        const sockets = new Set<net.Socket>()
        for (const client of clients) {
            if (client.socket.destroyed || !staleViewers.has(client.viewerId)) continue
            viewers.add(client.viewerId)
            sockets.add(client.socket)
        }
        for (const socket of sockets) {
            markTcpDisconnectReason(socket, "login_replaced")
            socket.destroy()
        }
        return [...viewers]
    }
    private clients = new Map<string, SessionClient>()
    private roomClients = new Map<string, Set<string>>()
    private battleClients = new Map<string, Set<string>>()
    private cidToBattleClient = new Map<string, SessionClient>()
    private socketClients = new WeakMap<net.Socket, SessionClient>()
    private sceneReadyClients = new Map<string, Set<string>>()
    private battleLevelNextClients = new Map<string, Set<string>>()
    private battleExpectedCount = new Map<string, number>()
    private battleBarrierCycles = new Map<string, BattleBarrierCycle>()
    // Roster handed to setBattleExpectedCount at StartBattle, by connection id.
    // It lets a seat open its battle socket after its lobby socket dropped.
    private battleRosterSeats = new Map<string, Map<string, {
        viewerId: number
        playerId: number | null
        roomGeneration: number
    }>>()
    private retiredBattleSeats = new Map<string, Set<string>>()
    private battleHeartbeatTimers = new Map<string, NodeJS.Timeout>()
    private battleLastActivityAt = new Map<string, number>()
    private battleConnectionPhase = new Map<string, "loading" | "ready" | "active">()
    private battleSceneStartedRooms = new Set<string>()
    private pendingBattleLeaves = new Map<string, Set<string>>()
    private battleBarrierLogState = new Map<string, string>()
    private supersededBattleClients = new WeakSet<SessionClient>()
    private supersededSockets = new WeakSet<net.Socket>()
    private retiredLobbySockets = new WeakSet<net.Socket>()
    private supersededSocketBuckets = new Map<string, SupersededSocketBucket>()
    private abandonedBattleTimers = new Map<string, NodeJS.Timeout>()
    private settlementReturnTimers = new Map<string, NodeJS.Timeout>()
    private rescueGuests = new Map<string, Set<number>>()
    private newbieRescueGuests = new Map<string, Set<number>>()
    private rescueFragmentEligibleGuests = new Map<string, Set<number>>()
    private rescueGuestWaits = new Map<string, RescueGuestWaitState>()
    private rescueGuestReconnectTimers = new Map<string, NodeJS.Timeout>()
    private blockedRoomRestores = new Map<string, Set<number>>()
    private hostReconnectTimers = new Map<string, NodeJS.Timeout>()
    private deferredDisbands = new Map<string, { timer: NodeJS.Timeout; deadline: number }>()
    private staleAssetViewers = new Map<string, number>()
    private roomConnectionGenerations = new Map<string, number>()

    private addr(viewerId: number, roomNumber: string): string {
        return `${viewerId}@${roomNumber}`
    }

    private parsePositiveDuration(name: string, fallback: number, minimum = 1_000): number {
        const parsed = parseInt(process.env[name] || "", 10)
        return Number.isFinite(parsed) ? Math.max(minimum, parsed) : fallback
    }

    private maxSupersededSocketsPerViewer(): number {
        const parsed = parseInt(process.env.MULTI_MAX_SUPERSEDED_CONNECTIONS_PER_VIEWER || "", 10)
        return Number.isFinite(parsed) ? Math.max(1, Math.min(32, parsed)) : 2
    }

    private deferSupersededSocketClose(
        socket: net.Socket,
        replacementIsLive: () => boolean,
    ): number {
        const checkMs = this.parsePositiveDuration("MULTI_SUPERSEDED_SOCKET_CLOSE_MS", 60_000)
        const closeWhenSafe = () => {
            if (socket.destroyed) return
            // Closing the old socket while its replacement owns the room can
            // make the client show a false communication-loss dialog. Keep it
            // quarantined until the replacement/room is gone; it is no longer
            // indexed and cannot issue commands or receive broadcasts.
            if (replacementIsLive()) {
                const retry = setTimeout(closeWhenSafe, checkMs)
                retry.unref()
                return
            }
            markTcpDisconnectReason(socket, "superseded")
            socket.destroy()
        }
        const timer = setTimeout(closeWhenSafe, checkMs)
        timer.unref()
        return checkMs
    }

    private quarantineSupersededSocket(
        ownerKey: string,
        roomNumber: string,
        socket: net.Socket,
        replacementIsLive: () => boolean,
    ): number {
        this.supersededSockets.add(socket)
        let bucket = this.supersededSocketBuckets.get(ownerKey)
        if (!bucket) {
            bucket = { roomNumber, sockets: new Set() }
            this.supersededSocketBuckets.set(ownerKey, bucket)
        }
        bucket.sockets.add(socket)
        socket.once("close", () => {
            const current = this.supersededSocketBuckets.get(ownerKey)
            current?.sockets.delete(socket)
            if (current?.sockets.size === 0) this.supersededSocketBuckets.delete(ownerKey)
        })

        const maximum = this.maxSupersededSocketsPerViewer()
        while (bucket.sockets.size > maximum) {
            const oldest = bucket.sockets.values().next().value as net.Socket | undefined
            if (!oldest) break
            bucket.sockets.delete(oldest)
            if (!oldest.destroyed) {
                markTcpDisconnectReason(oldest, "superseded")
                oldest.destroy()
            }
        }
        return this.deferSupersededSocketClose(socket, replacementIsLive)
    }

    private closeSupersededSocketsForRoom(roomNumber: string): void {
        for (const [ownerKey, bucket] of this.supersededSocketBuckets) {
            if (bucket.roomNumber !== roomNumber) continue
            this.supersededSocketBuckets.delete(ownerKey)
            for (const socket of bucket.sockets) {
                if (!socket.destroyed) {
                    markTcpDisconnectReason(socket, "room_disband")
                    socket.destroy()
                }
            }
        }
    }

    private retireDisbandedLobbySocket(socket: net.Socket, roomNumber: string): void {
        this.retiredLobbySockets.add(socket)
        if (socket.destroyed) return

        // The CN client handles Disbanded by sending Bye and closing this
        // socket itself.  A server FIN queued immediately after Disbanded can
        // be processed as SocketError after the client has already cleared its
        // cooperationRoomStatus, which makes the client throw C5805.  Keep the
        // socket quarantined long enough for both the final frame and the
        // client's intentional close, then reclaim an unresponsive peer.
        const sendQueueMaxAgeMs = this.parsePositiveDuration("MULTI_SEND_QUEUE_MAX_AGE_MS", 15_000)
        const fallbackGraceMs = sendQueueMaxAgeMs + 5_000
        const graceMs = this.parsePositiveDuration("MULTI_DISBAND_SOCKET_GRACE_MS", fallbackGraceMs)
        const timer = setTimeout(() => {
            if (socket.destroyed) return
            gameVerboseLog(() => `[MULTI] forcing retired lobby socket closed: room=${roomNumber}`
                + ` graceMs=${graceMs}`)
            markTcpDisconnectReason(socket, "room_disband")
            socket.destroy()
        }, graceMs)
        timer.unref()
        socket.once("close", () => clearTimeout(timer))
    }

    private clearBattleHeartbeatLease(connectionId: string): void {
        const timer = this.battleHeartbeatTimers.get(connectionId)
        if (timer) clearTimeout(timer)
        this.battleHeartbeatTimers.delete(connectionId)
        this.battleLastActivityAt.delete(connectionId)
        this.battleConnectionPhase.delete(connectionId)
    }

    private armBattleLoadingLease(connectionId: string): void {
        const client = this.cidToBattleClient.get(connectionId)
        if (!client || client.socket.destroyed) return
        const leaseMs = this.parsePositiveDuration("BATTLE_LOADING_LEASE_MS", 60_000, 10_000)
        const previous = this.battleHeartbeatTimers.get(connectionId)
        if (previous) clearTimeout(previous)
        this.battleConnectionPhase.set(connectionId, "loading")
        this.battleLastActivityAt.set(connectionId, performance.now())
        const timer = setTimeout(() => {
            // Timers run before the poll phase on a busy loop. Give a SceneReady
            // frame that is already waiting in the kernel one I/O turn to
            // replace this lease before deciding that loading really expired.
            const check = setImmediate(() => {
                if (this.battleHeartbeatTimers.get(connectionId) !== timer) return
                this.battleHeartbeatTimers.delete(connectionId)
                const current = this.cidToBattleClient.get(connectionId)
                if (!current || current.socket.destroyed
                    || this.battleConnectionPhase.get(connectionId) !== "loading") return
                console.warn(`[MULTI] battle loading timed out: room=${current.roomNumber}`
                    + ` viewer=${current.viewerId} connection=${connectionId} timeoutMs=${leaseMs}`)
                fiveBossConnectionDiagnostics.socketEvent(current.socket, "loading_timeout", String(leaseMs))
                markTcpDisconnectReason(current.socket, "loading_timeout")
                current.socket.destroy()
            })
            check.unref()
        }, leaseMs)
        timer.unref()
        this.battleHeartbeatTimers.set(connectionId, timer)
    }

    private scheduleBattleActivityLease(connectionId: string, delayMs: number): void {
        const client = this.cidToBattleClient.get(connectionId)
        if (!client || client.socket.destroyed) return
        const leaseMs = this.parsePositiveDuration("BATTLE_HEARTBEAT_LEASE_MS", 25_000, 5_000)
        const previous = this.battleHeartbeatTimers.get(connectionId)
        if (previous) clearTimeout(previous)
        const timer = setTimeout(() => {
            const check = setImmediate(() => {
                if (this.battleHeartbeatTimers.get(connectionId) !== timer) return
                this.battleHeartbeatTimers.delete(connectionId)
                const current = this.cidToBattleClient.get(connectionId)
                if (!current || current.socket.destroyed) {
                    this.battleLastActivityAt.delete(connectionId)
                    return
                }
                const inactiveMs = performance.now() - (this.battleLastActivityAt.get(connectionId) ?? 0)
                // After a teammate's /finish the room is SETTLING/RETURNING, but a
                // slow client can stay silent on its result sequence well past the
                // ordinary lease before it sends Finalize and /finish. Killing it
                // there shows S1000 and can lose its settlement.
                const effectiveLeaseMs = this.isAwaitingFinalizeAfterSettlement(current)
                    ? Math.max(leaseMs, this.parsePositiveDuration("BATTLE_SETTLING_HEARTBEAT_LEASE_MS", 120_000, 5_000))
                    : leaseMs
                if (inactiveMs < effectiveLeaseMs) {
                    this.scheduleBattleActivityLease(connectionId, Math.max(1, effectiveLeaseMs - inactiveMs))
                    return
                }
                console.warn(`[MULTI] real battle connection heartbeat expired: room=${current.roomNumber}`
                    + ` viewer=${current.viewerId} connection=${connectionId} inactiveMs=${inactiveMs}`)
                fiveBossConnectionDiagnostics.socketEvent(current.socket, "heartbeat_timeout", String(inactiveMs))
                // Destroy only a battle socket that completed the real handshake.
                // Its normal close handler performs the native Leave path using the
                // connection id already known by every remaining client.
                markTcpDisconnectReason(current.socket, "heartbeat_timeout")
                current.socket.destroy()
            })
            check.unref()
        }, delayMs)
        timer.unref()
        this.battleHeartbeatTimers.set(connectionId, timer)
    }

    private armActiveBattleHeartbeatLease(connectionId: string): void {
        const client = this.cidToBattleClient.get(connectionId)
        if (!client || client.socket.destroyed) return
        const leaseMs = this.parsePositiveDuration("BATTLE_HEARTBEAT_LEASE_MS", 25_000, 5_000)
        this.battleConnectionPhase.set(connectionId, "active")
        this.battleLastActivityAt.set(connectionId, performance.now())
        this.scheduleBattleActivityLease(connectionId, leaseMs)
    }

    private armBattleReadyHeartbeatLease(connectionId: string): void {
        const client = this.cidToBattleClient.get(connectionId)
        if (!client || client.socket.destroyed) return
        const leaseMs = this.parsePositiveDuration("BATTLE_HEARTBEAT_LEASE_MS", 25_000, 5_000)
        this.battleConnectionPhase.set(connectionId, "ready")
        this.battleLastActivityAt.set(connectionId, performance.now())
        this.scheduleBattleActivityLease(connectionId, leaseMs)
    }

    noteBattleActivity(connectionId: string): void {
        if (!this.cidToBattleClient.has(connectionId)) return
        // Loading has a fixed upper bound and is deliberately not governed by
        // the activity heartbeat. SceneReady switches the connection to the
        // renewable ready lease; barrier release promotes it to active.
        const phase = this.battleConnectionPhase.get(connectionId)
        if (phase === "ready" || phase === "active") {
            // One timer per ready/active connection is enough. Per-packet traffic
            // only advances the deadline timestamp; the timer reschedules for
            // the exact remaining lease when it wakes up.
            this.battleLastActivityAt.set(connectionId, performance.now())
        }
    }

    private indexClientSocket(client: SessionClient): void {
        this.socketClients.set(client.socket, client)
    }

    private unindexClientSocket(client: SessionClient): void {
        if (this.socketClients.get(client.socket) === client) {
            this.socketClients.delete(client.socket)
        }
    }

    private logBattleBarrierState(roomNumber: string, reason: string): void {
        const expected = this.battleExpectedCount.get(roomNumber) ?? 0
        const connected = this.battleClients.get(roomNumber)?.size ?? 0
        const ready = this.sceneReadyClients.get(roomNumber)?.size ?? 0
        const generation = (() => {
            try { return Number(require("../room/manager").getRoom(roomNumber)?.lobby_generation ?? 0) }
            catch { return 0 }
        })()
        const signature = `${generation}:${expected}:${connected}:${ready}:${reason}`
        if (this.battleBarrierLogState.get(roomNumber) === signature) return
        this.battleBarrierLogState.set(roomNumber, signature)
        recordRealtimeDiagnostic(roomNumber, "barrier", {
            reason,
            expected,
            connected,
            ready,
            generation,
        })
        routineGameLog("multiBarrier", () => `[MULTI-BARRIER] room=${roomNumber} generation=${generation}`
            + ` expected=${expected} connected=${connected} ready=${ready} reason=${reason}`)
    }

    private releaseSceneReadyBarrierIfSatisfied(roomNumber: string, reason: string): boolean {
        const cycleBeforeRelease = this.battleBarrierCycles.get(roomNumber)
        if (this.deferStartDecision(roomNumber, () => {
            if (this.battleBarrierCycles.get(roomNumber) === cycleBeforeRelease
                && this.releaseSceneReadyBarrierIfSatisfied(roomNumber, reason)) this.activateBattleScene(roomNumber)
        })) return false
        const expected = this.battleExpectedCount.get(roomNumber) ?? 0
        if (expected <= 0) return false
        const connected = this.battleClients.get(roomNumber)?.size ?? 0
        const ready = this.sceneReadyClients.get(roomNumber)?.size ?? 0
        this.logBattleBarrierState(roomNumber, reason)
        if (connected <= 0 || ready < expected || ready < connected) return false
        const cycle = this.battleBarrierCycles.get(roomNumber)
        const waitMs = cycle ? performance.now() - cycle.startedAt : 0
        if (cycle) recordServerWork("multi.barrier", waitMs)
        battleTelemetry.barrier(roomNumber, this.battleLevelNextClients.has(roomNumber) ? "next_scene" : "initial", waitMs)
        recordRealtimeDiagnostic(roomNumber, "barrier_released", {
            reason,
            expected,
            connected,
            ready,
            waitMs: Math.round(waitMs * 1000) / 1000,
        })
        this.battleExpectedCount.set(roomNumber, 0)
        this.clearBattleBarrierCycle(roomNumber)
        this.battleLevelNextClients.delete(roomNumber)
        this.logBattleBarrierState(roomNumber, `${reason}:released`)
        return true
    }

    private battleSeatKey(seat: BattleSeat): string {
        return seat.viewerId > 0 ? `viewer:${seat.viewerId}` : `connection:${seat.connectionId}`
    }

    private clearBattleBarrierCycle(roomNumber: string): void {
        const cycle = this.battleBarrierCycles.get(roomNumber)
        for (const timer of cycle?.timers.values() ?? []) clearTimeout(timer)
        this.battleBarrierCycles.delete(roomNumber)
    }

    private beginBattleBarrierCycle(roomNumber: string): BattleBarrierCycle {
        this.clearBattleBarrierCycle(roomNumber)
        const room = require("../room/manager").getRoom(roomNumber)
        const cycle: BattleBarrierCycle = {
            roomInstanceId: room?.lifecycle?.instanceId,
            battleSessionId: room?.lifecycle?.battleSessionId,
            sceneEpoch: room?.lifecycle?.sceneEpoch ?? 0,
            timers: new Map(), missing: new Map(),
            arrived: new Set(this.getConnectedBattleClients(roomNumber)
                .flatMap(client => [this.battleSeatKey(client), `connection:${client.connectionId}`])),
            startedAt: performance.now(),
        }
        this.battleBarrierCycles.set(roomNumber, cycle)
        return cycle
    }

    private isCurrentBattleBarrier(roomNumber: string, cycle: BattleBarrierCycle): boolean {
        if (this.battleBarrierCycles.get(roomNumber) !== cycle) return false
        const room = require("../room/manager").getRoom(roomNumber)
        return room?.lifecycle?.instanceId === cycle.roomInstanceId
            && room?.lifecycle?.battleSessionId === cycle.battleSessionId
            && (room?.lifecycle?.sceneEpoch ?? 0) === cycle.sceneEpoch
            && (!room || room.lifecycle.phase === "BATTLE")
    }

    private expireMissingBattleSeat(roomNumber: string, cycle: BattleBarrierCycle, seat: BattleSeat): void {
        if (!this.isCurrentBattleBarrier(roomNumber, cycle)) return
        if (this.deferStartDecision(roomNumber, () => this.expireMissingBattleSeat(roomNumber, cycle, seat))) return
        const key = this.battleSeatKey(seat)
        if (this.getConnectedBattleClients(roomNumber).some(client => this.battleSeatKey(client) === key
            || client.connectionId === seat.connectionId)) return
        const expected = this.battleExpectedCount.get(roomNumber) ?? 0
        if (expected <= 0) return
        let retired = this.retiredBattleSeats.get(roomNumber)
        if (!retired) this.retiredBattleSeats.set(roomNumber, retired = new Set())
        if (retired.has(key) || retired.has(`connection:${seat.connectionId}`)) return
        retired.add(key)
        retired.add(`connection:${seat.connectionId}`)
        const room = require("../room/manager").getRoom(roomNumber)
        if (room) markBattleMemberPhase(room, seat.viewerId, "RETIRED")
        fiveBossConnectionDiagnostics.seatEvent(roomNumber, seat.viewerId, "seat_expired")
        battleTelemetry.seatExpired(roomNumber)
        this.queueBattleLeave(roomNumber, seat.connectionId)
        this.battleExpectedCount.set(roomNumber, expected - 1)
        this.logBattleBarrierState(roomNumber, "missing_seat_expired")
        if (this.releaseSceneReadyBarrierIfSatisfied(roomNumber, "missing_seat_recheck")) {
            this.activateBattleScene(roomNumber)
        }
    }

    private scheduleMissingBattleSeat(roomNumber: string, seat: BattleSeat): void {
        const cycle = this.battleBarrierCycles.get(roomNumber)
        if (!cycle || (this.battleExpectedCount.get(roomNumber) ?? 0) <= 0) return
        const key = this.battleSeatKey(seat)
        if (cycle.timers.has(key) || this.retiredBattleSeats.get(roomNumber)?.has(key)) return
        cycle.missing.set(key, seat)
        const graceMs = this.parsePositiveDuration("BATTLE_BARRIER_RECONNECT_GRACE_MS", 8_000)
        const timer = setTimeout(() => {
            void embeddedMultiCoordinator.enqueueRoomCommand(roomNumber, () => {
                // Recheck after entering the room queue: reconnect, settlement,
                // the next scene, or a reused room number may have won the race.
                if (cycle.timers.get(key) !== timer) return
                cycle.timers.delete(key)
                this.expireMissingBattleSeat(roomNumber, cycle, seat)
            }).catch(error => console.error(`[MULTI] barrier grace failed: room=${roomNumber}`, error))
        }, graceMs)
        timer.unref()
        cycle.timers.set(key, timer)
    }

    private queueBattleLeave(roomNumber: string, connectionId: string): void {
        let pending = this.pendingBattleLeaves.get(roomNumber)
        if (!pending) {
            pending = new Set()
            this.pendingBattleLeaves.set(roomNumber, pending)
        }
        pending.add(connectionId)
    }

    private publishBattleDeparture(client: SessionClient): void {
        if (client.fiveBossBattleEntered && client.finalizeSent) {
            // The client discards cooperation_battle as soon as Finalized
            // arrives. That close ends a finished battle; a Leave here would
            // only show teammates a false disconnect notice.
            return
        } else if (this.battleSceneStartedRooms.has(client.roomNumber)) {
            // Any other close mid-battle (network loss, app killed, or the
            // client isolating itself after a lag spike) must reach the
            // teammates. The CN client runs battles in lockstep: without
            // Leave, a silent peer's frame counter stands still, every
            // teammate slows down and after ~240 frames isolates itself with
            // "communication lost" (in the first dual-boss round it freezes
            // instead). Leave turns that peer into a departed member at once.
            this.broadcastBattleLeave(client.roomNumber, client.connectionId)
        } else {
            this.queueBattleLeave(client.roomNumber, client.connectionId)
        }
    }

    private broadcastBattleLeave(roomNumber: string, connectionId: string): void {
        for (const client of this.getConnectedBattleClients(roomNumber)) {
            if (client.connectionId === connectionId) continue
            this.sendJson(client.socket, [1, [0, connectionId]])
        }
    }

    private deferStartDecision(roomNumber: string, apply: () => void): boolean {
        const room = require("../room/manager").getRoom(roomNumber)
        if (!room) return false
        const instanceId = room.lifecycle.instanceId, battleSessionId = room.lifecycle.battleSessionId
        return require("../coordinator/room-start-claims").deferPinnedRoomControl(room, () => {
            if (require("../room/manager").getRoom(roomNumber) === room
                && room.lifecycle.instanceId === instanceId && room.lifecycle.battleSessionId === battleSessionId) apply()
        })
    }

    private activateBattleScene(roomNumber: string): void {
        if (this.deferStartDecision(roomNumber, () => this.activateBattleScene(roomNumber))) return
        const clients = this.getConnectedBattleClients(roomNumber)
        const room = require("../room/manager").getRoom(roomNumber)
        this.battleSceneStartedRooms.add(roomNumber)
        this.recordFiveBossBattleEntry(roomNumber, clients)

        // Promote the entire room together. SceneReady means only that one
        // client finished loading; treating it as active before this point can
        // publish Leave to peers that are still constructing their battle.
        for (const client of clients) {
            if (room) markBattleMemberPhase(room, client.viewerId, "ACTIVE")
            if (client.fiveBossBattleEntered) {
                // The CN five-boss client can stay silent for longer than the
                // ordinary heartbeat lease while a boss is active. Keep the
                // authenticated socket for LevelNext; the next loading phase
                // and the room watchdog still provide bounded cleanup.
                this.clearBattleHeartbeatLease(client.connectionId)
            } else {
                this.armActiveBattleHeartbeatLease(client.connectionId)
            }
        }
        for (const client of clients) {
            this.sendJson(client.socket, [1, [1]])
        }

        // Every survivor must observe BattleStart before AI takeover. Sending
        // Leave earlier lets differently loaded clients build divergent local
        // battle/chain state and can stall subsequent chain activations.
        const pending = this.pendingBattleLeaves.get(roomNumber)
        this.pendingBattleLeaves.delete(roomNumber)
        for (const connectionId of pending ?? []) {
            this.broadcastBattleLeave(roomNumber, connectionId)
        }
    }

    private recordFiveBossBattleEntry(roomNumber: string, clients: SessionClient[]): void {
        let room
        try { room = require("../room/manager").getRoom(roomNumber) }
        catch { return }
        if (!room?.five_boss_runtime) return
        try {
            const { recordFiveBossSignal } = require("../five-boss/lobby-runtime")
            for (const client of clients) recordFiveBossSignal(room, client, "scene_ready")
        } catch (error) {
            console.error(`[FIVE-BOSS-SIGNAL] battle entry dispatch failed: room=${roomNumber}`, error)
        }
    }

    private getConnectedBattleClients(roomNumber: string): SessionClient[] {
        const result: SessionClient[] = []
        for (const connectionId of this.battleClients.get(roomNumber) ?? []) {
            const client = this.cidToBattleClient.get(connectionId)
            if (client && !client.socket.destroyed) result.push(client)
        }
        return result
    }

    private clearBattleHeartbeatLeasesForRoom(roomNumber: string): void {
        for (const [connectionId, client] of this.cidToBattleClient) {
            if (client.roomNumber === roomNumber) this.clearBattleHeartbeatLease(connectionId)
        }
    }

    private clearRescueGuestWait(roomNumber: string, viewerId: number): void {
        const key = this.addr(viewerId, roomNumber)
        const wait = this.rescueGuestWaits.get(key)
        if (!wait) return
        clearTimeout(wait.warningTimer)
        clearTimeout(wait.ejectTimer)
        this.rescueGuestWaits.delete(key)
    }

    private clearRescueGuestReconnect(roomNumber: string, viewerId: number): void {
        const key = this.addr(viewerId, roomNumber)
        const timer = this.rescueGuestReconnectTimers.get(key)
        if (timer) clearTimeout(timer)
        this.rescueGuestReconnectTimers.delete(key)
    }

    markRescueGuest(
        roomNumber: string,
        viewerId: number,
        isNewbieRescue = false,
        isFragmentRewardEligible = false,
    ): void {
        let viewers = this.rescueGuests.get(roomNumber)
        if (!viewers) {
            viewers = new Set()
            this.rescueGuests.set(roomNumber, viewers)
        }
        viewers.add(viewerId)
        if (isNewbieRescue) {
            let newbieViewers = this.newbieRescueGuests.get(roomNumber)
            if (!newbieViewers) {
                newbieViewers = new Set()
                this.newbieRescueGuests.set(roomNumber, newbieViewers)
            }
            newbieViewers.add(viewerId)
        } else {
            this.newbieRescueGuests.get(roomNumber)?.delete(viewerId)
        }
        if (isFragmentRewardEligible) {
            let eligibleViewers = this.rescueFragmentEligibleGuests.get(roomNumber)
            if (!eligibleViewers) {
                eligibleViewers = new Set()
                this.rescueFragmentEligibleGuests.set(roomNumber, eligibleViewers)
            }
            eligibleViewers.add(viewerId)
        } else {
            this.rescueFragmentEligibleGuests.get(roomNumber)?.delete(viewerId)
        }
        this.blockedRoomRestores.get(roomNumber)?.delete(viewerId)
        this.clearRescueGuestReconnect(roomNumber, viewerId)
    }

    isRescueGuest(roomNumber: string, viewerId: number): boolean {
        return this.rescueGuests.get(roomNumber)?.has(viewerId) ?? false
    }

    isNewbieRescueGuest(roomNumber: string, viewerId: number): boolean {
        return this.newbieRescueGuests.get(roomNumber)?.has(viewerId) ?? false
    }

    isRescueFragmentEligibleGuest(roomNumber: string, viewerId: number): boolean {
        return this.rescueFragmentEligibleGuests.get(roomNumber)?.has(viewerId) ?? false
    }

    isRoomRestoreBlocked(roomNumber: string, viewerId: number): boolean {
        return this.blockedRoomRestores.get(roomNumber)?.has(viewerId) ?? false
    }

    isBattleSeatRetired(roomNumber: string, viewerId: number): boolean {
        return this.retiredBattleSeats.get(roomNumber)?.has(`viewer:${viewerId}`) ?? false
    }

    beginRescueGuestWait(client: SessionClient): void {
        if (client.equipmentReadyBlock) return
        if (!this.isRescueGuest(client.roomNumber, client.viewerId)) return

        const key = this.addr(client.viewerId, client.roomNumber)
        this.clearRescueGuestReconnect(client.roomNumber, client.viewerId)
        this.blockedRoomRestores.get(client.roomNumber)?.delete(client.viewerId)

        const existing = this.rescueGuestWaits.get(key)
        if (existing && existing.ready === client.isReady) {
            const remainingSeconds = Math.max(1, Math.ceil((existing.deadline - Date.now()) / 1_000))
            if (remainingSeconds <= 30) this.sendJson(client.socket, [1, [7, remainingSeconds]])
            return
        }
        if (existing) this.clearRescueGuestWait(client.roomNumber, client.viewerId)

        // A ready rescue guest is actively waiting for the host to start and
        // must not be mistaken for an abandoned visitor by the short idle
        // timeout. Keep an eventual release path because the official client
        // has no Leave button, but give prepared guests a much longer window.
        const waitMs = client.isReady
            ? this.parsePositiveDuration("RESCUE_GUEST_READY_WAIT_MS", 600_000, 10_000)
            : this.parsePositiveDuration("RESCUE_GUEST_WAIT_MS", 180_000, 2_000)
        const ready = client.isReady
        const warningMs = Math.min(
            waitMs,
            this.parsePositiveDuration("RESCUE_GUEST_WARNING_MS", 30_000, 1_000),
        )
        const deadline = Date.now() + waitMs
        const warningTimer = setTimeout(() => {
            const current = this.getClient(client.viewerId, client.roomNumber)
            if (!current || current.enterData === null || current.isBattle) return
            if (current.isReady !== ready) {
                this.clearRescueGuestWait(client.roomNumber, client.viewerId)
                this.beginRescueGuestWait(current)
                return
            }
            this.sendJson(current.socket, [1, [7, Math.max(1, Math.ceil(warningMs / 1_000))]])
            console.warn(`[MULTI] rescue guest timeout warning: viewer=${client.viewerId} room=${client.roomNumber} seconds=${Math.ceil(warningMs / 1_000)}`)
        }, Math.max(0, waitMs - warningMs))
        warningTimer.unref()

        const ejectTimer = setTimeout(() => {
            void embeddedMultiCoordinator.enqueueRoomCommand(client.roomNumber, () => {
                const current = this.getClient(client.viewerId, client.roomNumber)
                if (current && !current.isBattle && current.isReady !== ready) {
                    this.clearRescueGuestWait(client.roomNumber, client.viewerId)
                    this.beginRescueGuestWait(current)
                    return
                }
                this.ejectRescueGuest(client.roomNumber, client.viewerId, "rescue_wait_timeout")
            }).catch(error => console.error(
                `[MULTI] rescue wait timeout failed: room=${client.roomNumber} viewer=${client.viewerId}`,
                error,
            ))
        }, waitMs)
        ejectTimer.unref()

        this.rescueGuestWaits.set(key, { deadline, ready, warningTimer, ejectTimer })
        gameVerboseLog(() => `[MULTI] rescue guest wait started: viewer=${client.viewerId} room=${client.roomNumber} ready=${ready} waitMs=${waitMs}`)
    }

    clearRescueGuestLobbyWait(roomNumber: string, viewerId: number): void {
        this.clearRescueGuestWait(roomNumber, viewerId)
    }

    beginRescueGuestReconnectGrace(client: SessionClient): void {
        if (client.isBattle || !this.isRescueGuest(client.roomNumber, client.viewerId)) return

        const key = this.addr(client.viewerId, client.roomNumber)
        if (this.rescueGuestReconnectTimers.has(key)) return
        const reconnectMs = this.parsePositiveDuration("RESCUE_GUEST_RECONNECT_GRACE_MS", 25_000)
        const timer = setTimeout(() => {
            void embeddedMultiCoordinator.enqueueRoomCommand(client.roomNumber, () => {
                if (this.rescueGuestReconnectTimers.get(key) !== timer) return
                this.rescueGuestReconnectTimers.delete(key)
                const current = this.getClient(client.viewerId, client.roomNumber)
                if (current && !current.isBattle) return
                this.ejectRescueGuest(client.roomNumber, client.viewerId, "rescue_reconnect_timeout")
            }).catch(error => console.error(
                `[MULTI] rescue reconnect timeout failed: room=${client.roomNumber} viewer=${client.viewerId}`,
                error,
            ))
        }, reconnectMs)
        timer.unref()
        this.rescueGuestReconnectTimers.set(key, timer)
        gameVerboseLog(() => `[MULTI] rescue guest reconnect grace started: viewer=${client.viewerId} room=${client.roomNumber} graceMs=${reconnectMs}`)
    }

    /** Send the native leave message only to the offending guest, never to the room. */
    ejectEquipmentGuest(roomNumber: string, viewerId: number): void {
        const { getRoom } = require("../room/manager")
        const room = getRoom(roomNumber)
        if (!room || room.host_viewer_id === viewerId || room.lifecycle.phase !== "LOBBY") return
        const client = this.getClient(viewerId, roomNumber)
        if (!client || client.isBattle) return
        const sent = this.sendJson(client.socket, [1, [6, "multibattle_room_dismissed"]])
        this.ejectRescueGuest(roomNumber, viewerId, "equipment_idle", sent !== "closed")
    }

    ejectRescueGuest(roomNumber: string, viewerId: number, reason: string, notified = false): void {
        this.clearRescueGuestWait(roomNumber, viewerId)
        this.clearRescueGuestReconnect(roomNumber, viewerId)
        this.rescueGuests.get(roomNumber)?.delete(viewerId)
        this.newbieRescueGuests.get(roomNumber)?.delete(viewerId)
        this.rescueFragmentEligibleGuests.get(roomNumber)?.delete(viewerId)

        let blocked = this.blockedRoomRestores.get(roomNumber)
        if (!blocked) {
            blocked = new Set()
            this.blockedRoomRestores.set(roomNumber, blocked)
        }
        blocked.add(viewerId)
        try {
            const { removeRoomMember } = require("../room/manager")
            removeRoomMember(roomNumber, viewerId)
        } catch (e) {}
        try {
            const { suppressRandomRecruitmentForViewer } = require("../recruitment")
            suppressRandomRecruitmentForViewer(roomNumber, viewerId)
        } catch (e) {}

        const current = this.getClient(viewerId, roomNumber)
        if (current && !current.isBattle) {
            this.removeClient(current)
            if (notified) {
                this.retireDisbandedLobbySocket(current.socket, roomNumber)
            } else {
                markTcpDisconnectReason(current.socket, "rescue_timeout")
                try { current.socket.end() } catch (e) {}
                setTimeout(() => {
                    try { current.socket.destroy() } catch (e) {}
                }, 250).unref()
            }
        }
        try {
            const lobby = require("../tcp/lobby")
            lobby.scheduleRematchDisconnectCleanup?.(roomNumber)
            lobby.scheduleNpcReconcile?.(roomNumber)
        } catch (e) {}
        gameVerboseLog(() => `[MULTI] rescue guest released: viewer=${viewerId} room=${roomNumber} reason=${reason}`)
    }

    beginHostReconnectGrace(roomNumber: string): void {
        if (this.hostReconnectTimers.has(roomNumber)) return
        let roomInstanceId: string
        let roomGeneration: number
        try {
            const { getRoom } = require("../room/manager")
            const room = getRoom(roomNumber)
            if (!room) return
            roomInstanceId = embeddedMultiCoordinator.ensureLifecycle(room).instanceId
            roomGeneration = room.lobby_generation
        } catch (e) {
            return
        }
        const baseReconnectMs = this.parsePositiveDuration("MULTI_HOST_RECONNECT_GRACE_MS", 25_000)
        // After a rematch generation, guests are allowed the longer
        // REMATCH_RECONNECT_GRACE_MS to return.  A host that briefly drops
        // after entering that lobby must not make the room disappear sooner
        // than the guest's own reconnect window.
        const rematchReconnectMs = roomGeneration > 0
            ? this.parsePositiveDuration("REMATCH_RECONNECT_GRACE_MS", 60_000)
            : 0
        const reconnectMs = Math.max(baseReconnectMs, rematchReconnectMs)
        const timer = setTimeout(() => {
            void embeddedMultiCoordinator.enqueueRoomCommand(roomNumber, () => {
                if (this.hostReconnectTimers.get(roomNumber) !== timer) return
                this.hostReconnectTimers.delete(roomNumber)
                try {
                    const { getRoom } = require("../room/manager")
                    const room = getRoom(roomNumber)
                    if (!embeddedMultiCoordinator.isCurrentInstance(room, roomInstanceId)
                        || room.lobby_generation !== roomGeneration
                        || room.lifecycle.phase === "BATTLE") return
                    if (this.isHostOnline(room.host_viewer_id, roomNumber, roomGeneration)) return
                    this.commitRoomDisband(roomNumber, "host_reconnect_timeout")
                } catch (e) {}
            }).catch(error => console.error(`[MULTI] host reconnect timeout failed: room=${roomNumber}`, error))
        }, reconnectMs)
        timer.unref()
        this.hostReconnectTimers.set(roomNumber, timer)
        gameVerboseLog(() => `[MULTI] host reconnect grace started: room=${roomNumber} graceMs=${reconnectMs}`)
    }

    cancelHostReconnectGrace(roomNumber: string): void {
        const timer = this.hostReconnectTimers.get(roomNumber)
        if (timer) clearTimeout(timer)
        this.hostReconnectTimers.delete(roomNumber)
    }

    clearRescueGuestStateForRoom(roomNumber: string): void {
        const viewers = new Set<number>([
            ...(this.rescueGuests.get(roomNumber) ?? []),
            ...(this.blockedRoomRestores.get(roomNumber) ?? []),
        ])
        for (const viewerId of viewers) {
            this.clearRescueGuestWait(roomNumber, viewerId)
            this.clearRescueGuestReconnect(roomNumber, viewerId)
        }
        this.rescueGuests.delete(roomNumber)
        this.newbieRescueGuests.delete(roomNumber)
        this.rescueFragmentEligibleGuests.delete(roomNumber)
        this.blockedRoomRestores.delete(roomNumber)
    }

    /**
     * Each CN client simulates every member's battle locally, so a custom boss
     * can die on one device minutes before the others. After the first
     * victorious /finish, tell the teammates still in their battle scene with
     * BattleServerMessage.Finalized ([1,[2]]); the v35m client patch turns that
     * into a victory. Older clients only drop their battle socket on it, so the
     * whole room must run v35m: off unless MULTI_SERVER_CONFIRMED_CLEAR=1.
     */
    sendServerConfirmedClear(roomNumber: string, settledViewerId: number, battleSessionId: string): number {
        if (!/^(1|true|yes|on)$/i.test(process.env.MULTI_SERVER_CONFIRMED_CLEAR ?? "")) return 0
        const sent: number[] = []
        for (const client of this.getConnectedBattleClients(roomNumber)) {
            if (client.viewerId === settledViewerId || client.serverClearSent) continue
            if (!this.isAwaitingFinalizeAfterSettlement(client)) continue
            client.serverClearSent = battleSessionId
            this.sendJson(client.socket, [1, [2]], {
                roomNumber,
                connectionId: client.connectionId,
                viewerId: client.viewerId,
                roomGeneration: client.roomGeneration,
                channel: "server_confirmed_clear",
            })
            sent.push(client.viewerId)
        }
        if (sent.length > 0) console.warn(`[MULTI] server-confirmed clear sent: room=${roomNumber}`
            + ` settled=${settledViewerId} to=${sent.join(",")}`)
        return sent.length
    }

    /** Remember that this viewer's last room HTTP request carried outdated resources. */
    markStaleAssetViewer(roomNumber: string, viewerId: number): void {
        const now = Date.now()
        for (const [key, expiresAt] of this.staleAssetViewers) if (expiresAt < now) this.staleAssetViewers.delete(key)
        this.staleAssetViewers.set(`${roomNumber}:${viewerId}`, now + 120_000)
    }

    /** One-shot: true when the viewer entering this room must update its assets first. */
    takeStaleAssetViewer(roomNumber: string, viewerId: number): boolean {
        const key = `${roomNumber}:${viewerId}`
        const expiresAt = this.staleAssetViewers.get(key)
        this.staleAssetViewers.delete(key)
        return expiresAt !== undefined && expiresAt >= Date.now()
    }

    /** A real member still in its battle scene after a teammate already settled. */
    private isAwaitingFinalizeAfterSettlement(client: SessionClient): boolean {
        if (!client.isBattle || client.finalizeSent || client.socket.destroyed) return false
        try {
            const room = require("../room/manager").getRoom(client.roomNumber)
            if (!room || room.five_boss_runtime) return false
            const phase = room.lifecycle?.phase
            if (phase !== "SETTLING" && phase !== "RETURNING") return false
            const member = getBattleSessionContract(room)?.members.get(client.viewerId)
            return !member || member.phase === "ACTIVE" || member.phase === "READY"
        } catch (e) {
            return false
        }
    }

    private unsettledBattleClients(roomNumber: string): SessionClient[] {
        return this.getConnectedBattleClients(roomNumber).filter(client => this.isAwaitingFinalizeAfterSettlement(client))
    }

    /**
     * Disbanding closes every battle socket. When the host leaves right after
     * its own settlement, teammates that have not sent Finalize yet would get
     * S1000 and lose their /finish. Keep the room until they finish, bounded by
     * MULTI_DISBAND_SETTLEMENT_WAIT_MS
     * (default BATTLE_ROOM_TIMEOUT_MS).
     */
    private deferDisbandForUnsettledMembers(roomNumber: string, reason: string, messageKey: string): boolean {
        // Teammates can still be fighting after one member finished. The
        // settling heartbeat lease already drops a silent socket, so a connected
        // one is live; cap it with the abandoned-battle watchdog duration.
        const waitMs = this.parsePositiveDuration("MULTI_DISBAND_SETTLEMENT_WAIT_MS",
            this.parsePositiveDuration("BATTLE_ROOM_TIMEOUT_MS", 900_000), 0)
        const pending = this.deferredDisbands.get(roomNumber)
        if (pending && performance.now() >= pending.deadline) return false
        const waiting = this.unsettledBattleClients(roomNumber)
        if (waiting.length === 0 || waitMs <= 0) return false
        if (pending) clearTimeout(pending.timer)
        const deadline = pending?.deadline ?? performance.now() + waitMs
        const timer = setTimeout(() => {
            void embeddedMultiCoordinator.enqueueRoomCommand(roomNumber, () => {
                if (this.deferredDisbands.get(roomNumber)?.timer !== timer) return
                if (!require("../room/manager").getRoom(roomNumber)) {
                    this.deferredDisbands.delete(roomNumber)
                    return
                }
                this.commitRoomDisband(roomNumber, reason, messageKey)
            }).catch(error => console.error(`[MULTI] deferred disband failed: room=${roomNumber}`, error))
        }, Math.max(0, Math.min(2_000, deadline - performance.now())))
        timer.unref()
        this.deferredDisbands.set(roomNumber, { timer, deadline })
        if (!pending) console.warn(`[MULTI] disband deferred for unsettled members: room=${roomNumber}`
            + ` reason=${reason} waiting=${waiting.map(client => client.viewerId).join(",")} maxWaitMs=${waitMs}`)
        return true
    }

    commitRoomDisband(roomNumber: string, reason: string, messageKey = "multibattle_room_dismissed"): boolean {
        const currentRoom = require("../room/manager").getRoom(roomNumber)
        if (currentRoom && require("../coordinator/room-start-claims").hasRoomStartClaims(currentRoom)) return false
        if (this.deferDisbandForUnsettledMembers(roomNumber, reason, messageKey)) return true
        const deferred = this.deferredDisbands.get(roomNumber)
        if (deferred) {
            clearTimeout(deferred.timer)
            this.deferredDisbands.delete(roomNumber)
            console.warn(`[MULTI] deferred disband committed: room=${roomNumber} reason=${reason}`
                + ` remaining=${this.unsettledBattleClients(roomNumber).map(client => client.viewerId).join(",") || "none"}`)
        }
        const roomClients = this.getClientsInRoom(roomNumber)
        const lobbyClients = roomClients.filter(client => !client.isBattle)
        const battleClients = this.getConnectedBattleClients(roomNumber)
        const allClients = [...new Set([...roomClients, ...battleClients])]
        this.clearBattleHeartbeatLeasesForRoom(roomNumber)
        let deleted = false
        try {
            const { disbandRoom } = require("../room/manager")
            // Commit the room as non-joinable before telling clients that it
            // was dismissed.  This makes the protocol message truthful even
            // when a client immediately tries restore_room/select_room.
            deleted = disbandRoom(roomNumber, reason)
        } catch (e) {
            this.removeRoomState(roomNumber)
        }
        if (!deleted) return false
        // MeetingServerMessage.Disbanded is valid only on cooperation_room.
        // Sending its enum index (6) to cooperation_battle makes the battle
        // unserializer dereference a missing enum entry and crash with C5602.
        const notifiedLobbySockets = new Set<net.Socket>()
        for (const client of lobbyClients) {
            const sendResult = this.sendJson(client.socket, [1, [6, messageKey]], {
                roomNumber,
                connectionId: client.connectionId,
                viewerId: client.viewerId,
                roomGeneration: client.roomGeneration,
                channel: "room_disband",
            })
            if (sendResult !== "closed") notifiedLobbySockets.add(client.socket)
        }
        for (const client of allClients) {
            const addr = this.addr(client.viewerId, roomNumber)
            if (this.clients.get(addr) === client) this.clients.delete(addr)
            if (client.isBattle) this.cidToBattleClient.delete(client.connectionId)
            this.unindexClientSocket(client)
            if (!client.isBattle && notifiedLobbySockets.has(client.socket)) {
                this.retireDisbandedLobbySocket(client.socket, roomNumber)
            } else {
                markTcpDisconnectReason(client.socket, "room_disband")
                try { client.socket.end() } catch (e) {}
                setTimeout(() => {
                    try { client.socket.destroy() } catch (e) {}
                }, 250).unref()
            }
        }
        this.closeSupersededSocketsForRoom(roomNumber)
        this.roomClients.delete(roomNumber)
        this.battleClients.delete(roomNumber)
        this.battleRelayMembershipChanged(roomNumber)
        this.clearBattleExpectedCount(roomNumber)
        this.retiredBattleSeats.delete(roomNumber)
        gameVerboseLog(() => `[MULTI] room disbanded: room=${roomNumber} reason=${reason}`)
        return true
    }

    private disbandRoomIfNoRealConnections(roomNumber: string, battleRoomTimeoutExpired = false): void {
        const lobbyConnectionCount = this.roomClients.get(roomNumber)?.size ?? 0
        const battleConnectionCount = this.battleClients.get(roomNumber)?.size ?? 0
        if (lobbyConnectionCount > 0 || battleConnectionCount > 0) return
        if (this.hostReconnectTimers.has(roomNumber)) return

        try {
            const { getRoom } = require("../room/manager")
            const room = getRoom(roomNumber)
            if (!room) return

            // The CN client closes the battle TCP socket as soon as the battle
            // scene has been initialized. The actual fight can then continue
            // client-side for minutes, so the 25-second reconnect grace must not
            // start here or the room can disappear before /finish is sent.
            // Keep only a long abandoned-battle watchdog for clients that never
            // send either /finish or /abort.
            if (room.lifecycle.phase === "BATTLE" && !battleRoomTimeoutExpired) {
                if (!this.abandonedBattleTimers.has(roomNumber)) {
                    const battleRoomTimeoutMs = parseInt(process.env.BATTLE_ROOM_TIMEOUT_MS || "900000")
                    const lifecycle = embeddedMultiCoordinator.ensureLifecycle(room)
                    const roomInstanceId = lifecycle.instanceId
                    const battleSessionId = lifecycle.battleSessionId
                    const timer = setTimeout(() => {
                        void embeddedMultiCoordinator.enqueueRoomCommand(roomNumber, () => {
                            if (this.abandonedBattleTimers.get(roomNumber) !== timer) return
                            this.abandonedBattleTimers.delete(roomNumber)
                            const currentRoom = getRoom(roomNumber)
                            if (!embeddedMultiCoordinator.isCurrentInstance(currentRoom, roomInstanceId)
                                || currentRoom.lifecycle.battleSessionId !== battleSessionId
                                || currentRoom.lifecycle.phase !== "BATTLE") return
                            this.disbandRoomIfNoRealConnections(roomNumber, true)
                        }).catch(error => console.error(`[MULTI] abandoned battle timeout failed: room=${roomNumber}`, error))
                    }, battleRoomTimeoutMs)
                    timer.unref()
                    this.abandonedBattleTimers.set(roomNumber, timer)
                    gameVerboseLog(() => `[MULTI] waiting for battle finish: room=${roomNumber} timeoutMs=${battleRoomTimeoutMs}`)
                }
                return
            }

            // Successful settlement has its own timer, deliberately separate
            // from REMATCH_RECONNECT_GRACE_MS. The latter starts only after the
            // return lobby exists and is used to wait for missing real players.
            if (room.settlement_return_pending) return

            const pendingTimer = this.abandonedBattleTimers.get(roomNumber)
            if (pendingTimer) clearTimeout(pendingTimer)
            this.abandonedBattleTimers.delete(roomNumber)
            this.roomClients.delete(roomNumber)
            this.battleClients.delete(roomNumber)
            this.battleRelayMembershipChanged(roomNumber)
            this.sceneReadyClients.delete(roomNumber)
            this.battleLevelNextClients.delete(roomNumber)
            this.battleExpectedCount.delete(roomNumber)
            try {
                const { stopRandomRecruitment } = require("../recruitment")
                stopRandomRecruitment(roomNumber)
            } catch (e) {}
            this.commitRoomDisband(roomNumber, "all_real_connections_closed")
            gameVerboseLog(() => `[MULTI] room disbanded: all real connections closed room=${roomNumber}`)
        } catch (e) {}
    }

    beginSettlementReturnGrace(roomNumber: string): void {
        const existingTimer = this.settlementReturnTimers.get(roomNumber)
        if (existingTimer) clearTimeout(existingTimer)
        this.settlementReturnTimers.delete(roomNumber)
        const abandonedTimer = this.abandonedBattleTimers.get(roomNumber)
        if (abandonedTimer) clearTimeout(abandonedTimer)
        this.abandonedBattleTimers.delete(roomNumber)

        let roomInstanceId: string
        let lifecycleVersion: number
        try {
            const { getRoom } = require("../room/manager")
            const room = getRoom(roomNumber)
            if (!room || room.lifecycle.phase !== "RETURNING") return
            const lifecycle = embeddedMultiCoordinator.ensureLifecycle(room)
            roomInstanceId = lifecycle.instanceId
            lifecycleVersion = lifecycle.version
            if (isFiveBossGauntletQuest(room.category, room.quest_id)
                && this.isHostOnline(room.host_viewer_id, roomNumber)) {
                this.completeSettlementReturn(roomNumber)
                return
            }
        } catch (e) {
            return
        }

        const settlementReturnGraceMs = parseInt(process.env.SETTLEMENT_RETURN_GRACE_MS || "60000")
        const timer = setTimeout(() => {
            void embeddedMultiCoordinator.enqueueRoomCommand(roomNumber, () => {
                if (this.settlementReturnTimers.get(roomNumber) !== timer) return
                this.settlementReturnTimers.delete(roomNumber)
                try {
                    const { getRoom } = require("../room/manager")
                    const room = getRoom(roomNumber)
                    if (!embeddedMultiCoordinator.isCurrentInstance(room, roomInstanceId)
                        || room.lifecycle.version !== lifecycleVersion
                        || room.lifecycle.phase !== "RETURNING"
                        || !room.settlement_return_pending) return

                    // Only the host completing the lobby Enter flow counts as a
                    // successful room return. Guests may wait during the grace
                    // period, but they must not keep a hostless room alive.
                    this.commitRoomDisband(roomNumber, "settlement_host_return_timeout")
                    console.warn(`[MULTI] room disbanded: host did not return after settlement room=${roomNumber}`)
                } catch (e) {}
            }).catch(error => console.error(`[MULTI] settlement return timeout failed: room=${roomNumber}`, error))
        }, settlementReturnGraceMs)
        timer.unref()
        this.settlementReturnTimers.set(roomNumber, timer)
        gameVerboseLog(() => `[MULTI] waiting for settlement lobby return: room=${roomNumber} graceMs=${settlementReturnGraceMs}`)
    }

    completeSettlementReturn(roomNumber: string): boolean {
        const currentRoom = require("../room/manager").getRoom(roomNumber)
        if (currentRoom && require("../coordinator/room-start-claims").hasRoomStartClaims(currentRoom)) return false
        const pendingTimer = this.settlementReturnTimers.get(roomNumber)
        if (pendingTimer) clearTimeout(pendingTimer)
        this.settlementReturnTimers.delete(roomNumber)
        let roomGeneration: number | undefined
        let roomInstanceId: string | undefined
        let completed = false
        try {
            const { getRoom } = require("../room/manager")
            const room = getRoom(roomNumber)
            if (room) {
                const transition = embeddedMultiCoordinator.applyRoomCommand(room, {
                    roomNumber, identity: embeddedMultiCoordinator.identity(room), kind: "COMPLETE_RETURN",
                })
                if (transition.ok) {
                    roomGeneration = room.lobby_generation
                    roomInstanceId = room.lifecycle.instanceId
                    for (const client of this.getClientsInRoom(roomNumber)) {
                        if (!client.isBattle && !client.superseded && !client.socket.destroyed) {
                            client.roomGeneration = room.lobby_generation
                        }
                    }
                    completed = true
                    this.battleRelayMembershipChanged(roomNumber)
                }
            }
        } catch (e) {}
        try {
            // Keep room lifetime and settlement eligibility independent.  A
            // successful host return advances retained finish snapshots to
            // LOBBY, but they remain replayable for their short TTL.
            const { transitionRoomSettlementSnapshots } = require("../settlement-snapshot")
            if (roomGeneration !== undefined) {
                transitionRoomSettlementSnapshots(roomNumber, "LOBBY", roomGeneration, roomInstanceId)
            }
        } catch (e) {}
        if (completed) gameVerboseLog(() => `[MULTI] settlement host returned: room=${roomNumber}`)
        return completed
    }

    createClient(socket: net.Socket, viewerId: number, roomNumber: string, connectionId: string, playerId: number | null): SessionClient {
        return {
            socket,
            viewerId,
            roomNumber,
            connectionId,
            playerId,
            isBattle: false,
            isReady: false,
            buffer: "",
            mates: [],
            enterData: null,
            roomGeneration: 0,
            connectionGeneration: 0,
            superseded: false,
            connectedAt: Date.now(),
            fiveBossBattleEntered: false,
            finalizeSent: false,
            admissionClaimed: false,
            clientState: new ClientStateMachine(ClientState.Connecting),
            battleState: BattleState.Initializing,
        }
    }

    getClient(viewerId: number, roomNumber: string): SessionClient | undefined {
        return this.clients.get(this.addr(viewerId, roomNumber))
    }

    getLobbyClientsForPlayer(playerId: number): SessionClient[] {
        return [...this.clients.values()].filter(client =>
            client.playerId === playerId && !client.isBattle && !client.superseded)
    }

    getRoomClientByConnectionId(roomNumber: string, connectionId: string): SessionClient | undefined {
        for (const client of this.getClientsInRoom(roomNumber)) {
            if (!client.isBattle && client.connectionId === connectionId) return client
        }
        return undefined
    }

    /**
     * Resolve who owns a battle connection id. The lobby connection that
     * issued the id is authoritative; when it is gone, a known battle seat for
     * the same connection id (live, awaiting reconnect, on the StartBattle
     * roster, or frozen by the five-boss runtime) identifies the viewer. Unknown ids resolve to null.
     */
    resolveBattleHandshakeIdentity(roomNumber: string, connectionId: string): {
        viewerId: number
        playerId: number | null
        roomGeneration?: number
    } | null {
        const currentRoom = require("../room/manager").getRoom(roomNumber)
        const roomClient = this.getRoomClientByConnectionId(roomNumber, connectionId)
        if (roomClient) {
            if (roomClient.roomInstanceId && roomClient.roomInstanceId !== currentRoom?.lifecycle.instanceId) return null
            return {
                viewerId: roomClient.viewerId,
                playerId: roomClient.playerId,
                roomGeneration: roomClient.roomGeneration,
            }
        }
        const battleClient = this.cidToBattleClient.get(connectionId)
        if (battleClient && battleClient.roomNumber === roomNumber && battleClient.viewerId > 0) {
            if (!this.isCurrentBattleClient(battleClient)) return null
            return {
                viewerId: battleClient.viewerId,
                playerId: battleClient.playerId,
                roomGeneration: battleClient.roomGeneration,
            }
        }
        let room: any
        try {
            room = require("../room/manager").getRoom(roomNumber)
        } catch (e) {
            room = undefined
        }
        const memberPlayerId = (viewerId: number): number | null => {
            try {
                return room ? require("../room/manager").getRoomMemberPlayerId(room, viewerId) : null
            } catch (e) {
                return null
            }
        }
        // Battle peers carry the lobby round they started from; a seat that
        // reconnects without its lobby socket must join that same round.
        const battleGeneration = (): number | undefined => {
            for (const id of this.battleClients.get(roomNumber) ?? []) {
                const peer = this.cidToBattleClient.get(id)
                if (peer) return peer.roomGeneration
            }
            return room?.lifecycle?.phase === "BATTLE"
                ? Math.max(0, Number(room.lobby_generation ?? 0) - 1)
                : undefined
        }
        for (const seat of this.battleBarrierCycles.get(roomNumber)?.missing.values() ?? []) {
            if (seat.connectionId === connectionId && seat.viewerId > 0) {
                return {
                    viewerId: seat.viewerId,
                    playerId: memberPlayerId(seat.viewerId),
                    roomGeneration: battleGeneration(),
                }
            }
        }
        const rostered = this.battleRosterSeats.get(roomNumber)?.get(connectionId)
        if (rostered) {
            return {
                viewerId: rostered.viewerId,
                playerId: rostered.playerId ?? memberPlayerId(rostered.viewerId),
                roomGeneration: rostered.roomGeneration,
            }
        }
        const frozen = room?.five_boss_runtime?.battleIdentityByViewerId
        if (frozen && typeof frozen === "object") {
            for (const [viewerKey, identity] of Object.entries(frozen) as [string, any][]) {
                const viewerId = Number(viewerKey)
                if (identity?.connectionId === connectionId && Number.isSafeInteger(viewerId) && viewerId > 0) {
                    return { viewerId, playerId: identity.playerId ?? null, roomGeneration: battleGeneration() }
                }
            }
        }
        return null
    }

    addClientToRoom(client: SessionClient): Result<void> {
        const room = require("../room/manager").getRoom(client.roomNumber)
        if (room) require("../../lib/weapon-riven/multi-room").cancelWeaponRivenPreparation(room, "connection_changed")
        if (room) client.roomInstanceId = room.lifecycle.instanceId
        const addr = this.addr(client.viewerId, client.roomNumber)
        const previous = this.clients.get(addr)
        const nextConnectionGeneration = (this.roomConnectionGenerations.get(addr) ?? 0) + 1
        this.roomConnectionGenerations.set(addr, nextConnectionGeneration)
        client.connectionGeneration = nextConnectionGeneration
        client.superseded = false
        this.clients.set(addr, client)
        if (previous && previous !== client && previous.socket !== client.socket) {
            require("../tcp/lobby").clearPendingFiveBossReturnEnter(previous, "connection_replaced")
            clearEquipmentBlock(previous)
            previous.superseded = true
            this.unindexClientSocket(previous)
            clearReliableSendState(previous.socket)
            const closeCheckMs = this.quarantineSupersededSocket(
                `lobby:${addr}`,
                client.roomNumber,
                previous.socket,
                () => {
                    const current = this.clients.get(addr)
                    return !!current && current !== previous && !current.socket.destroyed
                },
            )
            gameVerboseLog(() => `[MULTI] room connection superseded: viewer=${client.viewerId}`
                + ` room=${client.roomNumber} oldGeneration=${previous.connectionGeneration}`
                + ` newGeneration=${client.connectionGeneration} closeCheckMs=${closeCheckMs}`)
        }
        this.indexClientSocket(client)
        let set = this.roomClients.get(client.roomNumber)
        if (!set) {
            set = new Set()
            this.roomClients.set(client.roomNumber, set)
        }
        set.add(addr)
        if (this.isRescueGuest(client.roomNumber, client.viewerId)) {
            this.clearRescueGuestReconnect(client.roomNumber, client.viewerId)
        }
        return { ok: true, value: undefined }
    }

    removeClient(client: SessionClient): Result<void> {
        require("../tcp/lobby").clearPendingFiveBossReturnEnter(client, "connection_removed")
        clearEquipmentBlock(client)
        if (client.isBattle) fiveBossConnectionDiagnostics.socketEvent(client.socket, "removed",
            this.cidToBattleClient.get(client.connectionId) === client ? "current_connection" : "stale_connection")
        this.unindexClientSocket(client)
        if (!client.isBattle && client.admissionClaimed) {
            roomAdmissionRegistry.releaseClaim(
                client.roomNumber,
                client.admissionGeneration ?? client.roomGeneration,
                client.viewerId,
                client.connectionId,
            )
            client.admissionClaimed = false
        }
        const addr = this.addr(client.viewerId, client.roomNumber)
        const isCurrentConnection = this.clients.get(addr) === client
        if (isCurrentConnection && !client.isBattle) {
            const room = require("../room/manager").getRoom(client.roomNumber)
            if (room) require("../../lib/weapon-riven/multi-room").cancelWeaponRivenPreparation(room, "connection_removed")
        }
        if (!client.isBattle && (!isCurrentConnection || client.superseded)) {
            return { ok: true, value: undefined }
        }
        if (isCurrentConnection) this.clients.delete(addr)

        if (client.isBattle) {
            const superseded = this.supersededBattleClients.delete(client)
            const isCurrentBattleConnection = this.cidToBattleClient.get(client.connectionId) === client
            if (isCurrentBattleConnection) this.clearBattleHeartbeatLease(client.connectionId)
            const bSet = this.battleClients.get(client.roomNumber)
            if (bSet && !superseded && isCurrentBattleConnection) {
                this.publishBattleDeparture(client)
            }
            if (isCurrentBattleConnection) {
                this.battleClients.get(client.roomNumber)?.delete(client.connectionId)
                if (this.battleClients.get(client.roomNumber)?.size === 0) {
                    this.battleClients.delete(client.roomNumber)
                }
                this.cidToBattleClient.delete(client.connectionId)
                this.sceneReadyClients.get(client.roomNumber)?.delete(client.connectionId)
                this.battleLevelNextClients.get(client.roomNumber)?.delete(client.connectionId)
                this.battleRelayMembershipChanged(client.roomNumber)
            }
            if (!superseded && isCurrentBattleConnection) this.scheduleMissingBattleSeat(client.roomNumber, client)
        }

        const set = this.roomClients.get(client.roomNumber)
        if (set && isCurrentConnection) {
            set.delete(addr)
            if (!client.isBattle) {
                try {
                    const { getRoom } = require("../room/manager")
                    const room = getRoom(client.roomNumber)
                    if (room
                        && room.lifecycle.phase === "LOBBY"
                        && client.roomGeneration === room.lobby_generation) {
                        const remaining = this.getClientsInRoom(client.roomNumber, room.lobby_generation)
                        for (const other of remaining) {
                            other.mates = other.mates.filter(mate => mate.viewerId !== client.viewerId)
                        }
                        const host = remaining.find(other => other.viewerId === room.host_viewer_id)
                        room.mates = (host?.mates ?? remaining.map(other => other.yourself).filter(Boolean))
                            .map((mate: any) => ({
                                viewer_id: mate.viewerId ?? null,
                                com_id: mate.comId ?? 0,
                                player_id: mate.playerId ?? undefined,
                            }))
                        if (host) {
                            this.broadcastToRoom(client.roomNumber, [1, [1, host.mates]])
                            try {
                                const lobby = require("../tcp/lobby")
                                lobby.scheduleRematchDisconnectCleanup?.(client.roomNumber)
                            } catch (e) {}
                        }
                    }
                } catch (e) {}
            }
            if (set.size === 0) {
                this.roomClients.delete(client.roomNumber)
            } else {
                // OLD: if room still has clients, re-evaluate host auto-ready
                if (!client.isBattle) {
                    try {
                        const lobby = require("../tcp/lobby")
                        if (lobby.checkHostAutoReady) lobby.checkHostAutoReady(client.roomNumber)
                    } catch (e) {}
                }
            }
        }
        if (!client.isBattle && isCurrentConnection) {
            try {
                const { getRoom } = require("../room/manager")
                const room = getRoom(client.roomNumber)
                if (room && room.lifecycle.phase === "LOBBY") {
                    if (room.host_viewer_id === client.viewerId) {
                        this.beginHostReconnectGrace(client.roomNumber)
                    } else {
                        this.beginRescueGuestReconnectGrace(client)
                    }
                }
            } catch (e) {}
        }
        this.disbandRoomIfNoRealConnections(client.roomNumber)
        return { ok: true, value: undefined }
    }

    getClientsInRoom(roomNumber: string, roomGeneration?: number): SessionClient[] {
        const set = this.roomClients.get(roomNumber)
        if (!set) return []
        const out: SessionClient[] = []
        for (const addr of set) {
            const c = this.clients.get(addr)
            if (c && (roomGeneration === undefined || c.roomGeneration === roomGeneration)) out.push(c)
        }
        return out
    }

    /** True while any lobby or battle connection is indexed for the room. */
    hasRoomConnections(roomNumber: string): boolean {
        return (this.roomClients.get(roomNumber)?.size ?? 0) > 0
            || (this.battleClients.get(roomNumber)?.size ?? 0) > 0
    }

    hasRoomClients(roomNumber: string): boolean {
        const set = this.roomClients.get(roomNumber)
        return !!set && set.size > 0
    }

    isHostOnline(hostViewerId: number, roomNumber: string, roomGeneration?: number): boolean {
        const set = this.roomClients.get(roomNumber)
        if (!set) return false
        for (const addr of set) {
            const c = this.clients.get(addr)
            if (c
                && !c.isBattle
                && !c.superseded
                && c.enterData !== null
                && !c.socket.destroyed
                && c.viewerId === hostViewerId
                && (roomGeneration === undefined || c.roomGeneration === roomGeneration)) return true
        }
        return false
    }

    addBattleClient(connectionId: string, client: SessionClient): boolean {
        const seatKey = this.battleSeatKey(client)
        // A seat already handed to AI cannot form a second independent battle
        // by arriving after grace. The next actual round resets this decision.
        const retired = this.retiredBattleSeats.get(client.roomNumber)
        if (retired?.has(seatKey) || retired?.has(`connection:${connectionId}`)) return false
        const room = require("../room/manager").getRoom(client.roomNumber)
        if (room && !bindBattleConnection(room, client)) return false
        const cycle = this.battleBarrierCycles.get(client.roomNumber)
        cycle?.arrived.add(seatKey)
        cycle?.arrived.add(`connection:${connectionId}`)
        const reconnectTimer = cycle?.timers.get(seatKey)
        if (reconnectTimer) clearTimeout(reconnectTimer)
        cycle?.timers.delete(seatKey)
        const missing = cycle?.missing.get(seatKey)
        if (missing) this.pendingBattleLeaves.get(client.roomNumber)?.delete(missing.connectionId)
        cycle?.missing.delete(seatKey)
        const pendingTimer = this.abandonedBattleTimers.get(client.roomNumber)
        if (pendingTimer) clearTimeout(pendingTimer)
        this.abandonedBattleTimers.delete(client.roomNumber)
        let set = this.battleClients.get(client.roomNumber)
        if (!set) {
            set = new Set()
            this.battleClients.set(client.roomNumber, set)
        }
        // A reconnect may establish a replacement socket before the old one
        // emits close.  Keep one battle connection per real viewer so the
        // SceneReady barrier cannot count a stale socket as a missing player.
        for (const existingConnectionId of [...set]) {
            const existing = this.cidToBattleClient.get(existingConnectionId)
            if (!existing) continue
            const sameSocketIdentity = existingConnectionId === connectionId
            const sameKnownViewer = client.viewerId > 0
                && existing.viewerId > 0
                && existing.viewerId === client.viewerId
            if (!sameSocketIdentity && !sameKnownViewer) continue
            this.clearBattleHeartbeatLease(existingConnectionId)
            set.delete(existingConnectionId)
            this.sceneReadyClients.get(client.roomNumber)?.delete(existingConnectionId)
            this.battleLevelNextClients.get(client.roomNumber)?.delete(existingConnectionId)
            this.cidToBattleClient.delete(existingConnectionId)
            this.supersededBattleClients.add(existing)
            existing.superseded = true
            fiveBossConnectionDiagnostics.socketEvent(existing.socket, "replaced")
            this.unindexClientSocket(existing)
            clearReliableSendState(existing.socket)
            const ownerIdentity = client.viewerId > 0 ? `viewer:${client.viewerId}` : `connection:${connectionId}`
            this.quarantineSupersededSocket(
                `battle:${ownerIdentity}@${client.roomNumber}`,
                client.roomNumber,
                existing.socket,
                () => {
                    const current = this.cidToBattleClient.get(connectionId)
                    if (current === client && !current.socket.destroyed) return true
                    if (client.viewerId <= 0) return false
                    return [...this.cidToBattleClient.values()].some(candidate => candidate !== existing
                        && candidate.roomNumber === client.roomNumber
                        && candidate.viewerId === client.viewerId
                        && !candidate.socket.destroyed)
                },
            )
            this.logBattleBarrierState(client.roomNumber, "connection_replaced")
        }
        const pendingLeaves = this.pendingBattleLeaves.get(client.roomNumber)
        pendingLeaves?.delete(connectionId)
        if (pendingLeaves?.size === 0) this.pendingBattleLeaves.delete(client.roomNumber)
        set.add(connectionId)
        this.cidToBattleClient.set(connectionId, client)
        this.battleRelayMembershipChanged(client.roomNumber)
        this.indexClientSocket(client)
        this.armBattleLoadingLease(connectionId)
        fiveBossConnectionDiagnostics.socketEvent(client.socket, "accepted")
        battleTelemetry.connected(client.roomNumber, client.viewerId)
        this.logBattleBarrierState(client.roomNumber, "connected")
        return true
    }

    removeBattleClient(connectionId: string): void {
        this.clearBattleHeartbeatLease(connectionId)
        const client = this.cidToBattleClient.get(connectionId)
        if (client) {
            fiveBossConnectionDiagnostics.socketEvent(client.socket, "removed", "remove_battle_client")
            this.publishBattleDeparture(client)
            this.unindexClientSocket(client)
            this.battleClients.get(client.roomNumber)?.delete(connectionId)
            this.sceneReadyClients.get(client.roomNumber)?.delete(connectionId)
            this.battleLevelNextClients.get(client.roomNumber)?.delete(connectionId)
        }
        this.cidToBattleClient.delete(connectionId)
        if (client) this.battleRelayMembershipChanged(client.roomNumber)
        if (client) this.scheduleMissingBattleSeat(client.roomNumber, client)
    }

    getBattleClient(connectionId: string): SessionClient | undefined {
        return this.cidToBattleClient.get(connectionId)
    }

    findClientBySocket(socket: net.Socket): SessionClient | undefined {
        return this.socketClients.get(socket)
    }

    isSupersededSocket(socket: net.Socket): boolean {
        return this.supersededSockets.has(socket)
    }

    isRetiredLobbySocket(socket: net.Socket): boolean {
        return this.retiredLobbySockets.has(socket)
    }

    isCurrentBattleClient(client: SessionClient): boolean {
        if (this.cidToBattleClient.get(client.connectionId) !== client || client.superseded) return false
        const room = require("../room/manager").getRoom(client.roomNumber)
        return client.roomInstanceId ? !!room && battleConnectionMatches(room, client) : true
    }

    /** Publish all current members, including parent-owned native sockets. */
    private battleRelayMembershipChanged(roomNumber: string): void {
        const room = require("../room/manager").getRoom(roomNumber)
        battleRelayBridge.scheduleMembership(roomNumber, () => {
            const members: RelayMember[] = []
            for (const connectionId of this.battleClients.get(roomNumber) ?? []) {
                const client = this.cidToBattleClient.get(connectionId)
                if (!client || !this.isCurrentBattleClient(client) || client.socket.destroyed || !client.socket.writable) continue
                members.push({
                    sid: isRelayProxySocket(client.socket) ? client.socket.sid : null,
                    cid: connectionId, gen: client.roomGeneration,
                })
            }
            return members
        }, room?.lifecycle ? {
            instanceId: room.lifecycle.instanceId, battleSessionId: room.lifecycle.battleSessionId,
            sceneEpoch: room.lifecycle.sceneEpoch ?? 0,
        } : undefined)
    }

    snapshotBattleRelayRecipients(source: SessionClient, includeSource = false): SessionClient[] {
        if (!this.isCurrentBattleClient(source)) return []
        const set = this.battleClients.get(source.roomNumber)
        if (!set) return []
        const recipients: SessionClient[] = []
        // Snapshot both ids and resolved clients before forwarding. A reconnect
        // during the loop must not replace or remove one receiver halfway through
        // this logical broadcast.
        for (const connectionId of [...set]) {
            if (!includeSource && connectionId === source.connectionId) continue
            const client = this.cidToBattleClient.get(connectionId)
            if (!client
                || !this.isCurrentBattleClient(client)
                || client.roomGeneration !== source.roomGeneration
                || client.socket.destroyed
                || !client.socket.writable) continue
            recipients.push(client)
        }
        return recipients
    }

    markSceneReady(connectionId: string, roomNumber: string): boolean {
        const client = this.cidToBattleClient.get(connectionId)
        if (!client || client.roomNumber !== roomNumber || client.socket.destroyed || !this.isCurrentBattleClient(client)) return false
        const room = require("../room/manager").getRoom(roomNumber)
        if (room && require("../coordinator/room-start-claims").hasRoomStartClaims(room)) return false
        // Legacy arrays have no scene id. TCP order plus each connection's
        // LevelNext fences delayed previous-scene readiness.
        if (room && !battleMemberCanPlay(room, client.viewerId)) return false
        if (room && client.sceneEpoch !== undefined
            && client.sceneEpoch !== (room.lifecycle.sceneEpoch ?? 0)) return false
        const expected = this.battleExpectedCount.get(roomNumber) ?? 0
        if (expected <= 0) {
            if (this.battleSceneStartedRooms.has(roomNumber)) {
                this.recordFiveBossBattleEntry(roomNumber, this.getConnectedBattleClients(roomNumber))
                if (client.fiveBossBattleEntered) {
                    this.clearBattleHeartbeatLease(connectionId)
                }
            }
            return false
        }
        let readySet = this.sceneReadyClients.get(roomNumber)
        if (!readySet) {
            readySet = new Set()
            this.sceneReadyClients.set(roomNumber, readySet)
        }
        readySet.add(connectionId)
        if (room) markBattleMemberPhase(room, client.viewerId, "READY")
        if (client.fiveBossBattleEntered) {
            // During the next-boss barrier, the ready peer may legitimately
            // wait longer than 25 seconds for another peer's loading lease.
            // The slow peer's fixed deadline owns that wait.
            this.clearBattleHeartbeatLease(connectionId)
        } else {
            this.armBattleReadyHeartbeatLease(connectionId)
        }
        const released = this.releaseSceneReadyBarrierIfSatisfied(roomNumber, "scene_ready")
        if (released) this.activateBattleScene(roomNumber)
        return released
    }

    beginBattleLevelNext(connectionId: string, roomNumber: string): void {
        const client = this.cidToBattleClient.get(connectionId)
        if (!client || client.roomNumber !== roomNumber || client.socket.destroyed || !this.isCurrentBattleClient(client)) return
        const room = require("../room/manager").getRoom(roomNumber)
        let levelNextSet = this.battleLevelNextClients.get(roomNumber)
        if (room && !battleMemberCanPlay(room, client.viewerId)) return
        if (!levelNextSet) {
            if (room) beginBattleSceneEpoch(room)
            levelNextSet = new Set()
            this.battleLevelNextClients.set(roomNumber, levelNextSet)

            // CN's dual-boss battles keep the same TCP battle connection.
            // LevelNext starts a new SceneReady barrier for the next boss;
            // reusing the previous ready set would start the next scene before
            // every real player has finished loading it.
            this.sceneReadyClients.set(roomNumber, new Set())
            const connected = this.battleClients.get(roomNumber)?.size ?? 0
            this.battleExpectedCount.set(roomNumber, connected)
            const cycle = this.beginBattleBarrierCycle(roomNumber)
            this.battleSceneStartedRooms.delete(roomNumber)
            this.logBattleBarrierState(roomNumber, "level_next")
            this.armLevelNextDeadline(roomNumber, cycle)
        }
        if (levelNextSet.has(connectionId)) return
        levelNextSet.add(connectionId)
        if (room) {
            client.sceneEpoch = room.lifecycle.sceneEpoch ?? 0
            markBattleMemberPhase(room, client.viewerId, "LOADING")
            this.battleRelayMembershipChanged(roomNumber)
        }
        // A teammate can still be fighting the preceding scene. Only its own
        // LevelNext starts its fixed loading deadline; duplicate packets cannot
        // reset that deadline or demote an already-ready connection.
        this.armBattleLoadingLease(connectionId)
    }

    /**
     * Bound the next-scene barrier for peers that never start it.
     *
     * A peer that sends LevelNext owns a fixed loading lease, and a peer that
     * closes its socket gets the missing-seat grace. A peer that keeps its
     * socket open but sends neither LevelNext nor SceneReady (frozen or
     * backgrounded app, half-open mobile link) had no deadline: an entered
     * five-boss connection has no heartbeat lease, so every teammate waited
     * on the transition screen indefinitely. After the deadline that peer is
     * disconnected; the ordinary close path retires its seat to AI.
     */
    private armLevelNextDeadline(roomNumber: string, cycle: BattleBarrierCycle): void {
        const deadlineMs = this.parsePositiveDuration("BATTLE_LEVEL_NEXT_DEADLINE_MS", 90_000, 10_000)
        const timer = setTimeout(() => {
            // Match the loading lease: let already-arrived LevelNext/SceneReady
            // I/O run before deciding that a peer missed the transition.
            const check = setImmediate(() => {
                void embeddedMultiCoordinator.enqueueRoomCommand(roomNumber, () => {
                    if (cycle.timers.get("level_next_deadline") !== timer) return
                    cycle.timers.delete("level_next_deadline")
                    if (!this.isCurrentBattleBarrier(roomNumber, cycle)) return
                    if ((this.battleExpectedCount.get(roomNumber) ?? 0) <= 0) return
                    const started = this.battleLevelNextClients.get(roomNumber)
                    const ready = this.sceneReadyClients.get(roomNumber)
                    for (const client of this.getConnectedBattleClients(roomNumber)) {
                        if (started?.has(client.connectionId) || ready?.has(client.connectionId)) continue
                        console.warn(`[MULTI] next scene never started: room=${roomNumber}`
                            + ` viewer=${client.viewerId} connection=${client.connectionId} timeoutMs=${deadlineMs}`)
                        fiveBossConnectionDiagnostics.socketEvent(client.socket, "level_next_timeout", String(deadlineMs))
                        markTcpDisconnectReason(client.socket, "level_next_timeout")
                        client.socket.destroy()
                    }
                }).catch(error => console.error(`[MULTI] next scene deadline failed: room=${roomNumber}`, error))
            })
            check.unref()
        }, deadlineMs)
        timer.unref()
        cycle.timers.set("level_next_deadline", timer)
    }

    clearSceneReady(roomNumber: string): void {
        this.clearBattleBarrierCycle(roomNumber)
        this.sceneReadyClients.delete(roomNumber)
        this.battleLevelNextClients.delete(roomNumber)
        this.battleSceneStartedRooms.delete(roomNumber)
        this.pendingBattleLeaves.delete(roomNumber)
        this.battleRelayMembershipChanged(roomNumber)
    }

    setBattleExpectedCount(roomNumber: string, count: number, seats: BattleSeat[] = []): void {
        const room = require("../room/manager").getRoom(roomNumber)
        if (room) ensureBattleSessionContract(room)
        this.retiredBattleSeats.delete(roomNumber)
        const cycle = this.beginBattleBarrierCycle(roomNumber)
        this.sceneReadyClients.set(roomNumber, new Set())
        this.battleLevelNextClients.delete(roomNumber)
        this.battleExpectedCount.set(roomNumber, count)
        this.battleSceneStartedRooms.delete(roomNumber)
        this.pendingBattleLeaves.delete(roomNumber)
        const roster = new Map<string, { viewerId: number; playerId: number | null; roomGeneration: number }>()
        for (const seat of seats) {
            if (!(seat.viewerId > 0) || !seat.connectionId) continue
            const lobbyClient = this.getRoomClientByConnectionId(roomNumber, seat.connectionId)
            if (!lobbyClient || lobbyClient.viewerId !== seat.viewerId) continue
            roster.set(seat.connectionId, {
                viewerId: seat.viewerId,
                playerId: lobbyClient.playerId,
                roomGeneration: lobbyClient.roomGeneration,
            })
        }
        if (roster.size > 0) this.battleRosterSeats.set(roomNumber, roster)
        else this.battleRosterSeats.delete(roomNumber)
        if (count > 0 && seats.length === count && seats.every(seat => seat.viewerId > 0 && seat.connectionId)
            && new Set(seats.map(seat => this.battleSeatKey(seat))).size === count) {
            // A frozen lobby member might never open a battle socket, so it
            // cannot trigger removeClient or a per-connection loading lease.
            const loadingMs = this.parsePositiveDuration("BATTLE_LOADING_LEASE_MS", 60_000, 10_000)
            const timer = setTimeout(() => {
                void embeddedMultiCoordinator.enqueueRoomCommand(roomNumber, () => {
                    if (cycle.timers.get("initial_roster") !== timer) return
                    cycle.timers.delete("initial_roster")
                    for (const seat of seats) {
                        if (!cycle.arrived.has(this.battleSeatKey(seat))
                            && !cycle.arrived.has(`connection:${seat.connectionId}`)) {
                            this.expireMissingBattleSeat(roomNumber, cycle, seat)
                        }
                    }
                }).catch(error => console.error(`[MULTI] initial barrier timeout failed: room=${roomNumber}`, error))
            }, loadingMs)
            timer.unref()
            cycle.timers.set("initial_roster", timer)
        }
        this.logBattleBarrierState(roomNumber, "expected_changed")
        if (this.releaseSceneReadyBarrierIfSatisfied(roomNumber, "expected_recheck")) {
            this.activateBattleScene(roomNumber)
        }
    }

    clearBattleExpectedCount(roomNumber: string): void {
        this.clearBattleBarrierCycle(roomNumber)
        // Settlement may clear transient barriers before the room leaves
        // BATTLE. Keep expired seats fenced until the next round or disband.
        this.sceneReadyClients.delete(roomNumber)
        this.battleLevelNextClients.delete(roomNumber)
        this.battleExpectedCount.delete(roomNumber)
        this.battleRosterSeats.delete(roomNumber)
        this.battleBarrierLogState.delete(roomNumber)
        this.battleSceneStartedRooms.delete(roomNumber)
        this.pendingBattleLeaves.delete(roomNumber)
        this.battleRelayMembershipChanged(roomNumber)
    }

    removeRoomState(roomNumber: string): void {
        for (const client of this.getClientsInRoom(roomNumber)) clearEquipmentBlock(client)
        this.clearBattleBarrierCycle(roomNumber)
        this.retiredBattleSeats.delete(roomNumber)
        this.battleRosterSeats.delete(roomNumber)
        clearChainDiagnosticRoom(roomNumber)
        const abandonedTimer = this.abandonedBattleTimers.get(roomNumber)
        if (abandonedTimer) clearTimeout(abandonedTimer)
        this.abandonedBattleTimers.delete(roomNumber)
        const settlementTimer = this.settlementReturnTimers.get(roomNumber)
        if (settlementTimer) clearTimeout(settlementTimer)
        this.settlementReturnTimers.delete(roomNumber)
        this.cancelHostReconnectGrace(roomNumber)
        this.clearRescueGuestStateForRoom(roomNumber)
        this.clearBattleHeartbeatLeasesForRoom(roomNumber)
        this.battleBarrierLogState.delete(roomNumber)
        this.battleSceneStartedRooms.delete(roomNumber)
        this.pendingBattleLeaves.delete(roomNumber)
        for (const key of this.roomConnectionGenerations.keys()) {
            if (key.endsWith(`@${roomNumber}`)) this.roomConnectionGenerations.delete(key)
        }
        try {
            const lobby = require("../tcp/lobby")
            lobby.clearLobbyRoomState?.(roomNumber)
        } catch (e) {}
    }

    sendJson(
        socket: net.Socket,
        data: any,
        context?: ReliableSendContext,
    ): ReliableSendResult {
        if (data?.[0] === 1 && data?.[1]?.[0] === 1 && Array.isArray(data?.[1]?.[1])
            && require("../../lib/weapon-riven/multi-room").suppressWeaponRivenPreview(this.findClientBySocket(socket))) return "queued"
        return this.sendFrame(socket, JSON.stringify(stripWeaponRivenRoomPreview(data)) + "\0", context)
    }

    sendFrame(
        socket: net.Socket,
        frame: string,
        context?: ReliableSendContext,
    ): ReliableSendResult {
        return sendFrameReliably(socket, frame, context)
    }

    broadcastToRoom(
        roomNumber: string,
        data: any,
        excludeAddr?: string,
        roomGeneration?: number,
    ): void {
        const set = this.roomClients.get(roomNumber)
        if (!set) return
        const broadcastStarted = performance.now()
        let expectedGeneration = roomGeneration
        if (expectedGeneration === undefined) {
            try {
                const { getRoom } = require("../room/manager")
                expectedGeneration = getRoom(roomNumber)?.lobby_generation
            } catch (e) {}
        }
        for (const addr of set) {
            if (excludeAddr !== undefined && addr === excludeAddr) continue
            const c = this.clients.get(addr)
            // A socket is indexed immediately after its handshake, but the
            // client does not have a local "yourself" room object until Enter
            // has been answered with Welcome.  Sending Mates/State/Start during
            // that gap can make the CN client raise C15202 because it cannot
            // find itself in the meeting roster.
            if (c
                && !c.superseded
                && c.enterData !== null
                && (expectedGeneration === undefined || c.roomGeneration === expectedGeneration)) {
                this.sendJson(c.socket, data, {
                    roomNumber,
                    connectionId: c.connectionId,
                    viewerId: c.viewerId,
                    roomGeneration: c.roomGeneration,
                    channel: "lobby",
                })
            }
        }
        recordServerWork("multi.lobby.broadcast", performance.now() - broadcastStarted)
    }

    getRoomClientCount(roomNumber: string, roomGeneration?: number): number {
        if (roomGeneration === undefined) return this.roomClients.get(roomNumber)?.size ?? 0
        return this.getClientsInRoom(roomNumber, roomGeneration).length
    }
}

export const sessionManager = new SessionManager()
registerMemoryCounters("sessions", () => sessionManager.memoryCounters())
