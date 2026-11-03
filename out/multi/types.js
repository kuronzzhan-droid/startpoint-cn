"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BattleState = exports.ClientState = exports.RoomState = void 0;
// === State machine enums ===
var RoomState;
(function (RoomState) {
    RoomState[RoomState["Waiting"] = 0] = "Waiting";
    RoomState[RoomState["Ready"] = 1] = "Ready";
    RoomState[RoomState["Filled"] = 2] = "Filled";
    RoomState[RoomState["Battle"] = 3] = "Battle";
    RoomState[RoomState["Disbanded"] = 4] = "Disbanded";
})(RoomState || (exports.RoomState = RoomState = {}));
var ClientState;
(function (ClientState) {
    ClientState[ClientState["Connecting"] = 0] = "Connecting";
    ClientState[ClientState["Handshaking"] = 1] = "Handshaking";
    ClientState[ClientState["InLobby"] = 2] = "InLobby";
    ClientState[ClientState["InBattle"] = 3] = "InBattle";
    ClientState[ClientState["Disconnected"] = 4] = "Disconnected";
})(ClientState || (exports.ClientState = ClientState = {}));
var BattleState;
(function (BattleState) {
    BattleState[BattleState["Initializing"] = 0] = "Initializing";
    BattleState[BattleState["Fighting"] = 1] = "Fighting";
    BattleState[BattleState["Finished"] = 2] = "Finished";
    BattleState[BattleState["Aborted"] = 3] = "Aborted";
})(BattleState || (exports.BattleState = BattleState = {}));
