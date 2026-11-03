"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleAutoplayModeChange = exports.parseAutoplayModeChange = void 0;
function parseAutoplayModeChange(data) {
    const autoplayMode = data[1];
    const manualMode = data[2];
    if (typeof autoplayMode !== "boolean" || typeof manualMode !== "boolean")
        return null;
    return { autoplayMode, manualMode };
}
exports.parseAutoplayModeChange = parseAutoplayModeChange;
function handleAutoplayModeChange(client, data, broadcast) {
    const change = parseAutoplayModeChange(data);
    if (!change || !client.yourself)
        return null;
    client.yourself.autoplayMode = change.autoplayMode;
    const rosterMate = client.mates.find(mate => Number(mate.viewerId) === client.viewerId);
    if (rosterMate)
        rosterMate.autoplayMode = change.autoplayMode;
    broadcast(client.roomNumber, [
        1,
        [3, client.viewerId, change.autoplayMode, change.manualMode],
    ]);
    return change;
}
exports.handleAutoplayModeChange = handleAutoplayModeChange;
