"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureSpecialEventPartyGroupsSync = exports.mergePartyGroupsForCategory = exports.resolvePartyGroupColorId = exports.parseGlobalPartyId = exports.getGlobalPartyId = exports.hasValidPartyCategory = exports.isPartyCategory = void 0;
const types_1 = require("../data/types");
function isPartyCategory(value) {
    return Number.isInteger(value)
        && value >= types_1.PartyCategory.NORMAL
        && value <= types_1.PartyCategory.FANTASY;
}
exports.isPartyCategory = isPartyCategory;
function hasValidPartyCategory(value) {
    if (value === null || typeof value !== "object" || !("party_category" in value))
        return false;
    const category = value.party_category;
    return typeof category === "number" && isPartyCategory(category);
}
exports.hasValidPartyCategory = hasValidPartyCategory;
function getGlobalPartyId(groupId, slot) {
    if (!Number.isInteger(groupId) || groupId < 1 || groupId > 12
        || !Number.isInteger(slot) || slot < 1 || slot > 10) {
        throw new RangeError("Party group or slot is outside the CN protocol range.");
    }
    return (groupId - 1) * 10 + slot;
}
exports.getGlobalPartyId = getGlobalPartyId;
function parseGlobalPartyId(partyId) {
    if (!Number.isInteger(partyId) || partyId < 1 || partyId > 120)
        return null;
    return {
        groupId: Math.floor((partyId - 1) / 10) + 1,
        slot: ((partyId - 1) % 10) + 1,
    };
}
exports.parseGlobalPartyId = parseGlobalPartyId;
function resolvePartyGroupColorId(group) {
    var _a;
    return (_a = group === null || group === void 0 ? void 0 : group.colorId) !== null && _a !== void 0 ? _a : 15;
}
exports.resolvePartyGroupColorId = resolvePartyGroupColorId;
function copyParty(party, category) {
    return Object.assign(Object.assign({}, party), { characterIds: [...party.characterIds], unisonCharacterIds: [...party.unisonCharacterIds], equipmentIds: [...party.equipmentIds], abilitySoulIds: [...party.abilitySoulIds], options: Object.assign({}, party.options), category });
}
function mergePartyGroupsForCategory(existing, legacyFallback, defaults, category) {
    var _a;
    const result = {};
    for (const source of [defaults, legacyFallback, existing]) {
        for (const [groupId, group] of Object.entries(source)) {
            const target = (_a = result[groupId]) !== null && _a !== void 0 ? _a : { list: {}, colorId: group.colorId, category };
            target.colorId = group.colorId;
            target.category = category;
            for (const [slot, party] of Object.entries(group.list)) {
                target.list[slot] = copyParty(party, category);
            }
            result[groupId] = target;
        }
    }
    return result;
}
exports.mergePartyGroupsForCategory = mergePartyGroupsForCategory;
function ensureSpecialEventPartyGroupsSync(playerId, category, legacyFallbackCategory, dependencies) {
    const existing = dependencies.getGroups(playerId, category);
    const legacyFallback = legacyFallbackCategory === undefined
        ? {}
        : dependencies.getGroups(playerId, legacyFallbackCategory);
    const defaults = dependencies.getDefaults(category);
    const completeGroups = mergePartyGroupsForCategory(existing, legacyFallback, defaults, category);
    dependencies.ensureGroups(playerId, completeGroups);
    return dependencies.getGroups(playerId, category);
}
exports.ensureSpecialEventPartyGroupsSync = ensureSpecialEventPartyGroupsSync;
