"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CollectComputer = exports.getCollectMissionItemId = void 0;
const master_data_1 = require("./master-data");
const evaluation_context_1 = require("./evaluation-context");
function getCollectMissionItemId(missionId) {
    var _a;
    const rawItemId = (_a = (0, master_data_1.getMissionMasterDefinition)(4, missionId)) === null || _a === void 0 ? void 0 : _a.row[14];
    const itemId = Number(rawItemId);
    return Number.isSafeInteger(itemId) && itemId > 0 ? itemId : undefined;
}
exports.getCollectMissionItemId = getCollectMissionItemId;
exports.CollectComputer = {
    name: "CollectItemEvent",
    buildContext(playerId, category, _evaluationTime, _missionIds, shared = new evaluation_context_1.MissionEvaluationReadContext(playerId)) {
        const player = shared.player;
        return {
            category,
            playerId,
            player,
            questProgress: {},
            totalQuestClears: 0,
            totalStories: 0,
            rankCounts: {},
            collectedItemTotals: shared.collectedItemTotals,
        };
    },
    compute(missionId, ctx, dbProgress) {
        var _a, _b;
        const itemId = getCollectMissionItemId(missionId);
        if (itemId === undefined)
            return dbProgress;
        return Math.max(dbProgress, (_b = (_a = ctx.collectedItemTotals) === null || _a === void 0 ? void 0 : _a[String(itemId)]) !== null && _b !== void 0 ? _b : 0);
    },
};
