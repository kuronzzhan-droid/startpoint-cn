import { PersistenceMaintenanceBusyError } from "./persistence-admission"

/** Admission bounds the waiters; this gate orders native writes across threads. */
export function createPersistenceWriteGate() {
    let readers = 0, exclusive = false
    const waiting: Array<{ exclusive: boolean; resolve: (release: () => void) => void }> = []
    function pump(): void {
        if (exclusive) return
        while (waiting.length > 0) {
            const next = waiting[0]!
            if (next.exclusive && readers > 0) return
            waiting.shift()
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
            return new Promise(resolve => { waiting.push({ exclusive, resolve }); pump() })
        },
        assertSynchronousWriteAllowed(): void {
            if (exclusive) throw new PersistenceMaintenanceBusyError()
        },
        stats: () => ({ activeWrites: readers, exclusive, waiting: waiting.length }),
    }
}

export const persistenceWriteGate = createPersistenceWriteGate()
