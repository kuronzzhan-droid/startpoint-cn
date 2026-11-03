"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fiveBossConnectionDiagnostics = exports.FiveBossConnectionDiagnostics = void 0;
const coalesced_diagnostics_1 = require("../../lib/coalesced-diagnostics");
/** Diagnostic observations only: never used as settlement proof or authorization. */
class FiveBossConnectionDiagnostics {
    constructor(maxRuns = 512, maxEvents = 16, retentionMs = 60 * 60000, now = Date.now, afterFailure) {
        this.maxRuns = maxRuns;
        this.maxEvents = maxEvents;
        this.retentionMs = retentionMs;
        this.now = now;
        this.afterFailure = afterFailure;
        this.runs = new Map();
        this.roomRuns = new Map();
        this.sockets = new WeakMap();
        this.socketSequence = 0;
    }
    discard(run) {
        this.runs.delete(run.run);
        if (this.roomRuns.get(run.room) === run.run)
            this.roomRuns.delete(run.room);
    }
    get(runId) {
        const run = this.runs.get(runId);
        if (run && this.now() - run.createdAt >= this.retentionMs) {
            this.discard(run);
            return undefined;
        }
        return run;
    }
    begin(room) {
        const frozen = room.five_boss_runtime;
        if (!frozen || this.runs.has(frozen.runId))
            return;
        const now = this.now();
        for (const run of this.runs.values()) {
            if (now - run.createdAt < this.retentionMs)
                break;
            this.discard(run);
        }
        while (this.runs.size >= this.maxRuns)
            this.discard(this.runs.values().next().value);
        const run = { run: frozen.runId, room: room.room_number, generation: room.lobby_generation,
            createdAt: now, members: new Map() };
        // The real lobby has at most three members; do not retain malformed rosters.
        for (const player of frozen.expectedRealPlayerIds.slice(0, 3)) {
            const identity = Object.entries(frozen.battleIdentityByViewerId).find(([, value]) => value.playerId === player);
            run.members.set(player, { player, viewer: identity ? Number(identity[0]) : 0,
                events: [], totalEvents: 0, counts: {}, connections: [], failed: false, reportedAfterFailure: new Set() });
        }
        this.runs.set(run.run, run);
        this.roomRuns.set(run.room, run.run);
        for (const player of run.members.keys())
            this.memberEvent(run.run, player, "frozen");
    }
    bind(room, client) {
        this.begin(room);
        const frozen = room.five_boss_runtime;
        if (!frozen)
            return;
        // A denied handshake may have lost its lobby index. Attribute it only
        // to an existing frozen connection, without trusting a new player id.
        const identity = Object.values(frozen.battleIdentityByViewerId)
            .find(value => value.connectionId === client.connectionId);
        const run = this.get(frozen.runId);
        const member = identity && (run === null || run === void 0 ? void 0 : run.members.get(identity.playerId));
        if (!member)
            return;
        const previous = this.sockets.get(client.socket);
        if ((previous === null || previous === void 0 ? void 0 : previous.run) === frozen.runId)
            return;
        const connection = { run: frozen.runId, player: member.player,
            socket: ++this.socketSequence, generation: client.roomGeneration,
            packets: 0, unindexedPackets: 0, lastPacketAt: null };
        this.sockets.set(client.socket, connection);
        member.connections.push(connection);
        if (member.connections.length > 3)
            member.connections.shift();
        this.socketEvent(client.socket, "handshake");
    }
    memberEvent(runId, player, event, detail, socket) {
        var _a;
        const run = this.get(runId), member = run === null || run === void 0 ? void 0 : run.members.get(player);
        if (!member)
            return;
        const at = this.now();
        const count = member.counts[event];
        if (count) {
            count.count++;
            count.lastAt = at;
        }
        else
            member.counts[event] = { count: 1, firstAt: at, lastAt: at };
        member.totalEvents++;
        member.events.push({ at, event, socket, detail: detail === null || detail === void 0 ? void 0 : detail.slice(0, 80) });
        if (member.events.length > this.maxEvents)
            member.events.shift();
        if (event === "finish_rejected") {
            member.failed = true;
            return;
        }
        if (member.failed && event !== "http_finish" && !member.reportedAfterFailure.has(event)) {
            member.reportedAfterFailure.add(event);
            try {
                (_a = this.afterFailure) === null || _a === void 0 ? void 0 : _a.call(this, runId, player, event, () => this.snapshot(runId, player));
            }
            catch ( /* A diagnostic sink must never interfere with battle messages. */_b) { /* A diagnostic sink must never interfere with battle messages. */ }
        }
    }
    socketEvent(socket, event, detail) {
        const connection = this.sockets.get(socket);
        if (connection)
            this.memberEvent(connection.run, connection.player, event, detail, connection.socket);
    }
    // Hot path: one weak lookup; tracked sockets update only counters and time.
    // Never copy/serialize battle packets or query the database. Only the first
    // unindexed packet can trigger a post-failure diagnostic event.
    packet(socket, indexed) {
        const connection = this.sockets.get(socket);
        if (!connection)
            return;
        connection.packets++;
        connection.lastPacketAt = this.now();
        if (!indexed && connection.unindexedPackets++ === 0)
            this.socketEvent(socket, "packet_unindexed");
    }
    seatEvent(roomNumber, viewer, event) {
        const runId = this.roomRuns.get(roomNumber), run = runId && this.get(runId);
        if (!run)
            return;
        const member = [...run.members.values()].find(value => value.viewer === viewer);
        if (member)
            this.memberEvent(run.run, member.player, event);
    }
    roomEvent(roomNumber, event, detail) {
        const runId = this.roomRuns.get(roomNumber), run = runId && this.get(runId);
        if (run)
            for (const player of run.members.keys())
                this.memberEvent(run.run, player, event, detail);
    }
    snapshot(runId, player) {
        const run = this.get(runId), member = run === null || run === void 0 ? void 0 : run.members.get(player);
        if (!run || !member)
            return { available: false, reason: "not_retained", retentionMs: this.retentionMs, maxRuns: this.maxRuns };
        return { available: true, capturedAt: this.now(), run: run.run, room: run.room, player,
            generation: run.generation, createdAt: run.createdAt, totalEvents: member.totalEvents,
            droppedEvents: member.totalEvents - member.events.length,
            counts: Object.fromEntries(Object.entries(member.counts).map(([key, value]) => [key, Object.assign({}, value)])),
            events: member.events.map(value => (Object.assign({}, value))), connections: member.connections.map(value => (Object.assign({}, value))) };
    }
}
exports.FiveBossConnectionDiagnostics = FiveBossConnectionDiagnostics;
exports.fiveBossConnectionDiagnostics = new FiveBossConnectionDiagnostics(512, 16, 60 * 60000, Date.now, (run, player, event, snapshot) => coalesced_diagnostics_1.fiveBossDiagnostics.report(JSON.stringify(["transport", run, player, event]), () => `[FIVE-BOSS-TRANSPORT] ${JSON.stringify(Object.assign({ event }, snapshot()))}`));
