import { randomUUID } from "node:crypto"
import type { FiveBossLobbyRuntimeSnapshot } from "../../lib/types/multi"
import {
    buildHostCloneMates,
    countHostCloneMates,
    isHostCloneAiMate,
    type HostCloneLobbyMate,
    type HostCloneSnapshot,
    type HostCloneTimer,
} from "../npc/host-clone"
import { FIVE_BOSS_GAUNTLET, isFiveBossGauntletQuest } from "./contract"

export interface FiveBossLobbyRoomIdentity {
    room_number: string
    category: number
    quest_id: number
}

export interface FiveBossLobbyStartRoomIdentity extends FiveBossLobbyRoomIdentity {
    host_viewer_id: number
}

interface FillOptions {
    room: FiveBossLobbyRoomIdentity
    getSnapshot: () => HostCloneSnapshot | null
    onFill: (mates: HostCloneLobbyMate[]) => void
}

interface ScheduledFillOptions extends FillOptions {
    timer: HostCloneTimer
}

interface PendingFill {
    handle: unknown
    timer: HostCloneTimer
}

export function isFiveBossLobbyRoom(room: FiveBossLobbyRoomIdentity): boolean {
    return isFiveBossGauntletQuest(room.category, room.quest_id)
}

export function canStartFiveBossLobbyRun(
    room: FiveBossLobbyStartRoomIdentity,
    requesterViewerId: number,
    mates: readonly HostCloneLobbyMate[],
): boolean {
    if (!isFiveBossLobbyRoom(room) || requesterViewerId !== room.host_viewer_id) return false
    const counts = countHostCloneMates(mates)
    const humans = mates.filter(mate => !isHostCloneAiMate(mate))
    const everyHumanHasPlayerId = humans
        .every(mate => (
            Number.isSafeInteger(mate.playerId)
            && Number(mate.playerId) > 0
            && typeof mate.connectionId === "string"
            && mate.connectionId.length > 0
        ))
    const connectionIds = humans.map(mate => String(mate.connectionId ?? ""))
    return counts.total === FIVE_BOSS_GAUNTLET.roomMemberLimit
        && counts.humans >= 1
        && counts.humans <= FIVE_BOSS_GAUNTLET.roomMemberLimit
        && everyHumanHasPlayerId
        && new Set(connectionIds).size === connectionIds.length
}

export function applyAutoplayModeChange(options: {
    viewerId: number
    auto: unknown
    manual: unknown
    yourself?: HostCloneLobbyMate
    hostMates: readonly HostCloneLobbyMate[]
}): { message: [1, [3, number, boolean, boolean]] } | null {
    if (typeof options.auto !== "boolean" || typeof options.manual !== "boolean") {
        return null
    }

    if (options.yourself?.viewerId === options.viewerId) {
        options.yourself.autoplayMode = options.auto
    }
    for (const mate of options.hostMates) {
        if (mate.viewerId === options.viewerId) mate.autoplayMode = options.auto
    }

    return { message: [1, [3, options.viewerId, options.auto, options.manual]] }
}

export function mergeFiveBossRealMate(
    mates: readonly HostCloneLobbyMate[],
    realMate: HostCloneLobbyMate,
    limit = FIVE_BOSS_GAUNTLET.roomMemberLimit,
): HostCloneLobbyMate[] {
    const next = [...mates]
    const existingIndex = next.findIndex(mate => mate.viewerId === realMate.viewerId)
    if (existingIndex >= 0) {
        next[existingIndex] = realMate
        return next
    }

    if (countHostCloneMates(next).humans >= limit) return next

    const aiIndex = next.findIndex(isHostCloneAiMate)
    if (aiIndex >= 0) {
        next[aiIndex] = realMate
        return next
    }
    if (next.length < limit) next.push(realMate)
    return next
}

