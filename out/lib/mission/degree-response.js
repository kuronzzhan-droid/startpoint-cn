"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.settleDegreeMissionResponse = void 0;
const utils_1 = require("../../utils");
const response_1 = require("./response");
const settlement_1 = require("./settlement");
const computer_degree_1 = require("./computer-degree");
/**
 * Settles title missions at an authoritative mutation point and merges newly
 * acquired titles into that same API response.  The client uses mission_info
 * together with degree_list to show the acquisition notification immediately.
 */
function settleDegreeMissionResponse(playerId, viewerId, data, evaluationTime = new Date((0, utils_1.getServerTime)() * 1000), conditionTypes, characterIds) {
    const missionIds = conditionTypes === undefined
        ? undefined
        : (0, computer_degree_1.getDegreeMissionIdsForConditionTypes)(conditionTypes, characterIds);
    const settlement = (0, settlement_1.settleMissionCategories)(playerId, [Object.assign({ category: 5 }, (missionIds === undefined ? {} : { missionIds }))], evaluationTime);
    (0, response_1.mergeMissionSettlementResponse)(data, settlement, viewerId);
    return settlement;
}
exports.settleDegreeMissionResponse = settleDegreeMissionResponse;
