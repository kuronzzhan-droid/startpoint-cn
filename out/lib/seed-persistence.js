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
exports.SeedPersistence = void 0;
const path_1 = require("path");
const worker_threads_1 = require("worker_threads");
const settlement_performance_1 = require("./settlement-performance");
const memory_diagnostics_1 = require("./memory-diagnostics");
let persistenceSequence = 0;
/** Keeps only changed seeds on the request thread; one worker owns disk writes. */
class SeedPersistence {
    constructor(directory, snapshot, delayMs = 1000) {
        this.directory = directory;
        this.snapshot = snapshot;
        this.delayMs = delayMs;
        this.worker = null;
        this.pending = new Map();
        this.inFlight = null;
        this.revision = 0;
        this.savedRevision = 0;
        this.timer = null;
        this.closed = false;
        this.lastErrorLogAt = 0;
        this.waiters = [];
        this.unregisterMetrics = (0, memory_diagnostics_1.registerMemoryCounters)(`seedQueue${++persistenceSequence}`, () => {
            var _a, _b;
            return ({
                pendingUpdates: this.pending.size, inFlightUpdates: (_b = (_a = this.inFlight) === null || _a === void 0 ? void 0 : _a.updates.length) !== null && _b !== void 0 ? _b : 0,
                waiters: this.waiters.length, revision: this.revision, savedRevision: this.savedRevision,
                workerAvailable: this.worker !== null,
            });
        });
        this.startWorker(false);
    }
    startWorker(recover) {
        const typescript = __filename.endsWith(".ts");
        const worker = new worker_threads_1.Worker((0, path_1.join)(__dirname, `seed-persistence-worker.${typescript ? "ts" : "js"}`), Object.assign({ workerData: { directory: this.directory, pools: this.snapshot(), recover } }, (typescript ? { execArgv: ["-r", require.resolve("ts-node/register/transpile-only")] } : {})));
        this.worker = worker;
        (0, memory_diagnostics_1.observeWorkerMemory)("seedPersistence", worker);
        worker.on("message", (result) => {
            var _a;
            if (!Number.isSafeInteger(result.revision))
                return;
            if (this.worker !== worker || result.revision !== ((_a = this.inFlight) === null || _a === void 0 ? void 0 : _a.revision))
                return;
            (0, settlement_performance_1.recordSettlementPhase)("gacha", "seed_write_worker", result.elapsedMs);
            if (result.error) {
                this.failed(new Error(result.error));
                return;
            }
            this.savedRevision = result.revision;
            this.inFlight = null;
            const waiting = this.waiters;
            this.waiters = [];
            for (const waiter of waiting) {
                if (waiter.revision <= this.savedRevision)
                    waiter.resolve();
                else
                    this.waiters.push(waiter);
            }
            if (this.waiters.length > 0)
                this.dispatch();
            else if (this.pending.size > 0)
                this.schedule();
            else
                worker.unref();
        });
        const lost = (error) => {
            if (this.worker !== worker)
                return;
            this.worker = null;
            this.failed(error);
        };
        worker.on("error", lost);
        worker.on("exit", code => {
            if (!this.closed)
                lost(new Error(`seed persistence worker exited (${code})`));
        });
        worker.unref();
    }
    update(update) {
        var _a;
        if (this.closed)
            throw new Error("seed persistence is closed");
        this.revision += 1;
        this.pending.set(`${update.movieId}:${update.seed}`, update);
        (_a = this.worker) === null || _a === void 0 ? void 0 : _a.ref();
        this.schedule();
    }
    schedule() {
        if (this.closed || this.timer || this.inFlight || this.pending.size === 0)
            return;
        // Keep the process alive until pending records are durably acknowledged.
        this.timer = setTimeout(() => { this.timer = null; this.dispatch(); }, this.delayMs);
    }
    dispatch() {
        if (this.inFlight || this.pending.size === 0 || this.closed)
            return;
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        try {
            if (!this.worker)
                this.startWorker(true);
            this.inFlight = { revision: this.revision, updates: [...this.pending.values()] };
            this.pending.clear();
            this.worker.ref();
            this.worker.postMessage(this.inFlight);
        }
        catch (error) {
            this.failed(error instanceof Error ? error : new Error(String(error)));
        }
    }
    failed(error) {
        if (this.inFlight) {
            for (const update of this.inFlight.updates) {
                const key = `${update.movieId}:${update.seed}`;
                if (!this.pending.has(key))
                    this.pending.set(key, update);
            }
            this.inFlight = null;
        }
        for (const waiter of this.waiters)
            waiter.reject(error);
        this.waiters = [];
        if (Date.now() - this.lastErrorLogAt >= 60000) {
            console.error("[SEED] persistence failed; retaining changes for retry", error);
            this.lastErrorLogAt = Date.now();
        }
        this.schedule();
    }
    /** Barrier for admin changes, verified corrections and orderly shutdown. */
    flush() {
        if (this.savedRevision >= this.revision)
            return Promise.resolve();
        return new Promise((resolve, reject) => {
            this.waiters.push({ revision: this.revision, resolve, reject });
            this.dispatch();
        });
    }
    close() {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                yield this.flush();
            }
            finally {
                this.closed = true;
                this.unregisterMetrics();
                if (this.timer)
                    clearTimeout(this.timer);
                const worker = this.worker;
                this.worker = null;
                if (worker)
                    yield worker.terminate();
            }
        });
    }
}
exports.SeedPersistence = SeedPersistence;
