import type { MultiRoom } from "../../lib/types/multi"
import type { SessionClient } from "../state/SessionManager"
import { fiveBossDiagnostics } from "../../lib/coalesced-diagnostics"

type Event = "frozen" | "http_start" | "handshake" | "accepted" | "handshake_denied"
    | "scene_ready" | "battle_entry_queued" | "battle_entry_recorded"
    | "level_next" | "finalize" | "level_next_queued" | "finalize_queued"
    | "level_next_recorded" | "finalize_recorded" | "signal_rejected"
    | "packet_unindexed" | "socket_end" | "socket_close" | "socket_error" | "protocol_close"
    | "loading_timeout" | "heartbeat_timeout" | "level_next_timeout" | "replaced" | "removed" | "seat_expired"
    | "room_disband" | "http_finish" | "finish_rejected"

interface TraceEvent { at: number; event: Event; socket?: number; detail?: string }
interface SocketTrace {
    run: string
    player: number
    socket: number
    generation: number
    packets: number
    unindexedPackets: number
    lastPacketAt: number | null
}
interface MemberTrace {
    player: number
    viewer: number
    events: TraceEvent[]
    totalEvents: number
    counts: Partial<Record<Event, { count: number; firstAt: number; lastAt: number }>>
    connections: SocketTrace[]
    failed: boolean
    reportedAfterFailure: Set<Event>
}
interface RunTrace {
    run: string
    room: string
    generation: number
    createdAt: number
    members: Map<number, MemberTrace>
}

/** Diagnostic observations only: never used as settlement proof or authorization. */
export class FiveBossConnectionDiagnostics {
    private readonly runs = new Map<string, RunTrace>()
    private readonly roomRuns = new Map<string, string>()
    private readonly sockets = new WeakMap<object, SocketTrace>()
    private socketSequence = 0

    constructor(
        private readonly maxRuns = 512,
        private readonly maxEvents = 16,
        private readonly retentionMs = 60 * 60_000,
        private readonly now: () => number = Date.now,
        private readonly afterFailure?: (run: string, player: number, event: Event, snapshot: () => unknown) => void,
    ) {}

    private discard(run: RunTrace): void {
        this.runs.delete(run.run)
        if (this.roomRuns.get(run.room) === run.run) this.roomRuns.delete(run.room)
    }

    private get(runId: string): RunTrace | undefined {
        const run = this.runs.get(runId)
        if (run && this.now() - run.createdAt >= this.retentionMs) {
            this.discard(run)
            return undefined
        }
        return run
    }

    begin(room: MultiRoom): void {
        const frozen = room.five_boss_runtime
        if (!frozen || this.runs.has(frozen.runId)) return
        const now = this.now()
        for (const run of this.runs.values()) {
            if (now - run.createdAt < this.retentionMs) break
            this.discard(run)
        }
        while (this.runs.size >= this.maxRuns) this.discard(this.runs.values().next().value!)
        const run: RunTrace = { run: frozen.runId, room: room.room_number, generation: room.lobby_generation,
            createdAt: now, members: new Map() }
        // The real lobby has at most three members; do not retain malformed rosters.
        for (const player of frozen.expectedRealPlayerIds.slice(0, 3)) {
            const identity = Object.entries(frozen.battleIdentityByViewerId).find(([, value]) => value.playerId === player)
            run.members.set(player, { player, viewer: identity ? Number(identity[0]) : 0,
                events: [], totalEvents: 0, counts: {}, connections: [], failed: false, reportedAfterFailure: new Set() })
        }
        this.runs.set(run.run, run)
        this.roomRuns.set(run.room, run.run)
        for (const player of run.members.keys()) this.memberEvent(run.run, player, "frozen")
    }

