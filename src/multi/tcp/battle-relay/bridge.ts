// Main-process side of the battle relay child (opt-in: MULTI_BATTLE_RELAY_PROCESS=1).
//
// A battle socket is handed to the child right after its handshake frame is
// read. The main process keeps a RelayProxySocket in its place, so handshake,
// barriers, leases, Leave/BattleStart and settlement code keep working on a
// socket-like object: writes become IPC messages, and the child forwards the
// frames the main process must see as `data` events.

import { EventEmitter } from "events"
import { fork, type ChildProcess } from "child_process"
import * as path from "path"
import type * as net from "net"
import type { RelayActivity, RelayChildMessage, RelayCloseReason, RelayIdentityRejection, RelayMember, RelayParentMessage, RelayRoomIdentity } from "./protocol"
import { BoundedRelayIpc, type RelayIpcWire } from "./ipc"

function positiveInteger(name: string, fallback: number, minimum: number): number {
    const value = Number.parseInt(process.env[name] ?? "", 10)
    return Number.isFinite(value) ? Math.max(minimum, value) : fallback
}

export function battleRelayProcessEnabled(environment: NodeJS.ProcessEnv = process.env): boolean {
    return /^(1|true|yes|on)$/i.test(environment.MULTI_BATTLE_RELAY_PROCESS ?? "")
}

/** Restarts allowed per server process; after that battle sockets stay in-process. */
const MAX_RESTARTS = positiveInteger("MULTI_BATTLE_RELAY_MAX_RESTARTS", 5, 0)

/**
 * Stands in for a battle `net.Socket` whose file descriptor now lives in the
 * relay child. Implements the subset of the socket API the multi code uses.
 */
export class RelayProxySocket extends EventEmitter {
    destroyed = false
    writableEnded = false
    readable = true
    get writableLength(): number { return this.bridge.pendingSocketBytes(this.sid) }
    private closeEmitted = false

    constructor(
        readonly sid: number,
        private readonly bridge: BattleRelayBridge,
        readonly remoteAddress: string | undefined,
        readonly remotePort: number | undefined,
    ) {
        super()
    }

    get writable(): boolean {
        return !this.destroyed && !this.writableEnded
    }

    write(data: string | Uint8Array): boolean {
        if (!this.writable) return false
        return this.bridge.post({ t: "write", sid: this.sid, data: typeof data === "string" ? data : Buffer.from(data).toString("utf8") })
    }

    end(data?: string | Uint8Array): this {
        if (this.destroyed || this.writableEnded) return this
        if (data !== undefined) this.write(data)
        this.writableEnded = true
        this.bridge.post({ t: "end", sid: this.sid })
        return this
    }

    destroy(): this {
        if (this.destroyed) return this
        this.destroyed = true
        this.readable = false
        this.bridge.post({ t: "destroy", sid: this.sid })
        process.nextTick(() => this.emitClose(false))
        return this
    }

    setNoDelay(): this { return this }
    setKeepAlive(): this { return this }
    setEncoding(): this { return this }
    setTimeout(): this { return this }
    pause(): this { return this }
    resume(): this { return this }
    ref(): this { return this }
    unref(): this { return this }

    /** Production listeners resolve only after the exact forwarded frame boundary. */
    receiveFrames(data: string, identity?: RelayRoomIdentity): Promise<void> {
        return new Promise((resolve, reject) => {
            if (this.destroyed) { reject(new Error("relay_socket_closed")); return }
            if (this.listenerCount("relay-frames") > 0) {
                this.emit("relay-frames", data, (error?: Error) => error ? reject(error) : resolve(), identity)
                // Existing diagnostic observers can still observe incoming bytes.
                this.emit("data", data)
            } else { this.emit("data", data); resolve() }
        })
    }

    /** The child reported that the real socket closed. */
    remoteClosed(reason: RelayCloseReason | "relay_exit", hadError: boolean, detail?: string): void {
        if (this.closeEmitted) return
        this.readable = false
        if (reason === "peer_fin") {
            this.emit("end")
        } else if (reason === "socket_error") {
            const error = new Error(detail ?? "battle relay socket error") as NodeJS.ErrnoException
            error.code = detail
            this.emit("error", error)
        } else if (reason !== "parent_request") {
            this.emit("relay-close-reason", reason, detail)
        }
        this.destroyed = true
        this.emitClose(hadError)
    }

