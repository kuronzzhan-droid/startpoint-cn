"use strict";
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.battleTelemetry = exports.BattleTelemetry = void 0;
// One compact summary per multiplayer battle for diagnosing disconnects and lag.
//
// Hot-path calls only update counters on an object that already exists. Nothing
// here touches SQLite, copies packets or logs per frame; a battle produces one
// `[MULTI-BATTLE]` line when its room leaves BATTLE. The recent summaries are
// also kept in a small ring for the management diagnostics endpoint.
const node_perf_hooks_1 = require("node:perf_hooks");
const memory_diagnostics_1 = require("../lib/memory-diagnostics");
const latency_statistics_1 = require("./latency-statistics");
const CONTROL_DELAY_KINDS = new Set(["relay-control", "member-sync", "parent-dispatch", "relay-data-ack"]);
function positiveInteger(name, fallback, min, max) {
    var _a;
    const parsed = Number.parseInt((_a = process.env[name]) !== null && _a !== void 0 ? _a : "", 10);
    return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}
function enabled() {
    var _a;
    return !/^(0|false|no|off)$/i.test((_a = process.env.MULTI_BATTLE_TELEMETRY) !== null && _a !== void 0 ? _a : "true");
}
const LAG_SAMPLE_MS = 1000;
const MAX_BARRIERS = 8;
class BattleTelemetry {
    constructor(now = Date.now, emit = line => console.warn(line), maxRecent = positiveInteger("MULTI_BATTLE_TELEMETRY_RECENT", 100, 0, 1000)) {
        this.now = now;
        this.emit = emit;
        this.maxRecent = maxRecent;
        this.sessions = new Map();
        this.recent = [];
        this.lagTimer = null;
        this.lagHistogram = null;
    }
    begin(room) {
        var _a, _b;
        if (!enabled())
            return;
        const mates = Array.isArray(room.mates) ? room.mates : [];
        this.sessions.set(room.room_number, {
            room: room.room_number,
            battle: String((_b = (_a = room.lifecycle) === null || _a === void 0 ? void 0 : _a.battleSessionId) !== null && _b !== void 0 ? _b : ""),
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
        });
        this.ensureLagSampler();
    }
    end(roomNumber, reason) {
        const session = this.sessions.get(roomNumber);
        if (!session)
            return undefined;
        const endedAt = this.now();
        for (const member of session.members.values())
            this.observeInboundGap(member, endedAt);
        this.sampleLag();
        this.sessions.delete(roomNumber);
        if (this.sessions.size === 0)
            this.stopLagSampler();
        const summary = {
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
            members: [...session.members.values()].map((_a) => {
                var { lastInboundAt: _ } = _a, member = __rest(_a, ["lastInboundAt"]);
                return member;
            }),
            serverControlDelayMs: Object.fromEntries([...session.controlDelays].map(([kind, histogram]) => [kind, histogram.snapshot()])),
        };
        if (this.maxRecent > 0) {
            this.recent.push(summary);
            if (this.recent.length > this.maxRecent)
                this.recent.shift();
        }
        try {
            this.emit(`[MULTI-BATTLE] ${JSON.stringify(summary)}`);
        }
        catch ( /* never break the room */_a) { /* never break the room */ }
        return summary;
    }
    member(roomNumber, viewer) {
        const session = this.sessions.get(roomNumber);
        if (!session)
            return undefined;
        let member = session.members.get(viewer);
        if (!member) {
            if (session.members.size >= 8)
                return undefined;
            member = {
                viewer, connections: 0, packets: 0, broadcasts: 0, sceneReady: 0, levelNext: 0, finalize: 0,
                lineSpeedWarnings: 0, maxInboundGapMs: 0, lastInboundAt: 0, relayedOut: 0,
                backpressureEpisodes: 0, maxBackpressureMs: 0, disconnects: {},
            };
            session.members.set(viewer, member);
        }
        return member;
    }
    connected(roomNumber, viewer) {
        const member = this.member(roomNumber, viewer);
        if (!member)
            return;
        const now = this.now();
        this.observeInboundGap(member, now);
        member.connections++;
        member.lastInboundAt = now;
    }
    observeInboundGap(member, at) {
        if (member.lastInboundAt <= 0)
            return;
        member.maxInboundGapMs = Math.max(member.maxInboundGapMs, at - member.lastInboundAt);
    }
    /** transportTag: Client2Server index; notifyTag: BattleNotifyMessage index for Notify frames. */
    packet(roomNumber, viewer, transportTag, notifyTag) {
        const member = this.member(roomNumber, viewer);
        if (!member)
            return;
        const now = this.now();
        this.observeInboundGap(member, now);
        member.lastInboundAt = now;
        member.packets++;
        if (transportTag === 1 || transportTag === 2)
            member.broadcasts++;
        else if (transportTag === 0) {
            if (notifyTag === 0)
                member.sceneReady++;
            else if (notifyTag === 1)
                member.levelNext++;
            else if (notifyTag === 2)
                member.finalize++;
            else if (notifyTag === 4)
                member.lineSpeedWarnings++;
        }
    }
    /** Counts child-local traffic once; parent-forwarded frames use packet(). */
    relayActivity(roomNumber, viewer, activity) {
        const member = this.member(roomNumber, viewer);
        if (!member)
            return;
        member.packets += activity.packets;
        member.broadcasts += activity.broadcasts;
        member.lineSpeedWarnings += activity.lineSpeedWarnings;
        member.relayedOut += activity.relayedOut;
        member.maxInboundGapMs = Math.max(member.maxInboundGapMs, activity.maxGapMs);
        if (activity.packets > 0)
            member.lastInboundAt = this.now();
    }
    relayed(roomNumber, viewer) {
        const member = this.member(roomNumber, viewer);
        if (member)
            member.relayedOut++;
    }
    backpressure(roomNumber, viewer, blockedMs) {
        if (!roomNumber || !viewer)
            return;
        const member = this.member(roomNumber, viewer);
        if (!member)
            return;
        member.backpressureEpisodes++;
        if (blockedMs > member.maxBackpressureMs)
            member.maxBackpressureMs = Math.round(blockedMs);
    }
    disconnected(roomNumber, viewer, reason) {
        var _a;
        const member = this.member(roomNumber, viewer);
        if (!member)
            return;
        this.observeInboundGap(member, this.now());
        // A departed member is no longer silent on an open battle connection.
        // Reconnecting begins a fresh interval in connected().
        member.lastInboundAt = 0;
        member.disconnects[reason] = ((_a = member.disconnects[reason]) !== null && _a !== void 0 ? _a : 0) + 1;
    }
    barrier(roomNumber, kind, waitMs) {
        const session = this.sessions.get(roomNumber);
        if (!session)
            return;
        if (session.barriers.length >= MAX_BARRIERS)
            session.barriers.shift();
        session.barriers.push({ kind, waitMs: Math.round(waitMs) });
    }
    /** Caller owns both endpoints of this span on the same monotonic clock.
     * relay-control starts at parent receipt: it excludes pre-receipt IPC wait.
     * member-sync/data-ack may be bridge-local request-to-confirmation spans. */
    controlDelay(roomNumber, kind, durationMs) {
        const session = this.sessions.get(roomNumber);
        if (!session || !CONTROL_DELAY_KINDS.has(kind) || !Number.isFinite(durationMs) || durationMs < 0)
            return;
        let histogram = session.controlDelays.get(kind);
        if (!histogram) {
            histogram = new latency_statistics_1.BoundedLatencyHistogram();
            session.controlDelays.set(kind, histogram);
        }
        histogram.record(durationMs);
    }
    seatExpired(roomNumber) {
        const session = this.sessions.get(roomNumber);
        if (session)
            session.seatsExpired++;
    }
    recentSummaries() {
        return this.recent.map(summary => (Object.assign({}, summary)));
    }
    activeCount() {
        return this.sessions.size;
    }
    // Event-loop delay is added to every relay, ack and heartbeat handled
    // meanwhile. The histogram is enabled only while a battle is active; each
    // one-second window's maximum is folded into every active battle.
    ensureLagSampler() {
        if (this.lagTimer)
            return;
        const histogram = (0, node_perf_hooks_1.monitorEventLoopDelay)({ resolution: 10 });
        histogram.enable();
        this.lagHistogram = histogram;
        this.lagTimer = setInterval(() => this.sampleLag(), LAG_SAMPLE_MS);
        this.lagTimer.unref();
    }
    sampleLag() {
        const histogram = this.lagHistogram;
        if (!histogram)
            return;
        const maxMs = Math.round(histogram.max / 1e6);
        histogram.reset();
        if (!Number.isFinite(maxMs) || maxMs <= 0)
            return;
        for (const session of this.sessions.values()) {
            if (maxMs > session.loopLagMaxMs)
                session.loopLagMaxMs = maxMs;
            if (maxMs >= 200)
                session.loopStalledSeconds++;
        }
    }
    stopLagSampler() {
        var _a;
        if (this.lagTimer)
            clearInterval(this.lagTimer);
        this.lagTimer = null;
        (_a = this.lagHistogram) === null || _a === void 0 ? void 0 : _a.disable();
        this.lagHistogram = null;
    }
}
exports.BattleTelemetry = BattleTelemetry;
exports.battleTelemetry = new BattleTelemetry();
(0, memory_diagnostics_1.registerMemoryCounters)("battleTelemetry", () => ({
    activeBattles: exports.battleTelemetry.activeCount(),
}));
