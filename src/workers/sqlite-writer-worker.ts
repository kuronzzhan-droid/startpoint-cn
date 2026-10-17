import { performance } from "node:perf_hooks"
import { parentPort, workerData } from "node:worker_threads"
import type { Database } from "better-sqlite3"
import { setDbOverride } from "../data/db"
import { installWorkerMemoryProbe } from "../lib/memory-diagnostics"
import {
    getWriterCommand,
    type WriterCommandContext,
    type WriterCommandMeta,
} from "../lib/persistence/command-registry"
import { openWriterConnection } from "../lib/persistence/writer-connection"
import { WRITER_PROTOCOL_VERSION } from "../lib/persistence/writer-config"
import { setServerTimeOffset, getLegacyTimeOffset, withServerClock } from "../utils"

export interface WriterWorkerInput {
    databasePath: string
    busyTimeoutMs: number
    groupCommitWindowMs: number
    groupCommitMax: number
    protocolVersion: number
}

interface WriterCommandMessage {
    type: "command"
    id: number
    name: string
    args: unknown
    meta: WriterCommandMeta
}

type WriterWorkerMessage =
    | WriterCommandMessage
    | { type: "close" }
    | { type: "checkpoint_owner", external: boolean }
    | { type: "set_time_offset", offset: number | null }

interface QueuedCommand extends WriterCommandMessage {
    receivedAt: number
}

interface BatchOutcome {
    id: number
    ok: boolean
    value?: unknown
    error?: string
    code?: string | null
}

interface BatchResult {
    outcomes: BatchOutcome[]
    commitMs: number
    /** Number of commands rolled back through their own savepoint. */
    rollbacks: number
}

const input = workerData as WriterWorkerInput
if (input?.protocolVersion !== WRITER_PROTOCOL_VERSION) {
    throw new Error(
        `SQLite writer worker protocol mismatch: worker=${input?.protocolVersion} expected=${WRITER_PROTOCOL_VERSION}`,
    )
}

let database: Database | null = null
let running = false
let closeRequested = false
let closed = false
const queue: QueuedCommand[] = []

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
}

installWorkerMemoryProbe(() => ({
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
}))

function delay(milliseconds: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, milliseconds))
}

function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

function errorCodeOf(error: unknown): string | null {
    if (!(error instanceof Error) || !("code" in error)) return null
    const code = (error as Error & { code?: string }).code
    return typeof code === "string" ? code : null
}

function post(message: Record<string, unknown>): void {
    try {
        parentPort?.postMessage(message)
    } catch (error) {
        // The port can be gone while the main thread is shutting down. Never
        // let reporting failure abort a batch that already committed.
        console.error("[WRITER] failed to post worker message", messageOf(error))
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
function executeBatch(batch: QueuedCommand[]): BatchResult {
    const connection = database
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
        }
    }

    const startedAt = performance.now()
    const outcomes: BatchOutcome[] = []
    const effects: Array<() => void> = []
    let rollbacks = 0
    let begun = false
    try {
        connection.exec("BEGIN IMMEDIATE")
        begun = true
        for (const command of batch) {
            const handler = getWriterCommand(command.name)
            if (handler === undefined) {
                stats.unknownCommands++
                outcomes.push({
                    id: command.id,
                    ok: false,
                    error: `Unknown writer command: ${command.name}`,
                    code: null,
                })
                continue
            }
            const savepoint = `sp_${command.id}`
            const commandEffects: Array<() => void> = []
            const context: WriterCommandContext = {
                meta: command.meta,
                afterCommit: effect => {
                    if (typeof effect === "function") commandEffects.push(effect)
                },
            }
            connection.exec(`SAVEPOINT ${savepoint}`)
            try {
                const offset = getLegacyTimeOffset() ?? 0
                const value = withServerClock(Date.now() + offset, () => handler(command.args, context), offset)
                // Clone before COMMIT: a result that cannot cross the thread
                // boundary must roll the command back instead of committing a
                // write whose caller will only ever see an error.
                const transportValue = structuredClone(value)
                connection.exec(`RELEASE ${savepoint}`)
                outcomes.push({ id: command.id, ok: true, value: transportValue })
                effects.push(...commandEffects)
            } catch (error) {
                try { connection.exec(`ROLLBACK TO ${savepoint}`) } catch { /* keep going: the command already failed */ }
                try { connection.exec(`RELEASE ${savepoint}`) } catch { /* the savepoint is gone with the rollback */ }
                stats.savepointRollbacks++
                rollbacks++
                outcomes.push({
                    id: command.id,
                    ok: false,
                    error: messageOf(error),
                    code: errorCodeOf(error),
                })
            }
        }
        connection.exec("COMMIT")
    } catch (error) {
        if (begun) {
            try { connection.exec("ROLLBACK") } catch { /* SQLite already rolled the transaction back */ }
        }
        stats.failed += batch.length
        const reason = messageOf(error)
        const code = errorCodeOf(error)
        return {
            outcomes: batch.map(command => ({ id: command.id, ok: false, error: reason, code })),
            commitMs: performance.now() - startedAt,
            rollbacks,
        }
    }

    const commitMs = performance.now() - startedAt
    stats.batches++
    stats.batchedCommands += batch.length
    stats.maxBatch = Math.max(stats.maxBatch, batch.length)
    stats.commitMsTotal += commitMs
    stats.commitMsMax = Math.max(stats.commitMsMax, commitMs)
    for (const outcome of outcomes) {
        if (outcome.ok) stats.completed++
        else stats.failed++
    }

    // Non-durable side effects run only after the commit succeeded. Effects of
    // a rolled-back command were never collected.
    for (const effect of effects) {
        try {
            effect()
        } catch (error) {
            stats.afterCommitFailures++
            console.error("[WRITER] afterCommit effect failed", messageOf(error))
        }
    }
    return { outcomes, commitMs, rollbacks }
}

