"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hasAiFallback = exports.cancelAiFallback = exports.scheduleAiFallback = exports.aiFillTimeoutMs = void 0;
const manager_1 = require("./room/manager");
const embedded_1 = require("./coordinator/embedded");
const business_rpc_1 = require("./coordinator/business-rpc");
/**
 * Shared random-recruitment fallback for every multiplayer mode.
 *
 * The client keeps random recruitment enabled once the host turns it on and
 * has no separate "disable" action, so the fallback is intentionally sticky:
 * it is scheduled when recruitment is first published and only cancelled by
 * battle start, room disband, or the fallback itself.
 */
const aiFallbackTimers = new Map();
function aiFillTimeoutMs() {
    const parsed = Number.parseInt(process.env.MULTI_AI_FILL_TIMEOUT_MS || "120000", 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 120000;
}
exports.aiFillTimeoutMs = aiFillTimeoutMs;
function scheduleAiFallback(roomNumber) {
    if (aiFallbackTimers.has(roomNumber))
        return;
    const scheduledRoom = (0, manager_1.getRoom)(roomNumber);
    if (!scheduledRoom)
        return;
    const scheduledInstanceId = scheduledRoom.lifecycle.instanceId;
    const timeoutMs = aiFillTimeoutMs();
    const timer = (0, business_rpc_1.createRealtimeMaintenanceTimer)(() => setTimeout(() => {
        aiFallbackTimers.delete(roomNumber);
        void embedded_1.embeddedMultiCoordinator.enqueueRoomCommand(roomNumber, () => {
            const room = (0, manager_1.getRoom)(roomNumber);
            // The fallback belongs to the first lobby only. Rematch lobbies
            // restore the previous AI count and add the extra AI after the
            // real-player reconnect grace instead of waiting another timeout.
            if (!room
                || room.lifecycle.instanceId !== scheduledInstanceId
                || room.lifecycle.phase !== "LOBBY"
                || room.lobby_generation !== 0)
                return;
            // Lazy requires keep this module free of a load-time cycle with
            // the recruitment and TCP lobby modules.
            const { stopRandomRecruitment } = require("./recruitment");
            const { recruitNpcMatesForRoom } = require("./tcp/lobby");
            room.is_npc_mode = true;
            stopRandomRecruitment(roomNumber);
            recruitNpcMatesForRoom(roomNumber);
            console.log(`[MULTI-AI] fallback triggered room=${roomNumber} timeoutMs=${timeoutMs}`);
        }).catch(error => console.error(`[MULTI-AI] fallback failed room=${roomNumber}`, error));
    }, timeoutMs));
    timer.unref();
    aiFallbackTimers.set(roomNumber, timer);
}
exports.scheduleAiFallback = scheduleAiFallback;
function cancelAiFallback(roomNumber) {
    const timer = aiFallbackTimers.get(roomNumber);
    if (timer)
        clearTimeout(timer);
    aiFallbackTimers.delete(roomNumber);
}
exports.cancelAiFallback = cancelAiFallback;
function hasAiFallback(roomNumber) {
    return aiFallbackTimers.has(roomNumber);
}
exports.hasAiFallback = hasAiFallback;
