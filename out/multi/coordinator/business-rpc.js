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
exports.attachChildBusinessRpc = exports.handleParentBusiness = exports.invokeRealtimeBusiness = exports.installRealtimeBusinessTransport = exports.drainChildRealtimeBusiness = exports.getRealtimeBusinessAdmission = exports.runWithRealtimeBusinessAdmission = exports.createSocketAdmissionMaintenanceTimer = exports.createRealtimeMaintenanceTimer = exports.runWithTcpBusinessAdmission = exports.captureRealtimeBusinessContext = exports.retainRealtimeBusinessTail = void 0;
const command_protocol_1 = require("./command-protocol");
const runtime_role_1 = require("./runtime-role");
const node_async_hooks_1 = require("node:async_hooks");
const shutdown_state_1 = require("../../lib/shutdown-state");
const node_crypto_1 = require("node:crypto");
const promises_1 = require("node:timers/promises");
const tcpBusinessContext = new node_async_hooks_1.AsyncLocalStorage();
const tcpBusinessWorks = new Set();
function actualResult(promise) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            return yield promise;
        }
        catch (error) {
            const uncertain = error;
            if ((uncertain === null || uncertain === void 0 ? void 0 : uncertain.code) === "BUSINESS_OUTCOME_UNKNOWN" && uncertain.confirmation)
                return yield uncertain.confirmation;
            throw error;
        }
    });
}
/** Retain detached writes/pinned callbacks until their actual completion, not caller timeout. */
function retainRealtimeBusinessTail(tail) {
    const work = tcpBusinessContext.getStore();
    if (!work)
        return tail;
    if (!work.active)
        throw new Error("TCP_BUSINESS_WORK_ENDED");
    const tracked = actualResult(tail);
    work.tails.add(tracked);
    void tracked.then(() => work.tails.delete(tracked), () => work.tails.delete(tracked));
    return tail;
}
exports.retainRealtimeBusinessTail = retainRealtimeBusinessTail;
/** Manual pin replay is not an async continuation; explicitly retain and restore both contexts. */
function captureRealtimeBusinessContext() {
    const proof = getRealtimeBusinessAdmission(), work = tcpBusinessContext.getStore();
    return (operation) => businessAdmission.run(proof, () => tcpBusinessContext.run(work, operation));
}
exports.captureRealtimeBusinessContext = captureRealtimeBusinessContext;
/** FIFO begin is sent immediately; local barriers/ACKs never wait for the parent-issued grant. */
function runWithTcpBusinessAdmission(operation) {
    if (tcpBusinessWorks.size >= 128)
        return Promise.reject(new Error("TCP_BUSINESS_WORK_BUDGET"));
    const workId = `tcp.${(0, node_crypto_1.randomUUID)()}`;
    const child = (0, runtime_role_1.isRealtimeOwnerChild)();
    if (child && !transport)
        return Promise.reject(new Error("REALTIME_BUSINESS_CHANNEL_UNAVAILABLE"));
    const grant = child ? actualResult(transport("__tcp_work_begin__", { workId })).then(proof => {
        const p = proof;
        if (!p || p.commandId !== workId || typeof p.ownerEpoch !== "string"
            || typeof p.admissionToken !== "string" || !/^[a-f0-9]{64}$/.test(p.admissionToken))
            throw new Error("TCP_BUSINESS_GRANT_INVALID");
        return (0, command_protocol_1.cloneCommandJson)(proof);
    }) : Promise.resolve(undefined);
    void grant.catch(() => { });
    const context = { active: true, grant, tails: new Set() };
    const execute = () => __awaiter(this, void 0, void 0, function* () {
        try {
            return yield tcpBusinessContext.run(context, operation);
        }
        finally {
            // ChangeParty's deferred immediate and any registered pin/proof tails
            // belong to this accepted frame, even after the handler returns.
            yield (0, promises_1.setImmediate)();
            while (context.tails.size)
                yield Promise.allSettled([...context.tails]);
            context.active = false;
            const proof = yield grant;
            if (child)
                yield actualResult(transport("__tcp_work_end__", { workId, proof }));
        }
    });
    const work = child ? execute() : (0, shutdown_state_1.withServerWorkAdmission)(execute);
    tcpBusinessWorks.add(work);
    void work.then(() => tcpBusinessWorks.delete(work), () => tcpBusinessWorks.delete(work));
    return work;
}
exports.runWithTcpBusinessAdmission = runWithTcpBusinessAdmission;
const businessAdmission = new node_async_hooks_1.AsyncLocalStorage();
/** Independent realtime upkeep starts new business work when its timer fires.
 * Clear only the timer's inherited TCP frame and command proof; ordinary
 * continuations retain ended-work rejection and normal transport budgets.
 */
