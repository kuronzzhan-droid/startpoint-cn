import { AsyncLocalStorage } from "node:async_hooks"

export class ServerClosingError extends Error {
    readonly statusCode = 503
    readonly code = "SERVER_CLOSING"
    constructor() { super("服务器正在关闭，请稍后重试。") }
}

/** Admission is sticky; only work accepted before close may enqueue its remaining writes. */
export function createServerShutdownState() {
    const context = new AsyncLocalStorage<{ active: boolean }>()
    const pending = new Set<Promise<unknown>>()
    let closing = false
    const assertAccepting = () => {
        if (closing && !context.getStore()?.active) throw new ServerClosingError()
    }
    const run = <T>(operation: () => T, cleanup = false): T => {
        if (!cleanup) assertAccepting()
        // Each child holds its own lifetime: an accepted queued write must not
        // lose admission when a caller returns without awaiting that write.
        const token = { active: true }
        return context.run(token, () => {
            let result: T
            try { result = operation() }
            catch (error) { token.active = false; throw error }
            if (result && typeof (result as { then?: unknown }).then === "function") {
                const tracked = Promise.resolve(result).finally(() => {
                    token.active = false
                    pending.delete(tracked)
                })
                pending.add(tracked)
                return tracked as T
            }
            token.active = false
            return result
        })
    }
    return {
        isClosing: () => closing,
        hasAdmission: () => context.getStore()?.active === true,
        beginClosing: () => { closing = true },
        assertAccepting,
        run: <T>(operation: () => T): T => run(operation),
        cleanup: <T>(operation: () => T): T => run(operation, true),
        async drain(): Promise<void> {
            // Accepted parents can add children after awaits. Wait for a stable
            // empty set rather than one snapshot of the persistence queue tail.
            while (pending.size) await Promise.allSettled([...pending])
        },
    }
}

const state = createServerShutdownState()
export const isServerShuttingDown = state.isClosing
export const hasServerWorkAdmission = state.hasAdmission
export const beginServerShutdown = state.beginClosing
export const assertServerAcceptingWork = state.assertAccepting
export const withServerWorkAdmission = state.run
export const withShutdownCleanup = state.cleanup
export const drainServerWork = state.drain
