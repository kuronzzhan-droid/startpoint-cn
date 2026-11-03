import * as crypto from "crypto"

export type FingerprintLayer = "initial" | "user_speed" | "coop_input" | "state"
export type FingerprintAttribution =
    | "initial_state"
    | "user_or_speed_input"
    | "coop_input_schedule"
    | "simulation_determinism"
export type FingerprintCompleteness = "complete" | "incomplete" | "partial_observed"

export const UNSET_SENTINEL = "<unset>"
export const MISSING_OBSERVER_SENTINEL = "<missing_observer>"

export interface UnsupportedFieldEntry {
    path: string
    reason: "rng_type" | "enum_variant" | "field_shape" | "address_shape" | "read_error"
}

export interface CompactInputSummary {
    count: number
    user: number
    coop: number
    unknown: number
    readErrors: number
    kinds: Record<string, number>
    orderedHash: number
    firstFrame: number | null
    lastFrame: number | null
    coverage: "top_level_only"
}

export interface CompactRouteSummary {
    count: number
    unknown: number
    readErrors: number
    route_received: number
    route_decoded: number
    route_rejected: number
    speed_received: number
    speed_applied: number
    kinds: Record<string, number>
    orderedHash: number
    firstFrame: number | null
    lastFrame: number | null
    coverage: "top_level_only"
}

export interface NormalizedInputEntry {
    ordinal: number
    kind: "User" | "Coop"
    sourceBattleId: string
    sourceBattleEpoch: number | null
    sourceFrame: number | null
    targetBattleId: string
    battleEpoch: number
    applyTargetFrame: number
    command: unknown[] | null
}

export interface NormalizedEventEntry {
    eventId: number
    stage: "route_received" | "route_decoded" | "route_rejected" | "speed_received" | "speed_applied" | "lifecycle"
    battleId: string | null
    battleEpoch: number | null
    targetFrame: number | null
    sourceBattleId: string | null
    sourceBattleEpoch: number | null
    sourceFrame: number | null
    command: unknown[] | null
    detail: Record<string, unknown>
}

export interface NormalizedGapEntry {
    reason: string
    battleId: string | null
    battleEpoch: number | null
    fromFrame: number | null
    toFrame: number | null
    fromSeq: number | null
    toSeq: number | null
    fromEventId: number | null
    toEventId: number | null
    source?: "client" | "server"
    detail?: string
}

export interface ReconstructedFrameObservation {
    observerId: string
    viewerId: number
    connectionId: string
    connectionGeneration: number
    clientEpoch: number
    seq: number
    parts: number
    build: string
    schema: string
    battleId: string
    battleEpoch: number
    postFrame: number
    phase: "initial" | "post"
    zone: number | null
    floor: number
    mode: "full" | "delta"
    baseFrame: number | null
    eventCursor: number | null
    eventContextComplete: boolean
    inputs: NormalizedInputEntry[]
    inputSummary?: CompactInputSummary | null
    routeSummary?: CompactRouteSummary | null
    sampleInterval?: number | null
    previousCheckpointFrame?: number | null
    unsupported: UnsupportedFieldEntry[]
    state: Map<string, unknown>
    groupHashes: Record<string, string>
}

export interface FieldDiffEntry {
    layer: FingerprintLayer
    fieldPath: string
    valuesByObserver: Record<string, unknown>
}

export interface DesyncFirstReport {
    runId: string
    roomNumber: string
    roomInstanceId: string
    battleSessionId: string
    generation: number
    sceneEpoch: number
    schema: string
    battleId: string
    battleEpoch: number
    postFrame: number
    frame: number
    phase: "initial" | "post"
    status: "confirmed" | "candidate_incomplete"
    confirmed: boolean
    completeness: FingerprintCompleteness
    complete: boolean
    incompleteReasons: string[]
    layer: FingerprintLayer
    attribution: FingerprintAttribution
    fieldPath: string
    field: string
    observerValues: Record<string, unknown>
    valuesByObserver: Record<string, unknown>
    summary: string
    lastEqualFrame: number | null
    expectedObservers: string[]
    observedObservers: string[]
    missingObservers: string[]
    eventCursors: Record<string, number | null>
    packetSeqs: Record<string, number | null>
    unsupportedByObserver: Record<string, UnsupportedFieldEntry[]>
    groupHashesByObserver: Record<string, Record<string, string>>
    allDiffFields: FieldDiffEntry[]
    layers: {
        initial: {
            equal: boolean
            diffs: FieldDiffEntry[]
        }
        userSpeed: {
            equal: boolean
            diffs: FieldDiffEntry[]
            byObserver: Record<string, {
                userInputs: unknown[]
                speedApplied: unknown[]
                speedReceived: unknown[]
                routeEvents: unknown[]
                inputSummary?: CompactInputSummary | null
                routeSummary?: CompactRouteSummary | null
            }>
        }
        coopInput: {
            equal: boolean
            diffs: FieldDiffEntry[]
            byObserver: Record<string, {
                coopInputs: unknown[]
                allInputs: unknown[]
                inputSummary?: CompactInputSummary | null
            }>
        }
        state: {
            equal: boolean
            diffs: FieldDiffEntry[]
        }
    }
    context: {
        userInputsByObserver: Record<string, unknown[]>
        coopInputsByObserver: Record<string, unknown[]>
        speedEventsByObserver: Record<string, unknown[]>
        routeEventsByObserver: Record<string, unknown[]>
        gapsByObserver: Record<string, NormalizedGapEntry[]>
        inputSummaryByObserver?: Record<string, CompactInputSummary | null>
        routeSummaryByObserver?: Record<string, CompactRouteSummary | null>
        sampleIntervalByObserver?: Record<string, number | null>
        previousCheckpointFrameByObserver?: Record<string, number | null>
        throttleEventsByObserver?: Record<string, NormalizedEventEntry[]>
        summaryCoverage?: {
            note: string
            inputSummary: string | null
            routeSummary: string | null
            inputWindowComparable: boolean
        }
    }
}

export interface FrozenObserverMember {
    observerId: string
    viewerId: number
    connectionId: string
}

export interface RunBucketIdentity {
    runId: string
    roomNumber: string
    roomInstanceId: string
    battleSessionId: string
    generation: number
    sceneEpoch: number
    schema: string
}

export function canonicalJson(value: unknown): string {
    if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
        return JSON.stringify(value)
    }
    if (Array.isArray(value)) {
        return "[" + value.map(item => canonicalJson(item)).join(",") + "]"
    }
    if (value instanceof Map) {
        const entries = [...value.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
        return "{" + entries.map(([k, v]) => JSON.stringify(String(k)) + ":" + canonicalJson(v)).join(",") + "}"
    }
    if (typeof value === "object" && value !== null) {
        const obj = value as Record<string, unknown>
        const keys = Object.keys(obj).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
        return "{" + keys.map(k => JSON.stringify(k) + ":" + canonicalJson(obj[k])).join(",") + "}"
    }
    return JSON.stringify(value)
}

