import { performance } from "perf_hooks"
import type { RoomCommandExecutor } from "./command-executor"
import type { MultiRoom, MultiStartBody } from "../types"
import type { PlayerActiveQuest } from "../../data/types"
import { getRoom, getRoomMemberPlayerId } from "../room/manager"
import { sessionManager } from "../state/SessionManager"
import { embeddedMultiCoordinator } from "./embedded"
import { bindBattlePlay, findBattlePlayBinding, markBattleMemberPhase } from "../state/battle-contract"
import { ensureRematchReturnReservations, markMemberSettlementCommitted, markRematchReturnWindowOpened } from "../room/rematch-roster"
import { classifyMultiActiveQuestRecovery } from "../../lib/multi-active-quest-recovery"
import { isFiveBossGauntletQuest } from "../five-boss/contract"
import { waitForFiveBossSignalPersistence, fiveBossProofBarrierStatus, clearFiveBossProofStatus } from "../five-boss/lobby-runtime"
import { fiveBossConnectionDiagnostics } from "../five-boss/connection-diagnostic"
import { pinRoomStart, unpinRoomStart, deferPinnedRoomControl } from "./room-start-claims"

const CLAIM_MS = 10000
const MAX_CLAIMS = 4096
interface Claim {
    token: string; ownerEpoch: string; room: MultiRoom; roomNumber: string; instanceId: string
    generation: number; battleSessionId: string; sceneEpoch: number; runId: string
    playerId: number; viewerId: number; playId: string; deadline: number
    status: "pending" | "committed" | "cancelled"; resolvedAt?: number
}
const claims = new Map<string, Claim>()

/** Expired/unresolved claims stay pinned. Only explicit reconciliation may unlock their authority. */
export function hasFiveBossStartClaims(room: MultiRoom): boolean {
    for (const claim of claims.values()) if (claim.room === room && claim.status === "pending") return true
    return false
}
export function inspectFiveBossStartClaims() {
    prune()
    const pending = [...claims.values()].filter(claim => claim.status === "pending")
    return { retained: claims.size, pending: pending.length,
        expiredUnresolved: pending.filter(claim => performance.now() >= claim.deadline).length }
}
function current(claim: Claim): boolean {
    const room = getRoom(claim.roomNumber)
    return room === claim.room && room.lifecycle.instanceId === claim.instanceId
        && room.lobby_generation === claim.generation && room.lifecycle.battleSessionId === claim.battleSessionId
        && (room.lifecycle.sceneEpoch ?? 0) === claim.sceneEpoch && room.five_boss_runtime?.runId === claim.runId
}
/** Embedded parity check; production parent must use owner epoch + the child's lifecycle pin. */
export function assertFiveBossStartClaim(token: string): void {
    const claim = claims.get(token)
    if (!claim || claim.status !== "pending" || performance.now() >= claim.deadline || !current(claim)) throw new Error("FIVE_BOSS_START_CLAIM_INVALID")
}
function prune(): void {
    const now = performance.now()
    for (const [token, claim] of claims) if (claim.resolvedAt !== undefined && now - claim.resolvedAt > 300000) claims.delete(token)
}
function recovery(stale: PlayerActiveQuest | undefined, playerId: number, frozenRunId?: string) {
    if (!stale?.isMulti) return null
    const room = stale.roomNumber ? getRoom(stale.roomNumber) : undefined
    if (room && hasFiveBossStartClaims(room)) {
        return { playId: stale.playId, recoverable: true, reason: "recoverable" }
    }
    const viewerId = room?.member_viewer_ids.find(id => room.member_player_ids[id] === playerId) ?? 0
    const decision = classifyMultiActiveQuestRecovery(stale, room, viewerId,
        !!room && sessionManager.isBattleSeatRetired(room.room_number, viewerId),
        room && viewerId ? findBattlePlayBinding(room, viewerId, playerId, stale.playId) ?? null : null)
    return { playId: stale.playId, ...decision }
}

export interface FiveBossStartClaim {
    status: "ready"
    token: string
    ownerEpoch: string
    remainingMs: number
    room: MultiRoom
    roomInstanceId: string
    generation: number
    battleSessionId: string
    frozenRunId: string
    oldPlayRecovery: ReturnType<typeof recovery>
    isRescueGuest: boolean
    isRescueFragmentEligible: boolean
}
export interface FiveBossPreparePayload {
    body: MultiStartBody; playerId: number; staleQuest?: PlayerActiveQuest
    staleFrozenRunId?: string; durableRunId?: string
}

