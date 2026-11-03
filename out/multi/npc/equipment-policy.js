"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isNpcPartyAllowedInRoom = exports.exclusivePartyItems = void 0;
const runtime_role_1 = require("../coordinator/runtime-role");
const business_facts_1 = require("../coordinator/business-facts");
const PARTY_ITEM_FIELDS = [
    "equipments", "equipmentIds", "equipment_ids",
    "abilitySoulIds", "ability_soul_ids",
];
// These CN item IDs remain Fantasy-only even without the optional runtime.
const FANTASY_ITEM_IDS = new Set(Array.from({ length: 11 }, (_, index) => 100013 + index));
function itemId(raw) {
    var _a, _b, _c, _d;
    const value = Array.isArray(raw) ? (raw[0] === 0 ? raw[1] : null) : raw;
    if (!value || typeof value !== "object")
        return value;
    return (_d = (_c = (_b = (_a = value.equipmentId) !== null && _a !== void 0 ? _a : value.equipment_id) !== null && _b !== void 0 ? _b : value.abilitySoulId) !== null && _c !== void 0 ? _c : value.ability_soul_id) !== null && _d !== void 0 ? _d : value.id;
}
/** Shared item parsing for player readiness and complete AI-party admission. */
function exclusivePartyItems(party) {
    if (!party || typeof party !== "object")
        return [];
    const ids = [];
    for (const field of PARTY_ITEM_FIELDS) {
        const values = party[field];
        if (Array.isArray(values))
            ids.push(...values.map(value => Number(itemId(value))));
    }
    return [...new Set([
            ...ids.filter(id => FANTASY_ITEM_IDS.has(id)),
            ...((0, runtime_role_1.isRealtimeOwnerChild)() ? ids.filter(id => (0, business_facts_1.getKnownExclusiveBusinessItemIds)().includes(id))
                : require("../../lib/mode15-optional").getMode15ExclusiveItemIds(ids)),
        ])];
}
exports.exclusivePartyItems = exclusivePartyItems;
/** Keep complete loadouts; never admit an AI by silently removing its gear. */
function isNpcPartyAllowedInRoom(category, questId, party) {
    var _a;
    if (!party || typeof party !== "object")
        return false;
    return (category !== undefined && questId !== undefined
        && ((0, runtime_role_1.isRealtimeOwnerChild)() ? ((_a = (0, business_facts_1.getQuestBusinessPolicy)(category, questId)) === null || _a === void 0 ? void 0 : _a.equipmentAllowed) === true
            : require("../../lib/mode15-optional").isMode15EquipmentAllowedQuest(category, questId)))
        || exclusivePartyItems(party).length === 0;
}
exports.isNpcPartyAllowedInRoom = isNpcPartyAllowedInRoom;
