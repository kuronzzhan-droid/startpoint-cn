// Multi battle session manager
// Atomic indexing of room clients, battle clients and per-room state machines.
// Protocol arrays follow typepacker useEnumIndex=true format (see sessionServer.ts).

import * as net from "net"
import { Result, ClientState, BattleState } from "../types"
import { RoomStateMachine } from "./RoomStateMachine"
import { ClientStateMachine } from "./ClientStateMachine"
import { gameVerboseLog } from "../../lib/game-logging"

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
    connectedAt: number
    clientState: ClientStateMachine
    battleState: BattleState
}

interface RescueGuestWaitState {
    deadline: number
    ready: boolean
    warningTimer: NodeJS.Timeout
    ejectTimer: NodeJS.Timeout
}

export class SessionManager {
    private clients = new Map<string, SessionClient>()
    private roomClients = new Map<string, Set<string>>()
    private battleClients = new Map<string, Set<string>>()
    private cidToBattleClient = new Map<string, SessionClient>()
    private sceneReadyClients = new Map<string, Set<string>>()
    private battleLevelNextClients = new Map<string, Set<string>>()
    private battleExpectedCount = new Map<string, number>()
    private battleHeartbeatTimers = new Map<string, NodeJS.Timeout>()
    private battleLastActivityAt = new Map<string, number>()
    private battleConnectionPhase = new Map<string, "loading" | "active">()
    private battleBarrierLogState = new Map<string, string>()
    private supersededBattleClients = new WeakSet<SessionClient>()
    private roomStates = new Map<string, RoomStateMachine>()
    private emptyRoomDisbandTimers = new Map<string, NodeJS.Timeout>()
    private rescueGuests = new Map<string, Set<number>>()
    private newbieRescueGuests = new Map<string, Set<number>>()
    private rescueGuestWaits = new Map<string, RescueGuestWaitState>()
    private rescueGuestReconnectTimers = new Map<string, NodeJS.Timeout>()
    private blockedRoomRestores = new Map<string, Set<number>>()
    private hostReconnectTimers = new Map<string, NodeJS.Timeout>()

    private addr(viewerId: number, roomNumber: string): string {
        return `${viewerId}@${roomNumber}`
    }

    private parsePositiveDuration(name: string, fallback: number, minimum = 1_000): number {
        const parsed = parseInt(process.env[name] || "", 10)
        return Number.isFinite(parsed) ? Math.max(minimum, parsed) : fallback
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
        this.battleLastActivityAt.set(connectionId, Date.now())
        const timer = setTimeout(() => {
            this.battleHeartbeatTimers.delete(connectionId)
            const current = this.cidToBattleClient.get(connectionId)
            if (!current || current.socket.destroyed
                || this.battleConnectionPhase.get(connectionId) !== "loading") return
            console.warn(`[MULTI] battle loading timed out: room=${current.roomNumber}`
                + ` viewer=${current.viewerId} connection=${connectionId} timeoutMs=${leaseMs}`)
            current.socket.destroy()
        }, leaseMs)
        timer.unref()
        this.battleHeartbeatTimers.set(connectionId, timer)
    }

    private armActiveBattleHeartbeatLease(connectionId: string): void {
        const client = this.cidToBattleClient.get(connectionId)
        if (!client || client.socket.destroyed) return
        const leaseMs = this.parsePositiveDuration("BATTLE_HEARTBEAT_LEASE_MS", 25_000, 5_000)
        const previous = this.battleHeartbeatTimers.get(connectionId)
        if (previous) clearTimeout(previous)
        this.battleConnectionPhase.set(connectionId, "active")
        this.battleLastActivityAt.set(connectionId, Date.now())
        const timer = setTimeout(() => {
            this.battleHeartbeatTimers.delete(connectionId)
            const current = this.cidToBattleClient.get(connectionId)
            if (!current || current.socket.destroyed) {
                this.battleLastActivityAt.delete(connectionId)
                return
            }
            const inactiveMs = Date.now() - (this.battleLastActivityAt.get(connectionId) ?? 0)
            if (inactiveMs < leaseMs) {
                this.armActiveBattleHeartbeatLease(connectionId)
                return
            }
            console.warn(`[MULTI] real battle connection heartbeat expired: room=${current.roomNumber}`
                + ` viewer=${current.viewerId} connection=${connectionId} inactiveMs=${inactiveMs}`)
            // Destroy only a battle socket that completed the real handshake.
            // Its normal close handler performs the native Leave path using the
            // connection id already known by every remaining client.
            current.socket.destroy()
        }, leaseMs)
        timer.unref()
        this.battleHeartbeatTimers.set(connectionId, timer)
    }

