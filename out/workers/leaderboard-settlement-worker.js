"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_worker_threads_1 = require("node:worker_threads");
const db_1 = require("../data/db");
const writer_connection_1 = require("../lib/persistence/writer-connection");
const settlement_1 = require("../lib/leaderboard/settlement");
const worker_cancellation_1 = require("../lib/leaderboard/worker-cancellation");
const input = node_worker_threads_1.workerData;
let db;
let result;
try {
    (0, worker_cancellation_1.configureLeaderboardSettlementCancellation)(input.cancelBuffer);
    (0, worker_cancellation_1.assertLeaderboardSettlementNotCancelled)();
    db = (0, writer_connection_1.openWriterConnection)({ databasePath: input.databasePath, busyTimeoutMs: 1000 });
    (0, db_1.setDbOverride)(db);
    (0, worker_cancellation_1.assertLeaderboardSettlementNotCancelled)();
    db.exec("BEGIN IMMEDIATE");
    node_worker_threads_1.parentPort === null || node_worker_threads_1.parentPort === void 0 ? void 0 : node_worker_threads_1.parentPort.postMessage({ type: "started" });
    const outcome = (0, settlement_1.runLeaderboardSettlementWorkerSync)(input);
    // A cancellation racing COMMIT is resolved from the durable receipt after exit.
    // Never check again after COMMIT: an acknowledged commit cannot be rolled back.
    (0, worker_cancellation_1.assertLeaderboardSettlementNotCancelled)();
    db.exec("COMMIT");
    result = { type: "result", ok: true, outcome };
}
catch (error) {
    if (db === null || db === void 0 ? void 0 : db.inTransaction)
        db.exec("ROLLBACK");
    result = { type: "result", ok: false, message: error instanceof Error ? error.message : String(error),
        code: error === null || error === void 0 ? void 0 : error.code };
}
finally {
    db === null || db === void 0 ? void 0 : db.close();
}
node_worker_threads_1.parentPort === null || node_worker_threads_1.parentPort === void 0 ? void 0 : node_worker_threads_1.parentPort.postMessage(result);
node_worker_threads_1.parentPort === null || node_worker_threads_1.parentPort === void 0 ? void 0 : node_worker_threads_1.parentPort.close();
