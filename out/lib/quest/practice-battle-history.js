"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildPracticeBattleHistoryRecord = void 0;
const utils_1 = require("../../data/utils");
const battle_history_1 = require("./battle-history");
function buildPracticeBattleHistoryRecord(input) {
    if (!Number.isSafeInteger(input.playerId) || input.playerId <= 0
        || typeof input.playId !== "string" || input.playId.length === 0) {
        throw new Error("Practice battle history identity is invalid");
    }
    return Object.assign(Object.assign({ playerId: input.playerId, playId: input.playId }, (0, battle_history_1.buildBattleHistoryProtocolRecord)(input, 15, "Practice battle history")), { 
        // The CN list displays this timezone-less value verbatim and sorts by
        // it again. Real Beijing time keeps the archive's dates independent
        // from event-clock changes, including backward jumps.
        create_time: (0, utils_1.clientSerializeDate)(new Date(input.createdAt.getTime() + 8 * 60 * 60 * 1000)) });
}
exports.buildPracticeBattleHistoryRecord = buildPracticeBattleHistoryRecord;
