import * as net from "net"
import { sessionManager, SessionClient } from "../state/SessionManager"
import { getRoom, updateRoomState } from "../room/manager"
import { NpcMateProvider } from "../npc/controller"
import { buildRealParty } from "./handshake"
import { PartyCategory } from "../../data/types"
import { getPlayerPartyGroupListSync } from "../../data/domains/party"
import {
    buildHostCloneMates,
    countHostCloneMates,
    isHostCloneAiMate,
    serializeHostCloneRoomMates,
    type HostCloneLobbyMate,
    type HostCloneSnapshot,
    type HostCloneTimer,
} from "../npc/host-clone"
import {
    applyAutoplayModeChange,
    canStartFiveBossLobbyRun,
    FiveBossLobbyFillCoordinator,
    freezeFiveBossLobbyRuntime,
    isFiveBossLobbyRoom,
    mergeFiveBossRealMate,
    refreshFiveBossHostClones,
} from "../five-boss/lobby-runtime"

const NPC_JOIN_DELAY_MS = parseInt(process.env.NPC_JOIN_DELAY_MS || "2000")
const NPC_READY_DELAY_MS = parseInt(process.env.NPC_READY_DELAY_MS || "500")
const fiveBossFillCoordinator = new FiveBossLobbyFillCoordinator()
const lobbyTimer: HostCloneTimer = {
    setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
    clearTimeout: handle => clearTimeout(handle as NodeJS.Timeout),
}

function findClientBySocket(socket: net.Socket): SessionClient | undefined {
    const clientsMap = (sessionManager as any).clients as Map<string, SessionClient> | undefined
    if (!clientsMap) return undefined
    for (const client of clientsMap.values()) {
        if (client.socket === socket) return client
    }
    return undefined
}

function findHostClient(roomNumber: string): SessionClient | undefined {
    const room = getRoom(roomNumber)
    if (!room) return undefined
    const clientsMap = (sessionManager as any).clients as Map<string, SessionClient> | undefined
    if (!clientsMap) return undefined
    for (const client of clientsMap.values()) {
        if (client.viewerId === room.host_viewer_id && client.roomNumber === roomNumber && !client.isBattle) {
            return client
        }
    }
    return undefined
}

function countRealPlayers(mates: any[]): number {
    return countHostCloneMates(mates as HostCloneLobbyMate[]).humans
}

function syncRoomMates(room: NonNullable<ReturnType<typeof getRoom>>, mates: readonly HostCloneLobbyMate[]): void {
    room.mates = serializeHostCloneRoomMates(mates)
}

function getFiveBossSnapshot(roomNumber: string): HostCloneSnapshot | null {
    const room = getRoom(roomNumber)
    if (!room || !isFiveBossLobbyRoom(room)) return null
    const hostClient = findHostClient(roomNumber)
    if (!hostClient?.yourself) return null

    const hostMate = hostClient.yourself as HostCloneLobbyMate
    const mates = hostClient.mates.some(mate => mate.viewerId === hostMate.viewerId)
        ? hostClient.mates.map(mate => mate.viewerId === hostMate.viewerId ? hostMate : mate)
        : [hostMate, ...hostClient.mates]
    return { hostMate, mates }
}

function syncFiveBossRoster(roomNumber: string, mates: readonly HostCloneLobbyMate[]): void {
    const room = getRoom(roomNumber)
    if (!room || !isFiveBossLobbyRoom(room)) return
    const roster = [...mates]
    const counts = countHostCloneMates(roster)
    room.is_npc_mode = counts.ai > 0
    room.npc_count = counts.ai
    syncRoomMates(room, roster)
    for (const memberClient of sessionManager.getClientsInRoom(roomNumber)) {
        if (!memberClient.isBattle) memberClient.mates = [...roster]
    }
}

function installFiveBossClones(roomNumber: string, clones: HostCloneLobbyMate[]): void {
    const snapshot = getFiveBossSnapshot(roomNumber)
    if (!snapshot) return
    for (const clone of clones) clone.state = [1]
    const roster = [...snapshot.mates, ...clones]
    syncFiveBossRoster(roomNumber, roster)
    sessionManager.broadcastToRoom(roomNumber, [1, [1, roster]])
    for (const clone of clones) {
        sessionManager.broadcastToRoom(roomNumber, [1, [2, clone.connectionId, [1]]])
    }
    checkHostAutoReady(roomNumber)
}