function dispatch(outcomes: BatchOutcome[]): void {
    for (const outcome of outcomes) {
        if (outcome.ok) {
            post({ type: "result", id: outcome.id, value: outcome.value })
        } else {
            post({ type: "error", id: outcome.id, error: outcome.error, code: outcome.code ?? null })
        }
    }
}

function finishCloseIfDrained(): void {
    if (!closeRequested || closed || running || queue.length > 0) return
    closed = true
    const connection = database
    database = null
    try { connection?.close() } catch (error) { console.error("[WRITER] close failed", messageOf(error)) }
    post({ type: "closed" })
}

function schedule(): void {
    if (running || closed || database === null) return
    running = true
    void (async () => {
        try {
            while (!closed && queue.length > 0) {
                const batch = queue.splice(0, input.groupCommitMax)
                if (batch.length < input.groupCommitMax && input.groupCommitWindowMs > 0 && !closeRequested) {
                    // Group-commit window: give other callers a chance to join
                    // this transaction instead of paying another durable commit.
                    await delay(input.groupCommitWindowMs)
                    while (queue.length > 0 && batch.length < input.groupCommitMax) {
                        batch.push(queue.shift()!)
                    }
                }
                const result = executeBatch(batch)
                // Report the batch before the per-command outcomes so callers
                // that await a command always observe the batch statistics for
                // the transaction that committed their write.
                post({
                    type: "batch",
                    size: batch.length,
                    commitMs: result.commitMs,
                    rollbacks: result.rollbacks,
                })
                dispatch(result.outcomes)
            }
        } catch (error) {
            // executeBatch already converts failures into per-command outcomes.
            // Reaching here means the worker itself is unhealthy.
            console.error("[WRITER] batch loop failed", messageOf(error))
        } finally {
            running = false
            if (queue.length > 0 && !closed) schedule()
            else finishCloseIfDrained()
        }
    })()
}

function handleMessage(raw: unknown): void {
    if (!raw || typeof raw !== "object" || !("type" in raw)) return
    const message = raw as WriterWorkerMessage
    switch (message.type) {
        case "checkpoint_owner":
            try {
                database?.pragma(`wal_autocheckpoint = ${message.external ? 0 : 1000}`)
            } catch (error) {
                console.error("[WRITER] checkpoint ownership handoff failed", messageOf(error))
            }
            return
        case "set_time_offset":
            // Both threads must evaluate the same virtual clock: commands that
            // settle player progress run here, and their timestamps were
            // previously read with this thread's own (null) offset.
            setServerTimeOffset(
                typeof message.offset === "number" && Number.isFinite(message.offset)
                    ? message.offset : null,
            )
            return
        case "close":
            closeRequested = true
            finishCloseIfDrained()
            return
        case "command":
            queue.push({ ...message, receivedAt: performance.now() })
            schedule()
            return
        default:
            // Diagnostics such as the memory probe have their own listeners on
            // this port. Anything that is not a command must never enter the
            // write queue: an unknown message would otherwise be executed as a
            // failed transaction on every probe.
            return
    }
}

async function main(): Promise<void> {
    const connection = openWriterConnection({
        databasePath: input.databasePath,
        busyTimeoutMs: input.busyTimeoutMs,
    })
    database = connection
    // Domain modules resolve getDb() lazily, so pointing the override at the
    // writer connection before the command implementations load is enough for
    // the identical domain code to run inside this thread.
    setDbOverride(connection)
    await import("../lib/persistence/commands")
    // Optional extra registration hook. Used by the writer tests (and any
    // future module that must run inside the writer thread) so a suite can
    // exercise the transport without depending on mission data.
    const extraCommands = process.env.SQLITE_WRITER_EXTRA_COMMANDS?.trim()
    if (extraCommands) {
        await import(extraCommands)
    }
    parentPort?.on("message", handleMessage)
    // Commands may only be dispatched once every implementation is registered.
    post({ type: "ready", protocolVersion: WRITER_PROTOCOL_VERSION })
}

void main().catch(error => {
    const reason = messageOf(error)
    post({ type: "fatal", error: reason })
    console.error("[WRITER] startup failed", reason)
    process.exit(1)
})
