// Multi battle session manager
// Atomic indexing of room clients, battle clients and per-room state machines.
// Protocol arrays follow typepacker useEnumIndex=true format (see sessionServer.ts).

import * as net from "net"
import { Result, ClientState, BattleState } from "../types"
import { RoomStateMachine } from "./RoomStateMachine"
import { ClientStateMachine } from "./ClientStateMachine"

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
    clientState: ClientStateMachine
    battleState: BattleState
}

export class SessionManager {
    private clients = new Map<string, SessionClient>()
    private roomClients = new Map<string, Set<string>>()
    private battleClients = new Map<string, Set<string>>()
    private cidToBattleClient = new Map<string, SessionClient>()
    private sceneReadyClients = new Map<string, Set<string>>()
    private levelNextClients = new Map<string, Set<string>>()
    private battleExpectedCount = new Map<string, number>()
    private battleSceneStarted = new Set<string>()
    private battleStartDeliveredClients = new Map<string, Set<string>>()
    private strictBattleRooms = new Set<string>()
    private roomStates = new Map<string, RoomStateMachine>()

    private addr(viewerId: number, roomNumber: string): string {
        return `${viewerId}@${roomNumber}`
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
            clientState: new ClientStateMachine(ClientState.Connecting),
            battleState: BattleState.Initializing,
        }
    }

    getClient(viewerId: number, roomNumber: string): SessionClient | undefined {
        return this.clients.get(this.addr(viewerId, roomNumber))
    }

    addClientToRoom(client: SessionClient): Result<void> {
        const addr = this.addr(client.viewerId, client.roomNumber)
        this.clients.set(addr, client)
        let set = this.roomClients.get(client.roomNumber)
        if (!set) {
            set = new Set()
            this.roomClients.set(client.roomNumber, set)
        }
        set.add(addr)
        return { ok: true, value: undefined }
    }

    removeClient(client: SessionClient): Result<void> {
        const addr = this.addr(client.viewerId, client.roomNumber)

        if (client.isBattle) {
            this.detachBattleClient(client)
            return { ok: true, value: undefined }
        }

        if (this.clients.get(addr) !== client) return { ok: true, value: undefined }
        this.clients.delete(addr)

        const set = this.roomClients.get(client.roomNumber)
        if (set) {
            set.delete(addr)
            if (set.size === 0) {
                this.roomClients.delete(client.roomNumber)
                // OLD: auto-disband empty non-battle rooms
                // But check if battle clients still exist first
                const bSet = this.battleClients.get(client.roomNumber)
                if (!bSet || bSet.size === 0) {
                    if (!client.isBattle) {
                        const { getRoom, disbandRoom } = require("../room/manager")
                        const room = getRoom(client.roomNumber)
                        if (room && room.raising_state !== 4) {
                            this.broadcastToRoom(client.roomNumber, [1, [6, "multibattle_room_dismissed"]])
                            disbandRoom(client.roomNumber)
                        }
                    }
                }
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
        return { ok: true, value: undefined }
    }

    getClientsInRoom(roomNumber: string): SessionClient[] {
        const set = this.roomClients.get(roomNumber)
        if (!set) return []
        const out: SessionClient[] = []
        for (const addr of set) {
            const c = this.clients.get(addr)
            if (c) out.push(c)
        }
        return out
    }

    getRoomClientByConnectionId(
        roomNumber: string,
        connectionId: string,
    ): SessionClient | undefined {
        return this.getClientsInRoom(roomNumber).find(client => (
            !client.isBattle && client.connectionId === connectionId
        ))
    }

    hasRoomClients(roomNumber: string): boolean {
        const set = this.roomClients.get(roomNumber)
        return !!set && set.size > 0
    }

    isHostOnline(hostViewerId: number, roomNumber: string): boolean {
        const set = this.roomClients.get(roomNumber)
        if (!set) return false
        for (const addr of set) {
            const c = this.clients.get(addr)
            if (c && !c.isBattle && c.viewerId === hostViewerId) return true
        }
        return false
    }

    addBattleClient(connectionId: string, client: SessionClient, strict = false): boolean {
        if (strict) this.strictBattleRooms.add(client.roomNumber)
        const strictRoom = this.strictBattleRooms.has(client.roomNumber)
        const existing = this.cidToBattleClient.get(connectionId)
        if (existing && existing !== client) {
            if (strictRoom && existing.socket.writable && !existing.socket.destroyed) return false
            this.sceneReadyClients.get(client.roomNumber)?.delete(connectionId)
            this.battleStartDeliveredClients.get(client.roomNumber)?.delete(connectionId)
        }
        let set = this.battleClients.get(client.roomNumber)
        if (!set) {
            set = new Set()
            this.battleClients.set(client.roomNumber, set)
        }
        set.add(connectionId)
        this.cidToBattleClient.set(connectionId, client)
        return true
    }

    private detachBattleClient(client: SessionClient): boolean {
        if (this.cidToBattleClient.get(client.connectionId) !== client) return false
        const roomNumber = client.roomNumber
        const bSet = this.battleClients.get(roomNumber)
        if (bSet) {
            for (const cid of bSet) {
                if (cid !== client.connectionId) {
                    const peer = this.cidToBattleClient.get(cid)
                    if (peer) this.sendJson(peer.socket, [1, [0, client.connectionId]])
                }
            }
        }
        bSet?.delete(client.connectionId)
        this.cidToBattleClient.delete(client.connectionId)
        this.sceneReadyClients.get(roomNumber)?.delete(client.connectionId)
        this.levelNextClients.get(roomNumber)?.delete(client.connectionId)
        this.battleStartDeliveredClients.get(roomNumber)?.delete(client.connectionId)
        const expected = this.battleExpectedCount.get(roomNumber)
        if (expected && expected > 1) this.battleExpectedCount.set(roomNumber, expected - 1)
        if (
            this.strictBattleRooms.has(roomNumber)
            && this.openBattleSceneIfReady(roomNumber)
        ) {
            this.broadcastBattleStart(roomNumber)
        }
        return true
    }

    removeBattleClient(connectionId: string, expectedClient?: SessionClient): boolean {
        const client = this.cidToBattleClient.get(connectionId)
        if (!client || (expectedClient && client !== expectedClient)) return false
        return this.detachBattleClient(client)
    }

    getBattleClient(connectionId: string): SessionClient | undefined {
        return this.cidToBattleClient.get(connectionId)
    }

    markSceneReady(connectionId: string, roomNumber: string): boolean {
        if (this.battleSceneStarted.has(roomNumber)) return false
        const expected = this.battleExpectedCount.get(roomNumber) ?? 0
        if (expected <= 0) return false
        let readySet = this.sceneReadyClients.get(roomNumber)
        if (!readySet) {
            readySet = new Set()
            this.sceneReadyClients.set(roomNumber, readySet)
        }
        readySet.add(connectionId)
        return this.openBattleSceneIfReady(roomNumber)
    }

    private openBattleSceneIfReady(roomNumber: string): boolean {
        if (this.battleSceneStarted.has(roomNumber)) return false
        const expected = this.battleExpectedCount.get(roomNumber) ?? 0
        if (expected <= 0) return false
        const readySet = this.sceneReadyClients.get(roomNumber)
        const connected = this.battleClients.get(roomNumber)?.size ?? 0
        if (connected > 0 && readySet && readySet.size >= expected && readySet.size >= connected) {
            this.battleExpectedCount.set(roomNumber, 0)
            this.battleSceneStarted.add(roomNumber)
            this.battleStartDeliveredClients.set(
                roomNumber,
                new Set(this.battleClients.get(roomNumber) ?? []),
            )
            return true
        }
        return false
    }

    private broadcastBattleStart(roomNumber: string): void {
        for (const connectionId of this.battleClients.get(roomNumber) ?? []) {
            const client = this.cidToBattleClient.get(connectionId)
            if (client) this.sendJson(client.socket, [1, [1]])
        }
    }

    claimBattleStartReplay(connectionId: string, roomNumber: string): boolean {
        if (!this.strictBattleRooms.has(roomNumber)) return false
        if (!this.battleSceneStarted.has(roomNumber)) return false
        if (this.cidToBattleClient.get(connectionId)?.roomNumber !== roomNumber) return false
        let delivered = this.battleStartDeliveredClients.get(roomNumber)
        if (!delivered) {
            delivered = new Set()
            this.battleStartDeliveredClients.set(roomNumber, delivered)
        }
        if (delivered.has(connectionId)) return false
        delivered.add(connectionId)
        return true
    }

    clearSceneReady(roomNumber: string): void {
        this.sceneReadyClients.delete(roomNumber)
    }

    beginNextBattleScene(connectionId: string, roomNumber: string): void {
        let transitioned = this.levelNextClients.get(roomNumber)
        if (!transitioned) {
            transitioned = new Set()
            this.levelNextClients.set(roomNumber, transitioned)
            this.sceneReadyClients.set(roomNumber, new Set())
            this.battleSceneStarted.delete(roomNumber)
            this.battleStartDeliveredClients.delete(roomNumber)
            this.battleExpectedCount.set(
                roomNumber,
                this.battleClients.get(roomNumber)?.size ?? 0,
            )
        }
        transitioned.add(connectionId)
    }

    setBattleExpectedCount(roomNumber: string, count: number, strict = false): void {
        if (strict) this.strictBattleRooms.add(roomNumber)
        else this.strictBattleRooms.delete(roomNumber)
        this.sceneReadyClients.delete(roomNumber)
        this.levelNextClients.delete(roomNumber)
        this.battleSceneStarted.delete(roomNumber)
        this.battleStartDeliveredClients.delete(roomNumber)
        this.battleExpectedCount.set(roomNumber, count)
    }

    clearBattleExpectedCount(roomNumber: string): void {
        this.battleExpectedCount.delete(roomNumber)
        this.sceneReadyClients.delete(roomNumber)
        this.levelNextClients.delete(roomNumber)
        this.battleSceneStarted.delete(roomNumber)
        this.battleStartDeliveredClients.delete(roomNumber)
        this.strictBattleRooms.delete(roomNumber)
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
        this.clearBattleExpectedCount(roomNumber)
        this.roomStates.delete(roomNumber)
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
            if (c) this.sendJson(c.socket, data)
        }
    }

    getRoomClientCount(roomNumber: string): number {
        return this.roomClients.get(roomNumber)?.size ?? 0
    }
}

export const sessionManager = new SessionManager()