function scheduleFiveBossFill(roomNumber: string): void {
    const room = getRoom(roomNumber)
    if (!room) return
    fiveBossFillCoordinator.schedule({
        room,
        getSnapshot: () => getFiveBossSnapshot(roomNumber),
        onFill: clones => installFiveBossClones(roomNumber, clones),
        timer: lobbyTimer,
    })
}

function fillFiveBossImmediately(roomNumber: string): boolean {
    const room = getRoom(roomNumber)
    if (!room) return false
    return fiveBossFillCoordinator.fillImmediately({
        room,
        getSnapshot: () => getFiveBossSnapshot(roomNumber),
        onFill: clones => installFiveBossClones(roomNumber, clones),
    })
}

export function cancelFiveBossLobbyFill(roomNumber: string): void {
    fiveBossFillCoordinator.cancel(roomNumber)
}

export function checkHostAutoReady(roomNumber: string): void {
    const room = getRoom(roomNumber)
    if (!room) return
    const hostClient = findHostClient(roomNumber)
    if (!hostClient) return
    const hostMate = hostClient.mates.find(m => m.viewerId === hostClient.viewerId)
    if (!hostMate) return

    const nonHostReady = hostClient.mates.every(m =>
        m.viewerId === hostClient.viewerId || m.state?.[0] === 1
    )
    if (nonHostReady && hostClient.mates.length > 1) {
        if (hostMate.state?.[0] !== 1) {
            hostMate.state = [1]
            sessionManager.broadcastToRoom(roomNumber, [1, [2, hostMate.connectionId, [1]]])
            console.log(`[LOBBY] host auto-ready: room=${roomNumber}`)
        }
    } else {
        if (hostMate.state?.[0] === 1) {
            hostMate.state = [0]
            sessionManager.broadcastToRoom(roomNumber, [1, [2, hostMate.connectionId, [0]]])
            console.log(`[LOBBY] host auto-ready cancelled: room=${roomNumber}`)
        }
    }
    checkAllReadyAndStart(roomNumber)
}

const autoStartingRooms = new Set<string>()

function checkAllReadyAndStart(roomNumber: string): void {
    if (autoStartingRooms.has(roomNumber)) return
    const hostClient = findHostClient(roomNumber)
    if (!hostClient) return
    const room = getRoom(roomNumber)
    if (!room) return

    // Guard: wait for all expected real players to return on rematch
    if (room.npc_count > 0) {
        const realPlayers = countRealPlayers(hostClient.mates)
        const expectedReal = 3 - room.npc_count
        if (realPlayers < expectedReal) return
    }
    if (hostClient.mates.length < 3) return

    const allReady = hostClient.mates.every(m => m.state?.[0] === 1)
    if (!allReady) return

    autoStartingRooms.add(roomNumber)
    console.log(`[LOBBY] all ready — StartRemainingTime float: room=${roomNumber}`)
    sessionManager.broadcastToRoom(roomNumber, [1, [10, 2]])
}

export function notifyRoomDisbanded(roomNumber: string): void {
    cancelFiveBossLobbyFill(roomNumber)
    sessionManager.broadcastToRoom(roomNumber, [1, [6, "multibattle_room_dismissed"]])
}

