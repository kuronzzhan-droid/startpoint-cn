"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isAbyssExEndlessQuest = exports.abyssEventFromQuest = exports.isAbyssEvent = exports.ABYSS_FINITE_ROUNDS = exports.ABYSS_ENDLESS_FOLDER_ID = exports.ABYSS_FINITE_FOLDER_ID = exports.ABYSS_EVENT_IDS = exports.ABYSS_EX_EVENT_ID = exports.ABYSS_NORMAL_EVENT_ID = void 0;
const quest_1 = require("./types/quest");
exports.ABYSS_NORMAL_EVENT_ID = 700099;
exports.ABYSS_EX_EVENT_ID = 700100;
exports.ABYSS_EVENT_IDS = [exports.ABYSS_NORMAL_EVENT_ID, exports.ABYSS_EX_EVENT_ID];
exports.ABYSS_FINITE_FOLDER_ID = 1;
exports.ABYSS_ENDLESS_FOLDER_ID = 2;
exports.ABYSS_FINITE_ROUNDS = 30;
function isAbyssEvent(eventId) {
    return exports.ABYSS_EVENT_IDS.some(id => id === eventId);
}
exports.isAbyssEvent = isAbyssEvent;
function abyssEventFromQuest(category, questId) {
    const id = Number(questId);
    const eventId = Math.floor(id / 1000);
    return Number(category) === quest_1.QuestCategory.RUSH_EVENT && Number.isSafeInteger(id)
        && isAbyssEvent(eventId) ? eventId : null;
}
exports.abyssEventFromQuest = abyssEventFromQuest;
function isAbyssExEndlessQuest(category, questId) {
    return Number(category) === quest_1.QuestCategory.RUSH_EVENT && Number(questId) === exports.ABYSS_EX_EVENT_ID * 1000 + 99;
}
exports.isAbyssExEndlessQuest = isAbyssExEndlessQuest;
