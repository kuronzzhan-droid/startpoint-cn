import { registerRealtimeDomainHandlers } from "./default-runtime"
import type { RoomCommandExecutor } from "./command-executor"
import { startSessionServer, stopSessionServer, getSessionServer, quiesceSessionServer } from "../tcp/server"
import { drainFiveBossSignalPersistence } from "../five-boss/lobby-runtime"
import { embeddedMultiCoordinator } from "./embedded"
import { isRealtimeOwnerChild } from "./runtime-role"

export async function register(executor: RoomCommandExecutor,
    lifecycle: { onShutdown(fn: () => void | Promise<void>): void;
        onQuiesce(fn: () => void | Promise<void>): void; onDrain(fn: () => void | Promise<void>): void }): Promise<unknown> {
    if (!isRealtimeOwnerChild()) throw new Error("Realtime bootstrap requires child role")
    registerRealtimeDomainHandlers(executor)
    lifecycle.onQuiesce(quiesceSessionServer)
    lifecycle.onDrain(async () => { await embeddedMultiCoordinator.drain(); await drainFiveBossSignalPersistence() })
    lifecycle.onShutdown(stopSessionServer)
    await startSessionServer()
    const address = getSessionServer()?.address()
    return { port: typeof address === "object" && address ? address.port : null, pid: process.pid,
        ownerEpoch: executor.ownerEpoch, authority: "tcp-room-barrier-lease", database: "business-rpc-only" }
}
