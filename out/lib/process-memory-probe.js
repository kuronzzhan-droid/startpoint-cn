"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProcessMemoryProbe = exports.readWindowsProcessMemory = void 0;
const node_child_process_1 = require("node:child_process");
const node_path_1 = require("node:path");
const node_perf_hooks_1 = require("node:perf_hooks");
const fields = [
    "privateBytes", "workingSetBytes", "virtualBytes", "handleCount", "threadCount",
];
const regionFields = ["privateCommittedBytes", "mappedCommittedBytes", "imageCommittedBytes",
    "otherCommittedBytes", "reservedBytes", "regionCount"];
function readWindowsProcessMemory(signal) {
    // Only numeric process measurements leave the helper. Never collect command
    // lines, environment variables, database paths or another process's memory.
    return new Promise((resolve, reject) => {
        var _a;
        (0, node_child_process_1.execFile)((0, node_path_1.join)((_a = process.env.SystemRoot) !== null && _a !== void 0 ? _a : "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"), ["-NoLogo", "-NoProfile", "-NonInteractive", "-File",
            (0, node_path_1.join)(__dirname, "../../tools/capture-native-memory.ps1"), "-ProcessId", String(process.pid)], { windowsHide: true, timeout: 5000, maxBuffer: 4096, encoding: "utf8", signal }, (error, stdout) => {
            if (error) {
                reject(error);
                return;
            }
            try {
                const value = JSON.parse(stdout.trim().replace(/^\uFEFF/, ""));
                if (!value || value.pid !== process.pid
                    || fields.some(field => !Number.isSafeInteger(value[field]) || value[field] < 0)
                    || !value.regions || regionFields.some(field => !Number.isSafeInteger(value.regions[field]) || value.regions[field] < 0)) {
                    throw new Error("Invalid process memory sample");
                }
                resolve(Object.assign(Object.assign({}, Object.fromEntries(fields.map(field => [field, value[field]]))), { regions: Object.fromEntries(regionFields.map(field => [field, value.regions[field]])) }));
            }
            catch (error) {
                reject(error);
            }
        });
    });
}
exports.readWindowsProcessMemory = readWindowsProcessMemory;
/** One bounded, asynchronous OS request; never block a gameplay request on PowerShell. */
class ProcessMemoryProbe {
    constructor(enabled, read, now) {
        var _a;
        if (enabled === void 0) { enabled = process.platform === "win32" && process.arch === "x64"
            && /^(1|true|yes|on)$/i.test((_a = process.env.PROCESS_MEMORY_DIAGNOSTICS) !== null && _a !== void 0 ? _a : "false"); }
        if (read === void 0) { read = readWindowsProcessMemory; }
        if (now === void 0) { now = () => node_perf_hooks_1.performance.now(); }
        this.enabled = enabled;
        this.read = read;
        this.now = now;
        this.sample = null;
        this.sampledAt = null;
        this.requestAt = null;
        this.controller = null;
        this.failed = false;
        this.closed = false;
    }
    request() {
        if (!this.enabled || this.closed || this.controller)
            return;
        const controller = new AbortController();
        this.controller = controller;
        this.requestAt = this.now();
        void Promise.resolve().then(() => {
            if (controller.signal.aborted)
                throw new Error("Process memory probe closed");
            return this.read(controller.signal);
        }).then(sample => {
            if (this.closed || this.controller !== controller)
                return;
            this.sample = sample;
            this.sampledAt = this.now();
            this.failed = false;
        }).catch(() => {
            if (!this.closed)
                this.failed = true;
        }).finally(() => {
            if (this.controller === controller) {
                this.controller = null;
                this.requestAt = null;
            }
        });
    }
    snapshot() {
        const ageMs = this.sampledAt === null ? null : Math.round(this.now() - this.sampledAt);
        return { available: this.enabled, ageMs, stale: this.failed || ageMs === null || ageMs > 120000,
            pendingMs: this.requestAt === null ? 0 : Math.round(this.now() - this.requestAt),
            failed: this.failed, memory: this.sample };
    }
    close() {
        var _a;
        this.closed = true;
        (_a = this.controller) === null || _a === void 0 ? void 0 : _a.abort();
        this.controller = null;
        this.requestAt = null;
    }
}
exports.ProcessMemoryProbe = ProcessMemoryProbe;
