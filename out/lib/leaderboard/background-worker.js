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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runLeaderboardSettlementInBackground = exports.executeLeaderboardSettlementWorker = exports.terminateActiveLeaderboardSettlements = exports.cancelActiveLeaderboardSettlements = exports.LeaderboardSeasonMismatchError = void 0;
const node_path_1 = __importDefault(require("node:path"));
const node_worker_threads_1 = require("node:worker_threads");
const db_1 = require("../../data/db");
const persistence_coordinator_1 = require("../persistence-coordinator");
const competition_1 = require("./competition");
const availability_1 = require("./availability");
const settlement_1 = require("./settlement");
const worker_cancellation_1 = require("./worker-cancellation");
class SettlementWorkerFailure extends Error {
    constructor(error, commitMayHaveSucceeded) {
        super(error.message);
        this.commitMayHaveSucceeded = commitMayHaveSucceeded;
        this.code = error.code;
        this.statusCode = this.code === "LEADERBOARD_CANCELLED" ? 503 : 500;
    }
}
class LeaderboardSeasonMismatchError extends Error {
    constructor(expectedSeason, actualSeason) {
        super(`Leaderboard season changed: expected ${expectedSeason}, current ${actualSeason}. No rewards issued.`);
        this.expectedSeason = expectedSeason;
        this.actualSeason = actualSeason;
        this.code = "LEADERBOARD_SEASON_MISMATCH";
        this.statusCode = 409;
    }
}
exports.LeaderboardSeasonMismatchError = LeaderboardSeasonMismatchError;
const activeWorkers = new Map();
let cancellationReason;
function assertJobsNotCancelled() {
    if (cancellationReason !== undefined)
        throw new worker_cancellation_1.LeaderboardSettlementCancelledError(cancellationReason);
}
/** Sticky for this process: an accepted job still in the queue must never start later. */
function cancelActiveLeaderboardSettlements(reason) {
    cancellationReason !== null && cancellationReason !== void 0 ? cancellationReason : (cancellationReason = reason !== null && reason !== void 0 ? reason : "Leaderboard settlement cancelled during shutdown; check the committed season before retrying.");
    for (const buffer of activeWorkers.values())
        Atomics.store(new Int32Array(buffer), 0, 1);
}
exports.cancelActiveLeaderboardSettlements = cancelActiveLeaderboardSettlements;
/** Exit listeners retain ownership until native handles really close. */
function terminateActiveLeaderboardSettlements() {
    return __awaiter(this, void 0, void 0, function* () {
        yield Promise.all([...activeWorkers.keys()].map(worker => worker.terminate()));
    });
}
exports.terminateActiveLeaderboardSettlements = terminateActiveLeaderboardSettlements;
function expectedScheduleCommit(job, config, nowMs) {
    if (!job.scheduled || !config.autoEnabled || config.settleAtMs === null || config.settleAtMs > nowMs)
        return null;
    return {
        autoEnabled: config.repeatIntervalMs !== null,
        freezeEnabled: config.repeatIntervalMs !== null,
        settleAtMs: config.repeatIntervalMs === null ? null : config.settleAtMs + (Math.floor((nowMs - config.settleAtMs) / config.repeatIntervalMs) + 1) * config.repeatIntervalMs,
        repeatIntervalMs: config.repeatIntervalMs,
        updatedAtMs: nowMs,
    };
}
function workerOptions(input) {
    const compiled = __filename.endsWith(".js");
    return {
        filename: node_path_1.default.resolve(__dirname, `../../workers/leaderboard-settlement-worker.${compiled ? "js" : "ts"}`),
        options: Object.assign({ workerData: input }, (compiled ? {} : { execArgv: ["-r", require.resolve("ts-node/register/transpile-only")] })),
    };
}
/** No in-process fallback: inability to start a worker must not stall the event loop. */
function executeLeaderboardSettlementWorker(input, options = {}) {
    return new Promise((resolve, reject) => {
        var _a, _b, _c;
        assertJobsNotCancelled();
        const cancelBuffer = (_a = input.cancelBuffer) !== null && _a !== void 0 ? _a : new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
        const location = workerOptions(Object.assign(Object.assign({}, input), { cancelBuffer }));
        const worker = ((_b = options.createWorker) !== null && _b !== void 0 ? _b : ((file, opts) => new node_worker_threads_1.Worker(file, opts)))(location.filename, location.options);
        activeWorkers.set(worker, cancelBuffer);
        if (cancellationReason !== undefined)
            Atomics.store(new Int32Array(cancelBuffer), 0, 1);
        let reply, failure, started = false;
        const timer = setTimeout(() => {
            failure = new Error("Leaderboard settlement worker timed out; retry after checking the committed season.");
            void worker.terminate();
        }, (_c = options.timeoutMs) !== null && _c !== void 0 ? _c : 120000);
        timer.unref();
        worker.on("message", (message) => {
            if (message.type === "started")
                started = true;
            if (message.type === "result")
                reply = message;
        });
        worker.on("error", error => { failure = error; void worker.terminate(); });
        // Keep the main connection's write gate until native handles are closed,
        // including termination, startup failure, and a lost COMMIT reply.
        worker.once("exit", code => {
            activeWorkers.delete(worker);
            clearTimeout(timer);
            if (reply === null || reply === void 0 ? void 0 : reply.ok)
                return resolve(reply.outcome);
            if (reply && !reply.ok) {
                failure = Object.assign(new Error(reply.message), { code: reply.code });
            }
            // A failure reply is sent after rollback. Before 'started', the
            // worker has not entered settlement. Only a missing reply after
            // starting can leave the COMMIT result unknown.
            reject(new SettlementWorkerFailure(failure !== null && failure !== void 0 ? failure : (Atomics.load(new Int32Array(cancelBuffer), 0) !== 0
                ? new worker_cancellation_1.LeaderboardSettlementCancelledError(cancellationReason)
                : new Error(`Leaderboard worker exited without a result (${code}).`)), started && !reply));
        });
    });
}
exports.executeLeaderboardSettlementWorker = executeLeaderboardSettlementWorker;
function committedOutcome(input, scheduleCommit) {
    if (input.scheduled) {
        // The season receipt may predate this job. Recovery also requires the
        // exact plan advancement calculated before this worker started, while
        // the shared write gate is still held.
        if (!scheduleCommit)
            return null;
        const schedule = (0, db_1.getDb)().prepare(`SELECT auto_enabled, freeze_enabled, settle_at_ms,
            repeat_interval_ms, updated_at_ms FROM leaderboard_settlement_configs WHERE competition_key=?`)
            .get(input.competitionKey);
        if (!schedule || schedule.auto_enabled !== Number(scheduleCommit.autoEnabled)
            || schedule.freeze_enabled !== Number(scheduleCommit.freezeEnabled)
            || schedule.settle_at_ms !== scheduleCommit.settleAtMs
            || schedule.repeat_interval_ms !== scheduleCommit.repeatIntervalMs
            || schedule.updated_at_ms !== scheduleCommit.updatedAtMs)
            return null;
    }
    const row = (0, db_1.getDb)().prepare(`SELECT id, ranked_players, rewarded_players
        FROM leaderboard_settlements WHERE competition_key=? AND season=? AND status='completed'`)
        .get(input.competitionKey, input.season);
    return row ? { ok: true, competitionKey: input.competitionKey, season: input.season,
        settlementId: row.id, rankedPlayers: row.ranked_players, rewardedPlayers: row.rewarded_players,
        reason: "already-settled" } : null;
}
/** Called inside the shared one-job leaderboard control, never inside a DB transaction. */
function runLeaderboardSettlementInBackground(job_1) {
    return __awaiter(this, arguments, void 0, function* (job, workerOptions = {}) {
        if (job.expectedSeason !== undefined && (!Number.isSafeInteger(job.expectedSeason) || job.expectedSeason < 1)) {
            return Promise.reject(Object.assign(new Error("expectedSeason must be a positive safe integer."), { statusCode: 400 }));
        }
        return (0, persistence_coordinator_1.runBackgroundPersistenceTask)({ domain: "leaderboard", operation: "background_settlement" }, (_a) => __awaiter(this, [_a], void 0, function* ({ input, scheduleCommit }) {
            try {
                return yield executeLeaderboardSettlementWorker(input, workerOptions);
            }
            catch (error) {
                if (!(error instanceof SettlementWorkerFailure) || !error.commitMayHaveSucceeded)
                    throw error;
                // The worker has exited. Resolve an unknown COMMIT from durable
                // awards and, for scheduled work, this job's plan advancement.
                const committed = committedOutcome(input, scheduleCommit);
                if (committed)
                    return committed;
                throw error;
            }
        }), () => {
            var _a;
            // Small initialization writes stay on the schema-owning connection.
            // Manual commands capture real time after waiting for prior writes;
            // scheduled jobs retain the explicit tick timestamp they were given.
            const nowMs = (_a = job.nowMs) !== null && _a !== void 0 ? _a : Date.now();
            const season = (0, competition_1.getLeaderboardCompetitionSeasonSync)(job.competitionKey, nowMs);
            if (job.expectedSeason !== undefined && season !== job.expectedSeason) {
                throw new LeaderboardSeasonMismatchError(job.expectedSeason, season);
            }
            const config = (0, settlement_1.getLeaderboardSettlementConfigSync)(job.competitionKey, nowMs);
            (0, availability_1.getLeaderboardAvailabilitySync)(job.competitionKey, nowMs);
            const databasePath = (0, db_1.getDb)().name;
            if (!databasePath || databasePath === ":memory:")
                throw new Error("Background settlement requires a file-backed database.");
            return { input: Object.assign(Object.assign({}, job), { nowMs, season, databasePath }), scheduleCommit: expectedScheduleCommit(job, config, nowMs) };
        }, assertJobsNotCancelled);
    });
}
exports.runLeaderboardSettlementInBackground = runLeaderboardSettlementInBackground;
