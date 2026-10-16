import * as net from "net"
import { recordBattleSendAnomaly } from "./chain-diagnostic"
import { registerMemoryCounters } from "../../lib/memory-diagnostics"
import { markTcpDisconnectReason } from "./disconnect-diagnostics"
import { battleTelemetry } from "../battle-telemetry"

export type ReliableSendResult = "sent" | "queued" | "closed"

export interface ReliableSendContext {
    roomNumber?: string
    connectionId?: string
    viewerId?: number
    roomGeneration?: number
    channel?: string
}

interface QueuedFrame {
    frame: string
    bytes: number
    queuedAt: number
    context?: ReliableSendContext
}

interface SocketSendState {
    queue: QueuedFrame[]
    queuedBytes: number
    blockedSince: number
    drainListening: boolean
    timeout?: NodeJS.Timeout
    context?: ReliableSendContext
    episodeContext?: ReliableSendContext
    peakQueuedMessages: number
    peakQueuedBytes: number
    terminalRecorded: boolean
}

const socketStates = new WeakMap<net.Socket, SocketSendState>()
const closedAttemptLogged = new WeakSet<net.Socket>()
let queuedMessages = 0, queuedBytes = 0
registerMemoryCounters("tcpSendQueue", () => ({ queuedMessages, queuedBytes }))

function discardQueue(state: SocketSendState): void {
    queuedMessages -= state.queue.length
    queuedBytes -= state.queuedBytes
    state.queue.length = 0
    state.queuedBytes = 0
}

function positiveInteger(name: string, fallback: number, minimum = 1): number {
    const parsed = parseInt(process.env[name] || "", 10)
    return Number.isFinite(parsed) ? Math.max(minimum, parsed) : fallback
}

const MAX_MESSAGES = positiveInteger("MULTI_SEND_QUEUE_MAX_MESSAGES", 512)
const MAX_BYTES = positiveInteger("MULTI_SEND_QUEUE_MAX_BYTES", 4 * 1024 * 1024, 1024)
const MAX_AGE_MS = positiveInteger("MULTI_SEND_QUEUE_MAX_AGE_MS", 15_000, 1_000)
const MIN_DIAGNOSTIC_BLOCK_MS = positiveInteger("MULTI_CHAIN_SEND_DIAGNOSTIC_MIN_BLOCK_MS", 100)

function describe(context?: ReliableSendContext): string {
    if (!context) return ""
    return ` room=${context.roomNumber ?? "?"}`
        + ` connection=${context.connectionId ?? "?"}`
        + ` viewer=${context.viewerId ?? "?"}`
        + ` generation=${context.roomGeneration ?? "?"}`
        + ` channel=${context.channel ?? "?"}`
}

function clearTimer(state: SocketSendState): void {
    if (state.timeout) clearTimeout(state.timeout)
    state.timeout = undefined
}

function blockedDuration(state: SocketSendState, now = Date.now()): number {
    return state.blockedSince === 0 ? 0 : Math.max(0, now - state.blockedSince)
}

function beginBackpressure(state: SocketSendState, context?: ReliableSendContext): void {
    if (state.blockedSince !== 0) return
    state.blockedSince = Date.now()
    state.episodeContext = context ?? state.context
    state.peakQueuedMessages = state.queue.length
    state.peakQueuedBytes = state.queuedBytes
    state.terminalRecorded = false
}

function updateQueuePeaks(state: SocketSendState): void {
    state.peakQueuedMessages = Math.max(state.peakQueuedMessages, state.queue.length)
    state.peakQueuedBytes = Math.max(state.peakQueuedBytes, state.queuedBytes)
}

function diagnosticDetails(state: SocketSendState): Record<string, unknown> {
    return {
        blockedMs: blockedDuration(state),
        queuedMessages: state.queue.length,
        queuedBytes: state.queuedBytes,
        peakQueuedMessages: state.peakQueuedMessages,
        peakQueuedBytes: state.peakQueuedBytes,
    }
}

function recordTerminalAnomaly(
    state: SocketSendState,
    anomaly: string,
    details: Record<string, unknown> = {},
): void {
    if (state.terminalRecorded) return
    state.terminalRecorded = true
    const context = state.episodeContext ?? state.context
    battleTelemetry.backpressure(context?.roomNumber, context?.viewerId, blockedDuration(state))
    recordBattleSendAnomaly(anomaly, state.episodeContext ?? state.context, {
        ...diagnosticDetails(state),
        ...details,
    })
}

function resetBackpressure(state: SocketSendState): void {
    state.blockedSince = 0
    state.episodeContext = undefined
    state.peakQueuedMessages = 0
    state.peakQueuedBytes = 0
    state.terminalRecorded = false
}

function recordBackpressureRecovery(state: SocketSendState): void {
    const blockedMs = blockedDuration(state)
    if (blockedMs >= MIN_DIAGNOSTIC_BLOCK_MS) {
        const context = state.episodeContext ?? state.context
        battleTelemetry.backpressure(context?.roomNumber, context?.viewerId, blockedMs)
        recordBattleSendAnomaly("backpressure_recovered", state.episodeContext ?? state.context, {
            ...diagnosticDetails(state),
            queuedMessages: 0,
            queuedBytes: 0,
        })
    }
    resetBackpressure(state)
}

