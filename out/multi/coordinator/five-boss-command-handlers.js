"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerFiveBossCommandHandlers = exports.assertFiveBossStartClaim = exports.inspectFiveBossStartClaims = exports.hasFiveBossStartClaims = void 0;
const perf_hooks_1 = require("perf_hooks");
const manager_1 = require("../room/manager");
const SessionManager_1 = require("../state/SessionManager");
const embedded_1 = require("./embedded");
const battle_contract_1 = require("../state/battle-contract");
const rematch_roster_1 = require("../room/rematch-roster");
const multi_active_quest_recovery_1 = require("../../lib/multi-active-quest-recovery");
const contract_1 = require("../five-boss/contract");
const lobby_runtime_1 = require("../five-boss/lobby-runtime");
const connection_diagnostic_1 = require("../five-boss/connection-diagnostic");
const room_start_claims_1 = require("./room-start-claims");
const CLAIM_MS = 10000;
const MAX_CLAIMS = 4096;
const claims = new Map();
/** Expired/unresolved claims stay pinned. Only explicit reconciliation may unlock their authority. */
function hasFiveBossStartClaims(room) {
    for (const claim of claims.values())
        if (claim.room === room && claim.status === "pending")
            return true;
    return false;
}
exports.hasFiveBossStartClaims = hasFiveBossStartClaims;
function inspectFiveBossStartClaims() {
    prune();
    const pending = [...claims.values()].filter(claim => claim.status === "pending");
    return { retained: claims.size, pending: pending.length,
        expiredUnresolved: pending.filter(claim => perf_hooks_1.performance.now() >= claim.deadline).length };
}
exports.inspectFiveBossStartClaims = inspectFiveBossStartClaims;
function current(claim) {
    var _a, _b;
    const room = (0, manager_1.getRoom)(claim.roomNumber);
    return room === claim.room && room.lifecycle.instanceId === claim.instanceId
        && room.lobby_generation === claim.generation && room.lifecycle.battleSessionId === claim.battleSessionId
        && ((_a = room.lifecycle.sceneEpoch) !== null && _a !== void 0 ? _a : 0) === claim.sceneEpoch && ((_b = room.five_boss_runtime) === null || _b === void 0 ? void 0 : _b.runId) === claim.runId;
}
/** Embedded parity check; production parent must use owner epoch + the child's lifecycle pin. */
function assertFiveBossStartClaim(token) {
    const claim = claims.get(token);
    if (!claim || claim.status !== "pending" || perf_hooks_1.performance.now() >= claim.deadline || !current(claim))
        throw new Error("FIVE_BOSS_START_CLAIM_INVALID");
}
exports.assertFiveBossStartClaim = assertFiveBossStartClaim;
function prune() {
    const now = perf_hooks_1.performance.now();
    for (const [token, claim] of claims)
        if (claim.resolvedAt !== undefined && now - claim.resolvedAt > 300000)
            claims.delete(token);
}
function recovery(stale, playerId, frozenRunId) {
    var _a, _b, _c;
    if (!(stale === null || stale === void 0 ? void 0 : stale.isMulti))
        return null;
    const room = stale.roomNumber ? (0, manager_1.getRoom)(stale.roomNumber) : undefined;
    if (room && (hasFiveBossStartClaims(room) || (frozenRunId && room.lifecycle.phase === "BATTLE"
        && ((_a = room.five_boss_runtime) === null || _a === void 0 ? void 0 : _a.runId) === frozenRunId && room.five_boss_runtime.expectedRealPlayerIds.includes(playerId)))) {
        return { playId: stale.playId, recoverable: true, reason: "recoverable" };
    }
    const viewerId = (_b = room === null || room === void 0 ? void 0 : room.member_viewer_ids.find(id => room.member_player_ids[id] === playerId)) !== null && _b !== void 0 ? _b : 0;
    const decision = (0, multi_active_quest_recovery_1.classifyMultiActiveQuestRecovery)(stale, room, viewerId, !!room && SessionManager_1.sessionManager.isBattleSeatRetired(room.room_number, viewerId), room && viewerId ? (_c = (0, battle_contract_1.findBattlePlayBinding)(room, viewerId, playerId, stale.playId)) !== null && _c !== void 0 ? _c : null : null);
    return Object.assign({ playId: stale.playId }, decision);
}
function registerFiveBossCommandHandlers(executor) {
    executor.register("fiveBoss.start.query", (p) => {
        const claim = claims.get(p.token);
        if (!claim || claim.playerId !== p.playerId || claim.playId !== p.playId)
            return { status: "unknown" };
        return { status: claim.status, current: current(claim), ownerEpoch: claim.ownerEpoch,
            remainingMs: Math.max(0, claim.deadline - perf_hooks_1.performance.now()), runId: claim.runId };
    });
    executor.register("fiveBoss.start.prepare", (raw, context) => {
        const p = raw;
        return embedded_1.embeddedMultiCoordinator.enqueueRoomCommand(p.body.room_number, () => {
            var _a;
            prune();
            if (context.remainingMs() <= 0)
                return { status: "unavailable" };
            const room = (0, manager_1.getRoom)(p.body.room_number), frozen = room === null || room === void 0 ? void 0 : room.five_boss_runtime;
            if (!room || !frozen || !(0, contract_1.isFiveBossGauntletQuest)(room.category, room.quest_id)
                || Number(p.body.category) !== Number(room.category) || Number(p.body.quest_id) !== Number(room.quest_id)
                || room.lifecycle.phase !== "BATTLE" || !room.lifecycle.battleSessionId || ((_a = room.lifecycle.sceneEpoch) !== null && _a !== void 0 ? _a : 0) !== 0
                || (0, manager_1.getRoomMemberPlayerId)(room, p.body.viewer_id) !== p.playerId || !frozen.expectedRealPlayerIds.includes(p.playerId))
                return { status: "unavailable" };
            if ([...claims.values()].some(item => item.room === room && item.playerId === p.playerId
                && item.status === "pending" && item.playId !== p.body.play_id))
                return { status: "unavailable" };
            const oldPlayRecovery = recovery(p.staleQuest, p.playerId, p.staleFrozenRunId);
            if (claims.size >= MAX_CLAIMS)
                return { status: "unavailable" };
            // Each HTTP attempt owns its pin. A failed duplicate must never
            // cancel another request's pending transaction for the same play.
            const claim = { token: context.commandId, ownerEpoch: context.ownerEpoch, room, roomNumber: room.room_number,
                instanceId: room.lifecycle.instanceId, generation: room.lobby_generation,
                battleSessionId: room.lifecycle.battleSessionId, sceneEpoch: 0, runId: frozen.runId,
                playerId: p.playerId, viewerId: p.body.viewer_id, playId: p.body.play_id,
                deadline: perf_hooks_1.performance.now() + CLAIM_MS, status: "pending" };
            claims.set(claim.token, claim);
            (0, room_start_claims_1.pinRoomStart)(room, claim.token);
            // Parent supplies this only after checking the original durable
            // member start AND the current active quest. Install the new pin
            // first so reconciliation cannot briefly release buffered controls.
            if (p.durableRunId === claim.runId) {
                for (const older of claims.values()) {
                    if (older === claim || older.status !== "pending" || older.room !== room
                        || older.playerId !== claim.playerId || older.playId !== claim.playId
                        || older.runId !== claim.runId || older.instanceId !== claim.instanceId
                        || older.generation !== claim.generation || older.battleSessionId !== claim.battleSessionId
                        || !current(older))
                        continue;
                    if ((0, battle_contract_1.bindBattlePlay)(room, older.viewerId, older.playerId, older.playId, older.battleSessionId)) {
                        older.status = "committed";
                        older.resolvedAt = perf_hooks_1.performance.now();
                        (0, room_start_claims_1.unpinRoomStart)(room, older.token);
                    }
                }
            }
            return JSON.parse(JSON.stringify({ status: "ready", token: claim.token, ownerEpoch: claim.ownerEpoch,
                remainingMs: Math.max(0, claim.deadline - perf_hooks_1.performance.now()), room,
                roomInstanceId: claim.instanceId, generation: claim.generation,
                battleSessionId: claim.battleSessionId, frozenRunId: claim.runId, oldPlayRecovery }));
        });
    });
    executor.register("fiveBoss.start.commit", (raw) => {
        const claim = claims.get(raw.token);
        if (!claim || claim.playerId !== raw.playerId || claim.playId !== raw.playId || claim.runId !== raw.runId)
            return { applied: false, reason: "STALE_CLAIM" };
        return embedded_1.embeddedMultiCoordinator.enqueueRoomCommand(claim.roomNumber, () => {
            if (claim.status === "committed")
                return { applied: true };
            if (claim.status !== "pending" || !current(claim))
                return { applied: false, reason: "STALE_IDENTITY" };
            if (!(0, battle_contract_1.bindBattlePlay)(claim.room, claim.viewerId, claim.playerId, claim.playId, claim.battleSessionId))
                return { applied: false, reason: "STALE_PLAY" };
            claim.status = "committed";
            claim.resolvedAt = perf_hooks_1.performance.now();
            (0, room_start_claims_1.unpinRoomStart)(claim.room, claim.token);
            connection_diagnostic_1.fiveBossConnectionDiagnostics.begin(claim.room);
            connection_diagnostic_1.fiveBossConnectionDiagnostics.memberEvent(claim.runId, claim.playerId, "http_start", "committed");
            return { applied: true };
        });
    });
    executor.register("fiveBoss.start.cancel", (raw) => {
        var _a, _b;
        const roomNumber = (_b = (_a = claims.get(raw.token)) === null || _a === void 0 ? void 0 : _a.roomNumber) !== null && _b !== void 0 ? _b : raw.roomNumber;
        if (!roomNumber)
            return { applied: false };
        return embedded_1.embeddedMultiCoordinator.enqueueRoomCommand(roomNumber, () => {
            // Prepare may still be waiting in this room's queue when its
            // application ACK times out. Resolve only after that queue entry.
            const claim = claims.get(raw.token);
            if (!claim || claim.playerId !== raw.playerId || claim.playId !== raw.playId)
                return { applied: false };
            if (claim.status === "committed")
                return { applied: false, reason: "ALREADY_COMMITTED" };
            claim.status = "cancelled";
            claim.resolvedAt = perf_hooks_1.performance.now();
            (0, room_start_claims_1.unpinRoomStart)(claim.room, claim.token);
            return { applied: true };
        });
    });
    executor.register("fiveBoss.proof.barrier", (p) => __awaiter(this, void 0, void 0, function* () {
        var _a;
        const room = p.roomNumber ? (0, manager_1.getRoom)(p.roomNumber) : undefined;
        if (((_a = room === null || room === void 0 ? void 0 : room.five_boss_runtime) === null || _a === void 0 ? void 0 : _a.runId) === p.runId) {
            // Controls accepted into the owner's pin FIFO precede this HTTP
            // barrier even though their durable proof dispatch is deferred.
            yield new Promise(resolve => {
                if (!(0, room_start_claims_1.deferPinnedRoomControl)(room, resolve))
                    resolve();
            });
        }
        yield (0, lobby_runtime_1.waitForFiveBossSignalPersistence)(p.runId, p.playerId);
        return (0, lobby_runtime_1.fiveBossProofBarrierStatus)(p.runId, p.playerId);
    }));
    executor.register("fiveBoss.terminal", (p) => embedded_1.embeddedMultiCoordinator.enqueueRoomCommand(p.roomNumber, () => {
        var _a;
        if (p.runStatus === "settled" || p.runStatus === "aborted")
            (0, lobby_runtime_1.clearFiveBossProofStatus)(p.runId);
        const room = (0, manager_1.getRoom)(p.roomNumber);
        if (!room || ((_a = room.five_boss_runtime) === null || _a === void 0 ? void 0 : _a.runId) !== p.runId)
            return { applied: false, reason: "STALE_RUN" };
        if (!["active", "settled", "aborted"].includes(p.runStatus))
            return { applied: false };
        if (p.playerId && p.viewerId && p.playId) {
            // This event is emitted only after the parent's member receipt
            // commits. It can reconcile a paid start whose owner ACK was lost.
            const paidClaims = [...claims.values()].filter(claim => claim.room === room
                && claim.status === "pending" && current(claim) && claim.runId === p.runId
                && claim.playerId === p.playerId && claim.viewerId === p.viewerId && claim.playId === p.playId);
            if (paidClaims.length)
                (0, battle_contract_1.bindBattlePlay)(room, p.viewerId, p.playerId, p.playId, room.lifecycle.battleSessionId);
            const binding = (0, battle_contract_1.findBattlePlayBinding)(room, p.viewerId, p.playerId, p.playId);
            if (binding === null || binding === void 0 ? void 0 : binding.current) {
                (0, rematch_roster_1.ensureRematchReturnReservations)(room);
                (0, rematch_roster_1.markMemberSettlementCommitted)(room, p.viewerId);
                (0, battle_contract_1.markBattleMemberPhase)(room, p.viewerId, "SETTLED", binding.battleSessionId);
                for (const claim of paidClaims) {
                    claim.status = "committed";
                    claim.resolvedAt = perf_hooks_1.performance.now();
                    (0, room_start_claims_1.unpinRoomStart)(room, claim.token);
                }
            }
        }
        if (p.runStatus === "active")
            return { applied: true };
        // A durable terminal run cannot accept a future queued start or
        // charge its ticket again. Retire gameplay before releasing FIFO:
        // delayed Finalize cannot downgrade SETTLED and delayed SceneReady /
        // LevelNext cannot start another scene for a terminal member.
        for (const viewerId of room.expected_real_viewer_ids)
            (0, battle_contract_1.markBattleMemberPhase)(room, viewerId, "SETTLED");
        SessionManager_1.sessionManager.clearBattleExpectedCount(p.roomNumber);
        for (const claim of claims.values()) {
            if (claim.room !== room || claim.status !== "pending" || claim.runId !== p.runId || !current(claim))
                continue;
            claim.status = "cancelled";
            claim.resolvedAt = perf_hooks_1.performance.now();
            (0, room_start_claims_1.unpinRoomStart)(room, claim.token);
        }
        if (hasFiveBossStartClaims(room))
            return { applied: false, reason: "UNRESOLVED_START" };
        if (p.runStatus === "aborted") {
            SessionManager_1.sessionManager.commitRoomDisband(p.roomNumber, "five_boss_aborted");
            return { applied: true };
        }
        (0, rematch_roster_1.ensureRematchReturnReservations)(room);
        const wasPending = room.settlement_return_pending;
        const transition = embedded_1.embeddedMultiCoordinator.applyRoomCommand(room, { roomNumber: p.roomNumber,
            identity: embedded_1.embeddedMultiCoordinator.identity(room), kind: "BEGIN_RETURN" });
        if (!transition.ok)
            return { applied: false, reason: transition.reason };
        (0, rematch_roster_1.markRematchReturnWindowOpened)(room);
        const { replayFiveBossHostReturnEnter } = require("../tcp/lobby");
        replayFiveBossHostReturnEnter(room, p.runId);
        delete room.five_boss_runtime;
        if (!wasPending)
            SessionManager_1.sessionManager.beginSettlementReturnGrace(p.roomNumber);
        return { applied: true };
    }));
}
exports.registerFiveBossCommandHandlers = registerFiveBossCommandHandlers;
