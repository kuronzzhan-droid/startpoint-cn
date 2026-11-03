"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const worker_threads_1 = require("worker_threads");
const input = worker_threads_1.workerData;
function send(message) {
    worker_threads_1.parentPort === null || worker_threads_1.parentPort === void 0 ? void 0 : worker_threads_1.parentPort.postMessage(Object.assign({ jobId: input.jobId }, message));
}
function main() {
    // This worker is intentionally read-only.  It may scan and prepare the
    // cleanup plan, but the main process remains the sole writer of
    // wdfp_data.db so gameplay settlement cannot contend with another SQLite
    // connection created by the administration feature.
    const database = new better_sqlite3_1.default(input.databasePath, {
        readonly: true,
        fileMustExist: true,
    });
    try {
        send({ type: "phase", phase: "planning" });
        const plannedEntries = [];
        for (let offset = 0; offset < input.accountIds.length; offset += input.batchSize) {
            const requestedIds = input.accountIds.slice(offset, offset + input.batchSize);
            if (requestedIds.length === 0)
                continue;
            const placeholders = requestedIds.map(() => "?").join(", ");
            const existingAccounts = database.prepare(`SELECT id FROM accounts WHERE id IN (${placeholders})`).all(...requestedIds);
            const players = database.prepare(`SELECT id, account_id FROM players WHERE account_id IN (${placeholders})`).all(...requestedIds);
            for (const account of existingAccounts) {
                plannedEntries.push({
                    accountId: account.id,
                    playerIds: players
                        .filter(player => player.account_id === account.id)
                        .map(player => player.id),
                });
            }
        }
        send({ type: "plan", plannedEntries });
    }
    finally {
        database.close();
    }
}
try {
    main();
}
catch (error) {
    send({
        type: "failed",
        error: error instanceof Error ? error.message : String(error),
    });
    process.exitCode = 1;
}