function createRealtimeMaintenanceTimer(create) {
    return tcpBusinessContext.run(undefined, () => businessAdmission.run(undefined, create));
}
exports.createRealtimeMaintenanceTimer = createRealtimeMaintenanceTimer;
/** Socket lease upkeep is one independent realtime maintenance task. */
function createSocketAdmissionMaintenanceTimer(create) {
    return createRealtimeMaintenanceTimer(create);
}
exports.createSocketAdmissionMaintenanceTimer = createSocketAdmissionMaintenanceTimer;
function runWithRealtimeBusinessAdmission(proof, operation) {
    return businessAdmission.run(proof === undefined ? undefined : (0, command_protocol_1.cloneCommandJson)(proof), operation);
}
exports.runWithRealtimeBusinessAdmission = runWithRealtimeBusinessAdmission;
function getRealtimeBusinessAdmission() {
    const proof = businessAdmission.getStore();
    return proof === undefined ? undefined : (0, command_protocol_1.cloneCommandJson)(proof);
}
exports.getRealtimeBusinessAdmission = getRealtimeBusinessAdmission;
let childBusinessDrain = () => __awaiter(void 0, void 0, void 0, function* () { });
function drainChildRealtimeBusiness() {
    return __awaiter(this, void 0, void 0, function* () {
        while (tcpBusinessWorks.size)
            yield Promise.allSettled([...tcpBusinessWorks]);
        yield childBusinessDrain();
    });
}
exports.drainChildRealtimeBusiness = drainChildRealtimeBusiness;
let transport;
function installRealtimeBusinessTransport(value) {
    if (transport)
        throw new Error("Business transport already installed");
    transport = value;
}
exports.installRealtimeBusinessTransport = installRealtimeBusinessTransport;
function invokeRealtimeBusiness(kind, payload) {
    return __awaiter(this, void 0, void 0, function* () {
        const input = (0, command_protocol_1.cloneCommandJson)(payload);
        if (transport) {
            const work = tcpBusinessContext.getStore();
            if (work && !work.active)
                throw new Error("TCP_BUSINESS_WORK_ENDED");
            const call = work ? work.grant.then(proof => businessAdmission.run(proof, () => transport(kind, input)))
                : transport(kind, input);
            retainRealtimeBusinessTail(call);
            return (0, command_protocol_1.cloneCommandJson)(yield call);
        }
        if ((0, runtime_role_1.isRealtimeOwnerChild)())
            throw new Error("REALTIME_BUSINESS_CHANNEL_UNAVAILABLE");
        return yield (0, shutdown_state_1.withServerWorkAdmission)(() => handleParentBusiness(kind, input));
    });
}
exports.invokeRealtimeBusiness = invokeRealtimeBusiness;
/** Only the parent imports player/database modules. Child never falls back here. */
function handleParentBusiness(kind, payload) {
    return __awaiter(this, void 0, void 0, function* () {
        if ((0, runtime_role_1.isRealtimeOwnerChild)())
            throw new Error("REALTIME_CHILD_CANNOT_EXECUTE_BUSINESS");
        if (kind === "admission.lease") {
            const p = payload;
            const { clientAdmission } = require("../../lib/client-admission");
            return clientAdmission().socketLease(p.token, p.session, true);
        }
        if (kind === "admission.refresh") {
            const p = payload;
            if (!Array.isArray(p.items) || p.items.length > 64)
                throw new Error("INVALID_ADMISSION_BATCH");
            const { clientAdmission } = require("../../lib/client-admission");
            return p.items.map(item => (Object.assign({ id: item.id }, clientAdmission().socketLease(item.token, item.session, item.active === true))));
        }
        const { handleRealtimeBusiness } = require("./business-handlers");
        const result = yield handleRealtimeBusiness(kind, payload);
        // Business rows may have optional undefined columns. DTOs on the wire are JSON values.
        return (0, command_protocol_1.cloneCommandJson)(JSON.parse(JSON.stringify(result !== null && result !== void 0 ? result : null)));
    });
}
exports.handleParentBusiness = handleParentBusiness;
/** Bounded reverse RPC. ACK means the registered business handler completed. */
function attachChildBusinessRpc() {
    const pending = new Map();
    let sequence = 0, bytes = 0, closed = false;
    const drainWaiters = new Set();
    const notifySettled = () => { for (const wake of drainWaiters)
        wake(); drainWaiters.clear(); };
    childBusinessDrain = () => __awaiter(this, void 0, void 0, function* () {
        while (pending.size)
            yield new Promise(resolve => { drainWaiters.add(resolve); });
    });
    const fail = () => {
        var _a;
        closed = true;
        for (const item of pending.values()) {
            clearTimeout(item.timer);
            const error = new Error("BUSINESS_CHANNEL_CLOSED");
            (_a = item.reject) === null || _a === void 0 ? void 0 : _a.call(item, error);
            item.deny(error);
        }
        pending.clear();
        bytes = 0;
        notifySettled();
    };
    process.on("disconnect", fail);
    process.on("message", (message) => {
        var _a, _b;
        if ((message === null || message === void 0 ? void 0 : message.t) !== "business-result" && (message === null || message === void 0 ? void 0 : message.t) !== "tcp-work-result")
            return;
        const item = pending.get(message.requestId);
        if (!item)
            return;
        try {
            if ((0, command_protocol_1.commandJsonBytes)(message) > 512 * 1024)
                throw new Error("BUSINESS_RESULT_LIMIT");
        }
        catch (_c) {
            fail();
            if (process.connected)
                process.disconnect();
            return;
        }
        pending.delete(message.requestId);
        bytes -= item.bytes;
        clearTimeout(item.timer);
        notifySettled();
        if (message.ok === true) {
            const value = (0, command_protocol_1.cloneCommandJson)(message.value);
            (_a = item.resolve) === null || _a === void 0 ? void 0 : _a.call(item, value);
            item.confirm(value);
        }
        else {
            const error = Object.assign(new Error(String(message.code || "BUSINESS_REJECTED")), { code: message.code });
            (_b = item.reject) === null || _b === void 0 ? void 0 : _b.call(item, error);
            item.deny(error);
        }
    });
    installRealtimeBusinessTransport((kind, payload) => {
        if (closed || !process.connected)
            return Promise.reject(new Error("BUSINESS_CHANNEL_CLOSED"));
        const requestId = ++sequence, proof = getRealtimeBusinessAdmission();
        const control = payload;
        const message = kind === "__tcp_work_begin__" ? { t: "tcp-work-begin", requestId, workId: control.workId }
            : kind === "__tcp_work_end__" ? { t: "tcp-work-end", requestId, workId: control.workId, businessAdmission: control.proof }
                : Object.assign({ t: "business-request", requestId, kind, payload }, (proof === undefined ? {} : { businessAdmission: proof }));
        const size = (0, command_protocol_1.commandJsonBytes)(message);
        if (kind === "__tcp_work_end__" && (pending.size >= 64 || bytes + size > 4 * 1024 * 1024)) {
            // End is a retained obligation, not a new optional business call.
            // Keep the grant held until an actual ACK frees capacity or the
            // channel disconnects; caller timeouts never free this budget.
            return new Promise(resolve => { drainWaiters.add(resolve); }).then(() => transport(kind, payload));
        }
        if (size > 256 * 1024 || pending.size >= 64 || bytes + size > 4 * 1024 * 1024) {
            return Promise.reject(Object.assign(new Error("BUSINESS_PENDING_BUDGET"), { code: "BUSINESS_PENDING_BUDGET" }));
        }
        return new Promise((resolve, reject) => {
            let confirm, deny;
            const confirmation = new Promise((yes, no) => { confirm = yes; deny = no; });
            void confirmation.catch(() => { });
            const timer = setTimeout(() => {
                var _a;
                const item = pending.get(requestId);
                (_a = item === null || item === void 0 ? void 0 : item.reject) === null || _a === void 0 ? void 0 : _a.call(item, Object.assign(new Error("BUSINESS_OUTCOME_UNKNOWN"), { code: "BUSINESS_OUTCOME_UNKNOWN", confirmation }));
                // An uncertain transaction remains charged until its actual result or disconnect.
                if (item) {
                    item.resolve = undefined;
                    item.reject = undefined;
                }
            }, 10000);
            pending.set(requestId, { bytes: size, timer, resolve, reject, confirm, deny });
            bytes += size;
            try {
                process.send(message, (error) => { if (error) {
                    fail();
                    process.disconnect();
                } });
            }
            catch (_a) {
                fail();
                if (process.connected)
                    process.disconnect();
            }
        });
    });
    return fail;
}
exports.attachChildBusinessRpc = attachChildBusinessRpc;