    private emitClose(hadError: boolean): void {
        if (this.closeEmitted) return
        this.closeEmitted = true
        this.bridge.forget(this.sid)
        this.emit("close", hadError)
    }
}

export class BattleRelayBridge {
    private child: ChildProcess | null = null
    private ready = false
    private stopping = false
    private restarts = 0
    private nextSid = 1
    private readonly proxies = new Map<number, RelayProxySocket>()
    private ipc: BoundedRelayIpc<RelayParentMessage> | null = null
    private membershipVersion = 0
    private readonly desiredMembership = new Map<string, RelayParentMessage & { t: "members" }>()
    private readonly membershipSentAt = new Map<string, { version: number; at: number }>()
    private readonly pendingMembership = new Map<string, { compute: () => RelayMember[]; identity: RelayRoomIdentity }>()
    private childDiagnostics: Record<string, unknown> | null = null
    private lastFault: string | null = null
    private readonly rejectedFrames = { instance: 0, run: 0, scene: 0, unbound: 0 }
    private readonly frameTails = new Map<number, Promise<void>>()
    private membershipFlushQueued = false
    private readyWaiters: Array<() => void> = []

    constructor(private readonly childPath = path.join(__dirname, "child.js"),
        private readonly memberSyncObserved: (room: string, durationMs: number) => void = (room, durationMs) => {
            // Keep the bridge independently loadable; telemetry already loads it
            // through SessionManager and must not form an eager import cycle.
            require("../../battle-telemetry").battleTelemetry.controlDelay(room, "member-sync", durationMs)
        }, private readonly now: () => number = () => performance.now()) {}

    get isReady(): boolean {
        return this.ready && this.child !== null && this.child.connected
    }

    get activeSockets(): number {
        return this.proxies.size
    }

    pendingSocketBytes(sid: number): number { return this.ipc?.pendingBytesFor(m => m.t === "write" && m.sid === sid) ?? 0 }

    noteRejectedFrames(reason: RelayIdentityRejection): void { this.rejectedFrames[reason]++ }

    diagnostics() {
        return { enabled: battleRelayProcessEnabled(), ready: this.isReady, pid: this.child?.pid ?? null,
            proxies: this.proxies.size, restarts: this.restarts, lastFault: this.lastFault,
            pendingMembership: this.pendingMembership.size, desiredMembership: this.desiredMembership.size,
            parentIpc: this.ipc?.diagnostics() ?? null, child: this.childDiagnostics, rejectedFrames: { ...this.rejectedFrames } }
    }

    start(): Promise<void> {
        if (this.child) return this.waitReady()
        this.stopping = false
        const child = fork(this.childPath, [], {
            // Inspector or profiler flags of the main process must not be inherited.
            execArgv: [],
            serialization: "json",
            stdio: ["ignore", "inherit", "inherit", "ipc"],
        })
        this.child = child
        this.ipc = new BoundedRelayIpc<RelayParentMessage>((message, handle, callback) => {
            if (!child.connected) throw new Error("ipc_disconnected")
            return handle === undefined ? child.send(message, callback)
                : child.send(message, handle as net.Socket, { keepOpen: false }, callback)
        }, reason => {
            if (this.child !== child) return
            this.lastFault = reason
            this.ready = false
            console.error(`[BATTLE-RELAY] parent IPC failed: reason=${reason}; closing adopted sockets`)
            // A synchronous send failure can happen inside adopt(), before the
            // caller attaches cleanup listeners to the returned proxy.
            for (const proxy of [...this.proxies.values()]) process.nextTick(() => proxy.remoteClosed("relay_exit", true, reason))
            child.kill()
        })
        const ipc = this.ipc
        child.on("message", (message: RelayIpcWire<RelayChildMessage>) => {
            if (this.child === child) ipc.receive(message, undefined, body => this.handleChildMessage(body))
        })
        child.on("exit", (code, signal) => this.handleChildExit(child, code, signal))
        child.on("error", (error) => {
            console.error("[BATTLE-RELAY] child process error:", error)
            this.lastFault = "child_process_error"
            // A failed spawn may emit error/close without an exit event.
            if (child.pid === undefined) this.handleChildExit(child, null, null)
        })
        return this.waitReady()
    }

