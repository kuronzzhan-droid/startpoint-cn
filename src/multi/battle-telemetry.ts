// One compact summary per multiplayer battle for diagnosing disconnects and lag.
//
// Hot-path calls only update counters on an object that already exists. Nothing
// here touches SQLite, copies packets or logs per frame; a battle produces one
// `[MULTI-BATTLE]` line when its room leaves BATTLE. The recent summaries are
// also kept in a small ring for the management diagnostics endpoint.
import { monitorEventLoopDelay, type IntervalHistogram } from "node:perf_hooks"
import { registerMemoryCounters } from "../lib/memory-diagnostics"

interface MemberStats {
    viewer: number
    connections: number
    packets: number
    broadcasts: number
    sceneReady: number
    levelNext: number
    finalize: number
    lineSpeedWarnings: number
    /** Longest silence between two inbound frames, or from connect to first frame. */
    maxInboundGapMs: number
    /**
     * The longest inbound silences of at least 1 s: length, when it ended (ms
     * since the battle started) and which scene the member was in (0 = first,
     * counted by its LevelNext frames). Locates a silence at a scene change or
     * mid-fight.
     */
    longGaps: Array<{ ms: number; atMs: number; scene: number }>
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
/** Inbound silences at least this long are listed per member (top MAX_LONG_GAPS by length). */
const LONG_GAP_MS = 1_000
const MAX_LONG_GAPS = 3

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
        })
        this.ensureLagSampler()
    }

    end(roomNumber: string, reason: string): BattleTelemetrySummary | undefined {
        const session = this.sessions.get(roomNumber)
        if (!session) return undefined
        this.sampleLag()
        this.sessions.delete(roomNumber)
        if (this.sessions.size === 0) this.stopLagSampler()
        const summary: BattleTelemetrySummary = {
            at: new Date(this.now()).toISOString(),
            room: session.room,
            battle: session.battle,
            category: session.category,
            quest: session.quest,
            fiveBoss: session.fiveBoss,
            end: reason,
            durationMs: this.now() - session.startedAt,
            realMembers: session.realMembers,
            aiMembers: session.aiMembers,
            barriers: session.barriers,
            seatsExpired: session.seatsExpired,
            loopLagMaxMs: session.loopLagMaxMs,
            loopStalledSeconds: session.loopStalledSeconds,
            members: [...session.members.values()].map(({ lastInboundAt: _, ...member }) => member),
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
                lineSpeedWarnings: 0, maxInboundGapMs: 0, longGaps: [], lastInboundAt: 0, relayedOut: 0,
                backpressureEpisodes: 0, maxBackpressureMs: 0, disconnects: {},
            }
            session.members.set(viewer, member)
        }
        return member
    }

    connected(roomNumber: string, viewer: number): void {
        const member = this.member(roomNumber, viewer)
        if (!member) return
        member.connections++
        member.lastInboundAt = this.now()
    }

    /** transportTag: Client2Server index; notifyTag: BattleNotifyMessage index for Notify frames. */
    packet(roomNumber: string, viewer: number, transportTag: number, notifyTag?: number): void {
        const member = this.member(roomNumber, viewer)
        if (!member) return
        const now = this.now()
        if (member.lastInboundAt > 0) this.noteGap(roomNumber, member, now - member.lastInboundAt)
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

    /** Frames the battle relay child handled for this member since its last report. */
    relayActivity(roomNumber: string, viewer: number, activity: {
        packets: number
        broadcasts: number
        lineSpeedWarnings: number
        maxGapMs: number
        relayedOut: number
    }): void {
        const member = this.member(roomNumber, viewer)
        if (!member) return
        member.packets += activity.packets
        member.broadcasts += activity.broadcasts
        member.lineSpeedWarnings += activity.lineSpeedWarnings
        member.relayedOut += activity.relayedOut
        // The child timestamps frames on arrival; gaps measured here would
        // include main event-loop stalls and the report interval.
        this.noteGap(roomNumber, member, activity.maxGapMs)
        if (activity.packets > 0) member.lastInboundAt = this.now()
    }

    private noteGap(roomNumber: string, member: MemberStats, gapMs: number): void {
        if (gapMs > member.maxInboundGapMs) member.maxInboundGapMs = gapMs
        if (gapMs < LONG_GAP_MS) return
        const session = this.sessions.get(roomNumber)
        if (!session) return
        member.longGaps.push({
            ms: Math.round(gapMs),
            atMs: Math.round(this.now() - session.startedAt),
            scene: member.levelNext,
        })
        if (member.longGaps.length > MAX_LONG_GAPS) {
            member.longGaps.sort((a, b) => b.ms - a.ms)
            member.longGaps.length = MAX_LONG_GAPS
            member.longGaps.sort((a, b) => a.atMs - b.atMs)
        }
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
        if (member) member.disconnects[reason] = (member.disconnects[reason] ?? 0) + 1
    }

    barrier(roomNumber: string, kind: string, waitMs: number): void {
        const session = this.sessions.get(roomNumber)
        if (!session) return
        if (session.barriers.length >= MAX_BARRIERS) session.barriers.shift()
        session.barriers.push({ kind, waitMs: Math.round(waitMs) })
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
