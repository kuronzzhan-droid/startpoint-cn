"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.roomAdmissionRegistry = exports.RoomAdmissionRegistry = exports.drainRoomAdmissionPerformanceSummary = exports.recordRoomAdmissionBypass = exports.recordRoomAdmissionDenial = void 0;
// Room selection precedes the client's boost prompt and resource loading.
// Keep a finite seat reservation long enough for that normal join flow.
const DEFAULT_ADMISSION_TTL_MS = 60000;
const admissionCounters = new Map();
let admissionLatency = { count: 0, totalMs: 0, maxMs: 0 };
function recordAdmissionEvent(name) {
    var _a;
    admissionCounters.set(name, ((_a = admissionCounters.get(name)) !== null && _a !== void 0 ? _a : 0) + 1);
}
function recordAdmissionLatency(elapsedMs) {
    if (!Number.isFinite(elapsedMs) || elapsedMs < 0)
        return;
    admissionLatency.count += 1;
    admissionLatency.totalMs += elapsedMs;
    admissionLatency.maxMs = Math.max(admissionLatency.maxMs, elapsedMs);
}
function recordRoomAdmissionDenial(reason) {
    recordAdmissionEvent(`deny_${reason}`);
}
exports.recordRoomAdmissionDenial = recordRoomAdmissionDenial;
function recordRoomAdmissionBypass(reason) {
    recordAdmissionEvent(`bypass_${reason}`);
}
exports.recordRoomAdmissionBypass = recordRoomAdmissionBypass;
function drainRoomAdmissionPerformanceSummary() {
    if (admissionCounters.size === 0 && admissionLatency.count === 0)
        return "none";
    const counters = [...admissionCounters.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([name, count]) => `${name}=${count}`)
        .join(",");
    admissionCounters.clear();
    const latency = admissionLatency;
    admissionLatency = { count: 0, totalMs: 0, maxMs: 0 };
    const timing = latency.count === 0
        ? ""
        : `${counters ? "," : ""}select_to_tcp{n=${latency.count},avg=${(latency.totalMs / latency.count).toFixed(1)}ms,max=${latency.maxMs.toFixed(1)}ms}`;
    return `${counters}${timing}` || "none";
}
exports.drainRoomAdmissionPerformanceSummary = drainRoomAdmissionPerformanceSummary;
function resolveAdmissionTtlMs() {
    var _a;
    const configured = Number.parseInt((_a = process.env.MULTI_ROOM_ADMISSION_TTL_MS) !== null && _a !== void 0 ? _a : String(DEFAULT_ADMISSION_TTL_MS), 10);
    return Number.isFinite(configured) && configured >= 1000
        ? configured
        : DEFAULT_ADMISSION_TTL_MS;
}
/**
 * Reserves the two guest seats between HTTP room selection and the TCP lobby
 * handshake. Without this bridge, several bell recipients can all pass the
 * HTTP capacity check before any of their sockets have connected.
 */
