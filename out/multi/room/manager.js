"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateHostEntryTime = exports.disbandRoom = exports.setRoomBattle = exports.getRoomMemberPlayerId = exports.removeRoomMember = exports.addRoomMember = exports.getRoomAcceptedSeatCount = exports.isRoomMember = exports.getRooms = exports.getRoomsHostedBy = exports.getRoomByToken = exports.getRoom = exports.createRoom = exports.isRoomWaitingForExpectedMember = exports.generateRoomAccessToken = exports.generateRoomNumber = void 0;
const crypto_1 = require("crypto");
const types_1 = require("../../lib/types");
const utils_1 = require("../../utils");
const SessionManager_1 = require("../state/SessionManager");
const game_logging_1 = require("../../lib/game-logging");
const admission_1 = require("./admission");
const embedded_1 = require("../coordinator/embedded");
const assets_1 = require("../../lib/assets");
const connection_diagnostic_1 = require("../five-boss/connection-diagnostic");
const memory_diagnostics_1 = require("../../lib/memory-diagnostics");
const rematch_roster_1 = require("./rematch-roster");
const runtime_role_1 = require("../coordinator/runtime-role");
const room_start_claims_1 = require("../coordinator/room-start-claims");
const rooms = new Map();
// access_token -> room_number. Tokens are random and never reassigned, so a
// direct index replaces scanning every room per token lookup.
const roomNumbersByToken = new Map();
(0, memory_diagnostics_1.registerMemoryCounters)("rooms", detailed => {
    var _a;
    if (!detailed)
        return { total: rooms.size };
    const counts = { total: rooms.size, lobby: 0, battle: 0, returning: 0, other: 0 };
    for (const room of rooms.values()) {
        const phase = (_a = room.lifecycle) === null || _a === void 0 ? void 0 : _a.phase;
        const key = phase === "LOBBY" ? "lobby" : phase === "BATTLE" ? "battle" : phase === "RETURNING" ? "returning" : "other";
        counts[key]++;
    }
    return counts;
});
let roomSequence = 1;
const INCOMPLETE_EXPIRY_MS = parseInt(process.env.MULTI_ROOM_INCOMPLETE_EXPIRY_MS || "600000"); // 10min, mates < 3
const FULL_ROOM_EXPIRY_MS = parseInt(process.env.MULTI_ROOM_FULL_EXPIRY_MS || "1800000"); // 30min, mates >= 3
const CLEAN_INTERVAL_MS = parseInt(process.env.MULTI_ROOM_CLEAN_INTERVAL_MS || "60000");
const REMAINING_NOTIFY_MS = 30000; // send RemainingTime float 30s before disband
// Track which rooms have already been notified (to avoid repeat floats)
const notifiedRooms = new Set();
function cleanExpiredRooms() {
    for (const [roomNumber, room] of rooms) {
        const lifecycle = embedded_1.embeddedMultiCoordinator.ensureLifecycle(room);
        // Battle and settlement rooms are governed by their own watchdogs.
        // Skip them before allocating a Promise chain every cleanup tick.
        if (lifecycle.phase !== "LOBBY")
            continue;
        const instanceId = lifecycle.instanceId;
        const lifecycleVersion = lifecycle.version;
        void embedded_1.embeddedMultiCoordinator.enqueueRoomCommand(roomNumber, () => {
            const current = rooms.get(roomNumber);
            if (!embedded_1.embeddedMultiCoordinator.isCurrentInstance(current, instanceId)
                || current.lifecycle.version !== lifecycleVersion)
                return;
            // Only an ordinary lobby uses idle expiry. Battle and settlement
            // phases have their own watchdogs and grace periods.
            if (current.lifecycle.phase !== "LOBBY")
                return;
            const now = Date.now();
            const timeOffset = now - (0, utils_1.getServerTime)() * 1000;
            const idleAge = now - (current.host_entry_time * 1000 + timeOffset);
            const timeout = current.mates.length < 3 ? INCOMPLETE_EXPIRY_MS : FULL_ROOM_EXPIRY_MS;
            const remaining = timeout - idleAge;
            if (remaining > 0 && remaining <= REMAINING_NOTIFY_MS && !notifiedRooms.has(roomNumber)) {
                SessionManager_1.sessionManager.broadcastToRoom(roomNumber, [1, [7, Math.ceil(remaining / 1000)]]);
                notifiedRooms.add(roomNumber);
                (0, game_logging_1.gameVerboseLog)(() => `[MULTI] RemainingTime sent: room=${roomNumber} seconds=${Math.ceil(remaining / 1000)}`);
            }
            if (idleAge > timeout && SessionManager_1.sessionManager.commitRoomDisband(roomNumber, "room_expired")) {
                notifiedRooms.delete(roomNumber);
            }
        }).catch(error => console.error(`[MULTI] room cleanup failed: room=${roomNumber}`, error));
    }
}
const cleanupTimer = setInterval(cleanExpiredRooms, CLEAN_INTERVAL_MS);
cleanupTimer.unref();
function generateRoomNumber() {
    for (let attempt = 0; attempt < 100; attempt += 1) {
        const roomNumber = String((0, crypto_1.randomInt)(100000, 1000000));
        if (!rooms.has(roomNumber))
            return roomNumber;
    }
    throw new Error("Unable to allocate a unique multiplayer room number");
}
exports.generateRoomNumber = generateRoomNumber;
function generateRoomAccessToken() {
    for (let attempt = 0; attempt < 100; attempt += 1) {
        const token = (0, crypto_1.randomBytes)(24).toString("base64url");
        if (!getRoomByToken(token))
            return token;
    }
    throw new Error("Unable to allocate a unique multiplayer room token");
}
exports.generateRoomAccessToken = generateRoomAccessToken;
function isRoomWaitingForExpectedMember(room) {
    if (room.lobby_generation <= 0 || room.expected_real_viewer_ids.length === 0) {
        return false;
    }
    const liveViewerIds = new Set(SessionManager_1.sessionManager.getClientsInRoom(room.room_number, room.lobby_generation)
        .filter(client => !client.isBattle
        && !client.socket.destroyed
        && client.socket.readable
        && client.socket.writable)
        .map(client => client.viewerId));
    return room.expected_real_viewer_ids.some(viewerId => !liveViewerIds.has(viewerId));
}
exports.isRoomWaitingForExpectedMember = isRoomWaitingForExpectedMember;
function createRoom(hostViewerId, hostPlayerId, hostPartyId, category, questId, acceptedType, hostMainCharacterId, isNpcMode = false) {
    (0, runtime_role_1.assertRealtimeAuthority)();
    const roomNumber = generateRoomNumber();
    const room = {
        room_number: roomNumber,
        access_token: generateRoomAccessToken(),
        category,
        quest_id: questId,
        host_viewer_id: hostViewerId,
        host_player_id: hostPlayerId,
        host_party_id: hostPartyId,
        host_main_character_id: hostMainCharacterId,
        accepted_type: acceptedType,
        created_at: Date.now(),
        raising_state: 2,
        room_sequence: roomSequence++,
        host_entry_time: (0, utils_1.getServerTime)(),
        member_viewer_ids: [hostViewerId],
        member_player_ids: { [hostViewerId]: hostPlayerId },
        mates: [],
        share_room_options: 0,
        is_npc_mode: isNpcMode,
        npc_count: 0,
        rematch_ai_count: 0,
        npc_party_by_com_id: {},
        expected_real_viewer_ids: [],
        lobby_generation: 0,
        rematch_wait_started_at: null,
        settlement_return_pending: false,
        lifecycle: embedded_1.embeddedMultiCoordinator.createLifecycle(),
    };
    rooms.set(roomNumber, room);
    roomNumbersByToken.set(room.access_token, roomNumber);
    (0, game_logging_1.gameVerboseLog)(() => `[MULTI] room created: ${roomNumber} host=${hostViewerId} category=${category} quest=${questId}`);
    return room;
}
exports.createRoom = createRoom;
function getRoom(roomNumber) {
    (0, runtime_role_1.assertRealtimeAuthority)();
    const room = rooms.get(roomNumber);
    if (!room)
        (0, game_logging_1.gameVerboseLog)(() => `[MULTI] room not found: ${roomNumber}`);
    return room;
}
exports.getRoom = getRoom;
function getRoomByToken(token) {
    (0, runtime_role_1.assertRealtimeAuthority)();
    if (typeof token !== "string" || token.length === 0)
        return undefined;
    const roomNumber = roomNumbersByToken.get(token);
    if (roomNumber === undefined)
        return undefined;
    const room = rooms.get(roomNumber);
    return (room === null || room === void 0 ? void 0 : room.access_token) === token ? room : undefined;
}
exports.getRoomByToken = getRoomByToken;
/** Rooms whose host is the given viewer (used when that host creates a new room). */
function getRoomsHostedBy(hostViewerId) {
    (0, runtime_role_1.assertRealtimeAuthority)();
    const result = [];
    for (const room of rooms.values()) {
        if (room.host_viewer_id === hostViewerId)
            result.push(room);
    }
    return result;
}
exports.getRoomsHostedBy = getRoomsHostedBy;
function getRoomEventId(room) {
    const quest = (0, assets_1.getQuestFromCategorySync)(room.category, room.quest_id);
    if ((quest === null || quest === void 0 ? void 0 : quest.eventId) !== undefined)
        return quest.eventId;
    if ((room.category === types_1.QuestCategory.ADVENT_EVENT_SINGLE
        || room.category === types_1.QuestCategory.ADVENT_EVENT_MULTI)
        && Number.isSafeInteger(room.quest_id)
        && room.quest_id >= 1000) {
        return Math.trunc(room.quest_id / 1000);
    }
    return undefined;
}
function getRooms(categoryId, eventId) {
    (0, runtime_role_1.assertRealtimeAuthority)();
    const result = [];
    for (const room of rooms.values()) {
        if (room.category !== categoryId)
            continue;
        if (eventId !== undefined) {
            const roomEventId = getRoomEventId(room);
            // Legacy advent tables encode the event in the quest's thousands
            // group instead of storing eventId explicitly. Other old tables
            // without either form remain visible for backward compatibility.
            if (roomEventId !== undefined && roomEventId !== Number(eventId))
                continue;
        }
        result.push(room);
    }
    return result;
}
exports.getRooms = getRooms;
function isRoomMember(room, viewerId) {
    var _a, _b, _c;
    if (((_a = room.lifecycle) === null || _a === void 0 ? void 0 : _a.phase) === "DISBANDED")
        return false;
    if ((_b = room.member_viewer_ids) === null || _b === void 0 ? void 0 : _b.includes(viewerId))
        return true;
    if (room.host_viewer_id === viewerId)
        return true;
    if (((_c = room.lifecycle) === null || _c === void 0 ? void 0 : _c.phase) === "BATTLE" && (0, rematch_roster_1.getFrozenRematchViewerIds)(room).includes(viewerId))
        return true;
    return (0, rematch_roster_1.getReservedReturnViewerIds)(room).includes(viewerId);
}
exports.isRoomMember = isRoomMember;
/**
 * Accepted lobby seats: real members plus COM (AI) mates. COM seats occupy
 * the room like real ones, so a stranger can take a genuinely empty seat but
 * cannot replace an AI that was filled or restored for a missing member.
 * The roster length and the recorded counters can briefly disagree while the
 * lobby is rebuilt, so the larger value wins.
 */
