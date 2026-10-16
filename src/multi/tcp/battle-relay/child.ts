// Battle relay child process.
//
// Co-op battles are lockstep: every client waits for its teammates' frames, so
// any delay on the client → server → client path freezes the whole room. In the
// main CN process that path shares one event loop with synchronous SQLite
// settlement work, which regularly blocks for hundreds of milliseconds. This
// process owns only the battle sockets' steady-state traffic so that relay
// latency no longer depends on the main event loop.
//
// It never decides who belongs to a room: the main process pushes the
// membership it computed (`members`) and receives every frame that changes
// room state (handshake, SceneReady, LevelNext, Finalize, unknown frames).

import type * as net from "net"
import type { RelayActivity, RelayChildMessage, RelayCloseReason, RelayMember, RelayParentMessage } from "./protocol"

function positiveInteger(name: string, fallback: number, minimum: number): number {
    const value = Number.parseInt(process.env[name] ?? "", 10)
    return Number.isFinite(value) ? Math.max(minimum, value) : fallback
}

const MAX_FRAME_BYTES = positiveInteger("SESSION_MAX_FRAME_BYTES", 262_144, 1_024)
const MAX_BUFFER_BYTES = positiveInteger("SESSION_MAX_BUFFER_BYTES", 1_048_576, MAX_FRAME_BYTES)
const KEEPALIVE_MS = positiveInteger("SESSION_TCP_KEEPALIVE_MS", 10_000, 1_000)
const SEND_MAX_BYTES = positiveInteger("MULTI_SEND_QUEUE_MAX_BYTES", 4 * 1024 * 1024, 1024)
const SEND_MAX_AGE_MS = positiveInteger("MULTI_SEND_QUEUE_MAX_AGE_MS", 15_000, 1_000)
const ACTIVITY_INTERVAL_MS = positiveInteger("MULTI_BATTLE_RELAY_ACTIVITY_MS", 250, 50)

interface RelaySocket {
    sid: number
    socket: net.Socket
    buffer: string
    closed: boolean
    closeReason?: RelayCloseReason
    closeDetail?: string
    room?: string
    cid?: string
    gen?: number
    lastInboundAt: number
    blockedSince: number
    blockTimer?: NodeJS.Timeout
    activity: RelayActivity
}

const sockets = new Map<number, RelaySocket>()
const rooms = new Map<string, RelayMember[]>()

function send(message: RelayChildMessage): void {
    if (process.connected) process.send!(message)
}

function emptyActivity(sid: number): RelayActivity {
    return {
        sid, broadcasts: 0, sends: 0, heartbeats: 0, measurements: 0, lineSpeedWarnings: 0,
        maxGapMs: 0, relayedOut: 0, maxBackpressureMs: 0,
    }
}

function hasActivity(activity: RelayActivity): boolean {
    return activity.broadcasts + activity.sends + activity.heartbeats + activity.measurements
        + activity.lineSpeedWarnings + activity.relayedOut + activity.maxBackpressureMs > 0
}

function closeSocket(entry: RelaySocket, reason: RelayCloseReason, detail?: string): void {
    if (entry.closed) return
    entry.closeReason ??= reason
    entry.closeDetail ??= detail
    entry.socket.destroy()
}

function write(entry: RelaySocket, frame: string): void {
    const socket = entry.socket
    if (entry.closed || socket.destroyed || !socket.writable) return
    const flushed = socket.write(frame)
    if (socket.writableLength > SEND_MAX_BYTES) {
        closeSocket(entry, "send_queue_limit", `queued=${socket.writableLength}`)
        return
    }
    if (flushed || entry.blockedSince > 0) return
    // Same 15 s budget as the in-process reliable sender: a client that does
    // not read for that long is gone, and holding its queue only delays others.
    entry.blockedSince = Date.now()
    entry.blockTimer = setTimeout(() => {
        closeSocket(entry, "send_backpressure", `blocked=${Date.now() - entry.blockedSince}ms`)
    }, SEND_MAX_AGE_MS)
    socket.once("drain", () => {
        if (entry.blockTimer) clearTimeout(entry.blockTimer)
        entry.blockTimer = undefined
        const blockedMs = Date.now() - entry.blockedSince
        entry.blockedSince = 0
        if (blockedMs > entry.activity.maxBackpressureMs) entry.activity.maxBackpressureMs = blockedMs
    })
}

