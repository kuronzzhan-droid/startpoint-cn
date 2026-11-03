"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dispatchAcceptedRealtimeBusiness = exports.createAcceptedRealtimeBusinessScope = void 0;
const node_async_hooks_1 = require("node:async_hooks");
const node_crypto_1 = require("node:crypto");
const shutdown_state_1 = require("../../lib/shutdown-state");
const scopes = new Map();
const maximumScopes = 256;
function invalidProof() {
    return Object.assign(new Error("REALTIME_BUSINESS_ADMISSION_INVALID"), { code: "REALTIME_BUSINESS_ADMISSION_INVALID" });
}
function identity(value, maximum) {
    return typeof value === "string" && value.length > 0 && value.length <= maximum;
}
/** Called synchronously at parent acceptance, never at an untrusted child callback. */
function createAcceptedRealtimeBusinessScope(input) {
    (0, shutdown_state_1.assertServerAcceptingWork)();
    if (!identity(input.ownerEpoch, 128) || !identity(input.commandId, 256))
        throw invalidProof();
    if (scopes.size >= maximumScopes) {
        throw Object.assign(new Error("REALTIME_BUSINESS_ADMISSION_BUDGET"), { code: "REALTIME_BUSINESS_ADMISSION_BUDGET" });
    }
    const proof = Object.freeze({ ownerEpoch: input.ownerEpoch, commandId: input.commandId,
        admissionToken: (0, node_crypto_1.randomBytes)(32).toString("hex") });
    let active = true, finish;
    let boundRun;
    const lifetime = new Promise(resolve => { finish = resolve; });
    // Hold the original admission until actual application ACK/channel termination.
    // AsyncResource restores that context in the independent IPC message callback.
    void (0, shutdown_state_1.withServerWorkAdmission)(() => {
        boundRun = node_async_hooks_1.AsyncResource.bind((operation) => (0, shutdown_state_1.withServerWorkAdmission)(operation));
        return lifetime;
    });
    const scope = {
        proof,
        run(operation) {
            if (!active || scopes.get(proof.admissionToken) !== scope)
                return Promise.reject(invalidProof());
            try {
                return boundRun(operation);
            }
            catch (error) {
                return Promise.reject(error);
            }
        },
        release() {
            if (!active)
                return;
            active = false;
            scopes.delete(proof.admissionToken);
            finish();
        },
    };
    scopes.set(proof.admissionToken, scope);
    return scope;
}
exports.createAcceptedRealtimeBusinessScope = createAcceptedRealtimeBusinessScope;
/** Only exact, currently held parent proofs can extend accepted work after seal. */
function dispatchAcceptedRealtimeBusiness(proof, operation) {
    if (!proof || typeof proof !== "object" || Array.isArray(proof))
        return Promise.reject(invalidProof());
    const p = proof;
    const keys = Object.keys(p).sort();
    if (keys.join(",") !== "admissionToken,commandId,ownerEpoch"
        || !identity(p.ownerEpoch, 128) || !identity(p.commandId, 256)
        || typeof p.admissionToken !== "string" || !/^[a-f0-9]{64}$/.test(p.admissionToken)) {
        return Promise.reject(invalidProof());
    }
    const scope = scopes.get(p.admissionToken);
    if (!scope || scope.proof.commandId !== p.commandId || scope.proof.ownerEpoch !== p.ownerEpoch) {
        return Promise.reject(invalidProof());
    }
    return scope.run(operation);
}
exports.dispatchAcceptedRealtimeBusiness = dispatchAcceptedRealtimeBusiness;
