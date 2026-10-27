import { fork, ChildProcess } from "node:child_process"
import * as path from "node:path"
import { cloneCommandJson, commandJsonBytes } from "./command-protocol"
import type { RoomCommandEnvelope, RoomCommandResult, RoomCommandTransport } from "./command-protocol"
import { createAcceptedRealtimeBusinessScope, dispatchAcceptedRealtimeBusiness } from "./parent-business-admission"
import { hasServerWorkAdmission, isServerShuttingDown } from "../../lib/shutdown-state"

export interface CommandProcessOptions {
    /** Explicit trusted bootstrap; no room manager or TCP listener is loaded by default. */
    registerModule: string
    childPath?: string
    maxPending?: number
    maxPendingBytes?: number
    startTimeoutMs?: number
    requestTimeoutMs?: number
    childEnv?: NodeJS.ProcessEnv
    businessHandler?: (kind: string, payload: unknown) => Promise<unknown>
    inheritOutput?: boolean
}
interface Pending {
    commandId: string
    bytes: number
    resolve?: (result: RoomCommandResult) => void
    timer: NodeJS.Timeout
    admission?: ReturnType<typeof createAcceptedRealtimeBusinessScope>
}

/** Explicit process transport for the serializable command kernel. No embedded fallback. */
export class CommandProcessTransport implements RoomCommandTransport {
    private child?: ChildProcess
    private readonly pending = new Map<number, Pending>()
    private bytes = 0
    private sequence = 0
    private epoch = "unavailable"
    private ready = false
    private closed = false
    private quiescing = false
    private quiesced?: Promise<void>
    private stopped?: Promise<void>
    private readonly controls = new Map<number, { resolve(): void; reject(error: Error): void }>()
    private readonly drainWaiters = new Set<() => void>()
    private metadata: unknown = null
    private businessPending = 0
    private businessBytes = 0
    private ingressAdmission?: ReturnType<typeof createAcceptedRealtimeBusinessScope>
    private ingressClosed = false
    private readonly tcpWork = new Map<string, ReturnType<typeof createAcceptedRealtimeBusinessScope>>()
    readonly maxPending: number
    readonly maxPendingBytes: number

    constructor(private readonly options: CommandProcessOptions) {
        if (!path.isAbsolute(options.registerModule)) throw new Error("registerModule must be an explicit absolute path")
        if (options.childPath !== undefined && !path.isAbsolute(options.childPath)) throw new Error("childPath must be absolute")
        this.maxPending = options.maxPending ?? 64
        this.maxPendingBytes = options.maxPendingBytes ?? 1024 * 1024
        for (const [name, value, maximum] of [["maxPending", this.maxPending, 4096],
            ["maxPendingBytes", this.maxPendingBytes, 64 * 1024 * 1024]] as const) {
            if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new Error(`invalid ${name}`)
        }
        for (const value of [options.startTimeoutMs ?? 5000, options.requestTimeoutMs ?? 1000]) {
            if (!Number.isSafeInteger(value) || value < 10 || value > 60_000) throw new Error("invalid process timeout")
        }
    }

    get ownerEpoch(): string | undefined { return this.epoch === "unavailable" ? undefined : this.epoch }
    get pid(): number | undefined { return this.child?.pid }
    get isReady(): boolean { return this.ready && !this.closed && this.child?.connected === true }
    /** Bootstrap metadata is copied; production bootstraps need not expose any endpoint. */
    bootstrapMetadata<T = unknown>(): T { return cloneCommandJson(this.metadata) as T }
    diagnostics() { return { ready: this.ready, closed: this.closed, ownerEpoch: this.epoch,
        pendingMessages: this.pending.size, pendingBytes: this.bytes,
        businessPending: this.businessPending, businessPendingBytes: this.businessBytes,
        tcpWorkPending: this.tcpWork.size, ingressClosed: this.ingressClosed, quiescing: this.quiescing } }