function getRoomAcceptedSeatCount(room) {
    const rosterSeats = Array.isArray(room.mates) ? room.mates.length : 0;
    const realSeats = Array.isArray(room.member_viewer_ids) && room.member_viewer_ids.length > 0
        ? room.member_viewer_ids.length
        : 1;
    const recordedSeats = realSeats + Math.max(0, Number(room.npc_count) || 0);
    return Math.max(rosterSeats, recordedSeats);
}
exports.getRoomAcceptedSeatCount = getRoomAcceptedSeatCount;
function addRoomMember(roomNumber, viewerId, playerId) {
    (0, runtime_role_1.assertRealtimeAuthority)();
    const room = rooms.get(roomNumber);
    if (!room)
        return false;
    if (!room.member_viewer_ids.includes(viewerId))
        room.member_viewer_ids.push(viewerId);
    room.member_player_ids[viewerId] = playerId;
    (0, rematch_roster_1.markMemberReturned)(room, viewerId);
    return true;
}
exports.addRoomMember = addRoomMember;
function removeRoomMember(roomNumber, viewerId, expectedGeneration) {
    (0, runtime_role_1.assertRealtimeAuthority)();
    const room = rooms.get(roomNumber);
    if (!room || viewerId === room.host_viewer_id || room.lifecycle.phase !== "LOBBY"
        || (expectedGeneration !== undefined && expectedGeneration !== room.lobby_generation))
        return false;
    let changed = false;
    const index = room.member_viewer_ids.indexOf(viewerId);
    if (index >= 0) {
        room.member_viewer_ids.splice(index, 1);
        changed = true;
    }
    if (room.member_player_ids[viewerId] !== undefined) {
        delete room.member_player_ids[viewerId];
        changed = true;
    }
    // This operation is used only after an intentional leave or an expired
    // reconnect grace. Release every retained rematch reference together so
    // an AI replacement is not still blocked by the previous real viewer.
    const expectedCount = room.expected_real_viewer_ids.length;
    room.expected_real_viewer_ids = room.expected_real_viewer_ids
        .filter(expectedViewerId => expectedViewerId !== viewerId);
    if (room.expected_real_viewer_ids.length !== expectedCount)
        changed = true;
    const mateCount = room.mates.length;
    room.mates = room.mates.filter(mate => mate.viewer_id !== viewerId);
    if (room.mates.length !== mateCount)
        changed = true;
    (0, rematch_roster_1.forgetReturnReservation)(room, viewerId);
    return changed;
}
exports.removeRoomMember = removeRoomMember;
function getRoomMemberPlayerId(room, viewerId) {
    var _a, _b;
    const recordedMemberPlayerId = (_a = room.member_player_ids) === null || _a === void 0 ? void 0 : _a[viewerId];
    if (recordedMemberPlayerId)
        return recordedMemberPlayerId;
    if (room.host_viewer_id === viewerId)
        return room.host_player_id;
    const recordedMate = room.mates.find(mate => mate.viewer_id === viewerId);
    if (recordedMate === null || recordedMate === void 0 ? void 0 : recordedMate.player_id)
        return recordedMate.player_id;
    const liveClient = SessionManager_1.sessionManager.getClientsInRoom(room.room_number, room.lobby_generation)
        .find(client => !client.isBattle && client.viewerId === viewerId);
    return (_b = liveClient === null || liveClient === void 0 ? void 0 : liveClient.playerId) !== null && _b !== void 0 ? _b : null;
}
exports.getRoomMemberPlayerId = getRoomMemberPlayerId;
function setRoomBattle(roomNumber) {
    (0, runtime_role_1.assertRealtimeAuthority)();
    const room = rooms.get(roomNumber);
    if (!room)
        return false;
    const lifecycle = embedded_1.embeddedMultiCoordinator.ensureLifecycle(room);
    if (lifecycle.phase === "BATTLE")
        return true;
    return embedded_1.embeddedMultiCoordinator.commitBattleStart(room).ok;
}
exports.setRoomBattle = setRoomBattle;
function disbandRoom(roomNumber, reason = "room_manager_delete") {
    (0, runtime_role_1.assertRealtimeAuthority)();
    const room = rooms.get(roomNumber);
    if (room && (0, room_start_claims_1.hasRoomStartClaims)(room))
        return false;
    if (room)
        (0, rematch_roster_1.clearRematchReturnReservations)(room);
    if (room)
        connection_diagnostic_1.fiveBossConnectionDiagnostics.roomEvent(roomNumber, "room_disband", reason);
    if (room)
        embedded_1.embeddedMultiCoordinator.commitDisband(room, reason);
    const deleted = rooms.delete(roomNumber);
    if (room && roomNumbersByToken.get(room.access_token) === roomNumber) {
        roomNumbersByToken.delete(room.access_token);
    }
    if (deleted) {
        (0, game_logging_1.gameVerboseLog)(() => `[MULTI] room deleted: ${roomNumber}`);
        admission_1.roomAdmissionRegistry.clearRoom(roomNumber);
        try {
            const { stopRandomRecruitment } = require("../recruitment");
            stopRandomRecruitment(roomNumber);
        }
        catch (e) { }
        SessionManager_1.sessionManager.removeRoomState(roomNumber);
        notifiedRooms.delete(roomNumber);
    }
    return deleted;
}
exports.disbandRoom = disbandRoom;
function updateHostEntryTime(roomNumber) {
    (0, runtime_role_1.assertRealtimeAuthority)();
    const room = rooms.get(roomNumber);
    if (!room)
        return false;
    room.host_entry_time = (0, utils_1.getServerTime)();
    return true;
}
exports.updateHostEntryTime = updateHostEntryTime;
