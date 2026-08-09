// Multi battle TCP session handshake
// Protocol: JSON messages delimited by null byte (\0)
// Post-handshake messages use typepacker format with useEnumIndex=true:
//   [index, param1, param2, ...]
//
// HandshakeResult: Accept=0, Denied=1, Reconnect=2, Exception=3, Complete=4

import * as net from "net"
import {
    getSession,
} from "../../data/domains/session"
import { getAccountPlayers } from "../../data/domains/account"
import {
    getPlayerSync,
} from "../../data/domains/player"
import {
    getPlayerPartyGroupListSync,
} from "../../data/domains/party"
import {
    getPlayerCharacterSync,
    getPlayerCharacterManaNodesSync,
} from "../../data/domains/character"
import {
    getPlayerEquipmentSync,
} from "../../data/domains/equipment"
import { PartyCategory, PlayerParty } from "../../data/types"
import { getRankDegree } from "../../lib/stamina"
import { getRoom } from "../room/manager"
import { sessionManager } from "../state/SessionManager"
import type { SessionClient } from "../state/SessionManager"
import { gameVerboseLog } from "../../lib/game-logging"
import { ClientState } from "../types"

export function buildRealParty(playerId: number, targetParty?: PlayerParty): any {
    const emptyChar = [1]
    const filledChars: any[] = []
    const filledUnison: any[] = []
    const filledEquips: any[] = []
    const filledSouls: any[] = []

    // Search for an NPC-named party across NORMAL and EVENT categories
    let selectedParty: PlayerParty | null = targetParty ?? null
    if (!selectedParty) {
        for (const category of [PartyCategory.NORMAL, PartyCategory.EVENT]) {
        const groups = getPlayerPartyGroupListSync(playerId, category)
        for (const g of Object.values(groups)) {
            for (const party of Object.values(g.list)) {
                if (party.name && party.name.includes("NPC")) {
                    selectedParty = party
                    break
                }
            }
            if (selectedParty) break
        }
        if (selectedParty) break
    }
    }

    for (let i = 0; i < 3; i++) {
        const charId = selectedParty?.characterIds[i] ?? null
        if (!charId) {
            filledChars.push([1])
            filledUnison.push([1])
        } else {
            const dbChar = getPlayerCharacterSync(playerId, charId)
            if (!dbChar) {
                filledChars.push([1])
                filledUnison.push([1])
            } else {
                const rawManaNodes = getPlayerCharacterManaNodesSync(playerId, charId)
                const manaNodeMap: Record<string, number> = {}
                for (const id of rawManaNodes) manaNodeMap[String(id)] = 0

                let exBoost: any = [1]
                if (dbChar.exBoost && dbChar.exBoost.abilityIdList && dbChar.exBoost.abilityIdList.length > 0) {
                    exBoost = [0, { ability_id_list: dbChar.exBoost.abilityIdList, status_id: dbChar.exBoost.statusId }]
                }

                const charObj = {
                    id: charId,
                    evolution_level: dbChar.evolutionLevel,
                    exp: dbChar.exp,
                    over_limit_step: dbChar.overLimitStep,
                    mana_node_ids: manaNodeMap,
                    ex_boost: exBoost,
                    illustration_settings: [1],
                }
                filledChars.push([0, charObj])
            }

            const unisonId = selectedParty?.unisonCharacterIds[i] ?? null
            if (!unisonId) {
                filledUnison.push([1])
            } else {
                const dbUnison = getPlayerCharacterSync(playerId, unisonId)
                if (!dbUnison) {
                    filledUnison.push([1])
                } else {
                    const rawNodes = getPlayerCharacterManaNodesSync(playerId, unisonId)
                    const nodeMap: Record<string, number> = {}
                    for (const id of rawNodes) nodeMap[String(id)] = 0

                    let ubEx: any = [1]
                    if (dbUnison.exBoost && dbUnison.exBoost.abilityIdList && dbUnison.exBoost.abilityIdList.length > 0) {
                        ubEx = [0, { ability_id_list: dbUnison.exBoost.abilityIdList, status_id: dbUnison.exBoost.statusId }]
                    }

                    filledUnison.push([0, {
                        id: unisonId,
                        evolution_level: dbUnison.evolutionLevel,
                        exp: dbUnison.exp,
                        over_limit_step: dbUnison.overLimitStep,
                        mana_node_ids: nodeMap,
                        ex_boost: ubEx,
                        illustration_settings: [1],
                    }])
                }
            }
        }

        const equipId = selectedParty?.equipmentIds[i] ?? null
        if (!equipId) {
            filledEquips.push([1])
        } else {
            const dbEquip = getPlayerEquipmentSync(playerId, equipId)
            if (!dbEquip) {
                filledEquips.push([1])
            } else {
                filledEquips.push([0, { equipmentId: equipId, level: dbEquip.level, enhancementLevel: dbEquip.enhancementLevel }])
            }
        }

        const soulId = selectedParty?.abilitySoulIds[i] ?? null
        filledSouls.push(soulId ? [0, soulId] : [1])
    }

    return {
        characters: filledChars,
        unison_characters: filledUnison,
        equipments: filledEquips,
        abilitySoulIds: filledSouls,
    }
}