    async start(): Promise<void> {
        if (this.child || this.closed) throw new Error("command process cannot be started twice")
        this.ingressAdmission = createAcceptedRealtimeBusinessScope({ ownerEpoch: "starting-owner", commandId: "tcp-ingress" })
        let child: ChildProcess
        try { child = this.child = fork(this.options.childPath ?? path.join(__dirname, "command-process-child.js"),
            [JSON.stringify({ registerModule: this.options.registerModule, maxPending: this.maxPending,
                maxPendingBytes: this.maxPendingBytes })], { stdio: ["ignore", this.options.inheritOutput ? "inherit" : "ignore", this.options.inheritOutput ? "inherit" : "ignore", "ipc"],
                serialization: "json", execArgv: [], env: { ...process.env, ...this.options.childEnv } }) }
        catch (error) { this.failPending("PROCESS_FORK_FAILED"); throw error }
        await new Promise<void>((resolve, reject) => {
            let starting = true
            const fail = (reason: string) => {
                this.failPending(reason)
                if (starting) { starting = false; clearTimeout(timer); reject(new Error(reason)) }
            }
            const timer = setTimeout(() => { fail("PROCESS_START_TIMEOUT"); child.kill() }, this.options.startTimeoutMs ?? 5000)
            child.on("error", () => fail("PROCESS_ERROR"))
            child.on("disconnect", () => fail("PROCESS_DISCONNECTED"))
            child.on("exit", () => fail("PROCESS_EXITED"))
            child.on("close", () => fail("PROCESS_CLOSED"))
            child.on("message", (message: any) => {
                if (message?.t === "tcp-work-begin" || message?.t === "tcp-work-end") {
                    this.handleTcpWork(message, child); return
                }
                if (message?.t === "business-request") {
                    void this.handleBusiness(message, child)
                    return
                }
                if (message?.t === "command-quiesced" || message?.t === "command-drained") {
                    if (message.t === "command-quiesced") {
                        this.ingressClosed = true; this.ingressAdmission?.release(); this.ingressAdmission = undefined
                    }
                    const control = this.controls.get(message.requestId)
                    if (control) { this.controls.delete(message.requestId); control.resolve() }
                    return
                }
                if (message?.t === "command-ready" && starting && typeof message.ownerEpoch === "string") {
                    this.epoch = message.ownerEpoch
                    this.metadata = cloneCommandJson(message.metadata ?? null)
                    this.ready = true; starting = false; clearTimeout(timer); resolve()
                } else if (message?.t === "command-start-failed") {
                    fail("PROCESS_BOOTSTRAP_FAILED"); child.kill()
                } else if (message?.t === "command-result") {
                    const item = this.pending.get(message.requestId)
                    if (!item) return // A late response cannot release any other request.
                    const result = message.result
                    const knownStatuses = ["pending", "completed", "rejected", "failed", "unknown"]
                    if (result?.commandId !== item.commandId || result?.ownerEpoch !== this.epoch
                        || !knownStatuses.includes(result.status)
                        || result.outcomeUnknown !== !["completed", "rejected"].includes(result.status)
                        || (result.status === "completed" && !Object.prototype.hasOwnProperty.call(result, "value"))) {
                        fail("PROCESS_INVALID_RESULT"); child.kill(); return
                    }
                    this.pending.delete(message.requestId); this.bytes -= item.bytes; clearTimeout(item.timer)
                    item.admission?.release()
                    item.resolve?.(cloneCommandJson(message.result))
                    this.changed()
                }
            })
        })
    }