async function handleEnterComs(client: SessionClient, coms: { name: string }[]): Promise<void> {
    const room = getRoom(client.roomNumber)
    if (!room) return
    if (isFiveBossLobbyRoom(room)) {
        if (client.viewerId !== room.host_viewer_id) return
        fillFiveBossImmediately(client.roomNumber)
        return
    }
    room.is_npc_mode = true

    const hostMate = client.yourself ?? client.mates[0]
    if (!hostMate) return

    // Merge all connected (but not yet entered) real players into client.mates
    const connectedClients = sessionManager.getClientsInRoom(client.roomNumber)
    for (const c of connectedClients) {
        if (c.yourself && !client.mates.find(m => m.viewerId === c.viewerId)) {
            client.mates.push(c.yourself)
        }
    }

    const realMates = client.mates.filter(m => !isHostCloneAiMate(m))

    // Determine NPC count: first recruit → calculate and store; rematch → restore fixed count
    let needNPCs: number
    if (room.npc_count <= 0) {
        needNPCs = 3 - realMates.length
        room.npc_count = needNPCs  // persist for rematch
    } else {
        needNPCs = room.npc_count
    }
    if (needNPCs <= 0) {
        console.log(`[LOBBY] EnterComs: room full (${realMates.length} players), skip NPCs`)
        return
    }

    const npcProvider = new NpcMateProvider()
    const recruitResult = await npcProvider.onRecruit(client.roomNumber, String(room?.host_viewer_id ?? 0))

    // Fetch NPC party data from player's DB (uses real equipment/character IDs)
    const npcParties: any[] = []
    if (client.playerId) {
        try {
            for (const category of [PartyCategory.NORMAL, PartyCategory.EVENT]) {
                const groups = getPlayerPartyGroupListSync(client.playerId, category)
                for (const g of Object.values(groups)) {
                    for (const party of Object.values(g.list)) {
                        if (party.name && party.name.includes("NPC")) {
                            npcParties.push(buildRealParty(client.playerId, party))
                        }
                    }
                }
            }
        } catch (e) { }
    }

    const npcMates: any[] = []
    for (let i = 0; i < needNPCs; i++) {
        const recruited = recruitResult.recruitedMates[i] ?? null
        const comId = recruited?.com_id ?? (i + 1)
        const viewerId = recruited?.viewer_id ?? (900000000 + i + 1)
        const party = npcParties[i] ?? npcParties[0] ?? hostMate.party

        npcMates.push({
            viewerId: viewerId,
            comId: comId,
            name: coms[i]?.name ?? `NPC${comId}`,
            rank: hostMate.rank,
            degreeId: hostMate.degreeId,
            playerRoleKind: 99,
            party,
            connectionId: `${client.roomNumber}-npc-${comId}`,
            autoplayMode: false,
            autoskillMode: 1,
            autoSpeedLevel: 1,
            autoStart: false,
            skillAbilityBehaviorMode: 1,
            dashBehaviorMode: 1,
            allowHealFromOtherPlayers: true,
            state: [0],
            entryTime: Date.now(),
            isNewbie: false,
            isHost: false,
        })
    }

    client.mates = [...realMates, ...npcMates]

    const hostClient = findHostClient(client.roomNumber)
    if (hostClient) hostClient.mates = client.mates

    syncRoomMates(room, client.mates)

    console.log(`[LOBBY] EnterComs: room=${client.roomNumber} real=${realMates.length} npc=${npcMates.length} total=${client.mates.length}`)

    setTimeout(() => {
        try {
            // Send Mates only to triggering client — others get theirs via handleEnter
            sessionManager.sendJson(client.socket, [1, [1, client.mates]])
        } catch (e) { console.error("[LOBBY] EnterComs send-mates error", e) }
    }, NPC_JOIN_DELAY_MS)

    setTimeout(() => {
        try {
            for (const npc of npcMates) {
                npc.state = [1]
                sessionManager.broadcastToRoom(client.roomNumber, [1, [2, npc.connectionId, [1]]])
            }
            if (realMates.length === 1) checkHostAutoReady(client.roomNumber)
        } catch (e) { console.error("[LOBBY] EnterComs npc-ready error", e) }
    }, NPC_JOIN_DELAY_MS + NPC_READY_DELAY_MS)
}