function ack(entry: RelaySocket): void {
    write(entry, JSON.stringify([1, [3, 0, 0, Date.now()]]) + "\0")
}

function relay(source: RelaySocket, payload: unknown[]): void {
    const members = source.room === undefined ? undefined : rooms.get(source.room)
    if (!members) return
    // Serialize once per fan-out, exactly like relayToBattleRoom().
    const frame = JSON.stringify(payload) + "\0"
    for (const member of members) {
        if (member.sid === source.sid || member.gen !== source.gen) continue
        const target = sockets.get(member.sid)
        if (!target || target.closed || target.socket.destroyed || !target.socket.writable) continue
        write(target, frame)
        target.activity.relayedOut++
    }
}

/** Returns false when the frame must be handled by the main process. */
function handleLocally(entry: RelaySocket, data: unknown): boolean {
    if (entry.cid === undefined || !Array.isArray(data)) return false
    switch (data[0]) {
        case 1: // Broadcast → BattleServer2Client.Messages(2, senderId, array)
            relay(entry, [2, entry.cid, data[1]])
            ack(entry)
            entry.activity.broadcasts++
            return true
        case 2: // Send → BattleServer2Client.Send(3, senderId, message)
            if (data[2] !== undefined && data[2] !== null) relay(entry, [3, entry.cid, data[2]])
            ack(entry)
            entry.activity.sends++
            return true
        case 0: {
            const notify = data[1]
            if (!Array.isArray(notify)) return false
            if (notify[0] === 3) { // Measurement
                write(entry, JSON.stringify([1, [3, notify[1]?.[0] ?? 0, notify[1]?.[1] ?? 0, Date.now()]]) + "\0")
                entry.activity.measurements++
                return true
            }
            if (notify[0] === 5) { // Heartbeat
                ack(entry)
                entry.activity.heartbeats++
                return true
            }
            if (notify[0] === 4) { // LineSpeedWarning: nothing to answer
                entry.activity.lineSpeedWarnings++
                return true
            }
            return false
        }
        default:
            return false
    }
}

function onData(entry: RelaySocket, chunk: string): void {
    if (entry.closed) return
    entry.buffer += chunk
    if (Buffer.byteLength(entry.buffer, "utf8") > MAX_BUFFER_BYTES) {
        closeSocket(entry, "protocol", `receive buffer exceeded ${MAX_BUFFER_BYTES} bytes`)
        return
    }
    const now = Date.now()
    if (entry.lastInboundAt > 0) {
        const gap = now - entry.lastInboundAt
        if (gap > entry.activity.maxGapMs) entry.activity.maxGapMs = gap
    }
    entry.lastInboundAt = now
    let forward = ""
    let index: number
    while (!entry.closed && (index = entry.buffer.indexOf("\0")) >= 0) {
        const raw = entry.buffer.substring(0, index)
        entry.buffer = entry.buffer.substring(index + 1)
        if (raw.trim().length === 0) continue
        if (Buffer.byteLength(raw, "utf8") > MAX_FRAME_BYTES) {
            closeSocket(entry, "protocol", `frame exceeded ${MAX_FRAME_BYTES} bytes`)
            break
        }
        let data: unknown
        try {
            data = JSON.parse(raw)
        } catch (error) {
            closeSocket(entry, "protocol", `invalid JSON frame: ${(error as Error).message}`)
            break
        }
        if (!handleLocally(entry, data)) forward += raw + "\0"
    }
    // Forward in arrival order before any close notice so the main process sees
    // a Finalize that preceded a FIN.
    if (forward.length > 0) send({ t: "frames", sid: entry.sid, data: forward })
    if (!entry.closed && Buffer.byteLength(entry.buffer, "utf8") > MAX_FRAME_BYTES) {
        closeSocket(entry, "protocol", `unterminated frame exceeded ${MAX_FRAME_BYTES} bytes`)
    }
}

