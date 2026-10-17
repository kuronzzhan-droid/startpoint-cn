// Barrel entry for multi battle / co-op system
// Re-exports for backward compatibility with cn-server.ts

export { multiBattleRoutes } from "./http/register"
export { startRealtimeSessionServer as startSessionServer,
    stopRealtimeSessionServer as stopSessionServer } from "./coordinator/default-runtime"
