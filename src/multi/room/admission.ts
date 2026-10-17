interface PendingRoomAdmission {
    generation: number
    selectedAt: number
    expiresAt: number
    state: "reserved" | "claimed"
    source: "direct" | "rescue"
    connectionId?: string
}

export type RoomAdmissionClaimResult =
    | { readonly ok: true, readonly kind: "claimed" | "reclaimed" | "idempotent" }
    | { readonly ok: false, readonly reason: "missing" | "expired" | "generation_mismatch" }

// Room selection precedes the client's boost prompt and resource loading.
// Keep a finite seat reservation long enough for that normal join flow.
const DEFAULT_ADMISSION_TTL_MS = 60_000

interface AdmissionTiming {
    count: number
    totalMs: number
    maxMs: number
}

const admissionCounters = new Map<string, number>()
let admissionLatency: AdmissionTiming = { count: 0, totalMs: 0, maxMs: 0 }

function recordAdmissionEvent(name: string): void {
    admissionCounters.set(name, (admissionCounters.get(name) ?? 0) + 1)
}

function recordAdmissionLatency(elapsedMs: number): void {
    if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return
    admissionLatency.count += 1
    admissionLatency.totalMs += elapsedMs
    admissionLatency.maxMs = Math.max(admissionLatency.maxMs, elapsedMs)
}

export function recordRoomAdmissionDenial(reason: string): void {
    recordAdmissionEvent(`deny_${reason}`)
}

export function recordRoomAdmissionBypass(reason: string): void {
    recordAdmissionEvent(`bypass_${reason}`)
}

export function drainRoomAdmissionPerformanceSummary(): string {
    if (admissionCounters.size === 0 && admissionLatency.count === 0) return "none"
    const counters = [...admissionCounters.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([name, count]) => `${name}=${count}`)
        .join(",")
    admissionCounters.clear()
    const latency = admissionLatency
    admissionLatency = { count: 0, totalMs: 0, maxMs: 0 }
    const timing = latency.count === 0
        ? ""
        : `${counters ? "," : ""}select_to_tcp{n=${latency.count},avg=${(latency.totalMs / latency.count).toFixed(1)}ms,max=${latency.maxMs.toFixed(1)}ms}`
    return `${counters}${timing}` || "none"
}

function resolveAdmissionTtlMs(): number {
    const configured = Number.parseInt(
        process.env.MULTI_ROOM_ADMISSION_TTL_MS ?? String(DEFAULT_ADMISSION_TTL_MS),
        10,
    )
    return Number.isFinite(configured) && configured >= 1_000
        ? configured
        : DEFAULT_ADMISSION_TTL_MS
}

/**
 * Reserves the two guest seats between HTTP room selection and the TCP lobby
 * handshake. Without this bridge, several bell recipients can all pass the
 * HTTP capacity check before any of their sockets have connected.
 */
export class RoomAdmissionRegistry {
    private readonly admissions = new Map<string, Map<number, PendingRoomAdmission>>()

    constructor(private readonly ttlMs: number = resolveAdmissionTtlMs()) {}

    private prune(roomNumber: string, generation: number, now: number): Map<number, PendingRoomAdmission> | null {
        const roomAdmissions = this.admissions.get(roomNumber)
        if (!roomAdmissions) return null

        for (const [viewerId, admission] of roomAdmissions) {
            if (admission.generation !== generation
                || (admission.state === "reserved" && admission.expiresAt <= now)) {
                roomAdmissions.delete(viewerId)
            }
        }
        if (roomAdmissions.size === 0) {
            this.admissions.delete(roomNumber)
            return null
        }
        return roomAdmissions
    }

    has(
        roomNumber: string,
        generation: number,
        viewerId: number,
        now: number = Date.now(),
    ): boolean {
        const admission = this.prune(roomNumber, generation, now)?.get(viewerId)
        return admission !== undefined
    }

    getOccupancy(
        roomNumber: string,
        generation: number,
        occupiedViewerIds: Iterable<number>,
        now: number = Date.now(),
    ): number {
        const viewers = new Set(occupiedViewerIds)
        for (const viewerId of this.prune(roomNumber, generation, now)?.keys() ?? []) {
            viewers.add(viewerId)
        }
        return viewers.size
    }

