"use strict";
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.isGameVerboseLoggingEnabled = exports.gameVerboseLog = void 0;
const GAME_VERBOSE_LOGS_ENABLED = !/^(0|false|no|off)$/i.test((_a = process.env.GAME_VERBOSE_LOGS) !== null && _a !== void 0 ? _a : "false");
function gameVerboseLog(message) {
    if (!GAME_VERBOSE_LOGS_ENABLED)
        return;
    console.log(typeof message === "function" ? message() : message);
}
exports.gameVerboseLog = gameVerboseLog;
function isGameVerboseLoggingEnabled() {
    return GAME_VERBOSE_LOGS_ENABLED;
}
exports.isGameVerboseLoggingEnabled = isGameVerboseLoggingEnabled;
