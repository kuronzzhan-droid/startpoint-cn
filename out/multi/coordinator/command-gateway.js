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
exports.RoomCommandGateway = void 0;
const perf_hooks_1 = require("perf_hooks");
const command_protocol_1 = require("./command-protocol");
/** Transport-neutral: production chooses one owner adapter; it never falls back on an uncertain write. */
class RoomCommandGateway {
    constructor(transport, options = {}) {
        var _a, _b, _c, _d, _e, _f;
        this.transport = transport;
        this.pending = new Set();
        this.pendingBytes = 0;
        this.closed = false;
        this.drainWaiters = new Set();
        this.now = (_a = options.now) !== null && _a !== void 0 ? _a : (() => perf_hooks_1.performance.now());
        this.boundOwnerEpoch = transport.ownerEpoch;
        this.limits = { timeoutMs: (_b = options.timeoutMs) !== null && _b !== void 0 ? _b : 5000, maxMessages: (_c = options.maxMessages) !== null && _c !== void 0 ? _c : 256,
            maxBytes: (_d = options.maxBytes) !== null && _d !== void 0 ? _d : 4 * 1024 * 1024, maxMessageBytes: (_e = options.maxMessageBytes) !== null && _e !== void 0 ? _e : 256 * 1024,
            maxAgeMs: (_f = options.maxAgeMs) !== null && _f !== void 0 ? _f : 10000 };
        for (const [key, value] of Object.entries(this.limits))
            if (!Number.isFinite(value) || value < 1)
                throw new Error(`Invalid gateway limit: ${key}`);
    }
    execute(kind_1, payload_1) {
        return __awaiter(this, arguments, void 0, function* (kind, payload, options = {}) {
            var _a, _b, _c, _d;
            const commandId = (_a = options.commandId) !== null && _a !== void 0 ? _a : (0, command_protocol_1.createRoomCommandId)();
            const timeoutMs = (_b = options.timeoutMs) !== null && _b !== void 0 ? _b : this.limits.timeoutMs;
            if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > this.limits.maxAgeMs)
                throw new command_protocol_1.RoomCommandError("INVALID_TIMEOUT", "Invalid command timeout", commandId, false);
            let command;
            try {
                command = { protocol: 1, commandId, kind, payload: (0, command_protocol_1.cloneCommandJson)(payload), timeoutMs };
                if (options.expectedIdentity !== undefined)
                    command.expectedIdentity = (0, command_protocol_1.cloneCommandJson)(options.expectedIdentity);
                if (this.boundOwnerEpoch !== undefined)
                    command.expectedOwnerEpoch = this.boundOwnerEpoch;
                command = (0, command_protocol_1.cloneCommandJson)(command);
            }
            catch (_e) {
                throw new command_protocol_1.RoomCommandError("INVALID_JSON", "Command must be serializable JSON", commandId, false);
            }
            const result = yield this.request(commandId, (0, command_protocol_1.commandJsonBytes)(command), timeoutMs, () => this.transport.submit(command));
            if (result.status === "completed")
                return (0, command_protocol_1.cloneCommandJson)(result.value);
            throw new command_protocol_1.RoomCommandError((_c = result.code) !== null && _c !== void 0 ? _c : "OUTCOME_UNKNOWN", (_d = result.reason) !== null && _d !== void 0 ? _d : result.status, commandId, result.outcomeUnknown);
        });
    }
    queryResult(commandId) {
        return __awaiter(this, void 0, void 0, function* () {
            if (typeof commandId !== "string" || commandId.length > 128)
                throw new command_protocol_1.RoomCommandError("INVALID_COMMAND_ID", "Invalid query ID", "", false);
            return this.request(commandId, Buffer.byteLength(commandId, "utf8") + 64, Math.min(this.limits.timeoutMs, this.limits.maxAgeMs), () => this.transport.queryResult(commandId));
        });
    }
    inspect() {
        var _a;
        let oldestPendingAgeMs = 0;
        for (const request of this.pending)
            oldestPendingAgeMs = Math.max(oldestPendingAgeMs, this.now() - request.at);
        return { closed: this.closed, ownerEpoch: (_a = this.boundOwnerEpoch) !== null && _a !== void 0 ? _a : null,
            pending: this.pending.size, pendingBytes: this.pendingBytes, oldestPendingAgeMs, limits: Object.assign({}, this.limits) };
    }
    close() {
        this.closed = true;
        for (const request of this.pending)
            request.rejectWaiter(new command_protocol_1.RoomCommandError("OUTCOME_UNKNOWN", "Gateway closed while request may be executing", "", true));
        // Do not release transport budgets until the actual application response settles.
    }
    drain() {
        return __awaiter(this, void 0, void 0, function* () {
            while (this.pending.size)
                yield new Promise(resolve => this.drainWaiters.add(resolve));
        });
    }
    request(commandId, bytes, timeoutMs, operation) {
        if (this.closed)
            return Promise.reject(new command_protocol_1.RoomCommandError("GATEWAY_CLOSED", "Gateway closed", commandId, false));
        if (bytes > this.limits.maxMessageBytes)
            return Promise.reject(new command_protocol_1.RoomCommandError("MESSAGE_BYTE_LIMIT", "Command too large", commandId, false));
        if (this.pending.size >= this.limits.maxMessages || this.pendingBytes + bytes > this.limits.maxBytes)
            return Promise.reject(new command_protocol_1.RoomCommandError("PENDING_BUDGET", "Gateway pending budget exhausted", commandId, false));
        const at = this.now();
        for (const request of this.pending)
            if (at - request.at >= this.limits.maxAgeMs)
                return Promise.reject(new command_protocol_1.RoomCommandError("PENDING_AGE_LIMIT", "Unresolved application ACK exceeds age budget", commandId, false));
        return new Promise((resolve, reject) => {
            let settled = false;
            const fail = (error) => { if (!settled) {
                settled = true;
                clearTimeout(timer);
                reject(error);
            } };
            const pending = { at, bytes, rejectWaiter: error => fail(new command_protocol_1.RoomCommandError(error.code, error.message, commandId, error.outcomeUnknown)) };
            const deadline = at + timeoutMs;
            const timer = setTimeout(() => fail(new command_protocol_1.RoomCommandError("OUTCOME_UNKNOWN", "Application ACK deadline elapsed; query the original commandId", commandId, true)), timeoutMs);
            this.pending.add(pending);
            this.pendingBytes += bytes;
            void Promise.resolve().then(operation).then(raw => {
                try {
                    const result = (0, command_protocol_1.cloneCommandJson)(raw);
                    if (result.commandId !== commandId || typeof result.ownerEpoch !== "string" || !result.ownerEpoch
                        || !["pending", "completed", "rejected", "failed", "unknown"].includes(result.status)
                        || typeof result.outcomeUnknown !== "boolean")
                        throw new Error("Invalid application result");
                    if ((0, command_protocol_1.commandJsonBytes)(result) > this.limits.maxMessageBytes
                        || result.outcomeUnknown !== !["completed", "rejected"].includes(result.status)
                        || (result.status === "completed" && !Object.prototype.hasOwnProperty.call(result, "value")))
                        throw new Error("Invalid application result shape/size");
                    if (this.boundOwnerEpoch !== undefined && result.ownerEpoch !== this.boundOwnerEpoch)
                        throw new Error("Owner epoch changed");
                    this.boundOwnerEpoch = result.ownerEpoch;
                    if (this.now() >= deadline)
                        fail(new command_protocol_1.RoomCommandError("OUTCOME_UNKNOWN", "Application ACK arrived after local deadline", commandId, true));
                    if (!settled) {
                        settled = true;
                        clearTimeout(timer);
                        resolve(result);
                    }
                }
                catch (_a) {
                    fail(new command_protocol_1.RoomCommandError("OUTCOME_UNKNOWN", "Invalid application ACK; reconcile with original owner", commandId, true));
                }
            }, () => fail(new command_protocol_1.RoomCommandError("OUTCOME_UNKNOWN", "Transport failed; application outcome unknown", commandId, true))).finally(() => {
                this.pending.delete(pending);
                this.pendingBytes -= bytes;
                for (const wake of this.drainWaiters)
                    wake();
                this.drainWaiters.clear();
            });
        });
    }
}
exports.RoomCommandGateway = RoomCommandGateway;
