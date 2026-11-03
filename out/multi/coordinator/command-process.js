"use strict";
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
exports.CommandProcessTransport = void 0;
const node_child_process_1 = require("node:child_process");
const path = __importStar(require("node:path"));
const command_protocol_1 = require("./command-protocol");
const parent_business_admission_1 = require("./parent-business-admission");
const shutdown_state_1 = require("../../lib/shutdown-state");
/** Explicit process transport for the serializable command kernel. No embedded fallback. */
class CommandProcessTransport {
    constructor(options) {
        var _a, _b, _c, _d;
        this.options = options;
        this.pending = new Map();
        this.bytes = 0;
        this.sequence = 0;
        this.epoch = "unavailable";
        this.ready = false;
        this.closed = false;
        this.quiescing = false;
        this.controls = new Map();
        this.drainWaiters = new Set();
        this.metadata = null;
        this.businessPending = 0;
        this.businessBytes = 0;
        this.ingressClosed = false;
        this.tcpWork = new Map();
        if (!path.isAbsolute(options.registerModule))
            throw new Error("registerModule must be an explicit absolute path");
        if (options.childPath !== undefined && !path.isAbsolute(options.childPath))
            throw new Error("childPath must be absolute");
        this.maxPending = (_a = options.maxPending) !== null && _a !== void 0 ? _a : 64;
        this.maxPendingBytes = (_b = options.maxPendingBytes) !== null && _b !== void 0 ? _b : 1024 * 1024;
        for (const [name, value, maximum] of [["maxPending", this.maxPending, 4096],
            ["maxPendingBytes", this.maxPendingBytes, 64 * 1024 * 1024]]) {
            if (!Number.isSafeInteger(value) || value < 1 || value > maximum)
                throw new Error(`invalid ${name}`);
        }
        for (const value of [(_c = options.startTimeoutMs) !== null && _c !== void 0 ? _c : 5000, (_d = options.requestTimeoutMs) !== null && _d !== void 0 ? _d : 1000]) {
            if (!Number.isSafeInteger(value) || value < 10 || value > 60000)
                throw new Error("invalid process timeout");
        }
    }
    get ownerEpoch() { return this.epoch === "unavailable" ? undefined : this.epoch; }
    get pid() { var _a; return (_a = this.child) === null || _a === void 0 ? void 0 : _a.pid; }
    get isReady() { var _a; return this.ready && !this.closed && ((_a = this.child) === null || _a === void 0 ? void 0 : _a.connected) === true; }
    /** Bootstrap metadata is copied; production bootstraps need not expose any endpoint. */
    bootstrapMetadata() { return (0, command_protocol_1.cloneCommandJson)(this.metadata); }
    diagnostics() {
        return { ready: this.ready, closed: this.closed, ownerEpoch: this.epoch,
            pendingMessages: this.pending.size, pendingBytes: this.bytes,
            businessPending: this.businessPending, businessPendingBytes: this.businessBytes,
            tcpWorkPending: this.tcpWork.size, ingressClosed: this.ingressClosed, quiescing: this.quiescing };
    }
    start() {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            if (this.child || this.closed)
                throw new Error("command process cannot be started twice");
            this.ingressAdmission = (0, parent_business_admission_1.createAcceptedRealtimeBusinessScope)({ ownerEpoch: "starting-owner", commandId: "tcp-ingress" });
            let child;
            try {
                child = this.child = (0, node_child_process_1.fork)((_a = this.options.childPath) !== null && _a !== void 0 ? _a : path.join(__dirname, "command-process-child.js"), [JSON.stringify({ registerModule: this.options.registerModule, maxPending: this.maxPending,
                        maxPendingBytes: this.maxPendingBytes })], { stdio: ["ignore", this.options.inheritOutput ? "inherit" : "ignore", this.options.inheritOutput ? "inherit" : "ignore", "ipc"],
                    serialization: "json", execArgv: [], env: Object.assign(Object.assign({}, process.env), this.options.childEnv) });
            }
            catch (error) {
                this.failPending("PROCESS_FORK_FAILED");
                throw error;
            }
            yield new Promise((resolve, reject) => {
                var _a;
                let starting = true;
                const fail = (reason) => {
                    this.failPending(reason);
                    if (starting) {
                        starting = false;
                        clearTimeout(timer);
                        reject(new Error(reason));
                    }
                };
                const timer = setTimeout(() => { fail("PROCESS_START_TIMEOUT"); child.kill(); }, (_a = this.options.startTimeoutMs) !== null && _a !== void 0 ? _a : 5000);
                child.on("error", () => fail("PROCESS_ERROR"));
                child.on("disconnect", () => fail("PROCESS_DISCONNECTED"));
                child.on("exit", () => fail("PROCESS_EXITED"));
                child.on("close", () => fail("PROCESS_CLOSED"));
                child.on("message", (message) => {
                    var _a, _b, _c, _d;
                    if ((message === null || message === void 0 ? void 0 : message.t) === "tcp-work-begin" || (message === null || message === void 0 ? void 0 : message.t) === "tcp-work-end") {
                        this.handleTcpWork(message, child);
                        return;
                    }
                    if ((message === null || message === void 0 ? void 0 : message.t) === "business-request") {
                        void this.handleBusiness(message, child);
                        return;
                    }
                    if ((message === null || message === void 0 ? void 0 : message.t) === "command-quiesced" || (message === null || message === void 0 ? void 0 : message.t) === "command-drained") {
                        if (message.t === "command-quiesced") {
                            this.ingressClosed = true;
                            (_a = this.ingressAdmission) === null || _a === void 0 ? void 0 : _a.release();
                            this.ingressAdmission = undefined;
                        }
                        const control = this.controls.get(message.requestId);
                        if (control) {
                            this.controls.delete(message.requestId);
                            control.resolve();
                        }
                        return;
                    }
                    if ((message === null || message === void 0 ? void 0 : message.t) === "command-ready" && starting && typeof message.ownerEpoch === "string") {
                        this.epoch = message.ownerEpoch;
                        this.metadata = (0, command_protocol_1.cloneCommandJson)((_b = message.metadata) !== null && _b !== void 0 ? _b : null);
                        this.ready = true;
                        starting = false;
                        clearTimeout(timer);
                        resolve();
                    }
                    else if ((message === null || message === void 0 ? void 0 : message.t) === "command-start-failed") {
                        fail("PROCESS_BOOTSTRAP_FAILED");
                        child.kill();
                    }
                    else if ((message === null || message === void 0 ? void 0 : message.t) === "command-result") {
                        const item = this.pending.get(message.requestId);
                        if (!item)
                            return; // A late response cannot release any other request.
                        const result = message.result;
                        const knownStatuses = ["pending", "completed", "rejected", "failed", "unknown"];
                        if ((result === null || result === void 0 ? void 0 : result.commandId) !== item.commandId || (result === null || result === void 0 ? void 0 : result.ownerEpoch) !== this.epoch
                            || !knownStatuses.includes(result.status)
                            || result.outcomeUnknown !== !["completed", "rejected"].includes(result.status)
                            || (result.status === "completed" && !Object.prototype.hasOwnProperty.call(result, "value"))) {
                            fail("PROCESS_INVALID_RESULT");
                            child.kill();
                            return;
                        }
                        this.pending.delete(message.requestId);
                        this.bytes -= item.bytes;
                        clearTimeout(item.timer);
                        (_c = item.admission) === null || _c === void 0 ? void 0 : _c.release();
                        (_d = item.resolve) === null || _d === void 0 ? void 0 : _d.call(item, (0, command_protocol_1.cloneCommandJson)(message.result));
                        this.changed();
                    }
                });
            });
        });
    }
    /** The child-to-parent FIFO cutoff bounds trusted TCP work registration. */
    handleTcpWork(message, child) {
        const id = message.requestId;
        if (!Number.isSafeInteger(id) || id <= 0) {
            this.failPending("TCP_WORK_INVALID_REQUEST");
            child.kill();
            return;
        }
        const reply = (body) => {
            if (!child.connected)
                return;
            try {
                child.send(Object.assign({ t: "tcp-work-result", requestId: id }, body), error => { if (error)
                    this.failPending("TCP_WORK_SEND_FAILED"); });
            }
            catch (_a) {
                this.failPending("TCP_WORK_SEND_FAILED");
            }
        };
        const workId = message.workId;
        let size;
        try {
            size = (0, command_protocol_1.commandJsonBytes)(message);
        }
        catch (_a) {
            reply({ ok: false, code: "TCP_WORK_INVALID_REQUEST" });
            return;
        }
        if (typeof workId !== "string" || !/^tcp\.[a-f0-9-]{36}$/.test(workId) || size > 4096) {
            reply({ ok: false, code: "TCP_WORK_INVALID_REQUEST" });
            return;
        }
        if (message.t === "tcp-work-end") {
            const scope = this.tcpWork.get(workId), proof = message.businessAdmission;
            if (!scope || !proof || Object.keys(proof).length !== 3 || proof.ownerEpoch !== scope.proof.ownerEpoch
                || proof.commandId !== scope.proof.commandId || proof.admissionToken !== scope.proof.admissionToken) {
                reply({ ok: false, code: "TCP_WORK_INVALID_ADMISSION" });
                return;
            }
            scope.release();
            this.tcpWork.delete(workId);
            reply({ ok: true, value: null });
            this.changed();
            return;
        }
        if (this.closed || this.ingressClosed || !this.ingressAdmission || this.tcpWork.size >= 128 || this.tcpWork.has(workId)) {
            reply({ ok: false, code: "SERVER_CLOSING" });
            return;
        }
        try {
            let scope;
            // Registration can cross global close only before the child's cutoff ACK.
            void this.ingressAdmission.run(() => __awaiter(this, void 0, void 0, function* () {
                scope = (0, parent_business_admission_1.createAcceptedRealtimeBusinessScope)({ ownerEpoch: this.epoch, commandId: workId });
            })).catch(error => reply({ ok: false, code: String((error === null || error === void 0 ? void 0 : error.code) || "TCP_WORK_REJECTED") }));
            if (scope) {
                this.tcpWork.set(workId, scope);
                reply({ ok: true, value: scope.proof });
            }
        }
        catch (error) {
            reply({ ok: false, code: String((error === null || error === void 0 ? void 0 : error.code) || "TCP_WORK_REJECTED") });
        }
    }
    handleBusiness(message, child) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c, _d;
            if (!Number.isSafeInteger(message.requestId) || message.requestId <= 0 || typeof message.kind !== "string"
                || message.kind.length > 128 || !this.options.businessHandler) {
                this.failPending("BUSINESS_INVALID_REQUEST");
                child.kill();
                return;
            }
            let size;
            try {
                size = (0, command_protocol_1.commandJsonBytes)(message);
            }
            catch (_e) {
                this.failPending("BUSINESS_INVALID_JSON");
                child.kill();
                return;
            }
            const reply = (body) => {
                if (!child.connected)
                    return;
                try {
                    child.send(Object.assign({ t: "business-result", requestId: message.requestId }, body), error => {
                        if (error) {
                            this.failPending("BUSINESS_SEND_FAILED");
                            child.kill();
                        }
                    });
                }
                catch (_a) {
                    this.failPending("BUSINESS_SEND_FAILED");
                    child.kill();
                }
            };
            if (size > 256 * 1024 || this.businessPending >= 64 || this.businessBytes + size > 4 * 1024 * 1024) {
                reply({ ok: false, code: "BUSINESS_PENDING_BUDGET" });
                return;
            }
            this.businessPending++;
            this.businessBytes += size;
            let admission;
            try {
                if (message.kind.startsWith("riven.") && ((_b = (_a = message.payload) === null || _a === void 0 ? void 0 : _a.identity) === null || _b === void 0 ? void 0 : _b.ownerEpoch) !== this.epoch) {
                    throw Object.assign(new Error("RIVEN_OWNER_EPOCH_MISMATCH"), { code: "RIVEN_OWNER_EPOCH_MISMATCH" });
                }
                const operation = () => this.options.businessHandler(message.kind, (0, command_protocol_1.cloneCommandJson)(message.payload));
                let result;
                if (message.businessAdmission !== undefined) {
                    if (((_c = message.businessAdmission) === null || _c === void 0 ? void 0 : _c.ownerEpoch) !== this.epoch)
                        throw Object.assign(new Error("BUSINESS_OWNER_EPOCH_MISMATCH"), { code: "BUSINESS_OWNER_EPOCH_MISMATCH" });
                    result = yield (0, parent_business_admission_1.dispatchAcceptedRealtimeBusiness)(message.businessAdmission, operation);
                }
                else {
                    if (this.quiescing || this.closed || (0, shutdown_state_1.isServerShuttingDown)())
                        throw Object.assign(new Error("SERVER_CLOSING"), { code: "SERVER_CLOSING" });
                    admission = (0, parent_business_admission_1.createAcceptedRealtimeBusinessScope)({ ownerEpoch: this.epoch, commandId: `tcp:${message.requestId}` });
                    result = yield admission.run(operation);
                }
                const value = (0, command_protocol_1.cloneCommandJson)(result);
                if ((0, command_protocol_1.commandJsonBytes)(value) > 480 * 1024)
                    throw Object.assign(new Error("Business result too large"), { code: "BUSINESS_RESULT_LIMIT" });
                reply({ ok: true, value });
            }
            catch (error) {
                const failure = error;
                // Older parents signal an unsupported optional Riven RPC with a plain Error.
                // Preserve only these explicit availability failures, never generic business errors.
                const unavailable = message.kind.startsWith("riven.")
                    && ["UNKNOWN_REALTIME_BUSINESS_KIND", "UNKNOWN_RIVEN_BUSINESS_KIND"].includes((_d = failure === null || failure === void 0 ? void 0 : failure.message) !== null && _d !== void 0 ? _d : "");
                reply({ ok: false, code: String((failure === null || failure === void 0 ? void 0 : failure.code) || (unavailable ? failure.message : "BUSINESS_HANDLER_FAILED")) });
            }
            finally {
                admission === null || admission === void 0 ? void 0 : admission.release();
                this.businessPending--;
                this.businessBytes -= size;
                this.changed();
            }
        });
    }
    submit(envelope) {
        var _a, _b, _c;
        let command;
        try {
            command = (0, command_protocol_1.cloneCommandJson)(envelope);
        }
        catch (_d) {
            return Promise.resolve(this.result((_a = envelope === null || envelope === void 0 ? void 0 : envelope.commandId) !== null && _a !== void 0 ? _a : "", "rejected", "INVALID_JSON", false));
        }
        if (!command || typeof command !== "object" || Array.isArray(command)
            || typeof command.commandId !== "string" || command.commandId.length > 128) {
            return Promise.resolve(this.result("", "rejected", "INVALID_COMMAND", false));
        }
        (_b = command.expectedOwnerEpoch) !== null && _b !== void 0 ? _b : (command.expectedOwnerEpoch = this.epoch);
        const duration = Number.isFinite(command.timeoutMs) && command.timeoutMs > 0 ? command.timeoutMs : 1000;
        return this.request({ t: "command-submit", envelope: command }, command.commandId, Math.min(60000, duration + ((_c = this.options.requestTimeoutMs) !== null && _c !== void 0 ? _c : 1000)));
    }
    queryResult(commandId) {
        var _a;
        if (typeof commandId !== "string" || commandId.length > 128)
            return Promise.resolve(this.result("", "rejected", "INVALID_COMMAND_ID", false));
        return this.request({ t: "command-query", commandId }, commandId, (_a = this.options.requestTimeoutMs) !== null && _a !== void 0 ? _a : 1000);
    }
    result(commandId, status, code, outcomeUnknown = true) {
        return { commandId, ownerEpoch: this.epoch, status, code, outcomeUnknown };
    }
    request(body, commandId, timeoutMs) {
        var _a;
        if (!this.ready || this.closed || !((_a = this.child) === null || _a === void 0 ? void 0 : _a.connected))
            return Promise.resolve(this.result(commandId, "unknown", "PROCESS_UNAVAILABLE"));
        const requestId = ++this.sequence;
        const submits = body.t === "command-submit";
        if (submits && this.quiescing && !(0, shutdown_state_1.hasServerWorkAdmission)())
            return Promise.resolve(this.result(commandId, "rejected", "SERVER_CLOSING", false));
        let admission;
        if (submits) {
            try {
                admission = (0, parent_business_admission_1.createAcceptedRealtimeBusinessScope)({ ownerEpoch: this.epoch, commandId });
            }
            catch (error) {
                return Promise.resolve(this.result(commandId, "rejected", String(error.code || "SERVER_CLOSING"), false));
            }
        }
        const message = Object.assign(Object.assign(Object.assign({}, body), { requestId }), (admission ? { businessAdmission: admission.proof } : {}));
        let bytes;
        try {
            bytes = (0, command_protocol_1.commandJsonBytes)(message);
        }
        catch (_b) {
            admission === null || admission === void 0 ? void 0 : admission.release();
            return Promise.resolve(this.result(commandId, "rejected", "INVALID_JSON", false));
        }
        if (this.pending.size >= this.maxPending || this.bytes + bytes > this.maxPendingBytes) {
            admission === null || admission === void 0 ? void 0 : admission.release();
            return Promise.resolve(this.result(commandId, "rejected", "PROCESS_QUEUE_LIMIT", false));
        }
        return new Promise(resolve => {
            var _a;
            const timer = setTimeout(() => {
                var _a;
                const item = this.pending.get(requestId);
                (_a = item === null || item === void 0 ? void 0 : item.resolve) === null || _a === void 0 ? void 0 : _a.call(item, this.result(commandId, "unknown", "PROCESS_RESPONSE_TIMEOUT"));
                // Retain the application budget until the real result or channel closure.
                if (item)
                    item.resolve = undefined;
            }, timeoutMs);
            this.pending.set(requestId, { commandId, bytes, resolve, timer, admission });
            this.bytes += bytes;
            try {
                this.child.send(message, error => {
                    var _a;
                    if (error) {
                        this.failPending("PROCESS_SEND_FAILED");
                        (_a = this.child) === null || _a === void 0 ? void 0 : _a.kill();
                    }
                });
            }
            catch (_b) {
                this.failPending("PROCESS_SEND_FAILED");
                (_a = this.child) === null || _a === void 0 ? void 0 : _a.kill();
            }
        });
    }
    failPending(code) {
        var _a, _b, _c;
        if (!this.closed && this.ownerEpoch) {
            require("../../lib/weapon-riven/multi-store").rivenSnapshotStore.releaseOwnerEpoch(this.ownerEpoch);
        }
        this.closed = true;
        this.ready = false;
        this.ingressClosed = true;
        (_a = this.ingressAdmission) === null || _a === void 0 ? void 0 : _a.release();
        this.ingressAdmission = undefined;
        for (const scope of this.tcpWork.values())
            scope.release();
        this.tcpWork.clear();
        for (const item of this.pending.values()) {
            clearTimeout(item.timer);
            (_b = item.admission) === null || _b === void 0 ? void 0 : _b.release();
            (_c = item.resolve) === null || _c === void 0 ? void 0 : _c.call(item, this.result(item.commandId, "unknown", code));
        }
        this.pending.clear();
        this.bytes = 0;
        for (const control of this.controls.values())
            control.reject(new Error(code));
        this.controls.clear();
        this.changed();
    }
    changed() { for (const wake of this.drainWaiters)
        wake(); this.drainWaiters.clear(); }
    control(type) {
        if (!this.isReady)
            return Promise.reject(new Error("PROCESS_UNAVAILABLE"));
        const requestId = ++this.sequence;
        return new Promise((resolve, reject) => {
            this.controls.set(requestId, { resolve, reject });
            try {
                this.child.send({ t: type, requestId }, error => { if (error)
                    this.failPending("PROCESS_SEND_FAILED"); });
            }
            catch (_a) {
                this.failPending("PROCESS_SEND_FAILED");
            }
        });
    }
    quiesce() {
        if (!this.quiesced) {
            this.quiescing = true;
            this.quiesced = this.closed || !this.child ? Promise.resolve() : this.control("command-quiesce");
        }
        return this.quiesced;
    }
    drain() {
        return __awaiter(this, void 0, void 0, function* () {
            while (this.pending.size || this.businessPending || this.tcpWork.size)
                yield new Promise(resolve => this.drainWaiters.add(resolve));
            if (this.isReady)
                yield this.control("command-drain");
            while (this.pending.size || this.businessPending || this.tcpWork.size)
                yield new Promise(resolve => this.drainWaiters.add(resolve));
        });
    }
    stop() {
        if (!this.stopped)
            this.stopped = (() => __awaiter(this, void 0, void 0, function* () {
                if (!this.closed) {
                    yield this.quiesce();
                    yield this.drain();
                }
                yield this.terminate(false);
            }))();
        return this.stopped;
    }
    /** Failure path only; graceful service close is governed by its overall deadline. */
    abort() {
        return __awaiter(this, void 0, void 0, function* () { yield this.terminate(true); });
    }
    terminate(force) {
        return __awaiter(this, void 0, void 0, function* () {
            this.failPending("PROCESS_STOPPED");
            const child = this.child;
            if (!child || child.exitCode !== null || child.signalCode !== null)
                return;
            yield new Promise(resolve => {
                const timer = force ? setTimeout(() => child.kill(), 1000) : undefined;
                const done = () => { clearTimeout(timer); resolve(); };
                child.once("exit", done);
                child.once("close", done);
                if (child.connected)
                    child.send({ t: "command-shutdown" }, () => { });
                else
                    child.kill();
            });
        });
    }
}
exports.CommandProcessTransport = CommandProcessTransport;
