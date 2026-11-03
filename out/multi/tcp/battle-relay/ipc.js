"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BoundedRelayIpc = exports.relayIpcLimits = void 0;
// Transport completion only releases the Node send slot. An explicit peer
// acknowledgement releases the application budget after the message is applied.
const latency_statistics_1 = require("../../latency-statistics");
function positive(name, fallback) {
    var _a;
    const n = Number.parseInt((_a = process.env[name]) !== null && _a !== void 0 ? _a : "", 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
}
function relayIpcLimits() {
    return { maxMessages: positive("MULTI_BATTLE_RELAY_IPC_MAX_MESSAGES", 512),
        maxBytes: positive("MULTI_BATTLE_RELAY_IPC_MAX_BYTES", 8 * 1024 * 1024),
        maxAgeMs: positive("MULTI_BATTLE_RELAY_IPC_MAX_AGE_MS", 15000) };
}
exports.relayIpcLimits = relayIpcLimits;
class BoundedRelayIpc {
    constructor(sender, failed, limits = relayIpcLimits(), now = () => performance.now()) {
        this.sender = sender;
        this.failed = failed;
        this.limits = limits;
        this.now = now;
        this.sequence = 0;
        this.received = 0;
        this.pending = new Map();
        this.bytes = 0;
        this.ackCount = 0;
        this.ackBytes = 0;
        this.acknowledgements = new Map();
        this.transportBusy = false;
        this.closed = false;
        this.fault = null;
        this.maxMessages = 0;
        this.maxBytes = 0;
        this.transportBackpressure = 0;
        this.applicationAckRtt = new latency_statistics_1.BoundedLatencyHistogram();
        this.sendQueueWait = new latency_statistics_1.BoundedLatencyHistogram();
        this.timer = setInterval(() => this.checkAge(), Math.max(10, Math.min(250, limits.maxAgeMs)));
        this.timer.unref();
    }
    enqueue(body, handle, transported) {
        var _a;
        if (this.closed) {
            transported === null || transported === void 0 ? void 0 : transported(new Error((_a = this.fault) !== null && _a !== void 0 ? _a : "ipc_closed"));
            return false;
        }
        let bytes;
        try {
            bytes = Buffer.byteLength(JSON.stringify(body), "utf8") + 64;
        }
        catch (_b) {
            this.fail("ipc_serialization");
            transported === null || transported === void 0 ? void 0 : transported(new Error("ipc_serialization"));
            return false;
        }
        if (this.pending.size + this.ackCount >= this.limits.maxMessages
            || this.bytes + this.ackBytes + bytes > this.limits.maxBytes) {
            this.fail("ipc_queue_limit");
            transported === null || transported === void 0 ? void 0 : transported(new Error("ipc_queue_limit"));
            return false;
        }
        const item = { seq: ++this.sequence, body, handle, transported, bytes, at: this.now(), sent: false };
        this.pending.set(item.seq, item);
        this.bytes += bytes;
        this.maxMessages = Math.max(this.maxMessages, this.pending.size + this.ackCount);
        this.maxBytes = Math.max(this.maxBytes, this.bytes + this.ackBytes);
        this.pump();
        return !this.closed;
    }
    receive(message, handle, apply) {
        if (this.closed)
            return;
        if (!message || !Number.isSafeInteger(message.seq) || message.seq <= 0) {
            this.fail("ipc_invalid_sequence");
            return;
        }
        if (message.t === "relay-ipc-ack") {
            const item = this.pending.get(message.seq);
            if (!(item === null || item === void 0 ? void 0 : item.sent)) {
                this.fail("ipc_unknown_ack");
                return;
            }
            this.applicationAckRtt.record(this.now() - item.at);
            this.pending.delete(message.seq);
            this.bytes -= item.bytes;
            return;
        }
        if (message.t !== "relay-ipc" || message.seq !== this.received + 1) {
            this.fail("ipc_receive_order");
            return;
        }
        this.received = message.seq;
        try {
            const result = apply(message.body, handle);
            if (result && typeof result.then === "function") {
                void result.then(() => this.acknowledge(message.seq), () => this.fail("ipc_apply_failed"));
            }
            else
                this.acknowledge(message.seq);
        }
        catch (_a) {
            this.fail("ipc_apply_failed");
        }
    }
    acknowledge(seq) {
        if (this.closed)
            return;
        const bytes = 64;
        if (this.pending.size + this.ackCount >= this.limits.maxMessages
            || this.bytes + this.ackBytes + bytes > this.limits.maxBytes) {
            this.fail("ipc_ack_queue_limit");
            return;
        }
        this.ackCount++;
        this.ackBytes += bytes;
        this.acknowledgements.set(seq, this.now());
        let finished = false;
        const callback = error => {
            if (finished)
                return;
            finished = true;
            this.ackCount--;
            this.ackBytes -= bytes;
            this.acknowledgements.delete(seq);
            if (error)
                this.fail("ipc_ack_send_failed");
        };
        try {
            if (!this.sender({ t: "relay-ipc-ack", seq }, undefined, callback))
                this.transportBackpressure++;
        }
        catch (_a) {
            callback(new Error("ipc_ack_send_threw"));
        }
    }
    pump() {
        if (this.closed || this.transportBusy)
            return;
        const item = [...this.pending.values()].find(value => !value.sent);
        if (!item)
            return;
        item.sent = true;
        this.sendQueueWait.record(this.now() - item.at);
        this.transportBusy = true;
        let finished = false;
        const callback = error => {
            if (finished)
                return;
            finished = true;
            this.transportBusy = false;
            const transported = item.transported;
            item.transported = undefined;
            transported === null || transported === void 0 ? void 0 : transported(error);
            if (error)
                this.fail("ipc_send_failed");
            else
                queueMicrotask(() => this.pump());
        };
        try {
            if (!this.sender({ t: "relay-ipc", seq: item.seq, body: item.body }, item.handle, callback))
                this.transportBackpressure++;
        }
        catch (_a) {
            callback(new Error("ipc_send_threw"));
        }
    }
    checkAge() {
        if (this.closed)
            return;
        for (const item of this.pending.values()) {
            if (this.now() - item.at >= this.limits.maxAgeMs) {
                this.fail("ipc_application_timeout");
                return;
            }
        }
        for (const at of this.acknowledgements.values()) {
            if (this.now() - at >= this.limits.maxAgeMs) {
                this.fail("ipc_ack_timeout");
                return;
            }
        }
    }
    stats() {
        return { applicationAckRttMs: this.applicationAckRtt.snapshot(), sendQueueWaitMs: this.sendQueueWait.snapshot(),
            applicationAckRttDefinition: "same initiating process monotonic enqueue-to-application-ACK; includes send queue, peer apply and ACK return; not TCP RTT",
            sendQueueWaitDefinition: "same process enqueue-to-Node-send-attempt; transport callback is not peer application",
            applicationAckSampling: "successful application ACKs only; timeout and closure remain explicit channel faults" };
    }
    diagnostics() {
        return Object.assign({ closed: this.closed, fault: this.fault, pendingMessages: this.pending.size, pendingBytes: this.bytes, ackPending: this.ackCount, oldestAgeMs: Math.max(0, ...[...this.pending.values()].map(x => this.now() - x.at)), maxMessages: this.maxMessages, maxBytes: this.maxBytes, transportBackpressure: this.transportBackpressure }, this.stats());
    }
    pendingBytesFor(matches) {
        let bytes = 0;
        for (const item of this.pending.values())
            if (matches(item.body))
                bytes += item.bytes;
        return bytes;
    }
    fail(reason) {
        if (this.closed)
            return;
        this.fault = reason;
        this.close(reason);
        this.failed(reason);
    }
    close(reason = "ipc_closed") {
        if (this.closed)
            return;
        this.closed = true;
        clearInterval(this.timer);
        for (const item of this.pending.values()) {
            const transported = item.transported;
            item.transported = undefined;
            transported === null || transported === void 0 ? void 0 : transported(new Error(reason));
        }
        this.pending.clear();
        this.bytes = 0;
    }
}
exports.BoundedRelayIpc = BoundedRelayIpc;
