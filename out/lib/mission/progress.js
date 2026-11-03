"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.addMissionProgressDelta = void 0;
function addMissionProgressDelta(current, delta) {
    if (!Number.isInteger(delta) || delta <= 0)
        return null;
    if (!Number.isFinite(current) || current < 0)
        current = 0;
    return current + delta;
}
exports.addMissionProgressDelta = addMissionProgressDelta;
