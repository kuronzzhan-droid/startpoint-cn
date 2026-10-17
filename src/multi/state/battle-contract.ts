import { performance } from "node:perf_hooks"
import type { MultiRoom } from "../types"

/** Internal identities; room numbers and lobby connection rounds are not run ids. */
export interface RoomCommandIdentity {
    instanceId: string
    generation: number
    battleSessionId: string | null
    sceneEpoch: number
    version?: number
}

export type BattleMemberPhase = "LOADING" | "READY" | "ACTIVE" | "FINALIZED" | "SETTLED" | "RETURNED" | "RETIRED"
export interface BattleMemberBinding {
    viewerId: number
    playerId: number | null
    connectionId: string
    connectionEpoch: number
    playId?: string
    playCommitted?: boolean
    playClaims?: number
    phase: BattleMemberPhase
    sceneEpoch: number
}
export interface BattleSessionContract {
    readonly roomInstanceId: string
    readonly battleSessionId: string
    readonly generation: number
    readonly category: number
    readonly questId: number
    readonly viewerIds: readonly number[]
    readonly members: Map<number, BattleMemberBinding>
    readonly createdAt: number
    retainedAt?: number
    sceneEpoch: number
}

// No persisted schema or player progress is changed. Old runs are retained
// separately from the lobby, with the same finite lifetime as finish snapshots.
const contracts = new WeakMap<MultiRoom, Map<string, BattleSessionContract>>()
const RETENTION_MS = 15 * 60_000
const MAX_RETAINED_RUNS = 8

export function captureRoomCommandIdentity(room: MultiRoom): RoomCommandIdentity {
    return {
        instanceId: room.lifecycle.instanceId,
        generation: room.lobby_generation,
        battleSessionId: room.lifecycle.battleSessionId,
        sceneEpoch: room.lifecycle.sceneEpoch ?? 0,
    }
}

export function roomCommandIdentityMatches(room: MultiRoom | undefined, expected: RoomCommandIdentity): boolean {
    return !!room && room.lifecycle.phase !== "DISBANDED"
        && room.lifecycle.instanceId === expected.instanceId
        && room.lobby_generation === expected.generation
        && room.lifecycle.battleSessionId === expected.battleSessionId
        && (room.lifecycle.sceneEpoch ?? 0) === expected.sceneEpoch
        && (expected.version === undefined || expected.version === room.lifecycle.version)
}

export function ensureBattleSessionContract(room: MultiRoom): BattleSessionContract | undefined {
    const id = room.lifecycle.battleSessionId
    if (!id) return undefined
    let runs = contracts.get(room)
    if (!runs) contracts.set(room, runs = new Map())
    const existing = runs.get(id)
    if (existing) return existing
    const now = performance.now()
    for (const [key, run] of runs) {
        if (run.retainedAt !== undefined && now - run.retainedAt > RETENTION_MS) runs.delete(key)
    }
    while (runs.size >= MAX_RETAINED_RUNS) runs.delete(runs.keys().next().value!)
    const ids = [...new Set(room.expected_real_viewer_ids.length > 0
        ? room.expected_real_viewer_ids : room.member_viewer_ids)]
    const run: BattleSessionContract = {
        roomInstanceId: room.lifecycle.instanceId, battleSessionId: id,
        generation: room.lobby_generation, category: Number(room.category), questId: room.quest_id,
        viewerIds: Object.freeze(ids), createdAt: now, sceneEpoch: room.lifecycle.sceneEpoch ?? 0,
        members: new Map(ids.map(viewerId => [viewerId, {
            viewerId, playerId: room.member_player_ids?.[viewerId] ?? null,
            connectionId: "", connectionEpoch: 0, phase: "LOADING" as const,
            sceneEpoch: room.lifecycle.sceneEpoch ?? 0,
        }])),
    }
    runs.set(id, run)
    return run
}

export function getBattleSessionContract(room: MultiRoom, id = room.lifecycle.battleSessionId): BattleSessionContract | undefined {
    return id ? contracts.get(room)?.get(id) : undefined
}

export function retainBattleSessionContract(room: MultiRoom): void {
    const run = getBattleSessionContract(room)
    if (run && run.retainedAt === undefined) run.retainedAt = performance.now()
}

function assignBattlePlay(room: MultiRoom, viewerId: number, playerId: number, playId: string,
    battleSessionId = room.lifecycle.battleSessionId): boolean {
    const run = battleSessionId === room.lifecycle.battleSessionId
        ? ensureBattleSessionContract(room) : getBattleSessionContract(room, battleSessionId)
    const member = run?.members.get(viewerId)
    if (!member || !playId || (member.playerId !== null && member.playerId !== playerId)
        || (member.playId !== undefined && member.playId !== playId)) return false
    member.playerId = playerId
    member.playId = playId
    return true
}

export function claimBattlePlay(room: MultiRoom, viewerId: number, playerId: number, playId: string,
    battleSessionId = room.lifecycle.battleSessionId): boolean {
    if (!assignBattlePlay(room, viewerId, playerId, playId, battleSessionId)) return false
    const member = getBattleSessionContract(room, battleSessionId)!.members.get(viewerId)!
    member.playClaims = (member.playClaims ?? 0) + 1
    return true
}