    /** The child-to-parent FIFO cutoff bounds trusted TCP work registration. */
    private handleTcpWork(message: any, child: ChildProcess): void {
        const id = message.requestId
        if (!Number.isSafeInteger(id) || id <= 0) { this.failPending("TCP_WORK_INVALID_REQUEST"); child.kill(); return }
        const reply = (body: object) => {
            if (!child.connected) return
            try { child.send({ t: "tcp-work-result", requestId: id, ...body }, error => { if (error) this.failPending("TCP_WORK_SEND_FAILED") }) }
            catch { this.failPending("TCP_WORK_SEND_FAILED") }
        }
        const workId = message.workId
        let size: number
        try { size = commandJsonBytes(message) } catch { reply({ ok: false, code: "TCP_WORK_INVALID_REQUEST" }); return }
        if (typeof workId !== "string" || !/^tcp\.[a-f0-9-]{36}$/.test(workId) || size > 4096) {
            reply({ ok: false, code: "TCP_WORK_INVALID_REQUEST" }); return
        }
        if (message.t === "tcp-work-end") {
            const scope = this.tcpWork.get(workId), proof = message.businessAdmission
            if (!scope || !proof || Object.keys(proof).length !== 3 || proof.ownerEpoch !== scope.proof.ownerEpoch
                || proof.commandId !== scope.proof.commandId || proof.admissionToken !== scope.proof.admissionToken) {
                reply({ ok: false, code: "TCP_WORK_INVALID_ADMISSION" }); return
            }
            scope.release(); this.tcpWork.delete(workId); reply({ ok: true, value: null }); this.changed(); return
        }
        if (this.closed || this.ingressClosed || !this.ingressAdmission || this.tcpWork.size >= 128 || this.tcpWork.has(workId)) {
            reply({ ok: false, code: "SERVER_CLOSING" }); return
        }
        try {
            let scope!: ReturnType<typeof createAcceptedRealtimeBusinessScope>
            // Registration can cross global close only before the child's cutoff ACK.
            void this.ingressAdmission.run(async () => {
                scope = createAcceptedRealtimeBusinessScope({ ownerEpoch: this.epoch, commandId: workId })
            }).catch(error => reply({ ok: false, code: String(error?.code || "TCP_WORK_REJECTED") }))
            if (scope) { this.tcpWork.set(workId, scope); reply({ ok: true, value: scope.proof }) }
        } catch (error) { reply({ ok: false, code: String((error as { code?: string })?.code || "TCP_WORK_REJECTED") }) }
    }

    private async handleBusiness(message: any, child: ChildProcess): Promise<void> {
        if (!Number.isSafeInteger(message.requestId) || message.requestId <= 0 || typeof message.kind !== "string"
            || message.kind.length > 128 || !this.options.businessHandler) { this.failPending("BUSINESS_INVALID_REQUEST"); child.kill(); return }
        let size: number
        try { size = commandJsonBytes(message) } catch { this.failPending("BUSINESS_INVALID_JSON"); child.kill(); return }
        const reply = (body: object) => {
            if (!child.connected) return
            try { child.send({ t: "business-result", requestId: message.requestId, ...body }, error => {
                if (error) { this.failPending("BUSINESS_SEND_FAILED"); child.kill() }
            }) } catch { this.failPending("BUSINESS_SEND_FAILED"); child.kill() }
        }
        if (size > 256 * 1024 || this.businessPending >= 64 || this.businessBytes + size > 4 * 1024 * 1024) {
            reply({ ok: false, code: "BUSINESS_PENDING_BUDGET" }); return
        }
        this.businessPending++; this.businessBytes += size
        let admission: ReturnType<typeof createAcceptedRealtimeBusinessScope> | undefined
        try {
            if (message.kind.startsWith("riven.") && message.payload?.identity?.ownerEpoch !== this.epoch) {
                throw Object.assign(new Error("RIVEN_OWNER_EPOCH_MISMATCH"), { code: "RIVEN_OWNER_EPOCH_MISMATCH" })
            }
            const operation = () => this.options.businessHandler!(message.kind, cloneCommandJson(message.payload))
            let result: unknown
            if (message.businessAdmission !== undefined) {
                if (message.businessAdmission?.ownerEpoch !== this.epoch) throw Object.assign(new Error("BUSINESS_OWNER_EPOCH_MISMATCH"), { code: "BUSINESS_OWNER_EPOCH_MISMATCH" })
                result = await dispatchAcceptedRealtimeBusiness(message.businessAdmission, operation)
            } else {
                if (this.quiescing || this.closed || isServerShuttingDown()) throw Object.assign(new Error("SERVER_CLOSING"), { code: "SERVER_CLOSING" })
                admission = createAcceptedRealtimeBusinessScope({ ownerEpoch: this.epoch, commandId: `tcp:${message.requestId}` })
                result = await admission.run(operation)
            }
            const value = cloneCommandJson(result)
            if (commandJsonBytes(value) > 480 * 1024) throw Object.assign(new Error("Business result too large"), { code: "BUSINESS_RESULT_LIMIT" })
            reply({ ok: true, value })
        } catch (error) {
            const failure = error as { code?: string; message?: string }
            // Older parents signal an unsupported optional Riven RPC with a plain Error.
            // Preserve only these explicit availability failures, never generic business errors.
            const unavailable = message.kind.startsWith("riven.")
                && ["UNKNOWN_REALTIME_BUSINESS_KIND", "UNKNOWN_RIVEN_BUSINESS_KIND"].includes(failure?.message ?? "")
            reply({ ok: false, code: String(failure?.code || (unavailable ? failure.message : "BUSINESS_HANDLER_FAILED")) })
        }
        finally { admission?.release(); this.businessPending--; this.businessBytes -= size; this.changed() }
    }

