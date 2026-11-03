"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ClientStateMachine = void 0;
const types_1 = require("../types");
const ALLOWED = [
    [types_1.ClientState.Connecting, types_1.ClientState.Handshaking],
    [types_1.ClientState.Handshaking, types_1.ClientState.InLobby],
    [types_1.ClientState.Handshaking, types_1.ClientState.Disconnected],
    [types_1.ClientState.InLobby, types_1.ClientState.InBattle],
    [types_1.ClientState.InLobby, types_1.ClientState.Disconnected],
    [types_1.ClientState.InBattle, types_1.ClientState.Disconnected],
];
class ClientStateMachine {
    constructor(initialState = types_1.ClientState.Connecting) {
        this.state = initialState;
    }
    getState() { return this.state; }
    tryTransition(to) {
        const match = ALLOWED.find(([f, t]) => f === this.state && t === to);
        if (!match)
            return { allowed: false, reason: `INVALID_TRANSITION: ${types_1.ClientState[this.state]} → ${types_1.ClientState[to]}` };
        this.state = to;
        return { allowed: true };
    }
}
exports.ClientStateMachine = ClientStateMachine;
