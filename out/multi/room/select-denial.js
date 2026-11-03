"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSelectRoomDenialRaisingState = exports.SELECT_ROOM_DISBANDED_STATE = exports.SELECT_ROOM_BATTLE_STATE = exports.SELECT_ROOM_FILLED_STATE = void 0;
exports.SELECT_ROOM_FILLED_STATE = 3;
exports.SELECT_ROOM_BATTLE_STATE = 4;
exports.SELECT_ROOM_DISBANDED_STATE = 9;
/**
 * Map a rejected room selection to the legacy client's native raising state.
 * The client already has dedicated dialogs for Filled (3) and Battle (4);
 * Disbanded (9) is only the fallback for missing or otherwise stale rooms.
 */
function getSelectRoomDenialRaisingState(context) {
    if (context.battleStarted)
        return exports.SELECT_ROOM_BATTLE_STATE;
    if (context.roomFull)
        return exports.SELECT_ROOM_FILLED_STATE;
    return exports.SELECT_ROOM_DISBANDED_STATE;
}
exports.getSelectRoomDenialRaisingState = getSelectRoomDenialRaisingState;