    submit(envelope: RoomCommandEnvelope): Promise<RoomCommandResult> {
        let command: RoomCommandEnvelope
        try { command = cloneCommandJson(envelope) }
        catch { return Promise.resolve(this.result(envelope?.commandId ?? "", "rejected", "INVALID_JSON", false)) }
        if (!command || typeof command !== "object" || Array.isArray(command)
            || typeof command.commandId !== "string" || command.commandId.length > 128) {
            return Promise.resolve(this.result("", "rejected", "INVALID_COMMAND", false))
        }
        command.expectedOwnerEpoch ??= this.epoch
        const duration = Number.isFinite(command.timeoutMs) && command.timeoutMs > 0 ? command.timeoutMs : 1000
        return this.request({ t: "command-submit", envelope: command }, command.commandId,
            Math.min(60_000, duration + (this.options.requestTimeoutMs ?? 1000)))
    }

    queryResult(commandId: string): Promise<RoomCommandResult> {
        if (typeof commandId !== "string" || commandId.length > 128) return Promise.resolve(this.result("", "rejected", "INVALID_COMMAND_ID", false))
        return this.request({ t: "command-query", commandId }, commandId, this.options.requestTimeoutMs ?? 1000)
    }

    private result(commandId: string, status: "unknown" | "rejected", code: string, outcomeUnknown = true): RoomCommandResult {
        return { commandId, ownerEpoch: this.epoch, status, code, outcomeUnknown }
    }

    private request(body: object, commandId: string, timeoutMs: number): Promise<RoomCommandResult> {
        if (!this.ready || this.closed || !this.child?.connected) return Promise.resolve(this.result(commandId, "unknown", "PROCESS_UNAVAILABLE"))
        const requestId = ++this.sequence
        const submits = (body as { t?: string }).t === "command-submit"
        if (submits && this.quiescing && !hasServerWorkAdmission()) return Promise.resolve(this.result(commandId, "rejected", "SERVER_CLOSING", false))
        let admission: ReturnType<typeof createAcceptedRealtimeBusinessScope> | undefined
        if (submits) {
            try { admission = createAcceptedRealtimeBusinessScope({ ownerEpoch: this.epoch, commandId }) }
            catch (error) { return Promise.resolve(this.result(commandId, "rejected", String((error as { code?: string }).code || "SERVER_CLOSING"), false)) }
        }
        const message = { ...body, requestId, ...(admission ? { businessAdmission: admission.proof } : {}) }
        let bytes: number
        try { bytes = commandJsonBytes(message) }
        catch { admission?.release(); return Promise.resolve(this.result(commandId, "rejected", "INVALID_JSON", false)) }
        if (this.pending.size >= this.maxPending || this.bytes + bytes > this.maxPendingBytes) {
            admission?.release()
            return Promise.resolve(this.result(commandId, "rejected", "PROCESS_QUEUE_LIMIT", false))
        }
        return new Promise(resolve => {
            const timer = setTimeout(() => {
                const item = this.pending.get(requestId)
                item?.resolve?.(this.result(commandId, "unknown", "PROCESS_RESPONSE_TIMEOUT"))
                // Retain the application budget until the real result or channel closure.
                if (item) item.resolve = undefined
            }, timeoutMs)
            this.pending.set(requestId, { commandId, bytes, resolve, timer, admission }); this.bytes += bytes
            try {
                this.child!.send(message, error => {
                    if (error) { this.failPending("PROCESS_SEND_FAILED"); this.child?.kill() }
                })
            } catch { this.failPending("PROCESS_SEND_FAILED"); this.child?.kill() }
        })
    }

