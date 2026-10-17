import { performance } from "node:perf_hooks"
import type { MultiRoom } from "../types"
import { markBattleMemberPhase } from "../state/battle-contract"

type ReturnStatus = "pending_result" | "return_pending" | "returned"
interface ReturnSeat {
    status: ReturnStatus
    resultCommitted: boolean
    deadline: number | null
}
interface ReturnRoster {
    instanceId: string | undefined
    generation: number
    battleSessionId: string | null
    returnWindowOpenedAt: number | null
    frozenViewers: readonly number[]
    seats: Map<number, ReturnSeat>
}

const rosters = new WeakMap<MultiRoom, ReturnRoster>()
function duration(name: string, fallback: number): number {
    const value = Number(process.env[name])
    return Number.isFinite(value) && value > 0 ? value : fallback
}
const RETURN_GRACE_MS = duration("REMATCH_RECONNECT_GRACE_MS", 60_000)
const RESULT_WAIT_MAX_MS = duration("REMATCH_RESULT_WAIT_MAX_MS", 180_000)

function current(room: MultiRoom): ReturnRoster | undefined {
    const roster = rosters.get(room)
    return roster?.instanceId === room.lifecycle?.instanceId
        && roster?.generation === room.lobby_generation ? roster : undefined
}

/** Copy the original participants once; lobby socket lists never own this evidence. */
export function ensureRematchReturnReservations(
    room: MultiRoom, now = performance.now(), generation = room.lobby_generation,
): void {
    if (generation !== room.lobby_generation || generation <= 0 || current(room)) return
    const frozenViewers = [...new Set(room.expected_real_viewer_ids)]
    rosters.set(room, {
        instanceId: room.lifecycle?.instanceId, generation, frozenViewers,
        battleSessionId: room.lifecycle?.battleSessionId ?? null, returnWindowOpenedAt: null,
        seats: new Map<number, ReturnSeat>(frozenViewers.filter(viewer => viewer !== room.host_viewer_id)
            .map(viewer => [viewer, {
                status: "pending_result", resultCommitted: false,
                deadline: now + RESULT_WAIT_MAX_MS,
            }])),
    })
}

/** A result submitted during the battle cannot spend its return lease before return opens. */
export function markRematchReturnWindowOpened(room: MultiRoom, now = performance.now()): void {
    if (room.lifecycle.phase !== "RETURNING" && room.lifecycle.phase !== "LOBBY") return
    ensureRematchReturnReservations(room, now)
    const roster = current(room)
    if (!roster || roster.returnWindowOpenedAt !== null) return
    roster.returnWindowOpenedAt = now
    for (const seat of roster.seats.values()) {
        if (seat.resultCommitted && seat.status !== "returned") {
            seat.deadline = Math.max(seat.deadline ?? 0, now + RETURN_GRACE_MS)
        }
    }
}

/** The first committed personal result starts only that member's return lease. */
export function markMemberSettlementCommitted(
    room: MultiRoom, viewerId: number, now = performance.now(), generation = room.lobby_generation,
): boolean {
    if (generation !== room.lobby_generation) return false
    ensureRematchReturnReservations(room, now, generation)
    if (viewerId === room.host_viewer_id) return true
    const seat = current(room)?.seats.get(viewerId)
    if (!seat) return false
    if (seat.resultCommitted) return true
    seat.resultCommitted = true
    if (seat.status !== "returned") {
        seat.status = "return_pending"
        seat.deadline = now + RETURN_GRACE_MS
    }
    return true
}

export function markMemberReturned(room: MultiRoom, viewerId: number): void {
    if (room.lifecycle.phase === "RETURNING" || room.lifecycle.phase === "LOBBY") {
        ensureRematchReturnReservations(room)
    }
    const roster = current(room)
    const seat = roster?.seats.get(viewerId)
    if (seat) { seat.status = "returned"; seat.deadline = null }
    if (roster?.battleSessionId && (seat || viewerId === room.host_viewer_id)) {
        markBattleMemberPhase(room, viewerId, "RETURNED", roster.battleSessionId)
    }
}

/** A returned member's later socket loss owns a new, independent bounded lease. */
export function markMemberReturnDisconnected(room: MultiRoom, viewerId: number, now = performance.now()): void {
    const seat = current(room)?.seats.get(viewerId)
    if (seat?.status === "returned") {
        seat.status = "return_pending"
        seat.deadline = now + RETURN_GRACE_MS
    }
}

/** Expiry does not release a seat until the room command actually removes it. */
export function getReservedReturnViewerIds(room: MultiRoom): number[] {
    return [...(current(room)?.seats ?? [])]
        .filter(([, seat]) => seat.status !== "returned").map(([viewer]) => viewer)
}

export function getExpiredReturnViewerIds(room: MultiRoom, now = performance.now()): number[] {
    return [...(current(room)?.seats ?? [])]
        .filter(([, seat]) => seat.deadline !== null && seat.deadline <= now)
        .map(([viewer]) => viewer)
}

export function getNextReturnDeadline(room: MultiRoom): number | undefined {
    const deadlines = [...(current(room)?.seats.values() ?? [])]
        .flatMap(seat => seat.deadline === null ? [] : [seat.deadline])
    return deadlines.length ? Math.min(...deadlines) : undefined
}

export function forgetReturnReservation(room: MultiRoom, viewerId: number): void {
    current(room)?.seats.delete(viewerId)
}

export function clearRematchReturnReservations(room: MultiRoom): void { rosters.delete(room) }

export function getFrozenRematchViewerIds(room: MultiRoom): readonly number[] {
    return [...(current(room)?.frozenViewers ?? room.expected_real_viewer_ids)]
}
