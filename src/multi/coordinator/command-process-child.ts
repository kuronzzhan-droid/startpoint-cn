import { RoomCommandExecutor } from "./command-executor"
import { cloneCommandJson, commandJsonBytes } from "./command-protocol"
import type { RoomCommandResult } from "./command-protocol"
import { attachChildBusinessRpc, drainChildRealtimeBusiness, runWithRealtimeBusinessAdmission } from "./business-rpc"

/** No TCP/game server is imported here. Optional listeners belong to the explicit bootstrap. */
async function main(): Promise<void> {
    const options = JSON.parse(process.argv[2] ?? "{}")
    const executor = new RoomCommandExecutor()
    const commandAdmissions = new Map<string, unknown>()
    executor.setHandlerContext((id, operation) => runWithRealtimeBusinessAdmission(commandAdmissions.get(id), operation))
    const quiesceCallbacks: Array<() => void | Promise<void>> = []
    const drainCallbacks: Array<() => void | Promise<void>> = []
    const shutdownCallbacks: Array<() => void | Promise<void>> = []
    let inflight = 0, bytes = 0, stopping = false
    let quiesced: Promise<void> | undefined
    const replies = new Set<Promise<void>>()
    const quiesce = () => quiesced ??= (async () => {
        executor.quiesce()
        await Promise.all(quiesceCallbacks.map(fn => Promise.resolve().then(fn)))
    })()
    const drain = async () => {
        await executor.drain()
        await Promise.all(drainCallbacks.map(fn => Promise.resolve().then(fn)))
        await drainChildRealtimeBusiness()
        while (replies.size) await Promise.allSettled([...replies])
    }
    const shutdown = async (disconnected = false) => {
        if (stopping) return
        stopping = true
        if (disconnected) stopBusiness()
        await quiesce()
        if (!disconnected) await drain()
        executor.close()
        await Promise.allSettled(shutdownCallbacks.map(fn => Promise.resolve().then(fn)))
        process.exit(0)
    }
    process.on("disconnect", () => { void shutdown(true) })
    const stopBusiness = attachChildBusinessRpc()
    shutdownCallbacks.push(stopBusiness)
    const bootstrap = require(options.registerModule)
    if (typeof bootstrap.register !== "function") throw new Error("bootstrap must export register")
    const metadata = await bootstrap.register(executor, {
        onQuiesce: (fn: () => void | Promise<void>) => quiesceCallbacks.push(fn),
        onDrain: (fn: () => void | Promise<void>) => drainCallbacks.push(fn),
        onShutdown: (fn: () => void | Promise<void>) => shutdownCallbacks.push(fn),
    })
    if (!process.connected) { await shutdown(); return }
    process.on("message", async (message: any) => {
        if (message?.t === "command-shutdown") { void shutdown(); return }
        if (stopping || !Number.isSafeInteger(message?.requestId) || message.requestId <= 0) return
        if (message.t === "command-quiesce" || message.t === "command-drain") {
            try {
                if (message.t === "command-quiesce") await quiesce()
                else await drain()
                if (process.connected) process.send!({ t: message.t === "command-quiesce" ? "command-quiesced" : "command-drained", requestId: message.requestId })
            } catch { process.disconnect() }
            return
        }
        const commandId = message.t === "command-submit" ? message.envelope?.commandId : message.commandId
        if (typeof commandId !== "string") return
        let size: number
        try { size = commandJsonBytes(message) } catch { process.disconnect(); return }
        const reply = (result: RoomCommandResult) => {
            if (!process.connected) return
            let resolve!: () => void
            const sent = new Promise<void>(done => { resolve = done })
            replies.add(sent)
            const done = (error?: Error | null) => { replies.delete(sent); resolve(); if (error) void shutdown(true) }
            try { process.send!({ t: "command-result", requestId: message.requestId, result: cloneCommandJson(result) }, done) }
            catch { done(new Error("IPC_SEND_FAILED")) }
        }
        if (inflight >= options.maxPending || bytes + size > options.maxPendingBytes) {
            reply({ commandId, ownerEpoch: executor.ownerEpoch, status: "rejected", code: "PROCESS_QUEUE_LIMIT", outcomeUnknown: false }); return
        }
        inflight++; bytes += size
        try {
            if (message.t === "command-submit") {
                const proof = message.businessAdmission
                const accepted = proof && proof.ownerEpoch === executor.ownerEpoch && proof.commandId === commandId
                    && typeof proof.admissionToken === "string" && /^[a-f0-9]{64}$/.test(proof.admissionToken)
                    && Object.keys(proof).length === 3
                const ownsAdmission = accepted && !commandAdmissions.has(commandId)
                if (ownsAdmission) commandAdmissions.set(commandId, proof)
                try { reply(await executor.submit(message.envelope, !!accepted)) }
                finally { if (ownsAdmission) commandAdmissions.delete(commandId) }
            }
            else if (message.t === "command-query") reply(await executor.queryResult(commandId))
            else reply({ commandId, ownerEpoch: executor.ownerEpoch, status: "rejected", code: "PROCESS_INVALID_OPERATION", outcomeUnknown: false })
        } catch {
            reply({ commandId, ownerEpoch: executor.ownerEpoch, status: "unknown", code: "PROCESS_APPLICATION_ERROR", outcomeUnknown: true })
        } finally { inflight--; bytes -= size }
    })
    process.send!({ t: "command-ready", ownerEpoch: executor.ownerEpoch, metadata: cloneCommandJson(metadata ?? null) })
}

if (require.main === module) {
    // A Windows console broadcasts Ctrl+C/Ctrl+Break to forked children too.
    // The supervisor alone owns the drain deadline and sends explicit IPC stop.
    // Exiting here would destroy accepted work before the parent close hooks.
    if (process.platform === "win32") {
        process.on("SIGINT", () => {})
        process.on("SIGBREAK", () => {})
    }
    void main().catch(error => {
    console.error("[MULTI-REALTIME] owner bootstrap failed", error)
    if (process.connected) process.send!({ t: "command-start-failed" }, () => process.exit(1))
    else process.exit(1)
    })
}
