"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
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
const node_perf_hooks_1 = require("node:perf_hooks");
const node_worker_threads_1 = require("node:worker_threads");
const db_1 = require("../data/db");
const memory_diagnostics_1 = require("../lib/memory-diagnostics");
const command_registry_1 = require("../lib/persistence/command-registry");
const writer_connection_1 = require("../lib/persistence/writer-connection");
const writer_config_1 = require("../lib/persistence/writer-config");
const utils_1 = require("../utils");
const input = node_worker_threads_1.workerData;
if ((input === null || input === void 0 ? void 0 : input.protocolVersion) !== writer_config_1.WRITER_PROTOCOL_VERSION) {
    throw new Error(`SQLite writer worker protocol mismatch: worker=${input === null || input === void 0 ? void 0 : input.protocolVersion} expected=${writer_config_1.WRITER_PROTOCOL_VERSION}`);
}
let database = null;
let running = false;
let closeRequested = false;
let closed = false;
const queue = [];
const stats = {
    batches: 0,
    batchedCommands: 0,
    maxBatch: 0,
    completed: 0,
    failed: 0,
    savepointRollbacks: 0,
    afterCommitFailures: 0,
    unknownCommands: 0,
    commitMsTotal: 0,
    commitMsMax: 0,
};
(0, memory_diagnostics_1.installWorkerMemoryProbe)(() => ({
    batches: stats.batches,
    batchedCommands: stats.batchedCommands,
    maxBatch: stats.maxBatch,
    completed: stats.completed,
    failed: stats.failed,
    savepointRollbacks: stats.savepointRollbacks,
    afterCommitFailures: stats.afterCommitFailures,
    unknownCommands: stats.unknownCommands,
    commitMsAvg: stats.batches === 0 ? 0 : stats.commitMsTotal / stats.batches,
    commitMsMax: stats.commitMsMax,
    queued: queue.length,
    executing: running,
}));
function delay(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}
function messageOf(error) {
    return error instanceof Error ? error.message : String(error);
}
function errorCodeOf(error) {
    if (!(error instanceof Error) || !("code" in error))
        return null;
    const code = error.code;
    return typeof code === "string" ? code : null;
}
function post(message) {
    try {
        node_worker_threads_1.parentPort === null || node_worker_threads_1.parentPort === void 0 ? void 0 : node_worker_threads_1.parentPort.postMessage(message);
    }
    catch (error) {
        // The port can be gone while the main thread is shutting down. Never
        // let reporting failure abort a batch that already committed.
        console.error("[WRITER] failed to post worker message", messageOf(error));
    }
}
/**
 * Execute one group of commands inside a single transaction.
 *
 * A batch shares one `BEGIN IMMEDIATE`/`COMMIT` pair so several logical writes
 * pay for a single durable commit. Per-command savepoints keep atomicity: a
 * failing command rolls back to its own savepoint and the remaining commands
 * still commit. A failing COMMIT fails the whole batch, which is the correct
 * outcome because no command was acknowledged.
 */
