import { routineGameLog } from "../lib/routine-game-logging"
import type { ActiveQuest } from "../routes/api/singleBattleQuest"
import { registerMemoryCounters } from "../lib/memory-diagnostics"
import { cloneQuestNpcPartySnapshot, type QuestNpcPartySnapshot } from "./npc/quest-party-pool-shared"
import { cloneBattleRoster } from "../lib/quest/battle-roster"

export type MultiBattleLifecycle = "BATTLE" | "SETTLING" | "RETURN_PENDING" | "LOBBY"

export interface FrozenSettlementParticipant {
    viewerId: number
    comId: number
}

export interface MultiSettlementSnapshot {
    battleInstanceId: string
    roomInstanceId?: string
    playerId: number
    viewerId: number
    playId: string
    roomNumber: string
    roomGeneration: number
    activeQuest: ActiveQuest
    participants: FrozenSettlementParticipant[]
    expectedRealViewerIds: number[]
    npcPartySnapshot?: QuestNpcPartySnapshot
    isHost: boolean
    isRescueGuest: boolean
    isRescueFragmentEligible: boolean
    isNewbieRescueGuest: boolean
    lifecycle: MultiBattleLifecycle
    createdAt: number
    expiresAt: number
}

const snapshots = new Map<string, MultiSettlementSnapshot>()
registerMemoryCounters("battleSnapshots", () => ({ entries: snapshots.size }))
const LIFECYCLE_RANK: Record<MultiBattleLifecycle, number> = {
    BATTLE: 0,
    SETTLING: 1,
    RETURN_PENDING: 2,
    LOBBY: 3,
}
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
    roomInstanceId?: string,
): string {
    // The lobby generation increments for every rematch, while each client has
    // its own play_id.  Therefore generation (not play_id) is the shared battle
    // identity used by every participant's settlement barrier.
    return `${roomInstanceId ?? roomNumber}:${roomGeneration}:${category}:${questId}`
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
            battleRoster: cloneBattleRoster(input.activeQuest.battleRoster),
        },
        participants: input.participants.map(participant => ({ ...participant })),
        expectedRealViewerIds: [...input.expectedRealViewerIds],
        npcPartySnapshot: cloneQuestNpcPartySnapshot(input.npcPartySnapshot),
        lifecycle: "BATTLE",
        createdAt: now,
        expiresAt: now + START_TTL_MS,
    }
    snapshots.set(key(snapshot.playerId, snapshot.playId), snapshot)
    routineGameLog("multiSettlement", () => `[MULTI-SETTLEMENT] instance=${snapshot.battleInstanceId} player=${snapshot.playerId} state=BATTLE`)
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
    if (LIFECYCLE_RANK[lifecycle] < LIFECYCLE_RANK[snapshot.lifecycle]) {
        console.warn(`[MULTI-SETTLEMENT] ignored lifecycle regression instance=${snapshot.battleInstanceId}`
            + ` player=${playerId} current=${snapshot.lifecycle} requested=${lifecycle}`)
        return snapshot
    }
    if (snapshot.lifecycle !== lifecycle) {
        snapshot.lifecycle = lifecycle
        routineGameLog("multiSettlement", () => `[MULTI-SETTLEMENT] instance=${snapshot.battleInstanceId} player=${playerId} state=${lifecycle}`)
    }
    if (lifecycle === "RETURN_PENDING" || lifecycle === "LOBBY") {
        snapshot.expiresAt = Date.now() + COMPLETED_TTL_MS
    }
    return snapshot
}

export function transitionRoomSettlementSnapshots(
    roomNumber: string,
    lifecycle: MultiBattleLifecycle,
    roomGeneration?: number,
    roomInstanceId?: string,
): number {
    cleanup()
    let transitioned = 0
    for (const snapshot of snapshots.values()) {
        if (snapshot.roomNumber !== roomNumber) continue
        if (roomGeneration !== undefined && snapshot.roomGeneration !== roomGeneration) continue
        if (roomInstanceId !== undefined && snapshot.roomInstanceId !== roomInstanceId) continue
        // Host lobby return does not complete another member's unsettled play.
        if (lifecycle === "LOBBY" && snapshot.lifecycle === "BATTLE") continue
        if (LIFECYCLE_RANK[lifecycle] < LIFECYCLE_RANK[snapshot.lifecycle]) {
            console.warn(`[MULTI-SETTLEMENT] ignored lifecycle regression instance=${snapshot.battleInstanceId}`
                + ` player=${snapshot.playerId} current=${snapshot.lifecycle} requested=${lifecycle}`)
            continue
        }
        if (snapshot.lifecycle !== lifecycle) {
            snapshot.lifecycle = lifecycle
            routineGameLog("multiSettlement", () => `[MULTI-SETTLEMENT] instance=${snapshot.battleInstanceId} player=${snapshot.playerId} state=${lifecycle}`)
            transitioned += 1
        }
        if (lifecycle === "RETURN_PENDING" || lifecycle === "LOBBY") {
            snapshot.expiresAt = Date.now() + COMPLETED_TTL_MS
        }
    }
    return transitioned
}
