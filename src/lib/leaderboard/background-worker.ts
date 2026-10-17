import path from "node:path"
import { Worker } from "node:worker_threads"
import { getDb } from "../../data/db"
import { runBackgroundPersistenceTask } from "../persistence-coordinator"
import { getLeaderboardCompetitionSeasonSync } from "./competition"
import { getLeaderboardAvailabilitySync } from "./availability"
import { getLeaderboardSettlementConfigSync, type LeaderboardSettlementConfig, type SettlementOutcome } from "./settlement"
import { LeaderboardSettlementCancelledError } from "./worker-cancellation"

export interface LeaderboardSettlementJob {
    competitionKey: string
    source: string
    nowMs?: number
    scheduled: boolean
    expectedSeason?: number
}
export interface LeaderboardSettlementWorkerInput extends LeaderboardSettlementJob {
    nowMs: number
    databasePath: string
    season: number
    cancelBuffer?: SharedArrayBuffer
}
type WorkerReply = { type: "result"; ok: true; outcome: SettlementOutcome | null }
    | { type: "result"; ok: false; message: string; code?: string }

class SettlementWorkerFailure extends Error {
    readonly code?: string
    readonly statusCode: number
    constructor(error: Error, readonly commitMayHaveSucceeded: boolean) {
        super(error.message)
        this.code = (error as { code?: string }).code
        this.statusCode = this.code === "LEADERBOARD_CANCELLED" ? 503 : 500
    }
}

export class LeaderboardSeasonMismatchError extends Error {
    readonly code = "LEADERBOARD_SEASON_MISMATCH"
    readonly statusCode = 409
    constructor(readonly expectedSeason: number, readonly actualSeason: number) {
        super(`Leaderboard season changed: expected ${expectedSeason}, current ${actualSeason}. No rewards issued.`)
    }
}

const activeWorkers = new Map<Worker, SharedArrayBuffer>()
let cancellationReason: string | undefined

function assertJobsNotCancelled(): void {
    if (cancellationReason !== undefined) throw new LeaderboardSettlementCancelledError(cancellationReason)
}

/** Sticky for this process: an accepted job still in the queue must never start later. */
export function cancelActiveLeaderboardSettlements(reason?: string): void {
    cancellationReason ??= reason ?? "Leaderboard settlement cancelled during shutdown; check the committed season before retrying."
    for (const buffer of activeWorkers.values()) Atomics.store(new Int32Array(buffer), 0, 1)
}

/** Exit listeners retain ownership until native handles really close. */
export async function terminateActiveLeaderboardSettlements(): Promise<void> {
    await Promise.all([...activeWorkers.keys()].map(worker => worker.terminate()))
}

type ScheduleCommit = Pick<LeaderboardSettlementConfig,
    "autoEnabled" | "freezeEnabled" | "settleAtMs" | "repeatIntervalMs" | "updatedAtMs">

function expectedScheduleCommit(job: LeaderboardSettlementJob, config: LeaderboardSettlementConfig, nowMs: number): ScheduleCommit | null {
    if (!job.scheduled || !config.autoEnabled || config.settleAtMs === null || config.settleAtMs > nowMs) return null
    return {
        autoEnabled: config.repeatIntervalMs !== null,
        freezeEnabled: config.repeatIntervalMs !== null,
        settleAtMs: config.repeatIntervalMs === null ? null : config.settleAtMs + (
            Math.floor((nowMs - config.settleAtMs) / config.repeatIntervalMs) + 1
        ) * config.repeatIntervalMs,
        repeatIntervalMs: config.repeatIntervalMs,
        updatedAtMs: nowMs,
    }
}

function workerOptions(input: LeaderboardSettlementWorkerInput) {
    const compiled = __filename.endsWith(".js")
    return {
        filename: path.resolve(__dirname, `../../workers/leaderboard-settlement-worker.${compiled ? "js" : "ts"}`),
        options: { workerData: input, ...(compiled ? {} : { execArgv: ["-r", require.resolve("ts-node/register/transpile-only")] }) },
    }
}

