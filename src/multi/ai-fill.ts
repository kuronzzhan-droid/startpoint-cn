import { getRoom } from "./room/manager"
import { embeddedMultiCoordinator } from "./coordinator/embedded"
import { createRealtimeMaintenanceTimer } from "./coordinator/business-rpc"

/**
 * Shared random-recruitment fallback for every multiplayer mode.
 *
 * The client keeps random recruitment enabled once the host turns it on and
 * has no separate "disable" action, so the fallback is intentionally sticky:
 * it is scheduled when recruitment is first published and only cancelled by
 * battle start, room disband, or the fallback itself.
 */
const aiFallbackTimers = new Map<string, NodeJS.Timeout>()

export function aiFillTimeoutMs(): number {
    const parsed = Number.parseInt(process.env.MULTI_AI_FILL_TIMEOUT_MS || "120000", 10)
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 120_000
}

export function scheduleAiFallback(roomNumber: string): void {
    if (aiFallbackTimers.has(roomNumber)) return
    const scheduledRoom = getRoom(roomNumber)
    if (!scheduledRoom) return
    const scheduledInstanceId = scheduledRoom.lifecycle.instanceId
    const timeoutMs = aiFillTimeoutMs()
    const timer = createRealtimeMaintenanceTimer(() => setTimeout(() => {
        aiFallbackTimers.delete(roomNumber)
        void embeddedMultiCoordinator.enqueueRoomCommand(roomNumber, () => {
            const room = getRoom(roomNumber)
            // The fallback belongs to the first lobby only. Rematch lobbies
            // restore the previous AI count and add the extra AI after the
            // real-player reconnect grace instead of waiting another timeout.
            if (!room
                || room.lifecycle.instanceId !== scheduledInstanceId
                || room.lifecycle.phase !== "LOBBY"
                || room.lobby_generation !== 0) return

            // Lazy requires keep this module free of a load-time cycle with
            // the recruitment and TCP lobby modules.
            const { stopRandomRecruitment } = require("./recruitment") as typeof import("./recruitment")
            const { recruitNpcMatesForRoom } = require("./tcp/lobby") as typeof import("./tcp/lobby")
            room.is_npc_mode = true
            stopRandomRecruitment(roomNumber)
            recruitNpcMatesForRoom(roomNumber)
            console.log(`[MULTI-AI] fallback triggered room=${roomNumber} timeoutMs=${timeoutMs}`)
        }).catch(error => console.error(`[MULTI-AI] fallback failed room=${roomNumber}`, error))
    }, timeoutMs))
    timer.unref()
    aiFallbackTimers.set(roomNumber, timer)
}

export function cancelAiFallback(roomNumber: string): void {
    const timer = aiFallbackTimers.get(roomNumber)
    if (timer) clearTimeout(timer)
    aiFallbackTimers.delete(roomNumber)
}

export function hasAiFallback(roomNumber: string): boolean {
    return aiFallbackTimers.has(roomNumber)
}
