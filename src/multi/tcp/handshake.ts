// Multi battle TCP session handshake
// Protocol: JSON messages delimited by null byte (\0)
// Post-handshake messages use typepacker format with useEnumIndex=true:
//   [index, param1, param2, ...]
//
// HandshakeResult: Accept=0, Denied=1, Reconnect=2, Exception=3, Complete=4

import * as net from "net"
import { playerSocketAllowed } from "../../lib/player-login"
import { isFiveBossGauntletQuest } from "../five-boss/contract"
import { isFrozenFiveBossBattleClient } from "../five-boss/lobby-runtime"
import { fiveBossConnectionDiagnostics } from "../five-boss/connection-diagnostic"
import { getRankDegree } from "../../lib/stamina"
import { getRoom, getRoomMemberPlayerId } from "../room/manager"
import { sessionManager } from "../state/SessionManager"
import type { SessionClient } from "../state/SessionManager"
import { gameVerboseLog } from "../../lib/game-logging"
import { ClientState } from "../types"
import { embeddedMultiCoordinator } from "../coordinator/embedded"
import {
    recordRoomAdmissionBypass,
    recordRoomAdmissionDenial,
    roomAdmissionRegistry,
} from "../room/admission"
import { getCachedMultiPlayerContext, resolveMultiPlayerContext } from "../player-context"
import { buildRealParty, getRealPartySnapshot } from "../party-snapshot"
import { markTcpDisconnectReason } from "./disconnect-diagnostics"
import { canJoinMultiGuestQuestSync } from "../guest-eligibility"

// NPC workers historically import buildRealParty from this module. Keep the
// export stable while the implementation lives beside the warmed snapshot.
export { buildRealParty }

