import type { MultiRoom } from "../types"

// A durable-start decision pins the frozen owner instance until explicit reconciliation.
// Timeout does not release an uncertain transaction or authorize a replacement run.
const pins = new WeakMap<MultiRoom, Set<string>>()
const deferred = new WeakMap<MultiRoom, Array<() => void>>()
/** Legacy scene controls have no epoch. Keep their TCP order until the durable start resolves. */
export function deferPinnedRoomControl(room: MultiRoom, apply: () => void): boolean {
    if (!hasRoomStartClaims(room)) return false
    let queue = deferred.get(room)
    if (!queue) deferred.set(room, queue = [])
    if (queue.length >= 64) throw new Error("START_CONTROL_QUEUE_LIMIT")
    queue.push(apply)
    return true
}
export function pinRoomStart(room: MultiRoom, token: string): void {
    let current = pins.get(room)
    if (!current) pins.set(room, current = new Set())
    current.add(token)
}
export function unpinRoomStart(room: MultiRoom, token: string): void {
    const current = pins.get(room)
    current?.delete(token)
    if (!current?.size) {
        pins.delete(room)
        const queue = deferred.get(room)
        deferred.delete(room)
        for (const apply of queue ?? []) {
            try { apply() }
            catch (error) { console.error("[MULTI-REALTIME] deferred start control failed", error) }
        }
    }
}
export function hasRoomStartClaims(room: MultiRoom): boolean { return !!pins.get(room)?.size }