function handleEnter(_socket: net.Socket, client: SessionClient, data: any[]): void {
    const ed = data[1]
    if (!ed?.party || !client.yourself) return

    client.yourself.party = ed.party
    if (ed.autoplayMode !== undefined) client.yourself.autoplayMode = ed.autoplayMode;
    if (ed.autoskillMode !== undefined) client.yourself.autoskillMode = ed.autoskillMode;
    if (ed.autoSpeedLevel !== undefined) client.yourself.autoSpeedLevel = ed.autoSpeedLevel;
    if (ed.autoStart !== undefined) client.yourself.autoStart = ed.autoStart;
    if (ed.skillAbilityBehaviorMode !== undefined) client.yourself.skillAbilityBehaviorMode = ed.skillAbilityBehaviorMode;
    if (ed.dashBehaviorMode !== undefined) client.yourself.dashBehaviorMode = ed.dashBehaviorMode;
    if (ed.allowHealFromOtherPlayers !== undefined) client.yourself.allowHealFromOtherPlayers = ed.allowHealFromOtherPlayers;
    client.enterData = ed

    const room = getRoom(client.roomNumber)
    const isHost = room && client.viewerId === room.host_viewer_id

    if (isHost) {
        updateRoomState(client.roomNumber, 1)
    }

    const hostClient = findHostClient(client.roomNumber)

    // Guest entered before host (or host connected but hasn't entered) → wait with Welcome
    if (!isHost && (!hostClient || !hostClient.mates[0])) {
        client.mates = [client.yourself!]
        sessionManager.sendJson(client.socket, [1, [0, client.yourself, [client.yourself]]])
        console.log(`[LOBBY] guest ${client.viewerId} entered alone, waiting for host in room ${client.roomNumber}`)
        return
    }

    if (isHost) {
        client.mates = [client.yourself!]
        const set = (sessionManager as any).roomClients?.get?.(client.roomNumber) as Set<string> | undefined
        if (set) {
            const clientsMap = (sessionManager as any).clients as Map<string, SessionClient> | undefined
            if (clientsMap) {
                for (const addr of set) {
                    const c = clientsMap.get(addr)
                    if (c && c !== client && !c.isBattle && c.yourself) {
                        client.mates.push(c.yourself)
                    }
                }
            }
        }
        if (room && isFiveBossLobbyRoom(room)) {
            let roster: HostCloneLobbyMate[] = []
            for (const mate of client.mates as HostCloneLobbyMate[]) {
                roster = mergeFiveBossRealMate(roster, mate)
            }
            syncFiveBossRoster(client.roomNumber, roster)
            scheduleFiveBossFill(client.roomNumber)
        } else if (room) {
            syncRoomMates(room, client.mates)
        }
        if (client.mates.length > 1) {
            sessionManager.broadcastToRoom(client.roomNumber, [1, [1, client.mates]], `${client.viewerId}@${client.roomNumber}`)
        }
        if (room && !isFiveBossLobbyRoom(room) && room.npc_count > 0 && countRealPlayers(client.mates) < 3) {
            setTimeout(() => { handleEnterComs(client, [{ name: "开心超人" }, { name: "名字真难取" }]).catch(e => console.error("[LOBBY] EnterComs (timer) error", e)); }, 500)
        }
    } else {
        if (hostClient && client.yourself) {
            if (room && isFiveBossLobbyRoom(room)) {
                const roster = mergeFiveBossRealMate(hostClient.mates, client.yourself)
                syncFiveBossRoster(client.roomNumber, roster)
                if (countHostCloneMates(roster).total >= 3) {
                    cancelFiveBossLobbyFill(client.roomNumber)
                }
            } else {
                hostClient.mates.push(client.yourself)
                while (hostClient.mates.length > 3) {
                    const npcIdx = hostClient.mates.findIndex(m => isHostCloneAiMate(m))
                    if (npcIdx >= 0) hostClient.mates.splice(npcIdx, 1)
                    else break
                }
                client.mates = [...hostClient.mates]
            }
        } else {
            client.mates = [client.yourself!]
        }
        if (room && !isFiveBossLobbyRoom(room)) syncRoomMates(room, client.mates)
    }

    const yourself = client.yourself
    if (yourself) {
        sessionManager.sendJson(client.socket, [1, [0, yourself, [yourself]]])
    }

    if (!isHost) {
        const mates = hostClient?.mates ?? client.mates
        sessionManager.broadcastToRoom(client.roomNumber, [1, [1, mates]], undefined)
    }

    console.log(`[LOBBY] ${isHost ? "host" : "guest"} ${client.viewerId} entered room ${client.roomNumber}`)
}

