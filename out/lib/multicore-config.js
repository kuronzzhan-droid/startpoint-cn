"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.multicoreConfig = void 0;
const node_os_1 = require("node:os");
function count(value, fallback) {
    if (!(value === null || value === void 0 ? void 0 : value.trim()))
        return fallback;
    const number = Number(value);
    return Number.isInteger(number) && number >= 0 ? Math.min(4, number) : fallback;
}
function switchValue(value) {
    if (/^(1|true|yes|on)$/i.test(value !== null && value !== void 0 ? value : ""))
        return true;
    if (/^(0|false|no|off)$/i.test(value !== null && value !== void 0 ? value : ""))
        return false;
    return undefined;
}
/** CPU workers share a budget; maintenance threads are mostly sleeping. */
function multicoreConfig(environment = process.env, cores = (0, node_os_1.availableParallelism)()) {
    var _a;
    const configured = switchValue(environment.CN_MULTICORE);
    const enabled = configured !== null && configured !== void 0 ? configured : cores >= 4;
    // Response workers improve isolation for unusually large bursts, but the
    // measured 4-core workload spends less total CPU on the local encoder.
    const responseWorkers = count(environment.CN_RESPONSE_WORKERS, 0);
    const checkpointWorker = (_a = switchValue(environment.SQLITE_CHECKPOINT_WORKER)) !== null && _a !== void 0 ? _a : enabled;
    return { enabled, responseWorkers, checkpointWorker };
}
exports.multicoreConfig = multicoreConfig;
