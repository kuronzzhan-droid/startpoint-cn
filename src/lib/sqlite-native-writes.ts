/** Native work outlives a caller deadline until its final reply or thread exit. */
export function createNativeSqliteWriteRegistry(): {
    acquire: () => () => void
    activeCount: () => number
    onIdle: (listener: () => void) => () => void
} {
    let active = 0
    const listeners = new Set<() => void>()
    return {
        acquire: () => {
            active++
            let released = false
            return () => {
                if (released) return
                released = true
                active--
                if (active === 0) for (const listener of [...listeners]) listener()
            }
        },
        activeCount: () => active,
        onIdle: listener => {
            listeners.add(listener)
            return () => { listeners.delete(listener) }
        },
    }
}

export const nativeSqliteWrites = createNativeSqliteWriteRegistry()
