"use strict";
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
exports.registerLobbyCommandHandlers = void 0;
const types_1 = require("../../lib/types");
const manager_1 = require("../room/manager");
const SessionManager_1 = require("../state/SessionManager");
const admission_1 = require("../room/admission");
const battle_contract_1 = require("../state/battle-contract");
const recruitment_1 = require("../recruitment");
const select_denial_1 = require("../room/select-denial");
const embedded_1 = require("./embedded");
const runtime_role_1 = require("./runtime-role");
const business_facts_1 = require("./business-facts");
function currentViewers(room) {
    var _a;
    const viewers = new Set((_a = room.member_viewer_ids) !== null && _a !== void 0 ? _a : [room.host_viewer_id]);
    for (const client of SessionManager_1.sessionManager.getClientsInRoom(room.room_number, room.lobby_generation)) {
        if (!client.isBattle && !client.socket.destroyed && client.socket.readable && client.socket.writable)
            viewers.add(client.viewerId);
    }
    return viewers;
}
function returning(room, viewerId) {
    return room.host_viewer_id === viewerId || room.expected_real_viewer_ids.includes(viewerId)
        || room.mates.some(mate => mate.viewer_id === viewerId);
}
function project(room, viewerId) {
    const lifecycle = embedded_1.embeddedMultiCoordinator.ensureLifecycle(room);
    return {
        access_token: room.access_token, category: room.category, host_entry_time: room.host_entry_time,
        host_main_character_id: room.host_main_character_id, host_player_id: room.host_player_id,
        host_viewer_id: room.host_viewer_id, is_npc_mode: room.is_npc_mode, quest_id: room.quest_id,
        raising_state: room.raising_state, room_number: room.room_number,
        share_room_options: room.share_room_options, room_sequence: room.room_sequence, mateCount: room.mates.length,
        identity: Object.assign(Object.assign({}, (0, battle_contract_1.captureRoomCommandIdentity)(room)), { version: lifecycle.version }), phase: lifecycle.phase,
        hostOnline: SessionManager_1.sessionManager.isHostOnline(room.host_viewer_id, room.room_number, room.lobby_generation),
        occupancy: admission_1.roomAdmissionRegistry.getOccupancy(room.room_number, room.lobby_generation, currentViewers(room)),
        acceptedSeatCount: (0, manager_1.getRoomAcceptedSeatCount)(room), returningMember: returning(room, viewerId),
        restoreBlocked: SessionManager_1.sessionManager.isRoomRestoreBlocked(room.room_number, viewerId),
        waitingForExpectedMember: (0, manager_1.isRoomWaitingForExpectedMember)(room),
    };
}
function idle(room) {
    return embedded_1.embeddedMultiCoordinator.ensureLifecycle(room).phase === "LOBBY"
        && !room.settlement_return_pending && !SessionManager_1.sessionManager.hasRoomConnections(room.room_number);
}
function cleanupHosted(viewerId, context) {
    return __awaiter(this, void 0, void 0, function* () {
        let removed = 0;
        for (const room of (0, manager_1.getRoomsHostedBy)(viewerId)) {
            if (!idle(room))
                continue;
            const identity = Object.assign(Object.assign({}, (0, battle_contract_1.captureRoomCommandIdentity)(room)), { version: room.lifecycle.version });
            yield embedded_1.embeddedMultiCoordinator.enqueueRoomCommand(room.room_number, () => {
                if (context.remainingMs() <= 0)
                    throw new Error("Lobby cleanup command expired before mutation");
                const current = (0, manager_1.getRoom)(room.room_number);
                if (!(0, battle_contract_1.roomCommandIdentityMatches)(current, identity) || current.host_viewer_id !== viewerId || !idle(current))
                    return;
                if (SessionManager_1.sessionManager.commitRoomDisband(room.room_number, "host_created_new_room"))
                    removed++;
            });
        }
        return removed;
    });
}
function registerLobbyCommandHandlers(executor) {
    executor.register("lobby.query", raw => {
        const p = raw;
        const room = p.roomNumber ? (0, manager_1.getRoom)(p.roomNumber) : (0, manager_1.getRoomByToken)(p.accessToken || "");
        return room ? project(room, p.viewerId) : null;
    });
    executor.register("lobby.list", raw => {
        var _a, _b;
        const p = raw;
        const categories = (_a = p.categories) !== null && _a !== void 0 ? _a : Object.values(types_1.QuestCategory).filter((value) => typeof value === "number");
        const all = [...new Set(categories)].flatMap(category => (0, manager_1.getRooms)(category, p.eventId))
            .filter(room => !p.onlyRecruiting || (0, recruitment_1.isRandomRecruiting)(room.room_number));
        const throughSequence = (_b = p.throughSequence) !== null && _b !== void 0 ? _b : all.reduce((max, room) => Math.max(max, room.room_sequence), 0);
        const remaining = all.filter(room => { var _a; return room.room_sequence > ((_a = p.afterSequence) !== null && _a !== void 0 ? _a : 0) && room.room_sequence <= throughSequence; })
            .sort((a, b) => p.onlyRecruiting ? b.room_sequence - a.room_sequence : a.room_sequence - b.room_sequence);
        const page = remaining.slice(0, 64);
        return { rooms: page.map(room => project(room, p.viewerId)), throughSequence,
            nextSequence: !p.onlyRecruiting && remaining.length > page.length ? page[page.length - 1].room_sequence : null };
    });
    executor.register("lobby.cleanupHosted", (raw, context) => cleanupHosted(raw.viewerId, context));
    executor.register("lobby.create", (raw, context) => __awaiter(this, void 0, void 0, function* () {
        const p = raw;
        if (Number(p.category) === 20)
            throw new Error("TOWER_DUNGEON_SINGLE_ONLY");
        const scope = { category: p.category, questId: p.questId, partyId: p.partyId };
        if ((0, runtime_role_1.isRealtimeOwnerChild)())
            yield (0, business_facts_1.refreshRealtimePlayerFacts)(p.playerId, scope);
        const assertHostFacts = () => {
            if (context.remainingMs() <= 0)
                throw new Error("Lobby create command expired before mutation");
            if (!(0, runtime_role_1.isRealtimeOwnerChild)())
                return;
            const facts = (0, business_facts_1.getPlayerBusinessFacts)(p.playerId, scope);
            if (!facts || facts.playerId !== p.playerId || !facts.questPolicy.hostAllowed)
                throw new Error("LOBBY_HOST_FACTS_UNAVAILABLE");
        };
        // The parent-authenticated viewer/player pair is immutable command input.
        // Refresh through business RPC before deleting old rooms or publishing a new one.
        assertHostFacts();
        yield cleanupHosted(p.viewerId, context);
        assertHostFacts();
        const room = (0, manager_1.createRoom)(p.viewerId, p.playerId, p.partyId, p.category, p.questId, 0, p.profileMainCharacterId);
        return project(room, p.viewerId);
    }));
    executor.register("lobby.select", (raw, context) => {
        const p = raw;
        return embedded_1.embeddedMultiCoordinator.enqueueRoomCommand(p.roomNumber, () => {
            if (context.remainingMs() <= 0)
                return { status: "expired" };
            const room = p.identity ? (0, manager_1.getRoom)(p.roomNumber) : undefined;
            if (room && !(0, battle_contract_1.roomCommandIdentityMatches)(room, p.identity))
                return { status: "stale" };
            if (!room)
                return { status: "denied", raisingState: (0, select_denial_1.getSelectRoomDenialRaisingState)({ battleStarted: false, roomFull: false }), roomNumber: p.roomNumber };
            const member = returning(room, p.viewerId);
            const randomRescue = !member && p.rescueSelection && (0, recruitment_1.wasRandomRecruitmentDeliveredTo)(room.room_number, p.viewerId);
            const staleNotice = !member && p.rescueSelection && (0, recruitment_1.wasStoppedRandomRecruitmentDeliveredTo)(room.room_number, p.viewerId)
                && (room.is_npc_mode || !(0, recruitment_1.isRandomRecruiting)(room.room_number));
            const battleStarted = !member && ["STARTING", "BATTLE"].includes(embedded_1.embeddedMultiCoordinator.ensureLifecycle(room).phase);
            const waiting = !member && (0, manager_1.isRoomWaitingForExpectedMember)(room);
            const full = !member && (0, manager_1.getRoomAcceptedSeatCount)(room) >= 3;
            const unavailable = Number(p.category) === 20 || Number(room.category) === 20
                || p.category !== Number(room.category) || p.questId !== room.quest_id || p.mode15Closed
                || (!member && (battleStarted || waiting || full || staleNotice || (p.rescueSelection && !randomRescue) || !p.guestAllowed));
            const blocked = SessionManager_1.sessionManager.isRoomRestoreBlocked(room.room_number, p.viewerId);
            const capacityDenied = !member && !unavailable && !blocked && !admission_1.roomAdmissionRegistry.reserve(room.room_number, room.lobby_generation, p.viewerId, currentViewers(room), 3, Date.now(), randomRescue ? "rescue" : "direct");
            if (unavailable || blocked || capacityDenied) {
                if (!member)
                    admission_1.roomAdmissionRegistry.release(room.room_number, p.viewerId);
                return { status: "denied", raisingState: (0, select_denial_1.getSelectRoomDenialRaisingState)({ battleStarted, roomFull: waiting || full || capacityDenied }), roomNumber: room.room_number };
            }
            if (randomRescue || (!member && p.mode15Helper))
                SessionManager_1.sessionManager.markRescueGuest(room.room_number, p.viewerId, p.hostNewbie, randomRescue);
            if (randomRescue)
                (0, recruitment_1.acceptRandomRecruitmentForViewer)(room.room_number, p.viewerId);
            const result = project(room, p.viewerId);
            if (p.viewerId === room.host_viewer_id)
                result.raising_state = 1;
            else if (!result.hostOnline)
                result.raising_state = 2;
            return { status: "ready", room: result };
        });
    });
    executor.register("lobby.attention.take", raw => {
        const p = raw;
        const eligible = new Map(p.eligible.map(item => [item.roomNumber, item.identity]));
        // The selection and delivery record update run synchronously on the owner.
        return (0, recruitment_1.takeRandomRecruitments)(p.viewerId, p.limit, recruitment => {
            const room = (0, manager_1.getRoom)(recruitment.roomNumber), identity = eligible.get(recruitment.roomNumber);
            if (!room || !identity || !(0, battle_contract_1.roomCommandIdentityMatches)(room, identity))
                return false;
            const state = project(room, p.viewerId);
            return room.host_viewer_id !== p.viewerId && !room.is_npc_mode && state.hostOnline
                && !["STARTING", "BATTLE"].includes(state.phase) && !state.waitingForExpectedMember && state.occupancy < 3;
        }).map(recruitment => ({ attentionKey: recruitment.attentionKey, room: project((0, manager_1.getRoom)(recruitment.roomNumber), p.viewerId) }));
    });
}
exports.registerLobbyCommandHandlers = registerLobbyCommandHandlers;