function executeBatch(batch) {
    var _a;
    const connection = database;
    if (connection === null) {
        return {
            outcomes: batch.map(command => ({
                id: command.id,
                ok: false,
                error: "SQLite writer worker is closed.",
                code: null,
            })),
            commitMs: 0,
            rollbacks: 0,
        };
    }
    const startedAt = node_perf_hooks_1.performance.now();
    const outcomes = [];
    const effects = [];
    let rollbacks = 0;
    let begun = false;
    try {
        connection.exec("BEGIN IMMEDIATE");
        begun = true;
        for (const command of batch) {
            const handler = (0, command_registry_1.getWriterCommand)(command.name);
            if (handler === undefined) {
                stats.unknownCommands++;
                outcomes.push({
                    id: command.id,
                    ok: false,
                    error: `Unknown writer command: ${command.name}`,
                    code: null,
                });
                continue;
            }
            const savepoint = `sp_${command.id}`;
            const commandEffects = [];
            const context = {
                meta: command.meta,
                afterCommit: effect => {
                    if (typeof effect === "function")
                        commandEffects.push(effect);
                },
            };
            connection.exec(`SAVEPOINT ${savepoint}`);
            try {
                const offset = (_a = (0, utils_1.getLegacyTimeOffset)()) !== null && _a !== void 0 ? _a : 0;
                const value = (0, utils_1.withServerClock)(Date.now() + offset, () => handler(command.args, context), offset);
                // Clone before COMMIT: a result that cannot cross the thread
                // boundary must roll the command back instead of committing a
                // write whose caller will only ever see an error.
                const transportValue = structuredClone(value);
                connection.exec(`RELEASE ${savepoint}`);
                outcomes.push({ id: command.id, ok: true, value: transportValue });
                effects.push(...commandEffects);
            }
            catch (error) {
                try {
                    connection.exec(`ROLLBACK TO ${savepoint}`);
                }
                catch ( /* keep going: the command already failed */_b) { /* keep going: the command already failed */ }
                try {
                    connection.exec(`RELEASE ${savepoint}`);
                }
                catch ( /* the savepoint is gone with the rollback */_c) { /* the savepoint is gone with the rollback */ }
                stats.savepointRollbacks++;
                rollbacks++;
                outcomes.push({
                    id: command.id,
                    ok: false,
                    error: messageOf(error),
                    code: errorCodeOf(error),
                });
            }
        }
        connection.exec("COMMIT");
    }
    catch (error) {
        if (begun) {
            try {
                connection.exec("ROLLBACK");
            }
            catch ( /* SQLite already rolled the transaction back */_d) { /* SQLite already rolled the transaction back */ }
        }
        stats.failed += batch.length;
        const reason = messageOf(error);
        const code = errorCodeOf(error);
        return {
            outcomes: batch.map(command => ({ id: command.id, ok: false, error: reason, code })),
            commitMs: node_perf_hooks_1.performance.now() - startedAt,
            rollbacks,
        };
    }
    const commitMs = node_perf_hooks_1.performance.now() - startedAt;
    stats.batches++;
    stats.batchedCommands += batch.length;
    stats.maxBatch = Math.max(stats.maxBatch, batch.length);
    stats.commitMsTotal += commitMs;
    stats.commitMsMax = Math.max(stats.commitMsMax, commitMs);
    for (const outcome of outcomes) {
        if (outcome.ok)
            stats.completed++;
        else
            stats.failed++;
    }
    // Non-durable side effects run only after the commit succeeded. Effects of
    // a rolled-back command were never collected.
    for (const effect of effects) {
        try {
            effect();
        }
        catch (error) {
            stats.afterCommitFailures++;
            console.error("[WRITER] afterCommit effect failed", messageOf(error));
        }
    }
    return { outcomes, commitMs, rollbacks };
}
function dispatch(outcomes) {
    var _a;
    for (const outcome of outcomes) {
        if (outcome.ok) {
            post({ type: "result", id: outcome.id, value: outcome.value });
        }
        else {
            post({ type: "error", id: outcome.id, error: outcome.error, code: (_a = outcome.code) !== null && _a !== void 0 ? _a : null });
        }
    }
}
function finishCloseIfDrained() {
    if (!closeRequested || closed || running || queue.length > 0)
        return;
    closed = true;
    const connection = database;
    database = null;
    try {
        connection === null || connection === void 0 ? void 0 : connection.close();
    }
    catch (error) {
        console.error("[WRITER] close failed", messageOf(error));
    }
    post({ type: "closed" });
}
function schedule() {
    if (running || closed || database === null)
        return;
    running = true;
    void (() => __awaiter(this, void 0, void 0, function* () {
        try {
            while (!closed && queue.length > 0) {
                const batch = queue.splice(0, input.groupCommitMax);
                if (batch.length < input.groupCommitMax && input.groupCommitWindowMs > 0 && !closeRequested) {
                    // Group-commit window: give other callers a chance to join
                    // this transaction instead of paying another durable commit.
                    yield delay(input.groupCommitWindowMs);
                    while (queue.length > 0 && batch.length < input.groupCommitMax) {
                        batch.push(queue.shift());
                    }
                }
                const result = executeBatch(batch);
                // Report the batch before the per-command outcomes so callers
                // that await a command always observe the batch statistics for
                // the transaction that committed their write.
                post({
                    type: "batch",
                    size: batch.length,
                    commitMs: result.commitMs,
                    rollbacks: result.rollbacks,
                });
                dispatch(result.outcomes);
            }
        }
        catch (error) {
            // executeBatch already converts failures into per-command outcomes.
            // Reaching here means the worker itself is unhealthy.
            console.error("[WRITER] batch loop failed", messageOf(error));
        }
        finally {
            running = false;
            if (queue.length > 0 && !closed)
                schedule();
            else
                finishCloseIfDrained();
        }
    }))();
}
function handleMessage(raw) {
    if (!raw || typeof raw !== "object" || !("type" in raw))
        return;
    const message = raw;
    switch (message.type) {
        case "checkpoint_owner":
            try {
                database === null || database === void 0 ? void 0 : database.pragma(`wal_autocheckpoint = ${message.external ? 0 : 1000}`);
            }
            catch (error) {
                console.error("[WRITER] checkpoint ownership handoff failed", messageOf(error));
            }
            return;
        case "set_time_offset":
            // Both threads must evaluate the same virtual clock: commands that
            // settle player progress run here, and their timestamps were
            // previously read with this thread's own (null) offset.
            (0, utils_1.setServerTimeOffset)(typeof message.offset === "number" && Number.isFinite(message.offset)
                ? message.offset : null);
            return;
        case "close":
            closeRequested = true;
            finishCloseIfDrained();
            return;
        case "command":
            queue.push(Object.assign(Object.assign({}, message), { receivedAt: node_perf_hooks_1.performance.now() }));
            schedule();
            return;
        default:
            // Diagnostics such as the memory probe have their own listeners on
            // this port. Anything that is not a command must never enter the
            // write queue: an unknown message would otherwise be executed as a
            // failed transaction on every probe.
            return;
    }
}
function main() {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const connection = (0, writer_connection_1.openWriterConnection)({
            databasePath: input.databasePath,
            busyTimeoutMs: input.busyTimeoutMs,
        });
        database = connection;
        // Domain modules resolve getDb() lazily, so pointing the override at the
        // writer connection before the command implementations load is enough for
        // the identical domain code to run inside this thread.
        (0, db_1.setDbOverride)(connection);
        yield Promise.resolve().then(() => __importStar(require("../lib/persistence/commands")));
        // Optional extra registration hook. Used by the writer tests (and any
        // future module that must run inside the writer thread) so a suite can
        // exercise the transport without depending on mission data.
        const extraCommands = (_a = process.env.SQLITE_WRITER_EXTRA_COMMANDS) === null || _a === void 0 ? void 0 : _a.trim();
        if (extraCommands) {
            yield Promise.resolve(`${extraCommands}`).then(s => __importStar(require(s)));
        }
        node_worker_threads_1.parentPort === null || node_worker_threads_1.parentPort === void 0 ? void 0 : node_worker_threads_1.parentPort.on("message", handleMessage);
        // Commands may only be dispatched once every implementation is registered.
        post({ type: "ready", protocolVersion: writer_config_1.WRITER_PROTOCOL_VERSION });
    });
}
void main().catch(error => {
    const reason = messageOf(error);
    post({ type: "fatal", error: reason });
    console.error("[WRITER] startup failed", reason);
    process.exit(1);
});
