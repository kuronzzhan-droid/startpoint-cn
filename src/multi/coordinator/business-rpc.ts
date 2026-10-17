import { cloneCommandJson, commandJsonBytes } from "./command-protocol"
import { isRealtimeOwnerChild } from "./runtime-role"
import { AsyncLocalStorage } from "node:async_hooks"
import { withServerWorkAdmission } from "../../lib/shutdown-state"
import { randomUUID } from "node:crypto"
import { setImmediate as nextTurn } from "node:timers/promises"

interface TcpBusinessWork {
    active: boolean
    grant: Promise<unknown>
    tails: Set<Promise<unknown>>
}
const tcpBusinessContext = new AsyncLocalStorage<TcpBusinessWork | undefined>()
const tcpBusinessWorks = new Set<Promise<unknown>>()
async function actualResult<T>(promise: Promise<T>): Promise<T> {
    try { return await promise }
    catch (error) {
        const uncertain = error as { code?: string; confirmation?: Promise<T> }
        if (uncertain?.code === "BUSINESS_OUTCOME_UNKNOWN" && uncertain.confirmation) return await uncertain.confirmation
        throw error
    }
}

/** Retain detached writes/pinned callbacks until their actual completion, not caller timeout. */
export function retainRealtimeBusinessTail<T>(tail: Promise<T>): Promise<T> {
    const work = tcpBusinessContext.getStore()
    if (!work) return tail
    if (!work.active) throw new Error("TCP_BUSINESS_WORK_ENDED")
    const tracked = actualResult(tail)
    work.tails.add(tracked)
    void tracked.then(() => work.tails.delete(tracked), () => work.tails.delete(tracked))
    return tail
}

/** Manual pin replay is not an async continuation; explicitly retain and restore both contexts. */
export function captureRealtimeBusinessContext(): <T>(operation: () => T) => T {
    const proof = getRealtimeBusinessAdmission(), work = tcpBusinessContext.getStore()
    return <T>(operation: () => T): T => businessAdmission.run(proof,
        () => tcpBusinessContext.run(work, operation))
}

/** FIFO begin is sent immediately; local barriers/ACKs never wait for the parent-issued grant. */
export function runWithTcpBusinessAdmission<T>(operation: () => T | Promise<T>): Promise<T> {
    if (tcpBusinessWorks.size >= 128) return Promise.reject(new Error("TCP_BUSINESS_WORK_BUDGET"))
    const workId = `tcp.${randomUUID()}`
    const child = isRealtimeOwnerChild()
    if (child && !transport) return Promise.reject(new Error("REALTIME_BUSINESS_CHANNEL_UNAVAILABLE"))
    const grant = child ? actualResult(transport!("__tcp_work_begin__", { workId })).then(proof => {
        const p = proof as { commandId?: unknown; ownerEpoch?: unknown; admissionToken?: unknown }
        if (!p || p.commandId !== workId || typeof p.ownerEpoch !== "string"
            || typeof p.admissionToken !== "string" || !/^[a-f0-9]{64}$/.test(p.admissionToken)) throw new Error("TCP_BUSINESS_GRANT_INVALID")
        return cloneCommandJson(proof)
    }) : Promise.resolve(undefined)
    void grant.catch(() => {})
    const context: TcpBusinessWork = { active: true, grant, tails: new Set() }
    const execute = async (): Promise<T> => {
        try { return await tcpBusinessContext.run(context, operation) }
        finally {
            // ChangeParty's deferred immediate and any registered pin/proof tails
            // belong to this accepted frame, even after the handler returns.
            await nextTurn()
            while (context.tails.size) await Promise.allSettled([...context.tails])
            context.active = false
            const proof = await grant
            if (child) await actualResult(transport!("__tcp_work_end__", { workId, proof }))
        }
    }
    const work = child ? execute() : withServerWorkAdmission(execute)
    tcpBusinessWorks.add(work)
    void work.then(() => tcpBusinessWorks.delete(work), () => tcpBusinessWorks.delete(work))
    return work
}