class RoomAdmissionRegistry {
    constructor(ttlMs = resolveAdmissionTtlMs()) {
        this.ttlMs = ttlMs;
        this.admissions = new Map();
    }
    prune(roomNumber, generation, now) {
        const roomAdmissions = this.admissions.get(roomNumber);
        if (!roomAdmissions)
            return null;
        for (const [viewerId, admission] of roomAdmissions) {
            if (admission.generation !== generation
                || (admission.state === "reserved" && admission.expiresAt <= now)) {
                roomAdmissions.delete(viewerId);
            }
        }
        if (roomAdmissions.size === 0) {
            this.admissions.delete(roomNumber);
            return null;
        }
        return roomAdmissions;
    }
    has(roomNumber, generation, viewerId, now = Date.now()) {
        var _a;
        const admission = (_a = this.prune(roomNumber, generation, now)) === null || _a === void 0 ? void 0 : _a.get(viewerId);
        return admission !== undefined;
    }
    getOccupancy(roomNumber, generation, occupiedViewerIds, now = Date.now()) {
        var _a, _b;
        const viewers = new Set(occupiedViewerIds);
        for (const viewerId of (_b = (_a = this.prune(roomNumber, generation, now)) === null || _a === void 0 ? void 0 : _a.keys()) !== null && _b !== void 0 ? _b : []) {
            viewers.add(viewerId);
        }
        return viewers.size;
    }
    reserve(roomNumber, generation, viewerId, occupiedViewerIds, capacity, now = Date.now(), source = "direct") {
        let roomAdmissions = this.prune(roomNumber, generation, now);
        const existing = roomAdmissions === null || roomAdmissions === void 0 ? void 0 : roomAdmissions.get(viewerId);
        if (existing) {
            existing.expiresAt = now + this.ttlMs;
            if (existing.state === "reserved") {
                existing.selectedAt = now;
                existing.source = source;
            }
            recordAdmissionEvent("refresh");
            return true;
        }
        const occupied = new Set(occupiedViewerIds);
        if (occupied.has(viewerId))
            return true;
        const occupancy = this.getOccupancy(roomNumber, generation, occupied, now);
        if (occupancy >= capacity) {
            recordRoomAdmissionDenial("capacity");
            return false;
        }
        if (!roomAdmissions) {
            roomAdmissions = new Map();
            this.admissions.set(roomNumber, roomAdmissions);
        }
        roomAdmissions.set(viewerId, {
            generation,
            selectedAt: now,
            expiresAt: now + this.ttlMs,
            state: "reserved",
            source,
        });
        recordAdmissionEvent("reserve");
        return true;
    }
    isRescue(roomNumber, generation, viewerId, now = Date.now()) {
        var _a, _b;
        return ((_b = (_a = this.prune(roomNumber, generation, now)) === null || _a === void 0 ? void 0 : _a.get(viewerId)) === null || _b === void 0 ? void 0 : _b.source) === "rescue";
    }
    claim(roomNumber, generation, viewerId, connectionId, now = Date.now()) {
        const roomAdmissions = this.admissions.get(roomNumber);
        const admission = roomAdmissions === null || roomAdmissions === void 0 ? void 0 : roomAdmissions.get(viewerId);
        if (!admission) {
            recordRoomAdmissionDenial("missing");
            return { ok: false, reason: "missing" };
        }
        if (admission.generation !== generation) {
            roomAdmissions.delete(viewerId);
            if (roomAdmissions.size === 0)
                this.admissions.delete(roomNumber);
            recordRoomAdmissionDenial("generation_mismatch");
            return { ok: false, reason: "generation_mismatch" };
        }
        if (admission.state === "reserved" && admission.expiresAt <= now) {
            roomAdmissions.delete(viewerId);
            if (roomAdmissions.size === 0)
                this.admissions.delete(roomNumber);
            recordRoomAdmissionDenial("expired");
            return { ok: false, reason: "expired" };
        }
        recordAdmissionLatency(Math.max(0, now - admission.selectedAt));
        if (admission.state === "claimed") {
            if (admission.connectionId === connectionId) {
                recordAdmissionEvent("claim_idempotent");
                return { ok: true, kind: "idempotent" };
            }
            admission.connectionId = connectionId;
            recordAdmissionEvent("reclaim");
            return { ok: true, kind: "reclaimed" };
        }
        admission.state = "claimed";
        admission.connectionId = connectionId;
        recordAdmissionEvent("claim");
        return { ok: true, kind: "claimed" };
    }
    commit(roomNumber, generation, viewerId, connectionId) {
        const roomAdmissions = this.admissions.get(roomNumber);
        const admission = roomAdmissions === null || roomAdmissions === void 0 ? void 0 : roomAdmissions.get(viewerId);
        if (!admission
            || admission.generation !== generation
            || admission.state !== "claimed"
            || admission.connectionId !== connectionId)
            return false;
        roomAdmissions.delete(viewerId);
        if (roomAdmissions.size === 0)
            this.admissions.delete(roomNumber);
        recordAdmissionEvent("commit");
        return true;
    }
    releaseClaim(roomNumber, generation, viewerId, connectionId, now = Date.now()) {
        const roomAdmissions = this.admissions.get(roomNumber);
        const admission = roomAdmissions === null || roomAdmissions === void 0 ? void 0 : roomAdmissions.get(viewerId);
        if (!admission
            || admission.generation !== generation
            || admission.state !== "claimed"
            || admission.connectionId !== connectionId)
            return false;
        if (admission.expiresAt > now) {
            admission.state = "reserved";
            delete admission.connectionId;
            recordAdmissionEvent("release_to_reserved");
        }
        else {
            roomAdmissions.delete(viewerId);
            if (roomAdmissions.size === 0)
                this.admissions.delete(roomNumber);
            recordAdmissionEvent("release_expired");
        }
        return true;
    }
    release(roomNumber, viewerId) {
        const roomAdmissions = this.admissions.get(roomNumber);
        roomAdmissions === null || roomAdmissions === void 0 ? void 0 : roomAdmissions.delete(viewerId);
        if ((roomAdmissions === null || roomAdmissions === void 0 ? void 0 : roomAdmissions.size) === 0)
            this.admissions.delete(roomNumber);
    }
    clearRoom(roomNumber) {
        this.admissions.delete(roomNumber);
    }
}
exports.RoomAdmissionRegistry = RoomAdmissionRegistry;
exports.roomAdmissionRegistry = new RoomAdmissionRegistry();
