/** Production config is selected before listeners start; embedded is an explicit local mode. */
export function isRealtimeOwnerChild(): boolean { return process.env.MULTI_REALTIME_OWNER_CHILD === "1" }
export function isRealtimeParent(): boolean {
    return !isRealtimeOwnerChild() && process.env.MULTI_REALTIME_PROCESS === "1"
}
export function assertRealtimeAuthority(): void {
    if (isRealtimeParent()) throw new Error("REALTIME_STATE_BELONGS_TO_CHILD")
}