    private waitReady(): Promise<void> {
        if (this.isReady) return Promise.resolve()
        return new Promise(resolve => this.readyWaiters.push(resolve))
    }

    stop(): Promise<void> {
        const child = this.child
        this.stopping = true
        if (!child) return Promise.resolve()
        return new Promise(resolve => {
            const timer = setTimeout(() => child.kill(), 2_000)
            timer.unref()
            const done = () => {
                clearTimeout(timer)
                child.off("exit", done)
                child.off("close", done)
                resolve()
            }
            child.once("exit", done)
            // A failed spawn emits error/close without an exit event.
            child.once("close", done)
            this.post({ t: "shutdown" })
        })
    }

    post(message: RelayParentMessage): boolean {
        const child = this.child
        if (!child || !this.ipc) return false
        return this.ipc.enqueue(message)
    }

    forget(sid: number): void {
        this.proxies.delete(sid)
    }

    /**
     * Moves a freshly accepted socket into the child. Returns the proxy that
     * replaces it, plus any bytes the main process had already buffered, or
     * null when the child cannot take it (the caller keeps the socket).
     */
    adopt(socket: net.Socket): { proxy: RelayProxySocket; pending: string } | null {
        const child = this.child
        if (!this.isReady || !child) return null
        // setEncoding() can retain an incomplete UTF-8 code point that read()
        // cannot recover. Keep that decoder and socket in the parent instead.
        const decoder = (socket as unknown as { _readableState?: { decoder?: { lastNeed?: number } } })._readableState?.decoder
        if ((decoder?.lastNeed ?? 0) > 0) return null
        const handle = (socket as unknown as { _handle?: { readStop?: () => number; reading?: boolean } })._handle
        if (!handle?.readStop) return null

        for (const event of ["data", "end", "close", "error", "drain", "timeout"]) socket.removeAllListeners(event)
        // The parent copy is closed after transfer; a late error must not crash.
        socket.on("error", () => {})
        socket.pause()
        handle.reading = false
        handle.readStop()
        // Bytes libuv already read but the stream has not emitted yet.
        let pending = ""
        let chunk: unknown
        while ((chunk = socket.read()) !== null) pending += String(chunk)

        // When the socket still points at its net.Server, Node registers the
        // child as a holder of that server's connections, and server.close()
        // then waits for the child to answer for them; a crashed child never
        // does. Detach it so the parent's copy is counted and released like
        // any other closed connection.
        ;(socket as unknown as { server: unknown }).server = null

        const sid = this.nextSid++
        const proxy = new RelayProxySocket(sid, this, socket.remoteAddress, socket.remotePort)
        this.proxies.set(sid, proxy)
        try {
            this.ipc!.enqueue({ t: "adopt", sid }, socket, (error) => {
                // The parent's handle is already closed; this releases the
                // JS socket and the server's connection count.
                socket.destroy()
                if (error) {
                    console.error(`[BATTLE-RELAY] socket handoff failed: sid=${sid}`, error.message)
                    process.nextTick(() => proxy.remoteClosed("socket_error", true, "handoff_failed"))
                }
            })
        } catch (error) {
            console.error(`[BATTLE-RELAY] socket handoff threw: sid=${sid}`, (error as Error).message)
            socket.destroy()
            process.nextTick(() => proxy.remoteClosed("socket_error", true, "handoff_failed"))
        }
        return { proxy, pending }
    }

    /**
     * Publishes a room's relay membership. Several changes in one turn of the
     * event loop collapse into one IPC message carrying the final state.
     */
    scheduleMembership(roomNumber: string, compute: () => RelayMember[], identity?: RelayRoomIdentity): void {
        if (!this.child) return
        // Missing identity can only use parent routing, never an invented room identity.
        this.pendingMembership.set(roomNumber, { compute, identity: identity ?? { instanceId: "", battleSessionId: null, sceneEpoch: 0 } })
        if (this.membershipFlushQueued) return
        this.membershipFlushQueued = true
        queueMicrotask(() => {
            this.membershipFlushQueued = false
            const pending = [...this.pendingMembership]
            this.pendingMembership.clear()
            for (const [room, { compute, identity }] of pending) {
                const snapshot = { t: "members" as const, room, ...identity, version: ++this.membershipVersion, members: compute() }
                this.desiredMembership.set(room, snapshot)
                this.membershipSentAt.set(room, { version: snapshot.version, at: this.now() })
                this.post(snapshot)
            }
        })
    }

