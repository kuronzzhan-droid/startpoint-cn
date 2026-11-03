"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hijackUnavailableReply = exports.canWriteReply = void 0;
function canWriteReply(request, reply) {
    return !reply.sent
        && !reply.raw.headersSent
        && !reply.raw.destroyed
        && !request.raw.aborted
        && !!request.socket
        && !request.socket.destroyed;
}
exports.canWriteReply = canWriteReply;
function hijackUnavailableReply(request, reply) {
    if (canWriteReply(request, reply))
        return false;
    if (!reply.sent)
        reply.hijack();
    return true;
}
exports.hijackUnavailableReply = hijackUnavailableReply;