/** No in-process fallback: inability to start a worker must not stall the event loop. */
export function executeLeaderboardSettlementWorker(
    input: LeaderboardSettlementWorkerInput,
    options: {
        timeoutMs?: number
        createWorker?: (filename: string, options: ConstructorParameters<typeof Worker>[1]) => Worker
    } = {},
): Promise<SettlementOutcome | null> {
    return new Promise((resolve, reject) => {
        assertJobsNotCancelled()
        const cancelBuffer = input.cancelBuffer ?? new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)
        const location = workerOptions({ ...input, cancelBuffer })
        const worker = (options.createWorker ?? ((file, opts) => new Worker(file, opts)))(location.filename, location.options)
        activeWorkers.set(worker, cancelBuffer)
        if (cancellationReason !== undefined) Atomics.store(new Int32Array(cancelBuffer), 0, 1)
        let reply: WorkerReply | undefined, failure: Error | undefined, started = false
        const timer = setTimeout(() => {
            failure = new Error("Leaderboard settlement worker timed out; retry after checking the committed season.")
            void worker.terminate()
        }, options.timeoutMs ?? 120_000)
        timer.unref()
        worker.on("message", (message: WorkerReply | { type: "started" }) => {
            if (message.type === "started") started = true
            if (message.type === "result") reply = message
        })
        worker.on("error", error => { failure = error; void worker.terminate() })
        // Keep the main connection's write gate until native handles are closed,
        // including termination, startup failure, and a lost COMMIT reply.
        worker.once("exit", code => {
            activeWorkers.delete(worker)
            clearTimeout(timer)
            if (reply?.ok) return resolve(reply.outcome)
            if (reply && !reply.ok) {
                failure = Object.assign(new Error(reply.message), { code: reply.code })
            }
            // A failure reply is sent after rollback. Before 'started', the
            // worker has not entered settlement. Only a missing reply after
            // starting can leave the COMMIT result unknown.
            reject(new SettlementWorkerFailure(
                failure ?? (Atomics.load(new Int32Array(cancelBuffer), 0) !== 0
                    ? new LeaderboardSettlementCancelledError(cancellationReason)
                    : new Error(`Leaderboard worker exited without a result (${code}).`)),
                started && !reply,
            ))
        })
    })
}

function committedOutcome(input: LeaderboardSettlementWorkerInput, scheduleCommit: ScheduleCommit | null): SettlementOutcome | null {
    if (input.scheduled) {
        // The season receipt may predate this job. Recovery also requires the
        // exact plan advancement calculated before this worker started, while
        // the shared write gate is still held.
        if (!scheduleCommit) return null
        const schedule = getDb().prepare(`SELECT auto_enabled, freeze_enabled, settle_at_ms,
            repeat_interval_ms, updated_at_ms FROM leaderboard_settlement_configs WHERE competition_key=?`)
            .get(input.competitionKey) as {
                auto_enabled: number; freeze_enabled: number; settle_at_ms: number | null;
                repeat_interval_ms: number | null; updated_at_ms: number
            } | undefined
        if (!schedule || schedule.auto_enabled !== Number(scheduleCommit.autoEnabled)
            || schedule.freeze_enabled !== Number(scheduleCommit.freezeEnabled)
            || schedule.settle_at_ms !== scheduleCommit.settleAtMs
            || schedule.repeat_interval_ms !== scheduleCommit.repeatIntervalMs
            || schedule.updated_at_ms !== scheduleCommit.updatedAtMs) return null
    }
    const row = getDb().prepare(`SELECT id, ranked_players, rewarded_players
        FROM leaderboard_settlements WHERE competition_key=? AND season=? AND status='completed'`)
        .get(input.competitionKey, input.season) as { id: number; ranked_players: number; rewarded_players: number } | undefined
    return row ? { ok: true, competitionKey: input.competitionKey, season: input.season,
        settlementId: row.id, rankedPlayers: row.ranked_players, rewardedPlayers: row.rewarded_players,
        reason: "already-settled" } : null
}

/** Called inside the shared one-job leaderboard control, never inside a DB transaction. */
export async function runLeaderboardSettlementInBackground(
    job: LeaderboardSettlementJob,
    workerOptions: Parameters<typeof executeLeaderboardSettlementWorker>[1] = {},
): Promise<SettlementOutcome | null> {
    if (job.expectedSeason !== undefined && (!Number.isSafeInteger(job.expectedSeason) || job.expectedSeason < 1)) {
        return Promise.reject(Object.assign(new Error("expectedSeason must be a positive safe integer."), { statusCode: 400 }))
    }
    return runBackgroundPersistenceTask({ domain: "leaderboard", operation: "background_settlement" }, async ({ input, scheduleCommit }) => {
        try { return await executeLeaderboardSettlementWorker(input, workerOptions) }
        catch (error) {
            if (!(error instanceof SettlementWorkerFailure) || !error.commitMayHaveSucceeded) throw error
            // The worker has exited. Resolve an unknown COMMIT from durable
            // awards and, for scheduled work, this job's plan advancement.
            const committed = committedOutcome(input, scheduleCommit)
            if (committed) return committed
            throw error
        }
    }, () => {
        // Small initialization writes stay on the schema-owning connection.
        // Manual commands capture real time after waiting for prior writes;
        // scheduled jobs retain the explicit tick timestamp they were given.
        const nowMs = job.nowMs ?? Date.now()
        const season = getLeaderboardCompetitionSeasonSync(job.competitionKey, nowMs)
        if (job.expectedSeason !== undefined && season !== job.expectedSeason) {
            throw new LeaderboardSeasonMismatchError(job.expectedSeason, season)
        }
        const config = getLeaderboardSettlementConfigSync(job.competitionKey, nowMs)
        getLeaderboardAvailabilitySync(job.competitionKey, nowMs)
        const databasePath = getDb().name
        if (!databasePath || databasePath === ":memory:") throw new Error("Background settlement requires a file-backed database.")
        return { input: { ...job, nowMs, season, databasePath }, scheduleCommit: expectedScheduleCommit(job, config, nowMs) }
    }, assertJobsNotCancelled)
}