    private handleChildMessage(message: RelayChildMessage): void | Promise<void> {
        switch (message.t) {
            case "ready":
                this.ready = true
                for (const resolve of this.readyWaiters.splice(0)) resolve()
                console.log("[BATTLE-RELAY] relay process ready")
                break
            case "adopted":
                if (!message.ok) this.proxies.get(message.sid)?.remoteClosed("socket_error", true, "adopt_rejected")
                break
            case "frames":
                const previous = this.frameTails.get(message.sid) ?? Promise.resolve()
                const applied = previous.then(async () => {
                    const proxy = this.proxies.get(message.sid)
                    if (proxy && !proxy.destroyed) {
                        try { await proxy.receiveFrames(message.data, message.identity) }
                        catch (error) { if (!proxy.destroyed) throw error }
                    }
                    // A deliberately retired socket is already explicitly closed;
                    // acknowledge its queued ingress without reviving its ownership.
                    this.post({ t: "control-applied", sid: message.sid, controlId: message.controlId })
                })
                this.frameTails.set(message.sid, applied)
                void applied.then(() => { if (this.frameTails.get(message.sid) === applied) this.frameTails.delete(message.sid) }, () => {})
                return applied
            case "members-applied": {
                const desired = this.desiredMembership.get(message.room)
                if (!desired || desired.version !== message.version || desired.instanceId !== message.instanceId
                    || desired.battleSessionId !== message.battleSessionId || desired.sceneEpoch !== message.sceneEpoch) break
                const sent = this.membershipSentAt.get(message.room)
                if (sent?.version === message.version) {
                    this.memberSyncObserved(message.room, this.now() - sent.at)
                    this.membershipSentAt.delete(message.room)
                }
                this.post({ t: "activate", room: message.room, instanceId: message.instanceId,
                    battleSessionId: message.battleSessionId, sceneEpoch: message.sceneEpoch, version: message.version })
                if (desired.members.length === 0) this.desiredMembership.delete(message.room)
                break
            }
            case "diagnostics": this.childDiagnostics = message.data; break
            case "activity":
                for (const item of message.items) this.proxies.get(item.sid)?.emit("relay-activity", item as RelayActivity)
                break
            case "closed":
                return (this.frameTails.get(message.sid) ?? Promise.resolve()).then(() => {
                    this.proxies.get(message.sid)?.remoteClosed(message.reason, message.hadError, message.detail)
                })
        }
    }

    private handleChildExit(child: ChildProcess, code: number | null, signal: NodeJS.Signals | null): void {
        if (this.child !== child) return
        if (!this.stopping && !this.ipc?.diagnostics().fault) this.lastFault = `child_exit:${code ?? "unknown"}:${signal ?? "none"}`
        this.child = null
        this.ready = false
        this.ipc?.close("relay_exit"); this.ipc = null
        this.pendingMembership.clear(); this.desiredMembership.clear(); this.membershipSentAt.clear(); this.childDiagnostics = null
        this.frameTails.clear()
        // Every adopted socket died with the child. Report them so rooms run
        // their normal departure path (Leave, absent-seat grace, AI takeover).
        for (const proxy of [...this.proxies.values()]) proxy.remoteClosed("relay_exit", true)
        this.proxies.clear()
        if (this.stopping) {
            for (const resolve of this.readyWaiters.splice(0)) resolve()
            return
        }
        console.error(`[BATTLE-RELAY] relay process exited: code=${code} signal=${signal}`)
        if (this.restarts >= MAX_RESTARTS) {
            console.error("[BATTLE-RELAY] restart limit reached; battle sockets stay in the main process")
            for (const resolve of this.readyWaiters.splice(0)) resolve()
            return
        }
        this.restarts++
        // New battle sockets stay in-process until the replacement is ready.
        void this.start()
    }
}

export const battleRelayBridge = new BattleRelayBridge()

export function isRelayProxySocket(socket: unknown): socket is RelayProxySocket {
    return socket instanceof RelayProxySocket
}
