// Transport completion only releases the Node send slot. An explicit peer
// acknowledgement releases the application budget after the message is applied.
import { BoundedLatencyHistogram } from "../../latency-statistics"

export type RelayIpcWire<T> = { t: "relay-ipc"; seq: number; body: T } | { t: "relay-ipc-ack"; seq: number }
export interface RelayIpcLimits { maxMessages: number; maxBytes: number; maxAgeMs: number }
type Callback = (error?: Error | null) => void
type Sender<T> = (message: RelayIpcWire<T>, handle: unknown | undefined, callback: Callback) => boolean
interface Pending<T> { seq: number; body: T; handle?: unknown; bytes: number; at: number; sent: boolean; transported?: Callback }

function positive(name: string, fallback: number): number {
    const n = Number.parseInt(process.env[name] ?? "", 10)
    return Number.isFinite(n) && n > 0 ? n : fallback
}
export function relayIpcLimits(): RelayIpcLimits {
    return { maxMessages: positive("MULTI_BATTLE_RELAY_IPC_MAX_MESSAGES", 512),
        maxBytes: positive("MULTI_BATTLE_RELAY_IPC_MAX_BYTES", 8 * 1024 * 1024),
        maxAgeMs: positive("MULTI_BATTLE_RELAY_IPC_MAX_AGE_MS", 15_000) }
}

export class BoundedRelayIpc<T> {
    private sequence = 0
    private received = 0
    private readonly pending = new Map<number, Pending<T>>()
    private bytes = 0
    private ackCount = 0
    private ackBytes = 0
    private readonly acknowledgements = new Map<number, number>()
    private transportBusy = false
    private closed = false
    private fault: string | null = null
    private maxMessages = 0
    private maxBytes = 0
    private transportBackpressure = 0
    private readonly applicationAckRtt = new BoundedLatencyHistogram()
    private readonly sendQueueWait = new BoundedLatencyHistogram()
    private readonly timer: NodeJS.Timeout

    constructor(private readonly sender: Sender<T>, private readonly failed: (reason: string) => void,
        readonly limits = relayIpcLimits(), private readonly now: () => number = () => performance.now()) {
        this.timer = setInterval(() => this.checkAge(), Math.max(10, Math.min(250, limits.maxAgeMs)))
        this.timer.unref()
    }

    enqueue(body: T, handle?: unknown, transported?: Callback): boolean {
        if (this.closed) { transported?.(new Error(this.fault ?? "ipc_closed")); return false }
        let bytes: number
        try { bytes = Buffer.byteLength(JSON.stringify(body), "utf8") + 64 }
        catch { this.fail("ipc_serialization"); transported?.(new Error("ipc_serialization")); return false }
        if (this.pending.size + this.ackCount >= this.limits.maxMessages
            || this.bytes + this.ackBytes + bytes > this.limits.maxBytes) {
            this.fail("ipc_queue_limit"); transported?.(new Error("ipc_queue_limit")); return false
        }
        const item = { seq: ++this.sequence, body, handle, transported, bytes, at: this.now(), sent: false }
        this.pending.set(item.seq, item)
        this.bytes += bytes
        this.maxMessages = Math.max(this.maxMessages, this.pending.size + this.ackCount)
        this.maxBytes = Math.max(this.maxBytes, this.bytes + this.ackBytes)
        this.pump()
        return !this.closed
    }

    receive<U>(message: RelayIpcWire<U>, handle: unknown,
        apply: (body: U, handle: unknown) => void | Promise<void>): void {
        if (this.closed) return
        if (!message || !Number.isSafeInteger(message.seq) || message.seq <= 0) { this.fail("ipc_invalid_sequence"); return }
        if (message.t === "relay-ipc-ack") {
            const item = this.pending.get(message.seq)
            if (!item?.sent) { this.fail("ipc_unknown_ack"); return }
            this.applicationAckRtt.record(this.now() - item.at)
            this.pending.delete(message.seq)
            this.bytes -= item.bytes
            return
        }
        if (message.t !== "relay-ipc" || message.seq !== this.received + 1) { this.fail("ipc_receive_order"); return }
        this.received = message.seq
        try {
            const result = apply(message.body, handle)
            if (result && typeof result.then === "function") {
                void result.then(() => this.acknowledge(message.seq), () => this.fail("ipc_apply_failed"))
            } else this.acknowledge(message.seq)
        } catch { this.fail("ipc_apply_failed") }
    }

