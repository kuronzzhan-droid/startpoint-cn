"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resetLoungesForTests = exports.detachLoungeSocket = exports.getLoungeCountForTests = exports.disbandLounge = exports.broadcastLoungeFrame = exports.sendLoungeFrame = exports.loungeCanStart = exports.touchLoungeActivity = exports.setLoungeMemberReady = exports.isAcceptableLoungeReadyState = exports.serializeLoungeMates = exports.getLoungeSocketContext = exports.enterLounge = exports.attachLoungeSocket = exports.canAttachLoungeViewer = exports.setLoungeShareTypes = exports.prepareLounge = exports.matchesLoungeAccess = exports.listLounges = exports.getLoungeByNumber = exports.getLounge = exports.createLounge = exports.cleanupExpiredLounges = exports.getLoungeOccupancy = exports.disconnectLoungePlayerLogin = exports.LOUNGE_MAX_READY_STATE_BYTES = exports.LOUNGE_MAX_READY_STATE_ITEMS = void 0;
const reliable_send_1 = require("../multi/tcp/reliable-send");
const LOUNGE_CAPACITY = 3;
const LOUNGE_TTL_MS = 30 * 60 * 1000;
const MAX_LOUNGES = 1024;
// The CN client serializes its ReadyState enum (Preparation/Ready, no
// parameters) as a one-element array such as [1]. Keep a generous bound so a
// future client field still fits, while one frame cannot be amplified into
// every member's send queue.
exports.LOUNGE_MAX_READY_STATE_ITEMS = 8;
exports.LOUNGE_MAX_READY_STATE_BYTES = 1024;
const LOUNGE_MAX_PROFILE_NAME_LENGTH = 64;
function positiveIntegerEnv(name, fallback, minimum) {
    var _a;
    const parsed = Number.parseInt((_a = process.env[name]) !== null && _a !== void 0 ? _a : "", 10);
    return Number.isFinite(parsed) ? Math.max(minimum, parsed) : fallback;
}
// A dismissed client closes its own socket after reading the final frame.
// Closing from the server immediately can race that frame, so retire the
// socket after a grace period instead (same approach as the lobby disband).
const LOUNGE_DISBAND_SOCKET_GRACE_MS = positiveIntegerEnv("LOUNGE_DISBAND_SOCKET_GRACE_MS", 20000, 0);
// A successful handshake is only a reservation until Enter. Other members'
// heartbeats must not keep an abandoned reservation alive indefinitely.
const LOUNGE_ENTER_TIMEOUT_MS = positiveIntegerEnv("LOUNGE_ENTER_TIMEOUT_MS", 15000, 1);
const rooms = new Map();
function disconnectLoungePlayerLogin(viewerId) {
    var _a, _b;
    for (const room of rooms.values()) {
        (_a = room.members.get(viewerId)) === null || _a === void 0 ? void 0 : _a.socket.destroy();
        (_b = room.pendingSockets.get(viewerId)) === null || _b === void 0 ? void 0 : _b.destroy();
    }
}
exports.disconnectLoungePlayerLogin = disconnectLoungePlayerLogin;
const roomIdsByNumber = new Map();
const socketContexts = new WeakMap();
const pendingEnterTimers = new Map();
let loungeSequence = 0;
function socketAvailable(socket) {
    return !socket.destroyed && socket.writable && socket.readable !== false;
}
function clearPendingEnterTimer(socket) {
    const timer = pendingEnterTimers.get(socket);
    if (timer)
        clearTimeout(timer);
    pendingEnterTimers.delete(socket);
}
function nextLoungeId() {
    loungeSequence = (loungeSequence + 1) % 1000;
    return Date.now() * 1000 + loungeSequence;
}
function nextLoungeNumber() {
    for (let attempt = 0; attempt < 1000; attempt++) {
        const value = String(100000 + Math.floor(Math.random() * 900000));
        if (!roomIdsByNumber.has(value))
            return value;
    }
    return String(nextLoungeId()).slice(-6).padStart(6, "0");
}
function removeRoom(room) {
    rooms.delete(room.id);
    if (roomIdsByNumber.get(room.number) === room.id) {
        roomIdsByNumber.delete(room.number);
    }
}
function clearDisconnectedPendingSockets(room) {
    for (const socket of room.pendingSockets.values()) {
        if (!socketAvailable(socket))
            detachLoungeSocket(socket);
    }
    for (const member of room.members.values()) {
        if (!socketAvailable(member.socket) && !room.pendingSockets.has(member.viewerId)) {
            detachLoungeSocket(member.socket);
        }
    }
}
function getLoungeOccupancy(room) {
    clearDisconnectedPendingSockets(room);
    let occupancy = room.members.size;
    for (const viewerId of room.pendingSockets.keys()) {
        if (!room.members.has(viewerId))
            occupancy += 1;
    }
    return occupancy;
}
exports.getLoungeOccupancy = getLoungeOccupancy;
function hasLoungeGuestSeat(room) {
    const occupancy = getLoungeOccupancy(room);
    // The establishing host may still be opening its first socket or logging
    // back in. Two guests must not take the seat needed to restore that host.
    const hostHasSeat = room.members.has(room.hostViewerId) || room.pendingSockets.has(room.hostViewerId);
    return occupancy < LOUNGE_CAPACITY - (hostHasSeat ? 0 : 1);
}
function cleanupExpiredLounges(now = Date.now()) {
    for (const room of rooms.values()) {
        if (now - room.lastActivityAt >= LOUNGE_TTL_MS)
            disbandLounge(room);
    }
    if (rooms.size <= MAX_LOUNGES)
        return;
    const oldest = [...rooms.values()].sort((a, b) => a.lastActivityAt - b.lastActivityAt);
    for (let index = 0; rooms.size > MAX_LOUNGES && index < oldest.length; index++) {
        disbandLounge(oldest[index]);
    }
}
exports.cleanupExpiredLounges = cleanupExpiredLounges;
const cleanupTimer = setInterval(cleanupExpiredLounges, 60000);
cleanupTimer.unref();
function createLounge(input) {
    cleanupExpiredLounges();
    // One host owns at most one lounge regardless of use case. Replacing it
    // notifies the previous members instead of silently orphaning them.
    for (const existing of [...rooms.values()]) {
        // The host is leaving that lounge itself: retire its own old socket
        // without a dismissal frame, and tell the other members.
        if (existing.hostViewerId === input.hostViewerId) {
            disbandLounge(existing, undefined, input.hostViewerId);
        }
    }
    const now = Date.now();
    const room = {
        id: nextLoungeId(),
        number: nextLoungeNumber(),
        advice: input.advice,
        useCase: input.useCase,
        campaignId: input.campaignId,
        hostViewerId: input.hostViewerId,
        hostPlayerId: input.hostPlayerId,
        hostProfile: input.hostProfile,
        raisingState: 1,
        createdAt: now,
        lastActivityAt: now,
        members: new Map(),
        pendingSockets: new Map(),
        shareTypes: new Set(),
    };
    rooms.set(room.id, room);
    roomIdsByNumber.set(room.number, room.id);
    return room;
}
exports.createLounge = createLounge;
function getLounge(id) {
    cleanupExpiredLounges();
    return rooms.get(id);
}
exports.getLounge = getLounge;
function getLoungeByNumber(number) {
    cleanupExpiredLounges();
    const id = roomIdsByNumber.get(number);
    return id === undefined ? undefined : rooms.get(id);
}
exports.getLoungeByNumber = getLoungeByNumber;
function listLounges(useCase) {
    cleanupExpiredLounges();
    return [...rooms.values()]
        .filter(room => room.useCase === useCase && room.raisingState === 2 && hasLoungeGuestSeat(room))
        .sort((a, b) => b.createdAt - a.createdAt);
}
exports.listLounges = listLounges;
function matchesLoungeAccess(room, input) {
    return room.useCase === input.useCase
        && room.advice === input.advice
        && room.hostViewerId === input.establisherViewerId;
}
exports.matchesLoungeAccess = matchesLoungeAccess;
function prepareLounge(room) {
    if (rooms.get(room.id) !== room || (room.raisingState !== 1 && room.raisingState !== 2))
        return;
    room.raisingState = 2;
    room.lastActivityAt = Date.now();
}
exports.prepareLounge = prepareLounge;
function setLoungeShareTypes(room, values) {
    room.shareTypes = new Set(values);
    room.lastActivityAt = Date.now();
}
exports.setLoungeShareTypes = setLoungeShareTypes;
function canAttachLoungeViewer(room, viewerId) {
    clearDisconnectedPendingSockets(room);
    return rooms.get(room.id) === room && room.raisingState === 2
        && (room.members.has(viewerId)
            || room.pendingSockets.has(viewerId)
            || (viewerId === room.hostViewerId
                ? getLoungeOccupancy(room) < LOUNGE_CAPACITY
                : hasLoungeGuestSeat(room)));
}
exports.canAttachLoungeViewer = canAttachLoungeViewer;
function attachLoungeSocket(room, viewerId, socket) {
    const existing = room.members.get(viewerId);
    const pending = room.pendingSockets.get(viewerId);
    socketContexts.set(socket, { roomId: room.id, viewerId });
    room.lastActivityAt = Date.now();
    room.pendingSockets.set(viewerId, socket);
    clearPendingEnterTimer(socket);
    const timer = setTimeout(() => {
        pendingEnterTimers.delete(socket);
        if (room.pendingSockets.get(viewerId) !== socket)
            return;
        detachLoungeSocket(socket);
        socket.destroy();
    }, LOUNGE_ENTER_TIMEOUT_MS);
    timer.unref();
    pendingEnterTimers.set(socket, timer);
    if (pending && pending !== socket && !pending.destroyed)
        pending.destroy();
    if (existing && existing.socket !== socket && !existing.socket.destroyed) {
        existing.socket.destroy();
    }
}
exports.attachLoungeSocket = attachLoungeSocket;
function enterLounge(socket, profile) {
    var _a, _b, _c, _d, _e;
    const context = socketContexts.get(socket);
    if (!context)
        return null;
    const room = rooms.get(context.roomId);
    if (!room || !socketAvailable(socket) || room.pendingSockets.get(context.viewerId) !== socket
        || !canAttachLoungeViewer(room, context.viewerId))
        return null;
    clearPendingEnterTimer(socket);
    room.pendingSockets.delete(context.viewerId);
    const member = {
        viewerId: context.viewerId,
        profile: {
            name: String((_a = profile.name) !== null && _a !== void 0 ? _a : "").slice(0, LOUNGE_MAX_PROFILE_NAME_LENGTH),
            characterId: Number((_b = profile.characterId) !== null && _b !== void 0 ? _b : 1),
            evolutionLevel: Number((_c = profile.evolutionLevel) !== null && _c !== void 0 ? _c : 0),
            rank: Number((_d = profile.rank) !== null && _d !== void 0 ? _d : 1),
            degreeId: Number((_e = profile.degreeId) !== null && _e !== void 0 ? _e : 1),
        },
        readyState: [1],
        socket,
    };
    room.members.set(context.viewerId, member);
    room.lastActivityAt = Date.now();
    return { room, member };
}
exports.enterLounge = enterLounge;
function getLoungeSocketContext(socket) {
    const context = socketContexts.get(socket);
    if (!context)
        return null;
    const room = rooms.get(context.roomId);
    if (!room)
        return null;
    const member = room.members.get(context.viewerId);
    // A pending replacement is not the entered member yet. Superseded
    // sockets may still have buffered frames before their close callback.
    return { room, viewerId: context.viewerId, member: (member === null || member === void 0 ? void 0 : member.socket) === socket
            && !room.pendingSockets.has(context.viewerId) && socketAvailable(socket) ? member : undefined };
}
exports.getLoungeSocketContext = getLoungeSocketContext;
function serializeLoungeMates(room) {
    return [...room.members.values()].map(member => (Object.assign(Object.assign({ viewerId: member.viewerId }, member.profile), { readyState: member.readyState })));
}
exports.serializeLoungeMates = serializeLoungeMates;
function isAcceptableLoungeReadyState(value) {
    if (!Array.isArray(value) || value.length > exports.LOUNGE_MAX_READY_STATE_ITEMS)
        return false;
    try {
        return Buffer.byteLength(JSON.stringify(value), "utf8") <= exports.LOUNGE_MAX_READY_STATE_BYTES;
    }
    catch (_a) {
        return false;
    }
}
exports.isAcceptableLoungeReadyState = isAcceptableLoungeReadyState;
function setLoungeMemberReady(room, viewerId, readyState) {
    if (room.raisingState !== 2 || !isAcceptableLoungeReadyState(readyState))
        return false;
    const member = room.members.get(viewerId);
    if (!member)
        return false;
    member.readyState = readyState;
    room.lastActivityAt = Date.now();
    return true;
}
exports.setLoungeMemberReady = setLoungeMemberReady;
function touchLoungeActivity(room) {
    if (rooms.get(room.id) === room)
        room.lastActivityAt = Date.now();
}
exports.touchLoungeActivity = touchLoungeActivity;
function loungeCanStart(room) {
    return rooms.get(room.id) === room && room.raisingState === 2
        && room.members.has(room.hostViewerId)
        && room.pendingSockets.size === 0
        && room.members.size === LOUNGE_CAPACITY
        && [...room.members.values()].every(member => socketAvailable(member.socket)
            && Number(member.readyState[0]) === 1);
}
exports.loungeCanStart = loungeCanStart;
function sendLoungeFrame(socket, value) {
    if (socket.destroyed || !socket.writable)
        return false;
    let frame;
    try {
        frame = `${JSON.stringify(value)}\0`;
    }
    catch (_a) {
        return false;
    }
    // Share the bounded per-socket queue used by lobby/battle traffic: a peer
    // that stops reading is disconnected instead of growing server memory.
    return (0, reliable_send_1.sendFrameReliably)(socket, frame, { channel: "lounge" }) !== "closed";
}
exports.sendLoungeFrame = sendLoungeFrame;
function retireDisbandedLoungeSocket(socket) {
    var _a;
    if (socket.destroyed)
        return;
    const timer = setTimeout(() => {
        if (!socket.destroyed)
            socket.destroy();
    }, LOUNGE_DISBAND_SOCKET_GRACE_MS);
    (_a = timer.unref) === null || _a === void 0 ? void 0 : _a.call(timer);
}
function broadcastLoungeFrame(room, value) {
    for (const member of room.members.values())
        sendLoungeFrame(member.socket, value);
}
exports.broadcastLoungeFrame = broadcastLoungeFrame;
function disbandLounge(room, message = "multibattle_room_dismissed", silentViewerId) {
    const frame = [1, [1, message]];
    const sentSockets = new Set();
    const notify = (viewerId, socket) => {
        if (sentSockets.has(socket))
            return;
        sentSockets.add(socket);
        if (viewerId !== silentViewerId)
            sendLoungeFrame(socket, frame);
    };
    // Start already committed all pending tickets. Retiring a spent room
    // (replacement/TTL) must not cancel slower clients still drawing.
    const started = room.raisingState === 97;
    const activeSockets = new Set([...room.members.values()].map(member => member.socket));
    for (const socket of room.pendingSockets.values())
        activeSockets.add(socket);
    if (!started) {
        for (const member of room.members.values())
            notify(member.viewerId, member.socket);
        for (const [viewerId, socket] of room.pendingSockets)
            notify(viewerId, socket);
    }
    room.raisingState = 99;
    removeRoom(room);
    for (const socket of activeSockets) {
        clearPendingEnterTimer(socket);
        socketContexts.delete(socket);
        retireDisbandedLoungeSocket(socket);
    }
}
exports.disbandLounge = disbandLounge;
function getLoungeCountForTests() {
    return rooms.size;
}
exports.getLoungeCountForTests = getLoungeCountForTests;
function detachLoungeSocket(socket, explicitBye = false) {
    clearPendingEnterTimer(socket);
    const context = socketContexts.get(socket);
    if (!context)
        return;
    socketContexts.delete(socket);
    const room = rooms.get(context.roomId);
    if (!room)
        return;
    const pending = room.pendingSockets.get(context.viewerId);
    if (pending === socket)
        room.pendingSockets.delete(context.viewerId);
    const member = room.members.get(context.viewerId);
    // A reconnecting viewer keeps the existing member slot while the new
    // socket completes its Enter message. The old socket must not remove it.
    if (pending && pending !== socket)
        return;
    // If a replacement failed before Enter, the old member socket has already
    // been retired. Release that dead seat as well, without removing a newer
    // successfully entered member when a late close arrives.
    if ((member === null || member === void 0 ? void 0 : member.socket) !== socket && !(pending === socket && member && !socketAvailable(member.socket)))
        return;
    room.members.delete(context.viewerId);
    room.lastActivityAt = Date.now();
    if (explicitBye && context.viewerId === room.hostViewerId && room.raisingState !== 97) {
        disbandLounge(room);
        return;
    }
    if (room.raisingState === 2)
        broadcastLoungeFrame(room, [1, [4, serializeLoungeMates(room)]]);
}
exports.detachLoungeSocket = detachLoungeSocket;
function resetLoungesForTests() {
    for (const timer of pendingEnterTimers.values())
        clearTimeout(timer);
    pendingEnterTimers.clear();
    rooms.clear();
    roomIdsByNumber.clear();
    loungeSequence = 0;
}
exports.resetLoungesForTests = resetLoungesForTests;
