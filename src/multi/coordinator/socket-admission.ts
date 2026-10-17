import type { Socket } from "node:net"
import { performance } from "node:perf_hooks"
import { isRealtimeOwnerChild } from "./runtime-role"
import { invokeRealtimeBusiness, createSocketAdmissionMaintenanceTimer } from "./business-rpc"
import { markTcpDisconnectReason } from "../tcp/disconnect-diagnostics"

interface Lease { socket: Socket; id: number; token: unknown; session: unknown; expires: number; activity: boolean; deadline?: NodeJS.Timeout }
const leases = new Map<Socket, Lease>()
let sequence = 0, polling = false
let timer: NodeJS.Timeout | undefined
let lastRefreshFailureLogAt = -Infinity
const refreshFailureReasons = new Set([
    "TCP_BUSINESS_WORK_ENDED", "REALTIME_BUSINESS_CHANNEL_UNAVAILABLE",
    "BUSINESS_CHANNEL_CLOSED", "BUSINESS_PENDING_BUDGET", "BUSINESS_OUTCOME_UNKNOWN",
    "BUSINESS_OWNER_EPOCH_MISMATCH", "BUSINESS_HANDLER_FAILED", "BUSINESS_RESULT_LIMIT",
    "BUSINESS_SEND_FAILED", "SERVER_CLOSING",
])

function reportRefreshFailure(error: unknown): void {
    const now = performance.now()
    if (now - lastRefreshFailureLogAt < 30_000) return
    lastRefreshFailureLogAt = now
    const failure = error as { code?: unknown; message?: unknown } | null
    const candidate = failure?.code ?? failure?.message
    // Never include a payload, token, session, arbitrary message or stack.
    const reason = typeof candidate === "string" && refreshFailureReasons.has(candidate)
        ? candidate : "ADMISSION_REFRESH_FAILED"
    console.warn(`[MULTI-ADMISSION] socket lease refresh failed: reason=${reason}`)
}
function apply(lease: Lease, result: { ok: boolean; remainingMs: number }): boolean {
    if (!result.ok || !Number.isFinite(result.remainingMs) || result.remainingMs <= 0) {
        if (lease.deadline) clearTimeout(lease.deadline)
        markTcpDisconnectReason(lease.socket, "admission")
        leases.delete(lease.socket); lease.socket.destroy(); return false
    }
    lease.expires = performance.now() + Math.min(60_000, result.remainingMs)
    if (lease.deadline) clearTimeout(lease.deadline)
    lease.deadline = setTimeout(() => {
        if (leases.get(lease.socket) !== lease) return
        markTcpDisconnectReason(lease.socket, "admission")
        leases.delete(lease.socket); lease.socket.destroy()
    }, Math.max(1, lease.expires - performance.now()))
    lease.deadline.unref()
    return true
}
async function poll(): Promise<void> {
    if (polling) return
    polling = true
    try {
        const current = [...leases.values()]
        for (let at = 0; at < current.length; at += 64) {
            const batch = current.slice(at, at + 64).filter(value => leases.get(value.socket) === value)
            if (!batch.length) continue
            const items = batch.map(value => ({ id: value.id, token: value.token, session: value.session, active: value.activity }))
            for (const value of batch) value.activity = false
            try {
                const requestedAt = performance.now()
                const response = await invokeRealtimeBusiness<Array<{ id: number; ok: boolean; remainingMs: number }>>("admission.refresh", { items })
                for (const value of batch) {
                    if (leases.get(value.socket) !== value) continue
                    const result = response.find(item => item.id === value.id)
                    if (result) apply(value, { ...result, remainingMs: result.remainingMs - (performance.now() - requestedAt) })
                }
            } catch (error) {
                reportRefreshFailure(error)
                // Preserve the original finite capability while the business process is busy.
                for (const value of batch) value.activity = true
            }
        }
    } finally {
        for (const value of leases.values()) if (performance.now() >= value.expires) {
            markTcpDisconnectReason(value.socket, "admission")
            leases.delete(value.socket); value.socket.destroy()
        }
        polling = false
    }
}
export async function authorizeSocketAdmission(socket: Socket, token: unknown, session: unknown): Promise<boolean> {
    if (!isRealtimeOwnerChild()) {
        const { clientAdmission } = require("../../lib/client-admission") as typeof import("../../lib/client-admission")
        return clientAdmission().checkActivity(token, session).ok
    }
    if (leases.size >= 10000) return false
    const requestedAt = performance.now()
    const result = await invokeRealtimeBusiness<{ ok: boolean; remainingMs: number }>("admission.lease", { token: token ?? null, session: session ?? null })
    if (socket.destroyed) return false
    const lease: Lease = { socket, id: ++sequence, token: token ?? null, session: session ?? null, expires: 0, activity: false }
    if (!result.ok) return false
    leases.set(socket, lease)
    socket.once("close", () => { if (lease.deadline) clearTimeout(lease.deadline); leases.delete(socket) })
    if (!timer) {
        timer = createSocketAdmissionMaintenanceTimer(() => setInterval(() => { void poll() }, 5000))
        timer.unref()
    }
    return apply(lease, { ...result, remainingMs: result.remainingMs - (performance.now() - requestedAt) })
}
export function checkSocketAdmission(socket: Socket, token: unknown, session: unknown): boolean {
    if (!isRealtimeOwnerChild()) {
        const { clientAdmission } = require("../../lib/client-admission") as typeof import("../../lib/client-admission")
        return clientAdmission().checkActivity(token, session).ok
    }
    const lease = leases.get(socket)
    if (!lease || performance.now() >= lease.expires) return false
    lease.activity = true
    return true
}
export function stopSocketAdmission(): void {
    if (timer) clearInterval(timer)
    for (const value of leases.values()) if (value.deadline) clearTimeout(value.deadline)
    timer = undefined; leases.clear()
}