    private acknowledge(seq: number): void {
        if (this.closed) return
        const bytes = 64
        if (this.pending.size + this.ackCount >= this.limits.maxMessages
            || this.bytes + this.ackBytes + bytes > this.limits.maxBytes) { this.fail("ipc_ack_queue_limit"); return }
        this.ackCount++; this.ackBytes += bytes
        this.acknowledgements.set(seq, this.now())
        let finished = false
        const callback: Callback = error => {
            if (finished) return
            finished = true
            this.ackCount--; this.ackBytes -= bytes
            this.acknowledgements.delete(seq)
            if (error) this.fail("ipc_ack_send_failed")
        }
        try { if (!this.sender({ t: "relay-ipc-ack", seq }, undefined, callback)) this.transportBackpressure++ }
        catch { callback(new Error("ipc_ack_send_threw")) }
    }

    private pump(): void {
        if (this.closed || this.transportBusy) return
        const item = [...this.pending.values()].find(value => !value.sent)
        if (!item) return
        item.sent = true
        this.sendQueueWait.record(this.now() - item.at)
        this.transportBusy = true
        let finished = false
        const callback: Callback = error => {
            if (finished) return
            finished = true
            this.transportBusy = false
            const transported = item.transported; item.transported = undefined
            transported?.(error)
            if (error) this.fail("ipc_send_failed")
            else queueMicrotask(() => this.pump())
        }
        try {
            if (!this.sender({ t: "relay-ipc", seq: item.seq, body: item.body }, item.handle, callback)) this.transportBackpressure++
        } catch { callback(new Error("ipc_send_threw")) }
    }

    checkAge(): void {
        if (this.closed) return
        for (const item of this.pending.values()) {
            if (this.now() - item.at >= this.limits.maxAgeMs) { this.fail("ipc_application_timeout"); return }
        }
        for (const at of this.acknowledgements.values()) {
            if (this.now() - at >= this.limits.maxAgeMs) { this.fail("ipc_ack_timeout"); return }
        }
    }

    stats() {
        return { applicationAckRttMs: this.applicationAckRtt.snapshot(), sendQueueWaitMs: this.sendQueueWait.snapshot(),
            applicationAckRttDefinition: "same initiating process monotonic enqueue-to-application-ACK; includes send queue, peer apply and ACK return; not TCP RTT" as const,
            sendQueueWaitDefinition: "same process enqueue-to-Node-send-attempt; transport callback is not peer application" as const,
            applicationAckSampling: "successful application ACKs only; timeout and closure remain explicit channel faults" as const }
    }

    diagnostics() {
        return { closed: this.closed, fault: this.fault, pendingMessages: this.pending.size, pendingBytes: this.bytes,
            ackPending: this.ackCount, oldestAgeMs: Math.max(0, ...[...this.pending.values()].map(x => this.now() - x.at)),
            maxMessages: this.maxMessages, maxBytes: this.maxBytes, transportBackpressure: this.transportBackpressure, ...this.stats() }
    }

    pendingBytesFor(matches: (body: T) => boolean): number {
        let bytes = 0
        for (const item of this.pending.values()) if (matches(item.body)) bytes += item.bytes
        return bytes
    }

    private fail(reason: string): void {
        if (this.closed) return
        this.fault = reason
        this.close(reason)
        this.failed(reason)
    }

    close(reason = "ipc_closed"): void {
        if (this.closed) return
        this.closed = true
        clearInterval(this.timer)
        for (const item of this.pending.values()) {
            const transported = item.transported; item.transported = undefined
            transported?.(new Error(reason))
        }
        this.pending.clear(); this.bytes = 0
    }
}