const businessAdmission = new AsyncLocalStorage<unknown>()

/** Independent realtime upkeep starts new business work when its timer fires.
 * Clear only the timer's inherited TCP frame and command proof; ordinary
 * continuations retain ended-work rejection and normal transport budgets.
 */
export function createRealtimeMaintenanceTimer(create: () => NodeJS.Timeout): NodeJS.Timeout {
    return tcpBusinessContext.run(undefined, () => businessAdmission.run(undefined, create))
}

/** Socket lease upkeep is one independent realtime maintenance task. */
export function createSocketAdmissionMaintenanceTimer(create: () => NodeJS.Timeout): NodeJS.Timeout {
    return createRealtimeMaintenanceTimer(create)
}

export function runWithRealtimeBusinessAdmission<T>(proof: unknown, operation: () => T): T {
    return businessAdmission.run(proof === undefined ? undefined : cloneCommandJson(proof), operation)
}
export function getRealtimeBusinessAdmission(): unknown {
    const proof = businessAdmission.getStore()
    return proof === undefined ? undefined : cloneCommandJson(proof)
}
let childBusinessDrain: () => Promise<void> = async () => {}
export async function drainChildRealtimeBusiness(): Promise<void> {
    while (tcpBusinessWorks.size) await Promise.allSettled([...tcpBusinessWorks])
    await childBusinessDrain()
}

type BusinessTransport = (kind: string, payload: unknown) => Promise<unknown>
let transport: BusinessTransport | undefined
export function installRealtimeBusinessTransport(value: BusinessTransport): void {
    if (transport) throw new Error("Business transport already installed")
    transport = value
}
export async function invokeRealtimeBusiness<T = unknown>(kind: string, payload: unknown): Promise<T> {
    const input = cloneCommandJson(payload)
    if (transport) {
        const work = tcpBusinessContext.getStore()
        if (work && !work.active) throw new Error("TCP_BUSINESS_WORK_ENDED")
        const call = work ? work.grant.then(proof => businessAdmission.run(proof, () => transport!(kind, input)))
            : transport(kind, input)
        retainRealtimeBusinessTail(call)
        return cloneCommandJson(await call) as T
    }
    if (isRealtimeOwnerChild()) throw new Error("REALTIME_BUSINESS_CHANNEL_UNAVAILABLE")
    return await withServerWorkAdmission(() => handleParentBusiness(kind, input)) as T
}

/** Only the parent imports player/database modules. Child never falls back here. */
export async function handleParentBusiness(kind: string, payload: unknown): Promise<unknown> {
    if (isRealtimeOwnerChild()) throw new Error("REALTIME_CHILD_CANNOT_EXECUTE_BUSINESS")
    if (kind === "admission.lease") {
        const p = payload as { token: unknown; session: unknown }
        const { clientAdmission } = require("../../lib/client-admission") as typeof import("../../lib/client-admission")
        return clientAdmission().socketLease(p.token, p.session, true)
    }
    if (kind === "admission.refresh") {
        const p = payload as { items: Array<{ id: number; token: unknown; session: unknown; active: boolean }> }
        if (!Array.isArray(p.items) || p.items.length > 64) throw new Error("INVALID_ADMISSION_BATCH")
        const { clientAdmission } = require("../../lib/client-admission") as typeof import("../../lib/client-admission")
        return p.items.map(item => ({ id: item.id, ...clientAdmission().socketLease(item.token, item.session, item.active === true) }))
    }
    const { handleRealtimeBusiness } = require("./business-handlers") as {
        handleRealtimeBusiness(kind: string, payload: unknown): Promise<unknown>
    }
    const result = await handleRealtimeBusiness(kind, payload)
    // Business rows may have optional undefined columns. DTOs on the wire are JSON values.
    return cloneCommandJson(JSON.parse(JSON.stringify(result ?? null)))
}

