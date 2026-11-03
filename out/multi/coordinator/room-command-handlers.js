"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerRoomCommandHandlers = void 0;
const manager_1 = require("../room/manager");
const SessionManager_1 = require("../state/SessionManager");
const battle_contract_1 = require("../state/battle-contract");
const embedded_1 = require("./embedded");
const recruitment_1 = require("../recruitment");
const ai_fill_1 = require("../ai-fill");
const sharing_1 = require("../room/sharing");
function connectionState(room) {
    return {
        category_id: Number(room.category), host_entry_time: room.host_entry_time,
        quest_id: room.quest_id, raising_state: room.raising_state,
        room_number: room.room_number, room_sequence: room.room_sequence,
        share_room_options: room.share_room_options,
    };
}
function projection(room) {
    return {
        room_number: room.room_number, category: room.category, quest_id: room.quest_id,
        host_viewer_id: room.host_viewer_id, host_player_id: room.host_player_id,
        host_main_character_id: room.host_main_character_id, host_entry_time: room.host_entry_time,
        identity: Object.assign(Object.assign({}, (0, battle_contract_1.captureRoomCommandIdentity)(room)), { version: room.lifecycle.version }),
    };
}
function decide(payload, context, operation) {
    return embedded_1.embeddedMultiCoordinator.enqueueRoomCommand(payload.roomNumber, () => {
        if (context.remainingMs() <= 0)
            return { status: "expired" };
        // Observing no room never authorizes a newly created instance.
        if (!payload.identity)
            return { status: "missing" };
        const room = (0, manager_1.getRoom)(payload.roomNumber);
        if (!room)
            return { status: "missing" };
        if (!(0, battle_contract_1.roomCommandIdentityMatches)(room, payload.identity))
            return { status: "stale" };
        return operation(room);
    });
}
function unavailable(room, payload) {
    if (Number(room.category) === 20 || Number(payload.category) === 20)
        return { status: "quest_mismatch" };
    if (payload.mode15Closed)
        return { status: "mode15_closed" };
    if (SessionManager_1.sessionManager.isRoomRestoreBlocked(room.room_number, payload.viewerId))
        return { status: "restore_blocked" };
    return null;
}
function questMismatch(room, payload) {
    return Number(room.category) === 20 || Number(payload.category) === 20 || payload.category !== Number(room.category) || payload.questId !== room.quest_id;
}
function registerRoomCommandHandlers(executor) {
    executor.register("room.query", raw => {
        const lookup = raw;
        // This pure read and its projection are one owner-local synchronous
        // operation. Queuing another lookup could silently retarget a request
        // to a replacement instance before its mutation captures the fence.
        const room = lookup.roomNumber ? (0, manager_1.getRoom)(lookup.roomNumber) : (0, manager_1.getRoomByToken)(lookup.accessToken || "");
        return room ? projection(room) : null;
    });
    executor.register("room.prepare", (raw, context) => {
        const payload = raw;
        return decide(payload, context, room => {
            const denied = unavailable(room, payload);
            if (denied)
                return denied;
            if (questMismatch(room, payload))
                return { status: "quest_mismatch" };
            if (payload.viewerId === room.host_viewer_id)
                (0, manager_1.updateHostEntryTime)(room.room_number);
            if (payload.assetStale)
                SessionManager_1.sessionManager.markStaleAssetViewer(room.room_number, payload.viewerId);
            const connection = connectionState(room);
            if (payload.viewerId === room.host_viewer_id)
                connection.raising_state = 1;
            else if (!SessionManager_1.sessionManager.isHostOnline(room.host_viewer_id, room.room_number, room.lobby_generation))
                connection.raising_state = 2;
            return { status: "ready", connection };
        });
    });
    executor.register("room.restore", (raw, context) => {
        const payload = raw;
        return decide(payload, context, room => {
            const denied = unavailable(room, payload);
            if (denied)
                return denied;
            if (payload.assetStale)
                SessionManager_1.sessionManager.markStaleAssetViewer(room.room_number, payload.viewerId);
            const connection = connectionState(room);
            if (!(0, manager_1.isRoomMember)(room, payload.viewerId))
                connection.raising_state = 13;
            else if (room.lifecycle.phase !== "BATTLE") {
                if (payload.viewerId === room.host_viewer_id)
                    connection.raising_state = 1;
                else if (!SessionManager_1.sessionManager.isHostOnline(room.host_viewer_id, room.room_number, room.lobby_generation))
                    connection.raising_state = 2;
            }
            return { status: "ready", connection };
        });
    });
    executor.register("room.summon", (raw, context) => {
        const payload = raw;
        return decide(payload, context, room => {
            const denied = unavailable(room, payload);
            if (denied)
                return denied;
            if (payload.viewerId !== room.host_viewer_id)
                return { status: "forbidden" };
            if (questMismatch(room, payload))
                return { status: "quest_mismatch" };
            return { status: "summon", category: room.category, npcMode: room.is_npc_mode };
        });
    });
    executor.register("room.share", (raw, context) => {
        const payload = raw;
        return decide(payload, context, room => {
            if (payload.viewerId !== room.host_viewer_id)
                return { status: "forbidden" };
            if (Number(room.category) === 20 || Number(payload.category) === 20
                || (payload.category !== undefined && payload.category !== Number(room.category))
                || (payload.questId !== undefined && payload.questId !== room.quest_id))
                return { status: "quest_mismatch" };
            if (payload.mode15Closed) {
                (0, recruitment_1.stopRandomRecruitment)(room.room_number);
                return { status: "mode15_closed" };
            }
            const types = (0, sharing_1.mergeRoomShareTypes)(room.share_room_options, payload.shareTypes);
            room.share_room_options = (0, sharing_1.encodeRoomShareOptions)(types);
            if (types.includes(sharing_1.RANDOM_RECRUITMENT_SHARE_TYPE) && !room.is_npc_mode) {
                const wasRecruiting = (0, recruitment_1.isRandomRecruiting)(room.room_number);
                (0, recruitment_1.publishRandomRecruitment)(room.room_number);
                if (!wasRecruiting)
                    (0, ai_fill_1.scheduleAiFallback)(room.room_number);
            }
            return { status: "done" };
        });
    });
    executor.register("room.disband", (raw, context) => {
        const payload = raw;
        return decide(payload, context, room => {
            if (payload.viewerId !== room.host_viewer_id)
                return { status: "forbidden" };
            if (!SessionManager_1.sessionManager.commitRoomDisband(room.room_number, `viewer_${payload.viewerId}_requested`))
                return { status: "stale" };
            return { status: "done" };
        });
    });
}
exports.registerRoomCommandHandlers = registerRoomCommandHandlers;