function handleBye(_socket: net.Socket, client: SessionClient, _data: any[]): void {
    const roomBeforeBye = getRoom(client.roomNumber)
    const leavingFiveBossHost = !!roomBeforeBye
        && isFiveBossLobbyRoom(roomBeforeBye)
        && client.viewerId === roomBeforeBye.host_viewer_id
    if (leavingFiveBossHost) cancelFiveBossLobbyFill(client.roomNumber)

    const set = (sessionManager as any).roomClients?.get?.(client.roomNumber) as Set<string> | undefined
    if (set) {
        const clientsMap = (sessionManager as any).clients as Map<string, SessionClient> | undefined
        if (clientsMap) {
            for (const addr of set) {
                const c = clientsMap.get(addr)
                if (c && c !== client && !c.isBattle) {
                    c.mates = c.mates.filter(m => m.viewerId !== client.viewerId)
                }
            }
        }
    }
    const hostClient = findHostClient(client.roomNumber)
    sessionManager.removeClient(client)
    // Only refresh the mate list if the room still exists AND a *different* client is the host (i.e. a
    // guest left but the room lives on). If the room was disbanded (host left / went empty), the
    // [6, dismissed] broadcast already tore it down — pushing a stale/empty mate list here makes the
    // remaining client's refreshMates dereference undefined character-display data and crash (F1010).
    const liveRoom = getRoom(client.roomNumber)
    if (liveRoom && hostClient && hostClient !== client) {
        if (isFiveBossLobbyRoom(liveRoom)) {
            syncFiveBossRoster(client.roomNumber, hostClient.mates)
            if (liveRoom.raising_state !== 4) scheduleFiveBossFill(client.roomNumber)
        } else {
            syncRoomMates(liveRoom, hostClient.mates)
        }
        sessionManager.broadcastToRoom(client.roomNumber, [1, [1, hostClient.mates]])
    }
    try { client.socket.destroy(); } catch (e) {}
    console.log(`[LOBBY] client ${client.viewerId} left room ${client.roomNumber}`)
}

function handleChangeParty(_socket: net.Socket, client: SessionClient, data: any[]): void {
    const pd = data[1]
    if (pd?.party && client.yourself) {
        client.yourself.party = pd.party
        if (pd.currentPartyId !== undefined) {
            client.yourself.currentPartyId = pd.currentPartyId
        }
    }
    const mate = client.mates.find(m => m.viewerId === client.viewerId)
    if (mate) {
        if (client.playerId && pd.currentPartyId !== undefined) { try { const up = require("../../data/domains/player").updatePlayerSync; up({ id: client.playerId, partySlot: pd.currentPartyId }); } catch(e) {} }
        const room = getRoom(client.roomNumber); if (room) { room.host_party_id = pd.currentPartyId; }
        const hostClient = findHostClient(client.roomNumber)
        sessionManager.broadcastToRoom(client.roomNumber, [1, [1, hostClient?.mates ?? client.mates]])
    }
    console.log(`[LOBBY] client ${client.viewerId} changed party`)
}

function handleReady(_socket: net.Socket, client: SessionClient, data: any[]): void {
    const readyState = Array.isArray(data[1]) ? data[1][0] : data[1]
    client.isReady = readyState === 1

    const mate = client.mates.find(m => m.viewerId === client.viewerId)
    if (mate) {
        mate.state = data[1] ?? [1]
        sessionManager.broadcastToRoom(client.roomNumber, [1, [2, mate.connectionId, mate.state]])
    }

    checkHostAutoReady(client.roomNumber)
    console.log(`[LOBBY] client ${client.viewerId} ready: ${client.isReady}`)
}

function handleChangeAutoplayMode(client: SessionClient, data: any[]): void {
    const room = getRoom(client.roomNumber)
    if (!room || !isFiveBossLobbyRoom(room)) return
    const hostClient = findHostClient(client.roomNumber)
    const result = applyAutoplayModeChange({
        viewerId: client.viewerId,
        auto: data[1],
        manual: data[2],
        yourself: client.yourself,
        hostMates: hostClient?.mates ?? client.mates,
    })
    if (!result) return

    for (const mate of client.mates) {
        if (mate.viewerId === client.viewerId) mate.autoplayMode = data[1]
    }
    sessionManager.broadcastToRoom(client.roomNumber, result.message)
}

function handleHeartbeat(socket: net.Socket, client: SessionClient, _data: any[]): void {
    sessionManager.sendJson(socket, [1, [11, client.connectionId]])
}

