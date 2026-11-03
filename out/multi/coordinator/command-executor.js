"use strict";
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
exports.RoomCommandExecutor = void 0;
const crypto_1 = require("crypto");
const perf_hooks_1 = require("perf_hooks");
const command_protocol_1 = require("./command-protocol");
/** No room or DB imports: only the registered owner handlers can mutate authority. */
class RoomCommandExecutor {
    constructor(options = {}) {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o;
        this.handlers = new Map();
        this.records = new Map();
        this.queue = [];
        this.wallFloor = 0;
        this.pending = 0;
        this.pendingBytes = 0;
        this.retainedBytes = 0;
        this.running = 0;
        this.duplicateWaiters = 0;
        this.closed = false;
        this.quiescing = false;
        this.handlerContext = (_id, operation) => operation();
        this.pumping = false;
        this.ownerEpoch = (_a = options.ownerEpoch) !== null && _a !== void 0 ? _a : (0, crypto_1.randomUUID)();
        if (!this.ownerEpoch || this.ownerEpoch.length > 128)
            throw new Error("Invalid owner epoch");
        this.now = (_b = options.now) !== null && _b !== void 0 ? _b : (() => perf_hooks_1.performance.now());
        this.wallNow = (_c = options.wallNow) !== null && _c !== void 0 ? _c : (() => Date.now());
        this.limits = {
            maxMessages: (_d = options.maxMessages) !== null && _d !== void 0 ? _d : 256,
            maxBytes: (_e = options.maxBytes) !== null && _e !== void 0 ? _e : 4 * 1024 * 1024,
            maxMessageBytes: (_f = options.maxMessageBytes) !== null && _f !== void 0 ? _f : 256 * 1024,
            maxAgeMs: (_g = options.maxAgeMs) !== null && _g !== void 0 ? _g : 10000,
            maxConcurrent: (_h = options.maxConcurrent) !== null && _h !== void 0 ? _h : 16,
            maxRecords: (_j = options.maxRecords) !== null && _j !== void 0 ? _j : 8192,
            maxRetainedBytes: (_k = options.maxRetainedBytes) !== null && _k !== void 0 ? _k : 64 * 1024 * 1024,
            maxResultBytes: (_l = options.maxResultBytes) !== null && _l !== void 0 ? _l : 256 * 1024,
            resultRetentionMs: (_m = options.resultRetentionMs) !== null && _m !== void 0 ? _m : 300000,
            futureClockSkewMs: (_o = options.futureClockSkewMs) !== null && _o !== void 0 ? _o : 1000,
        };
        for (const [key, value] of Object.entries(this.limits)) {
            if (!Number.isFinite(value) || value < (key === "futureClockSkewMs" ? 0 : 1))
                throw new Error(`Invalid executor limit: ${key}`);
            if (["maxMessages", "maxBytes", "maxMessageBytes", "maxConcurrent", "maxRecords", "maxRetainedBytes", "maxResultBytes"].includes(key)
                && !Number.isSafeInteger(value))
                throw new Error(`Invalid integer executor limit: ${key}`);
        }
    }
    register(kind, handler) {
        if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(kind) || typeof handler !== "function")
            throw new Error("Invalid command handler");
        if (this.handlers.has(kind))
            throw new Error(`Command handler already registered: ${kind}`);
        if (this.closed)
            throw new Error("Executor closed");
        this.handlers.set(kind, handler);
    }
    setHandlerContext(runner) { this.handlerContext = runner; }
    submit(input_1) {
        return __awaiter(this, arguments, void 0, function* (input, acceptedContinuation = false) {
            let command;
            try {
                command = (0, command_protocol_1.cloneCommandJson)(input);
            }
            catch (_a) {
                return this.reject(typeof (input === null || input === void 0 ? void 0 : input.commandId) === "string" ? input.commandId : "", "INVALID_JSON");
            }
            if (!command || typeof command !== "object" || Array.isArray(command))
                return this.reject("", "INVALID_COMMAND");
            const id = typeof command.commandId === "string" ? command.commandId : "";
            const wall = this.advanceWall();
            this.pruneAt(wall);
            const issuedAt = typeof id === "string" ? (0, command_protocol_1.roomCommandIssuedAt)(id) : undefined;
            if (command.protocol !== 1 || typeof command.kind !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(command.kind)
                || issuedAt === undefined || !Number.isFinite(command.timeoutMs) || command.timeoutMs < 1)
                return this.reject(id, "INVALID_COMMAND");
            if (!Object.prototype.hasOwnProperty.call(command, "payload"))
                return this.reject(id, "INVALID_COMMAND");
            if (command.expectedIdentity !== undefined && (!command.expectedIdentity || typeof command.expectedIdentity !== "object" || Array.isArray(command.expectedIdentity)))
                return this.reject(id, "INVALID_COMMAND");
            if (command.expectedOwnerEpoch !== undefined && command.expectedOwnerEpoch !== this.ownerEpoch)
                return this.reject(id, "OWNER_EPOCH_MISMATCH");
            if (issuedAt > wall + this.limits.futureClockSkewMs || wall - issuedAt >= this.limits.resultRetentionMs)
                return this.reject(id, "COMMAND_ID_EXPIRED");
            const fingerprint = (0, command_protocol_1.roomCommandFingerprint)(command);
            const previous = this.records.get(id);
            if (previous) {
                if (previous.fingerprint !== fingerprint)
                    return this.reject(id, "COMMAND_ID_COLLISION");
                if (previous.result.status !== "pending")
                    return (0, command_protocol_1.cloneCommandJson)(previous.result);
                if (this.duplicateWaiters >= this.limits.maxMessages)
                    return this.reject(id, "ACK_WAITER_BUDGET");
                this.duplicateWaiters++;
                try {
                    return (0, command_protocol_1.cloneCommandJson)(yield previous.promise);
                }
                finally {
                    this.duplicateWaiters--;
                }
            }
            if (this.closed)
                return this.reject(id, "EXECUTOR_CLOSED");
            if (this.quiescing && !acceptedContinuation)
                return this.reject(id, "SERVER_CLOSING");
            const bytes = (0, command_protocol_1.commandJsonBytes)(command);
            if (bytes > this.limits.maxMessageBytes)
                return this.reject(id, "MESSAGE_BYTE_LIMIT");
            if (this.pending >= this.limits.maxMessages || this.pendingBytes + bytes > this.limits.maxBytes)
                return this.reject(id, "PENDING_BUDGET");
            const now = this.now();
            if ([...this.records.values()].some(record => record.result.status === "pending" && now - record.at >= this.limits.maxAgeMs))
                return this.reject(id, "PENDING_AGE_LIMIT");
            // Reserve room for the application ACK before admitting any mutation.
            const reservation = bytes + Math.max(1024, this.limits.maxResultBytes);
            if (this.records.size >= this.limits.maxRecords || this.retainedBytes + reservation > this.limits.maxRetainedBytes)
                return this.reject(id, "RESULT_BUDGET");
            let resolve;
            const promise = new Promise(done => { resolve = done; });
            const record = { command, fingerprint, at: now, issuedAt,
                deadline: now + Math.min(command.timeoutMs, this.limits.maxAgeMs), bytes,
                retainedBytes: reservation, running: false, promise, resolve,
                result: { commandId: id, ownerEpoch: this.ownerEpoch, status: "pending", outcomeUnknown: true } };
            this.records.set(id, record);
            this.queue.push(record);
            this.pending++;
            this.pendingBytes += bytes;
            this.retainedBytes += reservation;
            queueMicrotask(() => this.pump());
            return (0, command_protocol_1.cloneCommandJson)(yield promise);
        });
    }
    queryResult(commandId) {
        return __awaiter(this, void 0, void 0, function* () {
            this.pruneAt(this.advanceWall());
            const record = this.records.get(commandId);
            return record ? (0, command_protocol_1.cloneCommandJson)(record.result) : {
                commandId, ownerEpoch: this.ownerEpoch, status: "unknown", outcomeUnknown: true,
                code: "RESULT_NOT_RETAINED", reason: "No retained result in this owner epoch; do not replay automatically",
            };
        });
    }
    /** Expiry permanently rejects that timestamped ID; no forgotten-ID replay window. */
    prune() { this.pruneAt(this.advanceWall()); }
    inspect() {
        this.prune();
        const now = this.now();
        let oldestPendingAgeMs = 0;
        for (const record of this.records.values())
            if (record.result.status === "pending")
                oldestPendingAgeMs = Math.max(oldestPendingAgeMs, now - record.at);
        return { ownerEpoch: this.ownerEpoch, closed: this.closed, pending: this.pending,
            duplicateWaiters: this.duplicateWaiters,
            running: this.running, queued: this.queue.length, pendingBytes: this.pendingBytes,
            records: this.records.size, retainedBytes: this.retainedBytes,
            oldestPendingAgeMs, limits: Object.assign({}, this.limits) };
    }
    close() {
        this.closed = true;
        for (const record of this.queue.splice(0))
            this.finish(record, this.reject(record.command.commandId, "EXECUTOR_CLOSED"));
        // Already-running handlers cannot safely be cancelled; their results remain queryable.
    }
    /** Withdraw fresh admission without discarding already queued handlers. */
    quiesce() { this.quiescing = true; }
    drain() {
        return __awaiter(this, void 0, void 0, function* () {
            while (this.pending)
                yield Promise.allSettled([...this.records.values()]
                    .filter(record => record.result.status === "pending").map(record => record.promise));
        });
    }
    advanceWall() {
        this.wallFloor = Math.max(this.wallFloor, this.wallNow());
        return this.wallFloor;
    }
    pruneAt(wall) {
        for (const [id, record] of this.records) {
            if (record.result.status !== "pending" && wall - record.issuedAt >= this.limits.resultRetentionMs) {
                this.records.delete(id);
                this.retainedBytes -= record.retainedBytes;
            }
        }
    }
    reject(commandId, code) {
        return { commandId, ownerEpoch: this.ownerEpoch, status: "rejected", outcomeUnknown: false, code, reason: code };
    }
    pump() {
        if (this.pumping)
            return;
        this.pumping = true;
        try {
            while (!this.closed && this.running < this.limits.maxConcurrent && this.queue.length) {
                const record = this.queue.shift();
                const handler = this.handlers.get(record.command.kind);
                if (this.now() >= record.deadline) {
                    this.finish(record, this.reject(record.command.commandId, "EXPIRED_BEFORE_APPLY"));
                    continue;
                }
                if (!handler) {
                    this.finish(record, this.reject(record.command.commandId, "UNKNOWN_KIND"));
                    continue;
                }
                record.running = true;
                this.running++;
                const context = { commandId: record.command.commandId, ownerEpoch: this.ownerEpoch,
                    remainingMs: () => Math.max(0, record.deadline - this.now()) };
                if (record.command.expectedIdentity !== undefined)
                    context.expectedIdentity = (0, command_protocol_1.cloneCommandJson)(record.command.expectedIdentity);
                void Promise.resolve().then(() => this.handlerContext(record.command.commandId, () => handler((0, command_protocol_1.cloneCommandJson)(record.command.payload), context))).then(value => {
                    let result;
                    try {
                        const copied = (0, command_protocol_1.cloneCommandJson)(value);
                        result = { commandId: record.command.commandId, ownerEpoch: this.ownerEpoch,
                            status: "completed", outcomeUnknown: false, value: copied };
                        if ((0, command_protocol_1.commandJsonBytes)(result) > this.limits.maxResultBytes)
                            throw new Error("Result too large");
                    }
                    catch (_a) {
                        result = { commandId: record.command.commandId, ownerEpoch: this.ownerEpoch,
                            status: "failed", outcomeUnknown: true, code: "RESULT_NOT_SERIALIZABLE_OR_TOO_LARGE", reason: "Handler ran; result unavailable" };
                    }
                    this.finish(record, result);
                }, () => this.finish(record, { commandId: record.command.commandId, ownerEpoch: this.ownerEpoch,
                    status: "failed", outcomeUnknown: true, code: "HANDLER_FAILED", reason: "Handler failed after starting; reconcile before retry" }));
            }
        }
        finally {
            this.pumping = false;
        }
    }
    finish(record, result) {
        record.result = result;
        this.pending--;
        this.pendingBytes -= record.bytes;
        if (record.running) {
            record.running = false;
            this.running--;
        }
        const finalBytes = record.bytes + (0, command_protocol_1.commandJsonBytes)(result);
        this.retainedBytes += finalBytes - record.retainedBytes;
        record.retainedBytes = finalBytes;
        record.resolve(result);
        queueMicrotask(() => this.pump());
    }
}
exports.RoomCommandExecutor = RoomCommandExecutor;
