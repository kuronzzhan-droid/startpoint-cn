"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPassCardRewardDefinition = exports.isPassCardEventActiveAt = exports.getPassCardEventDefinition = void 0;
const pass_card_event_json_1 = __importDefault(require("../../assets/pass_card_event.json"));
const pass_card_reward_json_1 = __importDefault(require("../../assets/pass_card_reward.json"));
function firstRow(value) {
    return Array.isArray(value) && Array.isArray(value[0]) ? value[0] : undefined;
}
function integer(value) {
    if (value === undefined || value === null || value === "" || value === "(None)")
        return undefined;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : undefined;
}
function cnTimestamp(value) {
    if (typeof value !== "string" || value === "")
        return undefined;
    const parsed = Date.parse(`${value.replace(" ", "T")}+08:00`);
    return Number.isFinite(parsed) ? parsed : undefined;
}
function parseReward(row, kindIndex) {
    var _a;
    const kind = integer(row[kindIndex]);
    if (kind === undefined)
        return undefined;
    const amount = (_a = integer(row[kindIndex + 1])) !== null && _a !== void 0 ? _a : (kind === 6 ? 0 : undefined);
    if (amount === undefined)
        return undefined;
    const itemId = integer(row[kindIndex + 2]);
    const characterId = integer(row[kindIndex + 3]);
    const equipmentId = integer(row[kindIndex + 4]);
    const degreeId = integer(row[kindIndex + 5]);
    if (kind === 1 && itemId === undefined)
        return undefined;
    if (kind === 2 && equipmentId === undefined)
        return undefined;
    if (kind === 4 && characterId === undefined)
        return undefined;
    if (kind === 6 && degreeId === undefined)
        return undefined;
    return Object.assign(Object.assign(Object.assign(Object.assign({ kind,
        amount }, (itemId !== undefined ? { itemId } : {})), (characterId !== undefined ? { characterId } : {})), (equipmentId !== undefined ? { equipmentId } : {})), (degreeId !== undefined ? { degreeId } : {}));
}
function getPassCardEventDefinition(eventId) {
    const row = firstRow(pass_card_event_json_1.default[String(eventId)]);
    const thresholdPoint = row ? integer(row[4]) : undefined;
    const levelThreshold = row ? integer(row[5]) : undefined;
    const startTime = row ? cnTimestamp(row[8]) : undefined;
    const endTime = row ? cnTimestamp(row[9]) : undefined;
    const forceTime = row ? cnTimestamp(row[10]) : undefined;
    if (thresholdPoint === undefined
        || levelThreshold === undefined || levelThreshold <= 0
        || startTime === undefined || endTime === undefined || forceTime === undefined)
        return undefined;
    return { eventId, thresholdPoint, levelThreshold, startTime, endTime, forceTime };
}
exports.getPassCardEventDefinition = getPassCardEventDefinition;
function isPassCardEventActiveAt(event, at) {
    const time = at.getTime();
    return Number.isFinite(time) && event.startTime <= time && time <= event.endTime;
}
exports.isPassCardEventActiveAt = isPassCardEventActiveAt;
function getPassCardRewardDefinition(rewardId) {
    const row = firstRow(pass_card_reward_json_1.default[String(rewardId)]);
    if (!row)
        return undefined;
    const eventId = integer(row[0]);
    const level = integer(row[1]);
    const reward1 = parseReward(row, 2);
    const reward2 = parseReward(row, 8);
    if (eventId === undefined || level === undefined || !reward1 || !reward2)
        return undefined;
    return { rewardId, eventId, level, reward1, reward2 };
}
exports.getPassCardRewardDefinition = getPassCardRewardDefinition;
