"use strict";
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.flushRoutineGameLogs = exports.routineGameLog = void 0;
const mode = ((_a = process.env.GAME_ROUTINE_LOGS) !== null && _a !== void 0 ? _a : "summary").toLowerCase();
const counts = { multiBarrier: 0, multiSettlement: 0, rush: 0 };
let timer = null;
/** Keep three examples per family/minute; warnings and rejection logs bypass this helper. */
function routineGameLog(family, message) {
    if (/^(0|false|no|off)$/.test(mode))
        return;
    if (mode === "full") {
        console.log(message());
        return;
    }
    counts[family]++;
    if (counts[family] <= 3)
        console.log(message());
    if (!timer) {
        timer = setTimeout(flushRoutineGameLogs, 60000);
        timer.unref();
    }
}
exports.routineGameLog = routineGameLog;
function flushRoutineGameLogs() {
    if (timer) {
        clearTimeout(timer);
        timer = null;
    }
    const summary = Object.entries(counts).filter(([, count]) => count > 0)
        .map(([family, count]) => `${family}=${count}(suppressed=${Math.max(0, count - 3)})`).join(" ");
    for (const family of Object.keys(counts))
        counts[family] = 0;
    if (summary)
        console.log(`[GAME-SUMMARY] interval=60000ms ${summary}`);
}
exports.flushRoutineGameLogs = flushRoutineGameLogs;
