import type { RoomCommandExecutor } from "./command-executor"
import { sessionManager } from "../state/SessionManager"
import { disconnectLoungePlayerLogin } from "../../lounge/state"
import { battleTelemetry } from "../battle-telemetry"
import { getRealtimeDiagnostics, configureRealtimeDiagnostics } from "../../lib/realtime-diagnostics"

export function registerRuntimeCommandHandlers(executor: RoomCommandExecutor): void {
    executor.register("runtime.disconnect", raw => {
        const p = raw as { viewerId: number }
        sessionManager.disconnectPlayerLogin(p.viewerId)
        disconnectLoungePlayerLogin(p.viewerId)
        return { applied: true }
    })
    executor.register("runtime.diagnostics", () => getRealtimeDiagnostics())
    executor.register("runtime.configureDiagnostics", raw => configureRealtimeDiagnostics(raw as Parameters<typeof configureRealtimeDiagnostics>[0]))
    executor.register("runtime.battles", () => ({ active: battleTelemetry.activeCount(), recent: battleTelemetry.recentSummaries() }))
    executor.register("runtime.partyChanged", async raw => {
        const p = raw as { playerId: number; changedPartyIds: number[]; selectionChanged: boolean }
        const { notifyEquipmentPartySaved } = require("../room/equipment-ready") as typeof import("../room/equipment-ready")
        await notifyEquipmentPartySaved(p.playerId, p.changedPartyIds, p.selectionChanged)
        return { applied: true }
    })
    executor.register("runtime.presence", raw => {
        const p = raw as { roomNumber: string; hostViewerId?: number }
        return { hasClients: sessionManager.hasRoomClients(p.roomNumber), hostOnline: p.hostViewerId !== undefined
            ? sessionManager.isHostOnline(p.hostViewerId, p.roomNumber) : false }
    })
}
