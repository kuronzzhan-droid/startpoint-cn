"use strict";
// IPC messages between the main CN process and the battle relay child.
//
// The child owns the real battle sockets after the handshake frame is seen.
// It relays Broadcast/Send frames and answers Measurement/Heartbeat locally,
// and forwards every other frame to the main process, which keeps all room,
// barrier, lease and settlement decisions.
Object.defineProperty(exports, "__esModule", { value: true });
exports.relayFramesIdentityRejection = void 0;
/** Legacy clients carry no scene token: preserve a peer's ordered LevelNext tail. */
function relayFramesIdentityRejection(current, binding, incoming, data) {
    var _a;
    if (!binding.instanceId)
        return "unbound";
    if (binding.instanceId !== current.instanceId || (incoming && incoming.instanceId !== current.instanceId))
        return "instance";
    if (binding.battleSessionId !== current.battleSessionId || (incoming && incoming.battleSessionId !== current.battleSessionId))
        return "run";
    const epoch = (_a = incoming === null || incoming === void 0 ? void 0 : incoming.sceneEpoch) !== null && _a !== void 0 ? _a : binding.sceneEpoch;
    if (epoch === current.sceneEpoch && binding.sceneEpoch === current.sceneEpoch)
        return null;
    // The first teammate may already have advanced the room epoch. The remaining
    // teammate's own LevelNext is the only valid entrance from its previous epoch.
    if (binding.sceneEpoch + 1 === current.sceneEpoch
        && (epoch === binding.sceneEpoch || epoch === current.sceneEpoch)) {
        try {
            const first = data.split("\0").find(frame => frame.trim().length > 0);
            const frame = first === undefined ? undefined : JSON.parse(first);
            if (Array.isArray(frame) && frame[0] === 0 && Array.isArray(frame[1]) && frame[1][0] === 1)
                return null;
        }
        catch ( /* Protocol validation will reject malformed frames separately. */_b) { /* Protocol validation will reject malformed frames separately. */ }
    }
    return "scene";
}
exports.relayFramesIdentityRejection = relayFramesIdentityRejection;