export function deepEqualValue(a: unknown, b: unknown): boolean {
    if (a === b) {
        // Note: in wf-fp, floats are f64:... strings and integers are safe ints.
        // Object.is handles -0 vs +0 just in case a number is ever passed.
        return typeof a === "number" ? Object.is(a, b) : true
    }
    if (a === null || b === null || typeof a !== typeof b) return false
    if (Array.isArray(a)) {
        if (!Array.isArray(b) || a.length !== b.length) return false
        for (let i = 0; i < a.length; i++) {
            if (!deepEqualValue(a[i], b[i])) return false
        }
        return true
    }
    if (Array.isArray(b)) return false
    if (typeof a === "object" && typeof b === "object") {
        const objA = a as Record<string, unknown>
        const objB = b as Record<string, unknown>
        const keysA = Object.keys(objA)
        const keysB = Object.keys(objB)
        if (keysA.length !== keysB.length) return false
        for (const key of keysA) {
            if (!Object.prototype.hasOwnProperty.call(objB, key)) return false
            if (!deepEqualValue(objA[key], objB[key])) return false
        }
        return true
    }
    return false
}

function classifyStateGroup(fieldPath: string): string {
    if (fieldPath.startsWith("/battle/")) return "battle"
    if (fieldPath === "/zone" || fieldPath.startsWith("/zone/")) return "zone"
    if (/^\/enemies\/.+\/trial(?:\/|$)/.test(fieldPath)) return "trial"
    if (fieldPath === "/enemies" || fieldPath.startsWith("/enemies/")) return "enemies"
    if (fieldPath === "/funnels" || fieldPath.startsWith("/funnels/")) return "funnels"
    if (fieldPath === "/modifier" || fieldPath.startsWith("/modifier/")) return "modifier"
    if (fieldPath === "/buff" || fieldPath.startsWith("/buff/")) return "buff"
    if (fieldPath.startsWith("/rng/")) return "rng"
    return "other"
}

