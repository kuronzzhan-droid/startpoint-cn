import { PersistenceMaintenanceBusyError } from "./persistence-admission"

type SynchronousResult<T> = T extends PromiseLike<unknown> ? never : T
type WaitingWrite = {
    exclusive: boolean
    kind: "acquire"
    resolve: (release: () => void) => void
} | {
    exclusive: true
    kind: "synchronous"
    operation: () => unknown
    resolve: (value: unknown) => void
    reject: (error: unknown) => void
}

/** Admission bounds the waiters; this gate orders native writes across threads. */
export function createPersistenceWriteGate() {
    let readers = 0, exclusive = false
    const waiting: WaitingWrite[] = []
    function pump(): void {
        if (exclusive) return
        while (waiting.length > 0) {
            const next = waiting[0]!
            if (next.exclusive && readers > 0) return
            waiting.shift()
            if (next.kind === "synchronous") {
                // Never publish an exclusive grant to a promise continuation:
                // legacy synchronous callers cannot queue behind such a grant.
                // This callback owns exclusivity only inside this call stack.
                exclusive = true
                let value: unknown, error: unknown, failed = false
                try { value = next.operation() }
                catch (cause) { failed = true; error = cause }
                finally { exclusive = false }
                if (failed) next.reject(error)
                else next.resolve(value)
                continue
            }
            if (next.exclusive) exclusive = true
            else readers++
            let released = false
            next.resolve(() => {
                if (released) return
                released = true
                if (next.exclusive) exclusive = false
                else readers--
                pump()
            })
            if (exclusive) return
        }
    }
    return {
        acquire(exclusive: boolean): Promise<() => void> {
            return new Promise(resolve => { waiting.push({ exclusive, kind: "acquire", resolve }); pump() })
        },
        /** The callback must finish synchronously; it must not wait for worker ACKs. */
        runExclusiveSync<T>(operation: () => T & SynchronousResult<T>): Promise<T> {
            return new Promise<T>((resolve, reject) => {
                waiting.push({ exclusive: true, kind: "synchronous", operation,
                    resolve: value => resolve(value as T), reject })
                pump()
            })
        },
        assertSynchronousWriteAllowed(): void {
            if (exclusive) throw new PersistenceMaintenanceBusyError()
        },
        stats: () => ({ activeWrites: readers, exclusive, waiting: waiting.length }),
    }
}

export const persistenceWriteGate = createPersistenceWriteGate()
