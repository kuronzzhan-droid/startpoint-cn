"use strict";
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.EventSafeComputer = exports.getEventItemMissionIdsForItems = exports.getEventItemMissionItemId = void 0;
const master_data_1 = require("./master-data");
const evaluation_context_1 = require("./evaluation-context");
const GET_ITEM_COUNT_PATTERN_TYPE = 37;
function getEventItemMissionItemId(missionId) {
    var _a;
    const row = (_a = (0, master_data_1.getMissionMasterDefinition)(3, missionId)) === null || _a === void 0 ? void 0 : _a.row;
    if (!row || Number(row[2]) !== GET_ITEM_COUNT_PATTERN_TYPE)
        return undefined;
    const itemId = Number(row[12]);
    return Number.isSafeInteger(itemId) && itemId > 0 ? itemId : undefined;
}
exports.getEventItemMissionItemId = getEventItemMissionItemId;
const eventItemMissionIdsByItemId = new Map();
for (const definition of (0, master_data_1.getMissionMasterDefinitions)(3)) {
    const itemId = getEventItemMissionItemId(definition.missionId);
    if (itemId === undefined)
        continue;
    const missionIds = (_a = eventItemMissionIdsByItemId.get(itemId)) !== null && _a !== void 0 ? _a : [];
    missionIds.push(definition.missionId);
    eventItemMissionIdsByItemId.set(itemId, missionIds);
}
function getEventItemMissionIdsForItems(itemIds) {
    return [...new Set(itemIds.flatMap(itemId => { var _a; return (_a = eventItemMissionIdsByItemId.get(itemId)) !== null && _a !== void 0 ? _a : []; }))];
}
exports.getEventItemMissionIdsForItems = getEventItemMissionIdsForItems;
exports.EventSafeComputer = {
    name: "EventSafe",
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
        const itemId = getEventItemMissionItemId(missionId);
        if (itemId === undefined)
            return dbProgress;
        return Math.max(dbProgress, (_b = (_a = ctx.collectedItemTotals) === null || _a === void 0 ? void 0 : _a[String(itemId)]) !== null && _b !== void 0 ? _b : 0);
    },
};
