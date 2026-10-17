// One compact summary per multiplayer battle for diagnosing disconnects and lag.
//
// Hot-path calls only update counters on an object that already exists. Nothing
// here touches SQLite, copies packets or logs per frame; a battle produces one
// `[MULTI-BATTLE]` line when its room leaves BATTLE. The recent summaries are
// also kept in a small ring for the management diagnostics endpoint.
import { monitorEventLoopDelay, type IntervalHistogram } from "node:perf_hooks"
import { registerMemoryCounters } from "../lib/memory-diagnostics"
import { BoundedLatencyHistogram } from "./latency-statistics"

export type BattleControlDelayKind = "relay-control" | "member-sync" | "parent-dispatch" | "relay-data-ack"
const CONTROL_DELAY_KINDS = new Set<BattleControlDelayKind>(["relay-control", "member-sync", "parent-dispatch", "relay-data-ack"])

interface MemberStats {
    viewer: number
    connections: number
    packets: number
    broadcasts: number
    sceneReady: number
    levelNext: number
    finalize: number
    lineSpeedWarnings: number
    /** Longest inbound silence, including the tail up to disconnect or battle end. */
    maxInboundGapMs: number
    lastInboundAt: number
    relayedOut: number
    backpressureEpisodes: number
    maxBackpressureMs: number
    disconnects: Record<string, number>
}

interface BattleSession {
    room: string
    battle: string
    category: number
    quest: number
    fiveBoss: boolean
    startedAt: number
    realMembers: number
    aiMembers: number
    members: Map<number, MemberStats>
    barriers: Array<{ kind: string; waitMs: number }>
    seatsExpired: number
    loopLagMaxMs: number
    /** One-second windows whose worst event-loop delay reached 200 ms. */
    loopStalledSeconds: number
    controlDelays: Map<BattleControlDelayKind, BoundedLatencyHistogram>
}

export interface BattleTelemetrySummary {
    at: string
    room: string
    battle: string
    category: number
    quest: number
    fiveBoss: boolean
    end: string
    durationMs: number
    realMembers: number
    aiMembers: number
    barriers: Array<{ kind: string; waitMs: number }>
    seatsExpired: number
    loopLagMaxMs: number
    loopStalledSeconds: number
    members: Array<Omit<MemberStats, "lastInboundAt">>
    /** Server-local monotonic spans, never player TCP RTT or one-way latency. */
    serverControlDelayMs: Partial<Record<BattleControlDelayKind, ReturnType<BoundedLatencyHistogram["snapshot"]>>>
}

function positiveInteger(name: string, fallback: number, min: number, max: number): number {
    const parsed = Number.parseInt(process.env[name] ?? "", 10)
    return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback
}

function enabled(): boolean {
    return !/^(0|false|no|off)$/i.test(process.env.MULTI_BATTLE_TELEMETRY ?? "true")
}

const LAG_SAMPLE_MS = 1_000
const MAX_BARRIERS = 8

export class BattleTelemetry {
    private readonly sessions = new Map<string, BattleSession>()
    private readonly recent: BattleTelemetrySummary[] = []
    private lagTimer: NodeJS.Timeout | null = null
    private lagHistogram: IntervalHistogram | null = null

    constructor(
        private readonly now: () => number = Date.now,
        private readonly emit: (line: string) => void = line => console.warn(line),
        private readonly maxRecent = positiveInteger("MULTI_BATTLE_TELEMETRY_RECENT", 100, 0, 1_000),
    ) {}

    begin(room: {
        room_number: string
        category: number
        quest_id: number
        lifecycle?: { battleSessionId?: string | null }
        mates?: Array<{ viewer_id: number | null; com_id: number }>
        five_boss_runtime?: unknown
    }): void {
        if (!enabled()) return
        const mates = Array.isArray(room.mates) ? room.mates : []
        this.sessions.set(room.room_number, {
            room: room.room_number,
            battle: String(room.lifecycle?.battleSessionId ?? ""),
            category: Number(room.category),
            quest: Number(room.quest_id),
            fiveBoss: !!room.five_boss_runtime,
            startedAt: this.now(),
            realMembers: mates.filter(mate => !mate.com_id).length,
            aiMembers: mates.filter(mate => !!mate.com_id).length,
            members: new Map(),
            barriers: [],
            seatsExpired: 0,
            loopLagMaxMs: 0,
            loopStalledSeconds: 0,
            controlDelays: new Map(),
        })
        this.ensureLagSampler()
    }