    noteBattleActivity(connectionId: string): void {
        if (!this.cidToBattleClient.has(connectionId)) return
        // Loading has a fixed upper bound and is deliberately not governed by
        // the active-battle heartbeat.  SceneReady switches the connection to
        // the renewable 25-second activity lease.
        if (this.battleConnectionPhase.get(connectionId) === "active") {
            this.armActiveBattleHeartbeatLease(connectionId)
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
        console.log(`[MULTI-BARRIER] room=${roomNumber} generation=${generation}`
            + ` expected=${expected} connected=${connected} ready=${ready} reason=${reason}`)
    }

    private releaseSceneReadyBarrierIfSatisfied(roomNumber: string, reason: string): boolean {
        const expected = this.battleExpectedCount.get(roomNumber) ?? 0
        if (expected <= 0) return false
        const connected = this.battleClients.get(roomNumber)?.size ?? 0
        const ready = this.sceneReadyClients.get(roomNumber)?.size ?? 0
        this.logBattleBarrierState(roomNumber, reason)
        if (connected <= 0 || ready < expected || ready < connected) return false
        this.battleExpectedCount.set(roomNumber, 0)
        this.battleLevelNextClients.delete(roomNumber)
        this.logBattleBarrierState(roomNumber, `${reason}:released`)
        return true
    }

    private broadcastBattleSceneStart(roomNumber: string): void {
        for (const connectionId of this.battleClients.get(roomNumber) ?? []) {
            const client = this.cidToBattleClient.get(connectionId)
            if (client && !client.socket.destroyed) this.sendJson(client.socket, [1, [1]])
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

    markRescueGuest(roomNumber: string, viewerId: number, isNewbieRescue = false): void {
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
        this.blockedRoomRestores.get(roomNumber)?.delete(viewerId)
        this.clearRescueGuestReconnect(roomNumber, viewerId)
    }

    isRescueGuest(roomNumber: string, viewerId: number): boolean {
        return this.rescueGuests.get(roomNumber)?.has(viewerId) ?? false
    }

    isNewbieRescueGuest(roomNumber: string, viewerId: number): boolean {
        return this.newbieRescueGuests.get(roomNumber)?.has(viewerId) ?? false
    }

    isRoomRestoreBlocked(roomNumber: string, viewerId: number): boolean {
        return this.blockedRoomRestores.get(roomNumber)?.has(viewerId) ?? false
    }

    beginRescueGuestWait(client: SessionClient): void {
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
            const current = this.getClient(client.viewerId, client.roomNumber)
            if (current && !current.isBattle && current.isReady !== ready) {
                this.clearRescueGuestWait(client.roomNumber, client.viewerId)
                this.beginRescueGuestWait(current)
                return
            }
            this.ejectRescueGuest(client.roomNumber, client.viewerId, "rescue_wait_timeout")
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
            this.rescueGuestReconnectTimers.delete(key)
            const current = this.getClient(client.viewerId, client.roomNumber)
            if (current && !current.isBattle) return
            this.ejectRescueGuest(client.roomNumber, client.viewerId, "rescue_reconnect_timeout")
        }, reconnectMs)
        timer.unref()
        this.rescueGuestReconnectTimers.set(key, timer)
        gameVerboseLog(() => `[MULTI] rescue guest reconnect grace started: viewer=${client.viewerId} room=${client.roomNumber} graceMs=${reconnectMs}`)
    }

    ejectRescueGuest(roomNumber: string, viewerId: number, reason: string): void {
        this.clearRescueGuestWait(roomNumber, viewerId)
        this.clearRescueGuestReconnect(roomNumber, viewerId)
        this.rescueGuests.get(roomNumber)?.delete(viewerId)
        this.newbieRescueGuests.get(roomNumber)?.delete(viewerId)

        let blocked = this.blockedRoomRestores.get(roomNumber)
        if (!blocked) {
            blocked = new Set()
            this.blockedRoomRestores.set(roomNumber, blocked)
        }
        blocked.add(viewerId)
        try {
            const { suppressRandomRecruitmentForViewer } = require("../recruitment")
            suppressRandomRecruitmentForViewer(roomNumber, viewerId)
        } catch (e) {}

        const current = this.getClient(viewerId, roomNumber)
        if (current && !current.isBattle) {
            this.sendJson(current.socket, [1, [6, "multibattle_room_dismissed"]])
            this.removeClient(current)
            try { current.socket.end() } catch (e) {}
            setTimeout(() => {
                try { current.socket.destroy() } catch (e) {}
            }, 250).unref()
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
        const reconnectMs = this.parsePositiveDuration("MULTI_HOST_RECONNECT_GRACE_MS", 25_000)
        const timer = setTimeout(() => {
            this.hostReconnectTimers.delete(roomNumber)
            try {
                const { getRoom } = require("../room/manager")
                const room = getRoom(roomNumber)
                if (!room || room.raising_state === 4) return
                if (this.isHostOnline(room.host_viewer_id, roomNumber, room.lobby_generation)) return
                this.dismissAndDisbandRoom(roomNumber, "host_reconnect_timeout")
            } catch (e) {}
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
        this.blockedRoomRestores.delete(roomNumber)
    }

    private dismissAndDisbandRoom(roomNumber: string, reason: string): void {
        const waitingClients = this.getClientsInRoom(roomNumber)
        const battleClients = this.getConnectedBattleClients(roomNumber)
        const allClients = [...new Set([...waitingClients, ...battleClients])]
        this.clearBattleHeartbeatLeasesForRoom(roomNumber)
        for (const client of allClients) {
            this.sendJson(client.socket, [1, [6, "multibattle_room_dismissed"]])
        }
        try {
            const { disbandRoom } = require("../room/manager")
            disbandRoom(roomNumber)
        } catch (e) {
            this.removeRoomState(roomNumber)
        }
        for (const client of allClients) {
            const addr = this.addr(client.viewerId, roomNumber)
            if (this.clients.get(addr) === client) this.clients.delete(addr)
            if (client.isBattle) this.cidToBattleClient.delete(client.connectionId)
            try { client.socket.end() } catch (e) {}
            setTimeout(() => {
                try { client.socket.destroy() } catch (e) {}
            }, 250).unref()
        }
        this.roomClients.delete(roomNumber)
        this.battleClients.delete(roomNumber)
        this.sceneReadyClients.delete(roomNumber)
        this.battleLevelNextClients.delete(roomNumber)
        this.battleExpectedCount.delete(roomNumber)
        gameVerboseLog(() => `[MULTI] room disbanded: room=${roomNumber} reason=${reason}`)
    }

    private disbandRoomIfNoRealConnections(roomNumber: string, battleRoomTimeoutExpired = false): void {
        const lobbyConnectionCount = this.roomClients.get(roomNumber)?.size ?? 0
        const battleConnectionCount = this.battleClients.get(roomNumber)?.size ?? 0
        if (lobbyConnectionCount > 0 || battleConnectionCount > 0) return
        if (this.hostReconnectTimers.has(roomNumber)) return

        try {
            const { getRoom, disbandRoom } = require("../room/manager")
            const room = getRoom(roomNumber)
            if (!room) return

            // The CN client closes the battle TCP socket as soon as the battle
            // scene has been initialized. The actual fight can then continue
            // client-side for minutes, so the 25-second reconnect grace must not
            // start here or the room can disappear before /finish is sent.
            // Keep only a long abandoned-battle watchdog for clients that never
            // send either /finish or /abort.
            if (room.raising_state === 4 && !battleRoomTimeoutExpired) {
                if (!this.emptyRoomDisbandTimers.has(roomNumber)) {
                    const battleRoomTimeoutMs = parseInt(process.env.BATTLE_ROOM_TIMEOUT_MS || "900000")
                    const timer = setTimeout(() => {
                        this.emptyRoomDisbandTimers.delete(roomNumber)
                        this.disbandRoomIfNoRealConnections(roomNumber, true)
                    }, battleRoomTimeoutMs)
                    timer.unref()
                    this.emptyRoomDisbandTimers.set(roomNumber, timer)
                    gameVerboseLog(() => `[MULTI] waiting for battle finish: room=${roomNumber} timeoutMs=${battleRoomTimeoutMs}`)
                }
                return
            }

            // Successful settlement has its own timer, deliberately separate
            // from REMATCH_RECONNECT_GRACE_MS. The latter starts only after the
            // return lobby exists and is used to wait for missing real players.
            if (room.settlement_return_pending) return

            const pendingTimer = this.emptyRoomDisbandTimers.get(roomNumber)
            if (pendingTimer) clearTimeout(pendingTimer)
            this.emptyRoomDisbandTimers.delete(roomNumber)
            this.roomClients.delete(roomNumber)
            this.battleClients.delete(roomNumber)
            this.sceneReadyClients.delete(roomNumber)
            this.battleLevelNextClients.delete(roomNumber)
            this.battleExpectedCount.delete(roomNumber)
            try {
                const { stopRandomRecruitment } = require("../recruitment")
                stopRandomRecruitment(roomNumber)
            } catch (e) {}
            disbandRoom(roomNumber)
            gameVerboseLog(() => `[MULTI] room disbanded: all real connections closed room=${roomNumber}`)
        } catch (e) {}
    }

    beginSettlementReturnGrace(roomNumber: string): void {
        const existingTimer = this.emptyRoomDisbandTimers.get(roomNumber)
        if (existingTimer) clearTimeout(existingTimer)
        this.emptyRoomDisbandTimers.delete(roomNumber)

        const settlementReturnGraceMs = parseInt(process.env.SETTLEMENT_RETURN_GRACE_MS || "60000")
        const timer = setTimeout(() => {
            this.emptyRoomDisbandTimers.delete(roomNumber)
            try {
                const { getRoom, disbandRoom } = require("../room/manager")
                const room = getRoom(roomNumber)
                if (!room || !room.settlement_return_pending) return

                // Only the host completing the lobby Enter flow counts as a
                // successful room return. Guests may wait during the grace
                // period, but they must not keep a hostless room alive.
                room.settlement_return_pending = false
                const waitingClients = this.getClientsInRoom(roomNumber)
                for (const client of waitingClients) {
                    this.sendJson(client.socket, [1, [6, "multibattle_room_dismissed"]])
                }
                disbandRoom(roomNumber)
                this.roomClients.delete(roomNumber)
                this.battleClients.delete(roomNumber)
                this.sceneReadyClients.delete(roomNumber)
                this.battleLevelNextClients.delete(roomNumber)
                this.battleExpectedCount.delete(roomNumber)
                for (const client of waitingClients) {
                    this.clients.delete(this.addr(client.viewerId, roomNumber))
                    try { client.socket.end() } catch (e) {}
                }
                console.warn(`[MULTI] room disbanded: host did not return after settlement room=${roomNumber}`)
            } catch (e) {}
        }, settlementReturnGraceMs)
        timer.unref()
        this.emptyRoomDisbandTimers.set(roomNumber, timer)
        gameVerboseLog(() => `[MULTI] waiting for settlement lobby return: room=${roomNumber} graceMs=${settlementReturnGraceMs}`)
    }

    completeSettlementReturn(roomNumber: string): void {
        const pendingTimer = this.emptyRoomDisbandTimers.get(roomNumber)
        if (pendingTimer) clearTimeout(pendingTimer)
        this.emptyRoomDisbandTimers.delete(roomNumber)
        try {
            const { getRoom } = require("../room/manager")
            const room = getRoom(roomNumber)
            if (room) room.settlement_return_pending = false
        } catch (e) {}
        try {
            // Keep room lifetime and settlement eligibility independent.  A
            // successful host return advances retained finish snapshots to
            // LOBBY, but they remain replayable for their short TTL.
            const { transitionRoomSettlementSnapshots } = require("../settlement-snapshot")
            transitionRoomSettlementSnapshots(roomNumber, "LOBBY")
        } catch (e) {}
        gameVerboseLog(() => `[MULTI] settlement host returned: room=${roomNumber}`)
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
            connectedAt: Date.now(),
            clientState: new ClientStateMachine(ClientState.Connecting),
            battleState: BattleState.Initializing,
        }
    }

    getClient(viewerId: number, roomNumber: string): SessionClient | undefined {
        return this.clients.get(this.addr(viewerId, roomNumber))
    }

    getRoomClientByConnectionId(roomNumber: string, connectionId: string): SessionClient | undefined {
        for (const client of this.getClientsInRoom(roomNumber)) {
            if (!client.isBattle && client.connectionId === connectionId) return client
        }
        return undefined
    }

    addClientToRoom(client: SessionClient): Result<void> {
        const addr = this.addr(client.viewerId, client.roomNumber)
        let settlementReturnPending = false
        try {
            const { getRoom } = require("../room/manager")
            settlementReturnPending = !!getRoom(client.roomNumber)?.settlement_return_pending
        } catch (e) {}
        // During settlement, a guest connection must not cancel the host's
        // return deadline. The timer is cleared only after the host completes
        // the lobby Enter flow.
        if (!settlementReturnPending) {
            const pendingTimer = this.emptyRoomDisbandTimers.get(client.roomNumber)
            if (pendingTimer) clearTimeout(pendingTimer)
            this.emptyRoomDisbandTimers.delete(client.roomNumber)
        }
        const previous = this.clients.get(addr)
        this.clients.set(addr, client)
        if (previous && previous !== client && previous.socket !== client.socket) {
            gameVerboseLog(() => `[MULTI] replacing stale room connection: viewer=${client.viewerId} room=${client.roomNumber}`)
            try { previous.socket.destroy() } catch (e) {}
        }
        let set = this.roomClients.get(client.roomNumber)
        if (!set) {
            set = new Set()
            this.roomClients.set(client.roomNumber, set)
        }
        set.add(addr)
        try {
            const { getRoom } = require("../room/manager")
            const room = getRoom(client.roomNumber)
            if (room?.host_viewer_id === client.viewerId) this.cancelHostReconnectGrace(client.roomNumber)
        } catch (e) {}
        if (this.isRescueGuest(client.roomNumber, client.viewerId)) {
            this.clearRescueGuestReconnect(client.roomNumber, client.viewerId)
        }
        return { ok: true, value: undefined }
    }

    removeClient(client: SessionClient): Result<void> {
        const addr = this.addr(client.viewerId, client.roomNumber)
        const isCurrentConnection = this.clients.get(addr) === client
        if (isCurrentConnection) this.clients.delete(addr)

        if (client.isBattle) {
            const superseded = this.supersededBattleClients.delete(client)
            const isCurrentBattleConnection = this.cidToBattleClient.get(client.connectionId) === client
            const phase = isCurrentBattleConnection
                ? this.battleConnectionPhase.get(client.connectionId)
                : undefined
            if (isCurrentBattleConnection) this.clearBattleHeartbeatLease(client.connectionId)
            const bSet = this.battleClients.get(client.roomNumber)
            // Scene loading sockets can be replaced or reconnect briefly.  A
            // Leave packet at this point makes the remaining client discard a
            // real teammate and start a different local scene.  Only publish a
            // departure after the battle scene is already active.
            if (bSet && !superseded && phase === "active") {
                for (const cid of bSet) {
                    if (cid !== client.connectionId) {
                        const c = this.cidToBattleClient.get(cid)
                        if (c) this.sendJson(c.socket, [1, [0, client.connectionId]]) // BattleServerMessage.Leave(connectionId)
                    }
                }
            }
            if (isCurrentBattleConnection) {
                this.battleClients.get(client.roomNumber)?.delete(client.connectionId)
                if (this.battleClients.get(client.roomNumber)?.size === 0) {
                    this.battleClients.delete(client.roomNumber)
                }
                this.cidToBattleClient.delete(client.connectionId)
                this.sceneReadyClients.get(client.roomNumber)?.delete(client.connectionId)
                this.battleLevelNextClients.get(client.roomNumber)?.delete(client.connectionId)
            }
            const exp = this.battleExpectedCount.get(client.roomNumber)
            // A three-person loading barrier may safely fall back to the two
            // clients that actually reached the scene.  Never turn a two-real-
            // player battle into two independent one-player battles.
            if (!superseded && exp && exp > 2) this.battleExpectedCount.set(client.roomNumber, exp - 1)
            if (!superseded && this.releaseSceneReadyBarrierIfSatisfied(client.roomNumber, "disconnect")) {
                this.broadcastBattleSceneStart(client.roomNumber)
            }
        }

        const set = this.roomClients.get(client.roomNumber)
        if (set && isCurrentConnection) {
            set.delete(addr)
            if (!client.isBattle) {
                try {
                    const { getRoom } = require("../room/manager")
                    const room = getRoom(client.roomNumber)
                    if (room && room.raising_state !== 4 && client.roomGeneration === room.lobby_generation) {
                        const remaining = this.getClientsInRoom(client.roomNumber, room.lobby_generation)
                        for (const other of remaining) {
                            other.mates = other.mates.filter(mate => mate.viewerId !== client.viewerId)
                        }
                        const host = remaining.find(other => other.viewerId === room.host_viewer_id)
                        room.mates = (host?.mates ?? remaining.map(other => other.yourself).filter(Boolean))
                            .map((mate: any) => ({ viewer_id: mate.viewerId ?? null, com_id: mate.comId ?? 0 }))
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
                if (room && room.raising_state !== 4) {
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
                && c.viewerId === hostViewerId
                && (roomGeneration === undefined || c.roomGeneration === roomGeneration)) return true
        }
        return false
    }

    addBattleClient(connectionId: string, client: SessionClient): void {
        const pendingTimer = this.emptyRoomDisbandTimers.get(client.roomNumber)
        if (pendingTimer) clearTimeout(pendingTimer)
        this.emptyRoomDisbandTimers.delete(client.roomNumber)
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
            if (!existing.socket.destroyed) existing.socket.destroy()
            this.logBattleBarrierState(client.roomNumber, "connection_replaced")
        }
        set.add(connectionId)
        this.cidToBattleClient.set(connectionId, client)
        this.armBattleLoadingLease(connectionId)
        this.logBattleBarrierState(client.roomNumber, "connected")
    }

    removeBattleClient(connectionId: string): void {
        this.clearBattleHeartbeatLease(connectionId)
        const client = this.cidToBattleClient.get(connectionId)
        if (client) {
            this.battleClients.get(client.roomNumber)?.delete(connectionId)
            this.sceneReadyClients.get(client.roomNumber)?.delete(connectionId)
            this.battleLevelNextClients.get(client.roomNumber)?.delete(connectionId)
        }
        this.cidToBattleClient.delete(connectionId)
        if (client && this.releaseSceneReadyBarrierIfSatisfied(client.roomNumber, "removed")) {
            this.broadcastBattleSceneStart(client.roomNumber)
        }
    }

    getBattleClient(connectionId: string): SessionClient | undefined {
        return this.cidToBattleClient.get(connectionId)
    }

    markSceneReady(connectionId: string, roomNumber: string): boolean {
        const expected = this.battleExpectedCount.get(roomNumber) ?? 0
        if (expected <= 0) return false
        let readySet = this.sceneReadyClients.get(roomNumber)
        if (!readySet) {
            readySet = new Set()
            this.sceneReadyClients.set(roomNumber, readySet)
        }
        readySet.add(connectionId)
        this.armActiveBattleHeartbeatLease(connectionId)
        return this.releaseSceneReadyBarrierIfSatisfied(roomNumber, "scene_ready")
    }

    beginBattleLevelNext(connectionId: string, roomNumber: string): void {
        let levelNextSet = this.battleLevelNextClients.get(roomNumber)
        if (!levelNextSet) {
            levelNextSet = new Set()
            this.battleLevelNextClients.set(roomNumber, levelNextSet)

            // CN's dual-boss battles keep the same TCP battle connection.
            // LevelNext starts a new SceneReady barrier for the next boss;
            // reusing the previous ready set would start the next scene before
            // every real player has finished loading it.
            this.sceneReadyClients.set(roomNumber, new Set())
            const connected = this.battleClients.get(roomNumber)?.size ?? 0
            this.battleExpectedCount.set(roomNumber, connected)
            for (const battleConnectionId of this.battleClients.get(roomNumber) ?? []) {
                this.armBattleLoadingLease(battleConnectionId)
            }
            this.logBattleBarrierState(roomNumber, "level_next")
        }
        levelNextSet.add(connectionId)
    }

    clearSceneReady(roomNumber: string): void {
        this.sceneReadyClients.delete(roomNumber)
        this.battleLevelNextClients.delete(roomNumber)
    }

    setBattleExpectedCount(roomNumber: string, count: number): void {
        this.sceneReadyClients.set(roomNumber, new Set())
        this.battleLevelNextClients.delete(roomNumber)
        this.battleExpectedCount.set(roomNumber, count)
        this.logBattleBarrierState(roomNumber, "expected_changed")
        if (this.releaseSceneReadyBarrierIfSatisfied(roomNumber, "expected_recheck")) {
            this.broadcastBattleSceneStart(roomNumber)
        }
    }

    clearBattleExpectedCount(roomNumber: string): void {
        this.sceneReadyClients.delete(roomNumber)
        this.battleLevelNextClients.delete(roomNumber)
        this.battleExpectedCount.delete(roomNumber)
        this.battleBarrierLogState.delete(roomNumber)
    }

    getRoomState(roomNumber: string): RoomStateMachine {
        let sm = this.roomStates.get(roomNumber)
        if (!sm) {
            sm = new RoomStateMachine()
            this.roomStates.set(roomNumber, sm)
        }
        return sm
    }

    removeRoomState(roomNumber: string): void {
        this.roomStates.delete(roomNumber)
        const emptyTimer = this.emptyRoomDisbandTimers.get(roomNumber)
        if (emptyTimer) clearTimeout(emptyTimer)
        this.emptyRoomDisbandTimers.delete(roomNumber)
        this.cancelHostReconnectGrace(roomNumber)
        this.clearRescueGuestStateForRoom(roomNumber)
        this.clearBattleHeartbeatLeasesForRoom(roomNumber)
        this.battleBarrierLogState.delete(roomNumber)
    }

    sendJson(socket: net.Socket, data: any): void {
        if (!socket.writable) return
        socket.write(JSON.stringify(data) + "\0")
    }

    broadcastToRoom(roomNumber: string, data: any, excludeAddr?: string): void {
        const set = this.roomClients.get(roomNumber)
        if (!set) return
        for (const addr of set) {
            if (excludeAddr !== undefined && addr === excludeAddr) continue
            const c = this.clients.get(addr)
            // A socket is indexed immediately after its handshake, but the
            // client does not have a local "yourself" room object until Enter
            // has been answered with Welcome.  Sending Mates/State/Start during
            // that gap can make the CN client raise C15202 because it cannot
            // find itself in the meeting roster.
            if (c && c.enterData !== null) this.sendJson(c.socket, data)
        }
    }

    getRoomClientCount(roomNumber: string, roomGeneration?: number): number {
        if (roomGeneration === undefined) return this.roomClients.get(roomNumber)?.size ?? 0
        return this.getClientsInRoom(roomNumber, roomGeneration).length
    }
}

export const sessionManager = new SessionManager()