function disconnectSlowSocket(socket: net.Socket, state: SocketSendState, reason: string): void {
    const queuedMessages = state.queue.length
    const queuedBytes = state.queuedBytes
    recordTerminalAnomaly(state, reason, {
        maxMessages: MAX_MESSAGES,
        maxBytes: MAX_BYTES,
        maxAgeMs: MAX_AGE_MS,
    })
    clearTimer(state)
    discardQueue(state)
    console.warn(`[MULTI] slow battle connection removed: reason=${reason}`
        + ` queuedMessages=${queuedMessages} queuedBytes=${queuedBytes}`
        + describe(state.context))
    markTcpDisconnectReason(socket, reason === "queue_limit"
        ? "send_queue_limit" : "send_backpressure")
    if (!socket.destroyed) socket.destroy()
}

function armTimeout(socket: net.Socket, state: SocketSendState): void {
    clearTimer(state)
    const startedAt = state.blockedSince || state.queue[0]?.queuedAt || Date.now()
    const remaining = Math.max(1, MAX_AGE_MS - (Date.now() - startedAt))
    state.timeout = setTimeout(() => {
        const current = socketStates.get(socket)
        if (current !== state || socket.destroyed) return
        disconnectSlowSocket(socket, state, "backpressure_timeout")
    }, remaining)
    state.timeout.unref()
}

function ensureState(socket: net.Socket): SocketSendState {
    let state = socketStates.get(socket)
    if (state) return state
    state = {
        queue: [],
        queuedBytes: 0,
        blockedSince: 0,
        drainListening: false,
        peakQueuedMessages: 0,
        peakQueuedBytes: 0,
        terminalRecorded: false,
    }
    socketStates.set(socket, state)
    const cleanup = () => clearReliableSendState(socket)
    socket.once("close", cleanup)
    socket.once("error", cleanup)
    return state
}

function listenForDrain(socket: net.Socket, state: SocketSendState): void {
    if (state.drainListening || socket.destroyed) return
    state.drainListening = true
    socket.once("drain", () => {
        const current = socketStates.get(socket)
        if (current !== state || socket.destroyed) return
        state.drainListening = false
        clearTimer(state)

        while (state.queue.length > 0 && socket.writable && !socket.destroyed) {
            const next = state.queue.shift()!
            state.queuedBytes -= next.bytes
            queuedMessages--
            queuedBytes -= next.bytes
            state.context = next.context
            let writable = false
            try {
                writable = socket.write(next.frame)
            } catch (error) {
                recordTerminalAnomaly(state, "write_error", {
                    error: error instanceof Error ? error.message : String(error),
                })
                console.warn(`[MULTI] battle socket write failed:${describe(next.context)}`,
                    error instanceof Error ? error.message : String(error))
                markTcpDisconnectReason(socket, "send_write_error")
                if (!socket.destroyed) socket.destroy()
                return
            }
            if (!writable) {
                beginBackpressure(state, next.context)
                updateQueuePeaks(state)
                listenForDrain(socket, state)
                armTimeout(socket, state)
                return
            }
        }

        if (state.queue.length === 0) {
            recordBackpressureRecovery(state)
            state.context = undefined
        }
    })
}

export function sendFrameReliably(
    socket: net.Socket,
    frame: string,
    context?: ReliableSendContext,
): ReliableSendResult {
    if (!socket.writable || socket.destroyed) {
        if (!closedAttemptLogged.has(socket)) {
            closedAttemptLogged.add(socket)
            recordBattleSendAnomaly("send_on_closed_socket", context)
        }
        return "closed"
    }
    const state = ensureState(socket)
    state.context = context

    if (state.blockedSince !== 0 || state.queue.length > 0) {
        const bytes = Buffer.byteLength(frame)
        if (state.queue.length + 1 > MAX_MESSAGES || state.queuedBytes + bytes > MAX_BYTES) {
            disconnectSlowSocket(socket, state, "queue_limit")
            return "closed"
        }
        state.queue.push({ frame, bytes, queuedAt: Date.now(), context })
        state.queuedBytes += bytes
        queuedMessages++
        queuedBytes += bytes
        beginBackpressure(state, context)
        updateQueuePeaks(state)
        listenForDrain(socket, state)
        armTimeout(socket, state)
        return "queued"
    }

    try {
        const writable = socket.write(frame)
        if (!writable) {
            beginBackpressure(state, context)
            updateQueuePeaks(state)
            listenForDrain(socket, state)
            armTimeout(socket, state)
        }
        return "sent"
    } catch (error) {
        recordTerminalAnomaly(state, "write_error", {
            error: error instanceof Error ? error.message : String(error),
        })
        console.warn(`[MULTI] battle socket write failed:${describe(context)}`,
            error instanceof Error ? error.message : String(error))
        markTcpDisconnectReason(socket, "send_write_error")
        if (!socket.destroyed) socket.destroy()
        return "closed"
    }
}

export function clearReliableSendState(socket: net.Socket): void {
    const state = socketStates.get(socket)
    if (!state) return
    if (state.blockedSince !== 0 && !state.terminalRecorded) {
        recordTerminalAnomaly(state, "socket_closed_during_backpressure")
    }
    clearTimer(state)
    discardQueue(state)
    socketStates.delete(socket)
}

export function getReliableSendQueueStats(socket: net.Socket): { messages: number; bytes: number; blocked: boolean } {
    const state = socketStates.get(socket)
    return {
        messages: state?.queue.length ?? 0,
        bytes: state?.queuedBytes ?? 0,
        blocked: (state?.blockedSince ?? 0) !== 0,
    }
}
