import { performance } from "perf_hooks"
import { cloneCommandJson, commandJsonBytes, createRoomCommandId, RoomCommandError } from "./command-protocol"
import type { CommandJson, RoomCommandEnvelope, RoomCommandExpectedIdentity, RoomCommandResult, RoomCommandTransport } from "./command-protocol"

export interface RoomCommandExecuteOptions {
    commandId?: string
    timeoutMs?: number
    expectedIdentity?: RoomCommandExpectedIdentity
}
export interface RoomCommandGatewayOptions {
    timeoutMs?: number
    maxMessages?: number
    maxBytes?: number
    maxMessageBytes?: number
    maxAgeMs?: number
    now?: () => number
}
interface PendingRequest {
    at: number
    bytes: number
    rejectWaiter: (error: RoomCommandError) => void
}

/** Transport-neutral: production chooses one owner adapter; it never falls back on an uncertain write. */
export class RoomCommandGateway {
    private readonly pending = new Set<PendingRequest>()
    private readonly limits: Required<Omit<RoomCommandGatewayOptions, "now">>
    private readonly now: () => number
    private pendingBytes = 0
    private closed = false
    private readonly drainWaiters = new Set<() => void>()
    private boundOwnerEpoch: string | undefined

    constructor(private readonly transport: RoomCommandTransport, options: RoomCommandGatewayOptions = {}) {
        this.now = options.now ?? (() => performance.now())
        this.boundOwnerEpoch = transport.ownerEpoch
        this.limits = { timeoutMs: options.timeoutMs ?? 5000, maxMessages: options.maxMessages ?? 256,
            maxBytes: options.maxBytes ?? 4 * 1024 * 1024, maxMessageBytes: options.maxMessageBytes ?? 256 * 1024,
            maxAgeMs: options.maxAgeMs ?? 10000 }
        for (const [key, value] of Object.entries(this.limits)) if (!Number.isFinite(value) || value < 1) throw new Error(`Invalid gateway limit: ${key}`)
    }

