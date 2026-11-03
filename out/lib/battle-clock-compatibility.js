"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isClockAbortedPlaySync = exports.getBattleClockDate = exports.isSupportedBattleClockVersion = exports.CLOCK_ABORT_OPERATION = exports.BATTLE_CLOCK_VERSION = void 0;
const utils_1 = require("../utils");
exports.BATTLE_CLOCK_VERSION = 1;
exports.CLOCK_ABORT_OPERATION = "clock_migration.abort";
/** Version 0 is a preserved legacy registration, not proof of a forged play. */
function isSupportedBattleClockVersion(version) {
    return version === undefined || version === 0 || version === exports.BATTLE_CLOCK_VERSION;
}
exports.isSupportedBattleClockVersion = isSupportedBattleClockVersion;
function getBattleClockDate(version) {
    var _a;
    if (!isSupportedBattleClockVersion(version))
        throw new Error("Unsupported battle clock version");
    const real = (0, utils_1.getRealServerDate)().getTime();
    return new Date(real + (version === 0 ? (_a = (0, utils_1.getLegacyTimeOffset)()) !== null && _a !== void 0 ? _a : 0 : 0));
}
exports.getBattleClockDate = getBattleClockDate;
/** Existing terminal receipts stay terminal; no legacy battle is migrated or aborted here. */
function isClockAbortedPlaySync(db, playerId, playId) {
    return !!db.prepare("SELECT 1 FROM player_operation_receipts WHERE player_id=? AND operation=? AND request_key=?")
        .get(playerId, exports.CLOCK_ABORT_OPERATION, playId);
}
exports.isClockAbortedPlaySync = isClockAbortedPlaySync;