export async function handleHandshake(socket: net.Socket, data: any): Promise<void> {
    gameVerboseLog(() => `[TCP] handshake: ${JSON.stringify(data).substring(0, 200)}`)

    const socklet = data.socklet
    const roomNumber = data.room_number || data.roomNumber

    if (socklet === "cooperation_battle") {
        const connectionId = data.connection_id || data.connectionId || `${socket.remoteAddress}:${socket.remotePort}`
        if (!roomNumber) {
            sessionManager.sendJson(socket, [3, "HANDSHAKE_DENIED"])
            socket.end()
            return
        }

        const roomId = String(roomNumber)
        // The battle handshake does not carry viewerId.  Resolve it from the
        // lobby connection that issued the same connection_id.  Leaving every
        // battle client as viewer 0 makes unrelated host/guest sockets look
        // like duplicate connections and causes one side to be replaced.
        const roomClient = sessionManager.getRoomClientByConnectionId(roomId, String(connectionId))
        const battleClient = sessionManager.createClient(
            socket,
            roomClient?.viewerId ?? 0,
            roomId,
            String(connectionId),
            roomClient?.playerId ?? null,
        )
        battleClient.roomGeneration = roomClient?.roomGeneration ?? getRoom(roomId)?.lobby_generation ?? 0
        battleClient.isBattle = true
        sessionManager.addBattleClient(String(connectionId), battleClient)
        sessionManager.sendJson(socket, [0, roomNumber, ""])
        return
    }

    if (socklet === "cooperation_room") {
        const viewerId = data.viewerId
        if (!viewerId || !roomNumber) {
            sessionManager.sendJson(socket, [3, "HANDSHAKE_DENIED"])
            socket.end()
            return
        }

        const roomId = String(roomNumber)
        if (!getRoom(roomId)) {
            // CN does not ship the room_not_found UiString used by this denied
            // packet. A stale notice must never turn into client error C8601.
            sessionManager.sendJson(socket, [3, "HANDSHAKE_DENIED"])
            socket.end()
            return
        }

        const session = await getSession(String(viewerId))
        if (!session) {
            sessionManager.sendJson(socket, [3, "HANDSHAKE_DENIED"])
            socket.end()
            return
        }

        const playerIds = await getAccountPlayers(session.accountId)
        if (!playerIds || playerIds.length === 0 || isNaN(playerIds[0])) {
            sessionManager.sendJson(socket, [3, "HANDSHAKE_DENIED"])
            socket.end()
            return
        }

        const player = getPlayerSync(playerIds[0])
        if (!player) {
            sessionManager.sendJson(socket, [3, "HANDSHAKE_DENIED"])
            socket.end()
            return
        }

        // HTTP room selection and TCP connection are separate operations. Two
        // guests can pass the HTTP capacity check concurrently, so re-check the
        // live room atomically immediately before accepting this socket.
        const currentRoom = getRoom(roomId)
        if (!currentRoom) {
            sessionManager.sendJson(socket, [3, "HANDSHAKE_DENIED"])
            socket.end()
            return
        }
        // A socket can emit close/error immediately before this handshake while
        // its indexed room client is still waiting for the event-loop cleanup.
        // Do not let that short race make a rescue room look full.
        const indexedClients = sessionManager.getClientsInRoom(roomId, currentRoom.lobby_generation)
            .filter(client => !client.isBattle)
        for (const indexedClient of indexedClients) {
            if (indexedClient.socket.destroyed
                || !indexedClient.socket.readable
                || !indexedClient.socket.writable) {
                sessionManager.removeClient(indexedClient)
            }
        }
        const liveClients = sessionManager.getClientsInRoom(roomId, currentRoom.lobby_generation)
            .filter(client => !client.isBattle
                && !client.socket.destroyed
                && client.socket.readable
                && client.socket.writable)
        const liveViewerIds = new Set(liveClients.map(client => client.viewerId))
        const viewerAlreadyConnected = liveViewerIds.has(Number(viewerId))
        const isReturningMember = currentRoom.host_viewer_id === Number(viewerId)
            || currentRoom.expected_real_viewer_ids.includes(Number(viewerId))
            || currentRoom.mates.some(mate => mate.viewer_id === Number(viewerId))
        const waitingForExpectedMember = currentRoom.lobby_generation > 0
            && currentRoom.expected_real_viewer_ids.some(expectedViewerId => !liveViewerIds.has(expectedViewerId))
        const roomUnavailable = (!viewerAlreadyConnected && liveClients.length >= 3)
            || (!isReturningMember && currentRoom.raising_state === 4)
            || (!isReturningMember && waitingForExpectedMember)
            || sessionManager.isRoomRestoreBlocked(roomId, Number(viewerId))

        if (roomUnavailable) {
            const reasons = [
                !viewerAlreadyConnected && liveClients.length >= 3 ? "full" : "",
                !isReturningMember && currentRoom.raising_state === 4 ? "battle_started" : "",
                !isReturningMember && waitingForExpectedMember ? "waiting_for_returning_member" : "",
                sessionManager.isRoomRestoreBlocked(roomId, Number(viewerId)) ? "restore_blocked" : "",
            ].filter(Boolean).join(",")
            console.warn(
                `[TCP] room handshake unavailable: viewer=${viewerId} room=${roomId}`
                + ` live=${liveClients.length} state=${currentRoom.raising_state}`
                + ` reason=${reasons || "unknown"}`,
            )
            // Normal stale/full cases are filtered before the TCP handshake.
            // Keep a protocol-level race fallback without looking up a missing
            // CN UiString key (room_full/room_not_found both cause C8601).
            sessionManager.sendJson(socket, [3, "HANDSHAKE_DENIED"])
            socket.end()
            return
        }

        const playerId = playerIds[0]
        const connectionId = data.connection_id || data.connectionId || `${socket.remoteAddress}:${socket.remotePort}`
        const client = sessionManager.createClient(socket, Number(viewerId), roomId, String(connectionId), playerId)
        client.clientState.tryTransition(ClientState.Handshaking)

        const party = buildRealParty(playerId)
        const yourSelf = {
            viewerId: Number(viewerId),
            playerId: playerId,
            name: player.name,
            rank: getRankDegree(player.rankPoint || 0),
            degreeId: player.degreeId || 1,
            mainCharacterId: player.leaderCharacterId,
            party,
            connectionId,
            playerRoleKind: player.role || 1,
            isNewbie: !!player.tutorialStep,
            isHost: true,
            entryTime: Date.now(),
            currentPartyId: player.partySlot || 1,
            autoplayMode: false,
            autoskillMode: 1,
            autoSpeedLevel: 1,
            autoStart: false,
            skillAbilityBehaviorMode: 1,
            dashBehaviorMode: 1,
            allowHealFromOtherPlayers: true,
            state: [0],
        }
        client.yourself = yourSelf

        sessionManager.addClientToRoom(client)
        sessionManager.sendJson(socket, [0, connectionId, roomNumber])
        return
    }

    // Unknown socklet
    sessionManager.sendJson(socket, [1, "DENIED"])
    socket.end()
}