export function bindBattlePlay(room: MultiRoom, viewerId: number, playerId: number, playId: string,
    battleSessionId = room.lifecycle.battleSessionId): boolean {
    if (!assignBattlePlay(room, viewerId, playerId, playId, battleSessionId)) return false
    getBattleSessionContract(room, battleSessionId)!.members.get(viewerId)!.playCommitted = true
    return true
}

export function releaseBattlePlayClaim(room: MultiRoom, viewerId: number, playId: string, battleSessionId: string): void {
    const member = getBattleSessionContract(room, battleSessionId)?.members.get(viewerId)
    if (member?.playId !== playId) return
    member.playClaims = Math.max(0, (member.playClaims ?? 0) - 1)
    if (!member.playCommitted && member.playClaims === 0) delete member.playId
}

export interface BoundBattleConnection {
    viewerId: number
    playerId: number | null
    connectionId: string
    roomInstanceId?: string
    battleSessionId?: string | null
    connectionGeneration: number
    sceneEpoch?: number
    superseded: boolean
}

export function bindBattleConnection(room: MultiRoom, client: BoundBattleConnection): boolean {
    const run = ensureBattleSessionContract(room)
    if (!run) return true // Compatibility for explicitly constructed legacy test rooms.
    const member = run.members.get(client.viewerId)
    if (!member || member.phase === "RETIRED" || member.phase === "FINALIZED"
        || member.phase === "SETTLED" || member.phase === "RETURNED"
        || (member.playerId !== null && client.playerId !== member.playerId)) return false
    member.connectionId = client.connectionId
    member.connectionEpoch++
    client.roomInstanceId = run.roomInstanceId
    client.battleSessionId = run.battleSessionId
    client.connectionGeneration = member.connectionEpoch
    client.sceneEpoch = run.sceneEpoch
    return true
}

export function battleConnectionMatches(room: MultiRoom, client: BoundBattleConnection): boolean {
    if (client.superseded) return false
    // Older focused fixtures have no captured binding; production binds before indexing.
    if (!client.roomInstanceId) return true
    if (client.roomInstanceId !== room.lifecycle.instanceId
        || client.battleSessionId !== room.lifecycle.battleSessionId) return false
    const member = getBattleSessionContract(room)?.members.get(client.viewerId)
    return !!member && member.phase !== "RETIRED"
        && member.connectionId === client.connectionId
        && member.connectionEpoch === client.connectionGeneration
}

export function battleMemberCanPlay(room: MultiRoom, viewerId: number): boolean {
    const run = getBattleSessionContract(room)
    if (!run) return true
    const phase = run.members.get(viewerId)?.phase
    return phase === "LOADING" || phase === "READY" || phase === "ACTIVE"
}

export function beginBattleSceneEpoch(room: MultiRoom): number {
    if (require("../coordinator/room-start-claims").hasRoomStartClaims(room)) throw new Error("START_CLAIM_PENDING")
    const run = ensureBattleSessionContract(room)
    const epoch = (room.lifecycle.sceneEpoch ?? 0) + 1
    room.lifecycle.sceneEpoch = epoch
    room.lifecycle.version++
    if (run) {
        run.sceneEpoch = epoch
        for (const member of run.members.values()) {
            if (member.phase === "ACTIVE" || member.phase === "READY" || member.phase === "LOADING") {
                member.phase = "LOADING"
                member.sceneEpoch = epoch
            }
        }
    }
    return epoch
}

export function markBattleMemberPhase(
    room: MultiRoom, viewerId: number, phase: BattleMemberPhase,
    battleSessionId = room.lifecycle.battleSessionId,
): boolean {
    const member = getBattleSessionContract(room, battleSessionId)?.members.get(viewerId)
    if (!member || member.phase === "RETIRED") return false
    if ((phase === "LOADING" || phase === "READY" || phase === "ACTIVE")
        && (member.phase === "FINALIZED" || member.phase === "SETTLED" || member.phase === "RETURNED")) return false
    if (phase === "SETTLED" && member.phase === "RETURNED") return true
    const terminalRank: Partial<Record<BattleMemberPhase, number>> = {FINALIZED:1,SETTLED:2,RETURNED:3,RETIRED:4}
    if (terminalRank[member.phase] !== undefined && terminalRank[phase] !== undefined
        && terminalRank[phase]! < terminalRank[member.phase]!) return false
    member.phase = phase
    return true
}

export function findBattlePlayBinding(room: MultiRoom, viewerId: number, playerId: number, playId: string): {
    roomInstanceId: string; battleSessionId: string; generation: number; playId: string;
    category: number; questId: number; phase: BattleMemberPhase; current: boolean
} | undefined {
    const runs = contracts.get(room)
    if (!runs) return undefined
    const now = performance.now()
    for (const run of runs.values()) {
        if (run.retainedAt !== undefined && now - run.retainedAt > RETENTION_MS) continue
        const member = run.members.get(viewerId)
        if (member?.playerId !== playerId || member.playId !== playId) continue
        return {
            roomInstanceId: run.roomInstanceId, battleSessionId: run.battleSessionId,
            generation: run.generation, playId, category: run.category, questId: run.questId,
            phase: member.phase, current: room.lifecycle.battleSessionId === run.battleSessionId,
        }
    }
    return undefined
}