    private failPending(code: string): void {
        if (!this.closed && this.ownerEpoch) {
            require("../../lib/weapon-riven/multi-store").rivenSnapshotStore.releaseOwnerEpoch(this.ownerEpoch)
        }
        this.closed = true; this.ready = false
        this.ingressClosed = true; this.ingressAdmission?.release(); this.ingressAdmission = undefined
        for (const scope of this.tcpWork.values()) scope.release()
        this.tcpWork.clear()
        for (const item of this.pending.values()) { clearTimeout(item.timer); item.admission?.release(); item.resolve?.(this.result(item.commandId, "unknown", code)) }
        this.pending.clear(); this.bytes = 0
        for (const control of this.controls.values()) control.reject(new Error(code))
        this.controls.clear(); this.changed()
    }

    private changed(): void { for (const wake of this.drainWaiters) wake(); this.drainWaiters.clear() }
    private control(type: "command-quiesce" | "command-drain"): Promise<void> {
        if (!this.isReady) return Promise.reject(new Error("PROCESS_UNAVAILABLE"))
        const requestId = ++this.sequence
        return new Promise((resolve, reject) => {
            this.controls.set(requestId, { resolve, reject })
            try { this.child!.send({ t: type, requestId }, error => { if (error) this.failPending("PROCESS_SEND_FAILED") }) }
            catch { this.failPending("PROCESS_SEND_FAILED") }
        })
    }
    quiesce(): Promise<void> {
        if (!this.quiesced) {
            this.quiescing = true
            this.quiesced = this.closed || !this.child ? Promise.resolve() : this.control("command-quiesce")
        }
        return this.quiesced
    }
    async drain(): Promise<void> {
        while (this.pending.size || this.businessPending || this.tcpWork.size) await new Promise<void>(resolve => this.drainWaiters.add(resolve))
        if (this.isReady) await this.control("command-drain")
        while (this.pending.size || this.businessPending || this.tcpWork.size) await new Promise<void>(resolve => this.drainWaiters.add(resolve))
    }
    stop(): Promise<void> {
        if (!this.stopped) this.stopped = (async () => {
            if (!this.closed) { await this.quiesce(); await this.drain() }
            await this.terminate(false)
        })()
        return this.stopped
    }
    /** Failure path only; graceful service close is governed by its overall deadline. */
    async abort(): Promise<void> { await this.terminate(true) }
    private async terminate(force: boolean): Promise<void> {
        this.failPending("PROCESS_STOPPED")
        const child = this.child
        if (!child || child.exitCode !== null || child.signalCode !== null) return
        await new Promise<void>(resolve => {
            const timer = force ? setTimeout(() => child.kill(), 1000) : undefined
            const done = () => { clearTimeout(timer); resolve() }
            child.once("exit", done); child.once("close", done)
            if (child.connected) child.send({ t: "command-shutdown" }, () => {})
            else child.kill()
        })
    }
}