    reserve(
        roomNumber: string,
        generation: number,
        viewerId: number,
        occupiedViewerIds: Iterable<number>,
        capacity: number,
        now: number = Date.now(),
        source: "direct" | "rescue" = "direct",
    ): boolean {
        let roomAdmissions = this.prune(roomNumber, generation, now)
        const existing = roomAdmissions?.get(viewerId)
        if (existing) {
            existing.expiresAt = now + this.ttlMs
            if (existing.state === "reserved") {
                existing.selectedAt = now
                existing.source = source
            }
            recordAdmissionEvent("refresh")
            return true
        }

        const occupied = new Set(occupiedViewerIds)
        if (occupied.has(viewerId)) return true

        const occupancy = this.getOccupancy(roomNumber, generation, occupied, now)
        if (occupancy >= capacity) {
            recordRoomAdmissionDenial("capacity")
            return false
        }

        if (!roomAdmissions) {
            roomAdmissions = new Map()
            this.admissions.set(roomNumber, roomAdmissions)
        }
        roomAdmissions.set(viewerId, {
            generation,
            selectedAt: now,
            expiresAt: now + this.ttlMs,
            state: "reserved",
            source,
        })
        recordAdmissionEvent("reserve")
        return true
    }

    isRescue(
        roomNumber: string,
        generation: number,
        viewerId: number,
        now: number = Date.now(),
    ): boolean {
        return this.prune(roomNumber, generation, now)?.get(viewerId)?.source === "rescue"
    }

    claim(
        roomNumber: string,
        generation: number,
        viewerId: number,
        connectionId: string,
        now: number = Date.now(),
    ): RoomAdmissionClaimResult {
        const roomAdmissions = this.admissions.get(roomNumber)
        const admission = roomAdmissions?.get(viewerId)
        if (!admission) {
            recordRoomAdmissionDenial("missing")
            return { ok: false, reason: "missing" }
        }
        if (admission.generation !== generation) {
            roomAdmissions!.delete(viewerId)
            if (roomAdmissions!.size === 0) this.admissions.delete(roomNumber)
            recordRoomAdmissionDenial("generation_mismatch")
            return { ok: false, reason: "generation_mismatch" }
        }
        if (admission.state === "reserved" && admission.expiresAt <= now) {
            roomAdmissions!.delete(viewerId)
            if (roomAdmissions!.size === 0) this.admissions.delete(roomNumber)
            recordRoomAdmissionDenial("expired")
            return { ok: false, reason: "expired" }
        }

        recordAdmissionLatency(Math.max(0, now - admission.selectedAt))
        if (admission.state === "claimed") {
            if (admission.connectionId === connectionId) {
                recordAdmissionEvent("claim_idempotent")
                return { ok: true, kind: "idempotent" }
            }
            admission.connectionId = connectionId
            recordAdmissionEvent("reclaim")
            return { ok: true, kind: "reclaimed" }
        }
        admission.state = "claimed"
        admission.connectionId = connectionId
        recordAdmissionEvent("claim")
        return { ok: true, kind: "claimed" }
    }

    commit(
        roomNumber: string,
        generation: number,
        viewerId: number,
        connectionId: string,
    ): boolean {
        const roomAdmissions = this.admissions.get(roomNumber)
        const admission = roomAdmissions?.get(viewerId)
        if (!admission
            || admission.generation !== generation
            || admission.state !== "claimed"
            || admission.connectionId !== connectionId) return false
        roomAdmissions!.delete(viewerId)
        if (roomAdmissions!.size === 0) this.admissions.delete(roomNumber)
        recordAdmissionEvent("commit")
        return true
    }

    releaseClaim(
        roomNumber: string,
        generation: number,
        viewerId: number,
        connectionId: string,
        now: number = Date.now(),
    ): boolean {
        const roomAdmissions = this.admissions.get(roomNumber)
        const admission = roomAdmissions?.get(viewerId)
        if (!admission
            || admission.generation !== generation
            || admission.state !== "claimed"
            || admission.connectionId !== connectionId) return false
        if (admission.expiresAt > now) {
            admission.state = "reserved"
            delete admission.connectionId
            recordAdmissionEvent("release_to_reserved")
        } else {
            roomAdmissions!.delete(viewerId)
            if (roomAdmissions!.size === 0) this.admissions.delete(roomNumber)
            recordAdmissionEvent("release_expired")
        }
        return true
    }

    release(roomNumber: string, viewerId: number): void {
        const roomAdmissions = this.admissions.get(roomNumber)
        roomAdmissions?.delete(viewerId)
        if (roomAdmissions?.size === 0) this.admissions.delete(roomNumber)
    }

    clearRoom(roomNumber: string): void {
        this.admissions.delete(roomNumber)
    }
}

export const roomAdmissionRegistry = new RoomAdmissionRegistry()
