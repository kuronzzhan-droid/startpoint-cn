"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.shouldResetMode15RunForStaleActiveQuest = void 0;
/**
 * A stale multiplayer active quest proves only that its room can no longer be
 * resumed. It does not distinguish a defeat from a transport failure, so
 * deleting earlier Fantasy progress would incorrectly send the owner back to
 * stage 1. Explicit solo failure and the Rush reset endpoint still own full
 * run resets.
 */
function shouldResetMode15RunForStaleActiveQuest(isMode15, quest) {
    if (!isMode15)
        return false;
    return !quest.isMulti;
}
exports.shouldResetMode15RunForStaleActiveQuest = shouldResetMode15RunForStaleActiveQuest;
