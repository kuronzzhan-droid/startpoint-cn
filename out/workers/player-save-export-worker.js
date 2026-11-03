"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const worker_threads_1 = require("worker_threads");
const player_snapshot_1 = require("../data/snapshots/player-snapshot");
const input = worker_threads_1.workerData;
function send(message, transferList = []) {
    worker_threads_1.parentPort === null || worker_threads_1.parentPort === void 0 ? void 0 : worker_threads_1.parentPort.postMessage(message, transferList);
}
function main() {
    const database = new better_sqlite3_1.default(input.databasePath, {
        readonly: true,
        fileMustExist: true,
    });
    database.pragma("query_only = ON");
    database.pragma("busy_timeout = 5000");
    let snapshot;
    try {
        // One read transaction pins a consistent WAL snapshot while gameplay
        // remains free to write through the main process connection.
        snapshot = database.transaction(() => ((0, player_snapshot_1.createPlayerSaveSnapshotV2Sync)(input.playerId, database)))();
    }
    finally {
        database.close();
    }
    const payload = new TextEncoder().encode(JSON.stringify(snapshot));
    if (payload.byteLength > input.maxBytes) {
        send({
            type: "failed",
            code: "too-large",
            error: `存档超过 ${input.maxBytes / 1024 / 1024} MB 安全上限`,
        });
        return;
    }
    send({
        type: "completed",
        payload: payload.buffer,
        byteLength: payload.byteLength,
        rowCount: snapshot.summary.rowCount,
    }, [payload.buffer]);
}
try {
    main();
}
catch (error) {
    send({
        type: "failed",
        code: "export-failed",
        error: error instanceof Error ? error.message : String(error),
    });
    process.exitCode = 1;
}