/** Bounded reverse RPC. ACK means the registered business handler completed. */
export function attachChildBusinessRpc(): () => void {
    const pending = new Map<number, { bytes: number; timer: NodeJS.Timeout;
        resolve?: (result: unknown) => void; reject?: (error: Error) => void;
        confirm: (result: unknown) => void; deny: (error: Error) => void }>()
    let sequence = 0, bytes = 0, closed = false
    const drainWaiters = new Set<() => void>()
    const notifySettled = () => { for (const wake of drainWaiters) wake(); drainWaiters.clear() }
    childBusinessDrain = async () => {
        while (pending.size) await new Promise<void>(resolve => { drainWaiters.add(resolve) })
    }
    const fail = () => {
        closed = true
        for (const item of pending.values()) {
            clearTimeout(item.timer)
            const error = new Error("BUSINESS_CHANNEL_CLOSED")
            item.reject?.(error); item.deny(error)
        }
        pending.clear(); bytes = 0; notifySettled()
    }
    process.on("disconnect", fail)
    process.on("message", (message: any) => {
        if (message?.t !== "business-result" && message?.t !== "tcp-work-result") return
        const item = pending.get(message.requestId)
        if (!item) return
        try {
            if (commandJsonBytes(message) > 512 * 1024) throw new Error("BUSINESS_RESULT_LIMIT")
        } catch { fail(); if (process.connected) process.disconnect(); return }
        pending.delete(message.requestId); bytes -= item.bytes; clearTimeout(item.timer)
        notifySettled()
        if (message.ok === true) {
            const value = cloneCommandJson(message.value)
            item.resolve?.(value); item.confirm(value)
        } else {
            const error = Object.assign(new Error(String(message.code || "BUSINESS_REJECTED")), { code: message.code })
            item.reject?.(error); item.deny(error)
        }
    })
    installRealtimeBusinessTransport((kind, payload) => {
        if (closed || !process.connected) return Promise.reject(new Error("BUSINESS_CHANNEL_CLOSED"))
        const requestId = ++sequence, proof = getRealtimeBusinessAdmission()
        const control = payload as { workId: string; proof?: unknown }
        const message = kind === "__tcp_work_begin__" ? { t: "tcp-work-begin", requestId, workId: control.workId }
            : kind === "__tcp_work_end__" ? { t: "tcp-work-end", requestId, workId: control.workId, businessAdmission: control.proof }
            : { t: "business-request", requestId, kind, payload,
                ...(proof === undefined ? {} : { businessAdmission: proof }) }
        const size = commandJsonBytes(message)
        if (kind === "__tcp_work_end__" && (pending.size >= 64 || bytes + size > 4 * 1024 * 1024)) {
            // End is a retained obligation, not a new optional business call.
            // Keep the grant held until an actual ACK frees capacity or the
            // channel disconnects; caller timeouts never free this budget.
            return new Promise<void>(resolve => { drainWaiters.add(resolve) }).then(() => transport!(kind, payload))
        }
        if (size > 256 * 1024 || pending.size >= 64 || bytes + size > 4 * 1024 * 1024) {
            return Promise.reject(Object.assign(new Error("BUSINESS_PENDING_BUDGET"), { code: "BUSINESS_PENDING_BUDGET" }))
        }
        return new Promise((resolve, reject) => {
            let confirm!: (result: unknown) => void, deny!: (error: Error) => void
            const confirmation = new Promise((yes, no) => { confirm = yes; deny = no })
            void confirmation.catch(() => {})
            const timer = setTimeout(() => {
                const item = pending.get(requestId)
                item?.reject?.(Object.assign(new Error("BUSINESS_OUTCOME_UNKNOWN"), { code: "BUSINESS_OUTCOME_UNKNOWN", confirmation }))
                // An uncertain transaction remains charged until its actual result or disconnect.
                if (item) { item.resolve = undefined; item.reject = undefined }
            }, 10_000)
            pending.set(requestId, { bytes: size, timer, resolve, reject, confirm, deny }); bytes += size
            try { process.send!(message, (error: Error | null) => { if (error) { fail(); process.disconnect() } }) }
            catch { fail(); if (process.connected) process.disconnect() }
        })
    })
    return fail
}
