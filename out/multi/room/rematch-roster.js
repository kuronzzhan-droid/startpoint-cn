"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getFrozenRematchViewerIds = exports.clearRematchReturnReservations = exports.forgetReturnReservation = exports.getNextReturnDeadline = exports.getExpiredReturnViewerIds = exports.getReservedReturnViewerIds = exports.markMemberReturnDisconnected = exports.markMemberReturned = exports.markMemberSettlementCommitted = exports.markRematchReturnWindowOpened = exports.ensureRematchReturnReservations = void 0;
const node_perf_hooks_1 = require("node:perf_hooks");
const battle_contract_1 = require("../state/battle-contract");
const rosters = new WeakMap();
function duration(name, fallback) {
    const value = Number(process.env[name]);
    return Number.isFinite(value) && value > 0 ? value : fallback;
}
const RETURN_GRACE_MS = duration("REMATCH_RECONNECT_GRACE_MS", 60000);
const RESULT_WAIT_MAX_MS = duration("REMATCH_RESULT_WAIT_MAX_MS", 180000);
function current(room) {
    var _a;
    const roster = rosters.get(room);
    return (roster === null || roster === void 0 ? void 0 : roster.instanceId) === ((_a = room.lifecycle) === null || _a === void 0 ? void 0 : _a.instanceId)
        && (roster === null || roster === void 0 ? void 0 : roster.generation) === room.lobby_generation ? roster : undefined;
}
/** Copy the original participants once; lobby socket lists never own this evidence. */
function ensureRematchReturnReservations(room, now = node_perf_hooks_1.performance.now(), generation = room.lobby_generation) {
    var _a, _b, _c;
    if (generation !== room.lobby_generation || generation <= 0 || current(room))
        return;
    const frozenViewers = [...new Set(room.expected_real_viewer_ids)];
    rosters.set(room, {
        instanceId: (_a = room.lifecycle) === null || _a === void 0 ? void 0 : _a.instanceId, generation, frozenViewers,
        battleSessionId: (_c = (_b = room.lifecycle) === null || _b === void 0 ? void 0 : _b.battleSessionId) !== null && _c !== void 0 ? _c : null, returnWindowOpenedAt: null,
        seats: new Map(frozenViewers.filter(viewer => viewer !== room.host_viewer_id)
            .map(viewer => [viewer, {
                status: "pending_result", resultCommitted: false,
                deadline: now + RESULT_WAIT_MAX_MS,
            }])),
    });
}
exports.ensureRematchReturnReservations = ensureRematchReturnReservations;
/** A result submitted during the battle cannot spend its return lease before return opens. */
function markRematchReturnWindowOpened(room, now = node_perf_hooks_1.performance.now()) {
    var _a;
    if (room.lifecycle.phase !== "RETURNING" && room.lifecycle.phase !== "LOBBY")
        return;
    ensureRematchReturnReservations(room, now);
    const roster = current(room);
    if (!roster || roster.returnWindowOpenedAt !== null)
        return;
    roster.returnWindowOpenedAt = now;
    for (const seat of roster.seats.values()) {
        if (seat.resultCommitted && seat.status !== "returned") {
            seat.deadline = Math.max((_a = seat.deadline) !== null && _a !== void 0 ? _a : 0, now + RETURN_GRACE_MS);
        }
    }
}
exports.markRematchReturnWindowOpened = markRematchReturnWindowOpened;
/** The first committed personal result starts only that member's return lease. */
function markMemberSettlementCommitted(room, viewerId, now = node_perf_hooks_1.performance.now(), generation = room.lobby_generation) {
    var _a;
    if (generation !== room.lobby_generation)
        return false;
    ensureRematchReturnReservations(room, now, generation);
    if (viewerId === room.host_viewer_id)
        return true;
    const seat = (_a = current(room)) === null || _a === void 0 ? void 0 : _a.seats.get(viewerId);
    if (!seat)
        return false;
    if (seat.resultCommitted)
        return true;
    seat.resultCommitted = true;
    if (seat.status !== "returned") {
        seat.status = "return_pending";
        seat.deadline = now + RETURN_GRACE_MS;
    }
    return true;
}
exports.markMemberSettlementCommitted = markMemberSettlementCommitted;
function markMemberReturned(room, viewerId) {
    if (room.lifecycle.phase === "RETURNING" || room.lifecycle.phase === "LOBBY") {
        ensureRematchReturnReservations(room);
    }
    const roster = current(room);
    const seat = roster === null || roster === void 0 ? void 0 : roster.seats.get(viewerId);
    if (seat) {
        seat.status = "returned";
        seat.deadline = null;
    }
    if ((roster === null || roster === void 0 ? void 0 : roster.battleSessionId) && (seat || viewerId === room.host_viewer_id)) {
        (0, battle_contract_1.markBattleMemberPhase)(room, viewerId, "RETURNED", roster.battleSessionId);
    }
}
exports.markMemberReturned = markMemberReturned;
/** A returned member's later socket loss owns a new, independent bounded lease. */
function markMemberReturnDisconnected(room, viewerId, now = node_perf_hooks_1.performance.now()) {
    var _a;
    const seat = (_a = current(room)) === null || _a === void 0 ? void 0 : _a.seats.get(viewerId);
    if ((seat === null || seat === void 0 ? void 0 : seat.status) === "returned") {
        seat.status = "return_pending";
        seat.deadline = now + RETURN_GRACE_MS;
    }
}
exports.markMemberReturnDisconnected = markMemberReturnDisconnected;
/** Expiry does not release a seat until the room command actually removes it. */
function getReservedReturnViewerIds(room) {
    var _a, _b;
    return [...((_b = (_a = current(room)) === null || _a === void 0 ? void 0 : _a.seats) !== null && _b !== void 0 ? _b : [])]
        .filter(([, seat]) => seat.status !== "returned").map(([viewer]) => viewer);
}
exports.getReservedReturnViewerIds = getReservedReturnViewerIds;
function getExpiredReturnViewerIds(room, now = node_perf_hooks_1.performance.now()) {
    var _a, _b;
    return [...((_b = (_a = current(room)) === null || _a === void 0 ? void 0 : _a.seats) !== null && _b !== void 0 ? _b : [])]
        .filter(([, seat]) => seat.deadline !== null && seat.deadline <= now)
        .map(([viewer]) => viewer);
}
exports.getExpiredReturnViewerIds = getExpiredReturnViewerIds;
function getNextReturnDeadline(room) {
    var _a, _b;
    const deadlines = [...((_b = (_a = current(room)) === null || _a === void 0 ? void 0 : _a.seats.values()) !== null && _b !== void 0 ? _b : [])]
        .flatMap(seat => seat.deadline === null ? [] : [seat.deadline]);
    return deadlines.length ? Math.min(...deadlines) : undefined;
}
exports.getNextReturnDeadline = getNextReturnDeadline;
function forgetReturnReservation(room, viewerId) {
    var _a;
    (_a = current(room)) === null || _a === void 0 ? void 0 : _a.seats.delete(viewerId);
}
exports.forgetReturnReservation = forgetReturnReservation;
function clearRematchReturnReservations(room) { rosters.delete(room); }
exports.clearRematchReturnReservations = clearRematchReturnReservations;
function getFrozenRematchViewerIds(room) {
    var _a, _b;
    return [...((_b = (_a = current(room)) === null || _a === void 0 ? void 0 : _a.frozenViewers) !== null && _b !== void 0 ? _b : room.expected_real_viewer_ids)];
}
exports.getFrozenRematchViewerIds = getFrozenRematchViewerIds;
