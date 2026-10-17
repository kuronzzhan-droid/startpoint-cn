import { randomUUID } from "crypto"
import { performance } from "perf_hooks"
import { cloneCommandJson, commandJsonBytes, roomCommandFingerprint, roomCommandIssuedAt } from "./command-protocol"
import type { CommandJson, RoomCommandEnvelope, RoomCommandExpectedIdentity, RoomCommandResult, RoomCommandTransport } from "./command-protocol"

export interface RoomCommandContext {
    commandId: string
    ownerEpoch: string
    expectedIdentity?: RoomCommandExpectedIdentity
    /** Executor-local monotonic duration; handlers must enforce identity before mutation. */
    remainingMs(): number
}
export type RoomCommandHandler = (payload: unknown, context: RoomCommandContext) => unknown | Promise<unknown>

export interface RoomCommandExecutorOptions {
    maxMessages?: number
    maxBytes?: number
    maxMessageBytes?: number
    maxAgeMs?: number
    maxConcurrent?: number
    maxRecords?: number
    maxRetainedBytes?: number
    maxResultBytes?: number
    resultRetentionMs?: number
    futureClockSkewMs?: number
    now?: () => number
    wallNow?: () => number
    ownerEpoch?: string
}

interface CommandRecord {
    command: RoomCommandEnvelope
    fingerprint: string
    at: number
    deadline: number
    issuedAt: number
    bytes: number
    retainedBytes: number
    running: boolean
    result: RoomCommandResult
    promise: Promise<RoomCommandResult>
    resolve: (result: RoomCommandResult) => void
}

/** No room or DB imports: only the registered owner handlers can mutate authority. */
export class RoomCommandExecutor implements RoomCommandTransport {
    readonly ownerEpoch: string
    private readonly handlers = new Map<string, RoomCommandHandler>()
    private readonly records = new Map<string, CommandRecord>()
    private readonly queue: CommandRecord[] = []
    private readonly limits: Required<Omit<RoomCommandExecutorOptions, "now" | "wallNow" | "ownerEpoch">>
    private readonly now: () => number
    private readonly wallNow: () => number
    private wallFloor = 0
    private pending = 0
    private pendingBytes = 0
    private retainedBytes = 0
    private running = 0
    private duplicateWaiters = 0
    private closed = false
    private quiescing = false
    private handlerContext: (commandId: string, operation: () => unknown) => unknown = (_id, operation) => operation()
    private pumping = false

    constructor(options: RoomCommandExecutorOptions = {}) {
        this.ownerEpoch = options.ownerEpoch ?? randomUUID()
        if (!this.ownerEpoch || this.ownerEpoch.length > 128) throw new Error("Invalid owner epoch")
        this.now = options.now ?? (() => performance.now())
        this.wallNow = options.wallNow ?? (() => Date.now())
        this.limits = {
            maxMessages: options.maxMessages ?? 256,
            maxBytes: options.maxBytes ?? 4 * 1024 * 1024,
            maxMessageBytes: options.maxMessageBytes ?? 256 * 1024,
            maxAgeMs: options.maxAgeMs ?? 10000,
            maxConcurrent: options.maxConcurrent ?? 16,
            maxRecords: options.maxRecords ?? 8192,
            maxRetainedBytes: options.maxRetainedBytes ?? 64 * 1024 * 1024,
            maxResultBytes: options.maxResultBytes ?? 256 * 1024,
            resultRetentionMs: options.resultRetentionMs ?? 300000,
            futureClockSkewMs: options.futureClockSkewMs ?? 1000,
        }
        for (const [key, value] of Object.entries(this.limits)) {
            if (!Number.isFinite(value) || value < (key === "futureClockSkewMs" ? 0 : 1)) throw new Error(`Invalid executor limit: ${key}`)
            if (["maxMessages", "maxBytes", "maxMessageBytes", "maxConcurrent", "maxRecords", "maxRetainedBytes", "maxResultBytes"].includes(key)
                && !Number.isSafeInteger(value)) throw new Error(`Invalid integer executor limit: ${key}`)
        }
    }

