"use strict";
// Main-process side of the battle relay child (opt-in: MULTI_BATTLE_RELAY_PROCESS=1).
//
// A battle socket is handed to the child right after its handshake frame is
// read. The main process keeps a RelayProxySocket in its place, so handshake,
// barriers, leases, Leave/BattleStart and settlement code keep working on a
// socket-like object: writes become IPC messages, and the child forwards the
// frames the main process must see as `data` events.
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isRelayProxySocket = exports.battleRelayBridge = exports.BattleRelayBridge = exports.RelayProxySocket = exports.battleRelayProcessEnabled = void 0;
const events_1 = require("events");
const child_process_1 = require("child_process");
const path = __importStar(require("path"));
const ipc_1 = require("./ipc");
function positiveInteger(name, fallback, minimum) {
    var _a;
    const value = Number.parseInt((_a = process.env[name]) !== null && _a !== void 0 ? _a : "", 10);
    return Number.isFinite(value) ? Math.max(minimum, value) : fallback;
}
function battleRelayProcessEnabled(environment = process.env) {
    var _a;
    return /^(1|true|yes|on)$/i.test((_a = environment.MULTI_BATTLE_RELAY_PROCESS) !== null && _a !== void 0 ? _a : "");
}
exports.battleRelayProcessEnabled = battleRelayProcessEnabled;
/** Restarts allowed per server process; after that battle sockets stay in-process. */
const MAX_RESTARTS = positiveInteger("MULTI_BATTLE_RELAY_MAX_RESTARTS", 5, 0);
/**
 * Stands in for a battle `net.Socket` whose file descriptor now lives in the
 * relay child. Implements the subset of the socket API the multi code uses.
 */
