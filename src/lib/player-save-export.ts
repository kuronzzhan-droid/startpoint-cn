import { existsSync } from "./file-exists";

import path from "path"
import { Worker } from "worker_threads"
import { getDatabaseDirectory } from "./admin-database-backup"
import { assertServerAcceptingWork, ServerClosingError } from "./shutdown-state"

export const DEFAULT_PLAYER_SAVE_EXPORT_MAX_BYTES = 64 * 1024 * 1024
const DEFAULT_PLAYER_SAVE_EXPORT_TIMEOUT_MS = 120_000

export type PlayerSaveExportErrorCode = "busy" | "aborted" | "timeout" | "too-large" | "export-failed"

export class PlayerSaveExportError extends Error {
    constructor(
        public readonly code: PlayerSaveExportErrorCode,
        message: string,
    ) {
        super(message)
        this.name = "PlayerSaveExportError"
    }
}

export interface PlayerSaveExportOptions {
    signal?: AbortSignal
    maxBytes?: number
    timeoutMs?: number
}

export interface PlayerSaveExportResult {
    payload: Buffer
    rowCount: number
}

interface WorkerMessage {
    type?: string
    code?: PlayerSaveExportErrorCode
    error?: string
    payload?: ArrayBuffer
    byteLength?: number
    rowCount?: number
}

let activeExportWorker: Worker | null = null
let activeExportExit: Promise<void> | null = null
let stopping = false

/** Response completion is separate from worker lifetime; close waits for actual exit. */
export async function drainPlayerSaveExports(): Promise<void> {
    while (activeExportExit) await activeExportExit
}

export async function closePlayerSaveExports(): Promise<void> {
    stopping = true
    await drainPlayerSaveExports()
}

/** Used by the shutdown budget's cancellation stage, never a substitute for exit. */
export async function stopPlayerSaveExports(): Promise<void> {
    stopping = true
    const worker = activeExportWorker
    try { if (worker) await worker.terminate() }
    finally { await drainPlayerSaveExports() }
}

function getWorkerLocation(): { filename: string; execArgv?: string[] } {
    const compiledWorker = path.resolve(__dirname, "../workers/player-save-export-worker.js")
    if (existsSync(compiledWorker)) return { filename: compiledWorker }
    return {
        filename: path.resolve(__dirname, "../workers/player-save-export-worker.ts"),
        execArgv: ["-r", require.resolve("ts-node/register/transpile-only")],
    }
}

function normalizeLimit(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
    if (value === undefined || !Number.isFinite(value)) return fallback
    return Math.max(minimum, Math.min(maximum, Math.trunc(value)))
}

export async function exportPlayerSaveInWorker(
    playerId: number,
    options: PlayerSaveExportOptions = {},
): Promise<PlayerSaveExportResult> {
    if (stopping) throw new ServerClosingError()
    assertServerAcceptingWork()
    if (!Number.isSafeInteger(playerId) || playerId < 1) {
        throw new PlayerSaveExportError("export-failed", "玩家 ID 无效")
    }
    if (options.signal?.aborted) {
        throw new PlayerSaveExportError("aborted", "客户端已取消存档导出")
    }
    if (activeExportWorker !== null) {
        throw new PlayerSaveExportError("busy", "已有一个存档正在导出，请稍后再试")
    }

    const maxBytes = normalizeLimit(
        options.maxBytes,
        DEFAULT_PLAYER_SAVE_EXPORT_MAX_BYTES,
        1,
        DEFAULT_PLAYER_SAVE_EXPORT_MAX_BYTES,
    )
    const configuredTimeout = Number.parseInt(process.env.PLAYER_SAVE_EXPORT_TIMEOUT_MS ?? "", 10)
    const timeoutMs = normalizeLimit(
        options.timeoutMs,
        Number.isFinite(configuredTimeout) ? configuredTimeout : DEFAULT_PLAYER_SAVE_EXPORT_TIMEOUT_MS,
        1_000,
        10 * 60_000,
    )
    const workerLocation = getWorkerLocation()
    const worker = new Worker(workerLocation.filename, {
        execArgv: workerLocation.execArgv,
        workerData: {
            databasePath: path.join(getDatabaseDirectory(), "wdfp_data.db"),
            playerId,
            maxBytes,
        },
    })
    activeExportWorker = worker
    activeExportExit = new Promise<void>(resolve => {
        worker.once("exit", () => {
            if (activeExportWorker === worker) {
                activeExportWorker = null
                activeExportExit = null
            }
            resolve()
        })
    })

    return new Promise<PlayerSaveExportResult>((resolve, reject) => {
        let settled = false
        let result: PlayerSaveExportResult | undefined
        let failure: PlayerSaveExportError | undefined
        let terminating = false
        const finish = (callback: () => void): void => {
            if (settled) return
            settled = true
            clearTimeout(timeout)
            options.signal?.removeEventListener("abort", onAbort)
            callback()
        }
        const fail = (code: PlayerSaveExportErrorCode, message: string): void => {
            if (!failure) failure = new PlayerSaveExportError(code, message)
        }
        const terminate = (): void => {
            if (terminating) return
            terminating = true
            // An unsuccessful terminate cannot release the active slot; the
            // actual exit observer remains responsible for releasing it.
            void worker.terminate().catch(() => {})
        }
        const onAbort = (): void => {
            fail("aborted", "客户端已取消存档导出")
            terminate()
        }
        const timeout = setTimeout(() => {
            fail("timeout", `存档导出超过 ${timeoutMs / 1000} 秒，已终止`)
            terminate()
        }, timeoutMs)
        timeout.unref()
        options.signal?.addEventListener("abort", onAbort, { once: true })

        worker.once("message", (message: WorkerMessage) => {
            if (message.type === "completed" && message.payload instanceof ArrayBuffer) {
                const payload = Buffer.from(message.payload, 0, message.byteLength ?? message.payload.byteLength)
                result = {
                    payload,
                    rowCount: Number(message.rowCount) || 0,
                }
                return
            }
            fail(message.code ?? "export-failed", message.error ?? "存档导出 worker 返回了无效结果")
        })
        worker.once("error", error => {
            fail("export-failed", error instanceof Error ? error.message : String(error))
            terminate()
        })
        worker.once("exit", code => {
            if (!failure && (!result || code !== 0)) fail("export-failed", `存档导出 worker 未成功结束（code=${code}）`)
            finish(() => failure ? reject(failure) : resolve(result!))
        })
    })
}
