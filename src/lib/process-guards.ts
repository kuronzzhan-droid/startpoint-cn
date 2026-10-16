/**
 * Process-level guards for the CN server.
 *
 * Since Node 15 an unhandled promise rejection terminates the process, which
 * drops every connected player at once. A rejection only means one async task
 * failed without a handler; the event loop and all other state are intact, so
 * it is logged with its stack and the server keeps running.
 *
 * An uncaught synchronous exception is different: it unwinds through code
 * that may have left shared state half-updated, and Node documents that
 * resuming afterwards is unsafe. It is logged and then the caller-provided
 * graceful shutdown runs (Fastify close hooks drain realtime and persistence
 * work), exiting with code 1 instead of the abrupt default exit.
 */

export interface ProcessGuardOptions {
    /** Invoked once on the first uncaught exception; must eventually exit. */
    readonly onFatal: (reason: string) => void
    /** Full stack logs per window before only a suppressed count is printed. */
    readonly rejectionLogLimit?: number
    readonly rejectionLogWindowMs?: number
    readonly log?: (message: string) => void
    readonly now?: () => number
    readonly target?: Pick<NodeJS.Process, "on" | "off">
}

export interface ProcessGuardStats {
    unhandledRejections: number
    uncaughtExceptions: number
}

export interface InstalledProcessGuards {
    readonly stats: Readonly<ProcessGuardStats>
    uninstall(): void
}

export function describeFailure(value: unknown): string {
    if (value instanceof Error) return value.stack || `${value.name}: ${value.message}`
    if (typeof value === "string") return value
    try {
        return `non-error value: ${JSON.stringify(value)}`
    } catch {
        return `non-error value: ${String(value)}`
    }
}

export function installProcessGuards(options: ProcessGuardOptions): InstalledProcessGuards {
    const target = options.target ?? process
    const log = options.log ?? ((message: string) => console.error(message))
    const now = options.now ?? Date.now
    const limit = Math.max(1, options.rejectionLogLimit ?? 20)
    const windowMs = Math.max(1, options.rejectionLogWindowMs ?? 60_000)
    const stats: ProcessGuardStats = { unhandledRejections: 0, uncaughtExceptions: 0 }
    let windowStart = now()
    let loggedInWindow = 0
    let suppressedInWindow = 0
    let fatalRequested = false

    const onRejection = (reason: unknown) => {
        stats.unhandledRejections++
        const current = now()
        if (current - windowStart >= windowMs) {
            if (suppressedInWindow > 0) {
                log(`[PROCESS] unhandledRejection: ${suppressedInWindow} further rejection(s) not logged in the previous window`)
            }
            windowStart = current
            loggedInWindow = 0
            suppressedInWindow = 0
        }
        if (loggedInWindow >= limit) {
            suppressedInWindow++
            return
        }
        loggedInWindow++
        log(`[PROCESS] unhandledRejection (total ${stats.unhandledRejections}); server keeps running: ${describeFailure(reason)}`)
    }

    const onException = (error: unknown, origin?: string) => {
        stats.uncaughtExceptions++
        log(`[PROCESS] uncaughtException${origin ? ` (${origin})` : ""}; starting graceful shutdown: ${describeFailure(error)}`)
        if (fatalRequested) return
        fatalRequested = true
        options.onFatal("uncaughtException")
    }

    target.on("unhandledRejection", onRejection)
    target.on("uncaughtException", onException)
    return {
        stats,
        uninstall() {
            target.off("unhandledRejection", onRejection)
            target.off("uncaughtException", onException)
        },
    }
}