    bind(room: MultiRoom, client: SessionClient): void {
        this.begin(room)
        const frozen = room.five_boss_runtime
        if (!frozen) return
        // A denied handshake may have lost its lobby index. Attribute it only
        // to an existing frozen connection, without trusting a new player id.
        const identity = Object.values(frozen.battleIdentityByViewerId)
            .find(value => value.connectionId === client.connectionId)
        const run = this.get(frozen.runId)
        const member = identity && run?.members.get(identity.playerId)
        if (!member) return
        const previous = this.sockets.get(client.socket)
        if (previous?.run === frozen.runId) return
        const connection: SocketTrace = { run: frozen.runId, player: member.player,
            socket: ++this.socketSequence, generation: client.roomGeneration,
            packets: 0, unindexedPackets: 0, lastPacketAt: null }
        this.sockets.set(client.socket, connection)
        member.connections.push(connection)
        if (member.connections.length > 3) member.connections.shift()
        this.socketEvent(client.socket, "handshake")
    }

    memberEvent(runId: string, player: number, event: Event, detail?: string, socket?: number): void {
        const run = this.get(runId), member = run?.members.get(player)
        if (!member) return
        const at = this.now()
        const count = member.counts[event]
        if (count) { count.count++; count.lastAt = at }
        else member.counts[event] = { count: 1, firstAt: at, lastAt: at }
        member.totalEvents++
        member.events.push({ at, event, socket, detail: detail?.slice(0, 80) })
        if (member.events.length > this.maxEvents) member.events.shift()
        if (event === "finish_rejected") { member.failed = true; return }
        if (member.failed && event !== "http_finish" && !member.reportedAfterFailure.has(event)) {
            member.reportedAfterFailure.add(event)
            try { this.afterFailure?.(runId, player, event, () => this.snapshot(runId, player)) }
            catch { /* A diagnostic sink must never interfere with battle messages. */ }
        }
    }

    socketEvent(socket: object, event: Event, detail?: string): void {
        const connection = this.sockets.get(socket)
        if (connection) this.memberEvent(connection.run, connection.player, event, detail, connection.socket)
    }

    // Hot path: one weak lookup; tracked sockets update only counters and time.
    // Never copy/serialize battle packets or query the database. Only the first
    // unindexed packet can trigger a post-failure diagnostic event.
    packet(socket: object, indexed: boolean): void {
        const connection = this.sockets.get(socket)
        if (!connection) return
        connection.packets++
        connection.lastPacketAt = this.now()
        if (!indexed && connection.unindexedPackets++ === 0) this.socketEvent(socket, "packet_unindexed")
    }

    seatEvent(roomNumber: string, viewer: number, event: "seat_expired"): void {
        const runId = this.roomRuns.get(roomNumber), run = runId && this.get(runId)
        if (!run) return
        const member = [...run.members.values()].find(value => value.viewer === viewer)
        if (member) this.memberEvent(run.run, member.player, event)
    }

    roomEvent(roomNumber: string, event: "room_disband", detail: string): void {
        const runId = this.roomRuns.get(roomNumber), run = runId && this.get(runId)
        if (run) for (const player of run.members.keys()) this.memberEvent(run.run, player, event, detail)
    }

    snapshot(runId: string, player: number): unknown {
        const run = this.get(runId), member = run?.members.get(player)
        if (!run || !member) return { available: false, reason: "not_retained", retentionMs: this.retentionMs, maxRuns: this.maxRuns }
        return { available: true, capturedAt: this.now(), run: run.run, room: run.room, player,
            generation: run.generation, createdAt: run.createdAt, totalEvents: member.totalEvents,
            droppedEvents: member.totalEvents - member.events.length,
            counts: Object.fromEntries(Object.entries(member.counts).map(([key, value]) => [key, { ...value }])),
            events: member.events.map(value => ({ ...value })), connections: member.connections.map(value => ({ ...value })) }
    }
}

export const fiveBossConnectionDiagnostics = new FiveBossConnectionDiagnostics(512, 16, 60 * 60_000, Date.now,
    (run, player, event, snapshot) => fiveBossDiagnostics.report(JSON.stringify(["transport", run, player, event]),
        () => `[FIVE-BOSS-TRANSPORT] ${JSON.stringify({ event, ...snapshot() as object })}`))
