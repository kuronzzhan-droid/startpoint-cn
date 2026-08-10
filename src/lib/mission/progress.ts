export function addMissionProgressDelta(current: number, delta: number): number | null {
    if (!Number.isSafeInteger(delta) || delta <= 0) return null
    if (!Number.isSafeInteger(current) || current < 0) current = 0
    const next = current + delta
    return Number.isSafeInteger(next) ? next : null
}
