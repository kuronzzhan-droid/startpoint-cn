const HOST_CLONE_TARGET_SIZE = 3
const HOST_CLONE_VIEWER_ID_BASE = 900000000

export interface HostCloneLobbyMate {
    viewerId: number
    playerId?: number
    comId?: number
    name: string
    rank: number
    degreeId: number
    party: unknown
    connectionId?: string
    [key: string]: unknown
}

export interface HostCloneFillPolicy {
    enabled: boolean
    immediate: boolean
    timeoutMs: number
}

export interface HostCloneTimer {
    setTimeout(callback: () => void, delayMs: number): unknown
    clearTimeout(handle: unknown): void
}

export interface HostCloneFillDecision {
    shouldFill: boolean
    slots: number
}

export interface HostCloneSnapshot {
    hostMate: HostCloneLobbyMate
    mates: readonly HostCloneLobbyMate[]
}

export interface HostCloneFillControl {
    cancel(): void
    firedImmediately: boolean
}

export function isHostCloneAiMate(mate: HostCloneLobbyMate): boolean {
    return Number.isInteger(mate.comId) && Number(mate.comId) > 0
}

export function serializeHostCloneRoomMates(
    mates: readonly HostCloneLobbyMate[]
): Array<{ viewer_id: number; com_id: number; player_id?: number }> {
    return mates.map(mate => ({
        viewer_id: mate.viewerId,
        com_id: isHostCloneAiMate(mate) ? Number(mate.comId) : 0,
        ...(Number.isSafeInteger(mate.playerId) && Number(mate.playerId) > 0
            ? { player_id: Number(mate.playerId) }
            : {}),
    }))
}

export function countHostCloneMates(
    mates: readonly HostCloneLobbyMate[]
): { humans: number; ai: number; total: number } {
    const ai = mates.filter(isHostCloneAiMate).length
    return {
        humans: mates.length - ai,
        ai,
        total: mates.length,
    }
}

export function decideHostCloneFill(
    policy: HostCloneFillPolicy,
    trigger: "immediate" | "timeout",
    mates: readonly HostCloneLobbyMate[]
): HostCloneFillDecision {
    const triggerMatchesPolicy = trigger === "immediate" ? policy.immediate : !policy.immediate
    if (!policy.enabled || !triggerMatchesPolicy) {
        return { shouldFill: false, slots: 0 }
    }

    const slots = Math.max(0, HOST_CLONE_TARGET_SIZE - countHostCloneMates(mates).total)
    return { shouldFill: slots > 0, slots }
}

function nextAvailablePositiveId(used: Set<number>, first: number): number {
    let candidate = first
    while (used.has(candidate)) candidate++
    used.add(candidate)
    return candidate
}

export function buildHostCloneMates(options: {
    roomNumber: string
    hostMate: HostCloneLobbyMate
    mates: readonly HostCloneLobbyMate[]
    entryTime?: number
    names?: readonly string[]
}): HostCloneLobbyMate[] {
    const slots = Math.max(0, HOST_CLONE_TARGET_SIZE - countHostCloneMates(options.mates).total)
    if (slots === 0) return []

    const usedComIds = new Set(
        options.mates
            .map(mate => mate.comId)
            .filter((comId): comId is number => Number.isInteger(comId) && Number(comId) > 0)
    )
    const usedViewerIds = new Set(options.mates.map(mate => mate.viewerId))
    const clones: HostCloneLobbyMate[] = []

    for (let index = 0; index < slots; index++) {
        const comId = nextAvailablePositiveId(usedComIds, 1)
        const viewerId = nextAvailablePositiveId(
            usedViewerIds,
            HOST_CLONE_VIEWER_ID_BASE + comId
        )
        clones.push({
            viewerId,
            comId,
            name: options.names?.[index] ?? `房主复制AI${comId}`,
            rank: options.hostMate.rank,
            degreeId: options.hostMate.degreeId,
            playerRoleKind: 99,
            party: structuredClone(options.hostMate.party),
            connectionId: `${options.roomNumber}-host-clone-${comId}`,
            autoplayMode: false,
            autoskillMode: 1,
            autoSpeedLevel: 1,
            autoStart: false,
            skillAbilityBehaviorMode: 1,
            dashBehaviorMode: 1,
            allowHealFromOtherPlayers: true,
            state: [0],
            entryTime: options.entryTime ?? 0,
            isNewbie: false,
            isHost: false,
        })
    }

    return clones
}

export function coordinateHostCloneFill(options: {
    roomNumber: string
    policy: HostCloneFillPolicy
    getSnapshot: () => HostCloneSnapshot
    onFill: (mates: HostCloneLobbyMate[]) => void
    timer: HostCloneTimer
}): HostCloneFillControl {
    const noOpControl = { cancel: () => undefined, firedImmediately: false }
    if (!options.policy.enabled) return noOpControl

    const fillFromLatestSnapshot = (trigger: "immediate" | "timeout"): boolean => {
        const snapshot = options.getSnapshot()
        const decision = decideHostCloneFill(options.policy, trigger, snapshot.mates)
        if (!decision.shouldFill) return false

        const clones = buildHostCloneMates({
            roomNumber: options.roomNumber,
            hostMate: snapshot.hostMate,
            mates: snapshot.mates,
        })
        if (clones.length === 0) return false
        options.onFill(clones)
        return true
    }

    if (options.policy.immediate) {
        return {
            cancel: () => undefined,
            firedImmediately: fillFromLatestSnapshot("immediate"),
        }
    }

    let timerHandle: unknown = options.timer.setTimeout(() => {
        timerHandle = undefined
        fillFromLatestSnapshot("timeout")
    }, options.policy.timeoutMs)

    return {
        cancel: () => {
            if (timerHandle === undefined) return
            options.timer.clearTimeout(timerHandle)
            timerHandle = undefined
        },
        firedImmediately: false,
    }
}
