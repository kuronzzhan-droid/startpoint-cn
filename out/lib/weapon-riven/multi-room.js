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
exports.weaponRivenBattleSocketAllowed = exports.commitWeaponRivenPreparation = exports.acceptWeaponRivenAck = exports.waitWeaponRivenPreparation = exports.startWeaponRivenPreparation = exports.suppressWeaponRivenPreview = exports.releaseWeaponRivenRoom = exports.cancelWeaponRivenPreparation = exports.setWeaponRivenOwnerEpoch = void 0;
const node_crypto_1 = require("node:crypto");
const manager_1 = require("../../multi/room/manager");
const SessionManager_1 = require("../../multi/state/SessionManager");
const embedded_1 = require("../../multi/coordinator/embedded");
const socket_admission_1 = require("../../multi/coordinator/socket-admission");
const equipment_ready_1 = require("../../multi/room/equipment-ready");
const business_rpc_1 = require("../../multi/coordinator/business-rpc");
const multi_protocol_1 = require("./multi-protocol");
const multi_fallback_1 = require("./multi-fallback");
let ownerEpoch = (0, node_crypto_1.randomUUID)();
const entries = new Map();
function setWeaponRivenOwnerEpoch(epoch) { ownerEpoch = epoch; }
exports.setWeaponRivenOwnerEpoch = setWeaponRivenOwnerEpoch;
function copy(value) { return JSON.parse(JSON.stringify(value)); }
function current(entry) {
    const room = entry.room;
    if (entries.get(room.room_number) !== entry || (0, manager_1.getRoom)(room.room_number) !== room
        || room.lifecycle.instanceId !== entry.identity.roomInstanceId)
        return false;
    if (entry.phase === "committed" || entry.phase === "binding")
        return room.lifecycle.battleSessionId === entry.battleSessionId;
    return room.lifecycle.phase === "LOBBY" && room.lobby_generation === entry.identity.sourceLobbyGeneration
        && entry.peers.every((peer, i) => !peer.superseded && !peer.socket.destroyed && peer.enterData !== null
            && SessionManager_1.sessionManager.getClient(peer.viewerId, room.room_number) === peer
            && (0, equipment_ready_1.selectedPartyId)(peer) === entry.request.members.filter((member) => !member.mate.comId)[i].partyId)
        && SessionManager_1.sessionManager.getClientsInRoom(room.room_number, room.lobby_generation)
            .filter(peer => !peer.isBattle && !peer.superseded && peer.enterData !== null).length === entry.peers.length;
}
function send(entry, tag) {
    if (!entry.snapshot || !current(entry))
        return false;
    const frame = JSON.stringify([1, [tag, entry.snapshot.members]]) + "\0";
    for (const peer of entry.peers) {
        if (peer.superseded || peer.socket.destroyed || peer.enterData === null
            || peer.roomGeneration !== entry.identity.sourceLobbyGeneration)
            return false;
        if (SessionManager_1.sessionManager.sendFrame(peer.socket, frame, { roomNumber: entry.room.room_number,
            viewerId: peer.viewerId, connectionId: peer.connectionId,
            roomGeneration: peer.roomGeneration, channel: "lobby" }) === "closed")
            return false;
    }
    return true;
}
function notify(entry, prefix, reason, p2Only) {
    var _a, _b, _c;
    for (const peer of entry.peers) {
        if (peer.superseded || peer.socket.destroyed || peer.enterData === null)
            continue;
        if (p2Only && !((_a = (0, socket_admission_1.getSocketRivenCredentials)(peer.socket)) === null || _a === void 0 ? void 0 : _a.weaponRiven.p2))
            continue;
        SessionManager_1.sessionManager.sendJson(peer.socket, [1, [8, `${prefix}|${(_c = (_b = entry.snapshot) === null || _b === void 0 ? void 0 : _b.snapshotId) !== null && _c !== void 0 ? _c : "none"}|${reason}`]]);
    }
}
function rpc(kind, payload) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            return yield (0, business_rpc_1.invokeRealtimeBusiness)(kind, payload);
        }
        catch (error) {
            const uncertain = error;
            if (uncertain.code === "BUSINESS_OUTCOME_UNKNOWN" && uncertain.confirmation) {
                try {
                    return yield uncertain.confirmation;
                }
                catch (_a) {
                    throw Object.assign(new Error("RIVEN_CONFIRMATION_FAILED"), { code: "RIVEN_CONFIRMATION_FAILED" });
                }
            }
            throw error;
        }
    });
}
function release(entry) {
    var _a;
    if (entry.localDisabled)
        return; // No parent snapshot exists for the disabled fallback.
    const payload = Object.assign({ identity: entry.identity, snapshotId: (_a = entry.snapshot) === null || _a === void 0 ? void 0 : _a.snapshotId }, (entry.battleSessionId ? { battleSessionId: entry.battleSessionId } : {}));
    void (0, business_rpc_1.retainRealtimeBusinessTail)(rpc(entry.battleSessionId ? "riven.release" : "riven.cancel", payload)).catch(() => { });
}
function cancelEntry(entry, reason = "room_changed") {
    if (entries.get(entry.room.room_number) === entry)
        cancelWeaponRivenPreparation(entry.room, reason);
}
function failCommittedStart(entry, reason) {
    if (!current(entry))
        return;
    entry.failed = true;
    entry.resolve(false);
    clearTimeout(entry.timer);
    if (SessionManager_1.sessionManager.commitRoomDisband(entry.room.room_number, reason))
        return;
    // Existing durable HTTP claims own termination until their outcome is known.
    const { deferPinnedRoomControl } = require("../../multi/coordinator/room-start-claims");
    deferPinnedRoomControl(entry.room, () => {
        void (0, business_rpc_1.runWithTcpBusinessAdmission)(() => embedded_1.embeddedMultiCoordinator.enqueueRoomCommand(entry.room.room_number, () => { if (current(entry))
            SessionManager_1.sessionManager.commitRoomDisband(entry.room.room_number, reason); })).catch(() => { });
    });
}
function cancelWeaponRivenPreparation(room, reason = "room_changed") {
    const entry = entries.get(room.room_number);
    if (!entry || entry.room !== room || entry.phase === "committed" || entry.phase === "binding")
        return;
    entries.delete(room.room_number);
    entry.phase = "cancelled";
    clearTimeout(entry.timer);
    notify(entry, "WFR2_CANCEL", reason, true);
    entry.resolve(false);
    release(entry);
    room.readyCountdownPending = false;
    for (const peer of entry.peers)
        if (!peer.superseded && peer.yourself)
            (0, equipment_ready_1.setPreparation)(peer, true);
    const mates = entry.peers.map(peer => peer.yourself).filter(Boolean);
    SessionManager_1.sessionManager.broadcastToRoom(room.room_number, [1, [1, mates]]);
}
exports.cancelWeaponRivenPreparation = cancelWeaponRivenPreparation;
function releaseWeaponRivenRoom(room) {
    const entry = entries.get(room.room_number);
    if (!entry || entry.room !== room)
        return;
    entries.delete(room.room_number);
    clearTimeout(entry.timer);
    entry.resolve(false);
    release(entry);
}
exports.releaseWeaponRivenRoom = releaseWeaponRivenRoom;
function suppressWeaponRivenPreview(client) {
    if (!client)
        return false;
    const entry = entries.get(client.roomNumber);
    if (!entry || entry.room.lifecycle.instanceId !== entry.identity.roomInstanceId)
        return false;
    return entry.phase !== "cancelled" && entry.phase !== "committed" && entry.peers.includes(client);
}
exports.suppressWeaponRivenPreview = suppressWeaponRivenPreview;
function complete(entry) {
    if (entry.phase !== "ack" || !entry.snapshot || !entry.snapshot.ackConnectionIds.every(id => entry.ack.has(id)))
        return;
    if (entry.localDisabled) {
        entry.phase = "ready";
        entry.onReady();
        return;
    }
    entry.phase = "validating";
    const task = rpc("riven.validate", { identity: entry.identity, snapshotId: entry.snapshot.snapshotId,
        members: entry.request.members }).then(result => embedded_1.embeddedMultiCoordinator.enqueueRoomCommand(entry.room.room_number, () => {
        if (!current(entry)) {
            cancelEntry(entry);
            return;
        }
        if ((result === null || result === void 0 ? void 0 : result.ok) !== true) {
            cancelEntry(entry, "capability_changed");
            return;
        }
        entry.phase = "ready";
        entry.onReady();
    })).catch(() => embedded_1.embeddedMultiCoordinator.enqueueRoomCommand(entry.room.room_number, () => cancelEntry(entry, "validation_failed")));
    void (0, business_rpc_1.retainRealtimeBusinessTail)(task);
}
/** Called in a short room command. It never waits for RPC or ACK in that queue. */
function startWeaponRivenPreparation(room, members, onReady, deadlineMs = 10000) {
    const existing = entries.get(room.room_number);
    if (existing && existing.room === room) {
        if (!current(existing)) {
            cancelWeaponRivenPreparation(room);
            return undefined;
        }
        return existing.phase === "ready" || existing.phase === "committed"
            ? existing.localDisabled ? { members: existing.snapshot.members } : existing.snapshot : undefined;
    }
    if (room.lifecycle.phase !== "LOBBY" || members.length < 2 || members.length > 3)
        return undefined;
    const peers = [];
    const inputs = members.map(mate => {
        var _a, _b;
        if (mate.comId)
            return { viewerId: mate.viewerId, playerId: 0, connectionId: String(mate.connectionId),
                partyId: 1, session: null, admissionToken: null, mate: copy(mate) };
        const peer = SessionManager_1.sessionManager.getClient(Number(mate.viewerId), room.room_number);
        if (!peer || peer.playerId === null || peer.superseded || peer.enterData === null || peer.socket.destroyed
            || peer.roomGeneration !== room.lobby_generation)
            throw new Error("RIVEN_ROSTER_NOT_CONNECTED");
        const credential = (0, socket_admission_1.getSocketRivenCredentials)(peer.socket);
        peers.push(peer);
        return { viewerId: peer.viewerId, playerId: peer.playerId, connectionId: peer.connectionId,
            partyId: (0, equipment_ready_1.selectedPartyId)(peer), session: ((_a = credential === null || credential === void 0 ? void 0 : credential.session) !== null && _a !== void 0 ? _a : null),
            admissionToken: ((_b = credential === null || credential === void 0 ? void 0 : credential.token) !== null && _b !== void 0 ? _b : null), mate: copy(mate) };
    });
    if (entries.size >= 1024)
        throw new Error("RIVEN_ROOM_CAPACITY");
    const identity = { ownerEpoch, roomInstanceId: room.lifecycle.instanceId,
        sourceLobbyGeneration: room.lobby_generation, preparationId: (0, node_crypto_1.randomUUID)() };
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    const request = { identity, category: Number(room.category), questId: room.quest_id, members: inputs };
    const entry = { room, identity, peers, request, ack: new Set(), phase: "freezing", promise, resolve,
        timer: undefined, onReady, deadlineMs };
    entries.set(room.room_number, entry);
    arm(entry);
    freeze(entry);
    return undefined;
}
exports.startWeaponRivenPreparation = startWeaponRivenPreparation;
/** (Re)start the preparation deadline; a re-decided room gets a fresh window for its second prepare. */
function arm(entry) {
    const room = entry.room;
    if (entry.timer)
        clearTimeout(entry.timer);
    entry.timer = (0, business_rpc_1.createRealtimeMaintenanceTimer)(() => setTimeout(() => {
        void (0, business_rpc_1.runWithTcpBusinessAdmission)(() => embedded_1.embeddedMultiCoordinator.enqueueRoomCommand(room.room_number, () => {
            if (entries.get(room.room_number) !== entry)
                return;
            if (entry.phase === "binding")
                failCommittedStart(entry, "riven_commit_timeout");
            else
                cancelWeaponRivenPreparation(room, "timeout");
        })).catch(() => { });
    }, Math.max(1, Math.min(10000, entry.deadlineMs))));
    entry.timer.unref();
}
function freeze(entry) {
    const { room, request, peers } = entry, identity = entry.identity;
    const task = rpc("riven.freeze", request).catch(error => {
        if (!(0, multi_fallback_1.rivenFreezeUnavailable)(error))
            throw error;
        // Never fall back after publishing an enabled snapshot or an uncertain RPC result.
        if (entry.identity === identity)
            entry.localDisabled = true;
        return (0, multi_fallback_1.disabledRivenSnapshot)(request, peers.filter(peer => { var _a; return (_a = (0, socket_admission_1.getSocketRivenCredentials)(peer.socket)) === null || _a === void 0 ? void 0 : _a.weaponRiven.p2; })
            .map(peer => peer.connectionId));
    }).then(snapshot => embedded_1.embeddedMultiCoordinator.enqueueRoomCommand(room.room_number, () => {
        if (entry.identity !== identity)
            return; // Superseded by a re-decision; that path cancels this identity.
        entry.snapshot = snapshot;
        if (!current(entry)) {
            release(entry);
            cancelEntry(entry);
            return;
        }
        entry.phase = "ack";
        if (!send(entry, 1)) {
            cancelWeaponRivenPreparation(room, "send_failed");
            return;
        }
        if (snapshot.mode === 0 && snapshot.reason && snapshot.ackConnectionIds.length)
            notify(entry, "WFR2_DISABLED", snapshot.reason, false);
        complete(entry);
    })).catch(() => embedded_1.embeddedMultiCoordinator.enqueueRoomCommand(room.room_number, () => { if (entry.identity === identity)
        cancelEntry(entry, "freeze_failed"); }));
    void (0, business_rpc_1.retainRealtimeBusinessTail)(task);
}
/**
 * NACK reasons that downgrade an enabled prepare instead of cancelling it. The shipped C22/r2/C23 client sends
 * `WFR2|N|<snapshot>|invalid_snapshot` for every Mates rejection: a catalog constant that differs from the server's,
 * missing riven master-table keys, or an invalid P2 context. `catalog` is the reserved explicit reason. A mode-0
 * prepare carries no rows and catalog "none", so a client can accept it in all of those cases.
 */
