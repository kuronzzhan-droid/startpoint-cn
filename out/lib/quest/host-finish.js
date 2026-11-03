"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveHostFinished = exports.resolveIsRoomHost = void 0;
function resolveIsRoomHost(params) {
    if (params.roomHostPlayerId === null)
        return undefined;
    return params.roomHostPlayerId === params.playerId;
}
exports.resolveIsRoomHost = resolveIsRoomHost;
function resolveHostFinished(params) {
    return params.previouslyHostFinished
        || (params.questAccomplished && params.isRoomHost === true);
}
exports.resolveHostFinished = resolveHostFinished;