    register<TPayload = unknown, TResult = unknown>(kind: string, handler: (payload: TPayload, context: RoomCommandContext) => TResult | Promise<TResult>): void {
        if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(kind) || typeof handler !== "function") throw new Error("Invalid command handler")
        if (this.handlers.has(kind)) throw new Error(`Command handler already registered: ${kind}`)
        if (this.closed) throw new Error("Executor closed")
        this.handlers.set(kind, handler as RoomCommandHandler)
    }

    setHandlerContext(runner: (commandId: string, operation: () => unknown) => unknown): void { this.handlerContext = runner }

    async submit(input: RoomCommandEnvelope, acceptedContinuation = false): Promise<RoomCommandResult> {
        let command: RoomCommandEnvelope
        try { command = cloneCommandJson(input) } catch {
            return this.reject(typeof input?.commandId === "string" ? input.commandId : "", "INVALID_JSON")
        }
        if (!command || typeof command !== "object" || Array.isArray(command)) return this.reject("", "INVALID_COMMAND")
        const id = typeof command.commandId === "string" ? command.commandId : ""
        const wall = this.advanceWall()
        this.pruneAt(wall)
        const issuedAt = typeof id === "string" ? roomCommandIssuedAt(id) : undefined
        if (command.protocol !== 1 || typeof command.kind !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(command.kind)
            || issuedAt === undefined || !Number.isFinite(command.timeoutMs) || command.timeoutMs < 1) return this.reject(id, "INVALID_COMMAND")
        if (!Object.prototype.hasOwnProperty.call(command, "payload")) return this.reject(id, "INVALID_COMMAND")
        if (command.expectedIdentity !== undefined && (!command.expectedIdentity || typeof command.expectedIdentity !== "object" || Array.isArray(command.expectedIdentity))) return this.reject(id, "INVALID_COMMAND")
        if (command.expectedOwnerEpoch !== undefined && command.expectedOwnerEpoch !== this.ownerEpoch) return this.reject(id, "OWNER_EPOCH_MISMATCH")
        if (issuedAt > wall + this.limits.futureClockSkewMs || wall - issuedAt >= this.limits.resultRetentionMs) return this.reject(id, "COMMAND_ID_EXPIRED")
        const fingerprint = roomCommandFingerprint(command)
        const previous = this.records.get(id)
        if (previous) {
            if (previous.fingerprint !== fingerprint) return this.reject(id, "COMMAND_ID_COLLISION")
            if (previous.result.status !== "pending") return cloneCommandJson(previous.result)
            if (this.duplicateWaiters >= this.limits.maxMessages) return this.reject(id, "ACK_WAITER_BUDGET")
            this.duplicateWaiters++
            try { return cloneCommandJson(await previous.promise) }
            finally { this.duplicateWaiters-- }
        }
        if (this.closed) return this.reject(id, "EXECUTOR_CLOSED")
        if (this.quiescing && !acceptedContinuation) return this.reject(id, "SERVER_CLOSING")
        const bytes = commandJsonBytes(command)
        if (bytes > this.limits.maxMessageBytes) return this.reject(id, "MESSAGE_BYTE_LIMIT")
        if (this.pending >= this.limits.maxMessages || this.pendingBytes + bytes > this.limits.maxBytes) return this.reject(id, "PENDING_BUDGET")
        const now = this.now()
        if ([...this.records.values()].some(record => record.result.status === "pending" && now - record.at >= this.limits.maxAgeMs)) return this.reject(id, "PENDING_AGE_LIMIT")
        // Reserve room for the application ACK before admitting any mutation.
        const reservation = bytes + Math.max(1024, this.limits.maxResultBytes)
        if (this.records.size >= this.limits.maxRecords || this.retainedBytes + reservation > this.limits.maxRetainedBytes) return this.reject(id, "RESULT_BUDGET")
        let resolve!: (result: RoomCommandResult) => void
        const promise = new Promise<RoomCommandResult>(done => { resolve = done })
        const record: CommandRecord = { command, fingerprint, at: now, issuedAt,
            deadline: now + Math.min(command.timeoutMs, this.limits.maxAgeMs), bytes,
            retainedBytes: reservation, running: false, promise, resolve,
            result: { commandId: id, ownerEpoch: this.ownerEpoch, status: "pending", outcomeUnknown: true } }
        this.records.set(id, record)
        this.queue.push(record)
        this.pending++
        this.pendingBytes += bytes
        this.retainedBytes += reservation
        queueMicrotask(() => this.pump())
        return cloneCommandJson(await promise)
    }

    async queryResult(commandId: string): Promise<RoomCommandResult> {
        this.pruneAt(this.advanceWall())
        const record = this.records.get(commandId)
        return record ? cloneCommandJson(record.result) : {
            commandId, ownerEpoch: this.ownerEpoch, status: "unknown", outcomeUnknown: true,
            code: "RESULT_NOT_RETAINED", reason: "No retained result in this owner epoch; do not replay automatically",
        }
    }

    /** Expiry permanently rejects that timestamped ID; no forgotten-ID replay window. */
    prune(): void { this.pruneAt(this.advanceWall()) }

    inspect() {
        this.prune()
        const now = this.now()
        let oldestPendingAgeMs = 0
        for (const record of this.records.values()) if (record.result.status === "pending") oldestPendingAgeMs = Math.max(oldestPendingAgeMs, now - record.at)
        return { ownerEpoch: this.ownerEpoch, closed: this.closed, pending: this.pending,
            duplicateWaiters: this.duplicateWaiters,
            running: this.running, queued: this.queue.length, pendingBytes: this.pendingBytes,
            records: this.records.size, retainedBytes: this.retainedBytes,
            oldestPendingAgeMs, limits: { ...this.limits } }
    }

    close(): void {
        this.closed = true
        for (const record of this.queue.splice(0)) this.finish(record, this.reject(record.command.commandId, "EXECUTOR_CLOSED"))
        // Already-running handlers cannot safely be cancelled; their results remain queryable.
    }

    /** Withdraw fresh admission without discarding already queued handlers. */
    quiesce(): void { this.quiescing = true }
    async drain(): Promise<void> {
        while (this.pending) await Promise.allSettled([...this.records.values()]
            .filter(record => record.result.status === "pending").map(record => record.promise))
    }

    private advanceWall(): number {
        this.wallFloor = Math.max(this.wallFloor, this.wallNow())
        return this.wallFloor
    }

    private pruneAt(wall: number): void {
        for (const [id, record] of this.records) {
            if (record.result.status !== "pending" && wall - record.issuedAt >= this.limits.resultRetentionMs) {
                this.records.delete(id)
                this.retainedBytes -= record.retainedBytes
            }
        }
    }

    private reject(commandId: string, code: string): RoomCommandResult {
        return { commandId, ownerEpoch: this.ownerEpoch, status: "rejected", outcomeUnknown: false, code, reason: code }
    }

    private pump(): void {
        if (this.pumping) return
        this.pumping = true
        try {
            while (!this.closed && this.running < this.limits.maxConcurrent && this.queue.length) {
                const record = this.queue.shift()!
                const handler = this.handlers.get(record.command.kind)
                if (this.now() >= record.deadline) { this.finish(record, this.reject(record.command.commandId, "EXPIRED_BEFORE_APPLY")); continue }
                if (!handler) { this.finish(record, this.reject(record.command.commandId, "UNKNOWN_KIND")); continue }
                record.running = true
                this.running++
                const context: RoomCommandContext = { commandId: record.command.commandId, ownerEpoch: this.ownerEpoch,
                    remainingMs: () => Math.max(0, record.deadline - this.now()) }
                if (record.command.expectedIdentity !== undefined) context.expectedIdentity = cloneCommandJson(record.command.expectedIdentity)
                void Promise.resolve().then(() => this.handlerContext(record.command.commandId,
                    () => handler(cloneCommandJson(record.command.payload), context))).then(value => {
                    let result: RoomCommandResult
                    try {
                        const copied = cloneCommandJson(value) as CommandJson
                        result = { commandId: record.command.commandId, ownerEpoch: this.ownerEpoch,
                            status: "completed", outcomeUnknown: false, value: copied }
                        if (commandJsonBytes(result) > this.limits.maxResultBytes) throw new Error("Result too large")
                    } catch {
                        result = { commandId: record.command.commandId, ownerEpoch: this.ownerEpoch,
                            status: "failed", outcomeUnknown: true, code: "RESULT_NOT_SERIALIZABLE_OR_TOO_LARGE", reason: "Handler ran; result unavailable" }
                    }
                    this.finish(record, result)
                }, () => this.finish(record, { commandId: record.command.commandId, ownerEpoch: this.ownerEpoch,
                    status: "failed", outcomeUnknown: true, code: "HANDLER_FAILED", reason: "Handler failed after starting; reconcile before retry" }))
            }
        } finally { this.pumping = false }
    }

    private finish(record: CommandRecord, result: RoomCommandResult): void {
        record.result = result
        this.pending--
        this.pendingBytes -= record.bytes
        if (record.running) { record.running = false; this.running-- }
        const finalBytes = record.bytes + commandJsonBytes(result)
        this.retainedBytes += finalBytes - record.retainedBytes
        record.retainedBytes = finalBytes
        record.resolve(result)
        queueMicrotask(() => this.pump())
    }
}
