import Database from "better-sqlite3"
import { parentPort, workerData } from "worker_threads"

interface CleanupWorkerData {
    jobId: string
    databasePath: string
    accountIds: number[]
    batchSize: number
}

interface ExistingAccountRow {
    id: number
}

interface PlayerRow {
    id: number
    account_id: number
}

interface PlannedCleanupEntry {
    accountId: number
    playerIds: number[]
}

const input = workerData as CleanupWorkerData

function send(message: Record<string, unknown>): void {
    parentPort?.postMessage({ jobId: input.jobId, ...message })
}

function main(): void {
    // This worker is intentionally read-only.  It may scan and prepare the
    // cleanup plan, but the main process remains the sole writer of
    // wdfp_data.db so gameplay settlement cannot contend with another SQLite
    // connection created by the administration feature.
    const database = new Database(input.databasePath, {
        readonly: true,
        fileMustExist: true,
    })

    try {
        send({ type: "phase", phase: "planning" })
        const plannedEntries: PlannedCleanupEntry[] = []
        for (let offset = 0; offset < input.accountIds.length; offset += input.batchSize) {
            const requestedIds = input.accountIds.slice(offset, offset + input.batchSize)
            if (requestedIds.length === 0) continue
            const placeholders = requestedIds.map(() => "?").join(", ")
            const existingAccounts = database.prepare(
                `SELECT id FROM accounts WHERE id IN (${placeholders})`,
            ).all(...requestedIds) as ExistingAccountRow[]
            const players = database.prepare(
                `SELECT id, account_id FROM players WHERE account_id IN (${placeholders})`,
            ).all(...requestedIds) as PlayerRow[]
            for (const account of existingAccounts) {
                plannedEntries.push({
                    accountId: account.id,
                    playerIds: players
                        .filter(player => player.account_id === account.id)
                        .map(player => player.id),
                })
            }
        }
        send({ type: "plan", plannedEntries })
    } finally {
        database.close()
    }
}

try {
    main()
} catch (error) {
    send({
        type: "failed",
        error: error instanceof Error ? error.message : String(error),
    })
    process.exitCode = 1
}
