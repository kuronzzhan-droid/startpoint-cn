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
exports.stopSocketAdmission = exports.checkSocketAdmission = exports.authorizeSocketAdmission = exports.getSocketRivenCredentials = void 0;
const node_perf_hooks_1 = require("node:perf_hooks");
const runtime_role_1 = require("./runtime-role");
const business_rpc_1 = require("./business-rpc");
const disconnect_diagnostics_1 = require("../tcp/disconnect-diagnostics");
const leases = new Map();
const credentials = new WeakMap();
const noRiven = () => ({ p1: false, p2: false, catalog: "none" });
function getSocketRivenCredentials(socket) {
    const entry = credentials.get(socket);
    return entry ? { token: entry.token, session: entry.session, weaponRiven: Object.assign({}, entry.weaponRiven) } : undefined;
}
exports.getSocketRivenCredentials = getSocketRivenCredentials;
let sequence = 0, polling = false;
let timer;
let lastRefreshFailureLogAt = -Infinity;
const refreshFailureReasons = new Set([
    "TCP_BUSINESS_WORK_ENDED", "REALTIME_BUSINESS_CHANNEL_UNAVAILABLE",
    "BUSINESS_CHANNEL_CLOSED", "BUSINESS_PENDING_BUDGET", "BUSINESS_OUTCOME_UNKNOWN",
    "BUSINESS_OWNER_EPOCH_MISMATCH", "BUSINESS_HANDLER_FAILED", "BUSINESS_RESULT_LIMIT",
    "BUSINESS_SEND_FAILED", "SERVER_CLOSING",
]);
function reportRefreshFailure(error) {
    var _a;
    const now = node_perf_hooks_1.performance.now();
    if (now - lastRefreshFailureLogAt < 30000)
        return;
    lastRefreshFailureLogAt = now;
    const failure = error;
    const candidate = (_a = failure === null || failure === void 0 ? void 0 : failure.code) !== null && _a !== void 0 ? _a : failure === null || failure === void 0 ? void 0 : failure.message;
    // Never include a payload, token, session, arbitrary message or stack.
    const reason = typeof candidate === "string" && refreshFailureReasons.has(candidate)
        ? candidate : "ADMISSION_REFRESH_FAILED";
    console.warn(`[MULTI-ADMISSION] socket lease refresh failed: reason=${reason}`);
}
function apply(lease, result) {
    var _a;
    if (!result.ok || !Number.isFinite(result.remainingMs) || result.remainingMs <= 0) {
        if (lease.deadline)
            clearTimeout(lease.deadline);
        (0, disconnect_diagnostics_1.markTcpDisconnectReason)(lease.socket, "admission");
        credentials.delete(lease.socket);
        leases.delete(lease.socket);
        lease.socket.destroy();
        return false;
    }
    lease.expires = node_perf_hooks_1.performance.now() + Math.min(60000, result.remainingMs);
    credentials.set(lease.socket, { token: lease.token, session: lease.session, weaponRiven: (_a = result.weaponRiven) !== null && _a !== void 0 ? _a : noRiven() });
    if (lease.deadline)
        clearTimeout(lease.deadline);
    lease.deadline = setTimeout(() => {
        if (leases.get(lease.socket) !== lease)
            return;
        (0, disconnect_diagnostics_1.markTcpDisconnectReason)(lease.socket, "admission");
        leases.delete(lease.socket);
        lease.socket.destroy();
    }, Math.max(1, lease.expires - node_perf_hooks_1.performance.now()));
    lease.deadline.unref();
    return true;
}
function poll() {
    return __awaiter(this, void 0, void 0, function* () {
        if (polling)
            return;
        polling = true;
        try {
            const current = [...leases.values()];
            for (let at = 0; at < current.length; at += 64) {
                const batch = current.slice(at, at + 64).filter(value => leases.get(value.socket) === value);
                if (!batch.length)
                    continue;
                const items = batch.map(value => ({ id: value.id, token: value.token, session: value.session, active: value.activity }));
                for (const value of batch)
                    value.activity = false;
                try {
                    const requestedAt = node_perf_hooks_1.performance.now();
                    const response = yield (0, business_rpc_1.invokeRealtimeBusiness)("admission.refresh", { items });
                    for (const value of batch) {
                        if (leases.get(value.socket) !== value)
                            continue;
                        const result = response.find(item => item.id === value.id);
                        if (result)
                            apply(value, Object.assign(Object.assign({}, result), { remainingMs: result.remainingMs - (node_perf_hooks_1.performance.now() - requestedAt) }));
                    }
                }
                catch (error) {
                    reportRefreshFailure(error);
                    // Preserve the original finite capability while the business process is busy.
                    for (const value of batch)
                        value.activity = true;
                }
            }
        }
        finally {
            for (const value of leases.values())
                if (node_perf_hooks_1.performance.now() >= value.expires) {
                    (0, disconnect_diagnostics_1.markTcpDisconnectReason)(value.socket, "admission");
                    leases.delete(value.socket);
                    value.socket.destroy();
                }
            polling = false;
        }
    });
}
function authorizeSocketAdmission(socket, token, session) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        if (!(0, runtime_role_1.isRealtimeOwnerChild)()) {
            const { clientAdmission } = require("../../lib/client-admission");
            const result = clientAdmission().socketLease(token, session, true);
            if (result.ok)
                credentials.set(socket, { token: token !== null && token !== void 0 ? token : null, session: session !== null && session !== void 0 ? session : null, weaponRiven: (_a = result.weaponRiven) !== null && _a !== void 0 ? _a : noRiven() });
            return result.ok;
        }
        if (leases.size >= 10000)
            return false;
        const requestedAt = node_perf_hooks_1.performance.now();
        const result = yield (0, business_rpc_1.invokeRealtimeBusiness)("admission.lease", { token: token !== null && token !== void 0 ? token : null, session: session !== null && session !== void 0 ? session : null });
        if (socket.destroyed)
            return false;
        const lease = { socket, id: ++sequence, token: token !== null && token !== void 0 ? token : null, session: session !== null && session !== void 0 ? session : null, expires: 0, activity: false };
        if (!result.ok)
            return false;
        leases.set(socket, lease);
        socket.once("close", () => { if (lease.deadline)
            clearTimeout(lease.deadline); credentials.delete(socket); leases.delete(socket); });
        if (!timer) {
            timer = (0, business_rpc_1.createSocketAdmissionMaintenanceTimer)(() => setInterval(() => { void poll(); }, 5000));
            timer.unref();
        }
        return apply(lease, Object.assign(Object.assign({}, result), { remainingMs: result.remainingMs - (node_perf_hooks_1.performance.now() - requestedAt) }));
    });
}
exports.authorizeSocketAdmission = authorizeSocketAdmission;
function checkSocketAdmission(socket, token, session) {
    if (!(0, runtime_role_1.isRealtimeOwnerChild)()) {
        const { clientAdmission } = require("../../lib/client-admission");
        return clientAdmission().checkActivity(token, session).ok;
    }
    const lease = leases.get(socket);
    if (!lease || node_perf_hooks_1.performance.now() >= lease.expires)
        return false;
    lease.activity = true;
    return true;
}
exports.checkSocketAdmission = checkSocketAdmission;
function stopSocketAdmission() {
    if (timer)
        clearInterval(timer);
    for (const value of leases.values())
        if (value.deadline)
            clearTimeout(value.deadline);
    timer = undefined;
    leases.clear();
}
exports.stopSocketAdmission = stopSocketAdmission;
