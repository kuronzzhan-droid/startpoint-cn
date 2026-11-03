"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateClearRank = void 0;
function calculateClearRank(clearTime, questData) {
    const hasRankThresholds = questData.bRankTime > 0;
    if (!hasRankThresholds)
        return null;
    if (questData.sPlusRankTime >= clearTime)
        return 5;
    if (questData.sRankTime >= clearTime)
        return 4;
    if (questData.aRankTime >= clearTime)
        return 3;
    if (questData.bRankTime >= clearTime)
        return 2;
    return 1;
}
exports.calculateClearRank = calculateClearRank;
