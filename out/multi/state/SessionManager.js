"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sessionManager = exports.SessionManager = void 0;
const routine_game_logging_1 = require("../../lib/routine-game-logging");
const room_preview_1 = require("../../lib/weapon-riven/room-preview");
const node_perf_hooks_1 = require("node:perf_hooks");
const types_1 = require("../types");
const ClientStateMachine_1 = require("./ClientStateMachine");
const game_logging_1 = require("../../lib/game-logging");
const reliable_send_1 = require("../tcp/reliable-send");
const chain_diagnostic_1 = require("../tcp/chain-diagnostic");
const embedded_1 = require("../coordinator/embedded");
const admission_1 = require("../room/admission");
const connection_diagnostic_1 = require("../five-boss/connection-diagnostic");
const contract_1 = require("../five-boss/contract");
const memory_diagnostics_1 = require("../../lib/memory-diagnostics");
const server_work_performance_1 = require("../../lib/server-work-performance");
const realtime_diagnostics_1 = require("../../lib/realtime-diagnostics");
const disconnect_diagnostics_1 = require("../tcp/disconnect-diagnostics");
const battle_telemetry_1 = require("../battle-telemetry");
const equipment_ready_1 = require("../room/equipment-ready");
const bridge_1 = require("../tcp/battle-relay/bridge");
const battle_contract_1 = require("./battle-contract");
class SessionManager {
    constructor() {
        this.clients = new Map();
        this.roomClients = new Map();
        this.battleClients = new Map();
        this.cidToBattleClient = new Map();
        this.socketClients = new WeakMap();
        this.sceneReadyClients = new Map();
        this.battleLevelNextClients = new Map();
        this.battleExpectedCount = new Map();
        this.battleBarrierCycles = new Map();
        // Roster handed to setBattleExpectedCount at StartBattle, by connection id.
        // It lets a seat open its battle socket after its lobby socket dropped.
        this.battleRosterSeats = new Map();
        this.retiredBattleSeats = new Map();
        this.battleHeartbeatTimers = new Map();
        this.battleLastActivityAt = new Map();
        this.battleConnectionPhase = new Map();
        this.battleSceneStartedRooms = new Set();
        this.pendingBattleLeaves = new Map();
        this.battleBarrierLogState = new Map();
        this.supersededBattleClients = new WeakSet();
        this.supersededSockets = new WeakSet();
        this.retiredLobbySockets = new WeakSet();
        this.supersededSocketBuckets = new Map();
        this.abandonedBattleTimers = new Map();
        this.settlementReturnTimers = new Map();
        this.rescueGuests = new Map();
        this.newbieRescueGuests = new Map();
        this.rescueFragmentEligibleGuests = new Map();
        this.rescueGuestWaits = new Map();
        this.rescueGuestReconnectTimers = new Map();
        this.blockedRoomRestores = new Map();
        this.hostReconnectTimers = new Map();
        this.deferredDisbands = new Map();
        this.staleAssetViewers = new Map();
        this.roomConnectionGenerations = new Map();
    }
    memoryCounters() {
        return { lobbyClients: this.clients.size, battleClients: this.cidToBattleClient.size,
            lobbyRooms: this.roomClients.size, battleRooms: this.battleClients.size,
            heartbeatTimers: this.battleHeartbeatTimers.size, returningTimers: this.settlementReturnTimers.size,
            abandonedTimers: this.abandonedBattleTimers.size, supersededBuckets: this.supersededSocketBuckets.size,
            blockedRestores: this.blockedRoomRestores.size, roomGenerations: this.roomConnectionGenerations.size };
    }
    /** An account login replacement revokes both lobby and battle transports. */
    disconnectPlayerLogin(viewerId) {
        for (const client of Array.from(this.clients.values())) {
            if (client.viewerId === viewerId) {
                (0, disconnect_diagnostics_1.markTcpDisconnectReason)(client.socket, "login_replaced");
                client.socket.destroy();
            }
        }
    }
    addr(viewerId, roomNumber) {
        return `${viewerId}@${roomNumber}`;
    }
    parsePositiveDuration(name, fallback, minimum = 1000) {
        const parsed = parseInt(process.env[name] || "", 10);
        return Number.isFinite(parsed) ? Math.max(minimum, parsed) : fallback;
    }
    maxSupersededSocketsPerViewer() {
        const parsed = parseInt(process.env.MULTI_MAX_SUPERSEDED_CONNECTIONS_PER_VIEWER || "", 10);
        return Number.isFinite(parsed) ? Math.max(1, Math.min(32, parsed)) : 2;
    }
    deferSupersededSocketClose(socket, replacementIsLive) {
        const checkMs = this.parsePositiveDuration("MULTI_SUPERSEDED_SOCKET_CLOSE_MS", 60000);
        const closeWhenSafe = () => {
            if (socket.destroyed)
                return;
            // Closing the old socket while its replacement owns the room can
            // make the client show a false communication-loss dialog. Keep it
            // quarantined until the replacement/room is gone; it is no longer
            // indexed and cannot issue commands or receive broadcasts.
            if (replacementIsLive()) {
                const retry = setTimeout(closeWhenSafe, checkMs);
                retry.unref();
                return;
            }
            (0, disconnect_diagnostics_1.markTcpDisconnectReason)(socket, "superseded");
            socket.destroy();
        };
        const timer = setTimeout(closeWhenSafe, checkMs);
        timer.unref();
        return checkMs;
    }
    quarantineSupersededSocket(ownerKey, roomNumber, socket, replacementIsLive) {
        this.supersededSockets.add(socket);
        let bucket = this.supersededSocketBuckets.get(ownerKey);
        if (!bucket) {
            bucket = { roomNumber, sockets: new Set() };
            this.supersededSocketBuckets.set(ownerKey, bucket);
        }
        bucket.sockets.add(socket);
        socket.once("close", () => {
            const current = this.supersededSocketBuckets.get(ownerKey);
            current === null || current === void 0 ? void 0 : current.sockets.delete(socket);
            if ((current === null || current === void 0 ? void 0 : current.sockets.size) === 0)
                this.supersededSocketBuckets.delete(ownerKey);
        });
        const maximum = this.maxSupersededSocketsPerViewer();
        while (bucket.sockets.size > maximum) {
            const oldest = bucket.sockets.values().next().value;
            if (!oldest)
                break;
            bucket.sockets.delete(oldest);
            if (!oldest.destroyed) {
                (0, disconnect_diagnostics_1.markTcpDisconnectReason)(oldest, "superseded");
                oldest.destroy();
            }
        }
        return this.deferSupersededSocketClose(socket, replacementIsLive);
    }
    closeSupersededSocketsForRoom(roomNumber) {
        for (const [ownerKey, bucket] of this.supersededSocketBuckets) {
            if (bucket.roomNumber !== roomNumber)
                continue;
            this.supersededSocketBuckets.delete(ownerKey);
            for (const socket of bucket.sockets) {
                if (!socket.destroyed) {
                    (0, disconnect_diagnostics_1.markTcpDisconnectReason)(socket, "room_disband");
                    socket.destroy();
                }
            }
        }
    }
    retireDisbandedLobbySocket(socket, roomNumber) {
        this.retiredLobbySockets.add(socket);
        if (socket.destroyed)
            return;
        // The CN client handles Disbanded by sending Bye and closing this
        // socket itself.  A server FIN queued immediately after Disbanded can
        // be processed as SocketError after the client has already cleared its
        // cooperationRoomStatus, which makes the client throw C5805.  Keep the
        // socket quarantined long enough for both the final frame and the
        // client's intentional close, then reclaim an unresponsive peer.
        const sendQueueMaxAgeMs = this.parsePositiveDuration("MULTI_SEND_QUEUE_MAX_AGE_MS", 15000);
        const fallbackGraceMs = sendQueueMaxAgeMs + 5000;
        const graceMs = this.parsePositiveDuration("MULTI_DISBAND_SOCKET_GRACE_MS", fallbackGraceMs);
        const timer = setTimeout(() => {
            if (socket.destroyed)
                return;
            (0, game_logging_1.gameVerboseLog)(() => `[MULTI] forcing retired lobby socket closed: room=${roomNumber}`
                + ` graceMs=${graceMs}`);
            (0, disconnect_diagnostics_1.markTcpDisconnectReason)(socket, "room_disband");
            socket.destroy();
        }, graceMs);
        timer.unref();
        socket.once("close", () => clearTimeout(timer));
    }
    clearBattleHeartbeatLease(connectionId) {
        const timer = this.battleHeartbeatTimers.get(connectionId);
        if (timer)
            clearTimeout(timer);
        this.battleHeartbeatTimers.delete(connectionId);
        this.battleLastActivityAt.delete(connectionId);
        this.battleConnectionPhase.delete(connectionId);
    }
    armBattleLoadingLease(connectionId) {
        const client = this.cidToBattleClient.get(connectionId);
        if (!client || client.socket.destroyed)
            return;
        const leaseMs = this.parsePositiveDuration("BATTLE_LOADING_LEASE_MS", 60000, 10000);
        const previous = this.battleHeartbeatTimers.get(connectionId);
        if (previous)
            clearTimeout(previous);
        this.battleConnectionPhase.set(connectionId, "loading");
        this.battleLastActivityAt.set(connectionId, node_perf_hooks_1.performance.now());
        const timer = setTimeout(() => {
            // Timers run before the poll phase on a busy loop. Give a SceneReady
            // frame that is already waiting in the kernel one I/O turn to
            // replace this lease before deciding that loading really expired.
            const check = setImmediate(() => {
                if (this.battleHeartbeatTimers.get(connectionId) !== timer)
                    return;
                this.battleHeartbeatTimers.delete(connectionId);
                const current = this.cidToBattleClient.get(connectionId);
                if (!current || current.socket.destroyed
                    || this.battleConnectionPhase.get(connectionId) !== "loading")
                    return;
                console.warn(`[MULTI] battle loading timed out: room=${current.roomNumber}`
                    + ` viewer=${current.viewerId} connection=${connectionId} timeoutMs=${leaseMs}`);
                connection_diagnostic_1.fiveBossConnectionDiagnostics.socketEvent(current.socket, "loading_timeout", String(leaseMs));
                (0, disconnect_diagnostics_1.markTcpDisconnectReason)(current.socket, "loading_timeout");
                current.socket.destroy();
            });
            check.unref();
        }, leaseMs);
        timer.unref();
        this.battleHeartbeatTimers.set(connectionId, timer);
    }
    scheduleBattleActivityLease(connectionId, delayMs) {
        const client = this.cidToBattleClient.get(connectionId);
        if (!client || client.socket.destroyed)
            return;
        const leaseMs = this.parsePositiveDuration("BATTLE_HEARTBEAT_LEASE_MS", 25000, 5000);
        const previous = this.battleHeartbeatTimers.get(connectionId);
        if (previous)
            clearTimeout(previous);
        const timer = setTimeout(() => {
            const check = setImmediate(() => {
                var _a;
                if (this.battleHeartbeatTimers.get(connectionId) !== timer)
                    return;
                this.battleHeartbeatTimers.delete(connectionId);
                const current = this.cidToBattleClient.get(connectionId);
                if (!current || current.socket.destroyed) {
                    this.battleLastActivityAt.delete(connectionId);
                    return;
                }
                const inactiveMs = node_perf_hooks_1.performance.now() - ((_a = this.battleLastActivityAt.get(connectionId)) !== null && _a !== void 0 ? _a : 0);
                // After a teammate's /finish the room is SETTLING/RETURNING, but a
                // slow client can stay silent on its result sequence well past the
                // ordinary lease before it sends Finalize and /finish. Killing it
                // there shows S1000 and can lose its settlement.
                const effectiveLeaseMs = this.isAwaitingFinalizeAfterSettlement(current)
                    ? Math.max(leaseMs, this.parsePositiveDuration("BATTLE_SETTLING_HEARTBEAT_LEASE_MS", 120000, 5000))
                    : leaseMs;
                if (inactiveMs < effectiveLeaseMs) {
                    this.scheduleBattleActivityLease(connectionId, Math.max(1, effectiveLeaseMs - inactiveMs));
                    return;
                }
                console.warn(`[MULTI] real battle connection heartbeat expired: room=${current.roomNumber}`
                    + ` viewer=${current.viewerId} connection=${connectionId} inactiveMs=${inactiveMs}`);
                connection_diagnostic_1.fiveBossConnectionDiagnostics.socketEvent(current.socket, "heartbeat_timeout", String(inactiveMs));
                // Destroy only a battle socket that completed the real handshake.
                // Its normal close handler performs the native Leave path using the
                // connection id already known by every remaining client.
                (0, disconnect_diagnostics_1.markTcpDisconnectReason)(current.socket, "heartbeat_timeout");
                current.socket.destroy();
            });
            check.unref();
        }, delayMs);
        timer.unref();
        this.battleHeartbeatTimers.set(connectionId, timer);
    }
    armActiveBattleHeartbeatLease(connectionId) {
        const client = this.cidToBattleClient.get(connectionId);
        if (!client || client.socket.destroyed)
            return;
        const leaseMs = this.parsePositiveDuration("BATTLE_HEARTBEAT_LEASE_MS", 25000, 5000);
        this.battleConnectionPhase.set(connectionId, "active");
        this.battleLastActivityAt.set(connectionId, node_perf_hooks_1.performance.now());
        this.scheduleBattleActivityLease(connectionId, leaseMs);
    }
    armBattleReadyHeartbeatLease(connectionId) {
        const client = this.cidToBattleClient.get(connectionId);
        if (!client || client.socket.destroyed)
            return;
        const leaseMs = this.parsePositiveDuration("BATTLE_HEARTBEAT_LEASE_MS", 25000, 5000);
        this.battleConnectionPhase.set(connectionId, "ready");
        this.battleLastActivityAt.set(connectionId, node_perf_hooks_1.performance.now());
        this.scheduleBattleActivityLease(connectionId, leaseMs);
    }
    noteBattleActivity(connectionId) {
        if (!this.cidToBattleClient.has(connectionId))
            return;
        // Loading has a fixed upper bound and is deliberately not governed by
        // the activity heartbeat. SceneReady switches the connection to the
        // renewable ready lease; barrier release promotes it to active.
        const phase = this.battleConnectionPhase.get(connectionId);
        if (phase === "ready" || phase === "active") {
            // One timer per ready/active connection is enough. Per-packet traffic
            // only advances the deadline timestamp; the timer reschedules for
            // the exact remaining lease when it wakes up.
            this.battleLastActivityAt.set(connectionId, node_perf_hooks_1.performance.now());
        }
    }
    indexClientSocket(client) {
        this.socketClients.set(client.socket, client);
    }
    unindexClientSocket(client) {
        if (this.socketClients.get(client.socket) === client) {
            this.socketClients.delete(client.socket);
        }
    }
    logBattleBarrierState(roomNumber, reason) {
        var _a, _b, _c, _d, _e;
        const expected = (_a = this.battleExpectedCount.get(roomNumber)) !== null && _a !== void 0 ? _a : 0;
        const connected = (_c = (_b = this.battleClients.get(roomNumber)) === null || _b === void 0 ? void 0 : _b.size) !== null && _c !== void 0 ? _c : 0;
        const ready = (_e = (_d = this.sceneReadyClients.get(roomNumber)) === null || _d === void 0 ? void 0 : _d.size) !== null && _e !== void 0 ? _e : 0;
        const generation = (() => {
            var _a, _b;
            try {
                return Number((_b = (_a = require("../room/manager").getRoom(roomNumber)) === null || _a === void 0 ? void 0 : _a.lobby_generation) !== null && _b !== void 0 ? _b : 0);
            }
            catch (_c) {
                return 0;
            }
        })();
        const signature = `${generation}:${expected}:${connected}:${ready}:${reason}`;
        if (this.battleBarrierLogState.get(roomNumber) === signature)
            return;
        this.battleBarrierLogState.set(roomNumber, signature);
        (0, realtime_diagnostics_1.recordRealtimeDiagnostic)(roomNumber, "barrier", {
            reason,
            expected,
            connected,
            ready,
            generation,
        });
        (0, routine_game_logging_1.routineGameLog)("multiBarrier", () => `[MULTI-BARRIER] room=${roomNumber} generation=${generation}`
            + ` expected=${expected} connected=${connected} ready=${ready} reason=${reason}`);
    }
    releaseSceneReadyBarrierIfSatisfied(roomNumber, reason) {
        var _a, _b, _c, _d, _e;
        const cycleBeforeRelease = this.battleBarrierCycles.get(roomNumber);
        if (this.deferStartDecision(roomNumber, () => {
            if (this.battleBarrierCycles.get(roomNumber) === cycleBeforeRelease
                && this.releaseSceneReadyBarrierIfSatisfied(roomNumber, reason))
                this.activateBattleScene(roomNumber);
        }))
            return false;
        const expected = (_a = this.battleExpectedCount.get(roomNumber)) !== null && _a !== void 0 ? _a : 0;
        if (expected <= 0)
            return false;
        const connected = (_c = (_b = this.battleClients.get(roomNumber)) === null || _b === void 0 ? void 0 : _b.size) !== null && _c !== void 0 ? _c : 0;
        const ready = (_e = (_d = this.sceneReadyClients.get(roomNumber)) === null || _d === void 0 ? void 0 : _d.size) !== null && _e !== void 0 ? _e : 0;
        this.logBattleBarrierState(roomNumber, reason);
        if (connected <= 0 || ready < expected || ready < connected)
            return false;
        const cycle = this.battleBarrierCycles.get(roomNumber);
        const waitMs = cycle ? node_perf_hooks_1.performance.now() - cycle.startedAt : 0;
        if (cycle)
            (0, server_work_performance_1.recordServerWork)("multi.barrier", waitMs);
        battle_telemetry_1.battleTelemetry.barrier(roomNumber, this.battleLevelNextClients.has(roomNumber) ? "next_scene" : "initial", waitMs);
        (0, realtime_diagnostics_1.recordRealtimeDiagnostic)(roomNumber, "barrier_released", {
            reason,
            expected,
            connected,
            ready,
            waitMs: Math.round(waitMs * 1000) / 1000,
        });
        this.battleExpectedCount.set(roomNumber, 0);
        this.clearBattleBarrierCycle(roomNumber);
        this.battleLevelNextClients.delete(roomNumber);
        this.logBattleBarrierState(roomNumber, `${reason}:released`);
        return true;
    }
    battleSeatKey(seat) {
        return seat.viewerId > 0 ? `viewer:${seat.viewerId}` : `connection:${seat.connectionId}`;
    }
    clearBattleBarrierCycle(roomNumber) {
        var _a;
        const cycle = this.battleBarrierCycles.get(roomNumber);
        for (const timer of (_a = cycle === null || cycle === void 0 ? void 0 : cycle.timers.values()) !== null && _a !== void 0 ? _a : [])
            clearTimeout(timer);
        this.battleBarrierCycles.delete(roomNumber);
    }
    beginBattleBarrierCycle(roomNumber) {
        var _a, _b, _c, _d;
        this.clearBattleBarrierCycle(roomNumber);
        const room = require("../room/manager").getRoom(roomNumber);
        const cycle = {
            roomInstanceId: (_a = room === null || room === void 0 ? void 0 : room.lifecycle) === null || _a === void 0 ? void 0 : _a.instanceId,
            battleSessionId: (_b = room === null || room === void 0 ? void 0 : room.lifecycle) === null || _b === void 0 ? void 0 : _b.battleSessionId,
            sceneEpoch: (_d = (_c = room === null || room === void 0 ? void 0 : room.lifecycle) === null || _c === void 0 ? void 0 : _c.sceneEpoch) !== null && _d !== void 0 ? _d : 0,
            timers: new Map(), missing: new Map(),
            arrived: new Set(this.getConnectedBattleClients(roomNumber)
                .flatMap(client => [this.battleSeatKey(client), `connection:${client.connectionId}`])),
            startedAt: node_perf_hooks_1.performance.now(),
        };
        this.battleBarrierCycles.set(roomNumber, cycle);
        return cycle;
    }
    isCurrentBattleBarrier(roomNumber, cycle) {
        var _a, _b, _c, _d;
        if (this.battleBarrierCycles.get(roomNumber) !== cycle)
            return false;
        const room = require("../room/manager").getRoom(roomNumber);
        return ((_a = room === null || room === void 0 ? void 0 : room.lifecycle) === null || _a === void 0 ? void 0 : _a.instanceId) === cycle.roomInstanceId
            && ((_b = room === null || room === void 0 ? void 0 : room.lifecycle) === null || _b === void 0 ? void 0 : _b.battleSessionId) === cycle.battleSessionId
            && ((_d = (_c = room === null || room === void 0 ? void 0 : room.lifecycle) === null || _c === void 0 ? void 0 : _c.sceneEpoch) !== null && _d !== void 0 ? _d : 0) === cycle.sceneEpoch
            && (!room || room.lifecycle.phase === "BATTLE");
    }
    expireMissingBattleSeat(roomNumber, cycle, seat) {
        var _a;
        if (!this.isCurrentBattleBarrier(roomNumber, cycle))
            return;
        if (this.deferStartDecision(roomNumber, () => this.expireMissingBattleSeat(roomNumber, cycle, seat)))
            return;
        const key = this.battleSeatKey(seat);
        if (this.getConnectedBattleClients(roomNumber).some(client => this.battleSeatKey(client) === key
            || client.connectionId === seat.connectionId))
            return;
        const expected = (_a = this.battleExpectedCount.get(roomNumber)) !== null && _a !== void 0 ? _a : 0;
        if (expected <= 0)
            return;
        let retired = this.retiredBattleSeats.get(roomNumber);
        if (!retired)
            this.retiredBattleSeats.set(roomNumber, retired = new Set());
        if (retired.has(key) || retired.has(`connection:${seat.connectionId}`))
            return;
        retired.add(key);
        retired.add(`connection:${seat.connectionId}`);
        const room = require("../room/manager").getRoom(roomNumber);
        if (room)
            (0, battle_contract_1.markBattleMemberPhase)(room, seat.viewerId, "RETIRED");
        connection_diagnostic_1.fiveBossConnectionDiagnostics.seatEvent(roomNumber, seat.viewerId, "seat_expired");
        battle_telemetry_1.battleTelemetry.seatExpired(roomNumber);
        this.queueBattleLeave(roomNumber, seat.connectionId);
        this.battleExpectedCount.set(roomNumber, expected - 1);
        this.logBattleBarrierState(roomNumber, "missing_seat_expired");
        if (this.releaseSceneReadyBarrierIfSatisfied(roomNumber, "missing_seat_recheck")) {
            this.activateBattleScene(roomNumber);
        }
    }
    scheduleMissingBattleSeat(roomNumber, seat) {
        var _a, _b;
        const cycle = this.battleBarrierCycles.get(roomNumber);
        if (!cycle || ((_a = this.battleExpectedCount.get(roomNumber)) !== null && _a !== void 0 ? _a : 0) <= 0)
            return;
        const key = this.battleSeatKey(seat);
        if (cycle.timers.has(key) || ((_b = this.retiredBattleSeats.get(roomNumber)) === null || _b === void 0 ? void 0 : _b.has(key)))
            return;
        cycle.missing.set(key, seat);
        const graceMs = this.parsePositiveDuration("BATTLE_BARRIER_RECONNECT_GRACE_MS", 8000);
        const timer = setTimeout(() => {
            void embedded_1.embeddedMultiCoordinator.enqueueRoomCommand(roomNumber, () => {
                // Recheck after entering the room queue: reconnect, settlement,
                // the next scene, or a reused room number may have won the race.
                if (cycle.timers.get(key) !== timer)
                    return;
                cycle.timers.delete(key);
                this.expireMissingBattleSeat(roomNumber, cycle, seat);
            }).catch(error => console.error(`[MULTI] barrier grace failed: room=${roomNumber}`, error));
        }, graceMs);
        timer.unref();
        cycle.timers.set(key, timer);
    }
    queueBattleLeave(roomNumber, connectionId) {
        let pending = this.pendingBattleLeaves.get(roomNumber);
        if (!pending) {
            pending = new Set();
            this.pendingBattleLeaves.set(roomNumber, pending);
        }
        pending.add(connectionId);
    }
    publishBattleDeparture(client) {
        if (client.fiveBossBattleEntered && client.finalizeSent) {
            // The client discards cooperation_battle as soon as Finalized
            // arrives. That close ends a finished battle; a Leave here would
            // only show teammates a false disconnect notice.
            return;
        }
        else if (this.battleSceneStartedRooms.has(client.roomNumber)) {
            // Any other close mid-battle (network loss, app killed, or the
            // client isolating itself after a lag spike) must reach the
            // teammates. The CN client runs battles in lockstep: without
            // Leave, a silent peer's frame counter stands still, every
            // teammate slows down and after ~240 frames isolates itself with
            // "communication lost" (in the first dual-boss round it freezes
            // instead). Leave turns that peer into a departed member at once.
            this.broadcastBattleLeave(client.roomNumber, client.connectionId);
        }
        else {
            this.queueBattleLeave(client.roomNumber, client.connectionId);
        }
    }
    broadcastBattleLeave(roomNumber, connectionId) {
        for (const client of this.getConnectedBattleClients(roomNumber)) {
            if (client.connectionId === connectionId)
                continue;
            this.sendJson(client.socket, [1, [0, connectionId]]);
        }
    }
    deferStartDecision(roomNumber, apply) {
        const room = require("../room/manager").getRoom(roomNumber);
        if (!room)
            return false;
        const instanceId = room.lifecycle.instanceId, battleSessionId = room.lifecycle.battleSessionId;
        return require("../coordinator/room-start-claims").deferPinnedRoomControl(room, () => {
            if (require("../room/manager").getRoom(roomNumber) === room
                && room.lifecycle.instanceId === instanceId && room.lifecycle.battleSessionId === battleSessionId)
                apply();
        });
    }
    activateBattleScene(roomNumber) {
        if (this.deferStartDecision(roomNumber, () => this.activateBattleScene(roomNumber)))
            return;
        const clients = this.getConnectedBattleClients(roomNumber);
        const room = require("../room/manager").getRoom(roomNumber);
        this.battleSceneStartedRooms.add(roomNumber);
        this.recordFiveBossBattleEntry(roomNumber, clients);
        // Promote the entire room together. SceneReady means only that one
        // client finished loading; treating it as active before this point can
        // publish Leave to peers that are still constructing their battle.
        for (const client of clients) {
            if (room)
                (0, battle_contract_1.markBattleMemberPhase)(room, client.viewerId, "ACTIVE");
            if (client.fiveBossBattleEntered) {
                // The CN five-boss client can stay silent for longer than the
                // ordinary heartbeat lease while a boss is active. Keep the
                // authenticated socket for LevelNext; the next loading phase
                // and the room watchdog still provide bounded cleanup.
                this.clearBattleHeartbeatLease(client.connectionId);
            }
            else {
                this.armActiveBattleHeartbeatLease(client.connectionId);
            }
        }
        for (const client of clients) {
            this.sendJson(client.socket, [1, [1]]);
        }
        // Every survivor must observe BattleStart before AI takeover. Sending
        // Leave earlier lets differently loaded clients build divergent local
        // battle/chain state and can stall subsequent chain activations.
        const pending = this.pendingBattleLeaves.get(roomNumber);
        this.pendingBattleLeaves.delete(roomNumber);
        for (const connectionId of pending !== null && pending !== void 0 ? pending : []) {
            this.broadcastBattleLeave(roomNumber, connectionId);
        }
    }
    recordFiveBossBattleEntry(roomNumber, clients) {
        let room;
        try {
            room = require("../room/manager").getRoom(roomNumber);
        }
        catch (_a) {
            return;
        }
        if (!(room === null || room === void 0 ? void 0 : room.five_boss_runtime))
            return;
        try {
            const { recordFiveBossSignal } = require("../five-boss/lobby-runtime");
            for (const client of clients)
                recordFiveBossSignal(room, client, "scene_ready");
        }
        catch (error) {
            console.error(`[FIVE-BOSS-SIGNAL] battle entry dispatch failed: room=${roomNumber}`, error);
        }
    }
    getConnectedBattleClients(roomNumber) {
        var _a;
        const result = [];
        for (const connectionId of (_a = this.battleClients.get(roomNumber)) !== null && _a !== void 0 ? _a : []) {
            const client = this.cidToBattleClient.get(connectionId);
            if (client && !client.socket.destroyed)
                result.push(client);
        }
        return result;
    }
    clearBattleHeartbeatLeasesForRoom(roomNumber) {
        for (const [connectionId, client] of this.cidToBattleClient) {
            if (client.roomNumber === roomNumber)
                this.clearBattleHeartbeatLease(connectionId);
        }
    }
    clearRescueGuestWait(roomNumber, viewerId) {
        const key = this.addr(viewerId, roomNumber);
        const wait = this.rescueGuestWaits.get(key);
        if (!wait)
            return;
        clearTimeout(wait.warningTimer);
        clearTimeout(wait.ejectTimer);
        this.rescueGuestWaits.delete(key);
    }
    clearRescueGuestReconnect(roomNumber, viewerId) {
        const key = this.addr(viewerId, roomNumber);
        const timer = this.rescueGuestReconnectTimers.get(key);
        if (timer)
            clearTimeout(timer);
        this.rescueGuestReconnectTimers.delete(key);
    }
    markRescueGuest(roomNumber, viewerId, isNewbieRescue = false, isFragmentRewardEligible = false) {
        var _a, _b, _c;
        let viewers = this.rescueGuests.get(roomNumber);
        if (!viewers) {
            viewers = new Set();
            this.rescueGuests.set(roomNumber, viewers);
        }
        viewers.add(viewerId);
        if (isNewbieRescue) {
            let newbieViewers = this.newbieRescueGuests.get(roomNumber);
            if (!newbieViewers) {
                newbieViewers = new Set();
                this.newbieRescueGuests.set(roomNumber, newbieViewers);
            }
            newbieViewers.add(viewerId);
        }
        else {
            (_a = this.newbieRescueGuests.get(roomNumber)) === null || _a === void 0 ? void 0 : _a.delete(viewerId);
        }
        if (isFragmentRewardEligible) {
            let eligibleViewers = this.rescueFragmentEligibleGuests.get(roomNumber);
            if (!eligibleViewers) {
                eligibleViewers = new Set();
                this.rescueFragmentEligibleGuests.set(roomNumber, eligibleViewers);
            }
            eligibleViewers.add(viewerId);
        }
        else {
            (_b = this.rescueFragmentEligibleGuests.get(roomNumber)) === null || _b === void 0 ? void 0 : _b.delete(viewerId);
        }
        (_c = this.blockedRoomRestores.get(roomNumber)) === null || _c === void 0 ? void 0 : _c.delete(viewerId);
        this.clearRescueGuestReconnect(roomNumber, viewerId);
    }
    isRescueGuest(roomNumber, viewerId) {
        var _a, _b;
        return (_b = (_a = this.rescueGuests.get(roomNumber)) === null || _a === void 0 ? void 0 : _a.has(viewerId)) !== null && _b !== void 0 ? _b : false;
    }
    isNewbieRescueGuest(roomNumber, viewerId) {
        var _a, _b;
        return (_b = (_a = this.newbieRescueGuests.get(roomNumber)) === null || _a === void 0 ? void 0 : _a.has(viewerId)) !== null && _b !== void 0 ? _b : false;
    }
    isRescueFragmentEligibleGuest(roomNumber, viewerId) {
        var _a, _b;
        return (_b = (_a = this.rescueFragmentEligibleGuests.get(roomNumber)) === null || _a === void 0 ? void 0 : _a.has(viewerId)) !== null && _b !== void 0 ? _b : false;
    }
    isRoomRestoreBlocked(roomNumber, viewerId) {
        var _a, _b;
        return (_b = (_a = this.blockedRoomRestores.get(roomNumber)) === null || _a === void 0 ? void 0 : _a.has(viewerId)) !== null && _b !== void 0 ? _b : false;
    }
    isBattleSeatRetired(roomNumber, viewerId) {
        var _a, _b;
        return (_b = (_a = this.retiredBattleSeats.get(roomNumber)) === null || _a === void 0 ? void 0 : _a.has(`viewer:${viewerId}`)) !== null && _b !== void 0 ? _b : false;
    }
    beginRescueGuestWait(client) {
        var _a;
        if (client.equipmentReadyBlock)
            return;
        if (!this.isRescueGuest(client.roomNumber, client.viewerId))
            return;
        const key = this.addr(client.viewerId, client.roomNumber);
        this.clearRescueGuestReconnect(client.roomNumber, client.viewerId);
        (_a = this.blockedRoomRestores.get(client.roomNumber)) === null || _a === void 0 ? void 0 : _a.delete(client.viewerId);
        const existing = this.rescueGuestWaits.get(key);
        if (existing && existing.ready === client.isReady) {
            const remainingSeconds = Math.max(1, Math.ceil((existing.deadline - Date.now()) / 1000));
            if (remainingSeconds <= 30)
                this.sendJson(client.socket, [1, [7, remainingSeconds]]);
            return;
        }
        if (existing)
            this.clearRescueGuestWait(client.roomNumber, client.viewerId);
        // A ready rescue guest is actively waiting for the host to start and
        // must not be mistaken for an abandoned visitor by the short idle
        // timeout. Keep an eventual release path because the official client
        // has no Leave button, but give prepared guests a much longer window.
        const waitMs = client.isReady
            ? this.parsePositiveDuration("RESCUE_GUEST_READY_WAIT_MS", 600000, 10000)
            : this.parsePositiveDuration("RESCUE_GUEST_WAIT_MS", 180000, 2000);
        const ready = client.isReady;
        const warningMs = Math.min(waitMs, this.parsePositiveDuration("RESCUE_GUEST_WARNING_MS", 30000, 1000));
        const deadline = Date.now() + waitMs;
        const warningTimer = setTimeout(() => {
            const current = this.getClient(client.viewerId, client.roomNumber);
            if (!current || current.enterData === null || current.isBattle)
                return;
            if (current.isReady !== ready) {
                this.clearRescueGuestWait(client.roomNumber, client.viewerId);
                this.beginRescueGuestWait(current);
                return;
            }
            this.sendJson(current.socket, [1, [7, Math.max(1, Math.ceil(warningMs / 1000))]]);
            console.warn(`[MULTI] rescue guest timeout warning: viewer=${client.viewerId} room=${client.roomNumber} seconds=${Math.ceil(warningMs / 1000)}`);
        }, Math.max(0, waitMs - warningMs));
        warningTimer.unref();
        const ejectTimer = setTimeout(() => {
            void embedded_1.embeddedMultiCoordinator.enqueueRoomCommand(client.roomNumber, () => {
                const current = this.getClient(client.viewerId, client.roomNumber);
                if (current && !current.isBattle && current.isReady !== ready) {
                    this.clearRescueGuestWait(client.roomNumber, client.viewerId);
                    this.beginRescueGuestWait(current);
                    return;
                }
                this.ejectRescueGuest(client.roomNumber, client.viewerId, "rescue_wait_timeout");
            }).catch(error => console.error(`[MULTI] rescue wait timeout failed: room=${client.roomNumber} viewer=${client.viewerId}`, error));
        }, waitMs);
        ejectTimer.unref();
        this.rescueGuestWaits.set(key, { deadline, ready, warningTimer, ejectTimer });
        (0, game_logging_1.gameVerboseLog)(() => `[MULTI] rescue guest wait started: viewer=${client.viewerId} room=${client.roomNumber} ready=${ready} waitMs=${waitMs}`);
    }
    clearRescueGuestLobbyWait(roomNumber, viewerId) {
        this.clearRescueGuestWait(roomNumber, viewerId);
    }
    beginRescueGuestReconnectGrace(client) {
        if (client.isBattle || !this.isRescueGuest(client.roomNumber, client.viewerId))
            return;
        const key = this.addr(client.viewerId, client.roomNumber);
        if (this.rescueGuestReconnectTimers.has(key))
            return;
        const reconnectMs = this.parsePositiveDuration("RESCUE_GUEST_RECONNECT_GRACE_MS", 25000);
        const timer = setTimeout(() => {
            void embedded_1.embeddedMultiCoordinator.enqueueRoomCommand(client.roomNumber, () => {
                if (this.rescueGuestReconnectTimers.get(key) !== timer)
                    return;
                this.rescueGuestReconnectTimers.delete(key);
                const current = this.getClient(client.viewerId, client.roomNumber);
                if (current && !current.isBattle)
                    return;
                this.ejectRescueGuest(client.roomNumber, client.viewerId, "rescue_reconnect_timeout");
            }).catch(error => console.error(`[MULTI] rescue reconnect timeout failed: room=${client.roomNumber} viewer=${client.viewerId}`, error));
        }, reconnectMs);
        timer.unref();
        this.rescueGuestReconnectTimers.set(key, timer);
        (0, game_logging_1.gameVerboseLog)(() => `[MULTI] rescue guest reconnect grace started: viewer=${client.viewerId} room=${client.roomNumber} graceMs=${reconnectMs}`);
    }
    /** Send the native leave message only to the offending guest, never to the room. */
    ejectEquipmentGuest(roomNumber, viewerId) {
        const { getRoom } = require("../room/manager");
        const room = getRoom(roomNumber);
        if (!room || room.host_viewer_id === viewerId || room.lifecycle.phase !== "LOBBY")
            return;
        const client = this.getClient(viewerId, roomNumber);
        if (!client || client.isBattle)
            return;
        const sent = this.sendJson(client.socket, [1, [6, "multibattle_room_dismissed"]]);
        this.ejectRescueGuest(roomNumber, viewerId, "equipment_idle", sent !== "closed");
    }
    ejectRescueGuest(roomNumber, viewerId, reason, notified = false) {
        var _a, _b, _c, _d, _e;
        this.clearRescueGuestWait(roomNumber, viewerId);
        this.clearRescueGuestReconnect(roomNumber, viewerId);
        (_a = this.rescueGuests.get(roomNumber)) === null || _a === void 0 ? void 0 : _a.delete(viewerId);
        (_b = this.newbieRescueGuests.get(roomNumber)) === null || _b === void 0 ? void 0 : _b.delete(viewerId);
        (_c = this.rescueFragmentEligibleGuests.get(roomNumber)) === null || _c === void 0 ? void 0 : _c.delete(viewerId);
        let blocked = this.blockedRoomRestores.get(roomNumber);
        if (!blocked) {
            blocked = new Set();
            this.blockedRoomRestores.set(roomNumber, blocked);
        }
        blocked.add(viewerId);
        try {
            const { removeRoomMember } = require("../room/manager");
            removeRoomMember(roomNumber, viewerId);
        }
        catch (e) { }
        try {
            const { suppressRandomRecruitmentForViewer } = require("../recruitment");
            suppressRandomRecruitmentForViewer(roomNumber, viewerId);
        }
        catch (e) { }
        const current = this.getClient(viewerId, roomNumber);
        if (current && !current.isBattle) {
            this.removeClient(current);
            if (notified) {
                this.retireDisbandedLobbySocket(current.socket, roomNumber);
            }
            else {
                (0, disconnect_diagnostics_1.markTcpDisconnectReason)(current.socket, "rescue_timeout");
                try {
                    current.socket.end();
                }
                catch (e) { }
                setTimeout(() => {
                    try {
                        current.socket.destroy();
                    }
                    catch (e) { }
                }, 250).unref();
            }
        }
        try {
            const lobby = require("../tcp/lobby");
            (_d = lobby.scheduleRematchDisconnectCleanup) === null || _d === void 0 ? void 0 : _d.call(lobby, roomNumber);
            (_e = lobby.scheduleNpcReconcile) === null || _e === void 0 ? void 0 : _e.call(lobby, roomNumber);
        }
        catch (e) { }
        (0, game_logging_1.gameVerboseLog)(() => `[MULTI] rescue guest released: viewer=${viewerId} room=${roomNumber} reason=${reason}`);
    }
    beginHostReconnectGrace(roomNumber) {
        if (this.hostReconnectTimers.has(roomNumber))
            return;
        let roomInstanceId;
        let roomGeneration;
        try {
            const { getRoom } = require("../room/manager");
            const room = getRoom(roomNumber);
            if (!room)
                return;
            roomInstanceId = embedded_1.embeddedMultiCoordinator.ensureLifecycle(room).instanceId;
            roomGeneration = room.lobby_generation;
        }
        catch (e) {
            return;
        }
        const baseReconnectMs = this.parsePositiveDuration("MULTI_HOST_RECONNECT_GRACE_MS", 25000);
        // After a rematch generation, guests are allowed the longer
        // REMATCH_RECONNECT_GRACE_MS to return.  A host that briefly drops
        // after entering that lobby must not make the room disappear sooner
        // than the guest's own reconnect window.
        const rematchReconnectMs = roomGeneration > 0
            ? this.parsePositiveDuration("REMATCH_RECONNECT_GRACE_MS", 60000)
            : 0;
        const reconnectMs = Math.max(baseReconnectMs, rematchReconnectMs);
        const timer = setTimeout(() => {
            void embedded_1.embeddedMultiCoordinator.enqueueRoomCommand(roomNumber, () => {
                if (this.hostReconnectTimers.get(roomNumber) !== timer)
                    return;
                this.hostReconnectTimers.delete(roomNumber);
                try {
                    const { getRoom } = require("../room/manager");
                    const room = getRoom(roomNumber);
                    if (!embedded_1.embeddedMultiCoordinator.isCurrentInstance(room, roomInstanceId)
                        || room.lobby_generation !== roomGeneration
                        || room.lifecycle.phase === "BATTLE")
                        return;
                    if (this.isHostOnline(room.host_viewer_id, roomNumber, roomGeneration))
                        return;
                    this.commitRoomDisband(roomNumber, "host_reconnect_timeout");
                }
                catch (e) { }
            }).catch(error => console.error(`[MULTI] host reconnect timeout failed: room=${roomNumber}`, error));
        }, reconnectMs);
        timer.unref();
        this.hostReconnectTimers.set(roomNumber, timer);
        (0, game_logging_1.gameVerboseLog)(() => `[MULTI] host reconnect grace started: room=${roomNumber} graceMs=${reconnectMs}`);
    }
    cancelHostReconnectGrace(roomNumber) {
        const timer = this.hostReconnectTimers.get(roomNumber);
        if (timer)
            clearTimeout(timer);
        this.hostReconnectTimers.delete(roomNumber);
    }
    clearRescueGuestStateForRoom(roomNumber) {
        var _a, _b;
        const viewers = new Set([
            ...((_a = this.rescueGuests.get(roomNumber)) !== null && _a !== void 0 ? _a : []),
            ...((_b = this.blockedRoomRestores.get(roomNumber)) !== null && _b !== void 0 ? _b : []),
        ]);
        for (const viewerId of viewers) {
            this.clearRescueGuestWait(roomNumber, viewerId);
            this.clearRescueGuestReconnect(roomNumber, viewerId);
        }
        this.rescueGuests.delete(roomNumber);
        this.newbieRescueGuests.delete(roomNumber);
        this.rescueFragmentEligibleGuests.delete(roomNumber);
        this.blockedRoomRestores.delete(roomNumber);
    }
    /**
     * Each CN client simulates every member's battle locally, so a custom boss
     * can die on one device minutes before the others. After the first
     * victorious /finish, tell the teammates still in their battle scene with
     * BattleServerMessage.Finalized ([1,[2]]); the v35m client patch turns that
     * into a victory. Older clients only drop their battle socket on it, so the
     * whole room must run v35m: off unless MULTI_SERVER_CONFIRMED_CLEAR=1.
     */
    sendServerConfirmedClear(roomNumber, settledViewerId, battleSessionId) {
        var _a;
        if (!/^(1|true|yes|on)$/i.test((_a = process.env.MULTI_SERVER_CONFIRMED_CLEAR) !== null && _a !== void 0 ? _a : ""))
            return 0;
        const sent = [];
        for (const client of this.getConnectedBattleClients(roomNumber)) {
            if (client.viewerId === settledViewerId || client.serverClearSent)
                continue;
            if (!this.isAwaitingFinalizeAfterSettlement(client))
                continue;
            client.serverClearSent = battleSessionId;
            this.sendJson(client.socket, [1, [2]], {
                roomNumber,
                connectionId: client.connectionId,
                viewerId: client.viewerId,
                roomGeneration: client.roomGeneration,
                channel: "server_confirmed_clear",
            });
            sent.push(client.viewerId);
        }
        if (sent.length > 0)
            console.warn(`[MULTI] server-confirmed clear sent: room=${roomNumber}`
                + ` settled=${settledViewerId} to=${sent.join(",")}`);
        return sent.length;
    }
    /** Remember that this viewer's last room HTTP request carried outdated resources. */
    markStaleAssetViewer(roomNumber, viewerId) {
        const now = Date.now();
        for (const [key, expiresAt] of this.staleAssetViewers)
            if (expiresAt < now)
                this.staleAssetViewers.delete(key);
        this.staleAssetViewers.set(`${roomNumber}:${viewerId}`, now + 120000);
    }
    /** One-shot: true when the viewer entering this room must update its assets first. */
    takeStaleAssetViewer(roomNumber, viewerId) {
        const key = `${roomNumber}:${viewerId}`;
        const expiresAt = this.staleAssetViewers.get(key);
        this.staleAssetViewers.delete(key);
        return expiresAt !== undefined && expiresAt >= Date.now();
    }
    /** A real member still in its battle scene after a teammate already settled. */
    isAwaitingFinalizeAfterSettlement(client) {
        var _a, _b;
        if (!client.isBattle || client.finalizeSent || client.socket.destroyed)
            return false;
        try {
            const room = require("../room/manager").getRoom(client.roomNumber);
            if (!room || room.five_boss_runtime)
                return false;
            const phase = (_a = room.lifecycle) === null || _a === void 0 ? void 0 : _a.phase;
            if (phase !== "SETTLING" && phase !== "RETURNING")
                return false;
            const member = (_b = (0, battle_contract_1.getBattleSessionContract)(room)) === null || _b === void 0 ? void 0 : _b.members.get(client.viewerId);
            return !member || member.phase === "ACTIVE" || member.phase === "READY";
        }
        catch (e) {
            return false;
        }
    }
    unsettledBattleClients(roomNumber) {
        return this.getConnectedBattleClients(roomNumber).filter(client => this.isAwaitingFinalizeAfterSettlement(client));
    }
    /**
     * Disbanding closes every battle socket. When the host leaves right after
     * its own settlement, teammates that have not sent Finalize yet would get
     * S1000 and lose their /finish. Keep the room until they finish, bounded by
     * MULTI_DISBAND_SETTLEMENT_WAIT_MS
     * (default BATTLE_ROOM_TIMEOUT_MS).
     */
    deferDisbandForUnsettledMembers(roomNumber, reason, messageKey) {
        var _a;
        // Teammates can still be fighting after one member finished. The
        // settling heartbeat lease already drops a silent socket, so a connected
        // one is live; cap it with the abandoned-battle watchdog duration.
        const waitMs = this.parsePositiveDuration("MULTI_DISBAND_SETTLEMENT_WAIT_MS", this.parsePositiveDuration("BATTLE_ROOM_TIMEOUT_MS", 900000), 0);
        const pending = this.deferredDisbands.get(roomNumber);
        if (pending && node_perf_hooks_1.performance.now() >= pending.deadline)
            return false;
        const waiting = this.unsettledBattleClients(roomNumber);
        if (waiting.length === 0 || waitMs <= 0)
            return false;
        if (pending)
            clearTimeout(pending.timer);
        const deadline = (_a = pending === null || pending === void 0 ? void 0 : pending.deadline) !== null && _a !== void 0 ? _a : node_perf_hooks_1.performance.now() + waitMs;
        const timer = setTimeout(() => {
            void embedded_1.embeddedMultiCoordinator.enqueueRoomCommand(roomNumber, () => {
                var _a;
                if (((_a = this.deferredDisbands.get(roomNumber)) === null || _a === void 0 ? void 0 : _a.timer) !== timer)
                    return;
                if (!require("../room/manager").getRoom(roomNumber)) {
                    this.deferredDisbands.delete(roomNumber);
                    return;
                }
                this.commitRoomDisband(roomNumber, reason, messageKey);
            }).catch(error => console.error(`[MULTI] deferred disband failed: room=${roomNumber}`, error));
        }, Math.max(0, Math.min(2000, deadline - node_perf_hooks_1.performance.now())));
        timer.unref();
        this.deferredDisbands.set(roomNumber, { timer, deadline });
        if (!pending)
            console.warn(`[MULTI] disband deferred for unsettled members: room=${roomNumber}`
                + ` reason=${reason} waiting=${waiting.map(client => client.viewerId).join(",")} maxWaitMs=${waitMs}`);
        return true;
    }
    commitRoomDisband(roomNumber, reason, messageKey = "multibattle_room_dismissed") {
        const currentRoom = require("../room/manager").getRoom(roomNumber);
        if (currentRoom && require("../coordinator/room-start-claims").hasRoomStartClaims(currentRoom))
            return false;
        if (this.deferDisbandForUnsettledMembers(roomNumber, reason, messageKey))
            return true;
        const deferred = this.deferredDisbands.get(roomNumber);
        if (deferred) {
            clearTimeout(deferred.timer);
            this.deferredDisbands.delete(roomNumber);
            console.warn(`[MULTI] deferred disband committed: room=${roomNumber} reason=${reason}`
                + ` remaining=${this.unsettledBattleClients(roomNumber).map(client => client.viewerId).join(",") || "none"}`);
        }
        const roomClients = this.getClientsInRoom(roomNumber);
        const lobbyClients = roomClients.filter(client => !client.isBattle);
        const battleClients = this.getConnectedBattleClients(roomNumber);
        const allClients = [...new Set([...roomClients, ...battleClients])];
        this.clearBattleHeartbeatLeasesForRoom(roomNumber);
        let deleted = false;
        try {
            const { disbandRoom } = require("../room/manager");
            // Commit the room as non-joinable before telling clients that it
            // was dismissed.  This makes the protocol message truthful even
            // when a client immediately tries restore_room/select_room.
            deleted = disbandRoom(roomNumber, reason);
        }
        catch (e) {
            this.removeRoomState(roomNumber);
        }
        if (!deleted)
            return false;
        // MeetingServerMessage.Disbanded is valid only on cooperation_room.
        // Sending its enum index (6) to cooperation_battle makes the battle
        // unserializer dereference a missing enum entry and crash with C5602.
        const notifiedLobbySockets = new Set();
        for (const client of lobbyClients) {
            const sendResult = this.sendJson(client.socket, [1, [6, messageKey]], {
                roomNumber,
                connectionId: client.connectionId,
                viewerId: client.viewerId,
                roomGeneration: client.roomGeneration,
                channel: "room_disband",
            });
            if (sendResult !== "closed")
                notifiedLobbySockets.add(client.socket);
        }
        for (const client of allClients) {
            const addr = this.addr(client.viewerId, roomNumber);
            if (this.clients.get(addr) === client)
                this.clients.delete(addr);
            if (client.isBattle)
                this.cidToBattleClient.delete(client.connectionId);
            this.unindexClientSocket(client);
            if (!client.isBattle && notifiedLobbySockets.has(client.socket)) {
                this.retireDisbandedLobbySocket(client.socket, roomNumber);
            }
            else {
                (0, disconnect_diagnostics_1.markTcpDisconnectReason)(client.socket, "room_disband");
                try {
                    client.socket.end();
                }
                catch (e) { }
                setTimeout(() => {
                    try {
                        client.socket.destroy();
                    }
                    catch (e) { }
                }, 250).unref();
            }
        }
        this.closeSupersededSocketsForRoom(roomNumber);
        this.roomClients.delete(roomNumber);
        this.battleClients.delete(roomNumber);
        this.battleRelayMembershipChanged(roomNumber);
        this.clearBattleExpectedCount(roomNumber);
        this.retiredBattleSeats.delete(roomNumber);
        (0, game_logging_1.gameVerboseLog)(() => `[MULTI] room disbanded: room=${roomNumber} reason=${reason}`);
        return true;
    }
    disbandRoomIfNoRealConnections(roomNumber, battleRoomTimeoutExpired = false) {
        var _a, _b, _c, _d;
        const lobbyConnectionCount = (_b = (_a = this.roomClients.get(roomNumber)) === null || _a === void 0 ? void 0 : _a.size) !== null && _b !== void 0 ? _b : 0;
        const battleConnectionCount = (_d = (_c = this.battleClients.get(roomNumber)) === null || _c === void 0 ? void 0 : _c.size) !== null && _d !== void 0 ? _d : 0;
        if (lobbyConnectionCount > 0 || battleConnectionCount > 0)
            return;
        if (this.hostReconnectTimers.has(roomNumber))
            return;
        try {
            const { getRoom } = require("../room/manager");
            const room = getRoom(roomNumber);
            if (!room)
                return;
            // The CN client closes the battle TCP socket as soon as the battle
            // scene has been initialized. The actual fight can then continue
            // client-side for minutes, so the 25-second reconnect grace must not
            // start here or the room can disappear before /finish is sent.
            // Keep only a long abandoned-battle watchdog for clients that never
            // send either /finish or /abort.
            if (room.lifecycle.phase === "BATTLE" && !battleRoomTimeoutExpired) {
                if (!this.abandonedBattleTimers.has(roomNumber)) {
                    const battleRoomTimeoutMs = parseInt(process.env.BATTLE_ROOM_TIMEOUT_MS || "900000");
                    const lifecycle = embedded_1.embeddedMultiCoordinator.ensureLifecycle(room);
                    const roomInstanceId = lifecycle.instanceId;
                    const battleSessionId = lifecycle.battleSessionId;
                    const timer = setTimeout(() => {
                        void embedded_1.embeddedMultiCoordinator.enqueueRoomCommand(roomNumber, () => {
                            if (this.abandonedBattleTimers.get(roomNumber) !== timer)
                                return;
                            this.abandonedBattleTimers.delete(roomNumber);
                            const currentRoom = getRoom(roomNumber);
                            if (!embedded_1.embeddedMultiCoordinator.isCurrentInstance(currentRoom, roomInstanceId)
                                || currentRoom.lifecycle.battleSessionId !== battleSessionId
                                || currentRoom.lifecycle.phase !== "BATTLE")
                                return;
                            this.disbandRoomIfNoRealConnections(roomNumber, true);
                        }).catch(error => console.error(`[MULTI] abandoned battle timeout failed: room=${roomNumber}`, error));
                    }, battleRoomTimeoutMs);
                    timer.unref();
                    this.abandonedBattleTimers.set(roomNumber, timer);
                    (0, game_logging_1.gameVerboseLog)(() => `[MULTI] waiting for battle finish: room=${roomNumber} timeoutMs=${battleRoomTimeoutMs}`);
                }
                return;
            }
            // Successful settlement has its own timer, deliberately separate
            // from REMATCH_RECONNECT_GRACE_MS. The latter starts only after the
            // return lobby exists and is used to wait for missing real players.
            if (room.settlement_return_pending)
                return;
            const pendingTimer = this.abandonedBattleTimers.get(roomNumber);
            if (pendingTimer)
                clearTimeout(pendingTimer);
            this.abandonedBattleTimers.delete(roomNumber);
            this.roomClients.delete(roomNumber);
            this.battleClients.delete(roomNumber);
            this.battleRelayMembershipChanged(roomNumber);
            this.sceneReadyClients.delete(roomNumber);
            this.battleLevelNextClients.delete(roomNumber);
            this.battleExpectedCount.delete(roomNumber);
            try {
                const { stopRandomRecruitment } = require("../recruitment");
                stopRandomRecruitment(roomNumber);
            }
            catch (e) { }
            this.commitRoomDisband(roomNumber, "all_real_connections_closed");
            (0, game_logging_1.gameVerboseLog)(() => `[MULTI] room disbanded: all real connections closed room=${roomNumber}`);
        }
        catch (e) { }
    }
    beginSettlementReturnGrace(roomNumber) {
        const existingTimer = this.settlementReturnTimers.get(roomNumber);
        if (existingTimer)
            clearTimeout(existingTimer);
        this.settlementReturnTimers.delete(roomNumber);
        const abandonedTimer = this.abandonedBattleTimers.get(roomNumber);
        if (abandonedTimer)
            clearTimeout(abandonedTimer);
        this.abandonedBattleTimers.delete(roomNumber);
        let roomInstanceId;
        let lifecycleVersion;
        try {
            const { getRoom } = require("../room/manager");
            const room = getRoom(roomNumber);
            if (!room || room.lifecycle.phase !== "RETURNING")
                return;
            const lifecycle = embedded_1.embeddedMultiCoordinator.ensureLifecycle(room);
            roomInstanceId = lifecycle.instanceId;
            lifecycleVersion = lifecycle.version;
            if ((0, contract_1.isFiveBossGauntletQuest)(room.category, room.quest_id)
                && this.isHostOnline(room.host_viewer_id, roomNumber)) {
                this.completeSettlementReturn(roomNumber);
                return;
            }
        }
        catch (e) {
            return;
        }
        const settlementReturnGraceMs = parseInt(process.env.SETTLEMENT_RETURN_GRACE_MS || "60000");
        const timer = setTimeout(() => {
            void embedded_1.embeddedMultiCoordinator.enqueueRoomCommand(roomNumber, () => {
                if (this.settlementReturnTimers.get(roomNumber) !== timer)
                    return;
                this.settlementReturnTimers.delete(roomNumber);
                try {
                    const { getRoom } = require("../room/manager");
                    const room = getRoom(roomNumber);
                    if (!embedded_1.embeddedMultiCoordinator.isCurrentInstance(room, roomInstanceId)
                        || room.lifecycle.version !== lifecycleVersion
                        || room.lifecycle.phase !== "RETURNING"
                        || !room.settlement_return_pending)
                        return;
                    // Only the host completing the lobby Enter flow counts as a
                    // successful room return. Guests may wait during the grace
                    // period, but they must not keep a hostless room alive.
                    this.commitRoomDisband(roomNumber, "settlement_host_return_timeout");
                    console.warn(`[MULTI] room disbanded: host did not return after settlement room=${roomNumber}`);
                }
                catch (e) { }
            }).catch(error => console.error(`[MULTI] settlement return timeout failed: room=${roomNumber}`, error));
        }, settlementReturnGraceMs);
        timer.unref();
        this.settlementReturnTimers.set(roomNumber, timer);
        (0, game_logging_1.gameVerboseLog)(() => `[MULTI] waiting for settlement lobby return: room=${roomNumber} graceMs=${settlementReturnGraceMs}`);
    }
    completeSettlementReturn(roomNumber) {
        const currentRoom = require("../room/manager").getRoom(roomNumber);
        if (currentRoom && require("../coordinator/room-start-claims").hasRoomStartClaims(currentRoom))
            return false;
        const pendingTimer = this.settlementReturnTimers.get(roomNumber);
        if (pendingTimer)
            clearTimeout(pendingTimer);
        this.settlementReturnTimers.delete(roomNumber);
        let roomGeneration;
        let roomInstanceId;
        let completed = false;
        try {
            const { getRoom } = require("../room/manager");
            const room = getRoom(roomNumber);
            if (room) {
                const transition = embedded_1.embeddedMultiCoordinator.applyRoomCommand(room, {
                    roomNumber, identity: embedded_1.embeddedMultiCoordinator.identity(room), kind: "COMPLETE_RETURN",
                });
                if (transition.ok) {
                    roomGeneration = room.lobby_generation;
                    roomInstanceId = room.lifecycle.instanceId;
                    for (const client of this.getClientsInRoom(roomNumber)) {
                        if (!client.isBattle && !client.superseded && !client.socket.destroyed) {
                            client.roomGeneration = room.lobby_generation;
                        }
                    }
                    completed = true;
                    this.battleRelayMembershipChanged(roomNumber);
                }
            }
        }
        catch (e) { }
        try {
            // Keep room lifetime and settlement eligibility independent.  A
            // successful host return advances retained finish snapshots to
            // LOBBY, but they remain replayable for their short TTL.
            const { transitionRoomSettlementSnapshots } = require("../settlement-snapshot");
            if (roomGeneration !== undefined) {
                transitionRoomSettlementSnapshots(roomNumber, "LOBBY", roomGeneration, roomInstanceId);
            }
        }
        catch (e) { }
        if (completed)
            (0, game_logging_1.gameVerboseLog)(() => `[MULTI] settlement host returned: room=${roomNumber}`);
        return completed;
    }
    createClient(socket, viewerId, roomNumber, connectionId, playerId) {
        return {
            socket,
            viewerId,
            roomNumber,
            connectionId,
            playerId,
            isBattle: false,
            isReady: false,
            buffer: "",
            mates: [],
            enterData: null,
            roomGeneration: 0,
            connectionGeneration: 0,
            superseded: false,
            connectedAt: Date.now(),
            fiveBossBattleEntered: false,
            finalizeSent: false,
            admissionClaimed: false,
            clientState: new ClientStateMachine_1.ClientStateMachine(types_1.ClientState.Connecting),
            battleState: types_1.BattleState.Initializing,
        };
    }
    getClient(viewerId, roomNumber) {
        return this.clients.get(this.addr(viewerId, roomNumber));
    }
    getLobbyClientsForPlayer(playerId) {
        return [...this.clients.values()].filter(client => client.playerId === playerId && !client.isBattle && !client.superseded);
    }
    getRoomClientByConnectionId(roomNumber, connectionId) {
        for (const client of this.getClientsInRoom(roomNumber)) {
            if (!client.isBattle && client.connectionId === connectionId)
                return client;
        }
        return undefined;
    }
    /**
     * Resolve who owns a battle connection id. The lobby connection that
     * issued the id is authoritative; when it is gone, a known battle seat for
     * the same connection id (live, awaiting reconnect, on the StartBattle
     * roster, or frozen by the five-boss runtime) identifies the viewer. Unknown ids resolve to null.
     */
    resolveBattleHandshakeIdentity(roomNumber, connectionId) {
        var _a, _b, _c, _d, _e, _f;
        const currentRoom = require("../room/manager").getRoom(roomNumber);
        const roomClient = this.getRoomClientByConnectionId(roomNumber, connectionId);
        if (roomClient) {
            if (roomClient.roomInstanceId && roomClient.roomInstanceId !== (currentRoom === null || currentRoom === void 0 ? void 0 : currentRoom.lifecycle.instanceId))
                return null;
            return {
                viewerId: roomClient.viewerId,
                playerId: roomClient.playerId,
                roomGeneration: roomClient.roomGeneration,
            };
        }
        const battleClient = this.cidToBattleClient.get(connectionId);
        if (battleClient && battleClient.roomNumber === roomNumber && battleClient.viewerId > 0) {
            if (!this.isCurrentBattleClient(battleClient))
                return null;
            return {
                viewerId: battleClient.viewerId,
                playerId: battleClient.playerId,
                roomGeneration: battleClient.roomGeneration,
            };
        }
        let room;
        try {
            room = require("../room/manager").getRoom(roomNumber);
        }
        catch (e) {
            room = undefined;
        }
        const memberPlayerId = (viewerId) => {
            try {
                return room ? require("../room/manager").getRoomMemberPlayerId(room, viewerId) : null;
            }
            catch (e) {
                return null;
            }
        };
        // Battle peers carry the lobby round they started from; a seat that
        // reconnects without its lobby socket must join that same round.
        const battleGeneration = () => {
            var _a, _b, _c;
            for (const id of (_a = this.battleClients.get(roomNumber)) !== null && _a !== void 0 ? _a : []) {
                const peer = this.cidToBattleClient.get(id);
                if (peer)
                    return peer.roomGeneration;
            }
            return ((_b = room === null || room === void 0 ? void 0 : room.lifecycle) === null || _b === void 0 ? void 0 : _b.phase) === "BATTLE"
                ? Math.max(0, Number((_c = room.lobby_generation) !== null && _c !== void 0 ? _c : 0) - 1)
                : undefined;
        };
        for (const seat of (_b = (_a = this.battleBarrierCycles.get(roomNumber)) === null || _a === void 0 ? void 0 : _a.missing.values()) !== null && _b !== void 0 ? _b : []) {
            if (seat.connectionId === connectionId && seat.viewerId > 0) {
                return {
                    viewerId: seat.viewerId,
                    playerId: memberPlayerId(seat.viewerId),
                    roomGeneration: battleGeneration(),
                };
            }
        }
        const rostered = (_c = this.battleRosterSeats.get(roomNumber)) === null || _c === void 0 ? void 0 : _c.get(connectionId);
        if (rostered) {
            return {
                viewerId: rostered.viewerId,
                playerId: (_d = rostered.playerId) !== null && _d !== void 0 ? _d : memberPlayerId(rostered.viewerId),
                roomGeneration: rostered.roomGeneration,
            };
        }
        const frozen = (_e = room === null || room === void 0 ? void 0 : room.five_boss_runtime) === null || _e === void 0 ? void 0 : _e.battleIdentityByViewerId;
        if (frozen && typeof frozen === "object") {
            for (const [viewerKey, identity] of Object.entries(frozen)) {
                const viewerId = Number(viewerKey);
                if ((identity === null || identity === void 0 ? void 0 : identity.connectionId) === connectionId && Number.isSafeInteger(viewerId) && viewerId > 0) {
                    return { viewerId, playerId: (_f = identity.playerId) !== null && _f !== void 0 ? _f : null, roomGeneration: battleGeneration() };
                }
            }
        }
        return null;
    }
    addClientToRoom(client) {
        var _a;
        const room = require("../room/manager").getRoom(client.roomNumber);
        if (room)
            require("../../lib/weapon-riven/multi-room").cancelWeaponRivenPreparation(room, "connection_changed");
        if (room)
            client.roomInstanceId = room.lifecycle.instanceId;
        const addr = this.addr(client.viewerId, client.roomNumber);
        const previous = this.clients.get(addr);
        const nextConnectionGeneration = ((_a = this.roomConnectionGenerations.get(addr)) !== null && _a !== void 0 ? _a : 0) + 1;
        this.roomConnectionGenerations.set(addr, nextConnectionGeneration);
        client.connectionGeneration = nextConnectionGeneration;
        client.superseded = false;
        this.clients.set(addr, client);
        if (previous && previous !== client && previous.socket !== client.socket) {
            require("../tcp/lobby").clearPendingFiveBossReturnEnter(previous, "connection_replaced");
            (0, equipment_ready_1.clearEquipmentBlock)(previous);
            previous.superseded = true;
            this.unindexClientSocket(previous);
            (0, reliable_send_1.clearReliableSendState)(previous.socket);
            const closeCheckMs = this.quarantineSupersededSocket(`lobby:${addr}`, client.roomNumber, previous.socket, () => {
                const current = this.clients.get(addr);
                return !!current && current !== previous && !current.socket.destroyed;
            });
            (0, game_logging_1.gameVerboseLog)(() => `[MULTI] room connection superseded: viewer=${client.viewerId}`
                + ` room=${client.roomNumber} oldGeneration=${previous.connectionGeneration}`
                + ` newGeneration=${client.connectionGeneration} closeCheckMs=${closeCheckMs}`);
        }
        this.indexClientSocket(client);
        let set = this.roomClients.get(client.roomNumber);
        if (!set) {
            set = new Set();
            this.roomClients.set(client.roomNumber, set);
        }
        set.add(addr);
        if (this.isRescueGuest(client.roomNumber, client.viewerId)) {
            this.clearRescueGuestReconnect(client.roomNumber, client.viewerId);
        }
        return { ok: true, value: undefined };
    }
    removeClient(client) {
        var _a, _b, _c, _d, _e, _f, _g;
        require("../tcp/lobby").clearPendingFiveBossReturnEnter(client, "connection_removed");
        (0, equipment_ready_1.clearEquipmentBlock)(client);
        if (client.isBattle)
            connection_diagnostic_1.fiveBossConnectionDiagnostics.socketEvent(client.socket, "removed", this.cidToBattleClient.get(client.connectionId) === client ? "current_connection" : "stale_connection");
        this.unindexClientSocket(client);
        if (!client.isBattle && client.admissionClaimed) {
            admission_1.roomAdmissionRegistry.releaseClaim(client.roomNumber, (_a = client.admissionGeneration) !== null && _a !== void 0 ? _a : client.roomGeneration, client.viewerId, client.connectionId);
            client.admissionClaimed = false;
        }
        const addr = this.addr(client.viewerId, client.roomNumber);
        const isCurrentConnection = this.clients.get(addr) === client;
        if (isCurrentConnection && !client.isBattle) {
            const room = require("../room/manager").getRoom(client.roomNumber);
            if (room)
                require("../../lib/weapon-riven/multi-room").cancelWeaponRivenPreparation(room, "connection_removed");
        }
        if (!client.isBattle && (!isCurrentConnection || client.superseded)) {
            return { ok: true, value: undefined };
        }
        if (isCurrentConnection)
            this.clients.delete(addr);
        if (client.isBattle) {
            const superseded = this.supersededBattleClients.delete(client);
            const isCurrentBattleConnection = this.cidToBattleClient.get(client.connectionId) === client;
            if (isCurrentBattleConnection)
                this.clearBattleHeartbeatLease(client.connectionId);
            const bSet = this.battleClients.get(client.roomNumber);
            if (bSet && !superseded && isCurrentBattleConnection) {
                this.publishBattleDeparture(client);
            }
            if (isCurrentBattleConnection) {
                (_b = this.battleClients.get(client.roomNumber)) === null || _b === void 0 ? void 0 : _b.delete(client.connectionId);
                if (((_c = this.battleClients.get(client.roomNumber)) === null || _c === void 0 ? void 0 : _c.size) === 0) {
                    this.battleClients.delete(client.roomNumber);
                }
                this.cidToBattleClient.delete(client.connectionId);
                (_d = this.sceneReadyClients.get(client.roomNumber)) === null || _d === void 0 ? void 0 : _d.delete(client.connectionId);
                (_e = this.battleLevelNextClients.get(client.roomNumber)) === null || _e === void 0 ? void 0 : _e.delete(client.connectionId);
                this.battleRelayMembershipChanged(client.roomNumber);
            }
            if (!superseded && isCurrentBattleConnection)
                this.scheduleMissingBattleSeat(client.roomNumber, client);
        }
        const set = this.roomClients.get(client.roomNumber);
        if (set && isCurrentConnection) {
            set.delete(addr);
            if (!client.isBattle) {
                try {
                    const { getRoom } = require("../room/manager");
                    const room = getRoom(client.roomNumber);
                    if (room
                        && room.lifecycle.phase === "LOBBY"
                        && client.roomGeneration === room.lobby_generation) {
                        const remaining = this.getClientsInRoom(client.roomNumber, room.lobby_generation);
                        for (const other of remaining) {
                            other.mates = other.mates.filter(mate => mate.viewerId !== client.viewerId);
                        }
                        const host = remaining.find(other => other.viewerId === room.host_viewer_id);
                        room.mates = ((_f = host === null || host === void 0 ? void 0 : host.mates) !== null && _f !== void 0 ? _f : remaining.map(other => other.yourself).filter(Boolean))
                            .map((mate) => {
                            var _a, _b, _c;
                            return ({
                                viewer_id: (_a = mate.viewerId) !== null && _a !== void 0 ? _a : null,
                                com_id: (_b = mate.comId) !== null && _b !== void 0 ? _b : 0,
                                player_id: (_c = mate.playerId) !== null && _c !== void 0 ? _c : undefined,
                            });
                        });
                        if (host) {
                            this.broadcastToRoom(client.roomNumber, [1, [1, host.mates]]);
                            try {
                                const lobby = require("../tcp/lobby");
                                (_g = lobby.scheduleRematchDisconnectCleanup) === null || _g === void 0 ? void 0 : _g.call(lobby, client.roomNumber);
                            }
                            catch (e) { }
                        }
                    }
                }
                catch (e) { }
            }
            if (set.size === 0) {
                this.roomClients.delete(client.roomNumber);
            }
            else {
                // OLD: if room still has clients, re-evaluate host auto-ready
                if (!client.isBattle) {
                    try {
                        const lobby = require("../tcp/lobby");
                        if (lobby.checkHostAutoReady)
                            lobby.checkHostAutoReady(client.roomNumber);
                    }
                    catch (e) { }
                }
            }
        }
        if (!client.isBattle && isCurrentConnection) {
            try {
                const { getRoom } = require("../room/manager");
                const room = getRoom(client.roomNumber);
                if (room && room.lifecycle.phase === "LOBBY") {
                    if (room.host_viewer_id === client.viewerId) {
                        this.beginHostReconnectGrace(client.roomNumber);
                    }
                    else {
                        this.beginRescueGuestReconnectGrace(client);
                    }
                }
            }
            catch (e) { }
        }
        this.disbandRoomIfNoRealConnections(client.roomNumber);
        return { ok: true, value: undefined };
    }
    getClientsInRoom(roomNumber, roomGeneration) {
        const set = this.roomClients.get(roomNumber);
        if (!set)
            return [];
        const out = [];
        for (const addr of set) {
            const c = this.clients.get(addr);
            if (c && (roomGeneration === undefined || c.roomGeneration === roomGeneration))
                out.push(c);
        }
        return out;
    }
    /** True while any lobby or battle connection is indexed for the room. */
    hasRoomConnections(roomNumber) {
        var _a, _b, _c, _d;
        return ((_b = (_a = this.roomClients.get(roomNumber)) === null || _a === void 0 ? void 0 : _a.size) !== null && _b !== void 0 ? _b : 0) > 0
            || ((_d = (_c = this.battleClients.get(roomNumber)) === null || _c === void 0 ? void 0 : _c.size) !== null && _d !== void 0 ? _d : 0) > 0;
    }
    hasRoomClients(roomNumber) {
        const set = this.roomClients.get(roomNumber);
        return !!set && set.size > 0;
    }
    isHostOnline(hostViewerId, roomNumber, roomGeneration) {
        const set = this.roomClients.get(roomNumber);
        if (!set)
            return false;
        for (const addr of set) {
            const c = this.clients.get(addr);
            if (c
                && !c.isBattle
                && !c.superseded
                && c.enterData !== null
                && !c.socket.destroyed
                && c.viewerId === hostViewerId
                && (roomGeneration === undefined || c.roomGeneration === roomGeneration))
                return true;
        }
        return false;
    }
    addBattleClient(connectionId, client) {
        var _a, _b, _c;
        const seatKey = this.battleSeatKey(client);
        // A seat already handed to AI cannot form a second independent battle
        // by arriving after grace. The next actual round resets this decision.
        const retired = this.retiredBattleSeats.get(client.roomNumber);
        if ((retired === null || retired === void 0 ? void 0 : retired.has(seatKey)) || (retired === null || retired === void 0 ? void 0 : retired.has(`connection:${connectionId}`)))
            return false;
        const room = require("../room/manager").getRoom(client.roomNumber);
        if (room && !(0, battle_contract_1.bindBattleConnection)(room, client))
            return false;
        const cycle = this.battleBarrierCycles.get(client.roomNumber);
        cycle === null || cycle === void 0 ? void 0 : cycle.arrived.add(seatKey);
        cycle === null || cycle === void 0 ? void 0 : cycle.arrived.add(`connection:${connectionId}`);
        const reconnectTimer = cycle === null || cycle === void 0 ? void 0 : cycle.timers.get(seatKey);
        if (reconnectTimer)
            clearTimeout(reconnectTimer);
        cycle === null || cycle === void 0 ? void 0 : cycle.timers.delete(seatKey);
        const missing = cycle === null || cycle === void 0 ? void 0 : cycle.missing.get(seatKey);
        if (missing)
            (_a = this.pendingBattleLeaves.get(client.roomNumber)) === null || _a === void 0 ? void 0 : _a.delete(missing.connectionId);
        cycle === null || cycle === void 0 ? void 0 : cycle.missing.delete(seatKey);
        const pendingTimer = this.abandonedBattleTimers.get(client.roomNumber);
        if (pendingTimer)
            clearTimeout(pendingTimer);
        this.abandonedBattleTimers.delete(client.roomNumber);
        let set = this.battleClients.get(client.roomNumber);
        if (!set) {
            set = new Set();
            this.battleClients.set(client.roomNumber, set);
        }
        // A reconnect may establish a replacement socket before the old one
        // emits close.  Keep one battle connection per real viewer so the
        // SceneReady barrier cannot count a stale socket as a missing player.
        for (const existingConnectionId of [...set]) {
            const existing = this.cidToBattleClient.get(existingConnectionId);
            if (!existing)
                continue;
            const sameSocketIdentity = existingConnectionId === connectionId;
            const sameKnownViewer = client.viewerId > 0
                && existing.viewerId > 0
                && existing.viewerId === client.viewerId;
            if (!sameSocketIdentity && !sameKnownViewer)
                continue;
            this.clearBattleHeartbeatLease(existingConnectionId);
            set.delete(existingConnectionId);
            (_b = this.sceneReadyClients.get(client.roomNumber)) === null || _b === void 0 ? void 0 : _b.delete(existingConnectionId);
            (_c = this.battleLevelNextClients.get(client.roomNumber)) === null || _c === void 0 ? void 0 : _c.delete(existingConnectionId);
            this.cidToBattleClient.delete(existingConnectionId);
            this.supersededBattleClients.add(existing);
            existing.superseded = true;
            connection_diagnostic_1.fiveBossConnectionDiagnostics.socketEvent(existing.socket, "replaced");
            this.unindexClientSocket(existing);
            (0, reliable_send_1.clearReliableSendState)(existing.socket);
            const ownerIdentity = client.viewerId > 0 ? `viewer:${client.viewerId}` : `connection:${connectionId}`;
            this.quarantineSupersededSocket(`battle:${ownerIdentity}@${client.roomNumber}`, client.roomNumber, existing.socket, () => {
                const current = this.cidToBattleClient.get(connectionId);
                if (current === client && !current.socket.destroyed)
                    return true;
                if (client.viewerId <= 0)
                    return false;
                return [...this.cidToBattleClient.values()].some(candidate => candidate !== existing
                    && candidate.roomNumber === client.roomNumber
                    && candidate.viewerId === client.viewerId
                    && !candidate.socket.destroyed);
            });
            this.logBattleBarrierState(client.roomNumber, "connection_replaced");
        }
        const pendingLeaves = this.pendingBattleLeaves.get(client.roomNumber);
        pendingLeaves === null || pendingLeaves === void 0 ? void 0 : pendingLeaves.delete(connectionId);
        if ((pendingLeaves === null || pendingLeaves === void 0 ? void 0 : pendingLeaves.size) === 0)
            this.pendingBattleLeaves.delete(client.roomNumber);
        set.add(connectionId);
        this.cidToBattleClient.set(connectionId, client);
        this.battleRelayMembershipChanged(client.roomNumber);
        this.indexClientSocket(client);
        this.armBattleLoadingLease(connectionId);
        connection_diagnostic_1.fiveBossConnectionDiagnostics.socketEvent(client.socket, "accepted");
        battle_telemetry_1.battleTelemetry.connected(client.roomNumber, client.viewerId);
        this.logBattleBarrierState(client.roomNumber, "connected");
        return true;
    }
    removeBattleClient(connectionId) {
        var _a, _b, _c;
        this.clearBattleHeartbeatLease(connectionId);
        const client = this.cidToBattleClient.get(connectionId);
        if (client) {
            connection_diagnostic_1.fiveBossConnectionDiagnostics.socketEvent(client.socket, "removed", "remove_battle_client");
            this.publishBattleDeparture(client);
            this.unindexClientSocket(client);
            (_a = this.battleClients.get(client.roomNumber)) === null || _a === void 0 ? void 0 : _a.delete(connectionId);
            (_b = this.sceneReadyClients.get(client.roomNumber)) === null || _b === void 0 ? void 0 : _b.delete(connectionId);
            (_c = this.battleLevelNextClients.get(client.roomNumber)) === null || _c === void 0 ? void 0 : _c.delete(connectionId);
        }
        this.cidToBattleClient.delete(connectionId);
        if (client)
            this.battleRelayMembershipChanged(client.roomNumber);
        if (client)
            this.scheduleMissingBattleSeat(client.roomNumber, client);
    }
    getBattleClient(connectionId) {
        return this.cidToBattleClient.get(connectionId);
    }
    findClientBySocket(socket) {
        return this.socketClients.get(socket);
    }
    isSupersededSocket(socket) {
        return this.supersededSockets.has(socket);
    }
    isRetiredLobbySocket(socket) {
        return this.retiredLobbySockets.has(socket);
    }
    isCurrentBattleClient(client) {
        if (this.cidToBattleClient.get(client.connectionId) !== client || client.superseded)
            return false;
        const room = require("../room/manager").getRoom(client.roomNumber);
        return client.roomInstanceId ? !!room && (0, battle_contract_1.battleConnectionMatches)(room, client) : true;
    }
    /** Publish all current members, including parent-owned native sockets. */
    battleRelayMembershipChanged(roomNumber) {
        var _a;
        const room = require("../room/manager").getRoom(roomNumber);
        bridge_1.battleRelayBridge.scheduleMembership(roomNumber, () => {
            var _a;
            const members = [];
            for (const connectionId of (_a = this.battleClients.get(roomNumber)) !== null && _a !== void 0 ? _a : []) {
                const client = this.cidToBattleClient.get(connectionId);
                if (!client || !this.isCurrentBattleClient(client) || client.socket.destroyed || !client.socket.writable)
                    continue;
                members.push({
                    sid: (0, bridge_1.isRelayProxySocket)(client.socket) ? client.socket.sid : null,
                    cid: connectionId, gen: client.roomGeneration,
                });
            }
            return members;
        }, (room === null || room === void 0 ? void 0 : room.lifecycle) ? {
            instanceId: room.lifecycle.instanceId, battleSessionId: room.lifecycle.battleSessionId,
            sceneEpoch: (_a = room.lifecycle.sceneEpoch) !== null && _a !== void 0 ? _a : 0,
        } : undefined);
    }
    snapshotBattleRelayRecipients(source, includeSource = false) {
        if (!this.isCurrentBattleClient(source))
            return [];
        const set = this.battleClients.get(source.roomNumber);
        if (!set)
            return [];
        const recipients = [];
        // Snapshot both ids and resolved clients before forwarding. A reconnect
        // during the loop must not replace or remove one receiver halfway through
        // this logical broadcast.
        for (const connectionId of [...set]) {
            if (!includeSource && connectionId === source.connectionId)
                continue;
            const client = this.cidToBattleClient.get(connectionId);
            if (!client
                || !this.isCurrentBattleClient(client)
                || client.roomGeneration !== source.roomGeneration
                || client.socket.destroyed
                || !client.socket.writable)
                continue;
            recipients.push(client);
        }
        return recipients;
    }
    markSceneReady(connectionId, roomNumber) {
        var _a, _b;
        const client = this.cidToBattleClient.get(connectionId);
        if (!client || client.roomNumber !== roomNumber || client.socket.destroyed || !this.isCurrentBattleClient(client))
            return false;
        const room = require("../room/manager").getRoom(roomNumber);
        if (room && require("../coordinator/room-start-claims").hasRoomStartClaims(room))
            return false;
        // Legacy arrays have no scene id. TCP order plus each connection's
        // LevelNext fences delayed previous-scene readiness.
        if (room && !(0, battle_contract_1.battleMemberCanPlay)(room, client.viewerId))
            return false;
        if (room && client.sceneEpoch !== undefined
            && client.sceneEpoch !== ((_a = room.lifecycle.sceneEpoch) !== null && _a !== void 0 ? _a : 0))
            return false;
        const expected = (_b = this.battleExpectedCount.get(roomNumber)) !== null && _b !== void 0 ? _b : 0;
        if (expected <= 0) {
            if (this.battleSceneStartedRooms.has(roomNumber)) {
                this.recordFiveBossBattleEntry(roomNumber, this.getConnectedBattleClients(roomNumber));
                if (client.fiveBossBattleEntered) {
                    this.clearBattleHeartbeatLease(connectionId);
                }
            }
            return false;
        }
        let readySet = this.sceneReadyClients.get(roomNumber);
        if (!readySet) {
            readySet = new Set();
            this.sceneReadyClients.set(roomNumber, readySet);
        }
        readySet.add(connectionId);
        if (room)
            (0, battle_contract_1.markBattleMemberPhase)(room, client.viewerId, "READY");
        if (client.fiveBossBattleEntered) {
            // During the next-boss barrier, the ready peer may legitimately
            // wait longer than 25 seconds for another peer's loading lease.
            // The slow peer's fixed deadline owns that wait.
            this.clearBattleHeartbeatLease(connectionId);
        }
        else {
            this.armBattleReadyHeartbeatLease(connectionId);
        }
        const released = this.releaseSceneReadyBarrierIfSatisfied(roomNumber, "scene_ready");
        if (released)
            this.activateBattleScene(roomNumber);
        return released;
    }
    beginBattleLevelNext(connectionId, roomNumber) {
        var _a, _b, _c;
        const client = this.cidToBattleClient.get(connectionId);
        if (!client || client.roomNumber !== roomNumber || client.socket.destroyed || !this.isCurrentBattleClient(client))
            return;
        const room = require("../room/manager").getRoom(roomNumber);
        let levelNextSet = this.battleLevelNextClients.get(roomNumber);
        if (room && !(0, battle_contract_1.battleMemberCanPlay)(room, client.viewerId))
            return;
        if (!levelNextSet) {
            if (room)
                (0, battle_contract_1.beginBattleSceneEpoch)(room);
            levelNextSet = new Set();
            this.battleLevelNextClients.set(roomNumber, levelNextSet);
            // CN's dual-boss battles keep the same TCP battle connection.
            // LevelNext starts a new SceneReady barrier for the next boss;
            // reusing the previous ready set would start the next scene before
            // every real player has finished loading it.
            this.sceneReadyClients.set(roomNumber, new Set());
            const connected = (_b = (_a = this.battleClients.get(roomNumber)) === null || _a === void 0 ? void 0 : _a.size) !== null && _b !== void 0 ? _b : 0;
            this.battleExpectedCount.set(roomNumber, connected);
            const cycle = this.beginBattleBarrierCycle(roomNumber);
            this.battleSceneStartedRooms.delete(roomNumber);
            this.logBattleBarrierState(roomNumber, "level_next");
            this.armLevelNextDeadline(roomNumber, cycle);
        }
        if (levelNextSet.has(connectionId))
            return;
        levelNextSet.add(connectionId);
        if (room) {
            client.sceneEpoch = (_c = room.lifecycle.sceneEpoch) !== null && _c !== void 0 ? _c : 0;
            (0, battle_contract_1.markBattleMemberPhase)(room, client.viewerId, "LOADING");
            this.battleRelayMembershipChanged(roomNumber);
        }
        // A teammate can still be fighting the preceding scene. Only its own
        // LevelNext starts its fixed loading deadline; duplicate packets cannot
        // reset that deadline or demote an already-ready connection.
        this.armBattleLoadingLease(connectionId);
    }
    /**
     * Bound the next-scene barrier for peers that never start it.
     *
     * A peer that sends LevelNext owns a fixed loading lease, and a peer that
     * closes its socket gets the missing-seat grace. A peer that keeps its
     * socket open but sends neither LevelNext nor SceneReady (frozen or
     * backgrounded app, half-open mobile link) had no deadline: an entered
     * five-boss connection has no heartbeat lease, so every teammate waited
     * on the transition screen indefinitely. After the deadline that peer is
     * disconnected; the ordinary close path retires its seat to AI.
     */
    armLevelNextDeadline(roomNumber, cycle) {
        const deadlineMs = this.parsePositiveDuration("BATTLE_LEVEL_NEXT_DEADLINE_MS", 90000, 10000);
        const timer = setTimeout(() => {
            // Match the loading lease: let already-arrived LevelNext/SceneReady
            // I/O run before deciding that a peer missed the transition.
            const check = setImmediate(() => {
                void embedded_1.embeddedMultiCoordinator.enqueueRoomCommand(roomNumber, () => {
                    var _a;
                    if (cycle.timers.get("level_next_deadline") !== timer)
                        return;
                    cycle.timers.delete("level_next_deadline");
                    if (!this.isCurrentBattleBarrier(roomNumber, cycle))
                        return;
                    if (((_a = this.battleExpectedCount.get(roomNumber)) !== null && _a !== void 0 ? _a : 0) <= 0)
                        return;
                    const started = this.battleLevelNextClients.get(roomNumber);
                    const ready = this.sceneReadyClients.get(roomNumber);
                    for (const client of this.getConnectedBattleClients(roomNumber)) {
                        if ((started === null || started === void 0 ? void 0 : started.has(client.connectionId)) || (ready === null || ready === void 0 ? void 0 : ready.has(client.connectionId)))
                            continue;
                        console.warn(`[MULTI] next scene never started: room=${roomNumber}`
                            + ` viewer=${client.viewerId} connection=${client.connectionId} timeoutMs=${deadlineMs}`);
                        connection_diagnostic_1.fiveBossConnectionDiagnostics.socketEvent(client.socket, "level_next_timeout", String(deadlineMs));
                        (0, disconnect_diagnostics_1.markTcpDisconnectReason)(client.socket, "level_next_timeout");
                        client.socket.destroy();
                    }
                }).catch(error => console.error(`[MULTI] next scene deadline failed: room=${roomNumber}`, error));
            });
            check.unref();
        }, deadlineMs);
        timer.unref();
        cycle.timers.set("level_next_deadline", timer);
    }
    clearSceneReady(roomNumber) {
        this.clearBattleBarrierCycle(roomNumber);
        this.sceneReadyClients.delete(roomNumber);
        this.battleLevelNextClients.delete(roomNumber);
        this.battleSceneStartedRooms.delete(roomNumber);
        this.pendingBattleLeaves.delete(roomNumber);
        this.battleRelayMembershipChanged(roomNumber);
    }
    setBattleExpectedCount(roomNumber, count, seats = []) {
        const room = require("../room/manager").getRoom(roomNumber);
        if (room)
            (0, battle_contract_1.ensureBattleSessionContract)(room);
        this.retiredBattleSeats.delete(roomNumber);
        const cycle = this.beginBattleBarrierCycle(roomNumber);
        this.sceneReadyClients.set(roomNumber, new Set());
        this.battleLevelNextClients.delete(roomNumber);
        this.battleExpectedCount.set(roomNumber, count);
        this.battleSceneStartedRooms.delete(roomNumber);
        this.pendingBattleLeaves.delete(roomNumber);
        const roster = new Map();
        for (const seat of seats) {
            if (!(seat.viewerId > 0) || !seat.connectionId)
                continue;
            const lobbyClient = this.getRoomClientByConnectionId(roomNumber, seat.connectionId);
            if (!lobbyClient || lobbyClient.viewerId !== seat.viewerId)
                continue;
            roster.set(seat.connectionId, {
                viewerId: seat.viewerId,
                playerId: lobbyClient.playerId,
                roomGeneration: lobbyClient.roomGeneration,
            });
        }
        if (roster.size > 0)
            this.battleRosterSeats.set(roomNumber, roster);
        else
            this.battleRosterSeats.delete(roomNumber);
        if (count > 0 && seats.length === count && seats.every(seat => seat.viewerId > 0 && seat.connectionId)
            && new Set(seats.map(seat => this.battleSeatKey(seat))).size === count) {
            // A frozen lobby member might never open a battle socket, so it
            // cannot trigger removeClient or a per-connection loading lease.
            const loadingMs = this.parsePositiveDuration("BATTLE_LOADING_LEASE_MS", 60000, 10000);
            const timer = setTimeout(() => {
                void embedded_1.embeddedMultiCoordinator.enqueueRoomCommand(roomNumber, () => {
                    if (cycle.timers.get("initial_roster") !== timer)
                        return;
                    cycle.timers.delete("initial_roster");
                    for (const seat of seats) {
                        if (!cycle.arrived.has(this.battleSeatKey(seat))
                            && !cycle.arrived.has(`connection:${seat.connectionId}`)) {
                            this.expireMissingBattleSeat(roomNumber, cycle, seat);
                        }
                    }
                }).catch(error => console.error(`[MULTI] initial barrier timeout failed: room=${roomNumber}`, error));
            }, loadingMs);
            timer.unref();
            cycle.timers.set("initial_roster", timer);
        }
        this.logBattleBarrierState(roomNumber, "expected_changed");
        if (this.releaseSceneReadyBarrierIfSatisfied(roomNumber, "expected_recheck")) {
            this.activateBattleScene(roomNumber);
        }
    }
    clearBattleExpectedCount(roomNumber) {
        this.clearBattleBarrierCycle(roomNumber);
        // Settlement may clear transient barriers before the room leaves
        // BATTLE. Keep expired seats fenced until the next round or disband.
        this.sceneReadyClients.delete(roomNumber);
        this.battleLevelNextClients.delete(roomNumber);
        this.battleExpectedCount.delete(roomNumber);
        this.battleRosterSeats.delete(roomNumber);
        this.battleBarrierLogState.delete(roomNumber);
        this.battleSceneStartedRooms.delete(roomNumber);
        this.pendingBattleLeaves.delete(roomNumber);
        this.battleRelayMembershipChanged(roomNumber);
    }
    removeRoomState(roomNumber) {
        var _a;
        for (const client of this.getClientsInRoom(roomNumber))
            (0, equipment_ready_1.clearEquipmentBlock)(client);
        this.clearBattleBarrierCycle(roomNumber);
        this.retiredBattleSeats.delete(roomNumber);
        this.battleRosterSeats.delete(roomNumber);
        (0, chain_diagnostic_1.clearChainDiagnosticRoom)(roomNumber);
        const abandonedTimer = this.abandonedBattleTimers.get(roomNumber);
        if (abandonedTimer)
            clearTimeout(abandonedTimer);
        this.abandonedBattleTimers.delete(roomNumber);
        const settlementTimer = this.settlementReturnTimers.get(roomNumber);
        if (settlementTimer)
            clearTimeout(settlementTimer);
        this.settlementReturnTimers.delete(roomNumber);
        this.cancelHostReconnectGrace(roomNumber);
        this.clearRescueGuestStateForRoom(roomNumber);
        this.clearBattleHeartbeatLeasesForRoom(roomNumber);
        this.battleBarrierLogState.delete(roomNumber);
        this.battleSceneStartedRooms.delete(roomNumber);
        this.pendingBattleLeaves.delete(roomNumber);
        for (const key of this.roomConnectionGenerations.keys()) {
            if (key.endsWith(`@${roomNumber}`))
                this.roomConnectionGenerations.delete(key);
        }
        try {
            const lobby = require("../tcp/lobby");
            (_a = lobby.clearLobbyRoomState) === null || _a === void 0 ? void 0 : _a.call(lobby, roomNumber);
        }
        catch (e) { }
    }
    sendJson(socket, data, context) {
        var _a, _b;
        if ((data === null || data === void 0 ? void 0 : data[0]) === 1 && ((_a = data === null || data === void 0 ? void 0 : data[1]) === null || _a === void 0 ? void 0 : _a[0]) === 1 && Array.isArray((_b = data === null || data === void 0 ? void 0 : data[1]) === null || _b === void 0 ? void 0 : _b[1])
            && require("../../lib/weapon-riven/multi-room").suppressWeaponRivenPreview(this.findClientBySocket(socket)))
            return "queued";
        return this.sendFrame(socket, JSON.stringify((0, room_preview_1.stripWeaponRivenRoomPreview)(data)) + "\0", context);
    }
    sendFrame(socket, frame, context) {
        return (0, reliable_send_1.sendFrameReliably)(socket, frame, context);
    }
    broadcastToRoom(roomNumber, data, excludeAddr, roomGeneration) {
        var _a;
        const set = this.roomClients.get(roomNumber);
        if (!set)
            return;
        const broadcastStarted = node_perf_hooks_1.performance.now();
        let expectedGeneration = roomGeneration;
        if (expectedGeneration === undefined) {
            try {
                const { getRoom } = require("../room/manager");
                expectedGeneration = (_a = getRoom(roomNumber)) === null || _a === void 0 ? void 0 : _a.lobby_generation;
            }
            catch (e) { }
        }
        for (const addr of set) {
            if (excludeAddr !== undefined && addr === excludeAddr)
                continue;
            const c = this.clients.get(addr);
            // A socket is indexed immediately after its handshake, but the
            // client does not have a local "yourself" room object until Enter
            // has been answered with Welcome.  Sending Mates/State/Start during
            // that gap can make the CN client raise C15202 because it cannot
            // find itself in the meeting roster.
            if (c
                && !c.superseded
                && c.enterData !== null
                && (expectedGeneration === undefined || c.roomGeneration === expectedGeneration)) {
                this.sendJson(c.socket, data, {
                    roomNumber,
                    connectionId: c.connectionId,
                    viewerId: c.viewerId,
                    roomGeneration: c.roomGeneration,
                    channel: "lobby",
                });
            }
        }
        (0, server_work_performance_1.recordServerWork)("multi.lobby.broadcast", node_perf_hooks_1.performance.now() - broadcastStarted);
    }
    getRoomClientCount(roomNumber, roomGeneration) {
        var _a, _b;
        if (roomGeneration === undefined)
            return (_b = (_a = this.roomClients.get(roomNumber)) === null || _a === void 0 ? void 0 : _a.size) !== null && _b !== void 0 ? _b : 0;
        return this.getClientsInRoom(roomNumber, roomGeneration).length;
    }
}
exports.SessionManager = SessionManager;
exports.sessionManager = new SessionManager();
(0, memory_diagnostics_1.registerMemoryCounters)("sessions", () => exports.sessionManager.memoryCounters());
