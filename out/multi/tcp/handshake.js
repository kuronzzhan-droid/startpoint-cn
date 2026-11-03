"use strict";
// Multi battle TCP session handshake
// Protocol: JSON messages delimited by null byte (\0)
// Post-handshake messages use typepacker format with useEnumIndex=true:
//   [index, param1, param2, ...]
//
// HandshakeResult: Accept=0, Denied=1, Reconnect=2, Exception=3, Complete=4
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleHandshake = exports.buildRealParty = void 0;
const multi_room_1 = require("../../lib/weapon-riven/multi-room");
const contract_1 = require("../five-boss/contract");
const lobby_runtime_1 = require("../five-boss/lobby-runtime");
const connection_diagnostic_1 = require("../five-boss/connection-diagnostic");
const manager_1 = require("../room/manager");
const SessionManager_1 = require("../state/SessionManager");
const game_logging_1 = require("../../lib/game-logging");
const types_1 = require("../types");
const embedded_1 = require("../coordinator/embedded");
const admission_1 = require("../room/admission");
const business_rpc_1 = require("../coordinator/business-rpc");
const runtime_role_1 = require("../coordinator/runtime-role");
const business_facts_1 = require("../coordinator/business-facts");
const disconnect_diagnostics_1 = require("./disconnect-diagnostics");
// NPC workers historically import buildRealParty from this module. Keep the
// export stable while the implementation lives beside the warmed snapshot.
function buildRealParty(playerId, targetParty) {
    if ((0, runtime_role_1.isRealtimeOwnerChild)())
        throw new Error("REALTIME_PARTY_FACTS_REQUIRED");
    return require("../party-snapshot").buildRealParty(playerId, targetParty);
}
exports.buildRealParty = buildRealParty;
function handleHandshake(socket, data) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r;
        (0, game_logging_1.gameVerboseLog)(() => `[TCP] handshake: ${JSON.stringify({ socklet: data.socklet, viewerId: data.viewerId, room_number: data.room_number || data.roomNumber })}`);
        const socklet = data.socklet;
        const roomNumber = data.room_number || data.roomNumber;
        if (socklet === "cooperation_battle") {
            const connectionId = data.connection_id || data.connectionId || `${socket.remoteAddress}:${socket.remotePort}`;
            if (!roomNumber) {
                (0, disconnect_diagnostics_1.markTcpDisconnectReason)(socket, "handshake_denied");
                SessionManager_1.sessionManager.sendJson(socket, [3, "HANDSHAKE_DENIED"]);
                socket.end();
                return;
            }
            const roomId = String(roomNumber);
            // The battle handshake does not carry viewerId.  Resolve it from the
            // lobby connection that issued the same connection_id.  Leaving every
            // battle client as viewer 0 makes unrelated host/guest sockets look
            // like duplicate connections and causes one side to be replaced.
            // A connection id that no known room/battle seat issued cannot be
            // bound to a viewer, so it is never admitted as an anonymous seat.
            const identity = SessionManager_1.sessionManager.resolveBattleHandshakeIdentity(roomId, String(connectionId));
            const sourceBattleRoom = (0, manager_1.getRoom)(roomId);
            const sourceBattleId = sourceBattleRoom === null || sourceBattleRoom === void 0 ? void 0 : sourceBattleRoom.lifecycle.battleSessionId;
            const sourceBattleGeneration = sourceBattleRoom === null || sourceBattleRoom === void 0 ? void 0 : sourceBattleRoom.lobby_generation;
            if (!identity || !(yield (0, business_rpc_1.invokeRealtimeBusiness)("player.authorize", { viewerId: identity.viewerId, session: (_a = data.sp_session) !== null && _a !== void 0 ? _a : null }))) {
                connection_diagnostic_1.fiveBossConnectionDiagnostics.socketEvent(socket, "handshake_denied", identity ? "session_mismatch" : "unknown_connection");
                (0, disconnect_diagnostics_1.markTcpDisconnectReason)(socket, "handshake_denied");
                SessionManager_1.sessionManager.sendJson(socket, [3, "HANDSHAKE_DENIED"]);
                socket.end();
                return;
            }
            if (socket.destroyed || (0, manager_1.getRoom)(roomId) !== sourceBattleRoom
                || ((_b = (0, manager_1.getRoom)(roomId)) === null || _b === void 0 ? void 0 : _b.lifecycle.battleSessionId) !== sourceBattleId
                || ((_c = (0, manager_1.getRoom)(roomId)) === null || _c === void 0 ? void 0 : _c.lobby_generation) !== sourceBattleGeneration
                || ((_d = SessionManager_1.sessionManager.resolveBattleHandshakeIdentity(roomId, String(connectionId))) === null || _d === void 0 ? void 0 : _d.viewerId) !== identity.viewerId) {
                (0, disconnect_diagnostics_1.markTcpDisconnectReason)(socket, "handshake_denied");
                socket.end();
                return;
            }
            const battleClient = SessionManager_1.sessionManager.createClient(socket, identity.viewerId, roomId, String(connectionId), identity.playerId);
            const battleRoom = (0, manager_1.getRoom)(roomId);
            battleClient.roomGeneration = (_f = (_e = identity.roomGeneration) !== null && _e !== void 0 ? _e : battleRoom === null || battleRoom === void 0 ? void 0 : battleRoom.lobby_generation) !== null && _f !== void 0 ? _f : 0;
            if (battleRoom)
                connection_diagnostic_1.fiveBossConnectionDiagnostics.bind(battleRoom, battleClient);
            if (!battleRoom || battleRoom.lifecycle.phase !== "BATTLE" || !(0, multi_room_1.weaponRivenBattleSocketAllowed)(battleRoom, socket)) {
                connection_diagnostic_1.fiveBossConnectionDiagnostics.socketEvent(socket, "handshake_denied", "room_not_in_battle");
                (0, disconnect_diagnostics_1.markTcpDisconnectReason)(socket, "handshake_denied");
                SessionManager_1.sessionManager.sendJson(socket, [3, "HANDSHAKE_DENIED"]);
                socket.end();
                return;
            }
            if (battleRoom && (0, contract_1.isFiveBossGauntletQuest)(battleRoom.category, battleRoom.quest_id)
                && !(0, lobby_runtime_1.isFrozenFiveBossBattleClient)(battleRoom, battleClient)) {
                connection_diagnostic_1.fiveBossConnectionDiagnostics.socketEvent(socket, "handshake_denied", "frozen_identity_mismatch");
                (0, disconnect_diagnostics_1.markTcpDisconnectReason)(socket, "handshake_denied");
                SessionManager_1.sessionManager.sendJson(socket, [3, "HANDSHAKE_DENIED"]);
                socket.end();
                return;
            }
            if (battleClient.playerId !== null
                && ((_h = (_g = battleRoom === null || battleRoom === void 0 ? void 0 : battleRoom.five_boss_runtime) === null || _g === void 0 ? void 0 : _g.battleEnteredPlayerIds) === null || _h === void 0 ? void 0 : _h.includes(battleClient.playerId))) {
                battleClient.fiveBossBattleEntered = true;
            }
            battleClient.isBattle = true;
            if (!SessionManager_1.sessionManager.addBattleClient(String(connectionId), battleClient)) {
                connection_diagnostic_1.fiveBossConnectionDiagnostics.socketEvent(socket, "handshake_denied", "retired_seat");
                (0, disconnect_diagnostics_1.markTcpDisconnectReason)(socket, "handshake_denied");
                SessionManager_1.sessionManager.sendJson(socket, [3, "HANDSHAKE_DENIED"]);
                socket.end();
                return;
            }
            SessionManager_1.sessionManager.sendJson(socket, [0, roomNumber, ""]);
            return;
        }
        if (socklet === "cooperation_room") {
            const viewerId = data.viewerId;
            if (!viewerId || !roomNumber) {
                (0, disconnect_diagnostics_1.markTcpDisconnectReason)(socket, "handshake_denied");
                SessionManager_1.sessionManager.sendJson(socket, [3, "HANDSHAKE_DENIED"]);
                socket.end();
                return;
            }
            const roomId = String(roomNumber);
            if (!(0, manager_1.getRoom)(roomId)) {
                // CN does not ship the room_not_found UiString used by this denied
                // packet. A stale notice must never turn into client error C8601.
                (0, disconnect_diagnostics_1.markTcpDisconnectReason)(socket, "handshake_denied");
                SessionManager_1.sessionManager.sendJson(socket, [3, "HANDSHAKE_DENIED"]);
                socket.end();
                return;
            }
            // playerSocketAllowed above still performs the authoritative session
            // check. A context warmed by create/select_room can therefore be used
            // here without another synchronous session/player lookup.
            const sourceRoom = (0, manager_1.getRoom)(roomId);
            const sourceInstance = sourceRoom.lifecycle.instanceId, sourceGeneration = sourceRoom.lobby_generation;
            const sourceVersion = sourceRoom.lifecycle.version, sourceCategory = sourceRoom.category, sourceQuest = sourceRoom.quest_id;
            const facts = yield (0, business_rpc_1.invokeRealtimeBusiness)("player.handshake", {
                viewerId: Number(viewerId), session: (_j = data.sp_session) !== null && _j !== void 0 ? _j : null,
                category: sourceRoom.category, questId: sourceRoom.quest_id,
            });
            if (!facts || socket.destroyed || ((_k = (0, manager_1.getRoom)(roomId)) === null || _k === void 0 ? void 0 : _k.lifecycle.instanceId) !== sourceInstance
                || ((_l = (0, manager_1.getRoom)(roomId)) === null || _l === void 0 ? void 0 : _l.lobby_generation) !== sourceGeneration) {
                (0, disconnect_diagnostics_1.markTcpDisconnectReason)(socket, "handshake_denied");
                SessionManager_1.sessionManager.sendJson(socket, [3, "HANDSHAKE_DENIED"]);
                socket.end();
                return;
            }
            if (((_m = (0, manager_1.getRoom)(roomId)) === null || _m === void 0 ? void 0 : _m.lifecycle.version) !== sourceVersion || ((_o = (0, manager_1.getRoom)(roomId)) === null || _o === void 0 ? void 0 : _o.category) !== sourceCategory
                || ((_p = (0, manager_1.getRoom)(roomId)) === null || _p === void 0 ? void 0 : _p.quest_id) !== sourceQuest) {
                (0, disconnect_diagnostics_1.markTcpDisconnectReason)(socket, "handshake_denied");
                socket.end();
                return;
            }
            if (!(0, business_facts_1.applyPlayerBusinessFacts)(facts))
                throw new Error("PLAYER_HANDSHAKE_FACTS_STALE");
            const ctx = { playerId: facts.playerId, player: facts.player };
            // HTTP room selection and TCP connection are separate operations. Two
            // guests can pass the HTTP capacity check concurrently, so re-check the
            // live room atomically immediately before accepting this socket.
            const currentRoom = (0, manager_1.getRoom)(roomId);
            if (!currentRoom) {
                (0, disconnect_diagnostics_1.markTcpDisconnectReason)(socket, "handshake_denied");
                SessionManager_1.sessionManager.sendJson(socket, [3, "HANDSHAKE_DENIED"]);
                socket.end();
                return;
            }
            // A socket can emit close/error immediately before this handshake while
            // its indexed room client is still waiting for the event-loop cleanup.
            // Do not let that short race make a rescue room look full.
            const indexedClients = SessionManager_1.sessionManager.getClientsInRoom(roomId, currentRoom.lobby_generation)
                .filter(client => !client.isBattle);
            for (const indexedClient of indexedClients) {
                if (indexedClient.socket.destroyed
                    || !indexedClient.socket.readable
                    || !indexedClient.socket.writable) {
                    SessionManager_1.sessionManager.removeClient(indexedClient);
                }
            }
            const liveClients = SessionManager_1.sessionManager.getClientsInRoom(roomId, currentRoom.lobby_generation)
                .filter(client => !client.isBattle
                && !client.socket.destroyed
                && client.socket.readable
                && client.socket.writable);
            const liveViewerIds = new Set(liveClients.map(client => client.viewerId));
            const viewerAlreadyConnected = liveViewerIds.has(Number(viewerId));
            const requestedCategory = (_q = data.questCategory) !== null && _q !== void 0 ? _q : data.quest_category;
            const requestedQuestId = (_r = data.questId) !== null && _r !== void 0 ? _r : data.quest_id;
            const categoryMismatch = requestedCategory !== undefined
                && Number(requestedCategory) !== currentRoom.category;
            const questMismatch = requestedQuestId !== undefined
                && Number(requestedQuestId) !== currentRoom.quest_id;
            const isReturningMember = currentRoom.host_viewer_id === Number(viewerId)
                || currentRoom.expected_real_viewer_ids.includes(Number(viewerId))
                || currentRoom.mates.some(mate => mate.viewer_id === Number(viewerId));
            const waitingForExpectedMember = currentRoom.lobby_generation > 0
                && currentRoom.expected_real_viewer_ids.some(expectedViewerId => !liveViewerIds.has(expectedViewerId));
            const roomPhase = embedded_1.embeddedMultiCoordinator.ensureLifecycle(currentRoom).phase;
            const restoreBlocked = SessionManager_1.sessionManager.isRoomRestoreBlocked(roomId, Number(viewerId));
            const recordedPlayerId = (0, manager_1.getRoomMemberPlayerId)(currentRoom, Number(viewerId));
            const guestAdmissionIsRescue = !isReturningMember
                && admission_1.roomAdmissionRegistry.isRescue(roomId, currentRoom.lobby_generation, Number(viewerId));
            const guestEligibility = !isReturningMember
                ? facts.guestEligibility
                : null;
            const structuralReasons = [
                categoryMismatch ? "category_mismatch" : "",
                questMismatch ? "quest_mismatch" : "",
                recordedPlayerId !== null && recordedPlayerId !== ctx.playerId ? "player_mismatch" : "",
                !viewerAlreadyConnected && liveClients.length >= 3 ? "full" : "",
                !isReturningMember && (roomPhase === "STARTING" || roomPhase === "BATTLE") ? "battle_started" : "",
                !isReturningMember && waitingForExpectedMember ? "waiting_for_returning_member" : "",
                (guestEligibility === null || guestEligibility === void 0 ? void 0 : guestEligibility.allowed) === false
                    ? `${guestAdmissionIsRescue ? "rescue" : "guest"}_${guestEligibility.reason}`
                    : "",
                restoreBlocked ? "restore_blocked" : "",
            ].filter(Boolean);
            if (structuralReasons.length > 0) {
                for (const reason of structuralReasons)
                    (0, admission_1.recordRoomAdmissionDenial)(reason);
                console.warn(`[TCP] room handshake unavailable: viewer=${viewerId} room=${roomId}`
                    + ` live=${liveClients.length} state=${currentRoom.raising_state}`
                    + ` reason=${structuralReasons.join(",")}`);
                admission_1.roomAdmissionRegistry.release(roomId, Number(viewerId));
                // Normal stale/full cases are filtered before the TCP handshake.
                // Keep a protocol-level race fallback without looking up a missing
                // CN UiString key (room_full/room_not_found both cause C8601).
                (0, disconnect_diagnostics_1.markTcpDisconnectReason)(socket, "handshake_denied");
                SessionManager_1.sessionManager.sendJson(socket, [3, "HANDSHAKE_DENIED"]);
                socket.end();
                return;
            }
            const { playerId, player } = ctx;
            const connectionId = String(data.connection_id || data.connectionId || `${socket.remoteAddress}:${socket.remotePort}`);
            // The HTTP room-selection path primes this snapshot before opening the
            // socket. Direct legacy clients still get a safe synchronous fallback,
            // but normal handshakes now stay on the in-memory path.
            const party = facts.party;
            if (isReturningMember)
                (0, admission_1.recordRoomAdmissionBypass)("returning_member");
            const admissionClaim = isReturningMember
                ? null
                : admission_1.roomAdmissionRegistry.claim(roomId, currentRoom.lobby_generation, Number(viewerId), connectionId);
            if ((admissionClaim === null || admissionClaim === void 0 ? void 0 : admissionClaim.ok) === false) {
                console.warn(`[TCP] room handshake unavailable: viewer=${viewerId} room=${roomId}`
                    + ` live=${liveClients.length} state=${currentRoom.raising_state}`
                    + ` reason=not_reserved_${admissionClaim.reason}`);
                (0, disconnect_diagnostics_1.markTcpDisconnectReason)(socket, "handshake_denied");
                SessionManager_1.sessionManager.sendJson(socket, [3, "HANDSHAKE_DENIED"]);
                socket.end();
                return;
            }
            const client = SessionManager_1.sessionManager.createClient(socket, Number(viewerId), roomId, connectionId, playerId);
            client.roomGeneration = currentRoom.lobby_generation;
            client.admissionClaimed = (admissionClaim === null || admissionClaim === void 0 ? void 0 : admissionClaim.ok) === true;
            client.admissionGeneration = (admissionClaim === null || admissionClaim === void 0 ? void 0 : admissionClaim.ok) === true
                ? currentRoom.lobby_generation
                : undefined;
            client.clientState.tryTransition(types_1.ClientState.Handshaking);
            const yourSelf = {
                viewerId: Number(viewerId),
                playerId: playerId,
                name: player.name,
                rank: player.rank,
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
            };
            client.yourself = yourSelf;
            SessionManager_1.sessionManager.addClientToRoom(client);
            SessionManager_1.sessionManager.sendJson(socket, [0, connectionId, roomNumber]);
            return;
        }
        // Unknown socklet
        (0, disconnect_diagnostics_1.markTcpDisconnectReason)(socket, "handshake_denied");
        SessionManager_1.sessionManager.sendJson(socket, [1, "DENIED"]);
        socket.end();
    });
}
exports.handleHandshake = handleHandshake;
