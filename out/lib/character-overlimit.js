"use strict";
// Character over-limit extension ("超限"): selected 5* characters may uncap
// past the retail cap with a dedicated item, up to level 120.
//
// The patched client mirrors these rules: a tagged character reports the
// extended cap only after the retail uncaps are used, offers only the
// extension item for the extra steps, and never offers duplicates for them.
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateOverLimitRequest = exports.getAwakeLevelMissionTarget = exports.getExtendedOverLimitExtraCosts = exports.estimateExtendedCharacterLevel = exports.getCharacterExpCap = exports.getCharacterMaxOverLimit = exports.getRetailMaxOverLimit = exports.isOverLimitFullRouteCharacter = exports.isOverLimitExtendedCharacter = exports.retailMaxOverLimits = exports.OVER_LIMIT_EXTENSION_ITEM_ID = void 0;
const character_overlimit_json_1 = __importDefault(require("../../assets/character_overlimit.json"));
const character_1 = require("./character");
const extension = character_overlimit_json_1.default;
const extendedCharacters = new Set(extension.characters);
const fullRouteCharacters = new Set((_a = extension.full_route_characters) !== null && _a !== void 0 ? _a : []);
exports.OVER_LIMIT_EXTENSION_ITEM_ID = extension.item_id;
exports.retailMaxOverLimits = {
    [1]: 12,
    [2]: 10,
    [3]: 8,
    [4]: 6,
    [5]: 4,
};
function isOverLimitExtendedCharacter(characterId, rarity) {
    return rarity === extension.rarity && extendedCharacters.has(characterId);
}
exports.isOverLimitExtendedCharacter = isOverLimitExtendedCharacter;
function isOverLimitFullRouteCharacter(characterId, rarity) {
    return isOverLimitExtendedCharacter(characterId, rarity) && fullRouteCharacters.has(characterId);
}
exports.isOverLimitFullRouteCharacter = isOverLimitFullRouteCharacter;
function getRetailMaxOverLimit(rarity) {
    return exports.retailMaxOverLimits[rarity];
}
exports.getRetailMaxOverLimit = getRetailMaxOverLimit;
function getCharacterMaxOverLimit(characterId, rarity) {
    if (isOverLimitExtendedCharacter(characterId, rarity))
        return extension.max_over_limit;
    return exports.retailMaxOverLimits[rarity];
}
exports.getCharacterMaxOverLimit = getCharacterMaxOverLimit;
function getCharacterExpCapList(characterId, rarity) {
    const caps = character_1.characterExpCaps[rarity];
    if (!caps)
        return undefined;
    return isOverLimitExtendedCharacter(characterId, rarity)
        ? [...caps, ...extension.extra_exp_caps]
        : caps;
}
function getCharacterExpCap(characterId, rarity, overLimitStep) {
    var _a;
    return (_a = getCharacterExpCapList(characterId, rarity)) === null || _a === void 0 ? void 0 : _a[overLimitStep];
}
exports.getCharacterExpCap = getCharacterExpCap;
function estimateExtendedCharacterLevel(characterId, rarity, exp) {
    const caps = getCharacterExpCapList(characterId, rarity);
    if (!caps || caps.length === 0)
        return 0;
    const baseLevel = 40 + (rarity - 1) * 10;
    let level = 0;
    for (let index = 0; index < caps.length; index++) {
        if (exp < caps[index])
            break;
        level = baseLevel + index * 5;
    }
    return level;
}
exports.estimateExtendedCharacterLevel = estimateExtendedCharacterLevel;
function getExtendedOverLimitExtraCosts(characterId, rarity, currentStep, count) {
    const retailMax = exports.retailMaxOverLimits[rarity];
    if (!isOverLimitExtendedCharacter(characterId, rarity) || retailMax === undefined)
        return [];
    if (currentStep < retailMax && !isOverLimitFullRouteCharacter(characterId, rarity))
        return [];
    return extension.extra_costs.map(cost => ({ itemId: cost.item_id, amount: cost.amount * count }));
}
exports.getExtendedOverLimitExtraCosts = getExtendedOverLimitExtraCosts;
function getAwakeLevelMissionTarget(missionId) {
    return extension.level_missions[String(missionId)];
}
exports.getAwakeLevelMissionTarget = getAwakeLevelMissionTarget;
/**
 * Validates one over_limit request against the retail and extended caps.
 * Returns an error message, or null when the request is allowed.
 */
function validateOverLimitRequest(characterId, rarity, currentStep, count, useStack, itemId) {
    const retailMax = exports.retailMaxOverLimits[rarity];
    const maxOver = getCharacterMaxOverLimit(characterId, rarity);
    if (retailMax === undefined || maxOver === undefined)
        return "Unknown rarity.";
    const newStep = currentStep + count;
    if (newStep > maxOver)
        return "Character cannot be uncapped further.";
    if (isOverLimitFullRouteCharacter(characterId, rarity)) {
        if (useStack)
            return "Duplicates cannot uncap this character.";
        if (itemId !== extension.item_id)
            return "Attempted to use invalid item.";
        return null;
    }
    if (currentStep < retailMax) {
        if (newStep > retailMax)
            return "Retail and extended uncaps must be requested separately.";
        if (useStack)
            return null;
        // Matches the client item table: 10003 is 5* only, 10002 covers 4* and below,
        // 10001 covers 3* and below.
        if ((rarity === 5 && itemId !== 10003)
            || (rarity === 4 && itemId !== 10002)
            || (rarity <= 3 && itemId !== 10002 && itemId !== 10001)) {
            return "Attempted to use invalid item.";
        }
        return null;
    }
    if (useStack)
        return "Duplicates cannot uncap past the retail cap.";
    if (itemId !== extension.item_id)
        return "Attempted to use invalid item.";
    return null;
}
exports.validateOverLimitRequest = validateOverLimitRequest;
