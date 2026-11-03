"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleDailyChallengePoint = void 0;
const types_1 = require("../../types");
function handleDailyChallengePoint(params) {
    const { questCategory, eventId, playerId, challengePointMap, getEntries, updatePoint } = params;
    if (questCategory !== types_1.QuestCategory.EXPERT_SINGLE_EVENT || !eventId)
        return null;
    const cpKey = `expert_${eventId}`;
    const challengePointId = challengePointMap[cpKey];
    if (!challengePointId)
        return null;
    const entries = getEntries(playerId);
    const entry = entries.find(e => e.id === challengePointId);
    if (entry && entry.point > 0) {
        updatePoint(playerId, challengePointId, entry.point - 1);
    }
    return entries.map(e => ({
        "id": e.id,
        "point": e.id === challengePointId ? Math.max(0, e.point - 1) : e.point,
        "campaign_list": e.campaignList.map(c => ({
            "campaign_id": c.campaignId,
            "additional_point": c.additionalPoint
        }))
    }));
}
exports.handleDailyChallengePoint = handleDailyChallengePoint;