    end(roomNumber: string, reason: string): BattleTelemetrySummary | undefined {
        const session = this.sessions.get(roomNumber)
        if (!session) return undefined
        const endedAt = this.now()
        for (const member of session.members.values()) this.observeInboundGap(member, endedAt)
        this.sampleLag()
        this.sessions.delete(roomNumber)
        if (this.sessions.size === 0) this.stopLagSampler()
        const summary: BattleTelemetrySummary = {
            at: new Date(endedAt).toISOString(),
            room: session.room,
            battle: session.battle,
            category: session.category,
            quest: session.quest,
            fiveBoss: session.fiveBoss,
            end: reason,
            durationMs: endedAt - session.startedAt,
            realMembers: session.realMembers,
            aiMembers: session.aiMembers,
            barriers: session.barriers,
            seatsExpired: session.seatsExpired,
            loopLagMaxMs: session.loopLagMaxMs,
            loopStalledSeconds: session.loopStalledSeconds,
            members: [...session.members.values()].map(({ lastInboundAt: _, ...member }) => member),
            serverControlDelayMs: Object.fromEntries([...session.controlDelays].map(([kind, histogram]) => [kind, histogram.snapshot()])),
        }
        if (this.maxRecent > 0) {
            this.recent.push(summary)
            if (this.recent.length > this.maxRecent) this.recent.shift()
        }
        try { this.emit(`[MULTI-BATTLE] ${JSON.stringify(summary)}`) } catch { /* never break the room */ }
        return summary
    }

    private member(roomNumber: string, viewer: number): MemberStats | undefined {
        const session = this.sessions.get(roomNumber)
        if (!session) return undefined
        let member = session.members.get(viewer)
        if (!member) {
            if (session.members.size >= 8) return undefined
            member = {
                viewer, connections: 0, packets: 0, broadcasts: 0, sceneReady: 0, levelNext: 0, finalize: 0,
                lineSpeedWarnings: 0, maxInboundGapMs: 0, lastInboundAt: 0, relayedOut: 0,
                backpressureEpisodes: 0, maxBackpressureMs: 0, disconnects: {},
            }
            session.members.set(viewer, member)
        }
        return member
    }

    connected(roomNumber: string, viewer: number): void {
        const member = this.member(roomNumber, viewer)
        if (!member) return
        const now = this.now()
        this.observeInboundGap(member, now)
        member.connections++
        member.lastInboundAt = now
    }

    private observeInboundGap(member: MemberStats, at: number): void {
        if (member.lastInboundAt <= 0) return
        member.maxInboundGapMs = Math.max(member.maxInboundGapMs, at - member.lastInboundAt)
    }

    /** transportTag: Client2Server index; notifyTag: BattleNotifyMessage index for Notify frames. */
    packet(roomNumber: string, viewer: number, transportTag: number, notifyTag?: number): void {
        const member = this.member(roomNumber, viewer)
        if (!member) return
        const now = this.now()
        this.observeInboundGap(member, now)
        member.lastInboundAt = now
        member.packets++
        if (transportTag === 1 || transportTag === 2) member.broadcasts++
        else if (transportTag === 0) {
            if (notifyTag === 0) member.sceneReady++
            else if (notifyTag === 1) member.levelNext++
            else if (notifyTag === 2) member.finalize++
            else if (notifyTag === 4) member.lineSpeedWarnings++
        }
    }

