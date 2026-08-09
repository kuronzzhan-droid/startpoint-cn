export interface MatePlayerResult {
    viewer_id: number
    com_id: number
    score: number
    contribution_score: number
}

export interface SettlementParticipant {
    viewerId: number
    comId: number
}

interface SettlementSnapshot {
    participants: SettlementParticipant[]
    expectedRealViewerIds: Set<number>
    results: Map<number, MatePlayerResult>
    selfReportedViewerIds: Set<number>
    waiters: Set<() => void>
    cleanupTimer: NodeJS.Timeout
}

export interface SettlementMergeResult {
    mateResults: MatePlayerResult[]
    synthesizedViewerIds: number[]
    submittedCount: number
    expectedCount: number
}

const snapshots = new Map<string, SettlementSnapshot>()

function finiteNumber(value: unknown, fallback = 0): number {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : fallback
}

function normalizeResult(value: any): MatePlayerResult | null {
    const viewerId = finiteNumber(value?.viewer_id, 0)
    if (viewerId <= 0) return null
    return {
        viewer_id: viewerId,
        com_id: finiteNumber(value?.com_id, 0),
        score: finiteNumber(value?.score, 0),
        contribution_score: finiteNumber(value?.contribution_score, 0),
    }
}

function mergeParticipants(
    current: SettlementParticipant[],
    incoming: SettlementParticipant[],
): SettlementParticipant[] {
    const merged = new Map<number, SettlementParticipant>()
    for (const participant of [...current, ...incoming]) {
        const viewerId = finiteNumber(participant?.viewerId, 0)
        if (viewerId <= 0) continue
        const comId = finiteNumber(participant?.comId, 0)
        const previous = merged.get(viewerId)
        merged.set(viewerId, {
            viewerId,
            comId: previous?.comId || comId,
        })
    }
    return [...merged.values()]
}

function createSnapshot(
    key: string,
    participants: SettlementParticipant[],
    expectedRealViewerIds: number[],
): SettlementSnapshot {
    const expected = expectedRealViewerIds
        .map(viewerId => finiteNumber(viewerId, 0))
        .filter(viewerId => viewerId > 0)
    const mergedParticipants = mergeParticipants(
        participants,
        expected.map(viewerId => ({ viewerId, comId: 0 })),
    )
    const snapshot: SettlementSnapshot = {
        participants: mergedParticipants,
        expectedRealViewerIds: new Set(expected),
        results: new Map(),
        selfReportedViewerIds: new Set(),
        waiters: new Set(),
        cleanupTimer: setTimeout(() => {}, 1),
    }
    clearTimeout(snapshot.cleanupTimer)
    snapshot.cleanupTimer = setTimeout(() => {
        if (snapshots.get(key) === snapshot) snapshots.delete(key)
    }, 120_000)
    snapshot.cleanupTimer.unref()
    snapshots.set(key, snapshot)
    return snapshot
}

function isComplete(snapshot: SettlementSnapshot): boolean {
    if (snapshot.expectedRealViewerIds.size <= 1) return true
    for (const viewerId of snapshot.expectedRealViewerIds) {
        if (!snapshot.selfReportedViewerIds.has(viewerId)) return false
    }
    return true
}

function releaseWaiters(snapshot: SettlementSnapshot): void {
    if (!isComplete(snapshot)) return
    for (const resolve of snapshot.waiters) resolve()
    snapshot.waiters.clear()
}

async function waitForPeers(snapshot: SettlementSnapshot, waitMs: number): Promise<void> {
    if (isComplete(snapshot) || waitMs <= 0) return
    await new Promise<void>(resolve => {
        let completed = false
        const finish = () => {
            if (completed) return
            completed = true
            clearTimeout(timer)
            snapshot.waiters.delete(finish)
            resolve()
        }
        const timer = setTimeout(finish, waitMs)
        timer.unref()
        snapshot.waiters.add(finish)
    })
}

/**
 * Builds one server-authoritative settlement roster for every client in a
 * battle. Clients are still allowed to provide score/contribution data, but a
 * locally missing mate can no longer disappear from the result screen.
 */
