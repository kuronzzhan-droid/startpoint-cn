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
exports.resumeDurableOwnerEvents = exports.drainDurableOwnerEvents = exports.quiesceDurableOwnerEvents = exports.inspectDurableOwnerEvents = exports.publishDurableOwnerDecision = exports.DurableOwnerEventPublisher = void 0;
const node_perf_hooks_1 = require("node:perf_hooks");
const command_protocol_1 = require("./command-protocol");
const default_runtime_1 = require("./default-runtime");
const parent_business_admission_1 = require("./parent-business-admission");
const shutdown_state_1 = require("../../lib/shutdown-state");
/** Reconcile already-durable notifications, never replay a payment or change the original command ID. */
class DurableOwnerEventPublisher {
    constructor(gateway = default_runtime_1.getRoomCommandGateway, failOwner = default_runtime_1.failRealtimeOwner, retryMs = 250, maxAgeMs = 60000) {
        this.gateway = gateway;
        this.failOwner = failOwner;
        this.retryMs = retryMs;
        this.maxAgeMs = maxAgeMs;
        this.events = new Map();
        this.bytes = 0;
        this.quiescing = false;
        this.waiters = new Set();
    }
    inspect() { return { pending: this.events.size, pendingBytes: this.bytes }; }
    finish(event) {
        if (!this.events.delete(event.id))
            return;
        this.bytes -= event.bytes;
        if (event.timer)
            clearTimeout(event.timer);
        event.admission.release();
        for (const wake of this.waiters)
            wake();
        this.waiters.clear();
    }
    failure(event, reason) {
        return __awaiter(this, void 0, void 0, function* () {
            this.finish(event);
            console.error(`[MULTI-REALTIME] durable event unresolved kind=${event.kind}; sealing owner`, reason);
            yield this.failOwner();
        });
    }
    accepted(event, value) {
        if (value && typeof value === "object" && value.applied === false
            && (event.kind === "battle.play.commit" || event.kind === "fiveBoss.start.commit")) {
            throw new Error("DURABLE_START_DECLINED");
        }
        this.finish(event);
        return value;
    }
    publish(kind, input) {
        return __awaiter(this, void 0, void 0, function* () {
            (0, shutdown_state_1.assertServerAcceptingWork)();
            if (this.quiescing && !(0, shutdown_state_1.hasServerWorkAdmission)())
                throw Object.assign(new Error("SERVER_CLOSING"), { code: "SERVER_CLOSING" });
            const payload = (0, command_protocol_1.cloneCommandJson)(input), bytes = (0, command_protocol_1.commandJsonBytes)(payload);
            if (this.events.size >= 128 || this.bytes + bytes > 4 * 1024 * 1024 || bytes > 256 * 1024) {
                yield this.failOwner();
                console.error("[MULTI-REALTIME] durable event budget exhausted; owner sealed");
                return undefined;
            }
            const id = (0, command_protocol_1.createRoomCommandId)();
            const event = { id, kind, payload, bytes, at: node_perf_hooks_1.performance.now(), attempts: 0,
                admission: (0, parent_business_admission_1.createAcceptedRealtimeBusinessScope)({ ownerEpoch: "durable-decision", commandId: id }) };
            this.events.set(event.id, event);
            this.bytes += bytes;
            try {
                return this.accepted(event, yield event.admission.run(() => this.gateway().execute(kind, payload, { commandId: event.id })));
            }
            catch (error) {
                if (error instanceof Error && error.message === "DURABLE_START_DECLINED") {
                    yield this.failure(event, error);
                    return undefined;
                }
                console.warn(`[MULTI-REALTIME] durable event awaiting application confirmation kind=${kind}`);
                this.schedule(event);
                return undefined;
            }
        });
    }
    schedule(event) {
        event.timer = setTimeout(() => { void event.admission.run(() => this.reconcile(event)); }, Math.min(5000, this.retryMs * 2 ** Math.min(event.attempts, 4)));
        event.timer.unref();
    }
    reconcile(event) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.events.has(event.id))
                return;
            if (node_perf_hooks_1.performance.now() - event.at >= this.maxAgeMs || event.attempts++ >= 8) {
                yield this.failure(event, new Error("DURABLE_EVENT_CONFIRMATION_DEADLINE"));
                return;
            }
            try {
                const result = yield this.gateway().queryResult(event.id);
                if (result.status === "completed") {
                    this.accepted(event, result.value);
                    return;
                }
                if (result.status !== "pending") {
                    // The executor deduplicates this exact ID even after a lost ACK.
                    this.accepted(event, yield this.gateway().execute(event.kind, event.payload, { commandId: event.id }));
                    return;
                }
            }
            catch (error) {
                if (error instanceof Error && error.message === "DURABLE_START_DECLINED") {
                    yield this.failure(event, error);
                    return;
                }
            }
            this.schedule(event);
        });
    }
    quiesce() { this.quiescing = true; }
    resume() {
        if (this.events.size)
            throw new Error("DURABLE_EVENTS_STILL_PENDING");
        this.quiescing = false;
    }
    drain() {
        return __awaiter(this, void 0, void 0, function* () {
            while (this.events.size)
                yield new Promise(resolve => this.waiters.add(resolve));
        });
    }
}
exports.DurableOwnerEventPublisher = DurableOwnerEventPublisher;
const publisher = new DurableOwnerEventPublisher();
function publishDurableOwnerDecision(kind, payload) {
    return publisher.publish(kind, payload);
}
exports.publishDurableOwnerDecision = publishDurableOwnerDecision;
function inspectDurableOwnerEvents() { return publisher.inspect(); }
exports.inspectDurableOwnerEvents = inspectDurableOwnerEvents;
function quiesceDurableOwnerEvents() { publisher.quiesce(); }
exports.quiesceDurableOwnerEvents = quiesceDurableOwnerEvents;
function drainDurableOwnerEvents() { return publisher.drain(); }
exports.drainDurableOwnerEvents = drainDurableOwnerEvents;
function resumeDurableOwnerEvents() { publisher.resume(); }
exports.resumeDurableOwnerEvents = resumeDurableOwnerEvents;