export function registerFiveBossCommandHandlers(executor: RoomCommandExecutor): void {
    executor.register("fiveBoss.recovery", (p: { staleQuest: PlayerActiveQuest; playerId: number; staleFrozenRunId?: string }) => {
        const room = p.staleQuest.roomNumber ? getRoom(p.staleQuest.roomNumber) : undefined
        return { ...recovery(p.staleQuest, p.playerId, p.staleFrozenRunId), roomPhase: room?.lifecycle.phase ?? null }
    })
    executor.register("fiveBoss.start.query", (p: { token: string; playerId: number; playId: string }) => {
        const claim = claims.get(p.token)
        if (!claim || claim.playerId !== p.playerId || claim.playId !== p.playId) return { status: "unknown" }
        return { status: claim.status, current: current(claim), ownerEpoch: claim.ownerEpoch,
            remainingMs: Math.max(0, claim.deadline - performance.now()), runId: claim.runId }
    })
    executor.register("fiveBoss.start.prepare", (raw: FiveBossPreparePayload, context) => {
        const p = raw
        return embeddedMultiCoordinator.enqueueRoomCommand(p.body.room_number, () => {
            prune()
            if (context.remainingMs() <= 0) return { status: "unavailable" }
            const room = getRoom(p.body.room_number), frozen = room?.five_boss_runtime
            if (!room || !frozen || !isFiveBossGauntletQuest(room.category, room.quest_id)
                || Number(p.body.category) !== Number(room.category) || Number(p.body.quest_id) !== Number(room.quest_id)
                || room.lifecycle.phase !== "BATTLE" || !room.lifecycle.battleSessionId || (room.lifecycle.sceneEpoch ?? 0) !== 0
                || getRoomMemberPlayerId(room, p.body.viewer_id) !== p.playerId || !frozen.expectedRealPlayerIds.includes(p.playerId)) return { status: "unavailable" }
            if ([...claims.values()].some(item => item.room === room && item.playerId === p.playerId
                && item.status === "pending" && item.playId !== p.body.play_id)) return { status: "unavailable" }
            const oldPlayRecovery = recovery(p.staleQuest, p.playerId, p.staleFrozenRunId)
            if (claims.size >= MAX_CLAIMS) return { status: "unavailable" }
            // Each HTTP attempt owns its pin. A failed duplicate must never
            // cancel another request's pending transaction for the same play.
            const claim: Claim = { token: context.commandId, ownerEpoch: context.ownerEpoch, room, roomNumber: room.room_number,
                    instanceId: room.lifecycle.instanceId, generation: room.lobby_generation,
                    battleSessionId: room.lifecycle.battleSessionId, sceneEpoch: 0, runId: frozen.runId,
                    playerId: p.playerId, viewerId: p.body.viewer_id, playId: p.body.play_id,
                    deadline: performance.now() + CLAIM_MS, status: "pending" }
            claims.set(claim.token, claim)
            pinRoomStart(room, claim.token)
            // Parent supplies this only after checking the original durable
            // member start AND the current active quest. Install the new pin
            // first so reconciliation cannot briefly release buffered controls.
            if (p.durableRunId === claim.runId) {
                for (const older of claims.values()) {
                    if (older === claim || older.status !== "pending" || older.room !== room
                        || older.playerId !== claim.playerId || older.playId !== claim.playId
                        || older.runId !== claim.runId || older.instanceId !== claim.instanceId
                        || older.generation !== claim.generation || older.battleSessionId !== claim.battleSessionId
                        || !current(older)) continue
                    if (bindBattlePlay(room, older.viewerId, older.playerId, older.playId, older.battleSessionId)) {
                        older.status = "committed"; older.resolvedAt = performance.now()
                        unpinRoomStart(room, older.token)
                    }
                }
            }
            return JSON.parse(JSON.stringify({ status: "ready", token: claim.token, ownerEpoch: claim.ownerEpoch,
                remainingMs: Math.max(0, claim.deadline - performance.now()), room,
                roomInstanceId: claim.instanceId, generation: claim.generation,
                battleSessionId: claim.battleSessionId, frozenRunId: claim.runId, oldPlayRecovery,
                isRescueGuest: sessionManager.isRescueGuest(room.room_number, p.body.viewer_id),
                isRescueFragmentEligible: sessionManager.isRescueFragmentEligibleGuest(room.room_number, p.body.viewer_id) }))
        })
    })
    executor.register("fiveBoss.start.commit", (raw: { token: string; playerId: number; playId: string; runId: string }) => {
        const claim = claims.get(raw.token)
        if (!claim || claim.playerId !== raw.playerId || claim.playId !== raw.playId || claim.runId !== raw.runId) return { applied: false, reason: "STALE_CLAIM" }
        return embeddedMultiCoordinator.enqueueRoomCommand(claim.roomNumber, () => {
            if (claim.status === "committed") return { applied: true }
            if (claim.status !== "pending" || !current(claim)) return { applied: false, reason: "STALE_IDENTITY" }
            if (!bindBattlePlay(claim.room, claim.viewerId, claim.playerId, claim.playId, claim.battleSessionId)) return { applied: false, reason: "STALE_PLAY" }
            claim.status = "committed"; claim.resolvedAt = performance.now()
            unpinRoomStart(claim.room, claim.token)
            fiveBossConnectionDiagnostics.begin(claim.room)
            fiveBossConnectionDiagnostics.memberEvent(claim.runId, claim.playerId, "http_start", "committed")
            return { applied: true }
        })
    })
    executor.register("fiveBoss.start.cancel", (raw: { token: string; playerId: number; playId: string; roomNumber?: string }) => {
        const roomNumber = claims.get(raw.token)?.roomNumber ?? raw.roomNumber
        if (!roomNumber) return { applied: false }
        return embeddedMultiCoordinator.enqueueRoomCommand(roomNumber, () => {
            // Prepare may still be waiting in this room's queue when its
            // application ACK times out. Resolve only after that queue entry.
            const claim = claims.get(raw.token)
            if (!claim || claim.playerId !== raw.playerId || claim.playId !== raw.playId) return { applied: false }
            if (claim.status === "committed") return { applied: false, reason: "ALREADY_COMMITTED" }
            claim.status = "cancelled"; claim.resolvedAt = performance.now()
            unpinRoomStart(claim.room, claim.token)
            return { applied: true }
        })
    })
    executor.register("fiveBoss.proof.barrier", async (p: { runId: string; playerId: number; roomNumber?: string }) => {
        const room = p.roomNumber ? getRoom(p.roomNumber) : undefined
        if (room?.five_boss_runtime?.runId === p.runId) {
            // Controls accepted into the owner's pin FIFO precede this HTTP
            // barrier even though their durable proof dispatch is deferred.
            await new Promise<void>(resolve => {
                if (!deferPinnedRoomControl(room, resolve)) resolve()
            })
        }
        await waitForFiveBossSignalPersistence(p.runId, p.playerId)
        return fiveBossProofBarrierStatus(p.runId, p.playerId)
    })
    executor.register("fiveBoss.terminal", (p: { roomNumber: string; runId: string; runStatus: string; playerId?: number; viewerId?: number; playId?: string }) =>
        embeddedMultiCoordinator.enqueueRoomCommand(p.roomNumber, () => {
            if (p.runStatus === "settled" || p.runStatus === "aborted") clearFiveBossProofStatus(p.runId)
            const room = getRoom(p.roomNumber)
            if (!room || room.five_boss_runtime?.runId !== p.runId) return { applied: false, reason: "STALE_RUN" }
            if (!["active", "settled", "aborted"].includes(p.runStatus)) return { applied: false }
            if (p.playerId && p.viewerId && p.playId) {
                // This event is emitted only after the parent's member receipt
                // commits. It can reconcile a paid start whose owner ACK was lost.
                const paidClaims = [...claims.values()].filter(claim => claim.room === room
                    && claim.status === "pending" && current(claim) && claim.runId === p.runId
                    && claim.playerId === p.playerId && claim.viewerId === p.viewerId && claim.playId === p.playId)
                if (paidClaims.length) bindBattlePlay(room, p.viewerId, p.playerId, p.playId, room.lifecycle.battleSessionId)
                const binding = findBattlePlayBinding(room, p.viewerId, p.playerId, p.playId)
                if (binding?.current) {
                    ensureRematchReturnReservations(room); markMemberSettlementCommitted(room, p.viewerId)
                    markBattleMemberPhase(room, p.viewerId, "SETTLED", binding.battleSessionId)
                    for (const claim of paidClaims) {
                        claim.status = "committed"; claim.resolvedAt = performance.now()
                        unpinRoomStart(room, claim.token)
                    }
                }
            }
            if (p.runStatus === "active") return { applied: true }
            // A durable terminal run cannot accept a future queued start or
            // charge its ticket again. Retire gameplay before releasing FIFO:
            // delayed Finalize cannot downgrade SETTLED and delayed SceneReady /
            // LevelNext cannot start another scene for a terminal member.
            for (const viewerId of room.expected_real_viewer_ids) markBattleMemberPhase(room, viewerId, "SETTLED")
            sessionManager.clearBattleExpectedCount(p.roomNumber)
            for (const claim of claims.values()) {
                if (claim.room !== room || claim.status !== "pending" || claim.runId !== p.runId || !current(claim)) continue
                claim.status = "cancelled"; claim.resolvedAt = performance.now()
                unpinRoomStart(room, claim.token)
            }
            if (hasFiveBossStartClaims(room)) return { applied: false, reason: "UNRESOLVED_START" }
            if (p.runStatus === "aborted") { sessionManager.commitRoomDisband(p.roomNumber, "five_boss_aborted"); return { applied: true } }
            ensureRematchReturnReservations(room)
            const wasPending = room.settlement_return_pending
            const transition = embeddedMultiCoordinator.applyRoomCommand(room, { roomNumber: p.roomNumber,
                identity: embeddedMultiCoordinator.identity(room), kind: "BEGIN_RETURN" })
            if (!transition.ok) return { applied: false, reason: transition.reason }
            markRematchReturnWindowOpened(room)
            const { replayFiveBossHostReturnEnter } = require("../tcp/lobby") as typeof import("../tcp/lobby")
            replayFiveBossHostReturnEnter(room, p.runId)
            delete room.five_boss_runtime
            if (!wasPending) sessionManager.beginSettlementReturnGrace(p.roomNumber)
            return { applied: true }
        }))
}
