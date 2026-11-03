"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRaidEventMissionIds = exports.getRaidEventQuestIds = exports.isRaidEventQuestId = exports.getRaidEventIdForQuest = exports.getRaidEventProgressRule = exports.isSupportedRaidEventId = exports.RAID_EVENT_CALCULATION_VERSION = void 0;
exports.RAID_EVENT_CALCULATION_VERSION = 5;
// Official quest weights for raid event 7 (Battle Banquet), with the
// private-server communal cycle threshold.
const RAID_EVENT_PROGRESS_RULES = {
    7: {
        requiredKillCount: 30000,
        questWeights: {
            7001: 51,
            7002: 255,
            7003: 1,
            7004: 3,
            7005: 30,
            7006: 180,
            7007: 1,
            7008: 3,
            7009: 26,
            7010: 157,
            7011: 1,
            7012: 3,
            7013: 22,
            7014: 135,
            7015: 1,
            7016: 3,
            7017: 18,
            7018: 115,
            7019: 1,
            7020: 3,
            7021: 15,
            7022: 97,
            7023: 1,
            7024: 3,
            7025: 12,
            7026: 80,
        },
    },
};
// mission_event master entries whose col[7]/col[8] identify Raid event 7.
const RAID_EVENT_MISSION_IDS = {
    7: [400093, 400094, 400095, 400096],
};
function isSupportedRaidEventId(eventId) {
    return Number.isInteger(eventId) && RAID_EVENT_PROGRESS_RULES[eventId] !== undefined;
}
exports.isSupportedRaidEventId = isSupportedRaidEventId;
function getRaidEventProgressRule(eventId) {
    const rule = RAID_EVENT_PROGRESS_RULES[eventId];
    if (!rule)
        throw new Error(`Unsupported raid event: ${eventId}`);
    return rule;
}
exports.getRaidEventProgressRule = getRaidEventProgressRule;
function getRaidEventIdForQuest(questId) {
    if (!Number.isInteger(questId))
        return null;
    for (const [rawEventId, rule] of Object.entries(RAID_EVENT_PROGRESS_RULES)) {
        if (rule.questWeights[questId] !== undefined)
            return Number(rawEventId);
    }
    return null;
}
exports.getRaidEventIdForQuest = getRaidEventIdForQuest;
function isRaidEventQuestId(eventId, questId) {
    if (!isSupportedRaidEventId(eventId) || !Number.isInteger(questId))
        return false;
    return RAID_EVENT_PROGRESS_RULES[eventId].questWeights[questId] !== undefined;
}
exports.isRaidEventQuestId = isRaidEventQuestId;
function getRaidEventQuestIds(eventId) {
    return Object.keys(getRaidEventProgressRule(eventId).questWeights).map(Number);
}
exports.getRaidEventQuestIds = getRaidEventQuestIds;
function getRaidEventMissionIds(eventId) {
    var _a;
    getRaidEventProgressRule(eventId);
    return [...((_a = RAID_EVENT_MISSION_IDS[eventId]) !== null && _a !== void 0 ? _a : [])];
}
exports.getRaidEventMissionIds = getRaidEventMissionIds;
