"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordPassMissionBattleFacts = void 0;
const mission_1 = require("../../data/domains/mission");
const master_data_1 = require("./master-data");
const QUEST_CATEGORY_BY_RANGE_KIND = Object.freeze({
    2: 2,
    5: 7,
    7: 13,
    8: 11,
    10: 19,
    15: 22,
    16: 23,
    17: 24,
});
function parseSelector(value) {
    if (value === undefined || value === null || value === "" || value === "(None)")
        return null;
    const values = String(value).split(",").map(Number);
    if (values.some(value => !Number.isSafeInteger(value)))
        return new Set();
    return new Set(values);
}
function matchesSelector(selector, value) {
    return selector === null || selector.has(value);
}
function matchesQuestRange(row, questCategory, questId) {
    const rangeKind = Number(row[8]);
    if (QUEST_CATEGORY_BY_RANGE_KIND[rangeKind] !== questCategory)
        return false;
    if (row[12] !== undefined && row[12] !== "" && row[12] !== "(None)")
        return false;
    if (rangeKind === 2) {
        const first = Math.floor(questId / 1000000);
        const remainder = questId % 1000000;
        const second = Math.floor(remainder / 1000);
        const third = remainder % 1000;
        return matchesSelector(parseSelector(row[9]), first)
            && matchesSelector(parseSelector(row[10]), second)
            && matchesSelector(parseSelector(row[11]), third);
    }
    const first = Math.floor(questId / 1000);
    const second = questId % 1000;
    return matchesSelector(parseSelector(row[9]), first)
        && matchesSelector(parseSelector(row[11]), second);
}
function recordPassMissionBattleFacts(context, evaluationTime) {
    if (!context.questAccomplished)
        return [];
    const matchedMissionIds = [];
    for (const definition of (0, master_data_1.getMissionMasterDefinitions)(8)) {
        const patternType = definition.patternType;
        if (patternType !== 16 && patternType !== 23)
            continue;
        if (patternType === 16 && context.isMulti !== true)
            continue;
        if (patternType === 23) {
            const battleKind = Number(definition.row[6]);
            if (battleKind !== 3
                && !(battleKind === 2 && context.isMulti === true)
                && !(battleKind === 1 && context.isMulti !== true))
                continue;
        }
        if (!(0, master_data_1.isMissionDefinitionEnabledAt)(definition, evaluationTime)
            || !matchesQuestRange(definition.row, context.questCategory, context.questId))
            continue;
        (0, mission_1.incrementPlayerCategoryMissionSync)(context.playerId, 8, definition.missionId, 1);
        matchedMissionIds.push(definition.missionId);
    }
    return matchedMissionIds;
}
exports.recordPassMissionBattleFacts = recordPassMissionBattleFacts;