function handleStartBattle(_socket: net.Socket, client: SessionClient, _data: any[]): void {
    if ((sessionManager as any).battleExpectedCount?.has?.(client.roomNumber)) return

    const room = getRoom(client.roomNumber)
    let members = [...client.mates] as HostCloneLobbyMate[]
    let expectedCount = countRealPlayers(members)

    if (room && isFiveBossLobbyRoom(room)) {
        if (client.viewerId !== room.host_viewer_id) return
        cancelFiveBossLobbyFill(client.roomNumber)
        const snapshot = getFiveBossSnapshot(client.roomNumber)
        if (!snapshot) return

        const missingClones = buildHostCloneMates({
            roomNumber: client.roomNumber,
            hostMate: snapshot.hostMate,
            mates: snapshot.mates,
        })
        for (const clone of missingClones) clone.state = [1]
        members = refreshFiveBossHostClones(
            snapshot.hostMate,
            [...snapshot.mates, ...missingClones],
        )
        if (!canStartFiveBossLobbyRun(room, client.viewerId, members)) return
        const frozenRuntime = freezeFiveBossLobbyRuntime(
            members,
            undefined,
            connectionId => (
                sessionManager.getRoomClientByConnectionId(client.roomNumber, connectionId)
                    ?.socket.remoteAddress ?? null
            ),
        )
        syncFiveBossRoster(client.roomNumber, members)
        room.five_boss_runtime = frozenRuntime
        expectedCount = frozenRuntime.expectedRealPlayerIds.length
    }

    sessionManager.setBattleExpectedCount(
        client.roomNumber,
        expectedCount,
        room !== undefined && isFiveBossLobbyRoom(room),
    )
    updateRoomState(client.roomNumber, 4)

    autoStartingRooms.delete(client.roomNumber)
    sessionManager.broadcastToRoom(client.roomNumber, [1, [5, members]])
    console.log(`[LOBBY] StartBattle: room=${client.roomNumber} mates=${members.length} expected=${expectedCount}`)
}

function handleNotify(socket: net.Socket, client: SessionClient, data: any[]): void {
    const notifyData = data[1]
    if (!Array.isArray(notifyData)) return
    const tag = notifyData[0] as number

    switch (tag) {
        case 0: handleEnter(socket, client, notifyData); break
        case 1: handleBye(socket, client, notifyData); break
        case 2: handleChangeParty(socket, client, notifyData); break
        case 3: handleReady(socket, client, notifyData); break
        case 4: handleHeartbeat(socket, client, notifyData); break
        case 5: case 8: case 9: break  // Suspend/ChangeAutoStart/Log — silently ignored
        case 6: handleStartBattle(socket, client, notifyData); break
        case 7: handleChangeAutoplayMode(client, notifyData); break
        case 10: handleEnterComs(client, notifyData[1] as any[]).catch(e => console.error("[LOBBY] EnterComs error", e)); break
        default:
            console.log(`[LOBBY] unhandled Notify: ${tag}`)
    }
}

function handleBroadcast(_socket: net.Socket, client: SessionClient, data: any[]): void {
    sessionManager.broadcastToRoom(client.roomNumber, data)
}

function handleSend(_socket: net.Socket, _client: SessionClient, data: any[]): void {
    const targetViewerId = data[1] as number
    const roomNumber = _client.roomNumber
    const clientsMap = (sessionManager as any).clients as Map<string, SessionClient> | undefined
    if (!clientsMap) return
    for (const c of clientsMap.values()) {
        if (c.viewerId === targetViewerId && c.roomNumber === roomNumber) {
            sessionManager.sendJson(c.socket, data)
            return
        }
    }
}

export function handleMessage(socket: net.Socket, data: unknown): void {
    if (!Array.isArray(data)) return
    const tag = data[0] as number
    const client = findClientBySocket(socket)
    if (!client) {
        console.log(`[LOBBY] no client found for socket, dropping message tag=${tag}`)
        return
    }

    switch (tag) {
        case 0: handleNotify(socket, client, data); break
        case 1: handleBroadcast(socket, client, data); break
        case 2: handleSend(socket, client, data); break
        default:
            console.log(`[LOBBY] unhandled Client2Server: ${tag}`)
    }
}
