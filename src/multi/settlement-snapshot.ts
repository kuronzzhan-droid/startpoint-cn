import type { ActiveQuest } from "../routes/api/singleBattleQuest"

export type MultiBattleLifecycle = "BATTLE" | "SETTLING" | "RETURN_PENDING" | "LOBBY"

export interface FrozenSettlementParticipant {
    viewerId: number
    comId: number
}

export interface MultiSettlementSnapshot {
    battleInstanceId: string
    playerId: number
    viewerId: number
    playId: string
    roomNumber: string
    roomGeneration: number
    activeQuest: ActiveQuest
    participants: FrozenSettlementParticipant[]
    expectedRealViewerIds: number[]
    isHost: boolean
    isRescueGuest: boolean
    isNewbieRescueGuest: boolean
    lifecycle: MultiBattleLifecycle
    createdAt: number
    expiresAt: number
}

const snapshots = new Map<string, MultiSettlementSnapshot>()
const START_TTL_MS = Math.max(120_000, Number.parseInt(process.env.MULTI_BATTLE_SNAPSHOT_TTL_MS ?? "900000", 10) || 900_000)
const COMPLETED_TTL_MS = Math.max(120_000, Number.parseInt(process.env.MULTI_SETTLEMENT_SNAPSHOT_TTL_MS ?? "120000", 10) || 120_000)

function key(playerId: number, playId: string): string {
    return `${playerId}:${playId}`
}

function cleanup(now = Date.now()): void {
    for (const [entryKey, snapshot] of snapshots) {
        if (snapshot.expiresAt <= now) snapshots.delete(entryKey)
    }
}

export function buildBattleInstanceId(
    roomNumber: string,
    roomGeneration: number,
    category: number,
    questId: number,
): string {
    // The lobby generation increments for every rematch, while each client has
    // its own play_id.  Therefore generation (not play_id) is the shared battle
    // identity used by every participant's settlement barrier.
    return `${roomNumber}:${roomGeneration}:${category}:${questId}`
}

export function registerMultiSettlementSnapshot(input: Omit<MultiSettlementSnapshot, "lifecycle" | "createdAt" | "expiresAt">): MultiSettlementSnapshot {
    cleanup()
    const now = Date.now()
    const snapshot: MultiSettlementSnapshot = {
        ...input,
        activeQuest: {
            ...input.activeQuest,
            matePlayerIds: [...(input.activeQuest.matePlayerIds ?? [])],
            mateComIds: [...(input.activeQuest.mateComIds ?? [])],
        },
        participants: input.participants.map(participant => ({ ...participant })),
        expectedRealViewerIds: [...input.expectedRealViewerIds],
        lifecycle: "BATTLE",
        createdAt: now,
        expiresAt: now + START_TTL_MS,
    }
    snapshots.set(key(snapshot.playerId, snapshot.playId), snapshot)
    console.log(`[MULTI-SETTLEMENT] instance=${snapshot.battleInstanceId} player=${snapshot.playerId} state=BATTLE`)
    return snapshot
}

export function getMultiSettlementSnapshot(playerId: number, playId: string): MultiSettlementSnapshot | undefined {
    cleanup()
    return snapshots.get(key(playerId, playId))
}

export function transitionMultiSettlementSnapshot(
    playerId: number,
    playId: string,
    lifecycle: MultiBattleLifecycle,
): MultiSettlementSnapshot | undefined {
    const snapshot = getMultiSettlementSnapshot(playerId, playId)
    if (!snapshot) return undefined
    if (snapshot.lifecycle !== lifecycle) {
        snapshot.lifecycle = lifecycle
        console.log(`[MULTI-SETTLEMENT] instance=${snapshot.battleInstanceId} player=${playerId} state=${lifecycle}`)
    }
    if (lifecycle === "RETURN_PENDING" || lifecycle === "LOBBY") {
        snapshot.expiresAt = Date.now() + COMPLETED_TTL_MS
    }
    return snapshot
}

export function transitionRoomSettlementSnapshots(
    roomNumber: string,
    lifecycle: MultiBattleLifecycle,
): number {
    cleanup()
    let transitioned = 0
    for (const snapshot of snapshots.values()) {
        if (snapshot.roomNumber !== roomNumber) continue
        if (snapshot.lifecycle !== lifecycle) {
            snapshot.lifecycle = lifecycle
            console.log(`[MULTI-SETTLEMENT] instance=${snapshot.battleInstanceId} player=${snapshot.playerId} state=${lifecycle}`)
        }
        if (lifecycle === "RETURN_PENDING" || lifecycle === "LOBBY") {
            snapshot.expiresAt = Date.now() + COMPLETED_TTL_MS
        }
        transitioned += 1
    }
    return transitioned
}
