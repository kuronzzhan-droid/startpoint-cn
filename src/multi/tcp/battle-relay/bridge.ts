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
import type { RelayActivity, RelayChildMessage, RelayCloseReason, RelayMember, RelayParentMessage } from "./protocol"

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
    readonly writableLength = 0
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
        this.bridge.post({ t: "write", sid: this.sid, data: typeof data === "string" ? data : Buffer.from(data).toString("utf8") })
        return true
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
    private readonly pendingMembership = new Map<string, () => RelayMember[]>()
    private membershipFlushQueued = false
    private readyWaiters: Array<() => void> = []

    constructor(private readonly childPath = path.join(__dirname, "child.js")) {}

    get isReady(): boolean {
        return this.ready && this.child !== null && this.child.connected
    }

    get activeSockets(): number {
        return this.proxies.size
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
        child.on("message", (message: RelayChildMessage) => this.handleChildMessage(message))
        child.on("exit", (code, signal) => this.handleChildExit(child, code, signal))
        child.on("error", (error) => console.error("[BATTLE-RELAY] child process error:", error))
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
            child.once("exit", () => {
                clearTimeout(timer)
                resolve()
            })
            this.post({ t: "shutdown" })
        })
    }

    post(message: RelayParentMessage): void {
        const child = this.child
        if (!child || !child.connected) return
        try {
            child.send(message)
        } catch (error) {
            console.error("[BATTLE-RELAY] IPC send failed:", (error as Error).message)
        }
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
            child.send({ t: "adopt", sid } satisfies RelayParentMessage, socket, { keepOpen: false }, (error) => {
                // The parent's handle is already closed; this releases the
                // JS socket and the server's connection count.
                socket.destroy()
                if (error) {
                    console.error(`[BATTLE-RELAY] socket handoff failed: sid=${sid}`, error.message)
                    proxy.remoteClosed("socket_error", true, "handoff_failed")
                }
            })
        } catch (error) {
            console.error(`[BATTLE-RELAY] socket handoff threw: sid=${sid}`, (error as Error).message)
            process.nextTick(() => proxy.remoteClosed("socket_error", true, "handoff_failed"))
        }
        return { proxy, pending }
    }

    /**
     * Publishes a room's relay membership. Several changes in one turn of the
     * event loop collapse into one IPC message carrying the final state.
     */
    scheduleMembership(roomNumber: string, compute: () => RelayMember[]): void {
        if (!this.child) return
        this.pendingMembership.set(roomNumber, compute)
        if (this.membershipFlushQueued) return
        this.membershipFlushQueued = true
        queueMicrotask(() => {
            this.membershipFlushQueued = false
            const pending = [...this.pendingMembership]
            this.pendingMembership.clear()
            for (const [room, computeMembers] of pending) {
                this.post({ t: "members", room, members: computeMembers() })
            }
        })
    }

    private handleChildMessage(message: RelayChildMessage): void {
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
                this.proxies.get(message.sid)?.emit("data", message.data)
                break
            case "activity":
                for (const item of message.items) this.proxies.get(item.sid)?.emit("relay-activity", item as RelayActivity)
                break
            case "closed":
                this.proxies.get(message.sid)?.remoteClosed(message.reason, message.hadError, message.detail)
                break
        }
    }

    private handleChildExit(child: ChildProcess, code: number | null, signal: NodeJS.Signals | null): void {
        if (this.child !== child) return
        this.child = null
        this.ready = false
        // Every adopted socket died with the child. Report them so rooms run
        // their normal departure path (Leave, absent-seat grace, AI takeover).
        for (const proxy of [...this.proxies.values()]) proxy.remoteClosed("relay_exit", true)
        this.proxies.clear()
        if (this.stopping) return
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