export async function mergeMultiSettlementResults(input: {
    key: string
    viewerId: number
    participants: SettlementParticipant[]
    expectedRealViewerIds: number[]
    ownScore: number
    ownContributionScore: number
    mateResults: any[]
    waitMs?: number
}): Promise<SettlementMergeResult> {
    const viewerId = finiteNumber(input.viewerId, 0)
    let snapshot = snapshots.get(input.key)
    if (!snapshot) {
        snapshot = createSnapshot(input.key, input.participants, input.expectedRealViewerIds)
    } else {
        snapshot.participants = mergeParticipants(snapshot.participants, input.participants)
        for (const expectedViewerId of input.expectedRealViewerIds) {
            const normalized = finiteNumber(expectedViewerId, 0)
            if (normalized > 0) {
                snapshot.expectedRealViewerIds.add(normalized)
                if (!snapshot.participants.some(participant => participant.viewerId === normalized)) {
                    snapshot.participants.push({ viewerId: normalized, comId: 0 })
                }
            }
        }
    }

    if (!snapshot.participants.some(participant => participant.viewerId === viewerId)) {
        snapshot.participants.push({ viewerId, comId: 0 })
    }
    if (viewerId > 0 && viewerId < 900_000_000) {
        snapshot.expectedRealViewerIds.add(viewerId)
    }

    for (const rawResult of Array.isArray(input.mateResults) ? input.mateResults : []) {
        const result = normalizeResult(rawResult)
        if (!result) continue
        const previous = snapshot.results.get(result.viewer_id)
        if (snapshot.selfReportedViewerIds.has(result.viewer_id)) {
            if (previous && previous.com_id === 0 && result.com_id !== 0) {
                previous.com_id = result.com_id
            }
            continue
        }
        snapshot.results.set(result.viewer_id, result)
        if (!snapshot.participants.some(participant => participant.viewerId === result.viewer_id)) {
            snapshot.participants.push({ viewerId: result.viewer_id, comId: result.com_id })
        }
    }

    const existingSelf = snapshot.results.get(viewerId)
    const participant = snapshot.participants.find(candidate => candidate.viewerId === viewerId)
    snapshot.results.set(viewerId, {
        viewer_id: viewerId,
        com_id: existingSelf?.com_id || participant?.comId || 0,
        score: finiteNumber(input.ownScore, 0),
        contribution_score: finiteNumber(input.ownContributionScore, 0),
    })
    snapshot.selfReportedViewerIds.add(viewerId)
    releaseWaiters(snapshot)

    // Return immediately once every real participant has submitted.  The
    // compatibility delay below is only an upper bound for a missing peer.
    // The repaired CN flow originally used a 1.2 second upper bound.  Keep
    // that compatibility window: complete rosters still return immediately,
    // while a missing peer cannot hold every client for five seconds.
    const waitMs = Math.max(0, Math.min(1_200, finiteNumber(input.waitMs, 1_200)))
    await waitForPeers(snapshot, waitMs)

    const synthesizedViewerIds: number[] = []
    const mateResults: MatePlayerResult[] = []
    for (const participantEntry of snapshot.participants) {
        if (participantEntry.viewerId === viewerId) continue
        const result = snapshot.results.get(participantEntry.viewerId)
        if (result) {
            mateResults.push({
                ...result,
                com_id: result.com_id || participantEntry.comId || 0,
            })
        } else {
            synthesizedViewerIds.push(participantEntry.viewerId)
            mateResults.push({
                viewer_id: participantEntry.viewerId,
                com_id: participantEntry.comId || 0,
                score: 0,
                contribution_score: 0,
            })
        }
    }

    return {
        mateResults,
        synthesizedViewerIds,
        submittedCount: snapshot.selfReportedViewerIds.size,
        expectedCount: snapshot.expectedRealViewerIds.size,
    }
}

export function clearMultiSettlementSnapshot(key: string): void {
    const snapshot = snapshots.get(key)
    if (!snapshot) return
    clearTimeout(snapshot.cleanupTimer)
    for (const resolve of snapshot.waiters) resolve()
    snapshot.waiters.clear()
    snapshots.delete(key)
}