export function refreshFiveBossHostClones(
    hostMate: HostCloneLobbyMate,
    mates: readonly HostCloneLobbyMate[],
): HostCloneLobbyMate[] {
    return mates.map(mate => {
        if (!isHostCloneAiMate(mate)) return mate
        return {
            ...mate,
            rank: hostMate.rank,
            degreeId: hostMate.degreeId,
            party: structuredClone(hostMate.party),
        }
    })
}

export function freezeFiveBossLobbyRuntime(
    mates: readonly HostCloneLobbyMate[],
    createRunId: () => string = randomUUID,
    resolveRemoteAddress: (connectionId: string) => string | null = () => null,
): FiveBossLobbyRuntimeSnapshot {
    const expectedRealPlayerIds: number[] = []
    const autoplayModeByPlayerId: Record<string, boolean> = {}
    const battleIdentityByConnectionId: FiveBossLobbyRuntimeSnapshot["battleIdentityByConnectionId"] = {}
    const seen = new Set<number>()

    for (const mate of mates) {
        if (isHostCloneAiMate(mate)) continue
        const playerId = Number(mate.playerId)
        if (!Number.isSafeInteger(playerId) || playerId <= 0 || seen.has(playerId)) continue
        const connectionId = typeof mate.connectionId === "string" ? mate.connectionId : ""
        if (!connectionId || battleIdentityByConnectionId[connectionId]) {
            throw new Error("five-boss real players require unique frozen connection ids")
        }
        seen.add(playerId)
        expectedRealPlayerIds.push(playerId)
        autoplayModeByPlayerId[String(playerId)] = mate.autoplayMode !== false
        battleIdentityByConnectionId[connectionId] = {
            viewerId: Number(mate.viewerId),
            playerId,
            remoteAddress: resolveRemoteAddress(connectionId),
        }
    }

    if (expectedRealPlayerIds.length < 1 || expectedRealPlayerIds.length > FIVE_BOSS_GAUNTLET.roomMemberLimit) {
        throw new Error(`five-boss start requires 1-${FIVE_BOSS_GAUNTLET.roomMemberLimit} real players`)
    }

    return {
        runId: createRunId(),
        expectedRealPlayerIds,
        autoplayModeByPlayerId,
        battleIdentityByConnectionId,
    }
}

export class FiveBossLobbyFillCoordinator {
    private readonly pending = new Map<string, PendingFill>()

    schedule(options: ScheduledFillOptions): boolean {
        if (!isFiveBossLobbyRoom(options.room)) return false

        this.cancel(options.room.room_number)
        const current = options.getSnapshot()
        if (!current || countHostCloneMates(current.mates).total >= FIVE_BOSS_GAUNTLET.roomMemberLimit) {
            return false
        }

        const roomNumber = options.room.room_number
        const handle = options.timer.setTimeout(() => {
            this.pending.delete(roomNumber)
            const latest = options.getSnapshot()
            if (!latest) return
            const clones = buildHostCloneMates({
                roomNumber,
                hostMate: latest.hostMate,
                mates: latest.mates,
            })
            if (clones.length > 0) options.onFill(clones)
        }, FIVE_BOSS_GAUNTLET.aiFillTimeoutMs)

        this.pending.set(roomNumber, { handle, timer: options.timer })
        return true
    }

    fillImmediately(options: FillOptions): boolean {
        if (!isFiveBossLobbyRoom(options.room)) return false

        this.cancel(options.room.room_number)
        const latest = options.getSnapshot()
        if (!latest) return false
        const clones = buildHostCloneMates({
            roomNumber: options.room.room_number,
            hostMate: latest.hostMate,
            mates: latest.mates,
        })
        if (clones.length === 0) return false
        options.onFill(clones)
        return true
    }

    cancel(roomNumber: string): void {
        const pending = this.pending.get(roomNumber)
        if (!pending) return
        pending.timer.clearTimeout(pending.handle)
        this.pending.delete(roomNumber)
    }
}
