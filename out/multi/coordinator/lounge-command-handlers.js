"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerLoungeCommandHandlers = void 0;
const state_1 = require("../../lounge/state");
function project(room, viewerId) {
    return { id: room.id, number: room.number, advice: room.advice, useCase: room.useCase,
        campaignId: room.campaignId, hostViewerId: room.hostViewerId, hostPlayerId: room.hostPlayerId,
        hostProfile: Object.assign({}, room.hostProfile), raisingState: room.raisingState,
        occupancy: (0, state_1.getLoungeOccupancy)(room), canAttach: (0, state_1.canAttachLoungeViewer)(room, viewerId) };
}
function registerLoungeCommandHandlers(executor) {
    executor.register("lounge.query", raw => {
        const p = raw;
        const room = p.loungeId ? (0, state_1.getLounge)(p.loungeId) : (0, state_1.getLoungeByNumber)(p.loungeNumber || "");
        return room ? project(room, p.viewerId) : null;
    });
    executor.register("lounge.list", raw => {
        var _a;
        const p = raw;
        const all = (0, state_1.listLounges)(p.useCase);
        const throughId = (_a = p.throughId) !== null && _a !== void 0 ? _a : all.reduce((max, room) => Math.max(max, room.id), 0);
        const remaining = all.filter(room => { var _a; return room.id <= throughId && room.id < ((_a = p.beforeId) !== null && _a !== void 0 ? _a : Number.MAX_SAFE_INTEGER); })
            .sort((a, b) => b.id - a.id);
        const page = remaining.slice(0, 64);
        return { rooms: page.map(room => project(room, p.viewerId)), throughId,
            nextId: remaining.length > page.length ? page[page.length - 1].id : null };
    });
    executor.register("lounge.create", raw => {
        const p = raw;
        return project((0, state_1.createLounge)(p), p.hostViewerId);
    });
    for (const operation of ["prepare", "select", "restore", "share"]) {
        executor.register(`lounge.${operation}`, (raw, context) => {
            var _a;
            if (context.remainingMs() <= 0)
                return { status: "expired" };
            const p = raw;
            const room = p.identity ? (0, state_1.getLounge)(p.loungeId) : undefined;
            if (!room)
                return { status: "missing" };
            const identity = p.identity;
            if (room.advice !== identity.advice || room.campaignId !== identity.campaignId
                || room.hostViewerId !== identity.hostViewerId || room.useCase !== identity.useCase)
                return { status: "stale" };
            if (!p.campaignExists || !(0, state_1.matchesLoungeAccess)(room, p.access))
                return { status: "forbidden" };
            if ((operation === "prepare" || operation === "share") && room.hostViewerId !== p.viewerId)
                return { status: "forbidden" };
            if (operation === "select" && (!p.eligible || !(0, state_1.canAttachLoungeViewer)(room, p.viewerId)))
                return { status: "ineligible" };
            if (operation === "restore" && room.raisingState === 2 && !p.eligible)
                return { status: "ineligible" };
            if (operation === "prepare") {
                (0, state_1.prepareLounge)(room);
                return { status: "done" };
            }
            if (operation === "share") {
                (0, state_1.setLoungeShareTypes)(room, (_a = p.shareTypes) !== null && _a !== void 0 ? _a : []);
                return { status: "done" };
            }
            return { status: "ready", room: project(room, p.viewerId) };
        });
    }
}
exports.registerLoungeCommandHandlers = registerLoungeCommandHandlers;
