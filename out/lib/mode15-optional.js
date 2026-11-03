"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var _a, _b, _c, _d, _e;
Object.defineProperty(exports, "__esModule", { value: true });
exports.shouldUnlockMode15MultiplayerPlayedParty = exports.shouldUnlockMode15PlayedParties = exports.getMode15ExclusiveGlobalPartyItemsSync = exports.getMode15ExclusivePartyItemsSync = exports.settleMode15BattleSync = exports.resetMode15RunSync = exports.cleanupLegacyMode15RescueProgressSync = exports.canJoinMode15RescueSync = exports.canStartMode15QuestSync = exports.getExpectedMode15StageSync = exports.getMode15ExclusiveItemIds = exports.isMode15EquipmentAllowedQuest = exports.isMode15Quest = exports.isMode15RuntimeLoaded = exports.MODE15_PRACTICE_QUEST_ID = exports.MODE15_TOKEN_ID = exports.MODE15_LEGACY_HARD_MULTI_EVENT_ID = exports.MODE15_MULTI_EVENT_ID = exports.MODE15_RUSH_EVENT_ID = void 0;
const path_1 = __importDefault(require("path"));
const types_1 = require("./types");
const DEFAULTS = Object.freeze({
    rushEventId: 700098,
    multiEventId: 300098,
    legacyHardMultiEventId: 100098,
    tokenId: 2370098,
    practiceQuestId: 700098016,
});
function isMissingRequestedModule(error, requested) {
    var _a;
    const candidate = error;
    return (candidate === null || candidate === void 0 ? void 0 : candidate.code) === "MODULE_NOT_FOUND"
        && String((_a = candidate.message) !== null && _a !== void 0 ? _a : "").includes(requested);
}
function loadMode15Runtime() {
    var _a;
    if (process.env.MODE15_ENABLED === "0")
        return null;
    const configured = (_a = process.env.MODE15_MODULE_PATH) === null || _a === void 0 ? void 0 : _a.trim();
    const requested = configured
        ? path_1.default.resolve(process.cwd(), configured)
        : "./mode15";
    try {
        // Deliberately use runtime require instead of a TypeScript import.
        // A generic server build therefore has no compile-time or startup
        // dependency on the optional Mode15 implementation.
        return require(requested);
    }
    catch (error) {
        if (isMissingRequestedModule(error, requested)) {
            console.warn(`[MODE15] optional module is not installed (${requested}); `
                + "base server behavior remains enabled");
            return null;
        }
        throw error;
    }
}
const runtime = loadMode15Runtime();
exports.MODE15_RUSH_EVENT_ID = (_a = runtime === null || runtime === void 0 ? void 0 : runtime.MODE15_RUSH_EVENT_ID) !== null && _a !== void 0 ? _a : DEFAULTS.rushEventId;
exports.MODE15_MULTI_EVENT_ID = (_b = runtime === null || runtime === void 0 ? void 0 : runtime.MODE15_MULTI_EVENT_ID) !== null && _b !== void 0 ? _b : DEFAULTS.multiEventId;
exports.MODE15_LEGACY_HARD_MULTI_EVENT_ID = (_c = runtime === null || runtime === void 0 ? void 0 : runtime.MODE15_LEGACY_HARD_MULTI_EVENT_ID) !== null && _c !== void 0 ? _c : DEFAULTS.legacyHardMultiEventId;
exports.MODE15_TOKEN_ID = (_d = runtime === null || runtime === void 0 ? void 0 : runtime.MODE15_TOKEN_ID) !== null && _d !== void 0 ? _d : DEFAULTS.tokenId;
exports.MODE15_PRACTICE_QUEST_ID = (_e = runtime === null || runtime === void 0 ? void 0 : runtime.MODE15_PRACTICE_QUEST_ID) !== null && _e !== void 0 ? _e : DEFAULTS.practiceQuestId;
function isMode15RuntimeLoaded() {
    return runtime !== null;
}
exports.isMode15RuntimeLoaded = isMode15RuntimeLoaded;
function isMode15Quest(category, questId) {
    var _a, _b;
    return (_b = (_a = runtime === null || runtime === void 0 ? void 0 : runtime.isMode15Quest) === null || _a === void 0 ? void 0 : _a.call(runtime, category, questId)) !== null && _b !== void 0 ? _b : false;
}
exports.isMode15Quest = isMode15Quest;
function isMode15EquipmentAllowedQuest(category, questId) {
    var _a, _b;
    return (_b = (_a = runtime === null || runtime === void 0 ? void 0 : runtime.isMode15EquipmentAllowedQuest) === null || _a === void 0 ? void 0 : _a.call(runtime, category, questId)) !== null && _b !== void 0 ? _b : (isMode15Quest(category, questId)
        || (Number(category) === Number(types_1.QuestCategory.RUSH_EVENT)
            && Number(questId) >= exports.MODE15_RUSH_EVENT_ID * 1000 + 1
            && Number(questId) <= exports.MODE15_PRACTICE_QUEST_ID));
}
exports.isMode15EquipmentAllowedQuest = isMode15EquipmentAllowedQuest;
function getMode15ExclusiveItemIds(itemIds) {
    var _a, _b;
    return (_b = (_a = runtime === null || runtime === void 0 ? void 0 : runtime.getMode15ExclusiveItemIds) === null || _a === void 0 ? void 0 : _a.call(runtime, itemIds)) !== null && _b !== void 0 ? _b : [];
}
exports.getMode15ExclusiveItemIds = getMode15ExclusiveItemIds;
function getExpectedMode15StageSync(playerId) {
    var _a, _b;
    return (_b = (_a = runtime === null || runtime === void 0 ? void 0 : runtime.getExpectedMode15StageSync) === null || _a === void 0 ? void 0 : _a.call(runtime, playerId)) !== null && _b !== void 0 ? _b : 1;
}
exports.getExpectedMode15StageSync = getExpectedMode15StageSync;
function canStartMode15QuestSync(playerId, category, questId) {
    var _a, _b;
    return (_b = (_a = runtime === null || runtime === void 0 ? void 0 : runtime.canStartMode15QuestSync) === null || _a === void 0 ? void 0 : _a.call(runtime, playerId, category, questId)) !== null && _b !== void 0 ? _b : {
        allowed: true,
        stage: null,
        expectedStage: 1,
    };
}
exports.canStartMode15QuestSync = canStartMode15QuestSync;
function canJoinMode15RescueSync(playerId, category, questId) {
    var _a, _b;
    return (_b = (_a = runtime === null || runtime === void 0 ? void 0 : runtime.canJoinMode15RescueSync) === null || _a === void 0 ? void 0 : _a.call(runtime, playerId, category, questId)) !== null && _b !== void 0 ? _b : {
        allowed: true,
        stage: null,
        expectedStage: 1,
    };
}
exports.canJoinMode15RescueSync = canJoinMode15RescueSync;
function cleanupLegacyMode15RescueProgressSync(playerId) {
    var _a, _b;
    return (_b = (_a = runtime === null || runtime === void 0 ? void 0 : runtime.cleanupLegacyMode15RescueProgressSync) === null || _a === void 0 ? void 0 : _a.call(runtime, playerId)) !== null && _b !== void 0 ? _b : 0;
}
exports.cleanupLegacyMode15RescueProgressSync = cleanupLegacyMode15RescueProgressSync;
function resetMode15RunSync(playerId) {
    var _a;
    (_a = runtime === null || runtime === void 0 ? void 0 : runtime.resetMode15RunSync) === null || _a === void 0 ? void 0 : _a.call(runtime, playerId);
}
exports.resetMode15RunSync = resetMode15RunSync;
function settleMode15BattleSync(playerId, category, questId, accomplished, options = {}) {
    var _a, _b;
    return (_b = (_a = runtime === null || runtime === void 0 ? void 0 : runtime.settleMode15BattleSync) === null || _a === void 0 ? void 0 : _a.call(runtime, playerId, category, questId, accomplished, options)) !== null && _b !== void 0 ? _b : null;
}
exports.settleMode15BattleSync = settleMode15BattleSync;
function getMode15ExclusivePartyItemsSync(playerId, category, groupId, slot = null) {
    var _a, _b;
    return (_b = (_a = runtime === null || runtime === void 0 ? void 0 : runtime.getMode15ExclusivePartyItemsSync) === null || _a === void 0 ? void 0 : _a.call(runtime, playerId, category, groupId, slot)) !== null && _b !== void 0 ? _b : [];
}
exports.getMode15ExclusivePartyItemsSync = getMode15ExclusivePartyItemsSync;
function getMode15ExclusiveGlobalPartyItemsSync(playerId, category, partyId) {
    var _a, _b;
    return (_b = (_a = runtime === null || runtime === void 0 ? void 0 : runtime.getMode15ExclusiveGlobalPartyItemsSync) === null || _a === void 0 ? void 0 : _a.call(runtime, playerId, category, partyId)) !== null && _b !== void 0 ? _b : [];
}
exports.getMode15ExclusiveGlobalPartyItemsSync = getMode15ExclusiveGlobalPartyItemsSync;
function shouldUnlockMode15PlayedParties(eventId) {
    return runtime !== null
        && eventId === exports.MODE15_RUSH_EVENT_ID
        && process.env.MODE15_ALLOW_CHARACTER_REUSE === "true";
}
exports.shouldUnlockMode15PlayedParties = shouldUnlockMode15PlayedParties;
/**
 * Multiplayer boundary stages advance the Fantasy Gauntlet run without
 * consuming characters regardless of the local all-stage reuse switch.  The
 * stored party row is still required as a safe completion marker, so callers
 * should only hide its member ids when sending it to the client.
 */
function shouldUnlockMode15MultiplayerPlayedParty(eventId, round) {
    if (runtime === null || eventId !== exports.MODE15_RUSH_EVENT_ID)
        return false;
    const stage = Math.abs(Math.trunc(round)) % 1000;
    return stage === 5 || stage === 10 || stage === 15;
}
exports.shouldUnlockMode15MultiplayerPlayedParty = shouldUnlockMode15MultiplayerPlayedParty;
