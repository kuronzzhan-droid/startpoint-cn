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
const command_executor_1 = require("./command-executor");
const command_protocol_1 = require("./command-protocol");
const business_rpc_1 = require("./business-rpc");
/** No TCP/game server is imported here. Optional listeners belong to the explicit bootstrap. */
function main() {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const options = JSON.parse((_a = process.argv[2]) !== null && _a !== void 0 ? _a : "{}");
        const executor = new command_executor_1.RoomCommandExecutor();
        const commandAdmissions = new Map();
        executor.setHandlerContext((id, operation) => (0, business_rpc_1.runWithRealtimeBusinessAdmission)(commandAdmissions.get(id), operation));
        const quiesceCallbacks = [];
        const drainCallbacks = [];
        const shutdownCallbacks = [];
        let inflight = 0, bytes = 0, stopping = false;
        let quiesced;
        const replies = new Set();
        const quiesce = () => quiesced !== null && quiesced !== void 0 ? quiesced : (quiesced = (() => __awaiter(this, void 0, void 0, function* () {
            executor.quiesce();
            yield Promise.all(quiesceCallbacks.map(fn => Promise.resolve().then(fn)));
        }))());
        const drain = () => __awaiter(this, void 0, void 0, function* () {
            yield executor.drain();
            yield Promise.all(drainCallbacks.map(fn => Promise.resolve().then(fn)));
            yield (0, business_rpc_1.drainChildRealtimeBusiness)();
            while (replies.size)
                yield Promise.allSettled([...replies]);
        });
        const shutdown = (...args_1) => __awaiter(this, [...args_1], void 0, function* (disconnected = false) {
            if (stopping)
                return;
            stopping = true;
            if (disconnected)
                stopBusiness();
            yield quiesce();
            if (!disconnected)
                yield drain();
            executor.close();
            yield Promise.allSettled(shutdownCallbacks.map(fn => Promise.resolve().then(fn)));
            process.exit(0);
        });
        process.on("disconnect", () => { void shutdown(true); });
        const stopBusiness = (0, business_rpc_1.attachChildBusinessRpc)();
        shutdownCallbacks.push(stopBusiness);
        const bootstrap = require(options.registerModule);
        if (typeof bootstrap.register !== "function")
            throw new Error("bootstrap must export register");
        const metadata = yield bootstrap.register(executor, {
            onQuiesce: (fn) => quiesceCallbacks.push(fn),
            onDrain: (fn) => drainCallbacks.push(fn),
            onShutdown: (fn) => shutdownCallbacks.push(fn),
        });
        if (!process.connected) {
            yield shutdown();
            return;
        }
        process.on("message", (message) => __awaiter(this, void 0, void 0, function* () {
            var _b;
            if ((message === null || message === void 0 ? void 0 : message.t) === "command-shutdown") {
                void shutdown();
                return;
            }
            if (stopping || !Number.isSafeInteger(message === null || message === void 0 ? void 0 : message.requestId) || message.requestId <= 0)
                return;
            if (message.t === "command-quiesce" || message.t === "command-drain") {
                try {
                    if (message.t === "command-quiesce")
                        yield quiesce();
                    else
                        yield drain();
                    if (process.connected)
                        process.send({ t: message.t === "command-quiesce" ? "command-quiesced" : "command-drained", requestId: message.requestId });
                }
                catch (_c) {
                    process.disconnect();
                }
                return;
            }
            const commandId = message.t === "command-submit" ? (_b = message.envelope) === null || _b === void 0 ? void 0 : _b.commandId : message.commandId;
            if (typeof commandId !== "string")
                return;
            let size;
            try {
                size = (0, command_protocol_1.commandJsonBytes)(message);
            }
            catch (_d) {
                process.disconnect();
                return;
            }
            const reply = (result) => {
                if (!process.connected)
                    return;
                let resolve;
                const sent = new Promise(done => { resolve = done; });
                replies.add(sent);
                const done = (error) => { replies.delete(sent); resolve(); if (error)
                    void shutdown(true); };
                try {
                    process.send({ t: "command-result", requestId: message.requestId, result: (0, command_protocol_1.cloneCommandJson)(result) }, done);
                }
                catch (_a) {
                    done(new Error("IPC_SEND_FAILED"));
                }
            };
            if (inflight >= options.maxPending || bytes + size > options.maxPendingBytes) {
                reply({ commandId, ownerEpoch: executor.ownerEpoch, status: "rejected", code: "PROCESS_QUEUE_LIMIT", outcomeUnknown: false });
                return;
            }
            inflight++;
            bytes += size;
            try {
                if (message.t === "command-submit") {
                    const proof = message.businessAdmission;
                    const accepted = proof && proof.ownerEpoch === executor.ownerEpoch && proof.commandId === commandId
                        && typeof proof.admissionToken === "string" && /^[a-f0-9]{64}$/.test(proof.admissionToken)
                        && Object.keys(proof).length === 3;
                    const ownsAdmission = accepted && !commandAdmissions.has(commandId);
                    if (ownsAdmission)
                        commandAdmissions.set(commandId, proof);
                    try {
                        reply(yield executor.submit(message.envelope, !!accepted));
                    }
                    finally {
                        if (ownsAdmission)
                            commandAdmissions.delete(commandId);
                    }
                }
                else if (message.t === "command-query")
                    reply(yield executor.queryResult(commandId));
                else
                    reply({ commandId, ownerEpoch: executor.ownerEpoch, status: "rejected", code: "PROCESS_INVALID_OPERATION", outcomeUnknown: false });
            }
            catch (_e) {
                reply({ commandId, ownerEpoch: executor.ownerEpoch, status: "unknown", code: "PROCESS_APPLICATION_ERROR", outcomeUnknown: true });
            }
            finally {
                inflight--;
                bytes -= size;
            }
        }));
        process.send({ t: "command-ready", ownerEpoch: executor.ownerEpoch, metadata: (0, command_protocol_1.cloneCommandJson)(metadata !== null && metadata !== void 0 ? metadata : null) });
    });
}
if (require.main === module) {
    // A Windows console broadcasts Ctrl+C/Ctrl+Break to forked children too.
    // The supervisor alone owns the drain deadline and sends explicit IPC stop.
    // Exiting here would destroy accepted work before the parent close hooks.
    if (process.platform === "win32") {
        process.on("SIGINT", () => { });
        process.on("SIGBREAK", () => { });
    }
    void main().catch(error => {
        console.error("[MULTI-REALTIME] owner bootstrap failed", error);
        if (process.connected)
            process.send({ t: "command-start-failed" }, () => process.exit(1));
        else
            process.exit(1);
    });
}