    async execute(kind: string, payload: unknown, options: RoomCommandExecuteOptions = {}): Promise<unknown> {
        const commandId = options.commandId ?? createRoomCommandId()
        const timeoutMs = options.timeoutMs ?? this.limits.timeoutMs
        if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > this.limits.maxAgeMs) throw new RoomCommandError("INVALID_TIMEOUT", "Invalid command timeout", commandId, false)
        let command: RoomCommandEnvelope
        try {
            command = { protocol: 1, commandId, kind, payload: cloneCommandJson(payload) as CommandJson, timeoutMs }
            if (options.expectedIdentity !== undefined) command.expectedIdentity = cloneCommandJson(options.expectedIdentity)
            if (this.boundOwnerEpoch !== undefined) command.expectedOwnerEpoch = this.boundOwnerEpoch
            command = cloneCommandJson(command)
        } catch { throw new RoomCommandError("INVALID_JSON", "Command must be serializable JSON", commandId, false) }
        const result = await this.request(commandId, commandJsonBytes(command), timeoutMs, () => this.transport.submit(command))
        if (result.status === "completed") return cloneCommandJson(result.value)
        throw new RoomCommandError(result.code ?? "OUTCOME_UNKNOWN", result.reason ?? result.status, commandId, result.outcomeUnknown)
    }

    async queryResult(commandId: string): Promise<RoomCommandResult> {
        if (typeof commandId !== "string" || commandId.length > 128) throw new RoomCommandError("INVALID_COMMAND_ID", "Invalid query ID", "", false)
        return this.request(commandId, Buffer.byteLength(commandId, "utf8") + 64,
            Math.min(this.limits.timeoutMs, this.limits.maxAgeMs), () => this.transport.queryResult(commandId))
    }

    inspect() {
        let oldestPendingAgeMs = 0
        for (const request of this.pending) oldestPendingAgeMs = Math.max(oldestPendingAgeMs, this.now() - request.at)
        return { closed: this.closed, ownerEpoch: this.boundOwnerEpoch ?? null,
            pending: this.pending.size, pendingBytes: this.pendingBytes, oldestPendingAgeMs, limits: { ...this.limits } }
    }

    close(): void {
        this.closed = true
        for (const request of this.pending) request.rejectWaiter(new RoomCommandError("OUTCOME_UNKNOWN", "Gateway closed while request may be executing", "", true))
        // Do not release transport budgets until the actual application response settles.
    }

    async drain(): Promise<void> {
        while (this.pending.size) await new Promise<void>(resolve => this.drainWaiters.add(resolve))
    }

    private request(commandId: string, bytes: number, timeoutMs: number, operation: () => Promise<RoomCommandResult>): Promise<RoomCommandResult> {
        if (this.closed) return Promise.reject(new RoomCommandError("GATEWAY_CLOSED", "Gateway closed", commandId, false))
        if (bytes > this.limits.maxMessageBytes) return Promise.reject(new RoomCommandError("MESSAGE_BYTE_LIMIT", "Command too large", commandId, false))
        if (this.pending.size >= this.limits.maxMessages || this.pendingBytes + bytes > this.limits.maxBytes) return Promise.reject(new RoomCommandError("PENDING_BUDGET", "Gateway pending budget exhausted", commandId, false))
        const at = this.now()
        for (const request of this.pending) if (at - request.at >= this.limits.maxAgeMs) return Promise.reject(new RoomCommandError("PENDING_AGE_LIMIT", "Unresolved application ACK exceeds age budget", commandId, false))
        return new Promise<RoomCommandResult>((resolve, reject) => {
            let settled = false
            const fail = (error: RoomCommandError): void => { if (!settled) { settled = true; clearTimeout(timer); reject(error) } }
            const pending: PendingRequest = { at, bytes, rejectWaiter: error => fail(new RoomCommandError(error.code, error.message, commandId, error.outcomeUnknown)) }
            const deadline = at + timeoutMs
            const timer = setTimeout(() => fail(new RoomCommandError("OUTCOME_UNKNOWN", "Application ACK deadline elapsed; query the original commandId", commandId, true)), timeoutMs)
            this.pending.add(pending)
            this.pendingBytes += bytes
            void Promise.resolve().then(operation).then(raw => {
                try {
                    const result = cloneCommandJson(raw)
                    if (result.commandId !== commandId || typeof result.ownerEpoch !== "string" || !result.ownerEpoch
                        || !["pending", "completed", "rejected", "failed", "unknown"].includes(result.status)
                        || typeof result.outcomeUnknown !== "boolean") throw new Error("Invalid application result")
                    if (commandJsonBytes(result) > this.limits.maxMessageBytes
                        || result.outcomeUnknown !== !["completed", "rejected"].includes(result.status)
                        || (result.status === "completed" && !Object.prototype.hasOwnProperty.call(result, "value"))) throw new Error("Invalid application result shape/size")
                    if (this.boundOwnerEpoch !== undefined && result.ownerEpoch !== this.boundOwnerEpoch) throw new Error("Owner epoch changed")
                    this.boundOwnerEpoch = result.ownerEpoch
                    if (this.now() >= deadline) fail(new RoomCommandError("OUTCOME_UNKNOWN", "Application ACK arrived after local deadline", commandId, true))
                    if (!settled) { settled = true; clearTimeout(timer); resolve(result) }
                } catch { fail(new RoomCommandError("OUTCOME_UNKNOWN", "Invalid application ACK; reconcile with original owner", commandId, true)) }
            }, () => fail(new RoomCommandError("OUTCOME_UNKNOWN", "Transport failed; application outcome unknown", commandId, true))).finally(() => {
                this.pending.delete(pending)
                this.pendingBytes -= bytes
                for (const wake of this.drainWaiters) wake()
                this.drainWaiters.clear()
            })
        })
    }
}
