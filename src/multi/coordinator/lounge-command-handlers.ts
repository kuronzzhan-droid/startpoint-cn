import { createLounge, getLounge, getLoungeByNumber, listLounges, prepareLounge,
    setLoungeShareTypes, canAttachLoungeViewer, getLoungeOccupancy, matchesLoungeAccess,
    type LoungeRoom, type LoungeHostProfile } from "../../lounge/state"
import type { RoomCommandExecutor } from "./command-executor"

/** advice is a random, never reused room instance token, unlike the numeric id. */
export interface LoungeProjection {
    id: number
    number: string
    advice: string
    useCase: number
    campaignId: number
    hostViewerId: number
    hostPlayerId: number
    hostProfile: LoungeHostProfile
    raisingState: number
    occupancy: number
    canAttach: boolean
}
export interface LoungeDecisionPayload {
    loungeId: number
    viewerId: number
    identity: { advice: string; campaignId: number; hostViewerId: number; useCase: number } | null
    access: { advice: string; establisherViewerId: number; useCase: number }
    campaignExists: boolean
    eligible: boolean
    shareTypes?: number[]
}
export type LoungeDecisionResult = { status: "ready"; room: LoungeProjection }
    | { status: "done" | "missing" | "stale" | "forbidden" | "ineligible" | "expired" }
function project(room: LoungeRoom, viewerId: number): LoungeProjection {
    return { id: room.id, number: room.number, advice: room.advice, useCase: room.useCase,
        campaignId: room.campaignId, hostViewerId: room.hostViewerId, hostPlayerId: room.hostPlayerId,
        hostProfile: { ...room.hostProfile }, raisingState: room.raisingState,
        occupancy: getLoungeOccupancy(room), canAttach: canAttachLoungeViewer(room, viewerId) }
}
export function registerLoungeCommandHandlers(executor: RoomCommandExecutor): void {
    executor.register("lounge.query", raw => {
        const p = raw as { loungeId?: number; loungeNumber?: string; viewerId: number }
        const room = p.loungeId ? getLounge(p.loungeId) : getLoungeByNumber(p.loungeNumber || "")
        return room ? project(room, p.viewerId) : null
    })
    executor.register("lounge.list", raw => {
        const p = raw as { useCase: number; viewerId: number; beforeId?: number; throughId?: number }
        const all = listLounges(p.useCase)
        const throughId = p.throughId ?? all.reduce((max, room) => Math.max(max, room.id), 0)
        const remaining = all.filter(room => room.id <= throughId && room.id < (p.beforeId ?? Number.MAX_SAFE_INTEGER))
            .sort((a, b) => b.id - a.id)
        const page = remaining.slice(0, 64)
        return { rooms: page.map(room => project(room, p.viewerId)), throughId,
            nextId: remaining.length > page.length ? page[page.length - 1].id : null }
    })
    executor.register("lounge.create", raw => {
        const p = raw as Parameters<typeof createLounge>[0]
        return project(createLounge(p), p.hostViewerId)
    })
    for (const operation of ["prepare", "select", "restore", "share"] as const) {
        executor.register(`lounge.${operation}`, (raw, context): LoungeDecisionResult => {
            if (context.remainingMs() <= 0) return { status: "expired" }
            const p = raw as LoungeDecisionPayload
            const room = p.identity ? getLounge(p.loungeId) : undefined
            if (!room) return { status: "missing" }
            const identity = p.identity!
            if (room.advice !== identity.advice || room.campaignId !== identity.campaignId
                || room.hostViewerId !== identity.hostViewerId || room.useCase !== identity.useCase) return { status: "stale" }
            if (!p.campaignExists || !matchesLoungeAccess(room, p.access)) return { status: "forbidden" }
            if ((operation === "prepare" || operation === "share") && room.hostViewerId !== p.viewerId) return { status: "forbidden" }
            if (operation === "select" && (!p.eligible || !canAttachLoungeViewer(room, p.viewerId))) return { status: "ineligible" }
            if (operation === "restore" && room.raisingState === 2 && !p.eligible) return { status: "ineligible" }
            if (operation === "prepare") { prepareLounge(room); return { status: "done" } }
            if (operation === "share") { setLoungeShareTypes(room, p.shareTypes ?? []); return { status: "done" } }
            return { status: "ready", room: project(room, p.viewerId) }
        })
    }
}