const RIVEN_DOWNGRADE_NACK_REASONS = new Set(["invalid_snapshot", "catalog"]);
/**
 * A P2 client that cannot accept an enabled prepare (see RIVEN_DOWNGRADE_NACK_REASONS) NACKs it. Instead of
 * cancelling the start, the whole room is re-decided once as disabled (new parent preparation identity, mode 0,
 * catalog "none", reason catalog_mismatch); the normal two-phase start then continues with fresh ACKs.
 */
function redecideDisabled(entry, reason) {
    const old = { identity: entry.identity, snapshotId: entry.snapshot.snapshotId };
    void (0, business_rpc_1.retainRealtimeBusinessTail)(rpc("riven.cancel", old)).catch(() => { });
    entry.redecided = true;
    entry.identity = Object.assign(Object.assign({}, entry.identity), { preparationId: (0, node_crypto_1.randomUUID)() });
    entry.request = Object.assign(Object.assign({}, entry.request), { identity: entry.identity, disabledReason: reason });
    entry.snapshot = undefined;
    entry.ack = new Set();
    entry.phase = "freezing";
    arm(entry);
    freeze(entry);
}
function waitWeaponRivenPreparation(room) {
    const entry = entries.get(room.room_number);
    return (entry === null || entry === void 0 ? void 0 : entry.room) === room ? entry.promise : Promise.resolve(room.lifecycle.phase === "BATTLE");
}
exports.waitWeaponRivenPreparation = waitWeaponRivenPreparation;
function acceptWeaponRivenAck(client, message) {
    if (typeof message !== "string" || !message.startsWith("WFR2|"))
        return;
    const entry = entries.get(client.roomNumber);
    if (!entry || entry.phase !== "ack" || !entry.snapshot || !current(entry) || !entry.peers.includes(client)
        || !entry.snapshot.ackConnectionIds.includes(client.connectionId))
        return;
    let ack;
    try {
        ack = (0, multi_protocol_1.parseRivenAcknowledgement)(message);
    }
    catch (_a) {
        cancelWeaponRivenPreparation(entry.room, "invalid_ack");
        return;
    }
    if (!ack || ack.snapshotId !== entry.snapshot.snapshotId)
        return;
    if (ack.kind === "N") {
        if (RIVEN_DOWNGRADE_NACK_REASONS.has(ack.reason) && entry.snapshot.mode === 1 && !entry.redecided && !entry.localDisabled) {
            redecideDisabled(entry, "catalog_mismatch");
            return;
        }
        cancelWeaponRivenPreparation(entry.room, "client_rejected");
        return;
    }
    if (ack.canonical !== entry.snapshot.canonical) {
        cancelWeaponRivenPreparation(entry.room, "invalid_ack");
        return;
    }
    entry.ack.add(client.connectionId);
    complete(entry);
}
exports.acceptWeaponRivenAck = acceptWeaponRivenAck;
/** Bind the exact prepared DTO before delivering Start; callers must not await in the room queue. */
function commitWeaponRivenPreparation(room) {
    const entry = entries.get(room.room_number);
    if (!entry || entry.phase !== "ready" || !entry.snapshot || !room.lifecycle.battleSessionId)
        throw new Error("RIVEN_NOT_READY");
    entry.phase = "binding";
    entry.battleSessionId = room.lifecycle.battleSessionId;
    if (entry.localDisabled) {
        entry.phase = "committed";
        clearTimeout(entry.timer);
        if (!send(entry, 5)) {
            failCommittedStart(entry, "riven_start_send_failed");
            return;
        }
        entry.resolve(true);
        return;
    }
    const task = rpc("riven.commit", { identity: entry.identity, snapshotId: entry.snapshot.snapshotId,
        battleSessionId: entry.battleSessionId }).then(result => embedded_1.embeddedMultiCoordinator.enqueueRoomCommand(room.room_number, () => {
        if (!result || result.snapshotId !== entry.snapshot.snapshotId || result.canonical !== entry.snapshot.canonical
            || JSON.stringify(result.identity) !== JSON.stringify(entry.identity))
            throw new Error("RIVEN_COMMIT_REJECTED");
        if (!current(entry)) {
            release(entry);
            entry.resolve(false);
            return;
        }
        if (entry.failed) {
            release(entry);
            return;
        }
        entry.phase = "committed";
        clearTimeout(entry.timer);
        if (!send(entry, 5)) {
            failCommittedStart(entry, "riven_start_send_failed");
            return;
        }
        entry.resolve(true);
    })).catch(() => embedded_1.embeddedMultiCoordinator.enqueueRoomCommand(room.room_number, () => {
        entry.resolve(false);
        if (current(entry))
            failCommittedStart(entry, "riven_commit_failed");
    }));
    void (0, business_rpc_1.retainRealtimeBusinessTail)(task);
}
exports.commitWeaponRivenPreparation = commitWeaponRivenPreparation;
function weaponRivenBattleSocketAllowed(room, socket) {
    var _a, _b, _c;
    const entry = entries.get(room.room_number);
    if (!entry)
        return true; // Existing battles without P2 remain restorable under their old contract.
    if (entry.phase !== "committed" || entry.battleSessionId !== room.lifecycle.battleSessionId)
        return false;
    const capability = (_a = (0, socket_admission_1.getSocketRivenCredentials)(socket)) === null || _a === void 0 ? void 0 : _a.weaponRiven;
    return ((_b = entry.snapshot) === null || _b === void 0 ? void 0 : _b.mode) === 0 || !!((capability === null || capability === void 0 ? void 0 : capability.p1) && capability.p2 && capability.catalog === ((_c = entry.snapshot) === null || _c === void 0 ? void 0 : _c.catalog));
}
exports.weaponRivenBattleSocketAllowed = weaponRivenBattleSocketAllowed;
