"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isMode15RoomClosed = exports.getMode15HostRoomGate = void 0;
const runtime_role_1 = require("./coordinator/runtime-role");
const business_facts_1 = require("./coordinator/business-facts");
/**
 * A Mode15 multiplayer room is valid only while its host still expects that
 * exact boss stage. Rescue guests intentionally do not participate in this
 * check: their repeatable-helper rule is separate from ownership of the room.
 */
function getMode15HostRoomGate(room) {
    if ((0, runtime_role_1.isRealtimeOwnerChild)()) {
        if ((0, business_facts_1.getQuestBusinessClassification)(room.category, room.quest_id) === false)
            return null;
        const facts = (0, business_facts_1.getPlayerBusinessFacts)(room.host_player_id, { category: room.category, questId: room.quest_id });
        if (!facts)
            return { stage: null, expectedStage: 0, allowed: false, unknown: true };
        return facts.questPolicy.isMode15 ? { stage: null, expectedStage: 0, allowed: facts.questPolicy.hostAllowed } : null;
    }
    const mode = require("../lib/mode15-optional");
    if (!mode.isMode15Quest(room.category, room.quest_id))
        return null;
    return mode.canStartMode15QuestSync(room.host_player_id, room.category, room.quest_id);
}
exports.getMode15HostRoomGate = getMode15HostRoomGate;
function isMode15RoomClosed(room) {
    const gate = getMode15HostRoomGate(room);
    return gate !== null && !gate.allowed && gate.unknown !== true;
}
exports.isMode15RoomClosed = isMode15RoomClosed;