class RelayProxySocket extends events_1.EventEmitter {
    get writableLength() { return this.bridge.pendingSocketBytes(this.sid); }
    constructor(sid, bridge, remoteAddress, remotePort) {
        super();
        this.sid = sid;
        this.bridge = bridge;
        this.remoteAddress = remoteAddress;
        this.remotePort = remotePort;
        this.destroyed = false;
        this.writableEnded = false;
        this.readable = true;
        this.closeEmitted = false;
    }
    get writable() {
        return !this.destroyed && !this.writableEnded;
    }
    write(data) {
        if (!this.writable)
            return false;
        return this.bridge.post({ t: "write", sid: this.sid, data: typeof data === "string" ? data : Buffer.from(data).toString("utf8") });
    }
    end(data) {
        if (this.destroyed || this.writableEnded)
            return this;
        if (data !== undefined)
            this.write(data);
        this.writableEnded = true;
        this.bridge.post({ t: "end", sid: this.sid });
        return this;
    }
    destroy() {
        if (this.destroyed)
            return this;
        this.destroyed = true;
        this.readable = false;
        this.bridge.post({ t: "destroy", sid: this.sid });
        process.nextTick(() => this.emitClose(false));
        return this;
    }
    setNoDelay() { return this; }
    setKeepAlive() { return this; }
    setEncoding() { return this; }
    setTimeout() { return this; }
    pause() { return this; }
    resume() { return this; }
    ref() { return this; }
    unref() { return this; }
    /** Production listeners resolve only after the exact forwarded frame boundary. */
    receiveFrames(data, identity) {
        return new Promise((resolve, reject) => {
            if (this.destroyed) {
                reject(new Error("relay_socket_closed"));
                return;
            }
            if (this.listenerCount("relay-frames") > 0) {
                this.emit("relay-frames", data, (error) => error ? reject(error) : resolve(), identity);
                // Existing diagnostic observers can still observe incoming bytes.
                this.emit("data", data);
            }
            else {
                this.emit("data", data);
                resolve();
            }
        });
    }
    /** The child reported that the real socket closed. */
    remoteClosed(reason, hadError, detail) {
        if (this.closeEmitted)
            return;
        this.readable = false;
        if (reason === "peer_fin") {
            this.emit("end");
        }
        else if (reason === "socket_error") {
            const error = new Error(detail !== null && detail !== void 0 ? detail : "battle relay socket error");
            error.code = detail;
            this.emit("error", error);
        }
        else if (reason !== "parent_request") {
            this.emit("relay-close-reason", reason, detail);
        }
        this.destroyed = true;
        this.emitClose(hadError);
    }
    emitClose(hadError) {
        if (this.closeEmitted)
            return;
        this.closeEmitted = true;
        this.bridge.forget(this.sid);
        this.emit("close", hadError);
    }
}
exports.RelayProxySocket = RelayProxySocket;
class BattleRelayBridge {
    constructor(childPath = path.join(__dirname, "child.js"), memberSyncObserved = (room, durationMs) => {
        // Keep the bridge independently loadable; telemetry already loads it
        // through SessionManager and must not form an eager import cycle.
        require("../../battle-telemetry").battleTelemetry.controlDelay(room, "member-sync", durationMs);
    }, now = () => performance.now()) {
        this.childPath = childPath;
        this.memberSyncObserved = memberSyncObserved;
        this.now = now;
        this.child = null;
        this.ready = false;
        this.stopping = false;
        this.restarts = 0;
        this.nextSid = 1;
        this.proxies = new Map();
        this.ipc = null;
        this.membershipVersion = 0;
        this.desiredMembership = new Map();
        this.membershipSentAt = new Map();
        this.pendingMembership = new Map();
        this.childDiagnostics = null;
        this.lastFault = null;
        this.rejectedFrames = { instance: 0, run: 0, scene: 0, unbound: 0 };
        this.frameTails = new Map();
        this.membershipFlushQueued = false;
        this.readyWaiters = [];
    }
    get isReady() {
        return this.ready && this.child !== null && this.child.connected;
    }
    get activeSockets() {
        return this.proxies.size;
    }
    pendingSocketBytes(sid) { var _a, _b; return (_b = (_a = this.ipc) === null || _a === void 0 ? void 0 : _a.pendingBytesFor(m => m.t === "write" && m.sid === sid)) !== null && _b !== void 0 ? _b : 0; }
    noteRejectedFrames(reason) { this.rejectedFrames[reason]++; }
    diagnostics() {
        var _a, _b, _c, _d;
        return { enabled: battleRelayProcessEnabled(), ready: this.isReady, pid: (_b = (_a = this.child) === null || _a === void 0 ? void 0 : _a.pid) !== null && _b !== void 0 ? _b : null,
            proxies: this.proxies.size, restarts: this.restarts, lastFault: this.lastFault,
            pendingMembership: this.pendingMembership.size, desiredMembership: this.desiredMembership.size,
            parentIpc: (_d = (_c = this.ipc) === null || _c === void 0 ? void 0 : _c.diagnostics()) !== null && _d !== void 0 ? _d : null, child: this.childDiagnostics, rejectedFrames: Object.assign({}, this.rejectedFrames) };
    }
    start() {
        if (this.child)
            return this.waitReady();
        this.stopping = false;
        const child = (0, child_process_1.fork)(this.childPath, [], {
            // Inspector or profiler flags of the main process must not be inherited.
            execArgv: [],
            serialization: "json",
            stdio: ["ignore", "inherit", "inherit", "ipc"],
        });
        this.child = child;
        this.ipc = new ipc_1.BoundedRelayIpc((message, handle, callback) => {
            if (!child.connected)
                throw new Error("ipc_disconnected");
            return handle === undefined ? child.send(message, callback)
                : child.send(message, handle, { keepOpen: false }, callback);
        }, reason => {
            if (this.child !== child)
                return;
            this.lastFault = reason;
            this.ready = false;
            console.error(`[BATTLE-RELAY] parent IPC failed: reason=${reason}; closing adopted sockets`);
            // A synchronous send failure can happen inside adopt(), before the
            // caller attaches cleanup listeners to the returned proxy.
            for (const proxy of [...this.proxies.values()])
                process.nextTick(() => proxy.remoteClosed("relay_exit", true, reason));
            child.kill();
        });
        const ipc = this.ipc;
        child.on("message", (message) => {
            if (this.child === child)
                ipc.receive(message, undefined, body => this.handleChildMessage(body));
        });
        child.on("exit", (code, signal) => this.handleChildExit(child, code, signal));
        child.on("error", (error) => {
            console.error("[BATTLE-RELAY] child process error:", error);
            this.lastFault = "child_process_error";
            // A failed spawn may emit error/close without an exit event.
            if (child.pid === undefined)
                this.handleChildExit(child, null, null);
        });
        return this.waitReady();
    }
    waitReady() {
        if (this.isReady)
            return Promise.resolve();
        return new Promise(resolve => this.readyWaiters.push(resolve));
    }
    stop() {
        const child = this.child;
        this.stopping = true;
        if (!child)
            return Promise.resolve();
        return new Promise(resolve => {
            const timer = setTimeout(() => child.kill(), 2000);
            timer.unref();
            const done = () => {
                clearTimeout(timer);
                child.off("exit", done);
                child.off("close", done);
                resolve();
            };
            child.once("exit", done);
            // A failed spawn emits error/close without an exit event.
            child.once("close", done);
            this.post({ t: "shutdown" });
        });
    }
    post(message) {
        const child = this.child;
        if (!child || !this.ipc)
            return false;
        return this.ipc.enqueue(message);
    }
    forget(sid) {
        this.proxies.delete(sid);
    }
    /**
     * Moves a freshly accepted socket into the child. Returns the proxy that
     * replaces it, plus any bytes the main process had already buffered, or
     * null when the child cannot take it (the caller keeps the socket).
     */
    adopt(socket) {
        var _a, _b;
        const child = this.child;
        if (!this.isReady || !child)
            return null;
        // setEncoding() can retain an incomplete UTF-8 code point that read()
        // cannot recover. Keep that decoder and socket in the parent instead.
        const decoder = (_a = socket._readableState) === null || _a === void 0 ? void 0 : _a.decoder;
        if (((_b = decoder === null || decoder === void 0 ? void 0 : decoder.lastNeed) !== null && _b !== void 0 ? _b : 0) > 0)
            return null;
        const handle = socket._handle;
        if (!(handle === null || handle === void 0 ? void 0 : handle.readStop))
            return null;
        for (const event of ["data", "end", "close", "error", "drain", "timeout"])
            socket.removeAllListeners(event);
        // The parent copy is closed after transfer; a late error must not crash.
        socket.on("error", () => { });
        socket.pause();
        handle.reading = false;
        handle.readStop();
        // Bytes libuv already read but the stream has not emitted yet.
        let pending = "";
        let chunk;
        while ((chunk = socket.read()) !== null)
            pending += String(chunk);
        socket.server = null;
        const sid = this.nextSid++;
        const proxy = new RelayProxySocket(sid, this, socket.remoteAddress, socket.remotePort);
        this.proxies.set(sid, proxy);
        try {
            this.ipc.enqueue({ t: "adopt", sid }, socket, (error) => {
                // The parent's handle is already closed; this releases the
                // JS socket and the server's connection count.
                socket.destroy();
                if (error) {
                    console.error(`[BATTLE-RELAY] socket handoff failed: sid=${sid}`, error.message);
                    process.nextTick(() => proxy.remoteClosed("socket_error", true, "handoff_failed"));
                }
            });
        }
        catch (error) {
            console.error(`[BATTLE-RELAY] socket handoff threw: sid=${sid}`, error.message);
            socket.destroy();
            process.nextTick(() => proxy.remoteClosed("socket_error", true, "handoff_failed"));
        }
        return { proxy, pending };
    }
    /**
     * Publishes a room's relay membership. Several changes in one turn of the
     * event loop collapse into one IPC message carrying the final state.
     */
    scheduleMembership(roomNumber, compute, identity) {
        if (!this.child)
            return;
        // Missing identity can only use parent routing, never an invented room identity.
        this.pendingMembership.set(roomNumber, { compute, identity: identity !== null && identity !== void 0 ? identity : { instanceId: "", battleSessionId: null, sceneEpoch: 0 } });
        if (this.membershipFlushQueued)
            return;
        this.membershipFlushQueued = true;
        queueMicrotask(() => {
            this.membershipFlushQueued = false;
            const pending = [...this.pendingMembership];
            this.pendingMembership.clear();
            for (const [room, { compute, identity }] of pending) {
                const snapshot = Object.assign(Object.assign({ t: "members", room }, identity), { version: ++this.membershipVersion, members: compute() });
                this.desiredMembership.set(room, snapshot);
                this.membershipSentAt.set(room, { version: snapshot.version, at: this.now() });
                this.post(snapshot);
            }
        });
    }
    handleChildMessage(message) {
        var _a, _b, _c, _d;
        switch (message.t) {
            case "ready":
                this.ready = true;
                for (const resolve of this.readyWaiters.splice(0))
                    resolve();
                console.log("[BATTLE-RELAY] relay process ready");
                break;
            case "adopted":
                if (!message.ok)
                    (_a = this.proxies.get(message.sid)) === null || _a === void 0 ? void 0 : _a.remoteClosed("socket_error", true, "adopt_rejected");
                break;
            case "frames":
                const previous = (_b = this.frameTails.get(message.sid)) !== null && _b !== void 0 ? _b : Promise.resolve();
                const applied = previous.then(() => __awaiter(this, void 0, void 0, function* () {
                    const proxy = this.proxies.get(message.sid);
                    if (proxy && !proxy.destroyed) {
                        try {
                            yield proxy.receiveFrames(message.data, message.identity);
                        }
                        catch (error) {
                            if (!proxy.destroyed)
                                throw error;
                        }
                    }
                    // A deliberately retired socket is already explicitly closed;
                    // acknowledge its queued ingress without reviving its ownership.
                    this.post({ t: "control-applied", sid: message.sid, controlId: message.controlId });
                }));
                this.frameTails.set(message.sid, applied);
                void applied.then(() => { if (this.frameTails.get(message.sid) === applied)
                    this.frameTails.delete(message.sid); }, () => { });
                return applied;
            case "members-applied": {
                const desired = this.desiredMembership.get(message.room);
                if (!desired || desired.version !== message.version || desired.instanceId !== message.instanceId
                    || desired.battleSessionId !== message.battleSessionId || desired.sceneEpoch !== message.sceneEpoch)
                    break;
                const sent = this.membershipSentAt.get(message.room);
                if ((sent === null || sent === void 0 ? void 0 : sent.version) === message.version) {
                    this.memberSyncObserved(message.room, this.now() - sent.at);
                    this.membershipSentAt.delete(message.room);
                }
                this.post({ t: "activate", room: message.room, instanceId: message.instanceId,
                    battleSessionId: message.battleSessionId, sceneEpoch: message.sceneEpoch, version: message.version });
                if (desired.members.length === 0)
                    this.desiredMembership.delete(message.room);
                break;
            }
            case "diagnostics":
                this.childDiagnostics = message.data;
                break;
            case "activity":
                for (const item of message.items)
                    (_c = this.proxies.get(item.sid)) === null || _c === void 0 ? void 0 : _c.emit("relay-activity", item);
                break;
            case "closed":
                return ((_d = this.frameTails.get(message.sid)) !== null && _d !== void 0 ? _d : Promise.resolve()).then(() => {
                    var _a;
                    (_a = this.proxies.get(message.sid)) === null || _a === void 0 ? void 0 : _a.remoteClosed(message.reason, message.hadError, message.detail);
                });
        }
    }
    handleChildExit(child, code, signal) {
        var _a, _b;
        if (this.child !== child)
            return;
        if (!this.stopping && !((_a = this.ipc) === null || _a === void 0 ? void 0 : _a.diagnostics().fault))
            this.lastFault = `child_exit:${code !== null && code !== void 0 ? code : "unknown"}:${signal !== null && signal !== void 0 ? signal : "none"}`;
        this.child = null;
        this.ready = false;
        (_b = this.ipc) === null || _b === void 0 ? void 0 : _b.close("relay_exit");
        this.ipc = null;
        this.pendingMembership.clear();
        this.desiredMembership.clear();
        this.membershipSentAt.clear();
        this.childDiagnostics = null;
        this.frameTails.clear();
        // Every adopted socket died with the child. Report them so rooms run
        // their normal departure path (Leave, absent-seat grace, AI takeover).
        for (const proxy of [...this.proxies.values()])
            proxy.remoteClosed("relay_exit", true);
        this.proxies.clear();
        if (this.stopping) {
            for (const resolve of this.readyWaiters.splice(0))
                resolve();
            return;
        }
        console.error(`[BATTLE-RELAY] relay process exited: code=${code} signal=${signal}`);
        if (this.restarts >= MAX_RESTARTS) {
            console.error("[BATTLE-RELAY] restart limit reached; battle sockets stay in the main process");
            for (const resolve of this.readyWaiters.splice(0))
                resolve();
            return;
        }
        this.restarts++;
        // New battle sockets stay in-process until the replacement is ready.
        void this.start();
    }
}
exports.BattleRelayBridge = BattleRelayBridge;
exports.battleRelayBridge = new BattleRelayBridge();
function isRelayProxySocket(socket) {
    return socket instanceof RelayProxySocket;
}
exports.isRelayProxySocket = isRelayProxySocket;
