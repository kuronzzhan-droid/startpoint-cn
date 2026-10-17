/** Parent-only module: no room/session imports or volatile authority construction. */
export async function handleFiveBossBusiness(kind: string, payload: unknown): Promise<unknown> {
    if (kind !== "fiveBoss.proof.persist") throw new Error("Unknown five-boss business operation")
    const p = payload as { runId: string; roomNumber: string; playerId: number; signal: "scene_ready" | "level_next" | "finalize" }
    if (!p || typeof p.runId !== "string" || !p.runId || typeof p.roomNumber !== "string" || !p.roomNumber
        || !Number.isSafeInteger(p.playerId) || p.playerId <= 0 || !["scene_ready", "level_next", "finalize"].includes(p.signal)) throw new Error("Invalid five-boss proof")
    const { runPersistenceTransaction } = require("../../lib/persistence-coordinator") as typeof import("../../lib/persistence-coordinator")
    const { recordMemberBattleSignalSync } = require("../../data/domains/fiveBossGauntletRun") as typeof import("../../data/domains/fiveBossGauntletRun")
    await runPersistenceTransaction({ domain: "multi-settlement", playerId: p.playerId, operation: `five_boss_${p.signal}` },
        () => recordMemberBattleSignalSync(p))
    return { persisted: true }
}

export function registerFiveBossBusinessHandlers(register: (kind: string, handler: (payload: any) => unknown | Promise<unknown>) => void): void {
    register("fiveBoss.proof.persist", payload => handleFiveBossBusiness("fiveBoss.proof.persist", payload))
}