    /** Counts child-local traffic once; parent-forwarded frames use packet(). */
    relayActivity(roomNumber: string, viewer: number, activity: {
        packets: number; broadcasts: number; lineSpeedWarnings: number; maxGapMs: number; relayedOut: number
    }): void {
        const member = this.member(roomNumber, viewer)
        if (!member) return
        member.packets += activity.packets
        member.broadcasts += activity.broadcasts
        member.lineSpeedWarnings += activity.lineSpeedWarnings
        member.relayedOut += activity.relayedOut
        member.maxInboundGapMs = Math.max(member.maxInboundGapMs, activity.maxGapMs)
        if (activity.packets > 0) member.lastInboundAt = this.now()
    }

    relayed(roomNumber: string, viewer: number): void {
        const member = this.member(roomNumber, viewer)
        if (member) member.relayedOut++
    }

    backpressure(roomNumber: string | undefined, viewer: number | undefined, blockedMs: number): void {
        if (!roomNumber || !viewer) return
        const member = this.member(roomNumber, viewer)
        if (!member) return
        member.backpressureEpisodes++
        if (blockedMs > member.maxBackpressureMs) member.maxBackpressureMs = Math.round(blockedMs)
    }

    disconnected(roomNumber: string, viewer: number, reason: string): void {
        const member = this.member(roomNumber, viewer)
        if (!member) return
        this.observeInboundGap(member, this.now())
        // A departed member is no longer silent on an open battle connection.
        // Reconnecting begins a fresh interval in connected().
        member.lastInboundAt = 0
        member.disconnects[reason] = (member.disconnects[reason] ?? 0) + 1
    }

    barrier(roomNumber: string, kind: string, waitMs: number): void {
        const session = this.sessions.get(roomNumber)
        if (!session) return
        if (session.barriers.length >= MAX_BARRIERS) session.barriers.shift()
        session.barriers.push({ kind, waitMs: Math.round(waitMs) })
    }

    /** Caller owns both endpoints of this span on the same monotonic clock.
     * relay-control starts at parent receipt: it excludes pre-receipt IPC wait.
     * member-sync/data-ack may be bridge-local request-to-confirmation spans. */
    controlDelay(roomNumber: string, kind: BattleControlDelayKind, durationMs: number): void {
        const session = this.sessions.get(roomNumber)
        if (!session || !CONTROL_DELAY_KINDS.has(kind) || !Number.isFinite(durationMs) || durationMs < 0) return
        let histogram = session.controlDelays.get(kind)
        if (!histogram) {
            histogram = new BoundedLatencyHistogram()
            session.controlDelays.set(kind, histogram)
        }
        histogram.record(durationMs)
    }

    seatExpired(roomNumber: string): void {
        const session = this.sessions.get(roomNumber)
        if (session) session.seatsExpired++
    }

    recentSummaries(): BattleTelemetrySummary[] {
        return this.recent.map(summary => ({ ...summary }))
    }

    activeCount(): number {
        return this.sessions.size
    }

    // Event-loop delay is added to every relay, ack and heartbeat handled
    // meanwhile. The histogram is enabled only while a battle is active; each
    // one-second window's maximum is folded into every active battle.
    private ensureLagSampler(): void {
        if (this.lagTimer) return
        const histogram = monitorEventLoopDelay({ resolution: 10 })
        histogram.enable()
        this.lagHistogram = histogram
        this.lagTimer = setInterval(() => this.sampleLag(), LAG_SAMPLE_MS)
        this.lagTimer.unref()
    }

    private sampleLag(): void {
        const histogram = this.lagHistogram
        if (!histogram) return
        const maxMs = Math.round(histogram.max / 1e6)
        histogram.reset()
        if (!Number.isFinite(maxMs) || maxMs <= 0) return
        for (const session of this.sessions.values()) {
            if (maxMs > session.loopLagMaxMs) session.loopLagMaxMs = maxMs
            if (maxMs >= 200) session.loopStalledSeconds++
        }
    }

    private stopLagSampler(): void {
        if (this.lagTimer) clearInterval(this.lagTimer)
        this.lagTimer = null
        this.lagHistogram?.disable()
        this.lagHistogram = null
    }
}

export const battleTelemetry = new BattleTelemetry()
registerMemoryCounters("battleTelemetry", () => ({
    activeBattles: battleTelemetry.activeCount(),
}))
