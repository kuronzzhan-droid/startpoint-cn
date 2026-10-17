import { performance } from "node:perf_hooks"
import { cloneCommandJson, commandJsonBytes, createRoomCommandId } from "./command-protocol"
import { getRoomCommandGateway, failRealtimeOwner } from "./default-runtime"
import type { RoomCommandGateway } from "./command-gateway"
import { createAcceptedRealtimeBusinessScope } from "./parent-business-admission"
import { assertServerAcceptingWork, hasServerWorkAdmission } from "../../lib/shutdown-state"

interface Event { id: string; kind: string; payload: unknown; bytes: number; at: number; attempts: number; timer?: NodeJS.Timeout;
    admission: ReturnType<typeof createAcceptedRealtimeBusinessScope> }
/** Reconcile already-durable notifications, never replay a payment or change the original command ID. */
export class DurableOwnerEventPublisher {
    private readonly events = new Map<string, Event>()
    private bytes = 0
    private quiescing = false
    private readonly waiters = new Set<() => void>()
    constructor(private readonly gateway: () => Pick<RoomCommandGateway, "execute" | "queryResult"> = getRoomCommandGateway,
        private readonly failOwner: () => Promise<void> = failRealtimeOwner,
        private readonly retryMs = 250, private readonly maxAgeMs = 60_000) {}
    inspect() { return { pending: this.events.size, pendingBytes: this.bytes } }
    private finish(event: Event): void {
        if (!this.events.delete(event.id)) return
        this.bytes -= event.bytes
        if (event.timer) clearTimeout(event.timer)
        event.admission.release()
        for (const wake of this.waiters) wake()
        this.waiters.clear()
    }
    private async failure(event: Event, reason: unknown): Promise<void> {
        this.finish(event)
        console.error(`[MULTI-REALTIME] durable event unresolved kind=${event.kind}; sealing owner`, reason)
        await this.failOwner()
    }
    private accepted(event: Event, value: unknown): unknown {
        if (value && typeof value === "object" && (value as { applied?: boolean }).applied === false
            && (event.kind === "battle.play.commit" || event.kind === "fiveBoss.start.commit")) {
            throw new Error("DURABLE_START_DECLINED")
        }
        this.finish(event)
        return value
    }
    async publish(kind: string, input: unknown): Promise<unknown | undefined> {
        assertServerAcceptingWork()
        if (this.quiescing && !hasServerWorkAdmission()) throw Object.assign(new Error("SERVER_CLOSING"), { code: "SERVER_CLOSING" })
        const payload = cloneCommandJson(input), bytes = commandJsonBytes(payload)
        if (this.events.size >= 128 || this.bytes + bytes > 4 * 1024 * 1024 || bytes > 256 * 1024) {
            await this.failOwner()
            console.error("[MULTI-REALTIME] durable event budget exhausted; owner sealed")
            return undefined
        }
        const id = createRoomCommandId()
        const event: Event = { id, kind, payload, bytes, at: performance.now(), attempts: 0,
            admission: createAcceptedRealtimeBusinessScope({ ownerEpoch: "durable-decision", commandId: id }) }
        this.events.set(event.id, event); this.bytes += bytes
        try { return this.accepted(event, await event.admission.run(() => this.gateway().execute(kind, payload, { commandId: event.id }))) }
        catch (error) {
            if (error instanceof Error && error.message === "DURABLE_START_DECLINED") { await this.failure(event, error); return undefined }
            console.warn(`[MULTI-REALTIME] durable event awaiting application confirmation kind=${kind}`)
            this.schedule(event)
            return undefined
        }
    }
    private schedule(event: Event): void {
        event.timer = setTimeout(() => { void event.admission.run(() => this.reconcile(event)) }, Math.min(5000, this.retryMs * 2 ** Math.min(event.attempts, 4)))
        event.timer.unref()
    }
    private async reconcile(event: Event): Promise<void> {
        if (!this.events.has(event.id)) return
        if (performance.now() - event.at >= this.maxAgeMs || event.attempts++ >= 8) {
            await this.failure(event, new Error("DURABLE_EVENT_CONFIRMATION_DEADLINE")); return
        }
        try {
            const result = await this.gateway().queryResult(event.id)
            if (result.status === "completed") { this.accepted(event, result.value); return }
            if (result.status !== "pending") {
                // The executor deduplicates this exact ID even after a lost ACK.
                this.accepted(event, await this.gateway().execute(event.kind, event.payload, { commandId: event.id }))
                return
            }
        } catch (error) {
            if (error instanceof Error && error.message === "DURABLE_START_DECLINED") { await this.failure(event, error); return }
        }
        this.schedule(event)
    }
    quiesce(): void { this.quiescing = true }
    resume(): void {
        if (this.events.size) throw new Error("DURABLE_EVENTS_STILL_PENDING")
        this.quiescing = false
    }
    async drain(): Promise<void> {
        while (this.events.size) await new Promise<void>(resolve => this.waiters.add(resolve))
    }
}
const publisher = new DurableOwnerEventPublisher()
export function publishDurableOwnerDecision(kind: string, payload: unknown): Promise<unknown | undefined> {
    return publisher.publish(kind, payload)
}
export function inspectDurableOwnerEvents() { return publisher.inspect() }
export function quiesceDurableOwnerEvents(): void { publisher.quiesce() }
export function drainDurableOwnerEvents(): Promise<void> { return publisher.drain() }
export function resumeDurableOwnerEvents(): void { publisher.resume() }