export function computeStateGroupHashes(state: Map<string, unknown>): Record<string, string> {
    const groups: Record<string, Array<[string, unknown]>> = {
        battle: [],
        zone: [],
        enemies: [],
        trial: [],
        funnels: [],
        modifier: [],
        buff: [],
        rng: [],
    }
    const sortedEntries = [...state.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    for (const entry of sortedEntries) {
        const group = classifyStateGroup(entry[0])
        if (!groups[group]) groups[group] = []
        groups[group].push(entry)
    }
    const hashes: Record<string, string> = {}
    for (const [groupName, entries] of Object.entries(groups)) {
        const serialized = canonicalJson(entries)
        hashes[groupName] = crypto.createHash("sha256").update(serialized, "utf8").digest("hex").slice(0, 16)
    }
    hashes.all = crypto.createHash("sha256").update(canonicalJson(sortedEntries), "utf8").digest("hex").slice(0, 16)
    return hashes
}

function projectUserInput(inp: NormalizedInputEntry) {
    return {
        kind: "User" as const,
        sourceBattleId: inp.sourceBattleId,
        targetBattleId: inp.targetBattleId,
        battleEpoch: inp.battleEpoch,
        applyTargetFrame: inp.applyTargetFrame,
        command: inp.command,
    }
}

function projectCoopInput(inp: NormalizedInputEntry) {
    return {
        kind: "Coop" as const,
        sourceBattleId: inp.sourceBattleId,
        sourceBattleEpoch: inp.sourceBattleEpoch,
        sourceFrame: inp.sourceFrame,
        targetBattleId: inp.targetBattleId,
        battleEpoch: inp.battleEpoch,
        applyTargetFrame: inp.applyTargetFrame,
        command: inp.command,
    }
}

function projectAllInput(inp: NormalizedInputEntry) {
    return {
        ordinal: inp.ordinal,
        kind: inp.kind,
        sourceBattleId: inp.sourceBattleId,
        sourceBattleEpoch: inp.sourceBattleEpoch,
        sourceFrame: inp.sourceFrame,
        targetBattleId: inp.targetBattleId,
        battleEpoch: inp.battleEpoch,
        applyTargetFrame: inp.applyTargetFrame,
        command: inp.command,
    }
}

function projectSpeedApplied(ev: NormalizedEventEntry) {
    return {
        stage: "speed_applied" as const,
        battleId: ev.battleId,
        battleEpoch: ev.battleEpoch,
        targetFrame: ev.targetFrame,
        command: ev.command,
        detail: {
            speed: ev.detail.speed ?? null,
            length: ev.detail.length ?? null,
            targetOtherBattleId: ev.detail.targetOtherBattleId ?? null,
        },
    }
}

function allObserversEqual(observerIds: string[], valuesByObserver: Record<string, unknown>): boolean {
    if (observerIds.length < 2) return true
    const first = valuesByObserver[observerIds[0]]
    for (let i = 1; i < observerIds.length; i++) {
        if (!deepEqualValue(first, valuesByObserver[observerIds[i]])) return false
    }
    return true
}

function formatSummaryValue(value: unknown): string {
    if (value === UNSET_SENTINEL || value === MISSING_OBSERVER_SENTINEL) return String(value)
    return canonicalJson(value)
}

interface BattleEpochTimeline {
    battleId: string
    battleEpoch: number
    framesByObserver: Map<string, Map<number, ReconstructedFrameObservation>>
    observedFrames: Set<number>
    bestReport: DesyncFirstReport | null
    emittedSignature: string | null
}

const INITIAL_SEED_PATHS = ["/battle/id", "/battle/baseSeed", "/battle/separativeBaseSeed"] as const

export class StateFingerprintComparator {
    private readonly expectedMembers = new Map<string, FrozenObserverMember>()
    private rosterFrozen = false
    private readonly eventsByObserver = new Map<string, NormalizedEventEntry[]>()
    private readonly gapsByObserver = new Map<string, NormalizedGapEntry[]>()
    private readonly observerIssues = new Map<string, Set<string>>()
    private readonly observerPendingSeqs = new Set<string>()
    private readonly timelines = new Map<string, BattleEpochTimeline>()
    private firstReport: DesyncFirstReport | null = null

    constructor(
        public readonly identity: RunBucketIdentity,
        initialMembers: FrozenObserverMember[] = [],
        private readonly onDesyncReport?: (report: DesyncFirstReport, isFirstForBattle: boolean) => void,
    ) {
        if (initialMembers.length > 0) {
            for (const member of initialMembers) {
                this.registerExpectedMemberInternal(member)
            }
            this.rosterFrozen = true
        }
    }

    freezeExpectedMembers(members: FrozenObserverMember[]): void {
        if (members.length === 0) return
        if (!this.rosterFrozen) {
            for (const member of members) {
                this.registerExpectedMemberInternal(member)
            }
            this.rosterFrozen = true
        } else {
            for (const member of members) {
                if (this.isAuthorizedMember(member)) {
                    this.registerExpectedMemberInternal(member)
                }
            }
        }
    }

    isAuthorizedMember(member: FrozenObserverMember): boolean {
        if (!this.rosterFrozen || this.expectedMembers.size === 0) return true
        for (const existing of this.expectedMembers.values()) {
            if (member.viewerId > 0 && existing.viewerId > 0 && existing.viewerId === member.viewerId) {
                return true
            }
            if (member.connectionId && existing.connectionId && existing.connectionId === member.connectionId) {
                return true
            }
            if (member.observerId && existing.observerId === member.observerId) {
                return true
            }
        }
        return false
    }

    registerExpectedMember(member: FrozenObserverMember): string {
        if (this.rosterFrozen && !this.isAuthorizedMember(member)) {
            return member.observerId || member.connectionId || `viewer:${member.viewerId}`
        }
        return this.registerExpectedMemberInternal(member)
    }

    private registerExpectedMemberInternal(member: FrozenObserverMember): string {
        // Match by viewerId if already registered before battle socket bound connectionId
        if (member.viewerId > 0) {
            for (const [existingKey, existing] of this.expectedMembers) {
                if (existing.viewerId === member.viewerId) {
                    const updatedId = member.connectionId || existing.connectionId || existingKey
                    if (updatedId !== existingKey) {
                        this.expectedMembers.delete(existingKey)
                        this.migrateObserverKey(existingKey, updatedId)
                    }
                    const updated: FrozenObserverMember = {
                        observerId: updatedId,
                        viewerId: member.viewerId,
                        connectionId: member.connectionId || existing.connectionId,
                    }
                    this.expectedMembers.set(updatedId, updated)
                    return updatedId
                }
            }
        }
        const key = member.observerId || member.connectionId || `viewer:${member.viewerId}`
        if (!this.expectedMembers.has(key)) {
            this.expectedMembers.set(key, {
                observerId: key,
                viewerId: member.viewerId,
                connectionId: member.connectionId,
            })
        }
        return key
    }

    setObserverPendingSequences(observerId: string, hasPending: boolean): void {
        const had = this.observerPendingSeqs.has(observerId)
        if (hasPending === had) return
        if (hasPending) this.observerPendingSeqs.add(observerId)
        else this.observerPendingSeqs.delete(observerId)
        for (const timeline of this.timelines.values()) {
            this.recomputeTimeline(timeline)
        }
    }

    private migrateObserverKey(fromKey: string, toKey: string): void {
        if (fromKey === toKey) return
        const events = this.eventsByObserver.get(fromKey)
        if (events) {
            this.eventsByObserver.set(toKey, [...events, ...(this.eventsByObserver.get(toKey) ?? [])])
            this.eventsByObserver.delete(fromKey)
        }
        const gaps = this.gapsByObserver.get(fromKey)
        if (gaps) {
            this.gapsByObserver.set(toKey, [...gaps, ...(this.gapsByObserver.get(toKey) ?? [])])
            this.gapsByObserver.delete(fromKey)
        }
        const issues = this.observerIssues.get(fromKey)
        if (issues) {
            const target = this.observerIssues.get(toKey) ?? new Set<string>()
            for (const item of issues) target.add(item)
            this.observerIssues.set(toKey, target)
            this.observerIssues.delete(fromKey)
        }
        if (this.observerPendingSeqs.has(fromKey)) {
            this.observerPendingSeqs.delete(fromKey)
            this.observerPendingSeqs.add(toKey)
        }
        for (const timeline of this.timelines.values()) {
            const frames = timeline.framesByObserver.get(fromKey)
            if (frames) {
                const targetFrames = timeline.framesByObserver.get(toKey) ?? new Map<number, ReconstructedFrameObservation>()
                for (const [f, obs] of frames) targetFrames.set(f, { ...obs, observerId: toKey })
                timeline.framesByObserver.set(toKey, targetFrames)
                timeline.framesByObserver.delete(fromKey)
            }
        }
    }

    getExpectedObserverIds(): string[] {
        return [...this.expectedMembers.keys()]
    }

    addEvents(observerId: string, events: NormalizedEventEntry[]): void {
        if (events.length === 0) return
        let list = this.eventsByObserver.get(observerId)
        if (!list) {
            list = []
            this.eventsByObserver.set(observerId, list)
        }
        list.push(...events)
    }

    addGap(observerId: string, gap: NormalizedGapEntry): void {
        let list = this.gapsByObserver.get(observerId)
        if (!list) {
            list = []
            this.gapsByObserver.set(observerId, list)
        }
        list.push(gap)
        for (const timeline of this.timelines.values()) {
            if (gap.battleId === null || gap.battleId === timeline.battleId) {
                this.recomputeTimeline(timeline)
            }
        }
    }

    noteObserverIssue(observerId: string, reason: string): void {
        let set = this.observerIssues.get(observerId)
        if (!set) {
            set = new Set()
            this.observerIssues.set(observerId, set)
        }
        set.add(reason)
        for (const timeline of this.timelines.values()) {
            this.recomputeTimeline(timeline)
        }
    }

    addFrameObservation(observation: ReconstructedFrameObservation): DesyncFirstReport | null {
        const key = `${observation.battleId}#${observation.battleEpoch}`
        let timeline = this.timelines.get(key)
        if (!timeline) {
            timeline = {
                battleId: observation.battleId,
                battleEpoch: observation.battleEpoch,
                framesByObserver: new Map(),
                observedFrames: new Set(),
                bestReport: null,
                emittedSignature: null,
            }
            this.timelines.set(key, timeline)
        }
        let byFrame = timeline.framesByObserver.get(observation.observerId)
        if (!byFrame) {
            byFrame = new Map()
            timeline.framesByObserver.set(observation.observerId, byFrame)
        }
        byFrame.set(observation.postFrame, observation)
        timeline.observedFrames.add(observation.postFrame)
        return this.recomputeTimeline(timeline)
    }

    getFirstReport(): DesyncFirstReport | null {
        return this.firstReport
    }

    getBattleReport(battleId: string, battleEpoch = 0): DesyncFirstReport | null {
        return this.timelines.get(`${battleId}#${battleEpoch}`)?.bestReport ?? null
    }

    getAllBattleReports(): DesyncFirstReport[] {
        const out: DesyncFirstReport[] = []
        for (const timeline of this.timelines.values()) {
            if (timeline.bestReport) out.push(timeline.bestReport)
        }
        return out
    }

    /**
     * Returns sorted common checkpoint frames where all expected (or >= 2 observed)
     * observers have an actual checkpoint for (battleId, battleEpoch).
     */
    getCommonFrames(battleId: string, battleEpoch = 0): number[] {
        const timeline = this.timelines.get(`${battleId}#${battleEpoch}`)
        if (!timeline) return []
        const expected = this.getExpectedObserverIds()
        const targetObservers = expected.length >= 2 ? expected : [...timeline.framesByObserver.keys()]
        if (targetObservers.length < 2) return []
        const sortedFrames = [...timeline.observedFrames].sort((a, b) => a - b)
        return sortedFrames.filter(f => targetObservers.every(obsId => timeline.framesByObserver.get(obsId)?.has(f)))
    }

    getBattleDiagnosticSummary(battleId: string, battleEpoch = 0): {
        schema: string
        battleId: string
        battleEpoch: number
        commonFrames: number[]
        evidenceStatus: "sufficient" | "insufficient_common_frames"
        observedFramesByObserver: Record<string, number[]>
        sampleIntervalsByObserver: Record<string, Array<{ postFrame: number; sampleInterval: number | null; previousCheckpointFrame: number | null }>>
        throttleEventsByObserver: Record<string, NormalizedEventEntry[]>
    } {
        const timeline = this.timelines.get(`${battleId}#${battleEpoch}`)
        const commonFrames = this.getCommonFrames(battleId, battleEpoch)
        const observedFramesByObserver: Record<string, number[]> = {}
        const sampleIntervalsByObserver: Record<string, Array<{ postFrame: number; sampleInterval: number | null; previousCheckpointFrame: number | null }>> = {}
        const throttleEventsByObserver: Record<string, NormalizedEventEntry[]> = {}

        const observerIds = new Set<string>([
            ...this.getExpectedObserverIds(),
            ...(timeline ? timeline.framesByObserver.keys() : []),
            ...this.eventsByObserver.keys(),
        ])
        for (const obsId of observerIds) {
            const byFrame = timeline?.framesByObserver.get(obsId)
            const frames = byFrame ? [...byFrame.keys()].sort((a, b) => a - b) : []
            observedFramesByObserver[obsId] = frames
            sampleIntervalsByObserver[obsId] = frames.map(f => {
                const obs = byFrame!.get(f)!
                return {
                    postFrame: f,
                    sampleInterval: obs.sampleInterval ?? null,
                    previousCheckpointFrame: obs.previousCheckpointFrame ?? null,
                }
            })
            throttleEventsByObserver[obsId] = (this.eventsByObserver.get(obsId) ?? []).filter(
                ev => ev.stage === "lifecycle"
                    && ev.detail.reason === "throttle"
                    && (ev.battleId === null || ev.battleId === battleId)
                    && (ev.battleEpoch === null || ev.battleEpoch === battleEpoch),
            )
        }

        return {
            schema: this.identity.schema,
            battleId,
            battleEpoch,
            commonFrames,
            evidenceStatus: commonFrames.length > 0 ? "sufficient" : "insufficient_common_frames",
            observedFramesByObserver,
            sampleIntervalsByObserver,
            throttleEventsByObserver,
        }
    }

    private recomputeTimeline(timeline: BattleEpochTimeline): DesyncFirstReport | null {
        const sortedFrames = [...timeline.observedFrames].sort((a, b) => a - b)
        const expectedObservers = this.getExpectedObserverIds()
        let candidateReport: DesyncFirstReport | null = null

        for (const frame of sortedFrames) {
            const observedObservers: string[] = []
            for (const obsId of expectedObservers) {
                if (timeline.framesByObserver.get(obsId)?.has(frame)) {
                    observedObservers.push(obsId)
                }
            }
            for (const obsId of timeline.framesByObserver.keys()) {
                if (!observedObservers.includes(obsId) && timeline.framesByObserver.get(obsId)?.has(frame)) {
                    observedObservers.push(obsId)
                }
            }
            if (observedObservers.length < 2) continue

            const evaluation = this.evaluateFrame(timeline, frame, expectedObservers, observedObservers)
            if (evaluation) {
                candidateReport = evaluation
                break
            }
        }

        if (!candidateReport) return null

        const prevBest = timeline.bestReport
        const shouldEmit = !prevBest
            || candidateReport.postFrame < prevBest.postFrame
            || (!prevBest.confirmed && candidateReport.confirmed)
            || prevBest.layer !== candidateReport.layer
            || prevBest.fieldPath !== candidateReport.fieldPath
            || prevBest.completeness !== candidateReport.completeness

        timeline.bestReport = candidateReport
        if (!this.firstReport
            || candidateReport.postFrame < this.firstReport.postFrame
            || (candidateReport.postFrame === this.firstReport.postFrame && !this.firstReport.confirmed && candidateReport.confirmed)
            || (this.firstReport.battleId === candidateReport.battleId && this.firstReport.battleEpoch === candidateReport.battleEpoch)) {
            this.firstReport = candidateReport
        }

        const signature = `${candidateReport.battleId}#${candidateReport.battleEpoch}@${candidateReport.postFrame}:${candidateReport.layer}:${candidateReport.fieldPath}:${candidateReport.status}:${candidateReport.completeness}`
        if (shouldEmit && timeline.emittedSignature !== signature) {
            const isFirstForBattle = timeline.emittedSignature === null
            timeline.emittedSignature = signature
            this.onDesyncReport?.(candidateReport, isFirstForBattle)
        }
        return candidateReport
    }

    private isCompactInputWindowComparable(
        timeline: BattleEpochTimeline,
        frame: number,
        observedObservers: string[],
        obsAtFrame: Map<string, ReconstructedFrameObservation>,
    ): boolean {
        if (observedObservers.length < 2) return false
        let commonPrevCheckpoint: number | null | undefined = undefined
        for (const obsId of observedObservers) {
            const obs = obsAtFrame.get(obsId)
            if (!obs || !obs.inputSummary) return false
            const prevCp = obs.previousCheckpointFrame ?? null
            if (commonPrevCheckpoint === undefined) {
                commonPrevCheckpoint = prevCp
            } else if (prevCp !== commonPrevCheckpoint) {
                // Different accumulation windows (e.g. adaptive throttling on one observer)
                return false
            }
            // If previousCheckpointFrame >= 0 and this observer has earlier rows, ensure prevCp wasn't a failed/missed checkpoint
            const obsFrames = timeline.framesByObserver.get(obsId)
            if (prevCp !== null && prevCp >= 0 && obsFrames) {
                const hasEarlierFrame = [...obsFrames.keys()].some(f => f < frame)
                if (hasEarlierFrame && !obsFrames.has(prevCp)) {
                    return false
                }
            }
            // Check for any gap in (prevCp, frame] on this observer
            const windowStart = prevCp !== null && prevCp >= 0 ? prevCp : 0
            for (const gap of this.gapsByObserver.get(obsId) ?? []) {
                if (gap.battleId !== null && gap.battleId !== timeline.battleId) continue
                if (gap.battleEpoch !== null && gap.battleEpoch !== timeline.battleEpoch) continue
                if (gap.fromFrame !== null && gap.fromFrame > frame) continue
                if (gap.toFrame !== null && gap.toFrame <= windowStart && gap.reason !== "initial_missing") continue
                if (gap.reason === "initial_missing" && windowStart > 0) continue
                return false
            }
        }
        return true
    }

    private evaluateFrame(
        timeline: BattleEpochTimeline,
        frame: number,
        expectedObservers: string[],
        observedObservers: string[],
    ): DesyncFirstReport | null {
        const allObserverOrder = expectedObservers.length > 0
            ? [...expectedObservers, ...observedObservers.filter(id => !expectedObservers.includes(id))]
            : [...observedObservers]

        const obsAtFrame = new Map<string, ReconstructedFrameObservation>()
        for (const obsId of observedObservers) {
            const obs = timeline.framesByObserver.get(obsId)?.get(frame)
            if (obs) obsAtFrame.set(obsId, obs)
        }

        const isCompactV2 = this.identity.schema === "coop-state-fingerprint-compact-v2"
            || [...obsAtFrame.values()].some(
                o => o.schema === "coop-state-fingerprint-compact-v2" || o.inputSummary != null,
            )

        const valueMapFor = (getter: (obs: ReconstructedFrameObservation, obsId: string) => unknown): Record<string, unknown> => {
            const out: Record<string, unknown> = {}
            for (const obsId of allObserverOrder) {
                const obs = obsAtFrame.get(obsId)
                out[obsId] = obs ? getter(obs, obsId) : MISSING_OBSERVER_SENTINEL
            }
            return out
        }

        // === Layer 1: Initial Values ===
        const initialDiffs: FieldDiffEntry[] = []
        if (frame === 0) {
            const allKeys = new Set<string>()
            for (const obs of obsAtFrame.values()) {
                for (const key of obs.state.keys()) allKeys.add(key)
            }
            const sortedKeys = [...allKeys].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
            for (const fieldPath of sortedKeys) {
                const valuesByObserver = valueMapFor(obs => obs.state.has(fieldPath) ? obs.state.get(fieldPath) : UNSET_SENTINEL)
                if (!allObserversEqual(observedObservers, valuesByObserver)) {
                    initialDiffs.push({ layer: "initial", fieldPath, valuesByObserver })
                }
            }
        } else if (!isCompactV2) {
            // Check initial seed fields if frame 0 was missing on any observer (v1)
            const frame0AllPresent = observedObservers.every(obsId => timeline.framesByObserver.get(obsId)?.has(0))
            if (!frame0AllPresent) {
                for (const fieldPath of INITIAL_SEED_PATHS) {
                    const valuesByObserver = valueMapFor(obs => obs.state.has(fieldPath) ? obs.state.get(fieldPath) : UNSET_SENTINEL)
                    if (!allObserversEqual(observedObservers, valuesByObserver)) {
                        initialDiffs.push({ layer: "initial", fieldPath, valuesByObserver })
                    }
                }
            }
        }

        // === Layer 2: User & Speed Inputs ===
        const userSpeedDiffs: FieldDiffEntry[] = []
        const userSpeedByObserver: Record<string, {
            userInputs: unknown[]
            speedApplied: unknown[]
            speedReceived: unknown[]
            routeEvents: unknown[]
            inputSummary?: CompactInputSummary | null
            routeSummary?: CompactRouteSummary | null
        }> = {}

        // === Layer 3: Applied Coop & Combined Inputs ===
        const coopInputDiffs: FieldDiffEntry[] = []
        const coopInputByObserver: Record<string, {
            coopInputs: unknown[]
            allInputs: unknown[]
            inputSummary?: CompactInputSummary | null
        }> = {}

        const inputWindowComparable = isCompactV2
            ? this.isCompactInputWindowComparable(timeline, frame, observedObservers, obsAtFrame)
            : true

        if (isCompactV2) {
            for (const obsId of allObserverOrder) {
                const obs = obsAtFrame.get(obsId)
                const events = this.eventsByObserver.get(obsId) ?? []
                const speedApplied = events
                    .filter(ev => ev.stage === "speed_applied"
                        && (ev.battleId === timeline.battleId || ev.detail.targetOtherBattleId === timeline.battleId)
                        && (ev.battleEpoch === null || ev.battleEpoch === timeline.battleEpoch))
                    .map(projectSpeedApplied)
                const speedReceived = events
                    .filter(ev => ev.stage === "speed_received"
                        && (ev.battleId === timeline.battleId || ev.detail.targetOtherBattleId === timeline.battleId))
                const routeEvents = events
                    .filter(ev => (ev.stage === "route_received" || ev.stage === "route_decoded" || ev.stage === "route_rejected")
                        && (ev.battleId === null || ev.battleId === timeline.battleId || ev.sourceBattleId === timeline.battleId))

                userSpeedByObserver[obsId] = {
                    userInputs: [],
                    speedApplied,
                    speedReceived,
                    routeEvents,
                    inputSummary: obs?.inputSummary ?? null,
                    routeSummary: obs?.routeSummary ?? null,
                }
                coopInputByObserver[obsId] = {
                    coopInputs: [],
                    allInputs: [],
                    inputSummary: obs?.inputSummary ?? null,
                }
            }

            if (inputWindowComparable) {
                // Compare User input counts and User.* top-level kind counts in Layer 2 (user_speed)
                const userCountMap = valueMapFor(obs => obs.inputSummary ? obs.inputSummary.user : UNSET_SENTINEL)
                if (!allObserversEqual(observedObservers, userCountMap)) {
                    userSpeedDiffs.push({
                        layer: "user_speed",
                        fieldPath: "/inputSummary/user",
                        valuesByObserver: userCountMap,
                    })
                }
                const userKindKeys = new Set<string>()
                for (const obs of obsAtFrame.values()) {
                    if (!obs.inputSummary) continue
                    for (const k of Object.keys(obs.inputSummary.kinds)) {
                        if (k.startsWith("User.")) userKindKeys.add(k)
                    }
                }
                for (const k of [...userKindKeys].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
                    const kindMap = valueMapFor(obs => obs.inputSummary ? (obs.inputSummary.kinds[k] ?? 0) : UNSET_SENTINEL)
                    if (!allObserversEqual(observedObservers, kindMap)) {
                        userSpeedDiffs.push({
                            layer: "user_speed",
                            fieldPath: `/inputSummary/kinds/${k}`,
                            valuesByObserver: kindMap,
                        })
                    }
                }

                // Compare Coop input counts, Coop.* kinds, total count, unknown/readErrors, first/last frame, and orderedHash in Layer 3 (coop_input)
                const coopCountMap = valueMapFor(obs => obs.inputSummary ? obs.inputSummary.coop : UNSET_SENTINEL)
                if (!allObserversEqual(observedObservers, coopCountMap)) {
                    coopInputDiffs.push({
                        layer: "coop_input",
                        fieldPath: "/inputSummary/coop",
                        valuesByObserver: coopCountMap,
                    })
                }
                const coopKindKeys = new Set<string>()
                const otherKindKeys = new Set<string>()
                for (const obs of obsAtFrame.values()) {
                    if (!obs.inputSummary) continue
                    for (const k of Object.keys(obs.inputSummary.kinds)) {
                        if (k.startsWith("Coop.")) coopKindKeys.add(k)
                        else if (!k.startsWith("User.")) otherKindKeys.add(k)
                    }
                }
                for (const k of [...coopKindKeys].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
                    const kindMap = valueMapFor(obs => obs.inputSummary ? (obs.inputSummary.kinds[k] ?? 0) : UNSET_SENTINEL)
                    if (!allObserversEqual(observedObservers, kindMap)) {
                        coopInputDiffs.push({
                            layer: "coop_input",
                            fieldPath: `/inputSummary/kinds/${k}`,
                            valuesByObserver: kindMap,
                        })
                    }
                }
                for (const fieldName of ["count", "unknown", "readErrors"] as const) {
                    const fMap = valueMapFor(obs => obs.inputSummary ? obs.inputSummary[fieldName] : UNSET_SENTINEL)
                    if (!allObserversEqual(observedObservers, fMap)) {
                        coopInputDiffs.push({
                            layer: "coop_input",
                            fieldPath: `/inputSummary/${fieldName}`,
                            valuesByObserver: fMap,
                        })
                    }
                }
                for (const k of [...otherKindKeys].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
                    const kindMap = valueMapFor(obs => obs.inputSummary ? (obs.inputSummary.kinds[k] ?? 0) : UNSET_SENTINEL)
                    if (!allObserversEqual(observedObservers, kindMap)) {
                        coopInputDiffs.push({
                            layer: "coop_input",
                            fieldPath: `/inputSummary/kinds/${k}`,
                            valuesByObserver: kindMap,
                        })
                    }
                }
                for (const fieldName of ["firstFrame", "lastFrame", "orderedHash"] as const) {
                    const fMap = valueMapFor(obs => obs.inputSummary ? obs.inputSummary[fieldName] : UNSET_SENTINEL)
                    if (!allObserversEqual(observedObservers, fMap)) {
                        coopInputDiffs.push({
                            layer: "coop_input",
                            fieldPath: `/inputSummary/${fieldName}`,
                            valuesByObserver: fMap,
                        })
                    }
                }
            }
        } else {
            const applyTargetFrame = frame === 0 ? -1 : frame - 1
            let maxUserLen = 0
            let maxSpeedAppliedLen = 0

            for (const obsId of allObserverOrder) {
                const obs = obsAtFrame.get(obsId)
                const userInputs = obs ? obs.inputs.filter(i => i.kind === "User").map(projectUserInput) : []
                const events = this.eventsByObserver.get(obsId) ?? []
                const speedApplied = events
                    .filter(ev => ev.stage === "speed_applied"
                        && ev.targetFrame === applyTargetFrame
                        && (ev.battleId === timeline.battleId || ev.detail.targetOtherBattleId === timeline.battleId)
                        && (ev.battleEpoch === null || ev.battleEpoch === timeline.battleEpoch))
                    .map(projectSpeedApplied)
                const speedReceived = events
                    .filter(ev => ev.stage === "speed_received"
                        && (ev.battleId === timeline.battleId || ev.detail.targetOtherBattleId === timeline.battleId))
                const routeEvents = events
                    .filter(ev => (ev.stage === "route_received" || ev.stage === "route_decoded" || ev.stage === "route_rejected")
                        && (ev.battleId === null || ev.battleId === timeline.battleId || ev.sourceBattleId === timeline.battleId))

                userSpeedByObserver[obsId] = { userInputs, speedApplied, speedReceived, routeEvents }
                if (obs) {
                    if (userInputs.length > maxUserLen) maxUserLen = userInputs.length
                    if (speedApplied.length > maxSpeedAppliedLen) maxSpeedAppliedLen = speedApplied.length
                }
            }

            for (let i = 0; i < maxUserLen; i++) {
                const cmdMap = valueMapFor((_obs, obsId) => {
                    const item = userSpeedByObserver[obsId].userInputs[i] as ReturnType<typeof projectUserInput> | undefined
                    return item ? item.command : UNSET_SENTINEL
                })
                if (!allObserversEqual(observedObservers, cmdMap)) {
                    userSpeedDiffs.push({ layer: "user_speed", fieldPath: `/inputs/user/${i}/command`, valuesByObserver: cmdMap })
                    continue
                }
                const itemMap = valueMapFor((_obs, obsId) => userSpeedByObserver[obsId].userInputs[i] ?? UNSET_SENTINEL)
                if (!allObserversEqual(observedObservers, itemMap)) {
                    userSpeedDiffs.push({ layer: "user_speed", fieldPath: `/inputs/user/${i}`, valuesByObserver: itemMap })
                }
            }
            const userLenMap = valueMapFor((_obs, obsId) => userSpeedByObserver[obsId].userInputs.length)
            if (!allObserversEqual(observedObservers, userLenMap)) {
                userSpeedDiffs.push({ layer: "user_speed", fieldPath: "/inputs/user/length", valuesByObserver: userLenMap })
            }

            for (let i = 0; i < maxSpeedAppliedLen; i++) {
                const cmdMap = valueMapFor((_obs, obsId) => {
                    const item = userSpeedByObserver[obsId].speedApplied[i] as ReturnType<typeof projectSpeedApplied> | undefined
                    return item ? item.command : UNSET_SENTINEL
                })
                if (!allObserversEqual(observedObservers, cmdMap)) {
                    userSpeedDiffs.push({ layer: "user_speed", fieldPath: `/events/speed_applied/${i}/command`, valuesByObserver: cmdMap })
                    continue
                }
                const itemMap = valueMapFor((_obs, obsId) => userSpeedByObserver[obsId].speedApplied[i] ?? UNSET_SENTINEL)
                if (!allObserversEqual(observedObservers, itemMap)) {
                    userSpeedDiffs.push({ layer: "user_speed", fieldPath: `/events/speed_applied/${i}`, valuesByObserver: itemMap })
                }
            }
            const speedLenMap = valueMapFor((_obs, obsId) => userSpeedByObserver[obsId].speedApplied.length)
            if (!allObserversEqual(observedObservers, speedLenMap)) {
                userSpeedDiffs.push({ layer: "user_speed", fieldPath: "/events/speed_applied/length", valuesByObserver: speedLenMap })
            }

            let maxCoopLen = 0
            let maxAllLen = 0

            for (const obsId of allObserverOrder) {
                const obs = obsAtFrame.get(obsId)
                const coopInputs = obs ? obs.inputs.filter(i => i.kind === "Coop").map(projectCoopInput) : []
                const allInputs = obs ? obs.inputs.map(projectAllInput) : []
                coopInputByObserver[obsId] = { coopInputs, allInputs }
                if (obs) {
                    if (coopInputs.length > maxCoopLen) maxCoopLen = coopInputs.length
                    if (allInputs.length > maxAllLen) maxAllLen = allInputs.length
                }
            }

            for (let i = 0; i < maxCoopLen; i++) {
                const cmdMap = valueMapFor((_obs, obsId) => {
                    const item = coopInputByObserver[obsId].coopInputs[i] as ReturnType<typeof projectCoopInput> | undefined
                    return item ? item.command : UNSET_SENTINEL
                })
                if (!allObserversEqual(observedObservers, cmdMap)) {
                    coopInputDiffs.push({ layer: "coop_input", fieldPath: `/inputs/coop/${i}/command`, valuesByObserver: cmdMap })
                    continue
                }
                const itemMap = valueMapFor((_obs, obsId) => coopInputByObserver[obsId].coopInputs[i] ?? UNSET_SENTINEL)
                if (!allObserversEqual(observedObservers, itemMap)) {
                    coopInputDiffs.push({ layer: "coop_input", fieldPath: `/inputs/coop/${i}`, valuesByObserver: itemMap })
                }
            }
            const coopLenMap = valueMapFor((_obs, obsId) => coopInputByObserver[obsId].coopInputs.length)
            if (!allObserversEqual(observedObservers, coopLenMap)) {
                coopInputDiffs.push({ layer: "coop_input", fieldPath: "/inputs/coop/length", valuesByObserver: coopLenMap })
            }

            // Check combined input ordering if User and Coop lists matched individually
            if (userSpeedDiffs.length === 0 && coopInputDiffs.length === 0) {
                for (let i = 0; i < maxAllLen; i++) {
                    const ordMap = valueMapFor((_obs, obsId) => coopInputByObserver[obsId].allInputs[i] ?? UNSET_SENTINEL)
                    if (!allObserversEqual(observedObservers, ordMap)) {
                        coopInputDiffs.push({ layer: "coop_input", fieldPath: `/inputs/${i}`, valuesByObserver: ordMap })
                    }
                }
            }
        }

        // === Layer 4: State ===
        const stateDiffs: FieldDiffEntry[] = []
        if (frame > 0) {
            const allKeys = new Set<string>()
            for (const obs of obsAtFrame.values()) {
                for (const key of obs.state.keys()) allKeys.add(key)
            }
            const sortedKeys = [...allKeys].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
            for (const fieldPath of sortedKeys) {
                const valuesByObserver = valueMapFor(obs => obs.state.has(fieldPath) ? obs.state.get(fieldPath) : UNSET_SENTINEL)
                if (!allObserversEqual(observedObservers, valuesByObserver)) {
                    stateDiffs.push({ layer: "state", fieldPath, valuesByObserver })
                }
            }
            if (stateDiffs.length === 0) {
                const zoneMap = valueMapFor(obs => obs.zone)
                if (!allObserversEqual(observedObservers, zoneMap)) {
                    stateDiffs.push({ layer: "state", fieldPath: "/battle/currentZoneIndex", valuesByObserver: zoneMap })
                }
                const floorMap = valueMapFor(obs => obs.floor)
                if (!allObserversEqual(observedObservers, floorMap)) {
                    stateDiffs.push({ layer: "state", fieldPath: "/battle/floor", valuesByObserver: floorMap })
                }
            }
        }

        const totalDiffs = initialDiffs.length + userSpeedDiffs.length + coopInputDiffs.length + stateDiffs.length
        if (totalDiffs === 0) return null

        // Determine primary layer and attribution in strict 4-layer order:
        // initial -> user_speed -> coop_input -> state
        let primaryLayer: FingerprintLayer
        let attribution: FingerprintAttribution
        let primaryDiff: FieldDiffEntry

        if (initialDiffs.length > 0) {
            primaryLayer = "initial"
            attribution = "initial_state"
            primaryDiff = initialDiffs[0]
        } else if (userSpeedDiffs.length > 0) {
            primaryLayer = "user_speed"
            attribution = "user_or_speed_input"
            primaryDiff = userSpeedDiffs[0]
        } else if (coopInputDiffs.length > 0) {
            primaryLayer = "coop_input"
            attribution = "coop_input_schedule"
            primaryDiff = coopInputDiffs[0]
        } else {
            primaryLayer = "state"
            attribution = "simulation_determinism"
            primaryDiff = stateDiffs[0]
        }

        // Compute completeness and incompleteReasons
        const incompleteReasonSet = new Set<string>()
        const missingObservers: string[] = []
        const completenessTargetObservers = expectedObservers.length > 0 ? expectedObservers : observedObservers

        if (completenessTargetObservers.length < 2) {
            incompleteReasonSet.add("insufficient_expected_observers")
        }

        let hasUnsupportedOrNullCausal = false

        for (const obsId of completenessTargetObservers) {
            const obsFrames = timeline.framesByObserver.get(obsId)
            if (!obsFrames || !obsFrames.has(frame)) {
                missingObservers.push(obsId)
                incompleteReasonSet.add(`missing_observer:${obsId}`)
            }
            const initialObs = obsFrames?.get(0)
            if (!initialObs || initialObs.phase !== "initial") {
                incompleteReasonSet.add("initial_missing")
            }
            if (obsFrames) {
                if (isCompactV2) {
                    const observedUpToFrame = [...obsFrames.keys()].filter(f => f <= frame).sort((a, b) => a - b)
                    for (let idx = 0; idx < observedUpToFrame.length; idx++) {
                        const f = observedUpToFrame[idx]
                        const fObs = obsFrames.get(f)!
                        if (f > 0 && fObs.previousCheckpointFrame !== null && fObs.previousCheckpointFrame !== undefined) {
                            if (
                                fObs.previousCheckpointFrame < 0
                                || !obsFrames.has(fObs.previousCheckpointFrame)
                                || (idx > 0 && fObs.previousCheckpointFrame !== observedUpToFrame[idx - 1])
                            ) {
                                incompleteReasonSet.add(`missing_checkpoint:${obsId}@${fObs.previousCheckpointFrame}`)
                            }
                        }
                        if (!fObs.eventContextComplete) {
                            incompleteReasonSet.add(`event_loss:${obsId}`)
                        }
                        if (fObs.unsupported.length > 0) {
                            hasUnsupportedOrNullCausal = true
                        }
                        if (fObs.inputSummary) {
                            if (fObs.inputSummary.readErrors > 0) {
                                incompleteReasonSet.add(`input_read_error:${obsId}@${f}`)
                            }
                            if (fObs.inputSummary.unknown > 0) {
                                incompleteReasonSet.add(`input_unknown:${obsId}@${f}`)
                            }
                        }
                    }
                } else {
                    // Check contiguous frames 0..frame for v1
                    for (let f = 0; f <= frame; f++) {
                        const fObs = obsFrames.get(f)
                        if (!fObs) {
                            incompleteReasonSet.add(`missing_frame:${obsId}@${f}`)
                            break
                        }
                        if (!fObs.eventContextComplete) {
                            incompleteReasonSet.add(`event_loss:${obsId}`)
                        }
                        if (fObs.unsupported.length > 0) {
                            hasUnsupportedOrNullCausal = true
                        }
                        for (const inp of fObs.inputs) {
                            if (inp.command === null) {
                                incompleteReasonSet.add(`unsupported_input_command:${obsId}@${f}`)
                            }
                            if (inp.kind === "Coop" && inp.sourceBattleEpoch === null) {
                                hasUnsupportedOrNullCausal = true
                            }
                        }
                    }
                }
            }
            // Check client/server gaps for this observer
            for (const gap of this.gapsByObserver.get(obsId) ?? []) {
                if (gap.battleId !== null && gap.battleId !== timeline.battleId) continue
                if (gap.battleEpoch !== null && gap.battleEpoch !== timeline.battleEpoch) continue
                if (gap.fromFrame !== null && gap.fromFrame > frame) continue
                incompleteReasonSet.add(gap.reason)
            }
            for (const issue of this.observerIssues.get(obsId) ?? []) {
                incompleteReasonSet.add(issue)
            }
            if (this.observerPendingSeqs.has(obsId)) {
                incompleteReasonSet.add(`pending_fragments_or_seq:${obsId}`)
            }
        }

        // Compute lastEqualFrame across common observed frames < frame
        let lastEqualFrame: number | null = null
        const earlierFrames = [...timeline.observedFrames].filter(f => f < frame).sort((a, b) => b - a)
        for (const f of earlierFrames) {
            const allHaveFrame = completenessTargetObservers.length >= 2
                && completenessTargetObservers.every(obsId => timeline.framesByObserver.get(obsId)?.has(f))
            if (allHaveFrame) {
                lastEqualFrame = f
                break
            }
        }

        const incompleteReasons = [...incompleteReasonSet]
        let completeness: FingerprintCompleteness
        let status: "confirmed" | "candidate_incomplete"
        let confirmed: boolean

        if (incompleteReasons.length > 0) {
            completeness = "incomplete"
            status = "candidate_incomplete"
            confirmed = false
        } else if (hasUnsupportedOrNullCausal) {
            completeness = "partial_observed"
            status = "confirmed"
            confirmed = true
        } else {
            completeness = "complete"
            status = "confirmed"
            confirmed = true
        }

        const eventCursors: Record<string, number | null> = {}
        const packetSeqs: Record<string, number | null> = {}
        const unsupportedByObserver: Record<string, UnsupportedFieldEntry[]> = {}
        const groupHashesByObserver: Record<string, Record<string, string>> = {}
        const userInputsByObserver: Record<string, unknown[]> = {}
        const coopInputsByObserver: Record<string, unknown[]> = {}
        const speedEventsByObserver: Record<string, unknown[]> = {}
        const routeEventsByObserver: Record<string, unknown[]> = {}
        const gapsByObserver: Record<string, NormalizedGapEntry[]> = {}
        const inputSummaryByObserver: Record<string, CompactInputSummary | null> = {}
        const routeSummaryByObserver: Record<string, CompactRouteSummary | null> = {}
        const sampleIntervalByObserver: Record<string, number | null> = {}
        const previousCheckpointFrameByObserver: Record<string, number | null> = {}
        const throttleEventsByObserver: Record<string, NormalizedEventEntry[]> = {}

        for (const obsId of allObserverOrder) {
            const obs = obsAtFrame.get(obsId)
            eventCursors[obsId] = obs ? obs.eventCursor : null
            packetSeqs[obsId] = obs ? obs.seq : null
            unsupportedByObserver[obsId] = obs ? obs.unsupported : []
            groupHashesByObserver[obsId] = obs ? obs.groupHashes : {}
            userInputsByObserver[obsId] = userSpeedByObserver[obsId]?.userInputs ?? []
            coopInputsByObserver[obsId] = coopInputByObserver[obsId]?.coopInputs ?? []
            speedEventsByObserver[obsId] = [
                ...(userSpeedByObserver[obsId]?.speedApplied ?? []),
                ...(userSpeedByObserver[obsId]?.speedReceived ?? []),
            ]
            routeEventsByObserver[obsId] = userSpeedByObserver[obsId]?.routeEvents ?? []
            gapsByObserver[obsId] = (this.gapsByObserver.get(obsId) ?? []).filter(
                g => (g.battleId === null || g.battleId === timeline.battleId)
                    && (g.battleEpoch === null || g.battleEpoch === timeline.battleEpoch),
            )
            inputSummaryByObserver[obsId] = obs?.inputSummary ?? null
            routeSummaryByObserver[obsId] = obs?.routeSummary ?? null
            sampleIntervalByObserver[obsId] = obs?.sampleInterval ?? null
            previousCheckpointFrameByObserver[obsId] = obs?.previousCheckpointFrame ?? null
            throttleEventsByObserver[obsId] = (this.eventsByObserver.get(obsId) ?? []).filter(
                ev => ev.stage === "lifecycle"
                    && ev.detail.reason === "throttle"
                    && (ev.battleId === null || ev.battleId === timeline.battleId)
                    && (ev.battleEpoch === null || ev.battleEpoch === timeline.battleEpoch)
                    && (ev.targetFrame === null || ev.targetFrame <= frame),
            )
        }

        const valuePairs = allObserverOrder
            .map(obsId => `${obsId}=${formatSummaryValue(primaryDiff.valuesByObserver[obsId])}`)
            .join(",")
        const summary = `${timeline.battleId}@${frame} ${primaryDiff.fieldPath}: ${valuePairs}`

        const allDiffFields: FieldDiffEntry[] = [
            ...initialDiffs,
            ...userSpeedDiffs,
            ...coopInputDiffs,
            ...stateDiffs,
        ]

        const phase: "initial" | "post" = frame === 0 ? "initial" : "post"
        const contextPayload: DesyncFirstReport["context"] = {
            userInputsByObserver,
            coopInputsByObserver,
            speedEventsByObserver,
            routeEventsByObserver,
            gapsByObserver,
        }
        if (isCompactV2) {
            contextPayload.inputSummaryByObserver = inputSummaryByObserver
            contextPayload.routeSummaryByObserver = routeSummaryByObserver
            contextPayload.sampleIntervalByObserver = sampleIntervalByObserver
            contextPayload.previousCheckpointFrameByObserver = previousCheckpointFrameByObserver
            contextPayload.throttleEventsByObserver = throttleEventsByObserver
            contextPayload.summaryCoverage = {
                note: "compact-v2 top-level summary",
                inputSummary: "top_level_only",
                routeSummary: "top_level_only",
                inputWindowComparable,
            }
        }

        return {
            runId: this.identity.runId,
            roomNumber: this.identity.roomNumber,
            roomInstanceId: this.identity.roomInstanceId,
            battleSessionId: this.identity.battleSessionId,
            generation: this.identity.generation,
            sceneEpoch: this.identity.sceneEpoch,
            schema: this.identity.schema,
            battleId: timeline.battleId,
            battleEpoch: timeline.battleEpoch,
            postFrame: frame,
            frame,
            phase,
            status,
            confirmed,
            completeness,
            complete: completeness === "complete",
            incompleteReasons,
            layer: primaryLayer,
            attribution,
            fieldPath: primaryDiff.fieldPath,
            field: primaryDiff.fieldPath,
            observerValues: primaryDiff.valuesByObserver,
            valuesByObserver: primaryDiff.valuesByObserver,
            summary,
            lastEqualFrame,
            expectedObservers: [...completenessTargetObservers],
            observedObservers: [...observedObservers],
            missingObservers,
            eventCursors,
            packetSeqs,
            unsupportedByObserver,
            groupHashesByObserver,
            allDiffFields,
            layers: {
                initial: {
                    equal: initialDiffs.length === 0,
                    diffs: initialDiffs,
                },
                userSpeed: {
                    equal: userSpeedDiffs.length === 0,
                    diffs: userSpeedDiffs,
                    byObserver: userSpeedByObserver,
                },
                coopInput: {
                    equal: coopInputDiffs.length === 0,
                    diffs: coopInputDiffs,
                    byObserver: coopInputByObserver,
                },
                state: {
                    equal: stateDiffs.length === 0 && (frame > 0 || initialDiffs.length === 0),
                    diffs: frame === 0 ? initialDiffs : stateDiffs,
                },
            },
            context: contextPayload,
        }
    }
}
