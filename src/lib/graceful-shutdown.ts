export function shutdownDeadlines(timeoutMs: number) {
    const totalMs = Math.max(5_000, Number.isFinite(timeoutMs) ? timeoutMs : 180_000)
    return {
        totalMs,
        cancelAtMs: totalMs - Math.min(30_000, totalMs / 3),
        terminateAtMs: totalMs - Math.min(15_000, totalMs / 6),
    }
}

interface ShutdownOptions {
    timeoutMs: number
    quiesce(): void
    close(): Promise<void>
    cancel(): void
    terminate(): Promise<void>
    failed(error: unknown): void
    logger?: Pick<Console, "log" | "warn" | "error">
}

/** One absolute deadline; worker runtime limits continue from their original start. */
export function createGracefulShutdown(options: ShutdownOptions) {
    const logger = options.logger ?? console
    const deadlines = shutdownDeadlines(options.timeoutMs)
    let pending: Promise<void> | null = null
    return (source: string): Promise<void> => {
        if (pending) return pending
        // Withdraw admission/readiness and stop all producers before the first
        // await (Fastify may wait for active HTTP requests before onClose).
        let quiesceFailed = false, quiesceError: unknown
        try { options.quiesce() }
        catch (error) { quiesceFailed = true; quiesceError = error }
        logger.warn(`[SHUTDOWN] ${source} received; draining accepted work (deadline=${deadlines.totalMs}ms)`)
        pending = (async () => {
            let hardTimeout: NodeJS.Timeout | undefined
            const cancelTimeout = setTimeout(() => {
                logger.warn("[SHUTDOWN] drain reserve reached; requesting leaderboard rollback")
                options.cancel()
            }, deadlines.cancelAtMs)
            const terminateTimeout = setTimeout(() => {
                logger.warn("[SHUTDOWN] rollback reserve reached; terminating remaining leaderboard workers")
                void options.terminate().catch(error => logger.error("[SHUTDOWN] worker termination failed", error))
            }, deadlines.terminateAtMs)
            try {
                await Promise.race([
                    options.close(),
                    new Promise<never>((_, reject) => {
                        hardTimeout = setTimeout(() => reject(new Error(
                            `graceful shutdown timed out after ${deadlines.totalMs}ms`,
                        )), deadlines.totalMs)
                    }),
                ])
                if (quiesceFailed) throw quiesceError
                logger.log("[SHUTDOWN] graceful shutdown complete")
            } catch (error) {
                logger.error(`[SHUTDOWN] graceful shutdown failed: ${error instanceof Error ? error.message : String(error)}`)
                options.failed(error)
            } finally {
                clearTimeout(cancelTimeout)
                clearTimeout(terminateTimeout)
                if (hardTimeout) clearTimeout(hardTimeout)
            }
        })()
        return pending
    }
}