function adopt(sid: number, socket: net.Socket | undefined): void {
    if (!socket || sockets.has(sid)) {
        socket?.destroy()
        send({ t: "adopted", sid, ok: false })
        return
    }
    const entry: RelaySocket = {
        sid, socket, buffer: "", closed: false, lastInboundAt: 0, blockedSince: 0, activity: emptyActivity(sid),
    }
    sockets.set(sid, entry)
    socket.setNoDelay(true)
    socket.setKeepAlive(true, KEEPALIVE_MS)
    socket.setEncoding("utf8")
    socket.on("data", (chunk: string) => onData(entry, chunk))
    socket.on("end", () => { entry.closeReason ??= "peer_fin" })
    socket.on("error", (error) => {
        entry.closeReason ??= "socket_error"
        entry.closeDetail ??= (error as NodeJS.ErrnoException).code ?? error.message
    })
    socket.on("close", (hadError: boolean) => {
        entry.closed = true
        if (entry.blockTimer) clearTimeout(entry.blockTimer)
        sockets.delete(sid)
        flushActivity(entry)
        send({
            t: "closed", sid, hadError,
            reason: entry.closeReason ?? (hadError ? "socket_error" : "peer_fin"),
            detail: entry.closeDetail,
        })
    })
    socket.resume()
    send({ t: "adopted", sid, ok: true })
}

function setMembers(room: string, members: RelayMember[]): void {
    const previous = rooms.get(room) ?? []
    const nextSids = new Set(members.map(member => member.sid))
    for (const member of previous) {
        const entry = sockets.get(member.sid)
        if (entry && !nextSids.has(member.sid) && entry.room === room) {
            entry.room = undefined
            entry.cid = undefined
            entry.gen = undefined
        }
    }
    if (members.length === 0) rooms.delete(room)
    else rooms.set(room, members)
    for (const member of members) {
        const entry = sockets.get(member.sid)
        if (!entry) continue
        entry.room = room
        entry.cid = member.cid
        entry.gen = member.gen
    }
}

function flushActivity(only?: RelaySocket): void {
    const items: RelayActivity[] = []
    const entries = only ? [only] : sockets.values()
    for (const entry of entries) {
        if (!hasActivity(entry.activity)) continue
        items.push(entry.activity)
        entry.activity = emptyActivity(entry.sid)
    }
    if (items.length > 0) send({ t: "activity", items })
}

function handleParentMessage(message: RelayParentMessage, handle: unknown): void {
    switch (message.t) {
        case "adopt":
            adopt(message.sid, handle as net.Socket | undefined)
            break
        case "write": {
            const entry = sockets.get(message.sid)
            if (entry) write(entry, message.data)
            break
        }
        case "end": {
            const entry = sockets.get(message.sid)
            if (entry && !entry.closed) {
                entry.closeReason ??= "parent_request"
                entry.socket.end()
            }
            break
        }
        case "destroy": {
            const entry = sockets.get(message.sid)
            if (entry) closeSocket(entry, "parent_request")
            break
        }
        case "members":
            setMembers(message.room, message.members)
            break
        case "shutdown":
            for (const entry of sockets.values()) closeSocket(entry, "parent_request")
            setTimeout(() => process.exit(0), 50).unref()
            break
    }
}

export function startBattleRelayChild(): void {
    process.on("message", (message: RelayParentMessage, handle: unknown) => {
        try {
            handleParentMessage(message, handle)
        } catch (error) {
            console.error("[BATTLE-RELAY] child failed to handle a message:", error)
        }
    })
    // Without the parent there is nobody to decide barriers or settlement.
    process.on("disconnect", () => {
        for (const entry of sockets.values()) entry.socket.destroy()
        process.exit(0)
    })
    setInterval(() => flushActivity(), ACTIVITY_INTERVAL_MS)
    send({ t: "ready" })
}

if (process.send) startBattleRelayChild()