export async function handleHandshake(socket: net.Socket, data: any): Promise<void> {
    gameVerboseLog(() => `[TCP] handshake: ${JSON.stringify({ socklet: data.socklet, viewerId: data.viewerId, room_number: data.room_number || data.roomNumber })}`)

    const socklet = data.socklet
    const roomNumber = data.room_number || data.roomNumber

    if (socklet === "cooperation_battle") {
        const connectionId = data.connection_id || data.connectionId || `${socket.remoteAddress}:${socket.remotePort}`
        if (!roomNumber) {
            markTcpDisconnectReason(socket, "handshake_denied")
            sessionManager.sendJson(socket, [3, "HANDSHAKE_DENIED"])
            socket.end()
            return
        }

        const roomId = String(roomNumber)
        // The battle handshake does not carry viewerId.  Resolve it from the
        // lobby connection that issued the same connection_id.  Leaving every
        // battle client as viewer 0 makes unrelated host/guest sockets look
        // like duplicate connections and causes one side to be replaced.
        // A connection id that no known room/battle seat issued cannot be
        // bound to a viewer, so it is never admitted as an anonymous seat.
        const identity = sessionManager.resolveBattleHandshakeIdentity(roomId, String(connectionId))
        if (!identity || !playerSocketAllowed(identity.viewerId, data.sp_session)) {
            fiveBossConnectionDiagnostics.socketEvent(socket, "handshake_denied",
                identity ? "session_mismatch" : "unknown_connection")
            markTcpDisconnectReason(socket, "handshake_denied")
            sessionManager.sendJson(socket, [3, "HANDSHAKE_DENIED"])
            socket.end()
            return
        }
        const battleClient = sessionManager.createClient(
            socket,
            identity.viewerId,
            roomId,
            String(connectionId),
            identity.playerId,
        )
        const battleRoom = getRoom(roomId)
        battleClient.roomGeneration = identity.roomGeneration ?? battleRoom?.lobby_generation ?? 0
        if (battleRoom) fiveBossConnectionDiagnostics.bind(battleRoom, battleClient)
        if (!battleRoom || battleRoom.lifecycle.phase !== "BATTLE") {
            fiveBossConnectionDiagnostics.socketEvent(socket, "handshake_denied", "room_not_in_battle")
            markTcpDisconnectReason(socket, "handshake_denied")
            sessionManager.sendJson(socket, [3, "HANDSHAKE_DENIED"])
            socket.end()
            return
        }
        if (battleRoom && isFiveBossGauntletQuest(battleRoom.category, battleRoom.quest_id)
            && !isFrozenFiveBossBattleClient(battleRoom, battleClient)) {
            fiveBossConnectionDiagnostics.socketEvent(socket, "handshake_denied", "frozen_identity_mismatch")
            markTcpDisconnectReason(socket, "handshake_denied")
            sessionManager.sendJson(socket, [3, "HANDSHAKE_DENIED"])
            socket.end()
            return
        }
        if (battleClient.playerId !== null
            && battleRoom?.five_boss_runtime?.battleEnteredPlayerIds?.includes(battleClient.playerId)) {
            battleClient.fiveBossBattleEntered = true
        }
        battleClient.isBattle = true
        if (!sessionManager.addBattleClient(String(connectionId), battleClient)) {
            fiveBossConnectionDiagnostics.socketEvent(socket, "handshake_denied", "retired_seat")
            markTcpDisconnectReason(socket, "handshake_denied")
            sessionManager.sendJson(socket, [3, "HANDSHAKE_DENIED"])
            socket.end()
            return
        }
        sessionManager.sendJson(socket, [0, roomNumber, ""])
        return
    }

    if (socklet === "cooperation_room") {
        const viewerId = data.viewerId
        if (!playerSocketAllowed(viewerId, data.sp_session)) {
            markTcpDisconnectReason(socket, "handshake_denied")
            sessionManager.sendJson(socket, [3, "HANDSHAKE_DENIED"])
            socket.end()
            return
        }
        if (!viewerId || !roomNumber) {
            markTcpDisconnectReason(socket, "handshake_denied")
            sessionManager.sendJson(socket, [3, "HANDSHAKE_DENIED"])
            socket.end()
            return
        }

        const roomId = String(roomNumber)
        if (!getRoom(roomId)) {
            // CN does not ship the room_not_found UiString used by this denied
            // packet. A stale notice must never turn into client error C8601.
            markTcpDisconnectReason(socket, "handshake_denied")
            sessionManager.sendJson(socket, [3, "HANDSHAKE_DENIED"])
            socket.end()
            return
        }

        // playerSocketAllowed above still performs the authoritative session
        // check. A context warmed by create/select_room can therefore be used
        // here without another synchronous session/player lookup.
        const ctx = getCachedMultiPlayerContext(Number(viewerId))
            ?? await resolveMultiPlayerContext(Number(viewerId))
        if (!ctx) {
            markTcpDisconnectReason(socket, "handshake_denied")
            sessionManager.sendJson(socket, [3, "HANDSHAKE_DENIED"])
            socket.end()
            return
        }

        // HTTP room selection and TCP connection are separate operations. Two
        // guests can pass the HTTP capacity check concurrently, so re-check the
        // live room atomically immediately before accepting this socket.
        const currentRoom = getRoom(roomId)
        if (!currentRoom) {
            markTcpDisconnectReason(socket, "handshake_denied")
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
        const requestedCategory = data.questCategory ?? data.quest_category
        const requestedQuestId = data.questId ?? data.quest_id
        const categoryMismatch = requestedCategory !== undefined
            && Number(requestedCategory) !== currentRoom.category
        const questMismatch = requestedQuestId !== undefined
            && Number(requestedQuestId) !== currentRoom.quest_id
        const isReturningMember = currentRoom.host_viewer_id === Number(viewerId)
            || currentRoom.expected_real_viewer_ids.includes(Number(viewerId))
            || currentRoom.mates.some(mate => mate.viewer_id === Number(viewerId))
        const waitingForExpectedMember = currentRoom.lobby_generation > 0
            && currentRoom.expected_real_viewer_ids.some(expectedViewerId => !liveViewerIds.has(expectedViewerId))
        const roomPhase = embeddedMultiCoordinator.ensureLifecycle(currentRoom).phase
        const restoreBlocked = sessionManager.isRoomRestoreBlocked(roomId, Number(viewerId))
        const recordedPlayerId = getRoomMemberPlayerId(currentRoom, Number(viewerId))
        const guestAdmissionIsRescue = !isReturningMember
            && roomAdmissionRegistry.isRescue(roomId, currentRoom.lobby_generation, Number(viewerId))
        const guestEligibility = !isReturningMember
            ? canJoinMultiGuestQuestSync(
                ctx.playerId,
                currentRoom.category,
                currentRoom.quest_id,
            )
            : null
        const structuralReasons = [
            categoryMismatch ? "category_mismatch" : "",
            questMismatch ? "quest_mismatch" : "",
            recordedPlayerId !== null && recordedPlayerId !== ctx.playerId ? "player_mismatch" : "",
            !viewerAlreadyConnected && liveClients.length >= 3 ? "full" : "",
            !isReturningMember && (roomPhase === "STARTING" || roomPhase === "BATTLE") ? "battle_started" : "",
            !isReturningMember && waitingForExpectedMember ? "waiting_for_returning_member" : "",
            guestEligibility?.allowed === false
                ? `${guestAdmissionIsRescue ? "rescue" : "guest"}_${guestEligibility.reason}`
                : "",
            restoreBlocked ? "restore_blocked" : "",
        ].filter(Boolean)

        if (structuralReasons.length > 0) {
            for (const reason of structuralReasons) recordRoomAdmissionDenial(reason)
            console.warn(
                `[TCP] room handshake unavailable: viewer=${viewerId} room=${roomId}`
                + ` live=${liveClients.length} state=${currentRoom.raising_state}`
                + ` reason=${structuralReasons.join(",")}`,
            )
            roomAdmissionRegistry.release(roomId, Number(viewerId))
            // Normal stale/full cases are filtered before the TCP handshake.
            // Keep a protocol-level race fallback without looking up a missing
            // CN UiString key (room_full/room_not_found both cause C8601).
            markTcpDisconnectReason(socket, "handshake_denied")
            sessionManager.sendJson(socket, [3, "HANDSHAKE_DENIED"])
            socket.end()
            return
        }

        const { playerId, player } = ctx
        const connectionId = String(
            data.connection_id || data.connectionId || `${socket.remoteAddress}:${socket.remotePort}`,
        )
        // The HTTP room-selection path primes this snapshot before opening the
        // socket. Direct legacy clients still get a safe synchronous fallback,
        // but normal handshakes now stay on the in-memory path.
        const party = getRealPartySnapshot(playerId)
        if (isReturningMember) recordRoomAdmissionBypass("returning_member")
        const admissionClaim = isReturningMember
            ? null
            : roomAdmissionRegistry.claim(
                roomId,
                currentRoom.lobby_generation,
                Number(viewerId),
                connectionId,
            )
        if (admissionClaim?.ok === false) {
            console.warn(
                `[TCP] room handshake unavailable: viewer=${viewerId} room=${roomId}`
                + ` live=${liveClients.length} state=${currentRoom.raising_state}`
                + ` reason=not_reserved_${admissionClaim.reason}`,
            )
            markTcpDisconnectReason(socket, "handshake_denied")
            sessionManager.sendJson(socket, [3, "HANDSHAKE_DENIED"])
            socket.end()
            return
        }

        const client = sessionManager.createClient(socket, Number(viewerId), roomId, connectionId, playerId)
        client.roomGeneration = currentRoom.lobby_generation
        client.admissionClaimed = admissionClaim?.ok === true
        client.admissionGeneration = admissionClaim?.ok === true
            ? currentRoom.lobby_generation
            : undefined
        client.clientState.tryTransition(ClientState.Handshaking)

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
            isHost: Number(viewerId) === currentRoom.host_viewer_id,
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
    markTcpDisconnectReason(socket, "handshake_denied")
    sessionManager.sendJson(socket, [1, "DENIED"])
    socket.end()
}
